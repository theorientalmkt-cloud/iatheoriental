'use client'

import React from 'react'
import { Container } from '@/components/ui/container'
import { CalendarDays, RefreshCw, Clock, MailWarning, CalendarX } from 'lucide-react'

interface BookingItem {
  titulo: string
  dataLabel: string
}

interface BookingsResponse {
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

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

export const BookingsSummaryCard: React.FC = () => {
  const [data, setData] = React.useState<BookingsResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const fetchData = React.useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/bookings-summary${refresh ? '?refresh=1' : ''}`)
      if (!res.ok) throw new Error('Falha ao carregar agendamentos')
      setData((await res.json()) as BookingsResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar agendamentos')
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
            <CalendarDays size={18} aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-heading-4">Agendamentos da semana</h3>
            <p className="text-[11px] text-[var(--ds-text-muted)]">
              {data?.connected && data.rangeLabel
                ? `Próximos 7 dias (${data.rangeLabel})${data.generatedAt ? ` · atualizado ${timeAgo(data.generatedAt)}` : ''}`
                : 'Resumo dos agendamentos do Google Calendar'}
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing || loading}
          aria-label="Atualizar agendamentos"
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
          Atualizar
        </button>
      </div>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          <div className="h-4 w-full rounded bg-[var(--ds-bg-hover)] animate-pulse" />
          <div className="h-4 w-10/12 rounded bg-[var(--ds-bg-hover)] animate-pulse" />
          <div className="h-4 w-3/5 rounded bg-[var(--ds-bg-hover)] animate-pulse" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-sm text-red-500">
          <MailWarning size={16} aria-hidden="true" /> {error}
        </div>
      ) : data && !data.connected ? (
        <div className="flex items-center gap-2 text-sm text-[var(--ds-text-muted)]">
          <CalendarX size={16} aria-hidden="true" /> {data.message || 'Google Calendar não conectado.'}
        </div>
      ) : data ? (
        <>
          {/* total + por dia */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex flex-col rounded-lg bg-primary-500/10 px-3 py-2 min-w-[84px]">
              <span className="text-lg font-semibold text-primary-500 tabular-nums">{data.total}</span>
              <span className="text-[11px] text-[var(--ds-text-muted)] leading-tight">na semana</span>
            </div>
            {data.porDia.map((d) => (
              <div key={d.dia} className="flex flex-col rounded-lg bg-[var(--ds-bg-hover)] px-3 py-2 min-w-[72px]">
                <span className="text-base font-semibold text-[var(--ds-text-primary)] tabular-nums">{d.qtd}</span>
                <span className="text-[11px] text-[var(--ds-text-muted)] leading-tight">{d.dia}</span>
              </div>
            ))}
          </div>

          {/* resumo IA */}
          <p className="text-sm leading-relaxed text-[var(--ds-text-secondary)] whitespace-pre-wrap">
            {data.summary}
          </p>

          {/* próximos agendamentos */}
          {data.proximos.length > 0 && (
            <div className="mt-5 pt-4 border-t border-[var(--ds-border-subtle)]">
              <p className="text-[11px] uppercase tracking-wide text-[var(--ds-text-muted)] mb-2">Próximos</p>
              <ul className="space-y-1.5">
                {data.proximos.map((b, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-[var(--ds-text-secondary)]">
                    <Clock size={13} className="text-[var(--ds-text-muted)] shrink-0" aria-hidden="true" />
                    <span className="text-[var(--ds-text-muted)] tabular-nums w-[120px] shrink-0">{b.dataLabel}</span>
                    <span className="truncate">{b.titulo}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : null}
    </Container>
  )
}
