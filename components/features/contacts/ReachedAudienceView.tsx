'use client'

import { Download, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { PERIODOS, useReachedAudienceController } from '@/hooks/useReachedAudience'
import type { ReachedSource } from '@/lib/business/audience/reached'

const ORIGENS: Array<{ valor: ReachedSource | 'todas'; label: string }> = [
  { valor: 'todas', label: 'Todas' },
  { valor: 'campanha', label: 'Campanha' },
  { valor: 'inbox', label: 'Inbox' },
]

function formatarData(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function ReachedAudienceView() {
  const c = useReachedAudienceController()

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Público alcançado</h2>
        <p className="text-sm text-zinc-400">
          Quem já recebeu alguma mensagem nossa, somando disparos de campanha e conversas do inbox.
          Cada telefone aparece uma vez.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Pessoas alcançadas</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-100">{c.total.toLocaleString('pt-BR')}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Por campanha</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-100">
            {c.bySource.campanha.toLocaleString('pt-BR')}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Pelo inbox</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-100">
            {c.bySource.inbox.toLocaleString('pt-BR')}
          </p>
        </div>
      </div>

      <p className="text-xs text-zinc-500">
        Quem foi alcançado pelas duas vias conta nos dois cartões, por isso a soma pode passar do total.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            value={c.busca}
            onChange={(e) => c.setBusca(e.target.value)}
            placeholder="Buscar por telefone ou nome"
            className="pl-9"
          />
        </div>

        <select
          value={c.periodo}
          onChange={(e) => c.setPeriodo(e.target.value)}
          className="h-9 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-200"
          aria-label="Período"
        >
          {PERIODOS.map((p) => (
            <option key={p.valor} value={p.valor}>{p.label}</option>
          ))}
        </select>

        <select
          value={c.source}
          onChange={(e) => c.setSource(e.target.value as ReachedSource | 'todas')}
          className="h-9 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-200"
          aria-label="Origem"
        >
          {ORIGENS.map((o) => (
            <option key={o.valor} value={o.valor}>{o.label}</option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={c.onlyDelivered}
            onChange={(e) => c.setOnlyDelivered(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-900"
          />
          Só entregues
        </label>

        <Button variant="outline" size="sm" onClick={() => c.refetch()} disabled={c.isLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${c.isLoading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>

        <Button variant="outline" size="sm" asChild>
          <a href={c.csvUrl} download>
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </a>
        </Button>
      </div>

      {c.error && (
        <div className="rounded-md border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
          Não foi possível carregar o público: {c.error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/70 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Telefone</th>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Primeiro contato</th>
              <th className="px-4 py-3 font-medium">Último contato</th>
              <th className="px-4 py-3 font-medium">Mensagens</th>
              <th className="px-4 py-3 font-medium">Origem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {c.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  Carregando o público...
                </td>
              </tr>
            )}

            {!c.isLoading && c.contatos.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  {c.busca
                    ? 'Nenhum contato corresponde à busca.'
                    : 'Ninguém foi alcançado no período selecionado.'}
                </td>
              </tr>
            )}

            {!c.isLoading &&
              c.contatos.map((contato) => (
                <tr key={contato.phone} className="hover:bg-zinc-900/40">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-zinc-200">{contato.phone}</td>
                  <td className="px-4 py-3 text-zinc-300">{contato.name || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-400">
                    {formatarData(contato.firstReachedAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-400">
                    {formatarData(contato.lastReachedAt)}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{contato.messageCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {contato.sources.map((s) => (
                        <Badge key={s} variant="outline" className="text-xs capitalize">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {!c.isLoading && c.contatos.length > 0 && (
        <p className="text-xs text-zinc-500">
          Mostrando {c.contatos.length.toLocaleString('pt-BR')} de {c.total.toLocaleString('pt-BR')} pessoas.
        </p>
      )}
    </div>
  )
}
