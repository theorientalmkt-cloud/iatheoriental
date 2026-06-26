'use client'

import React from 'react'
import { Page, PageHeader, PageTitle, PageDescription, PageActions } from '@/components/ui/page'
import { Container } from '@/components/ui/container'
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Users, X, Download } from 'lucide-react'
import {
  reservationService,
  RESERVATION_LOCATIONS,
  RESERVATION_STATUSES,
  STATUS_LABELS,
  type Reservation,
  type ReservationInput,
} from '@/services/reservationService'

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function statusColor(status: string): string {
  switch (status) {
    case 'confirmado': return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    case 'pendente': return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    case 'no_show': return 'bg-red-500/15 text-red-600 dark:text-red-400'
    case 'cancelado': return 'bg-zinc-500/15 text-zinc-500'
    case 'remarcado': return 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
    default: return 'bg-zinc-500/15 text-zinc-500'
  }
}

const emptyForm: ReservationInput = {
  reservation_date: ymd(new Date()),
  reservation_time: '',
  location: RESERVATION_LOCATIONS[0],
  party_size: 2,
  guest_name: '',
  guest_phone: '',
  menu_choice: '',
  status: 'pendente',
  internal_notes: '',
}

export default function ReservasPage() {
  const today = React.useMemo(() => new Date(), [])
  const [reservations, setReservations] = React.useState<Reservation[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [viewDate, setViewDate] = React.useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDate, setSelectedDate] = React.useState<string>(ymd(today))
  const [form, setForm] = React.useState<ReservationInput | null>(null)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [importing, setImporting] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setReservations(await reservationService.list())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar reservas')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleImport = async () => {
    if (!confirm('Importar as reservas do Google Calendar para a plataforma? As reservas já importadas serão atualizadas.')) return
    setImporting(true)
    try {
      const r = await reservationService.importFromCalendar()
      alert(`Importação concluída: ${r.imported} reserva(s) importada(s) do Google Calendar.`)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro ao importar do Google Calendar')
    } finally {
      setImporting(false)
    }
  }

  React.useEffect(() => { load() }, [load])

  // Agrupa por dia
  const byDay = React.useMemo(() => {
    const map = new Map<string, Reservation[]>()
    for (const r of reservations) {
      if (!map.has(r.reservation_date)) map.set(r.reservation_date, [])
      map.get(r.reservation_date)!.push(r)
    }
    return map
  }, [reservations])

  // Células do mês (grade 6x7)
  const cells = React.useMemo(() => {
    const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)
    const start = new Date(first)
    start.setDate(1 - first.getDay())
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return d
    })
  }, [viewDate])

  // Navegação limitada: mês atual .. +3 meses
  const monthIdx = viewDate.getFullYear() * 12 + viewDate.getMonth()
  const minIdx = today.getFullYear() * 12 + today.getMonth()
  const maxIdx = minIdx + 3
  const canPrev = monthIdx > minIdx
  const canNext = monthIdx < maxIdx
  const goMonth = (delta: number) => {
    const d = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1)
    setViewDate(d)
  }

  const selectedReservations = byDay.get(selectedDate) || []
  const selPeople = selectedReservations
    .filter((r) => r.status !== 'cancelado' && r.status !== 'no_show')
    .reduce((s, r) => s + (r.party_size || 0), 0)

  const openNew = () => {
    setEditingId(null)
    setForm({ ...emptyForm, reservation_date: selectedDate })
  }
  const openEdit = (r: Reservation) => {
    setEditingId(r.id)
    setForm({
      reservation_date: r.reservation_date,
      reservation_time: r.reservation_time || '',
      location: r.location || RESERVATION_LOCATIONS[0],
      party_size: r.party_size || 1,
      guest_name: r.guest_name || '',
      guest_phone: r.guest_phone || '',
      menu_choice: r.menu_choice || '',
      status: r.status || 'pendente',
      internal_notes: r.internal_notes || '',
    })
  }
  const closeForm = () => { setForm(null); setEditingId(null) }

  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      if (editingId) await reservationService.update(editingId, form)
      else await reservationService.create(form)
      closeForm()
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const del = async (id: string) => {
    if (!confirm('Excluir esta reserva?')) return
    try {
      await reservationService.remove(id)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro ao excluir')
    }
  }

  const setF = (patch: Partial<ReservationInput>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const inputCls = 'w-full rounded-lg bg-[var(--ds-bg-hover)] border border-[var(--ds-border-subtle)] px-3 py-2 text-sm text-[var(--ds-text-primary)] focus:outline-none focus:ring-2 focus:ring-primary-500/40'

  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>Reservas</PageTitle>
          <PageDescription>Calendário interno — lance e edite as reservas por data, local e nº de pessoas (até 3 meses à frente).</PageDescription>
        </div>
        <PageActions>
          <button
            onClick={handleImport}
            disabled={importing}
            className="border border-[var(--ds-border-default)] text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)] px-4 py-2 rounded-lg font-medium text-sm transition-colors inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Download size={16} /> {importing ? 'Importando…' : 'Importar do Google Calendar'}
          </button>
          <button
            onClick={openNew}
            className="bg-primary-600 text-white hover:bg-primary-500 px-4 py-2 rounded-lg font-semibold text-sm transition-colors inline-flex items-center gap-2"
          >
            <Plus size={16} /> Nova reserva
          </button>
        </PageActions>
      </PageHeader>

      {error && <div className="text-sm text-red-500 mb-4">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendário */}
        <Container variant="glass" padding="lg" className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-heading-4">{MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}</h3>
            <div className="flex gap-1">
              <button onClick={() => goMonth(-1)} disabled={!canPrev} aria-label="Mês anterior"
                className="h-8 w-8 flex items-center justify-center rounded-lg text-[var(--ds-text-muted)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-primary)] disabled:opacity-30 disabled:cursor-not-allowed">
                <ChevronLeft size={16} />
              </button>
              <button onClick={() => goMonth(1)} disabled={!canNext} aria-label="Próximo mês"
                className="h-8 w-8 flex items-center justify-center rounded-lg text-[var(--ds-text-muted)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-primary)] disabled:opacity-30 disabled:cursor-not-allowed">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((w) => (
              <div key={w} className="text-center text-[11px] text-[var(--ds-text-muted)] font-medium py-1">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              const key = ymd(d)
              const inMonth = d.getMonth() === viewDate.getMonth()
              const isToday = key === ymd(today)
              const isSel = key === selectedDate
              const dayRes = (byDay.get(key) || []).filter((r) => r.status !== 'cancelado' && r.status !== 'no_show')
              const people = dayRes.reduce((s, r) => s + (r.party_size || 0), 0)
              return (
                <button
                  key={i}
                  onClick={() => setSelectedDate(key)}
                  className={`aspect-square rounded-lg p-1 flex flex-col items-center justify-start text-xs transition-colors border ${
                    isSel ? 'border-primary-500 bg-primary-500/10' : 'border-transparent hover:bg-[var(--ds-bg-hover)]'
                  } ${inMonth ? 'text-[var(--ds-text-primary)]' : 'text-[var(--ds-text-muted)] opacity-50'}`}
                >
                  <span className={`mt-0.5 ${isToday ? 'h-5 w-5 flex items-center justify-center rounded-full bg-primary-600 text-white' : ''}`}>{d.getDate()}</span>
                  {people > 0 && (
                    <span className="mt-1 flex items-center gap-0.5 rounded-full bg-primary-500/15 text-primary-600 dark:text-primary-400 px-1.5 text-[10px] font-medium tabular-nums">
                      <Users size={9} /> {people}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {loading && <p className="text-xs text-[var(--ds-text-muted)] mt-3">Carregando reservas…</p>}
        </Container>

        {/* Painel do dia */}
        <Container variant="glass" padding="lg" className="flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-heading-4">{selectedDate.split('-').reverse().join('/')}</h3>
              <p className="text-[11px] text-[var(--ds-text-muted)]">{selectedReservations.length} reserva(s) · {selPeople} pessoas</p>
            </div>
            <button onClick={openNew} className="text-xs px-2.5 py-1.5 rounded-lg bg-[var(--ds-bg-hover)] hover:bg-[var(--ds-bg-surface)] inline-flex items-center gap-1">
              <Plus size={13} /> Add
            </button>
          </div>

          <div className="flex-1 space-y-2 overflow-auto max-h-[420px]">
            {selectedReservations.length === 0 ? (
              <p className="text-sm text-[var(--ds-text-muted)] py-6 text-center">Nenhuma reserva neste dia.</p>
            ) : (
              selectedReservations.map((r) => (
                <div key={r.id} className="rounded-lg border border-[var(--ds-border-subtle)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--ds-text-primary)] truncate">
                        {r.reservation_time ? `${r.reservation_time} · ` : ''}{r.guest_name || 'Sem nome'}
                      </p>
                      <p className="text-xs text-[var(--ds-text-muted)] flex items-center gap-1.5 mt-0.5">
                        <Users size={11} /> {r.party_size}
                        {r.location ? ` · ${r.location}` : ''}
                        {r.menu_choice ? ` · ${r.menu_choice}` : ''}
                      </p>
                    </div>
                    <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${statusColor(r.status)}`}>
                      {STATUS_LABELS[r.status] || r.status}
                    </span>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => openEdit(r)} className="text-[11px] text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] inline-flex items-center gap-1">
                      <Pencil size={12} /> Editar
                    </button>
                    <button onClick={() => del(r.id)} className="text-[11px] text-red-500 hover:text-red-400 inline-flex items-center gap-1">
                      <Trash2 size={12} /> Excluir
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Container>
      </div>

      {/* Modal de formulário */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeForm}>
          <div className="w-full max-w-md rounded-xl bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-default)] p-5 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-heading-4">{editingId ? 'Editar reserva' : 'Nova reserva'}</h3>
              <button onClick={closeForm} aria-label="Fechar" className="text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)]"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-[var(--ds-text-muted)]">Data
                  <input type="date" className={inputCls} value={form.reservation_date} onChange={(e) => setF({ reservation_date: e.target.value })} />
                </label>
                <label className="text-xs text-[var(--ds-text-muted)]">Horário
                  <select className={inputCls} value={form.reservation_time || ''} onChange={(e) => setF({ reservation_time: e.target.value })}>
                    <option value="">—</option>
                    <option value="13:00">13:00 (Almoço XP)</option>
                    <option value="19:00">19:00 (Jantar)</option>
                    <option value="21:00">21:00 (Jantar)</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-[var(--ds-text-muted)]">Local
                  <select className={inputCls} value={form.location || ''} onChange={(e) => setF({ location: e.target.value })}>
                    {RESERVATION_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
                <label className="text-xs text-[var(--ds-text-muted)]">Nº de pessoas
                  <input type="number" min={1} className={inputCls} value={form.party_size} onChange={(e) => setF({ party_size: Math.max(1, Number(e.target.value) || 1) })} />
                </label>
              </div>
              <label className="text-xs text-[var(--ds-text-muted)] block">Nome do cliente
                <input type="text" className={inputCls} value={form.guest_name || ''} onChange={(e) => setF({ guest_name: e.target.value })} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-[var(--ds-text-muted)]">WhatsApp
                  <input type="text" placeholder="+55..." className={inputCls} value={form.guest_phone || ''} onChange={(e) => setF({ guest_phone: e.target.value })} />
                </label>
                <label className="text-xs text-[var(--ds-text-muted)]">Menu
                  <select className={inputCls} value={form.menu_choice || ''} onChange={(e) => setF({ menu_choice: e.target.value })}>
                    <option value="">—</option>
                    <option value="Nippon">Nippon</option>
                    <option value="XP">XP</option>
                  </select>
                </label>
              </div>
              <label className="text-xs text-[var(--ds-text-muted)] block">Status
                <select className={inputCls} value={form.status || 'pendente'} onChange={(e) => setF({ status: e.target.value })}>
                  {RESERVATION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </label>
              <label className="text-xs text-[var(--ds-text-muted)] block">Observações
                <textarea rows={2} className={inputCls} value={form.internal_notes || ''} onChange={(e) => setF({ internal_notes: e.target.value })} />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={closeForm} className="px-4 py-2 rounded-lg text-sm text-[var(--ds-text-secondary)] hover:bg-[var(--ds-bg-hover)]">Cancelar</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary-600 text-white hover:bg-primary-500 disabled:opacity-50">
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}
