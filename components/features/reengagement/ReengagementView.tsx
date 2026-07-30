'use client'

import { useReengagement } from '@/hooks/useReengagement'
import { BellRing, Tag, Send, CheckCheck, Eye, MessageSquareOff, Loader2, Info } from 'lucide-react'
import type { ReceivedMode } from '@/services/reengagementService'

const MODE_LABELS: Record<ReceivedMode, { label: string; hint: string; icon: typeof Send }> = {
  sent: { label: 'Enviado', hint: 'Qualquer envio', icon: Send },
  delivered: { label: 'Entregue', hint: 'Chegou no WhatsApp', icon: CheckCheck },
  read: { label: 'Leu', hint: 'Abriu a mensagem', icon: Eye },
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string
  value: string | number
  accent?: 'brand' | 'muted' | 'warn'
}) {
  const color =
    accent === 'brand'
      ? 'text-[var(--ds-brand-primary)]'
      : accent === 'warn'
        ? 'text-amber-400'
        : 'text-[var(--ds-text-primary)]'
  return (
    <div className="rounded-xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-surface)] px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--ds-text-muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

export function ReengagementView() {
  const {
    campaigns,
    campaignsLoading,
    selectedCampaignId,
    setSelectedCampaignId,
    selectedCampaign,
    receivedMode,
    setReceivedMode,
    result,
    isLoading,
    error,
    tagName,
    setTagName,
    applyTag,
    isTagging,
    tagged,
  } = useReengagement()

  const nonResponders = result?.nonResponders ?? []
  const responseRate =
    result && result.received > 0 ? Math.round((result.responded / result.received) * 100) : 0
  const notTaggable = result ? nonResponders.length - result.taggable : 0

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-[var(--ds-brand-primary-muted)] p-2.5">
          <BellRing className="text-[var(--ds-brand-primary)]" size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[var(--ds-text-primary)]">Reengajamento</h1>
          <p className="text-sm text-[var(--ds-text-muted)]">
            Quem recebeu uma campanha mas não respondeu — pronto pra um segundo toque.
          </p>
        </div>
      </div>

      {/* Seletor de campanha + critério */}
      <div className="rounded-2xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-elevated)] p-5 space-y-4">
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--ds-text-muted)]">
            Campanha
          </label>
          <select
            value={selectedCampaignId}
            onChange={(e) => setSelectedCampaignId(e.target.value)}
            disabled={campaignsLoading}
            className="mt-2 w-full rounded-xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-surface)] px-3 py-2.5 text-sm text-[var(--ds-text-primary)] outline-none focus:border-[var(--ds-border-focus)]"
          >
            <option value="">
              {campaignsLoading ? 'Carregando campanhas…' : 'Selecione uma campanha…'}
            </option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.delivered || c.sent || 0} entregues
              </option>
            ))}
          </select>
          {!campaignsLoading && campaigns.length === 0 && (
            <p className="mt-2 text-xs text-[var(--ds-text-muted)]">
              Nenhuma campanha com envios ainda.
            </p>
          )}
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--ds-text-muted)]">
            Considerar “recebeu” como
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(MODE_LABELS) as ReceivedMode[]).map((mode) => {
              const { label, hint, icon: Icon } = MODE_LABELS[mode]
              const active = receivedMode === mode
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setReceivedMode(mode)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'border-[var(--ds-brand-primary)] bg-[var(--ds-brand-primary-muted)] text-[var(--ds-brand-primary)]'
                      : 'border-[var(--ds-border-default)] bg-[var(--ds-bg-surface)] text-[var(--ds-text-secondary)] hover:bg-[var(--ds-bg-hover)]'
                  }`}
                  title={hint}
                >
                  <Icon size={15} />
                  <span className="font-medium">{label}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-[var(--ds-text-muted)]">
            {MODE_LABELS[receivedMode].hint}. Se “Entregue” vier bem abaixo de “Enviado”, seu WhatsApp
            pode não estar recebendo confirmações de entrega — nesse caso use “Enviado”.
          </p>
        </div>
      </div>

      {/* Estados */}
      {selectedCampaignId && isLoading && (
        <div className="flex items-center gap-2 rounded-2xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-elevated)] p-6 text-sm text-[var(--ds-text-muted)]">
          <Loader2 className="animate-spin" size={16} /> Calculando quem não respondeu…
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          Falha ao calcular: {error.message}
        </div>
      )}

      {/* Resultado */}
      {result && !isLoading && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Receberam" value={result.received} />
            <StatTile label="Responderam" value={result.responded} accent="brand" />
            <StatTile label="Não responderam" value={nonResponders.length} accent="warn" />
            <StatTile label="Taxa de resposta" value={`${responseRate}%`} />
          </div>

          {/* Ação: marcar com tag */}
          <div className="rounded-2xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-elevated)] p-5">
            <div className="flex items-center gap-2">
              <Tag size={16} className="text-[var(--ds-brand-primary)]" />
              <p className="text-sm font-bold text-[var(--ds-text-primary)]">
                Marcar os {result.taggable} não-respondentes com uma tag
              </p>
            </div>
            <p className="mt-1 text-xs text-[var(--ds-text-muted)]">
              Depois é só criar uma campanha nova mirando essa tag (aparece na montagem, em Segmentos).
            </p>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder="Nome da tag…"
                className="flex-1 rounded-xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-surface)] px-3 py-2.5 text-sm text-[var(--ds-text-primary)] outline-none focus:border-[var(--ds-border-focus)]"
              />
              <button
                type="button"
                onClick={applyTag}
                disabled={isTagging || result.taggable === 0 || !tagName.trim()}
                className="flex items-center justify-center gap-2 rounded-xl bg-[var(--ds-brand-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--ds-brand-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isTagging ? <Loader2 className="animate-spin" size={15} /> : <Tag size={15} />}
                Marcar {result.taggable}
              </button>
            </div>

            {notTaggable > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--ds-text-muted)]">
                <Info size={13} /> {notTaggable} não têm cadastro de contato e não podem receber tag.
              </p>
            )}
            {tagged && (
              <p className="mt-2 text-xs font-medium text-[var(--ds-brand-primary)]">
                ✓ {tagged.updated} marcados com “{tagged.tag}”. Já dá pra usar na Nova Campanha.
              </p>
            )}
          </div>

          {/* Lista */}
          <div className="rounded-2xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-elevated)] overflow-hidden">
            <div className="flex items-center gap-2 border-b border-[var(--ds-border-default)] px-4 py-3">
              <MessageSquareOff size={15} className="text-[var(--ds-text-muted)]" />
              <p className="text-sm font-bold text-[var(--ds-text-primary)]">
                Não responderam ({nonResponders.length})
              </p>
            </div>
            {nonResponders.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--ds-text-muted)]">
                🎉 Todo mundo que recebeu respondeu. Nada a reengajar aqui.
              </div>
            ) : (
              <div className="max-h-96 overflow-auto divide-y divide-[var(--ds-border-subtle)]">
                {nonResponders.slice(0, 200).map((n, i) => (
                  <div
                    key={`${n.phone}-${i}`}
                    className="flex items-center justify-between px-4 py-2.5 text-sm"
                  >
                    <span className="truncate pr-3 text-[var(--ds-text-primary)]">
                      {n.name || 'Sem nome'}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-[var(--ds-text-muted)]">
                      {n.phone}
                    </span>
                  </div>
                ))}
                {nonResponders.length > 200 && (
                  <div className="px-4 py-2.5 text-center text-xs text-[var(--ds-text-muted)]">
                    …e mais {nonResponders.length - 200}. A tag marca todos.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
