/**
 * Card B — Resumo semanal de agendamentos
 *
 * Lê os eventos do Google Calendar dos próximos 7 dias e gera um resumo via IA.
 * Opção 1 (decidida com o cliente): lista TODOS os agendamentos da semana, sem
 * separar "pendente/confirmado" — esse status ainda não existe nos dados
 * (depende da feature de pagamento/Calendar Sync, não implementada).
 *
 * Cache de 1h em `settings` (?refresh=1 força regenerar).
 */

import { NextRequest, NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'
import { getCalendarConfig, listEvents, type GoogleCalendarEvent } from '@/lib/google-calendar'
import { generateText } from '@/lib/ai/unified-ai-service'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { addDays } from 'date-fns'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TZ = 'America/Sao_Paulo'
const CACHE_KEY = 'dashboard_bookings_summary_cache'
const TTL_MS = 60 * 60 * 1000

interface BookingItem {
  titulo: string
  dataLabel: string // ex: "Sáb 28/06 19:00"
}

interface BookingsResult {
  connected: boolean
  message?: string
  summary: string
  total: number
  porDia: Array<{ dia: string; qtd: number }>
  proximos: BookingItem[]
  rangeLabel: string
  generatedAt: string
  model: string
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function eventStartDate(ev: GoogleCalendarEvent): Date | null {
  const dt = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00` : null)
  if (!dt) return null
  const d = new Date(dt)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function GET(request: NextRequest) {
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1'

  // 1) Cache
  if (!forceRefresh) {
    try {
      const raw = await settingsDb.get(CACHE_KEY)
      if (raw) {
        const cached = (typeof raw === 'string' ? JSON.parse(raw) : raw) as BookingsResult
        const age = Date.now() - new Date(cached.generatedAt).getTime()
        if (age < TTL_MS) return NextResponse.json({ ...cached, cached: true })
      }
    } catch {
      // segue gerando
    }
  }

  // 2) Calendar conectado?
  const config = await getCalendarConfig()
  if (!config?.calendarId) {
    return NextResponse.json({
      connected: false,
      message: 'Google Calendar não conectado. Conecte em Configurações → Integrações.',
      summary: '',
      total: 0,
      porDia: [],
      proximos: [],
      rangeLabel: '',
      generatedAt: new Date().toISOString(),
      model: 'none',
    } satisfies BookingsResult)
  }

  const timeZone = config.calendarTimeZone || TZ
  const day0 = formatInTimeZone(new Date(), timeZone, 'yyyy-MM-dd')
  const timeMin = fromZonedTime(`${day0}T00:00:00`, timeZone).toISOString()
  const timeMax = addDays(new Date(timeMin), 7).toISOString()
  const rangeLabel = `${formatInTimeZone(new Date(timeMin), timeZone, 'dd/MM')} a ${formatInTimeZone(new Date(timeMax), timeZone, 'dd/MM')}`

  // 3) Lê eventos da semana
  let events: GoogleCalendarEvent[] = []
  try {
    events = await listEvents({ calendarId: config.calendarId, timeMin, timeMax, timeZone })
  } catch (e) {
    return NextResponse.json({
      connected: true,
      message: 'Não foi possível ler a agenda do Google Calendar agora.',
      summary: '',
      total: 0,
      porDia: [],
      proximos: [],
      rangeLabel,
      generatedAt: new Date().toISOString(),
      model: 'none',
    } satisfies BookingsResult, { status: 200 })
  }

  // ignora eventos cancelados
  const ativos = events.filter((e) => e.status !== 'cancelled' && eventStartDate(e))

  // por dia + lista dos próximos
  const porDiaMap = new Map<string, number>()
  const proximos: BookingItem[] = []
  const linhasParaIA: string[] = []

  for (const ev of ativos) {
    const d = eventStartDate(ev)!
    const diaKey = formatInTimeZone(d, timeZone, 'yyyy-MM-dd')
    porDiaMap.set(diaKey, (porDiaMap.get(diaKey) || 0) + 1)

    const wd = WEEKDAYS[Number(formatInTimeZone(d, timeZone, 'i')) % 7]
    const allDay = !ev.start?.dateTime
    const hora = allDay ? 'dia todo' : formatInTimeZone(d, timeZone, 'HH:mm')
    const dataLabel = `${wd} ${formatInTimeZone(d, timeZone, 'dd/MM')} ${hora}`
    const titulo = (ev.summary || 'Agendamento').trim()
    proximos.push({ titulo, dataLabel })
    linhasParaIA.push(`- ${dataLabel} — ${titulo}`)
  }

  const porDia = Array.from(porDiaMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dia, qtd]) => {
      const d = new Date(`${dia}T00:00:00`)
      const wd = WEEKDAYS[Number(formatInTimeZone(fromZonedTime(`${dia}T12:00:00`, timeZone), timeZone, 'i')) % 7]
      return { dia: `${wd} ${formatInTimeZone(d, timeZone, 'dd/MM')}`, qtd }
    })

  const total = ativos.length

  // 4) Sem agendamentos → resposta direta
  if (total === 0) {
    const result: BookingsResult = {
      connected: true,
      summary: `Nenhum agendamento na agenda para os próximos 7 dias (${rangeLabel}).`,
      total: 0,
      porDia: [],
      proximos: [],
      rangeLabel,
      generatedAt: new Date().toISOString(),
      model: 'none',
    }
    try { await settingsDb.set(CACHE_KEY, JSON.stringify(result)) } catch {}
    return NextResponse.json({ ...result, cached: false })
  }

  // 5) Resumo via IA
  const system = `Você é o assistente de operações do restaurante japonês The Oriental Sushiya.
Gere um RESUMO SEMANAL dos agendamentos (reservas) para o gestor, em português brasileiro.
Regras:
- Seja conciso e factual. NÃO invente nada além do que está na lista.
- 1 parágrafo curto de panorama (ex.: total da semana, dias mais cheios).
- Depois 2 a 5 bullets de destaques (dias com mais reservas, horários de pico, observações).
- NÃO exponha telefones nem dados pessoais sensíveis.
- Observação: o sistema ainda não distingue "pendente" de "confirmado"; trate como "agendamentos".`

  const prompt = `Agendamentos dos próximos 7 dias (${rangeLabel}) — total ${total}:
${linhasParaIA.slice(0, 120).join('\n')}

Gere o resumo semanal.`

  let summary = ''
  let model = 'none'
  try {
    const ai = await generateText({ system, prompt, temperature: 0.4, maxOutputTokens: 600 })
    summary = (ai.text || '').trim()
    model = ai.model
    if (model === 'fallback-none' || model === 'error-fallback' || !summary) {
      summary = `Você tem ${total} agendamento(s) nos próximos 7 dias (${rangeLabel}). (Resumo da IA indisponível — verifique a chave em Configurações → IA.)`
    }
  } catch (e) {
    summary = `Você tem ${total} agendamento(s) nos próximos 7 dias (${rangeLabel}).`
    console.error('[dashboard/bookings-summary] erro IA:', e)
  }

  const result: BookingsResult = {
    connected: true,
    summary,
    total,
    porDia,
    proximos: proximos.slice(0, 12),
    rangeLabel,
    generatedAt: new Date().toISOString(),
    model,
  }

  try { await settingsDb.set(CACHE_KEY, JSON.stringify(result)) } catch {}
  return NextResponse.json({ ...result, cached: false })
}
