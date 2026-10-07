'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'

type Causa = 'creditos' | 'cota' | 'credencial' | 'modelo' | 'desconhecida'

interface AIUsage {
  periodoDias: number
  chamadas: number
  custoUSD: number
  custoBRL: number
  projecaoMensalBRL: number
  tokensTotal: number
  providerPrincipal: {
    emFailover: boolean
    modelo: string | null
    ultimoErro: string | null
    ultimoErroEm: string | null
    causa: Causa
    falhas: number
  }
  porModelo: Array<{ model: string; chamadas: number; tokensTotal: number; custoUSD: number; comPreco: boolean }>
}

/** O que fazer em cada causa. Alarme sem instrução não ajuda ninguém. */
const ORIENTACAO: Record<Causa, { titulo: string; acao: string; link?: { url: string; texto: string } }> = {
  creditos: {
    titulo: 'Créditos esgotados',
    acao: 'A chave do provider ficou sem saldo. Recarregue para o modelo principal voltar a responder.',
    link: { url: 'https://aistudio.google.com/app/apikey', texto: 'Abrir Google AI Studio' },
  },
  cota: {
    titulo: 'Cota excedida',
    acao: 'O limite de uso foi atingido. Aguarde a renovação da cota ou solicite um limite maior ao provider.',
  },
  credencial: {
    titulo: 'Problema na chave de API',
    acao: 'A chave foi recusada. Verifique se ainda é válida e se tem permissão para o modelo escolhido.',
  },
  modelo: {
    titulo: 'Modelo incompatível',
    acao: 'O modelo escolhido falhou ao usar ferramentas. Troque para um modelo estável, sem camada de raciocínio.',
  },
  desconhecida: {
    titulo: 'Falha no provider principal',
    acao: 'O modelo principal falhou e o sistema usou o reserva. Veja a mensagem abaixo.',
  },
}

function formatarQuando(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function ProviderStatusCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['ai-usage', 30],
    queryFn: () => api.get<AIUsage>('/api/dashboard/ai-usage?days=30'),
    staleTime: 60_000,
  })

  if (isLoading || !data) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-500">
        Carregando o consumo da IA...
      </div>
    )
  }

  const p = data.providerPrincipal
  const orientacao = ORIENTACAO[p.causa] ?? ORIENTACAO.desconhecida

  return (
    <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-100">Saúde e consumo da IA</h3>
        <p className="text-xs text-zinc-500">Últimos {data.periodoDias} dias, a partir dos logs de atendimento.</p>
      </div>

      {p.emFailover ? (
        <div className="rounded-md border border-amber-900/50 bg-amber-950/30 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-200">{orientacao.titulo}</p>
              <p className="text-xs text-amber-200/80">{orientacao.acao}</p>
              <p className="text-xs text-amber-200/60">
                O modelo principal{p.modelo ? ` (${p.modelo})` : ''} falhou {p.falhas}{' '}
                {p.falhas === 1 ? 'vez' : 'vezes'} no período
                {p.ultimoErroEm ? `, a última em ${formatarQuando(p.ultimoErroEm)}` : ''}. Enquanto isso o
                atendimento roda no modelo reserva, que pode responder pior.
              </p>
              {p.ultimoErro && (
                <p className="mt-1 break-words font-mono text-[11px] text-amber-200/50">{p.ultimoErro}</p>
              )}
              {orientacao.link && (
                <a
                  href={orientacao.link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-300 hover:underline"
                >
                  {orientacao.link.texto}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-emerald-900/50 bg-emerald-950/20 p-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <p className="text-sm text-emerald-200">
            Modelo principal respondendo normalmente — nenhum failover no período.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Atendimentos</p>
          <p className="text-lg font-semibold text-zinc-100">{data.chamadas.toLocaleString('pt-BR')}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Custo no período</p>
          <p className="text-lg font-semibold text-zinc-100">
            R$ {data.custoBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Projeção mensal</p>
          <p className="text-lg font-semibold text-zinc-100">
            R$ {data.projecaoMensalBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {data.porModelo.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Por modelo</p>
          {data.porModelo.map((m) => (
            <div key={m.model} className="flex items-center justify-between text-sm">
              <span className="font-mono text-xs text-zinc-300">{m.model}</span>
              <span className="text-zinc-400">
                {m.chamadas.toLocaleString('pt-BR')} chamadas
                {m.comPreco ? ` · US$ ${m.custoUSD.toFixed(2)}` : ' · sem preço na tabela'}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-600">
        O custo é estimado a partir dos tokens e da tabela de preços do projeto. O saldo real da conta só o
        provider informa — este painel mostra o consumo e avisa quando a chave para de responder.
      </p>
    </div>
  )
}
