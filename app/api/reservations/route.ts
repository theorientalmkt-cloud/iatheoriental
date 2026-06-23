/**
 * Reservas internas — calendário interno do restaurante.
 * GET  /api/reservations?from=YYYY-MM-DD&to=YYYY-MM-DD  → lista no intervalo (default: hoje..+3 meses)
 * POST /api/reservations                                → cria reserva
 *
 * Usa a tabela `reservations` (já existente no banco). Escrita via service role
 * (RLS revoga INSERT/UPDATE/DELETE para anon/authenticated).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase'
import { formatInTimeZone } from 'date-fns-tz'
import { addMonths } from 'date-fns'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TZ = 'America/Sao_Paulo'

const createSchema = z.object({
  reservation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use YYYY-MM-DD)'),
  reservation_time: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  party_size: z.coerce.number().int().min(1).max(999).default(1),
  guest_name: z.string().nullable().optional(),
  guest_phone: z.string().nullable().optional(),
  menu_choice: z.string().nullable().optional(),
  status: z.string().default('pendente'),
  internal_notes: z.string().nullable().optional(),
  allergy_notes: z.string().nullable().optional(),
})

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const today = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const from = searchParams.get('from') || today
  const to =
    searchParams.get('to') ||
    formatInTimeZone(addMonths(new Date(`${today}T12:00:00`), 3), TZ, 'yyyy-MM-dd')

  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .gte('reservation_date', from)
    .lte('reservation_date', to)
    .order('reservation_date', { ascending: true })
    .order('reservation_time', { ascending: true })
    .limit(5000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ reservations: data || [], from, to })
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 })

  const body = await request.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Dados inválidos', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('reservations')
    .insert({ ...parsed.data, source: 'manual' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ reservation: data })
}
