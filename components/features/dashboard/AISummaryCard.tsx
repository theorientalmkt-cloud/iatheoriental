'use client'

import React from 'react'
import { Container } from '@/components/ui/container'
import { Sparkles, RefreshCw, Bot, UserRound, Clock, MailWarning } from 'lucide-react'

interface DailySummaryStats {
  totalAtivasHoje: number
  novasHoje: number
  emBot: number
  emHumano: number
  aguardandoHumano: number
  naoLidas: number
  mensagensRecebidasHoje: number
}

interface SummaryResponse {
  summary: string
  stats: DailySummaryStats
  generatedAt: string
  model: string
  cached?: boolean
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

const StatChip: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="flex flex-col rounded-lg bg-[var(--ds-bg-hover)] px-3 py-2 min-w-[84px]">
    <span className="text-lg font-semibold text-[var(--ds-text-primary)] tabular-nums">{value}</span>
    <span className="text-[11px] text-[var(--ds-text-muted)] leading-tight">{label}</span>
  </div>
)

export const AISummaryCard: React.FC = () => {
  const [data, setData] = React.useState<SummaryResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const fetchSummary = React.useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/ai-summary${refresh ? '?refresh=1' : ''}`)
      if (!res.ok) throw new Error('Falha ao carregar o resumo')
      const json = (await res.json()) as SummaryResponse
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar resumo')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    fetchSummary(false)
  }, [fetchSummary])

  return (
    <Container variant="glass" padding="lg">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500/15 text-primary-500">
            <Sparkles size={18} aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-heading-4">Resumo do dia</h3>
            <p className="text-[11px] text-[var(--ds-text-muted)]">
              {data
                ? `Atualizado ${timeAgo(data.generatedAt)}${data.model && data.model !== 'none' ? ` · ${data.model}` : ''}`
                : 'Gerado por IA a partir das conversas de hoje'}
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchSummary(true)}
          disabled={refreshing || loading}
          aria-label="Atualizar resumo"
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
          Atualizar
        </button>
      </div>

      {/* Mini-stats */}
      {data && (
        <div className="flex flex-wrap gap-2 mb-5">
          <StatChip label="Ativas hoje" value={data.stats.totalAtivasHoje} />
          <StatChip label="Novas" value={data.stats.novasHoje} />
          <StatChip label="Com a IA" value={data.stats.emBot} />
          <StatChip label="Com humano" value={data.stats.emHumano} />
          <StatChip label="Aguardando" value={data.stats.aguardandoHumano} />
          <StatChip label="Não lidas" value={data.stats.naoLidas} />
        </div>
      )}

      {/* Resumo */}
      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          <div className="h-4 w-full rounded bg-[var(--ds-bg-hover)] animate-pulse" />
          <div className="h-4 w-11/12 rounded bg-[var(--ds-bg-hover)] animate-pulse" />
          <div className="h-4 w-4/5 rounded bg-[var(--ds-bg-hover)] animate-pulse" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-sm text-red-500">
          <MailWarning size={16} aria-hidden="true" />
          {error}
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-[var(--ds-text-secondary)] whitespace-pre-wrap">
          {data?.summary}
        </p>
      )}

      {/* Rodapé com ícones contextuais */}
      {data && !loading && !error && (
        <div className="flex flex-wrap gap-4 mt-5 pt-4 border-t border-[var(--ds-border-subtle)] text-[11px] text-[var(--ds-text-muted)]">
          <span className="flex items-center gap-1.5"><Bot size={13} /> {data.stats.emBot} na IA</span>
          <span className="flex items-center gap-1.5"><UserRound size={13} /> {data.stats.emHumano} com humano</span>
          <span className="flex items-center gap-1.5"><Clock size={13} /> {data.stats.aguardandoHumano} aguardando atendente</span>
        </div>
      )}
    </Container>
  )
}
