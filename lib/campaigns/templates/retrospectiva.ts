/**
 * Template da campanha do Menu Retrospectiva 2.0.
 *
 * Definido em código e validado contra o CreateTemplateSchema em teste, para
 * que erro de formato apareça aqui e não numa recusa da Meta — a revisão leva
 * horas, e cada reprovação conta contra a qualidade da conta.
 *
 * O preço e os horários vêm do catálogo (lib/menus/catalog.ts), a mesma fonte
 * que a IA e a reserva usam. Se o menu trocar, o teste acusa o template
 * desatualizado em vez de a campanha sair anunciando um menu encerrado — que
 * foi exatamente o que aconteceu com o Nippon.
 *
 * NÃO é submetido automaticamente. Criar e submeter um template é ação
 * externa, e disparar a campanha fala com clientes reais.
 */

import { menuById } from '@/lib/menus/catalog'

const menu = menuById('Retrospectiva')

/**
 * Nome do template na Meta: minúsculas, números e underscore.
 *
 * Versionado no nome (`_v1`) porque template aprovado não pode ser editado —
 * mudança de texto exige criar outro. Sem o sufixo, o próximo vira
 * "retrospectiva_2_final_agora".
 */
export const RETROSPECTIVA_TEMPLATE_NAME = 'oriental_retrospectiva_ultimas_semanas_v1'

/** Corpo da mensagem. Separado para revisar a redação sem depender do upload. */
export const RETROSPECTIVA_BODY =
  'Olá, {{1}}! As últimas semanas do nosso Menu Retrospectiva 2.0 começaram.\n\n' +
  'São os melhores pratos dos menus 5, 6 e 7 reunidos em uma experiência de 19 etapas: ' +
  '12 do sushibar, 5 da cozinha, sobremesa e chá especial.\n\n' +
  `Jantar de terça a sábado, às 19h ou 21h. R$ ${menu.precoPorPessoa} por pessoa.\n\n` +
  'Se você ainda não veio, essa é a hora de viver essa experiência.'

/**
 * Monta o template para criação.
 *
 * @param headerHandle handle devolvido pelo upload da arte à Meta. Cabeçalho
 *   de imagem sem handle é recusado na validação — por isso é obrigatório, e
 *   não um campo que se esquece de preencher.
 */
export function buildRetrospectivaTemplate(headerHandle: string) {
  if (!headerHandle?.trim()) {
    throw new Error('headerHandle obrigatório: faça o upload da arte antes de criar o template.')
  }

  return {
    name: RETROSPECTIVA_TEMPLATE_NAME,
    language: 'pt_BR',
    category: 'MARKETING' as const,
    parameter_format: 'positional' as const,

    // A arte do menu entra como cabeçalho de imagem.
    header: {
      format: 'IMAGE' as const,
      example: { header_handle: [headerHandle] },
    },

    body: {
      text: RETROSPECTIVA_BODY,
      // A Meta exige um exemplo por variável, senão recusa na revisão.
      example: { body_text: [['Maria']] },
    },

    footer: {
      text: 'The Oriental Sushiya - Mirandópolis',
    },

    // Quick reply: a resposta cai no inbox e a IA assume a conversa. Botão de
    // URL apontando para wa.me é bloqueado pela política da Meta.
    buttons: [
      { type: 'QUICK_REPLY' as const, text: 'Quero reservar' },
      { type: 'QUICK_REPLY' as const, text: 'Ver mais detalhes' },
    ],
  }
}
