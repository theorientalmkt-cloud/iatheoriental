/**
 * Dados da Loja — GET/POST de settings.store_info.
 * Usado pela telinha Configurações → Dados da Loja.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getStoreInfo, setStoreInfo } from '@/lib/store-info'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const info = await getStoreInfo()
  return NextResponse.json(info)
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  // Validação leve do WhatsApp (só dígitos, 10-15)
  if (body.whatsappConfirm !== undefined) {
    const wa = String(body.whatsappConfirm).replace(/\D/g, '')
    if (wa && (wa.length < 10 || wa.length > 15)) {
      return NextResponse.json(
        { error: 'Número de WhatsApp inválido. Use o formato internacional, ex.: 5511999999999.' },
        { status: 400 }
      )
    }
  }

  const saved = await setStoreInfo({
    address: body.address,
    whatsappConfirm: body.whatsappConfirm,
    sendLinkAfterBooking: body.sendLinkAfterBooking,
  })
  return NextResponse.json({ success: true, ...saved })
}
