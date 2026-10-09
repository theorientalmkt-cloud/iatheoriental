/**
 * Roteiro de verificação do atendimento do The Oriental.
 *
 * Cobre as garantias que NÃO dependem do humor do modelo: o que a IA pode
 * oferecer, o que o sistema aceita gravar e o que é enviado por código.
 * Cada bloco corresponde a um passo que antes só se conferia conversando com
 * a IA no painel e olhando o banco depois.
 *
 * O que é julgamento do LLM (tom, intenção, condução) não está aqui —
 * isso se verifica conversando, e é justamente a parte que pode variar.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  turnosForWeekday,
  buildMenuRulesBlock,
  menuComArte,
  menuById,
  noShowDaReserva,
  CAPACITY_TOTAL,
} from '@/lib/menus/catalog'
import { CONCIERGE_PROMPT } from '@/lib/ai/prompts/concierge'
import { isFirstReply } from '@/lib/inbox/first-reply'
import { absoluteUrl } from '@/lib/base-url'

// Mock do banco: o foco é o que o sistema ACEITA gravar, não o Postgres.
const inserted: Record<string, unknown>[] = []

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        gte: () => q,
        lte: () => q,
        order: () => q,
        then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
        insert: (row: Record<string, unknown>) => {
          inserted.push(row)
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'res_1' }, error: null }) }) }
        },
      }
      return q
    },
  }),
}))

import { confirmBooking } from '@/lib/ai/tools/internal-booking-tool'

beforeEach(() => {
  inserted.length = 0
})

const msg = (direction: 'inbound' | 'outbound') => ({ direction })

describe('Passo 1 — "Oi": saudação e arte do menu', () => {
  it('a primeira resposta da conversa dispara o envio da arte', () => {
    expect(isFirstReply([msg('inbound')])).toBe(true)
  })

  it('conversa já em andamento não reenvia a arte', () => {
    expect(isFirstReply([msg('inbound'), msg('outbound'), msg('inbound')])).toBe(false)
  })

  it('a arte configurada é a do menu vigente', () => {
    expect(menuComArte()?.id).toBe('Retrospectiva')
  })

  it('a arte vira URL absoluta — a Meta não aceita caminho relativo', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://theoriental.com.br'
    const url = absoluteUrl(menuComArte()!.arte!)

    expect(url).toBe('https://theoriental.com.br/menu/retrospectiva-2.jpg')
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it('a saudação é só da primeira mensagem', () => {
    expect(CONCIERGE_PROMPT).toMatch(/nunca repita essa saudação/i)
  })
})

describe('Passo 2 — "Quanto custa?": responde sem consultar a agenda', () => {
  it('o preço vigente chega à IA pelo bloco gerado', () => {
    expect(buildMenuRulesBlock()).toContain('R$ 380 por pessoa')
    expect(menuById('Retrospectiva').precoPorPessoa).toBe(380)
  })

  it('pergunta de preço não autoriza consultar disponibilidade', () => {
    expect(CONCIERGE_PROMPT).toMatch(/"quanto custa\?".*NÃO autorizam a consulta/is)
  })
})

describe('Passo 3 — "Quero reservar sábado": turnos oferecidos', () => {
  it('sábado tem almoço XP e os dois jantares', () => {
    expect(turnosForWeekday(6).map((t) => t.time)).toEqual(['13:00', '19:00', '21:00'])
  })

  it('a IA pergunta a data antes de consultar', () => {
    expect(CONCIERGE_PROMPT).toMatch(/pergunte a data antes de qualquer consulta/i)
  })

  it('as vagas vêm da ferramenta, nunca do texto', () => {
    expect(buildMenuRulesBlock()).toMatch(/não contém vaga nenhuma/i)
  })
})

describe('Passo 4 — "Segunda tem?": dia fechado', () => {
  it('segunda não oferece turno nenhum', () => {
    expect(turnosForWeekday(1)).toEqual([])
  })

  it('o bloco diz que segunda é fechado', () => {
    expect(buildMenuRulesBlock()).toMatch(/FECHADO: Segunda/)
  })

  it('reserva na segunda é recusada pelo sistema, não só desencorajada', async () => {
    // 2027-03-01 é uma segunda-feira.
    const r = await confirmBooking({
      slotStart: '2027-03-01T19:00:00',
      customerName: 'Fulano de Tal',
      customerPhone: '5511999998888',
      partySize: 2,
      hasPet: false,
      allergies: 'Nenhuma',
    })

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/não abre neste dia/i)
    expect(inserted).toHaveLength(0)
  })
})

describe('Passo 5 — reserva para 6 pessoas grava 6', () => {
  // O bug original: o número saía de regex sobre prosa do LLM e virava 1 em
  // silêncio. A lotação era então calculada com o número errado.
  it('grava o grupo com o tamanho real', async () => {
    const r = await confirmBooking({
      slotStart: '2027-03-06T19:00:00', // sábado
      customerName: 'Fulano de Tal',
      customerPhone: '5511999998888',
      partySize: 6,
      hasPet: false,
      allergies: 'Nenhuma',
      notes: 'Pessoas: seis',
    })

    expect(r.success).toBe(true)
    expect(inserted[0].party_size).toBe(6)
  })

  it('o menu gravado vem do turno escolhido', async () => {
    await confirmBooking({
      slotStart: '2027-03-06T13:00:00', // sábado, almoço
      customerName: 'Fulano de Tal',
      customerPhone: '5511999998888',
      partySize: 2,
      hasPet: false,
      allergies: 'Nenhuma',
    })

    expect(inserted[0].menu_choice).toBe('XP')
  })

  it('grupo acima da lotação não entra', async () => {
    const r = await confirmBooking({
      slotStart: '2027-03-06T19:00:00',
      customerName: 'Fulano de Tal',
      customerPhone: '5511999998888',
      partySize: CAPACITY_TOTAL + 1,
      hasPet: false,
      allergies: 'Nenhuma',
    })

    expect(r.success).toBe(false)
    expect(inserted).toHaveLength(0)
  })
})

describe('Garantias transversais', () => {
  it('horário inventado não vira reserva', async () => {
    for (const hora of ['12:00', '14:00', '18:00', '20:00', '22:00']) {
      inserted.length = 0
      const r = await confirmBooking({
        slotStart: `2027-03-06T${hora}:00`,
        customerName: 'Fulano de Tal',
        customerPhone: '5511999998888',
        partySize: 2,
        hasPet: false,
        allergies: 'Nenhuma',
      })

      expect(r.success).toBe(false)
      expect(inserted).toHaveLength(0)
    }
  })

  it('a taxa de no-show é da reserva, não multiplicada por pessoa', () => {
    // Grupo de 6 paga a mesma taxa de uma mesa de 1. O prompt antigo mandava
    // multiplicar e informava R$ 600 onde o certo são R$ 100.
    expect(noShowDaReserva('Retrospectiva')).toBe(100)
    expect(noShowDaReserva('XP')).toBe(50)
  })

  it('pet só entra onde cabe pet', async () => {
    await confirmBooking({
      slotStart: '2027-03-06T19:00:00',
      customerName: 'Fulano de Tal',
      customerPhone: '5511999998888',
      partySize: 2,
      hasPet: true,
      allergies: 'Nenhuma',
    })

    expect(inserted[0].location).toBe('Deck/janela (pet)')
  })

  it('a IA não escolhe o local da mesa com o cliente', () => {
    expect(CONCIERGE_PROMPT).toMatch(/nunca pergunte "prefere balcão ou deck"/i)
  })

  it('dado de terceiro tem resposta única e fechada', () => {
    expect(CONCIERGE_PROMPT).toMatch(/por política de privacidade/i)
  })
})
