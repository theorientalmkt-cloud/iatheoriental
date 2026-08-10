'use client'

import React from 'react'
import { Container } from '@/components/ui/container'
import { CalendarClock, Check, Loader2 } from 'lucide-react'

interface MenuInfo {
  nome: string
  validoAte: string
  nota: string
}

const inputCls =
  'w-full rounded-lg bg-[var(--ds-bg-hover)] border border-[var(--ds-border-subtle)] px-3 py-2 text-sm text-[var(--ds-text-primary)] focus:outline-none focus:ring-2 focus:ring-primary-500/40'

/** yyyy-mm-dd (fuso de São Paulo). */
function todayYmdSP(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

/** Dias até a data (dia-a-dia via Date.UTC, sem drift de fuso). */
function daysUntil(validoAte: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validoAte)) return null
  const today = todayYmdSP()
  const a = Date.UTC(+validoAte.slice(0, 4), +validoAte.slice(5, 7) - 1, +validoAte.slice(8, 10))
  const b = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))
  return Math.round((a - b) / 86_400_000)
}

function urgencyHint(validoAte: string): { text: string; tone: 'muted' | 'warn' | 'danger' } {
  const d = daysUntil(validoAte)
  if (d === null) return { text: 'Defina a data para a IA usar.', tone: 'muted' }
  if (d < 0) return { text: `Venceu há ${Math.abs(d)} dia(s) — a IA vai avisar que o menu mudou.`, tone: 'danger' }
  if (d === 0) return { text: 'ÚLTIMO DIA! A IA cria urgência máxima hoje.', tone: 'danger' }
  if (d <= 3) return { text: `Faltam ${d} dia(s) — a IA reforça a urgência.`, tone: 'warn' }
  return { text: `Faltam ${d} dias.`, tone: 'muted' }
}

export const MenuInfoCard: React.FC = () => {
  const [form, setForm] = React.useState<MenuInfo | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/settings/menu')
        if (!res.ok) throw new Error('Falha ao carregar')
        setForm((await res.json()) as MenuInfo)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const set = (patch: Partial<MenuInfo>) => {
    setForm((f) => (f ? { ...f, ...patch } : f))
    setSaved(false)
  }

  const save = async () => {
    if (!form) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Falha ao salvar')
      setForm(data as MenuInfo)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const hint = form ? urgencyHint(form.validoAte) : null
  const hintColor =
    hint?.tone === 'danger' ? 'text-red-400' : hint?.tone === 'warn' ? 'text-amber-400' : 'text-[var(--ds-text-muted)]'

  return (
    <Container variant="glass" padding="lg" className="mb-8">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500/15 text-primary-500">
          <CalendarClock size={18} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-heading-4">Menu Vigente</h3>
          <p className="text-[11px] text-[var(--ds-text-muted)]">
            Menu atual e até quando vale — a IA crava a data e cria urgência nos últimos dias
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 h-40 rounded-xl bg-[var(--ds-bg-hover)] animate-pulse" aria-hidden="true" />
      ) : form ? (
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="text-xs text-[var(--ds-text-muted)]">Nome/tema do menu</span>
            <input
              type="text"
              className={`${inputCls} mt-1`}
              value={form.nome}
              onChange={(e) => set({ nome: e.target.value })}
              placeholder="Ex.: Omakase Nippon"
            />
          </label>

          <label className="block">
            <span className="text-xs text-[var(--ds-text-muted)]">Válido até</span>
            <input
              type="date"
              className={`${inputCls} mt-1`}
              value={form.validoAte}
              onChange={(e) => set({ validoAte: e.target.value })}
            />
            {hint && <span className={`text-[11px] ${hintColor}`}>{hint.text}</span>}
          </label>

          <label className="block">
            <span className="text-xs text-[var(--ds-text-muted)]">Observação (opcional)</span>
            <textarea
              rows={2}
              className={`${inputCls} mt-1 resize-none`}
              value={form.nota}
              onChange={(e) => set({ nota: e.target.value })}
              placeholder="Ex.: menu de degustação de 7 tempos; troca toda terça"
            />
          </label>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 text-white hover:bg-primary-500 px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : null}
              {saving ? 'Salvando...' : saved ? 'Salvo' : 'Salvar'}
            </button>
            {error && <span className="text-sm text-red-400">{error}</span>}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-red-400">{error || 'Erro ao carregar'}</p>
      )}
    </Container>
  )
}
