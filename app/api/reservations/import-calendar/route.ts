/**
 * Importa reservas do Google Calendar para a tabela `reservations`.
 *
 * Lê os eventos da agenda conectada (que o Kizuma cria via confirmBooking),
 * interpreta os dados do título/descrição (Cliente, Pessoas, Local, Menu,
 * Alergias, WhatsApp, status [PENDENTE]/[CONFIRMADO]) e cria/atualiza as
 * reservas na plataforma. Idempotente: remove as reservas com source='calendar'
 * no intervalo antes de reinserir (não toca nas reservas manuais).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getCalendarConfig, listEvents, type GoogleCalendarEvent } from '@/lib/google-calendar'
import { formatInTimeZone } from 'date-fns-tz'
import { addDays } from 'date-fns'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TZ = 'America/Sao_Paulo'

interface ReservationRow {
  reservation_date: string
  reservation_time: string | null
  location: string | null
  party_size: number
  guest_name: string | null
  guest_phone: string | null
  menu_choice: string | null
  allergy_notes: string | null
  status: string
  internal_notes: string | null
  source: string
}

function fieldFrom(desc: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*:\\s*(.+)`, 'i')
  const m = desc.match(re)
  return m ? m[1].trim() : null
}

function parseStatus(text: string): string {
  if (/\[?confirmad/i.test(text)) return 'confirmado'
  if (/\[?pendente/i.test(text) || /STATUS\s*:\s*PENDENTE/i.test(text)) return 'pendente'
  if (/no[-\s]?show/i.test(text)) return 'no_show'
  if (/cancelad/i.test(text)) return 'cancelado'
  return 'pendente'
}

function parseGuestName(summary: string, desc: string): string | null {
  const fromDesc = fieldFrom(desc, 'Cliente')
  if (fromDesc) return fromDesc
  // summary tipo "[PENDENTE] Nippon - João Silva" → pega depois do último " - "
  const cleaned = summary.replace(/\[(pendente|confirmado)\]/gi, '').trim()
  if (cleaned.includes(' - ')) return cleaned.split(' - ').pop()!.trim()
  return cleaned || null
}

function parsePhone(desc: string): string | null {
  const m = desc.match(/wa\.me\/(\d{8,15})/i)
  if (m) return `+${m[1]}`
  const f = fieldFrom(desc, 'WhatsApp')
  return f && /\d/.test(f) ? f : null
}

function parseMenu(text: string): string | null {
  if (/nippon/i.test(text)) return 'Nippon'
  if (/\bxp\b/i.test(text)) return 'XP'
  return null
}

function looksLikeReservation(summary: string, desc: string): boolean {
  return (
    /\[(pendente|confirmado)\]/i.test(summary) ||
    /pessoas\s*:/i.test(desc) ||
    /menu\s*:/i.test(desc) ||
    /status\s*:/i.test(desc)
  )
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 })

  const config = await getCalendarConfig()
  if (!config?.calendarId) {
    return NextResponse.json(
      { error: 'Google Calendar não conectado. Conecte em Configurações → Integrações.' },
      { status: 400 }
    )
  }
  const timeZone = config.calendarTimeZone || TZ

  // Intervalo: de 7 dias atrás até 3 meses à frente
  const today = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const fromDate = formatInTimeZone(addDays(new Date(`${today}T12:00:00`), -7), TZ, 'yyyy-MM-dd')
  const toDate = formatInTimeZone(addDays(new Date(`${today}T12:00:00`), 90), TZ, 'yyyy-MM-dd')
  const timeMin = `${fromDate}T00:00:00.000Z`
  const timeMax = `${toDate}T23:59:59.000Z`

  let events: GoogleCalendarEvent[] = []
  try {
    events = await listEvents({ calendarId: config.calendarId, timeMin, timeMax, timeZone, maxResults: 2500 })
  } catch (e) {
    return NextResponse.json(
      { error: 'Falha ao ler o Google Calendar.', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    )
  }

  const rows: ReservationRow[] = []
  let ignored = 0
  for (const ev of events) {
    if (ev.status === 'cancelled') continue
    const summary = (ev.summary || '').trim()
    const desc = (ev.description || '').trim()
    if (!looksLikeReservation(summary, desc)) { ignored++; continue }

    const startRaw = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T12:00:00` : null)
    if (!startRaw) { ignored++; continue }
    const startDate = new Date(startRaw)
    if (Number.isNaN(startDate.getTime())) { ignored++; continue }

    const reservation_date = formatInTimeZone(startDate, timeZone, 'yyyy-MM-dd')
    const reservation_time = ev.start?.dateTime ? formatInTimeZone(startDate, timeZone, 'HH:mm') : null
    const text = `${summary}\n${desc}`

    // So importa turnos validos da casa: 13h (XP, Qui-Dom) ou 19h/21h (Nippon, Ter-Sab).
    // Pula eventos em horario invalido (ex.: 18h) para nao poluir as reservas.
    const wd = Number(formatInTimeZone(startDate, timeZone, 'i')) % 7
    const validForTime =
      (reservation_time === '13:00' && [4, 5, 6, 0].includes(wd)) ||
      ((reservation_time === '19:00' || reservation_time === '21:00') && wd >= 2 && wd <= 6)
    if (!validForTime) { ignored++; continue }

    rows.push({
      reservation_date,
      reservation_time,
      location: fieldFrom(desc, 'Local'),
      party_size: parseInt(fieldFrom(desc, 'Pessoas') || '') || 1,
      guest_name: parseGuestName(summary, desc),
      guest_phone: parsePhone(desc),
      menu_choice: parseMenu(text),
      allergy_notes: fieldFrom(desc, 'Alergias'),
      status: parseStatus(text),
      internal_notes: 'Importado do Google Calendar',
      source: 'calendar',
    })
  }

  // Idempotência: remove as reservas 'calendar' já importadas no intervalo
  try {
    await supabase
      .from('reservations')
      .delete()
      .eq('source', 'calendar')
      .gte('reservation_date', fromDate)
      .lte('reservation_date', toDate)
  } catch {
    // segue mesmo se a limpeza falhar
  }

  let imported = 0
  if (rows.length) {
    let { error } = await supabase.from('reservations').insert(rows)
    // Resiliência: se a coluna `location` não existir no banco, reinsere sem ela
    if (error && /location/i.test(error.message) && /(column|does not exist|schema cache)/i.test(error.message)) {
      const stripped = rows.map(({ location: _loc, ...rest }) => rest)
      const retry = await supabase.from('reservations').insert(stripped)
      error = retry.error
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    imported = rows.length
  }

  return NextResponse.json({
    imported,
    ignored,
    totalEventsLidos: events.length,
    intervalo: `${fromDate} a ${toDate}`,
  })
}
