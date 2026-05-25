/**
 * Calendar Text Booking Tool for AI Agents
 *
 * Alternativa ao booking-tool.ts que NÃO depende de WhatsApp Flows (mini app Meta).
 * A IA consulta disponibilidade e agenda diretamente via conversa de texto.
 *
 * Duas tools:
 * 1. checkAvailability - Consulta slots livres no Google Calendar
 * 2. confirmBooking - Cria o evento no Google Calendar
 *
 * Isso elimina a dependência de aprovação do Flow na Meta.
 */

import { settingsDb } from '@/lib/supabase-db'
import { isSupabaseConfigured } from '@/lib/supabase'
import {
  getCalendarConfig,
  listBusyTimes,
  createEvent,
} from '@/lib/google-calendar'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { addMinutes, addDays } from 'date-fns'

// =============================================================================
// TYPES
// =============================================================================

type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

type WorkingHoursDay = {
  day: Weekday
  enabled: boolean
  start: string
  end: string
}

type CalendarBookingConfig = {
  timezone: string
  slotDurationMinutes: number
  slotBufferMinutes: number
  workingHours: WorkingHoursDay[]
  minAdvanceHours?: number
  maxAdvanceDays?: number
  allowSimultaneous?: boolean
}

export type TextBookingPrerequisites = {
  ready: boolean
  missing: string[]
  details: {
    hasGoogleCalendar: boolean
    hasCalendarConfig: boolean
    calendarId: string | null
    timezone: string
  }
}

export type AvailableSlot = {
  start: string
  end: string
  label: string
}

export type AvailabilityResult = {
  available: boolean
  slots: AvailableSlot[]
  dateRange: string
  timezone: string
  slotDurationMinutes: number
  message: string
}

export type BookingResult = {
  success: boolean
  eventId?: string
  eventLink?: string
  summary?: string
  error?: string
}

// =============================================================================
// CONSTANTS
// =============================================================================

const WEEKDAY_KEYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: 'Segunda',
  tue: 'Terça',
  wed: 'Quarta',
  thu: 'Quinta',
  fri: 'Sexta',
  sat: 'Sábado',
  sun: 'Domingo',
}

const DEFAULT_CONFIG: CalendarBookingConfig = {
  timezone: 'America/Sao_Paulo',
  slotDurationMinutes: 30,
  slotBufferMinutes: 10,
  workingHours: [
    { day: 'mon', enabled: true, start: '09:00', end: '18:00' },
    { day: 'tue', enabled: true, start: '09:00', end: '18:00' },
    { day: 'wed', enabled: true, start: '09:00', end: '18:00' },
    { day: 'thu', enabled: true, start: '09:00', end: '18:00' },
    { day: 'fri', enabled: true, start: '09:00', end: '18:00' },
    { day: 'sat', enabled: false, start: '09:00', end: '13:00' },
    { day: 'sun', enabled: false, start: '09:00', end: '13:00' },
  ],
  minAdvanceHours: 2,
  maxAdvanceDays: 14,
  allowSimultaneous: false,
}

const MAX_SLOTS_TO_SHOW = 15

// =============================================================================
// HELPERS
// =============================================================================

async function getCalendarBookingConfig(): Promise<CalendarBookingConfig> {
  if (!isSupabaseConfigured()) return DEFAULT_CONFIG
  const raw = await settingsDb.get('calendar_booking_config')
  if (!raw) return DEFAULT_CONFIG
  try {
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return DEFAULT_CONFIG
  }
}

async function getBookingServices(): Promise<Array<{ id: string; title: string; durationMinutes?: number }>> {
  const DEFAULT_SERVICES = [
    { id: 'consulta', title: 'Consulta', durationMinutes: 30 },
    { id: 'visita', title: 'Visita', durationMinutes: 60 },
    { id: 'suporte', title: 'Suporte', durationMinutes: 30 },
  ]
  if (!isSupabaseConfigured()) return DEFAULT_SERVICES
  const raw = await settingsDb.get('booking_services')
  if (!raw) return DEFAULT_SERVICES
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_SERVICES
    const normalized = parsed
      .map((opt: Record<string, unknown>) => ({
        id: typeof opt?.id === 'string' ? opt.id.trim() : String(opt?.id ?? '').trim(),
        title: typeof opt?.title === 'string' ? opt.title.trim() : String(opt?.title ?? '').trim(),
        ...(typeof opt?.durationMinutes === 'number' ? { durationMinutes: opt.durationMinutes } : {}),
      }))
      .filter((opt: { id: string; title: string }) => opt.id && opt.title)
    return normalized.length ? normalized : DEFAULT_SERVICES
  } catch {
    return DEFAULT_SERVICES
  }
}

function parseTimeToMinutes(value: string): number {
  const [hh, mm] = value.split(':').map(Number)
  return (hh || 0) * 60 + (mm || 0)
}

function isSlotInsideWorkingHours(
  start: Date,
  end: Date,
  timeZone: string,
  workingHours: WorkingHoursDay[]
): boolean {
  const isoDay = Number(formatInTimeZone(start, timeZone, 'i'))
  const dayKey = WEEKDAY_KEYS[isoDay - 1]
  const workingDay = workingHours.find((d) => d.day === dayKey)
  if (!workingDay || !workingDay.enabled) return false

  const startHM =
    Number(formatInTimeZone(start, timeZone, 'HH')) * 60 +
    Number(formatInTimeZone(start, timeZone, 'mm'))
  const endHM =
    Number(formatInTimeZone(end, timeZone, 'HH')) * 60 +
    Number(formatInTimeZone(end, timeZone, 'mm'))

  const windowStart = parseTimeToMinutes(workingDay.start)
  const windowEnd = parseTimeToMinutes(workingDay.end)

  // Ensure start and end are on the same calendar day
  const startDay = formatInTimeZone(start, timeZone, 'yyyy-MM-dd')
  const endDay = formatInTimeZone(end, timeZone, 'yyyy-MM-dd')
  if (startDay !== endDay) return false

  return startHM >= windowStart && endHM <= windowEnd
}

// =============================================================================
// PREREQUISITES CHECK
// =============================================================================

export async function checkTextBookingPrerequisites(): Promise<TextBookingPrerequisites> {
  const missing: string[] = []
  const details = {
    hasGoogleCalendar: false,
    hasCalendarConfig: false,
    calendarId: null as string | null,
    timezone: DEFAULT_CONFIG.timezone,
  }

  if (!isSupabaseConfigured()) {
    return { ready: false, missing: ['Supabase não configurado'], details }
  }

  try {
    // Check Google Calendar tokens
    const tokensRaw = await settingsDb.get('google_calendar_tokens')
    if (tokensRaw) {
      const tokens = JSON.parse(tokensRaw)
      details.hasGoogleCalendar = Boolean(tokens.accessToken || tokens.refreshToken)
    }
    if (!details.hasGoogleCalendar) {
      missing.push('Google Calendar não conectado')
    }

    // Check calendar config
    const calendarConfig = await getCalendarConfig()
    if (calendarConfig?.calendarId) {
      details.calendarId = calendarConfig.calendarId
      details.hasCalendarConfig = true
      details.timezone = calendarConfig.calendarTimeZone || DEFAULT_CONFIG.timezone
    } else {
      missing.push('Nenhum calendário selecionado')
    }
  } catch (error) {
    console.error('[calendar-text-booking] Error checking prerequisites:', error)
    missing.push('Erro ao verificar pré-requisitos')
  }

  return { ready: missing.length === 0, missing, details }
}

// =============================================================================
// CHECK AVAILABILITY
// =============================================================================

/**
 * Consulta slots disponíveis no Google Calendar e retorna como texto
 * para a IA apresentar ao cliente.
 *
 * @param daysAhead - Quantos dias à frente consultar (default: 7)
 * @param preferredDate - Data preferida pelo cliente (opcional, formato YYYY-MM-DD)
 */
export async function checkAvailability(params?: {
  daysAhead?: number
  preferredDate?: string
}): Promise<AvailabilityResult> {
  const prereqs = await checkTextBookingPrerequisites()

  if (!prereqs.ready || !prereqs.details.calendarId) {
    return {
      available: false,
      slots: [],
      dateRange: '',
      timezone: DEFAULT_CONFIG.timezone,
      slotDurationMinutes: DEFAULT_CONFIG.slotDurationMinutes,
      message: `Agendamento indisponível: ${prereqs.missing.join(', ')}`,
    }
  }

  const config = await getCalendarBookingConfig()
  const timeZone = prereqs.details.timezone || config.timezone

  const now = new Date()
  const minAdvanceMs = (config.minAdvanceHours || 2) * 60 * 60 * 1000
  const earliest = new Date(now.getTime() + minAdvanceMs)

  let start: Date
  let end: Date

  if (params?.preferredDate) {
    // Client asked for a specific date
    start = fromZonedTime(`${params.preferredDate}T00:00:00`, timeZone)
    if (start.getTime() < earliest.getTime()) {
      start = earliest
    }
    end = addDays(start, 1)
  } else {
    start = earliest
    const daysAhead = Math.min(params?.daysAhead || 7, config.maxAdvanceDays || 14)
    end = addDays(now, daysAhead)
  }

  try {
    const busyItems = await listBusyTimes({
      calendarId: prereqs.details.calendarId,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      timeZone,
    })

    const bufferMs = config.slotBufferMinutes * 60 * 1000
    const busy = busyItems.map((item) => ({
      startMs: new Date(item.start).getTime(),
      endMs: new Date(item.end).getTime(),
    }))

    const slots: AvailableSlot[] = []
    const slotMs = config.slotDurationMinutes * 60 * 1000
    let cursor = start

    while (cursor.getTime() + slotMs <= end.getTime() && slots.length < MAX_SLOTS_TO_SHOW) {
      const slotEnd = new Date(cursor.getTime() + slotMs)

      const insideWorkingHours = isSlotInsideWorkingHours(
        cursor,
        slotEnd,
        timeZone,
        config.workingHours
      )

      const overlaps = config.allowSimultaneous
        ? false
        : busy.some(
            (b) =>
              cursor.getTime() - bufferMs < b.endMs &&
              slotEnd.getTime() + bufferMs > b.startMs
          )

      if (insideWorkingHours && !overlaps) {
        const dayOfWeek = Number(formatInTimeZone(cursor, timeZone, 'i'))
        const dayLabel = WEEKDAY_LABELS[WEEKDAY_KEYS[dayOfWeek - 1]]
        const dateStr = formatInTimeZone(cursor, timeZone, 'dd/MM')
        const timeStr = formatInTimeZone(cursor, timeZone, 'HH:mm')
        const endTimeStr = formatInTimeZone(slotEnd, timeZone, 'HH:mm')

        slots.push({
          start: cursor.toISOString(),
          end: slotEnd.toISOString(),
          label: `${dayLabel} ${dateStr} às ${timeStr}–${endTimeStr}`,
        })
      }

      cursor = addMinutes(cursor, config.slotDurationMinutes)
    }

    const dateRangeStr = `${formatInTimeZone(start, timeZone, 'dd/MM')} a ${formatInTimeZone(end, timeZone, 'dd/MM')}`

    if (slots.length === 0) {
      return {
        available: false,
        slots: [],
        dateRange: dateRangeStr,
        timezone: timeZone,
        slotDurationMinutes: config.slotDurationMinutes,
        message: `Não encontrei horários disponíveis de ${dateRangeStr}. Posso verificar outras datas.`,
      }
    }

    // Group slots by day for a readable message
    const byDay = new Map<string, AvailableSlot[]>()
    for (const slot of slots) {
      const dayKey = formatInTimeZone(new Date(slot.start), timeZone, 'yyyy-MM-dd')
      if (!byDay.has(dayKey)) byDay.set(dayKey, [])
      byDay.get(dayKey)!.push(slot)
    }

    const lines: string[] = []
    for (const [, daySlots] of byDay) {
      const firstSlot = daySlots[0]
      const dayOfWeek = Number(formatInTimeZone(new Date(firstSlot.start), timeZone, 'i'))
      const dayLabel = WEEKDAY_LABELS[WEEKDAY_KEYS[dayOfWeek - 1]]
      const dateStr = formatInTimeZone(new Date(firstSlot.start), timeZone, 'dd/MM')

      const times = daySlots
        .map((s) => formatInTimeZone(new Date(s.start), timeZone, 'HH:mm'))
        .join(', ')
      lines.push(`${dayLabel} ${dateStr}: ${times}`)
    }

    return {
      available: true,
      slots,
      dateRange: dateRangeStr,
      timezone: timeZone,
      slotDurationMinutes: config.slotDurationMinutes,
      message: `Horários disponíveis (${dateRangeStr}):\n${lines.join('\n')}`,
    }
  } catch (error) {
    console.error('[calendar-text-booking] Error checking availability:', error)
    return {
      available: false,
      slots: [],
      dateRange: '',
      timezone: timeZone,
      slotDurationMinutes: config.slotDurationMinutes,
      message: 'Erro ao consultar disponibilidade. Tente novamente em instantes.',
    }
  }
}

// =============================================================================
// CONFIRM BOOKING
// =============================================================================

/**
 * Cria um evento no Google Calendar com os dados do agendamento.
 *
 * @param slotStart - ISO string do início do slot escolhido
 * @param customerName - Nome do cliente
 * @param customerPhone - Telefone do cliente
 * @param service - Tipo de serviço (opcional)
 * @param notes - Observações adicionais (opcional)
 */
export async function confirmBooking(params: {
  slotStart: string
  customerName: string
  customerPhone: string
  service?: string
  notes?: string
}): Promise<BookingResult> {
  const prereqs = await checkTextBookingPrerequisites()

  if (!prereqs.ready || !prereqs.details.calendarId) {
    return {
      success: false,
      error: `Agendamento indisponível: ${prereqs.missing.join(', ')}`,
    }
  }

  const config = await getCalendarBookingConfig()
  const timeZone = prereqs.details.timezone || config.timezone

  const slotStart = new Date(params.slotStart)
  if (isNaN(slotStart.getTime())) {
    return { success: false, error: 'Data/hora inválida para o agendamento.' }
  }

  // Determine duration based on service
  let durationMinutes = config.slotDurationMinutes
  if (params.service) {
    const services = await getBookingServices()
    const serviceInfo = services.find(
      (s) => s.id === params.service || s.title.toLowerCase() === params.service?.toLowerCase()
    )
    if (serviceInfo?.durationMinutes) {
      durationMinutes = serviceInfo.durationMinutes
    }
  }

  const slotEnd = addMinutes(slotStart, durationMinutes)

  // Double-check the slot is still available (skip if simultaneous bookings allowed)
  if (!config.allowSimultaneous) {
    try {
      const busyItems = await listBusyTimes({
        calendarId: prereqs.details.calendarId,
        timeMin: slotStart.toISOString(),
        timeMax: slotEnd.toISOString(),
        timeZone,
      })

      if (busyItems.length > 0) {
        return {
          success: false,
          error: 'Este horário acabou de ser ocupado. Por favor escolha outro horário.',
        }
      }
    } catch (error) {
      console.error('[calendar-text-booking] Error checking busy times:', error)
      return {
        success: false,
        error: 'Erro ao verificar disponibilidade. Tente novamente.',
      }
    }
  }

  // Build event summary
  const serviceName = params.service || 'Atendimento'
  const summary = `${serviceName} - ${params.customerName}`

  try {
    const event = await createEvent({
      calendarId: prereqs.details.calendarId,
      event: {
        summary,
        description: [
          `Cliente: ${params.customerName}`,
          `Telefone: ${params.customerPhone}`,
          params.notes ? `Observações: ${params.notes}` : null,
          '',
          'Agendado via WhatsApp (IA - SmartZap)',
        ]
          .filter(Boolean)
          .join('\n'),
        start: {
          dateTime: slotStart.toISOString(),
          timeZone,
        },
        end: {
          dateTime: slotEnd.toISOString(),
          timeZone,
        },
      },
    })

    const formattedDate = formatInTimeZone(slotStart, timeZone, 'dd/MM/yyyy')
    const formattedTime = formatInTimeZone(slotStart, timeZone, 'HH:mm')
    const formattedEndTime = formatInTimeZone(slotEnd, timeZone, 'HH:mm')

    console.log(`[calendar-text-booking] ✅ Event created: ${event.id} for ${params.customerPhone}`)

    return {
      success: true,
      eventId: event.id || 'created',
      eventLink: event.htmlLink,
      summary: `${serviceName} em ${formattedDate} às ${formattedTime}–${formattedEndTime}`,
    }
  } catch (error) {
    console.error('[calendar-text-booking] Error creating event:', error)
    return {
      success: false,
      error: 'Erro ao criar o agendamento. Tente novamente.',
    }
  }
}

// =============================================================================
// TOOL DESCRIPTIONS (for use with Vercel AI SDK)
// =============================================================================

export const CHECK_AVAILABILITY_DESCRIPTION = `Consulta horários disponíveis na agenda para agendamento.
Use esta ferramenta quando o cliente:
- Perguntar sobre disponibilidade de horários
- Quiser saber quando pode ser atendido
- Pedir para agendar algo (primeiro consulte disponibilidade)
- Mencionar uma data específica para ver horários

Parâmetros opcionais:
- daysAhead: quantos dias à frente consultar (padrão: 7)
- preferredDate: se o cliente mencionou uma data específica (formato YYYY-MM-DD)

Após receber os slots, apresente-os ao cliente de forma organizada e pergunte qual prefere.`

export const CONFIRM_BOOKING_DESCRIPTION = `Confirma e cria o agendamento no calendário.
Use esta ferramenta SOMENTE depois que:
1. Você já consultou a disponibilidade (checkAvailability)
2. O cliente escolheu um horário específico
3. Você tem o nome do cliente (pergunte se não tiver)

IMPORTANTE: O campo slotStart deve ser o ISO string exato de um dos slots retornados por checkAvailability.
NÃO invente horários - use apenas os que foram retornados.`
