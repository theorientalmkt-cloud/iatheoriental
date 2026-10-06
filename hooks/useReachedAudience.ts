'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchReachedAudience,
  reachedAudienceCsvUrl,
  type ReachedAudienceFilters,
} from '@/services/reachedAudienceService'
import type { ReachedSource } from '@/lib/business/audience/reached'

/** Períodos oferecidos na tela, em dias. `null` = desde sempre. */
export const PERIODOS = [
  { valor: '30', label: 'Últimos 30 dias' },
  { valor: '90', label: 'Últimos 90 dias' },
  { valor: '180', label: 'Últimos 6 meses' },
  { valor: 'todos', label: 'Desde sempre' },
] as const

function sinceFromPeriodo(periodo: string): string | null {
  if (periodo === 'todos') return null
  const dias = Number(periodo)
  if (!Number.isFinite(dias)) return null
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

export function useReachedAudienceController() {
  const [periodo, setPeriodo] = useState<string>('90')
  const [source, setSource] = useState<ReachedSource | 'todas'>('todas')
  const [onlyDelivered, setOnlyDelivered] = useState(false)
  const [busca, setBusca] = useState('')

  const filters: ReachedAudienceFilters = useMemo(
    () => ({
      since: sinceFromPeriodo(periodo),
      source: source === 'todas' ? null : source,
      onlyDelivered,
    }),
    [periodo, source, onlyDelivered]
  )

  const query = useQuery({
    queryKey: ['reached-audience', filters],
    queryFn: () => fetchReachedAudience(filters),
    // O público muda a cada campanha enviada; 1 min evita recarregar a cada
    // troca de aba sem deixar o número velho por muito tempo.
    staleTime: 60_000,
  })

  // A busca é local: o endpoint já devolve o público inteiro, então filtrar
  // aqui evita uma ida ao servidor a cada tecla.
  const contatos = useMemo(() => {
    const todos = query.data?.contacts ?? []
    const termo = busca.trim().toLowerCase()
    if (!termo) return todos
    return todos.filter(
      (c) => c.phone.toLowerCase().includes(termo) || (c.name || '').toLowerCase().includes(termo)
    )
  }, [query.data, busca])

  return {
    contatos,
    total: query.data?.total ?? 0,
    bySource: query.data?.bySource ?? { campanha: 0, inbox: 0 },
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,

    periodo,
    setPeriodo,
    source,
    setSource,
    onlyDelivered,
    setOnlyDelivered,
    busca,
    setBusca,

    csvUrl: reachedAudienceCsvUrl(filters),
  }
}
