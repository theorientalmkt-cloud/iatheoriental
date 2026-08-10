'use client'

import React from 'react'
import { Container } from '@/components/ui/container'
import { Cpu, Coins, MessageSquare, RefreshCw, ExternalLink, TrendingUp } from 'lucide-react'

interface Usage {
  periodoDias: number
  chamadas: number
  chamadasComErro: number
  taxaFailover: number
  chamadasSemTokens: number
  tokensInput: number
  tokensOutput: number
  tokensTotal: number
  custoUSD: number
  custoBRL: number
  custoDiaMedioUSD: number
  projecaoMensalUSD: number
  projecaoMensalBRL: number
  porModelo: Array<{ model: string; chamadas: number; tokensTotal: number; custoUSD: number; comPreco: boolean }>
  modelosSemPreco: string[]
  generatedAt: string
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString('pt-BR') : '0')
const brl = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const compact = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })

const AI_STUDIO_BILLING = 'https://aistudio.google.com/billing'

export const AIUsageCard: React.FC = () => {
  const [days, setDays] = React.useState(30)
  const [data, setData] = React.useState<Usage | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const fetchData = React.useCallback(async (d: number, refresh = false) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/ai-usage?days=${d}`)
      if (!res.ok) throw new Error('Falha ao carregar o uso da IA')
      setData((await res.json()) as Usage)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    fetchData(days, false)
  }, [fetchData, days])

  return (
    <Container variant="glass" padding="lg">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500/15 text-primary-500">
            <Cpu size={18} aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-heading-4">Uso da IA (Google)</h3>
            <p className="text-[11px] text-[var(--ds-text-muted)]">
              Custo estimado a partir dos tokens que registramos
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-[var(--ds-bg-hover)] p-0.5">
            {[7, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`text-[11px] px-2 py-1 rounded-md transition-colors ${
                  days === d ? 'bg-primary-600 text-white' : 'text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)]'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={() => fetchData(days, true)}
            disabled={refreshing || loading}
            aria-label="Atualizar"
            className="text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] transition-colors disabled:opacity-40"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-28 rounded-xl bg-[var(--ds-bg-hover)] animate-pulse" aria-hidden="true" />
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl bg-[var(--ds-bg-hover)] p-4">
              <div className="flex items-center gap-1.5 text-[var(--ds-text-muted)] text-[11px] mb-1">
                <MessageSquare size={13} aria-hidden="true" /> Chamadas
              </div>
              <p className="text-2xl font-semibold text-[var(--ds-text-primary)]">{fmt(data.chamadas)}</p>
              <p className="text-[11px] text-[var(--ds-text-muted)] mt-0.5">últimos {data.periodoDias} dias</p>
            </div>

            <div className="rounded-xl bg-[var(--ds-bg-hover)] p-4">
              <div className="flex items-center gap-1.5 text-[var(--ds-text-muted)] text-[11px] mb-1">
                <Cpu size={13} aria-hidden="true" /> Tokens
              </div>
              <p className="text-2xl font-semibold text-[var(--ds-text-primary)]">{compact(data.tokensTotal)}</p>
              <p className="text-[11px] text-[var(--ds-text-muted)] mt-0.5">
                {compact(data.tokensInput)} in · {compact(data.tokensOutput)} out
              </p>
            </div>

            <div className="rounded-xl bg-primary-500/10 p-4 ring-1 ring-primary-500/20">
              <div className="flex items-center gap-1.5 text-primary-500 text-[11px] mb-1">
                <Coins size={13} aria-hidden="true" /> Custo estimado
              </div>
              <p className="text-2xl font-semibold text-primary-500">{brl(data.custoBRL)}</p>
              <p className="text-[11px] text-[var(--ds-text-muted)] mt-0.5">≈ US$ {fmt(data.custoUSD)}</p>
            </div>
          </div>

          {data.tokensTotal === 0 && data.chamadas > 0 ? (
            <div className="mt-3 rounded-lg bg-amber-500/10 ring-1 ring-amber-500/20 px-3 py-2 text-[12px] text-amber-300/90">
              O registro de tokens <strong>começou agora</strong>. O custo aparece conforme as próximas
              conversas acontecem — as {fmt(data.chamadas)} chamada(s) anteriores não têm tokens salvos.
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-1.5 text-[12px] text-[var(--ds-text-secondary)]">
              <TrendingUp size={13} className="text-[var(--ds-text-muted)]" aria-hidden="true" />
              Projeção do mês: <strong className="text-[var(--ds-text-primary)]">{brl(data.projecaoMensalBRL)}</strong>
              <span className="text-[var(--ds-text-muted)]">(no ritmo atual)</span>
            </div>
          )}

          {data.porModelo.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {data.porModelo.slice(0, 5).map((m) => (
                <span
                  key={m.model}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-[var(--ds-bg-hover)] text-[var(--ds-text-secondary)]"
                  title={`${fmt(m.chamadas)} chamadas · ${compact(m.tokensTotal)} tokens`}
                >
                  {m.model}: {m.comPreco ? `US$ ${fmt(m.custoUSD)}` : 'sem preço'}
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-[11px] text-[var(--ds-text-muted)] max-w-md">
              Estimativa (~5% do real). {data.chamadasSemTokens > 0 && (
                <>{fmt(data.chamadasSemTokens)} chamada(s) antigas sem tokens registrados. </>
              )}
              O saldo verdadeiro fica no Google.
            </p>
            <a
              href={AI_STUDIO_BILLING}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-500 px-3 py-2 text-[12px] font-semibold transition-colors whitespace-nowrap"
            >
              Ver saldo real / abastecer <ExternalLink size={13} aria-hidden="true" />
            </a>
          </div>

          {data.modelosSemPreco.length > 0 && (
            <p className="mt-2 text-[11px] text-amber-400/80">
              Sem tabela de preço: {data.modelosSemPreco.join(', ')} (custo desses fica fora da estimativa).
            </p>
          )}
        </>
      ) : null}
    </Container>
  )
}
