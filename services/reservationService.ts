/**
 * Cliente da API de reservas internas (/api/reservations).
 */

export interface Reservation {
  id: string
  reservation_date: string // YYYY-MM-DD
  reservation_time: string | null
  location: string | null
  party_size: number
  guest_name: string | null
  guest_phone: string | null
  menu_choice: string | null
  status: string
  internal_notes: string | null
  allergy_notes: string | null
  created_at?: string
  updated_at?: string
}

export type ReservationInput = Partial<Omit<Reservation, 'id' | 'created_at' | 'updated_at'>> & {
  reservation_date: string
  party_size: number
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error((j as { error?: string }).error || 'Erro na requisição')
  }
  return res.json() as Promise<T>
}

export const reservationService = {
  async list(from?: string, to?: string): Promise<Reservation[]> {
    const qs = new URLSearchParams()
    if (from) qs.set('from', from)
    if (to) qs.set('to', to)
    const res = await fetch(`/api/reservations${qs.toString() ? `?${qs}` : ''}`)
    const data = await handle<{ reservations: Reservation[] }>(res)
    return data.reservations
  },

  async create(input: ReservationInput): Promise<Reservation> {
    const res = await fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const data = await handle<{ reservation: Reservation }>(res)
    return data.reservation
  },

  async update(id: string, input: Partial<ReservationInput>): Promise<Reservation> {
    const res = await fetch(`/api/reservations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const data = await handle<{ reservation: Reservation }>(res)
    return data.reservation
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`/api/reservations/${id}`, { method: 'DELETE' })
    await handle<{ success: boolean }>(res)
  },
}

export const RESERVATION_LOCATIONS = ['Balcão interno', 'Deck-janela'] as const
export const RESERVATION_STATUSES = ['pendente', 'confirmado', 'no_show', 'cancelado', 'remarcado'] as const

export const STATUS_LABELS: Record<string, string> = {
  pendente: 'Pendente',
  confirmado: 'Confirmado',
  no_show: 'No-show',
  cancelado: 'Cancelado',
  remarcado: 'Remarcado',
}
