/**
 * Busca reservas de um telefone (para o inbox mostrar se o lead já tem reserva).
 * GET /api/reservations/by-phone?phone=+5511...
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { formatInTimeZone } from 'date-fns-tz'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TZ = 'America/Sao_Paulo'
const CANCELLED = new Set(['cancelado', 'no_show'])

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return NextResponse.json({ hasReservation: false, upcoming: [], next: null, total: 0 })

  const phone = request.nextUrl.searchParams.get('phone') || ''
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 8) {
    return NextResponse.json({ hasReservation: false, upcoming: [], next: null, total: 0 })
  }
  // últimos 11 dígitos (DDD + número) — tolera variação de código de país
  const last = digits.slice(-11)

  const { data, error } = await supabase
    .from('reservations')
    .select('id, reservation_date, reservation_time, party_size, location, status, menu_choice, guest_name, guest_phone, whatsapp_id')
    // sufixo (não "contém") — reduz falso positivo já na query
    .or(`guest_phone.ilike.%${last},whatsapp_id.ilike.%${last}`)
    .order('reservation_date', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ hasReservation: false, upcoming: [], next: null, total: 0 })

  const today = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  // Confirma o match por SUFIXO exato (DDD+número) — evita casar número diferente
  const all = (data || []).filter((r) => {
    const gp = String(r.guest_phone || '').replace(/\D/g, '')
    const wa = String(r.whatsapp_id || '').replace(/\D/g, '')
    return gp.endsWith(last) || wa.endsWith(last)
  })
  const upcoming = all.filter(
    (r) => String(r.reservation_date) >= today && !CANCELLED.has(String(r.status || '').toLowerCase())
  )

  return NextResponse.json({
    total: all.length,
    hasReservation: upcoming.length > 0,
    upcoming,
    next: upcoming[0] || null,
  })
}
