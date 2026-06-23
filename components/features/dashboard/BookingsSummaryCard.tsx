'use client'

import React from 'react'
import { Container } from '@/components/ui/container'
import { CalendarDays, RefreshCw, Users, MailWarning } from 'lucide-react'

interface LocationAgg { local: string; reservas: number; pessoas: number }
interface DayAgg { dia: string; data: string; reservas: number; pessoas: number; porLocal: LocationAgg[] }
interface ProxItem { dataLabel: string; local: string; pessoas: number; titulo: string; status: string }

interface BookingsResponse {
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
      if (!res.ok) throw new Error('Falha ao carregar reservas')
      setData((await res.json()) as BookingsResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar reservas')
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
            <h3 className="text-heading-4">Próximas reservas</h3>
            <p className="text-[11px] text-[var(--ds-text-muted)]">
              {data?.rangeLabel
                ? `Próximos 30 dias (${data.rangeLabel})${data.generatedAt ? ` · ${timeAgo(data.generatedAt)}` : ''}`
                : 'Resumo das reservas internas'}
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing || loading}
          aria-label="Atualizar reservas"
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
      ) : data ? (
        <>
          {/* total pessoas + reservas + status */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex flex-col rounded-lg bg-primary-500/10 px-3 py-2 min-w-[92px]">
              <span className="text-lg font-semibold text-primary-500 tabular-nums flex items-center gap-1">
                <Users size={15} /> {data.totalPessoas ?? 0}
              </span>
              <span className="text-[11px] text-[var(--ds-text-muted)] leading-tight">pessoas no período</span>
            </div>
            <div className="flex flex-col rounded-lg bg-[var(--ds-bg-hover)] px-3 py-2 min-w-[80px]">
              <span className="text-lg font-semibold text-[var(--ds-text-primary)] tabular-nums">{data.total ?? 0}</span>
              <span className="text-[11px] text-[var(--ds-text-muted)] leading-tight">reservas</span>
            </div>
            {(data.porStatus || []).map((s) => (
              <div key={s.status} className="flex flex-col rounded-lg bg-[var(--ds-bg-hover)] px-3 py-2 min-w-[72px]">
                <span className="text-base font-semibold text-[var(--ds-text-primary)] tabular-nums">{s.qtd}</span>
                <span className="text-[11px] text-[var(--ds-text-muted)] leading-tight capitalize">{s.status}</span>
              </div>
            ))}
          </div>

          {/* resumo IA */}
          <p className="text-sm leading-relaxed text-[var(--ds-text-secondary)] whitespace-pre-wrap">{data.summary}</p>

          {/* detalhe por dia × local (números exatos) */}
          {(data.porDia || []).length > 0 && (
            <div className="mt-5 pt-4 border-t border-[var(--ds-border-subtle)] space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-[var(--ds-text-muted)]">Por dia e local</p>
              {(data.porDia || []).map((d) => (
                <div key={d.data} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                  <span className="text-[var(--ds-text-primary)] font-medium w-[88px] shrink-0">{d.dia}</span>
                  <span className="text-[var(--ds-text-muted)] tabular-nums">{d.pessoas}p / {d.reservas}r</span>
                  <span className="text-[var(--ds-text-muted)] text-xs">
                    — {(d.porLocal || []).map((l) => `${l.local}: ${l.pessoas}p`).join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </Container>
  )
}
