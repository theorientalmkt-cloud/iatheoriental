/**
 * Internal Booking Tool — usa a tabela `reservations` da plataforma
 * (NÃO o Google Calendar). Substitui o calendar-text-booking-tool no fluxo do
 * Kizuma: checkAvailability conta as reservas internas por dia/turno e calcula
 * vagas; confirmBooking insere a reserva (status pendente, source whatsapp_ia).
 *
 * As regras da casa (menus, turnos, capacidade) vêm de `lib/menus/catalog.ts`,
 * fonte única — este módulo não as redefine.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { addDays } from 'date-fns'
import {
  CAPACITY_TOTAL,
  DECK_CAPACITY,
  MIN_ADVANCE_HOURS,
  TIMEZONE,
  turnosForWeekday,
  isTurnoValido,
  MENUS,
} from '@/lib/menus/catalog'

const TZ = TIMEZONE
const CANCELLED = new Set(['cancelado', 'no_show'])

const WD_LABEL: Record<number, string> = {
  0: 'Domingo', 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado',
}

interface Turno { time: string; menu: string; label: string }
interface TurnoVagas extends Turno { vagas: number; deckVagas: number }

export type TextBookingPrerequisites = {
  ready: boolean
  missing: string[]
  details: { hasSupabase: boolean }
}

// =============================================================================
// HELPERS
// =============================================================================

function normalizeTime(raw: unknown): string {
  const s = String(raw ?? '').trim()
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`
  return s
}

function weekdayOf(dateStr: string): number {
  return Number(formatInTimeZone(new Date(`${dateStr}T12:00:00`), TZ, 'i')) % 7
}

function ddmm(dateStr: string): string {
  return formatInTimeZone(new Date(`${dateStr}T12:00:00`), TZ, 'dd/MM')
}

/** Um turno (data + horario) so e valido se existir na grade da casa
 * (XP 13h Qui-Dom; Nippon 19h/21h Ter-Sab). */
function isValidSlot(dateStr: string, time: string): boolean {
  return isTurnoValido(weekdayOf(dateStr), time)
}

// =============================================================================
// PREREQUISITES
// =============================================================================

export async function checkTextBookingPrerequisites(): Promise<TextBookingPrerequisites> {
  const ok = isSupabaseConfigured()
  return {
    ready: ok,
    missing: ok ? [] : ['Supabase não configurado'],
    details: { hasSupabase: ok },
  }
}

// =============================================================================
// CHECK AVAILABILITY (lê reservas internas)
// =============================================================================

export type AvailabilityResult = {
  available: boolean
  timezone: string
  dateRange: string
  days: Array<{ date: string; weekday: string; turnos: TurnoVagas[] }>
  message: string
}

export async function checkAvailability(params?: {
  daysAhead?: number
  preferredDate?: string
}): Promise<AvailabilityResult> {
  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return { available: false, timezone: TZ, dateRange: '', days: [], message: 'Agendamento indisponível no momento.' }
  }

  const today = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  // Corte de antecedência mínima (data+hora completas, com minutos)
  const cutoffMs = Date.now() + MIN_ADVANCE_HOURS * 60 * 60 * 1000

  let dates: string[] = []
  if (params?.preferredDate && /^\d{4}-\d{2}-\d{2}$/.test(params.preferredDate)) {
    dates = [params.preferredDate]
  } else {
    const n = Math.min(Math.max(params?.daysAhead || 7, 1), 30)
    for (let i = 0; i < n; i++) {
      dates.push(formatInTimeZone(addDays(new Date(`${today}T12:00:00`), i), TZ, 'yyyy-MM-dd'))
    }
  }

  const from = dates[0]
  const to = dates[dates.length - 1]

  const { data } = await supabase
    .from('reservations')
    .select('reservation_date, reservation_time, party_size, location, status')
    .gte('reservation_date', from)
    .lte('reservation_date', to)
    .limit(5000)

  const rows = (data || []).filter((r) => !CANCELLED.has(String(r.status || '').toLowerCase()))

  const booked = new Map<string, number>()
  const deckBooked = new Map<string, number>()
  for (const r of rows) {
    const k = `${r.reservation_date}|${normalizeTime(r.reservation_time)}`
    const n = Number(r.party_size) || 0
    booked.set(k, (booked.get(k) || 0) + n)
    if (/deck/i.test(String(r.location || ''))) deckBooked.set(k, (deckBooked.get(k) || 0) + n)
  }

  const days: AvailabilityResult['days'] = []
  for (const d of dates) {
    const wd = weekdayOf(d)
    const turnos: TurnoVagas[] = []
    for (const tn of turnosForWeekday(wd)) {
      // antecedência mínima — compara o instante completo do turno (com minutos)
      const slotMs = fromZonedTime(`${d}T${tn.time}:00`, TZ).getTime()
      if (slotMs < cutoffMs) continue
      const k = `${d}|${tn.time}`
      turnos.push({
        ...tn,
        vagas: Math.max(0, CAPACITY_TOTAL - (booked.get(k) || 0)),
        deckVagas: Math.max(0, DECK_CAPACITY - (deckBooked.get(k) || 0)),
      })
    }
    if (turnos.length) days.push({ date: d, weekday: WD_LABEL[wd], turnos })
  }

  const lines: string[] = []
  for (const day of days) {
    lines.push(`${day.weekday} ${ddmm(day.date)}`)
    for (const t of day.turnos) {
      lines.push(`  ${t.label} - ${t.vagas > 0 ? `${t.vagas} vagas` : 'LOTADO'}`)
    }
  }

  const dateRange = `${ddmm(from)} a ${ddmm(to)}`
  return {
    available: days.some((d) => d.turnos.some((t) => t.vagas > 0)),
    timezone: TZ,
    dateRange,
    days,
    message: lines.length
      ? `Disponibilidade (${dateRange}):\n${lines.join('\n')}`
      : `Não há turnos disponíveis no período (${dateRange}).`,
  }
}

// =============================================================================
// CONFIRM BOOKING (grava na tabela reservations)
// =============================================================================

export type BookingResult = {
  success: boolean
  reservationId?: string
  summary?: string
  error?: string
}

export async function confirmBooking(params: {
  slotStart: string
  customerName: string
  customerPhone: string
  /** Número de pessoas. Argumento TIPADO — nunca extraído de texto livre. */
  partySize: number
  /** true se o cliente trará pet (só há lugar no deck/janela). */
  hasPet?: boolean
  /** Alergias/restrições. "Nenhuma" ou vazio = sem restrição. */
  allergies?: string | null
  service?: string
  notes?: string
}): Promise<BookingResult> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return { success: false, error: 'Sistema indisponível no momento.' }

  // O número de pessoas define a checagem de capacidade. Antes vinha de um
  // regex sobre `notes` (prosa escrita pelo LLM) e caía em 1 silenciosamente
  // quando o padrão não casava — o turno era vendido além da lotação. Agora é
  // argumento tipado e um valor inválido FALHA em vez de virar 1.
  if (!Number.isInteger(params.partySize) || params.partySize < 1) {
    return { success: false, error: 'Número de pessoas inválido. Informe partySize como inteiro maior ou igual a 1.' }
  }
  if (params.partySize > CAPACITY_TOTAL) {
    return { success: false, error: `A casa comporta no máximo ${CAPACITY_TOTAL} pessoas por turno.` }
  }

  // A string SEM offset (o modelo manda "2026-06-27T19:00:00" naive) é hora de
  // São Paulo. Sem isto, new Date() usa o fuso do HOST (Vercel = UTC) e a hora
  // sai deslocada (19:00 -> 16:00), rejeitando turnos válidos. Se já vier com
  // offset (-03:00/Z), respeita o offset. Coerente com o cálculo de disponibilidade.
  const hasOffset = /([+-]\d\d:?\d\d|Z)$/.test(params.slotStart)
  const start = hasOffset ? new Date(params.slotStart) : fromZonedTime(params.slotStart, TZ)
  if (Number.isNaN(start.getTime())) return { success: false, error: 'Data/hora inválida para o agendamento.' }

  const reservation_date = formatInTimeZone(start, TZ, 'yyyy-MM-dd')
  const reservation_time = formatInTimeZone(start, TZ, 'HH:mm')

  // Valida o turno: so 13h (XP, Qui-Dom) ou 19h/21h (Nippon, Ter-Sab).
  // Bloqueia horarios invalidos (ex.: 18h) mesmo que o LLM tente criar.
  if (!isValidSlot(reservation_date, reservation_time)) {
    const validos = turnosForWeekday(weekdayOf(reservation_date))
    const lista = validos.length
      ? validos.map((t) => t.label).join(', ')
      : 'nenhum (a casa não abre neste dia)'
    return {
      success: false,
      error: `Horário inválido para reserva. Turnos válidos em ${reservation_date}: ${lista}. Ofereça um desses ao cliente.`,
    }
  }

  // Trava anti-duplicidade: o mesmo cliente (telefone) nao pode ter duas reservas
  // ativas no MESMO horario/turno (mesma data + mesmo horario). Ele PODE reservar
  // turnos diferentes no mesmo dia (ex.: 19h para um grupo e 21h para outro).
  // Como cada turno tem apenas 9 lugares, a trava protege a lotacao do turno.
  // A IA nao enxerga reservas individuais (REGRA 1/3 do prompt), entao o bloqueio
  // confiavel precisa acontecer aqui no sistema.
  const phoneDigits = String(params.customerPhone || '').replace(/\D/g, '')
  if (phoneDigits.length >= 8) {
    const last = phoneDigits.slice(-11)
    const { data: sameSlot } = await supabase
      .from('reservations')
      .select('reservation_time, guest_phone, whatsapp_id, status')
      .eq('reservation_date', reservation_date)
    const dup = (sameSlot || []).find((r) => {
      if (CANCELLED.has(String(r.status || '').toLowerCase())) return false
      if (normalizeTime(r.reservation_time) !== reservation_time) return false // so bloqueia o MESMO turno
      const gp = String(r.guest_phone || '').replace(/\D/g, '')
      const wa = String(r.whatsapp_id || '').replace(/\D/g, '')
      return (!!gp && gp.endsWith(last)) || (!!wa && wa.endsWith(last))
    })
    if (dup) {
      const formattedDup = reservation_date.split('-').reverse().join('/')
      return {
        success: false,
        error: `Este cliente ja possui uma reserva ativa em ${formattedDup} as ${reservation_time}. Nao crie outra reserva para o MESMO horario. Informe o cliente que ele ja tem reserva nesse horario; se quiser, ele pode escolher outro horario disponivel no mesmo dia.`,
      }
    }
  }

  const notes = params.notes || ''

  // Dados que governam a reserva vêm TIPADOS (não de regex sobre `notes`).
  const party_size = params.partySize
  const hasPet = params.hasPet === true
  // O menu é consequência do turno escolhido (cada horário pertence a um menu
  // no catálogo), não de adivinhação sobre o texto de `service`/`notes`.
  const turno = turnosForWeekday(weekdayOf(reservation_date)).find((t) => t.time === reservation_time)
  const menu_choice = turno?.menu ?? MENUS[0].id
  const location = hasPet ? 'Deck/janela (pet)' : 'A definir pela equipe'
  const allergyRaw = params.allergies ?? null
  const allergy_notes = allergyRaw && allergyRaw.trim() && !/^nenhuma?$/i.test(allergyRaw.trim()) ? allergyRaw.trim() : null

  // Re-checa capacidade no turno
  const { data: existing } = await supabase
    .from('reservations')
    .select('party_size, location, status')
    .eq('reservation_date', reservation_date)
    .eq('reservation_time', reservation_time)
  const active = (existing || []).filter((r) => !CANCELLED.has(String(r.status || '').toLowerCase()))
  const booked = active.reduce((s, r) => s + (Number(r.party_size) || 0), 0)
  if (booked + party_size > CAPACITY_TOTAL) {
    return { success: false, error: `Não há vagas suficientes nesse turno (restam ${Math.max(0, CAPACITY_TOTAL - booked)}).` }
  }
  if (hasPet) {
    const deckBooked = active
      .filter((r) => /deck/i.test(String(r.location || '')))
      .reduce((s, r) => s + (Number(r.party_size) || 0), 0)
    if (deckBooked + party_size > DECK_CAPACITY) {
      return { success: false, error: `Não há vaga no deck/janela (pet) nesse turno (restam ${Math.max(0, DECK_CAPACITY - deckBooked)}).` }
    }
  }

  const { data: inserted, error } = await supabase
    .from('reservations')
    .insert({
      reservation_date,
      reservation_time,
      party_size,
      guest_name: params.customerName || null,
      guest_phone: params.customerPhone || null,
      menu_choice,
      location,
      allergy_notes,
      status: 'pendente',
      internal_notes: notes || null,
      source: 'whatsapp_ia',
    })
    .select('id')
    .single()

  if (error) {
    console.error('[internal-booking] erro ao inserir reserva:', error)
    return { success: false, error: 'Erro ao registrar a reserva. Tente novamente.' }
  }

  const formattedDate = reservation_date.split('-').reverse().join('/')
  return {
    success: true,
    reservationId: inserted?.id,
    summary: `${menu_choice} em ${formattedDate} às ${reservation_time} para ${party_size} pessoa(s)`,
  }
}

// =============================================================================
// TOOL DESCRIPTIONS (para o Vercel AI SDK)
// =============================================================================

export const CHECK_AVAILABILITY_DESCRIPTION = `Consulta as vagas disponíveis para reserva (lê a agenda interna da plataforma).
Use quando o cliente JÁ demonstrou que quer reservar.
Parâmetros opcionais:
- daysAhead: quantos dias à frente consultar (padrão 7)
- preferredDate: data específica (YYYY-MM-DD), se o cliente mencionou uma.
Retorna os turnos válidos por dia (Jantar 19h/21h Ter-Sáb, Almoço XP 13h Qui-Dom) com o número de vagas (máx 9 por turno). Apresente ao cliente apenas o total de vagas por turno.`

export const CONFIRM_BOOKING_DESCRIPTION = `Cria a pré-reserva (status PENDENTE) na plataforma.
Use SOMENTE depois de: consultar disponibilidade, o cliente escolher data/horário, e você ter coletado nome completo, alergias e se vai trazer pet.
- slotStart: ISO string exato do turno escolhido (data + hora, ex: 2026-06-27T19:00:00 no horário de São Paulo).
- customerName: nome completo do cliente.
- service: "[PENDENTE] Nippon" ou "[PENDENTE] XP".
- partySize: número EXATO de pessoas, como inteiro (ex: 6). Obrigatório.
- hasPet: true se o cliente trará pet, false se não. Obrigatório.
- allergies: alergias/restrições do grupo, ou "Nenhuma". Obrigatório.
- notes: observações livres adicionais (NÃO é de onde saem pessoas, pet ou alergias).
NÃO invente horários — use apenas os retornados por checkAvailability.`
