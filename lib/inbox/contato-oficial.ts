/**
 * O WhatsApp oficial já foi enviado nesta conversa?
 *
 * O envio era amarrado à PRIMEIRA resposta da conversa. Funciona para quem
 * chega agora e deixa de fora exatamente quem já está conversando — as
 * conversas em andamento nunca receberiam o link, por mais que o cliente
 * precisasse falar com a equipe.
 *
 * A pergunta certa não é "é a primeira resposta?", e sim "esta conversa já
 * recebeu o link?". Assim toda conversa viva recebe na próxima resposta da IA,
 * uma única vez, sem disparo em massa.
 */

import { getSupabaseAdmin } from '@/lib/supabase'

/**
 * Mensagem com o número oficial de reservas.
 *
 * Fica num lugar só porque sai por duas vias — a resposta da IA e o disparo
 * retroativo — e texto duplicado diverge na primeira edição. Foi esse padrão
 * que já custou caro aqui, com menu e horários escritos em dois lugares.
 *
 * O propósito é corrigir rota: a campanha saiu com o link errado, então o
 * cliente precisa receber o número certo e um convite claro a usá-lo.
 */
export function mensagemContatoOficial(link: string): string {
  return (
    'Para reservas e atendimento, fale com a nossa equipe no WhatsApp oficial ' +
    `do The Oriental Sushiya: ${link}\n\n` +
    'É só chamar por lá que a gente te atende.'
  )
}

/** Trecho que identifica o link na mensagem, independente do texto ao redor. */
function marcador(link: string): string {
  // "https://wa.me/5511973832745" -> "wa.me/5511973832745"
  return link.replace(/^https?:\/\//, '')
}

/**
 * true se o link ainda não apareceu em nenhuma mensagem nossa desta conversa.
 *
 * Em caso de falha na consulta devolve `false` (não envia): repetir o link
 * para quem já recebeu é pior do que atrasar para quem ainda não recebeu.
 */
export async function precisaEnviarContatoOficial(
  conversationId: string,
  link: string
): Promise<boolean> {
  if (!link) return false

  const supabase = getSupabaseAdmin()
  if (!supabase) return false

  const { data, error } = await supabase
    .from('inbox_messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('direction', 'outbound')
    .ilike('content', `%${marcador(link)}%`)
    .limit(1)

  if (error) {
    console.warn('[contato-oficial] Falha ao checar envio anterior:', error.message)
    return false
  }

  return (data || []).length === 0
}
