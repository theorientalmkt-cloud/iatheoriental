/**
 * Uso e custo ESTIMADO da IA (Google/Gemini) a partir dos nossos logs
 * (ai_agent_logs). Custo é estimativa (tokens registrados × tabela de preços),
 * não o gasto oficial da conta Google. Ver lib/ai/model-pricing.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { estimateCostUSD, priceFor } from '@/lib/ai/model-pricing'
import { usdToBrl } from '@/lib/whatsapp-pricing'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const round = (n: number): number => Math.round(n * 10000) / 10000

interface LogRow {
  created_at: string
  model_used: string | null
  tokens_used: number | null
  error_message: string | null
  metadata: { failover?: boolean; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } } | null
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    if (!supabase) {
      return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 })
    }

    const url = new URL(request.url)
    const daysRaw = Number(url.searchParams.get('days'))
    const days = Math.max(1, Math.min(90, Number.isFinite(daysRaw) ? daysRaw : 30))
    const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString()

    // Pagina (evita o cap silencioso de 1000 linhas do Supabase).
    const PAGE = 1000
    const rows: LogRow[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('ai_agent_logs')
        .select('created_at, model_used, tokens_used, error_message, metadata')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1)
      if (error) throw error
      const batch = (data || []) as LogRow[]
      rows.push(...batch)
      if (batch.length < PAGE) break
    }

    const byModel = new Map<string, { model: string; chamadas: number; tokensInput: number; tokensOutput: number; tokensTotal: number; custoUSD: number; comPreco: boolean }>()
    const byDay = new Map<string, { data: string; chamadas: number; tokensTotal: number; custoUSD: number }>()
    const modelosSemPreco = new Set<string>()

    let chamadas = 0
    let chamadasComErro = 0
    let failovers = 0
    let chamadasSemTokens = 0
    let tokensInput = 0
    let tokensOutput = 0
    let tokensTotal = 0
    let custoUSD = 0

    for (const r of rows) {
      chamadas++
      if (r.error_message) chamadasComErro++
      if (r.metadata?.failover === true) failovers++

      const model = String(r.model_used || 'desconhecido')
      const u = r.metadata?.usage || {}
      const inT = Number(u.inputTokens ?? 0) || 0
      const outT = Number(u.outputTokens ?? 0) || 0
      const totT = Number(u.totalTokens ?? r.tokens_used ?? 0) || 0
      if (totT === 0) chamadasSemTokens++

      const c = estimateCostUSD(model, inT, outT)
      const cost = c ?? 0
      if (c === null && (inT > 0 || outT > 0 || totT > 0)) modelosSemPreco.add(model)

      tokensInput += inT
      tokensOutput += outT
      tokensTotal += totT
      custoUSD += cost

      const m = byModel.get(model) || { model, chamadas: 0, tokensInput: 0, tokensOutput: 0, tokensTotal: 0, custoUSD: 0, comPreco: priceFor(model) !== null }
      m.chamadas++
      m.tokensInput += inT
      m.tokensOutput += outT
      m.tokensTotal += totT
      m.custoUSD += cost
      byModel.set(model, m)

      const day = r.created_at.slice(0, 10)
      const d = byDay.get(day) || { data: day, chamadas: 0, tokensTotal: 0, custoUSD: 0 }
      d.chamadas++
      d.tokensTotal += totT
      d.custoUSD += cost
      byDay.set(day, d)
    }

    const custoDiaMedioUSD = days > 0 ? custoUSD / days : 0
    const projecaoMensalUSD = custoDiaMedioUSD * 30

    return NextResponse.json(
      {
        periodoDias: days,
        chamadas,
        chamadasComErro,
        taxaFailover: chamadas ? failovers / chamadas : 0,
        chamadasSemTokens,
        tokensInput,
        tokensOutput,
        tokensTotal,
        custoUSD: round(custoUSD),
        custoBRL: round(usdToBrl(custoUSD)),
        custoDiaMedioUSD: round(custoDiaMedioUSD),
        projecaoMensalUSD: round(projecaoMensalUSD),
        projecaoMensalBRL: round(usdToBrl(projecaoMensalUSD)),
        porModelo: Array.from(byModel.values())
          .map((m) => ({ ...m, custoUSD: round(m.custoUSD) }))
          .sort((a, b) => b.custoUSD - a.custoUSD || b.chamadas - a.chamadas),
        porDia: Array.from(byDay.values())
          .map((d) => ({ ...d, custoUSD: round(d.custoUSD) }))
          .sort((a, b) => a.data.localeCompare(b.data)),
        modelosSemPreco: Array.from(modelosSemPreco),
        generatedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0' } }
    )
  } catch (e) {
    console.error('[ai-usage] Falha:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Falha ao calcular uso da IA' }, { status: 500 })
  }
}
