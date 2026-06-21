/**
 * Card A — Panorama do dia (IA)
 *
 * Agrega as conversas do dia (inbox) e gera um resumo em linguagem natural
 * via Gemini. Resultado é cacheado em `settings` por 1h para não chamar a IA
 * a cada carregamento do dashboard. `?refresh=1` força regenerar.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { settingsDb } from '@/lib/supabase-db'
import { generateText } from '@/lib/ai/unified-ai-service'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TZ = 'America/Sao_Paulo'
const CACHE_KEY = 'dashboard_ai_summary_cache'
const TTL_MS = 60 * 60 * 1000 // 1 hora
const MAX_MESSAGES_FOR_AI = 120

interface DailySummaryStats {
  totalAtivasHoje: number
  novasHoje: number
  emBot: number
  emHumano: number
  aguardandoHumano: number
  naoLidas: number
  mensagensRecebidasHoje: number
}

interface CachedSummary {
  summary: string
  stats: DailySummaryStats
  generatedAt: string
  model: string
  day: string
}

function startOfTodayIso(): { iso: string; day: string } {
  const day = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const iso = fromZonedTime(`${day}T00:00:00`, TZ).toISOString()
  return { iso, day }
}

export async function GET(request: NextRequest) {
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1'
  const { iso: startIso, day } = startOfTodayIso()

  // 1) Cache (settings) — evita chamar a IA a cada load do dashboard
  if (!forceRefresh) {
    try {
      const raw = await settingsDb.get(CACHE_KEY)
      if (raw) {
        const cached = (typeof raw === 'string' ? JSON.parse(raw) : raw) as CachedSummary
        const age = Date.now() - new Date(cached.generatedAt).getTime()
        if (cached.day === day && age < TTL_MS) {
          return NextResponse.json({ ...cached, cached: true })
        }
      }
    } catch {
      // cache inválido — segue gerando
    }
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 })
  }

  // 2) Conversas ativas hoje (last_message_at >= início do dia)
  const { data: convs, error: convErr } = await supabase
    .from('inbox_conversations')
    .select('mode, status, priority, handoff_summary, unread_count, created_at, last_message_at, last_message_preview')
    .gte('last_message_at', startIso)

  if (convErr) {
    return NextResponse.json({ error: convErr.message }, { status: 500 })
  }

  const rows = convs || []
  const stats: DailySummaryStats = {
    totalAtivasHoje: rows.length,
    novasHoje: rows.filter((c) => c.created_at && c.created_at >= startIso).length,
    emBot: rows.filter((c) => c.mode === 'bot').length,
    emHumano: rows.filter((c) => c.mode === 'human').length,
    aguardandoHumano: rows.filter(
      (c) => (c.priority === 'urgent' && c.mode === 'bot') || (c.handoff_summary && c.mode === 'bot')
    ).length,
    naoLidas: rows.reduce((sum, c) => sum + (c.unread_count || 0), 0),
    mensagensRecebidasHoje: 0,
  }

  // 3) Mensagens recebidas hoje (para a IA identificar temas)
  const { data: msgs } = await supabase
    .from('inbox_messages')
    .select('content, created_at')
    .eq('direction', 'inbound')
    .gte('created_at', startIso)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES_FOR_AI)

  const messages = msgs || []
  stats.mensagensRecebidasHoje = messages.length

  // 4) Sem atividade hoje → resposta direta (não gasta IA)
  if (stats.totalAtivasHoje === 0 && stats.mensagensRecebidasHoje === 0) {
    const result: CachedSummary = {
      summary: 'Nenhuma conversa registrada hoje ainda.',
      stats,
      generatedAt: new Date().toISOString(),
      model: 'none',
      day,
    }
    try {
      await settingsDb.set(CACHE_KEY, JSON.stringify(result))
    } catch {}
    return NextResponse.json({ ...result, cached: false })
  }

  // 5) Monta contexto e chama a IA
  const snippets = messages
    .map((m) => (m.content || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, MAX_MESSAGES_FOR_AI)
    .map((t) => `- ${t.slice(0, 200)}`)
    .join('\n')

  const system = `Você é um analista de atendimento do restaurante japonês The Oriental Sushiya.
Gere um RESUMO objetivo do dia de atendimento via WhatsApp, em português brasileiro, para o gestor ler rapidamente.
Regras:
- Seja conciso e factual. NÃO invente dados que não estão no contexto.
- Comece com 1 parágrafo curto (2-3 frases) de panorama geral.
- Depois liste de 3 a 6 destaques em bullets (ex.: pedidos de reserva, dúvidas frequentes, reclamações, clientes aguardando atendente).
- Não exponha telefones nem dados pessoais.
- Tom profissional e direto.`

  const prompt = `Dados de hoje (${formatInTimeZone(new Date(), TZ, 'dd/MM/yyyy')}):
- Conversas ativas hoje: ${stats.totalAtivasHoje}
- Novas conversas: ${stats.novasHoje}
- Em atendimento pela IA (bot): ${stats.emBot}
- Em atendimento humano: ${stats.emHumano}
- Aguardando atendente humano: ${stats.aguardandoHumano}
- Mensagens não lidas: ${stats.naoLidas}
- Mensagens recebidas hoje (amostra): ${stats.mensagensRecebidasHoje}

Amostra das mensagens recebidas dos clientes hoje:
${snippets || '(sem mensagens de texto)'}

Gere o resumo do dia.`

  let summary = ''
  let model = 'none'
  try {
    const ai = await generateText({ system, prompt, temperature: 0.4, maxOutputTokens: 600 })
    summary = (ai.text || '').trim()
    model = ai.model
    if (model === 'fallback-none' || model === 'error-fallback' || !summary) {
      summary = 'Não foi possível gerar o resumo da IA (verifique a configuração da chave em Configurações → IA). Os números acima continuam válidos.'
    }
  } catch (e) {
    summary = 'Erro ao gerar o resumo da IA. Os números acima continuam válidos.'
    console.error('[dashboard/ai-summary] erro ao gerar resumo:', e)
  }

  const result: CachedSummary = {
    summary,
    stats,
    generatedAt: new Date().toISOString(),
    model,
    day,
  }

  try {
    await settingsDb.set(CACHE_KEY, JSON.stringify(result))
  } catch {}

  return NextResponse.json({ ...result, cached: false })
}
