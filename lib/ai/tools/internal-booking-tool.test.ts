import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock do Supabase: o objetivo aqui é a VALIDAÇÃO de entrada do confirmBooking,
// não o banco. Guardamos o que seria inserido para conferir o party_size gravado.
const inserted: Record<string, unknown>[] = []
let existingRows: Record<string, unknown>[] = []

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
        then: (resolve: (v: unknown) => void) => resolve({ data: existingRows, error: null }),
        insert: (row: Record<string, unknown>) => {
          inserted.push(row)
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'res_1' }, error: null }),
            }),
          }
        },
      }
      return q
    },
  }),
}))

import { confirmBooking } from './internal-booking-tool'

// Jantar Nippon: terça, 19h. Data futura para passar pela antecedência mínima.
const SLOT = '2027-03-02T19:00:00'

const base = {
  slotStart: SLOT,
  customerName: 'Fulano de Tal',
  customerPhone: '5511999998888',
  service: '[PENDENTE] Nippon',
}

beforeEach(() => {
  inserted.length = 0
  existingRows = []
})

describe('confirmBooking — número de pessoas é tipado, não extraído de prosa', () => {
  it('grava exatamente o partySize informado', async () => {
    const r = await confirmBooking({ ...base, partySize: 6, hasPet: false, allergies: 'Nenhuma' })

    expect(r.success).toBe(true)
    expect(inserted[0].party_size).toBe(6)
  })

  it('REGRESSÃO: texto não-numérico em notes não faz a reserva virar 1 pessoa', async () => {
    // Antes, party_size saía de um regex sobre `notes` e caía em 1 quando o
    // padrão não casava — o turno era vendido além da lotação em silêncio.
    const r = await confirmBooking({
      ...base,
      partySize: 6,
      hasPet: false,
      allergies: 'Nenhuma',
      notes: 'Pessoas: seis\nMenu: Nippon',
    })

    expect(r.success).toBe(true)
    expect(inserted[0].party_size).toBe(6)
    expect(inserted[0].party_size).not.toBe(1)
  })

  it('recusa partySize ausente ou inválido em vez de assumir 1', async () => {
    for (const bad of [0, -2, 1.5, Number.NaN, undefined as unknown as number]) {
      const r = await confirmBooking({ ...base, partySize: bad, hasPet: false, allergies: 'Nenhuma' })

      expect(r.success).toBe(false)
      expect(r.error).toMatch(/inválido/i)
    }
    expect(inserted).toHaveLength(0)
  })

  it('recusa grupo acima da lotação da casa', async () => {
    const r = await confirmBooking({ ...base, partySize: 10, hasPet: false, allergies: 'Nenhuma' })

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/no máximo 9/i)
    expect(inserted).toHaveLength(0)
  })
})

describe('confirmBooking — pet e alergias vêm tipados', () => {
  it('pet declarado em prosa livre não é mais o que decide o local', async () => {
    // `hasPet: true` manda, mesmo com notes escrito de forma que o regex antigo
    // (/Pet\s*:\s*sim/i) não casaria.
    const r = await confirmBooking({
      ...base,
      partySize: 2,
      hasPet: true,
      allergies: 'Nenhuma',
      notes: 'Pet: vai levar um cachorro pequeno',
    })

    expect(r.success).toBe(true)
    expect(inserted[0].location).toBe('Deck/janela (pet)')
  })

  it('sem pet, o local fica a cargo da equipe', async () => {
    await confirmBooking({ ...base, partySize: 2, hasPet: false, allergies: 'Nenhuma' })

    expect(inserted[0].location).toBe('A definir pela equipe')
  })

  it('"Nenhuma" (em qualquer caixa) não vira anotação de alergia', async () => {
    for (const v of ['Nenhuma', 'nenhuma', '  NENHUM  ', '']) {
      inserted.length = 0
      await confirmBooking({ ...base, partySize: 2, hasPet: false, allergies: v })

      expect(inserted[0].allergy_notes).toBeNull()
    }
  })

  it('alergia real é registrada, sem espaços sobrando', async () => {
    await confirmBooking({ ...base, partySize: 2, hasPet: false, allergies: '  camarão e lagosta  ' })

    expect(inserted[0].allergy_notes).toBe('camarão e lagosta')
  })
})
