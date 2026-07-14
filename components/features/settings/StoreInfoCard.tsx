'use client'

import React from 'react'
import { Container } from '@/components/ui/container'
import { Store, Check, Loader2 } from 'lucide-react'

interface StoreInfo {
  address: string
  whatsappConfirm: string
  sendLinkAfterBooking: boolean
}

const inputCls =
  'w-full rounded-lg bg-[var(--ds-bg-hover)] border border-[var(--ds-border-subtle)] px-3 py-2 text-sm text-[var(--ds-text-primary)] focus:outline-none focus:ring-2 focus:ring-primary-500/40'

export const StoreInfoCard: React.FC = () => {
  const [form, setForm] = React.useState<StoreInfo | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/settings/store')
        if (!res.ok) throw new Error('Falha ao carregar')
        setForm((await res.json()) as StoreInfo)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const set = (patch: Partial<StoreInfo>) => {
    setForm((f) => (f ? { ...f, ...patch } : f))
    setSaved(false)
  }

  const save = async () => {
    if (!form) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Falha ao salvar')
      setForm(data as StoreInfo)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Container variant="glass" padding="lg" className="mb-8">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500/15 text-primary-500">
          <Store size={18} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-heading-4">Dados da Loja</h3>
          <p className="text-[11px] text-[var(--ds-text-muted)]">
            Endereço e WhatsApp usados pela IA e nas reservas — fonte única, sem depender do prompt
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 h-40 rounded-xl bg-[var(--ds-bg-hover)] animate-pulse" aria-hidden="true" />
      ) : form ? (
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="text-xs text-[var(--ds-text-muted)]">Endereço da loja</span>
            <textarea
              rows={2}
              className={`${inputCls} mt-1 resize-none`}
              value={form.address}
              onChange={(e) => set({ address: e.target.value })}
              placeholder="Rua, número - Bairro, Cidade - UF, CEP"
            />
            <span className="text-[11px] text-[var(--ds-text-muted)]">
              A IA passa a usar sempre este endereço ao responder “onde fica”.
            </span>
          </label>

          <label className="block">
            <span className="text-xs text-[var(--ds-text-muted)]">WhatsApp da loja (confirmação / pagamento)</span>
            <input
              type="text"
              inputMode="numeric"
              className={`${inputCls} mt-1`}
              value={form.whatsappConfirm}
              onChange={(e) => set({ whatsappConfirm: e.target.value })}
              placeholder="5511999999999"
            />
            <span className="text-[11px] text-[var(--ds-text-muted)]">
              Formato internacional, só números. Ex.: 5511973832745
            </span>
          </label>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary-500"
              checked={form.sendLinkAfterBooking}
              onChange={(e) => set({ sendLinkAfterBooking: e.target.checked })}
            />
            <span className="text-sm text-[var(--ds-text-secondary)]">
              Enviar o link deste WhatsApp automaticamente após cada reserva confirmada
            </span>
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
