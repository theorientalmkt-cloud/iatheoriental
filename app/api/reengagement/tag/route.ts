import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { contactDb } from '@/lib/supabase-db'
import { requireSessionOrApiKey } from '@/lib/request-auth'
import { validateBodyOrError } from '@/lib/api-validation'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TagNonRespondersSchema = z.object({
  contactIds: z
    .array(z.string().min(1, 'ID inválido'))
    .min(1, 'Nenhum contato para marcar')
    .max(20000, 'Máximo de 20.000 contatos por operação'),
  tag: z.string().trim().min(1, 'Tag não pode ser vazia').max(60, 'Tag muito longa'),
})

const CHUNK = 400

/**
 * POST /api/reengagement/tag
 * Aplica UMA tag em massa nos contatos informados (não-respondentes).
 * Chama contactDb.bulkUpdateTags em lotes, sem o cap de 500 do endpoint genérico.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireSessionOrApiKey(request)
    if (auth) return auth

    const body = await request.json().catch(() => ({}))
    const validation = validateBodyOrError(TagNonRespondersSchema, body)
    if (!validation.success) return validation.response

    const { contactIds, tag } = validation.data
    const uniqueIds = Array.from(new Set(contactIds))

    let updated = 0
    for (let i = 0; i < uniqueIds.length; i += CHUNK) {
      const part = uniqueIds.slice(i, i + CHUNK)
      updated += await contactDb.bulkUpdateTags(part, [tag], [])
    }

    return NextResponse.json({ updated, tag })
  } catch (error) {
    console.error('Failed to tag non-responders:', error)
    return NextResponse.json(
      { error: 'Falha ao marcar contatos', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
