import { api } from '@/lib/api'
import type { ReachedAudienceResult, ReachedSource } from '@/lib/business/audience/reached'

export interface ReachedAudienceFilters {
  /** Só quem recebeu a partir desta data ('yyyy-mm-dd'). */
  since?: string | null
  /** Restringe a origem. Vazio soma as duas. */
  source?: ReachedSource | null
  /** Exige confirmação de entrega pela Meta. */
  onlyDelivered?: boolean
}

function toQuery(filters: ReachedAudienceFilters): string {
  const params = new URLSearchParams()
  if (filters.since) params.set('since', filters.since)
  if (filters.source) params.set('source', filters.source)
  if (filters.onlyDelivered) params.set('delivered', 'true')
  const q = params.toString()
  return q ? `?${q}` : ''
}

/** Público que já recebeu alguma mensagem (campanha ou inbox). */
export async function fetchReachedAudience(
  filters: ReachedAudienceFilters = {}
): Promise<ReachedAudienceResult> {
  return api.get<ReachedAudienceResult>(`/api/contacts/reached${toQuery(filters)}`)
}

/** URL do CSV com os mesmos filtros da tela — o download é do navegador. */
export function reachedAudienceCsvUrl(filters: ReachedAudienceFilters = {}): string {
  const q = toQuery(filters)
  return `/api/contacts/reached${q ? `${q}&` : '?'}format=csv`
}
