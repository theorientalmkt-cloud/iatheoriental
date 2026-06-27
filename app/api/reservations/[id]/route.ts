/**
 * Reserva individual.
 * PATCH  /api/reservations/[id]  → atualiza campos
 * DELETE /api/reservations/[id]  → remove
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

const updateSchema = z.object({
  reservation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reservation_time: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  party_size: z.coerce.number().int().min(1).max(999).optional(),
  guest_name: z.string().nullable().optional(),
  guest_phone: z.string().nullable().optional(),
  menu_choice: z.string().nullable().optional(),
  status: z.string().optional(),
  internal_notes: z.string().nullable().optional(),
  allergy_notes: z.string().nullable().optional(),
})

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = getSupabaseAdmin()
  if (!supabase) return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 })

  const body = await request.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Dados inválidos', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('reservations')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ reservation: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = getSupabaseAdmin()
  if (!supabase) return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 })

  // Soft-delete: marca como cancelada (preserva histórico/auditoria; não conta na lotação)
  const { error } = await supabase.from('reservations').update({ status: 'cancelado' }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
