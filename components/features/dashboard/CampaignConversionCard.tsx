'use client'

import React from 'react'
import { Container } from '@/components/ui/container'
import { Send, CalendarCheck, TrendingUp, RefreshCw } from 'lucide-react'

interface ConversionResponse {
  mensagensEnviadas: number
  reservasIA: number
  reservasIAAtivas: number
  pessoasIA: number
  taxaConversao: number
  porStatus: Array<{ status: string; qtd: number }>
  generatedAt: string
}

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendentes',
  confirmado: 'Confirmadas',
  cancelado: 'Canceladas',
  no_show: 'No-show',
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString('pt-BR') : '0')

export const CampaignConversionCard: React.FC = () => {
  const [data, setData] = React.useState<ConversionResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const fetchData = React.useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/dashboard/campaign-conversion')
      if (!res.ok) throw new Error('Falha ao carregar a métrica')
      setData((await res.json()) as ConversionResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    fetchData(false)
  }, [fetchData])

  return (
    <Container variant="glass" padding="lg">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500/15 text-primary-500">
            <TrendingUp size={18} aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-heading-4">Campanhas → Reservas</h3>
            <p className="text-[11px] text-[var(--ds-text-muted)]">
              Quantas mensagens viraram reserva pela IA
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing || loading}
          aria-label="Atualizar métrica"
          className="text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] transition-colors disabled:opacity-40"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
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
                <Send size={13} aria-hidden="true" /> Mensagens enviadas
              </div>
              <p className="text-2xl font-semibold text-[var(--ds-text-primary)]">{fmt(data.mensagensEnviadas)}</p>
              <p className="text-[11px] text-[var(--ds-text-muted)] mt-0.5">em campanhas</p>
            </div>

            <div className="rounded-xl bg-[var(--ds-bg-hover)] p-4">
              <div className="flex items-center gap-1.5 text-[var(--ds-text-muted)] text-[11px] mb-1">
                <CalendarCheck size={13} aria-hidden="true" /> Reservas pela IA
              </div>
              <p className="text-2xl font-semibold text-[var(--ds-text-primary)]">{fmt(data.reservasIA)}</p>
              <p className="text-[11px] text-[var(--ds-text-muted)] mt-0.5">
                {fmt(data.reservasIAAtivas)} ativas · {fmt(data.pessoasIA)} pessoas
              </p>
            </div>

            <div className="rounded-xl bg-primary-500/10 p-4 ring-1 ring-primary-500/20">
              <div className="flex items-center gap-1.5 text-primary-500 text-[11px] mb-1">
                <TrendingUp size={13} aria-hidden="true" /> Taxa de conversão
              </div>
              <p className="text-2xl font-semibold text-primary-500">{fmt(data.taxaConversao)}%</p>
              <p className="text-[11px] text-[var(--ds-text-muted)] mt-0.5">reservas ÷ mensagens</p>
            </div>
          </div>

          {data.porStatus.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {data.porStatus.map((s) => (
                <span
                  key={s.status}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-[var(--ds-bg-hover)] text-[var(--ds-text-secondary)]"
                >
                  {STATUS_LABEL[s.status] || s.status}: {fmt(s.qtd)}
                </span>
              ))}
            </div>
          )}

          <p className="mt-3 text-[11px] text-[var(--ds-text-muted)]">
            Indicador geral (total de reservas da IA sobre o total de mensagens de campanha).
          </p>
        </>
      ) : null}
    </Container>
  )
}
