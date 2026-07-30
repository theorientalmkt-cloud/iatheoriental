import { NextRequest, NextResponse } from 'next/server'
import { getNonResponders, type ReceivedMode } from '@/lib/reengagement'
import { requireSessionOrApiKey } from '@/lib/request-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const VALID_MODES: ReceivedMode[] = ['sent', 'delivered', 'read']

/**
 * GET /api/reengagement/non-responders?campaignId=...&received=delivered
 * Retorna quem recebeu a campanha e não respondeu depois do envio.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireSessionOrApiKey(request)
    if (auth) return auth

    const url = new URL(request.url)
    const campaignId = (url.searchParams.get('campaignId') || '').trim()
    if (!campaignId) {
      return NextResponse.json({ error: 'campaignId é obrigatório' }, { status: 400 })
    }

    const receivedParam = (url.searchParams.get('received') || 'delivered').trim() as ReceivedMode
    const mode: ReceivedMode = VALID_MODES.includes(receivedParam) ? receivedParam : 'delivered'

    const result = await getNonResponders(campaignId, mode)

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache',
        Expires: '0',
      },
    })
  } catch (error) {
    console.error('Failed to compute non-responders:', error)
    return NextResponse.json(
      { error: 'Falha ao calcular não-respondentes', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
