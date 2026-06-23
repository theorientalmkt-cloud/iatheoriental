/**
 * Card B — Resumo semanal de agendamentos (Reservas internas)
 *
 * Agora lê da tabela `reservations` (calendário interno), NÃO mais do Google Calendar.
 * O CÓDIGO faz a contagem exata (pessoas por local × data × status); a IA apenas
 * narra os números prontos — assim ela nunca erra a conta.
 *
 * Janela: próximos 7 dias. Cache de 1h em `settings` (?refresh=1 força regenerar).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { settingsDb } from '@/lib/supabase-db'
import { generateText } from '@/lib/ai/unified-ai-service'
import { formatInTimeZone } from 'date-fns-tz'
import { addDays } from 'date-fns'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TZ = 'America/Sao_Paulo'
const CACHE_KEY = 'dashboard_bookings_summary_cache'
const TTL_MS = 60 * 60 * 1000
const WEEKDAYS_ISO: Record<number, string> = { 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb', 7: 'Dom' }
const CANCELLED = new Set(['cancelado', 'no_show'])

interface LocationAgg { local: string; reservas: number; pessoas: number }
interface DayAgg { dia: string; data: string; reservas: number; pessoas: number; porLocal: LocationAgg[] }
interface ProxItem { dataLabel: string; local: string; pessoas: number; titulo: string; status: string }

interface BookingsResult {
  summary: string
  total: number
  totalPessoas: number
  porStatus: Array<{ status: string; qtd: number }>
  porDia: DayAgg[]
  proximos: ProxItem[]
  rangeLabel: string
  generatedAt: string
  model: string
}

function weekdayLabel(dateStr: string): string {
  const iso = Number(formatInTimeZone(new Date(`${dateStr}T12:00:00`), TZ, 'i'))
  return WEEKDAYS_ISO[iso] || ''
}
function ddmm(dateStr: string): string {
  return formatInTimeZone(new Date(`${dateStr}T12:00:00`), TZ, 'dd/MM')
}

export async function GET(request: NextRequest) {
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1'

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

  const supabase = getSupabaseAdmin()
  if (!supabase) return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 })

  const today = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const end = formatInTimeZone(addDays(new Date(`${today}T12:00:00`), 7), TZ, 'yyyy-MM-dd')
  const rangeLabel = `${ddmm(today)} a ${ddmm(end)}`

  const { data, error } = await supabase
    .from('reservations')
    .select('reservation_date, reservation_time, location, party_size, guest_name, menu_choice, status')
    .gte('reservation_date', today)
    .lte('reservation_date', end)
    .order('reservation_date', { ascending: true })
    .order('reservation_time', { ascending: true })
    .limit(5000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data || []
  const ativas = rows.filter((r) => !CANCELLED.has(String(r.status || '').toLowerCase()))

  // Agregação EXATA (no código)
  const statusMap = new Map<string, number>()
  const dayMap = new Map<string, { reservas: number; pessoas: number; locais: Map<string, LocationAgg> }>()
  let totalPessoas = 0

  for (const r of rows) {
    const st = String(r.status || 'pendente').toLowerCase()
    statusMap.set(st, (statusMap.get(st) || 0) + 1)
  }

  for (const r of ativas) {
    const date = r.reservation_date as string
    const pessoas = Number(r.party_size) || 0
    const local = (r.location && String(r.location).trim()) || 'Sem local'
    totalPessoas += pessoas

    if (!dayMap.has(date)) dayMap.set(date, { reservas: 0, pessoas: 0, locais: new Map() })
    const d = dayMap.get(date)!
    d.reservas += 1
    d.pessoas += pessoas
    if (!d.locais.has(local)) d.locais.set(local, { local, reservas: 0, pessoas: 0 })
    const l = d.locais.get(local)!
    l.reservas += 1
    l.pessoas += pessoas
  }

  const porDia: DayAgg[] = Array.from(dayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, agg]) => ({
      data: date,
      dia: `${weekdayLabel(date)} ${ddmm(date)}`,
      reservas: agg.reservas,
      pessoas: agg.pessoas,
      porLocal: Array.from(agg.locais.values()).sort((a, b) => b.pessoas - a.pessoas),
    }))

  const porStatus = Array.from(statusMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([status, qtd]) => ({ status, qtd }))

  const proximos: ProxItem[] = ativas.slice(0, 12).map((r) => ({
    dataLabel: `${weekdayLabel(r.reservation_date as string)} ${ddmm(r.reservation_date as string)}${r.reservation_time ? ` ${r.reservation_time}` : ''}`,
    local: (r.location && String(r.location).trim()) || '—',
    pessoas: Number(r.party_size) || 0,
    titulo: (r.guest_name && String(r.guest_name).trim()) || 'Reserva',
    status: String(r.status || 'pendente'),
  }))

  const total = ativas.length

  if (total === 0) {
    const result: BookingsResult = {
      summary: `Nenhuma reserva para os próximos 7 dias (${rangeLabel}).`,
      total: 0,
      totalPessoas: 0,
      porStatus,
      porDia: [],
      proximos: [],
      rangeLabel,
      generatedAt: new Date().toISOString(),
      model: 'none',
    }
    try { await settingsDb.set(CACHE_KEY, JSON.stringify(result)) } catch {}
    return NextResponse.json({ ...result, cached: false })
  }

  // Contexto EXATO para a IA narrar (ela não conta — só escreve)
  const linhas = porDia
    .map((d) => {
      const locais = d.porLocal.map((l) => `${l.local}: ${l.pessoas} pessoas (${l.reservas} reservas)`).join(' · ')
      return `${d.dia} → ${d.pessoas} pessoas / ${d.reservas} reservas — ${locais}`
    })
    .join('\n')
  const statusLinha = porStatus.map((s) => `${s.status}: ${s.qtd}`).join(', ')

  const system = `Você é o assistente de operações do restaurante japonês The Oriental Sushiya.
Escreva um RESUMO SEMANAL das reservas para o gestor, em português brasileiro.
Regras IMPORTANTES:
- Os números abaixo já estão calculados e CORRETOS. Use-os exatamente como estão. NÃO recalcule, NÃO some, NÃO invente.
- 1 parágrafo curto de panorama (total de pessoas e reservas na semana, dia mais cheio).
- Depois 2 a 4 bullets de destaques (dias/locais com mais gente, pendências de confirmação).
- Não exponha telefones.`

  const prompt = `Reservas dos próximos 7 dias (${rangeLabel}):
- Total: ${totalPessoas} pessoas em ${total} reservas
- Por status: ${statusLinha}
- Detalhe por dia e local:
${linhas}

Escreva o resumo usando exatamente esses números.`

  let summary = ''
  let model = 'none'
  try {
    const ai = await generateText({ system, prompt, temperature: 0.3, maxOutputTokens: 600 })
    summary = (ai.text || '').trim()
    model = ai.model
    if (model === 'fallback-none' || model === 'error-fallback' || !summary) {
      summary = `${totalPessoas} pessoas em ${total} reservas nos próximos 7 dias (${rangeLabel}). (Resumo da IA indisponível — verifique a chave em Configurações → IA.)`
    }
  } catch (e) {
    summary = `${totalPessoas} pessoas em ${total} reservas nos próximos 7 dias (${rangeLabel}).`
    console.error('[dashboard/bookings-summary] erro IA:', e)
  }

  const result: BookingsResult = {
    summary,
    total,
    totalPessoas,
    porStatus,
    porDia,
    proximos,
    rangeLabel,
    generatedAt: new Date().toISOString(),
    model,
  }

  try { await settingsDb.set(CACHE_KEY, JSON.stringify(result)) } catch {}
  return NextResponse.json({ ...result, cached: false })
}
