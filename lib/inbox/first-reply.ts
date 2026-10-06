/**
 * Esta é a primeira resposta da conversa?
 *
 * É o gatilho do envio da arte do menu. Fica aqui, e não embutido na rota,
 * para poder ser testado: enviar a arte duas vezes, ou nunca, é visível para
 * o cliente.
 *
 * Importante: o histórico precisa ter sido carregado ANTES do envio da
 * resposta atual. "Nenhuma mensagem nossa no histórico" é o que significa
 * primeira resposta — se a chamada vier depois de gravar a resposta, o
 * resultado é sempre false.
 */
export function isFirstReply(messages: Array<{ direction: string }>): boolean {
  return !messages.some((m) => m.direction === 'outbound')
}
