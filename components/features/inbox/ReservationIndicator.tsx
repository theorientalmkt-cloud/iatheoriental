'use client'

/**
 * Mostra, no cabeçalho da conversa, se o telefone do lead já tem reserva
 * (cruza com a tabela `reservations`). Renderiza nada se não houver reserva futura.
 */

import React from 'react'
import { CalendarCheck } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Reserva {
  id: string
  reservation_date: string
  reservation_time: string | null
  party_size: number
  status: string
  menu_choice: string | null
  location: string | null
}

interface ByPhoneResponse {
  hasReservation: boolean
  upcoming: Reserva[]
  next: Reserva | null
  total: number
}

const STATUS_LABEL: Record<string, string> = {
  pendente: 'pendente',
  confirmado: 'confirmada',
  remarcado: 'remarcada',
}

function ddmm(date: string): string {
  const [, m, d] = date.split('-')
  return `${d}/${m}`
}

export function ReservationIndicator({ phone }: { phone: string }) {
  const [data, setData] = React.useState<ByPhoneResponse | null>(null)

  React.useEffect(() => {
    if (!phone) return
    let active = true
    fetch(`/api/reservations/by-phone?phone=${encodeURIComponent(phone)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (active) setData(j) })
      .catch(() => {})
    return () => { active = false }
  }, [phone])

  if (!data?.hasReservation || !data.next) return null

  const r = data.next
  const isConfirmed = r.status === 'confirmado'
  const color = isConfirmed
    ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
    : 'text-amber-600 dark:text-amber-400 bg-amber-500/10'
  const extra = data.upcoming.length > 1 ? ` +${data.upcoming.length - 1}` : ''
  const tooltip = data.upcoming
    .slice(0, 5)
    .map((u) => `${ddmm(u.reservation_date)}${u.reservation_time ? ` ${u.reservation_time}` : ''} · ${u.party_size}p · ${u.menu_choice || ''} (${STATUS_LABEL[u.status] || u.status})`)
    .join('\n')

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`mt-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded w-fit ${color}`}>
          <CalendarCheck className="h-2.5 w-2.5" />
          Reserva {STATUS_LABEL[r.status] || r.status}: {ddmm(r.reservation_date)}{r.reservation_time ? ` ${r.reservation_time}` : ''} · {r.party_size}p{extra}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs whitespace-pre-line">
        {data.upcoming.length} reserva(s) futura(s):{'\n'}{tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
