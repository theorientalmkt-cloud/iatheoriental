/**
 * Disparo único do WhatsApp oficial para conversas com janela aberta.
 *
 * O envio normal acontece na próxima resposta da IA, conversa a conversa.
 * Isto aqui é o alcance retroativo: quem conversou hoje e não voltou a
 * escrever não receberia nada até escrever de novo.
 *
 * Três salvaguardas, porque são clientes reais:
 *
 *   1. Só conversas com mensagem RECEBIDA nas últimas 24h. Fora da janela de
 *      atendimento da Meta, mensagem livre é recusada — dispararia erro em
 *      massa e sujaria a qualidade do número.
 *   2. Pula quem já recebeu o link, com a mesma checagem do envio normal.
 *   3. Pula contato em opt-out. Ele pediu para não receber mensagem nossa, e
 *      ter escrito no inbox não revoga isso.
 *
 * O padrão é SIMULAÇÃO: sem `confirmar: true` nada é enviado, só se conta
 * quem receberia. Disparo para cliente real não deve ser o comportamento
 * acidental de uma chamada.
 */

import { getSupabaseAdmin } from '@/lib/supabase'
import { precisaEnviarContatoOficial, mensagemContatoOficial } from './contato-oficial'

export interface BroadcastResultado {
  simulacao: boolean
  /** Conversas com janela de 24h aberta. */
  elegiveis: number
  enviados: number
  /** Já tinham recebido o link antes. */
  pulados_ja_receberam: number
  pulados_opt_out: number
  falhas: number
  detalheFalhas: string[]
}

/** Janela de atendimento da Meta: 24h desde a última mensagem do cliente. */
const JANELA_MS = 24 * 60 * 60 * 1000

/** Pausa entre envios, para não disparar tudo de uma vez. */
const INTERVALO_MS = 350

interface Deps {
  /** Injetado para o teste não precisar da API da Meta. */
  enviar: (params: { to: string; texto: string }) => Promise<{ success: boolean; messageId?: string; error?: string }>
  registrar: (params: { conversationId: string; texto: string; messageId: string }) => Promise<void>
  pausar?: (ms: number) => Promise<void>
}

export async function dispararContatoOficial(
  link: string,
  opcoes: { confirmar?: boolean },
  deps: Deps
): Promise<BroadcastResultado> {
  const r: BroadcastResultado = {
    simulacao: !opcoes.confirmar,
    elegiveis: 0,
    enviados: 0,
    pulados_ja_receberam: 0,
    pulados_opt_out: 0,
    falhas: 0,
    detalheFalhas: [],
  }

  const supabase = getSupabaseAdmin()
  if (!supabase || !link) return r

  const desde = new Date(Date.now() - JANELA_MS).toISOString()

  // Conversas com mensagem RECEBIDA na janela. É o que define janela aberta —
  // `last_message_at` não serve, porque sobe também com mensagem nossa.
  const { data: recebidas, error } = await supabase
    .from('inbox_messages')
    .select('conversation_id, inbox_conversations!inner(id, phone)')
    .eq('direction', 'inbound')
    .gte('created_at', desde)
    .limit(5000)

  if (error) {
    r.detalheFalhas.push(`Falha ao listar conversas: ${error.message}`)
    return r
  }

  // Uma conversa pode ter várias mensagens na janela; interessa uma vez só.
  const porConversa = new Map<string, string>()
  for (const row of recebidas || []) {
    const raw = (row as Record<string, unknown>).inbox_conversations
    const conv = (Array.isArray(raw) ? raw[0] : raw) as { id: string; phone: string } | null
    if (conv?.id && conv.phone) porConversa.set(conv.id, conv.phone)
  }
  r.elegiveis = porConversa.size
  if (porConversa.size === 0) return r

  // Opt-out: quem pediu para não receber não entra, mesmo tendo escrito.
  const telefones = [...porConversa.values()]
  const optOut = new Set<string>()
  const { data: contatos } = await supabase
    .from('contacts')
    .select('phone, status')
    .in('phone', telefones)
  for (const c of contatos || []) {
    if (String((c as { status?: string }).status || '').toLowerCase().includes('opt-out')) {
      optOut.add(String((c as { phone?: string }).phone || ''))
    }
  }

  const texto = mensagemContatoOficial(link)
  const pausar = deps.pausar ?? ((ms: number) => new Promise((res) => setTimeout(res, ms)))

  for (const [conversationId, phone] of porConversa) {
    if (optOut.has(phone)) {
      r.pulados_opt_out++
      continue
    }

    if (!(await precisaEnviarContatoOficial(conversationId, link))) {
      r.pulados_ja_receberam++
      continue
    }

    if (r.simulacao) {
      r.enviados++ // quantos receberiam
      continue
    }

    try {
      const enviado = await deps.enviar({ to: phone, texto })
      if (enviado.success && enviado.messageId) {
        await deps.registrar({ conversationId, texto, messageId: enviado.messageId })
        r.enviados++
      } else {
        r.falhas++
        if (r.detalheFalhas.length < 10) r.detalheFalhas.push(`${phone}: ${enviado.error || 'erro desconhecido'}`)
      }
    } catch (e) {
      r.falhas++
      if (r.detalheFalhas.length < 10) {
        r.detalheFalhas.push(`${phone}: ${e instanceof Error ? e.message : 'erro'}`)
      }
    }

    await pausar(INTERVALO_MS)
  }

  return r
}
