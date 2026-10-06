import { describe, it, expect, vi, beforeEach } from 'vitest'

// Linhas que o mock devolve, por tabela.
let campaignRows: Record<string, unknown>[] = []
let inboxRows: Record<string, unknown>[] = []
/** Filtros aplicados, para conferir que as opções viram consulta. */
let applied: string[] = []

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const rows = table === 'campaign_contacts' ? campaignRows : inboxRows
      let served = false
      // O builder do Supabase é "thenable": todo método devolve ele mesmo e a
      // consulta só dispara no await. O mock precisa ser igual, senão a cadeia
      // quebra no primeiro filtro aplicado depois do .range().
      const q: Record<string, unknown> = {}
      const chain = () => q
      Object.assign(q, {
        select: chain,
        eq: (c: string, v: unknown) => { applied.push(`eq:${c}=${v}`); return q },
        neq: (c: string, v: unknown) => { applied.push(`neq:${c}=${v}`); return q },
        not: (c: string, op: string) => { applied.push(`not:${c}:${op}`); return q },
        gte: (c: string, v: unknown) => { applied.push(`gte:${c}=${v}`); return q },
        in: (c: string, v: unknown[]) => { applied.push(`in:${c}=${v.join('|')}`); return q },
        order: chain,
        range: chain,
        // Primeira página devolve tudo; a segunda vem vazia e encerra o laço.
        then: (resolve: (v: unknown) => void) => {
          const page = served ? [] : rows
          served = true
          return Promise.resolve({ data: page, error: null }).then(resolve)
        },
      })
      return q
    },
  }),
}))

import { fetchReachedAudience } from './reached'

const campanha = (phone: string, sent_at: string, extra: Record<string, unknown> = {}) => ({
  phone, contact_id: null, name: null, sent_at, delivered_at: null, read_at: null, ...extra,
})

const inbox = (phone: string, created_at: string, extra: Record<string, unknown> = {}) => ({
  created_at, delivered_at: null, delivery_status: 'sent',
  inbox_conversations: { phone, contact_id: null }, ...extra,
})

beforeEach(() => {
  campaignRows = []
  inboxRows = []
  applied = []
})

describe('público alcançado — união das duas origens', () => {
  it('soma campanha e inbox', async () => {
    campaignRows = [campanha('+5511999990001', '2026-09-01T10:00:00Z')]
    inboxRows = [inbox('+5511999990002', '2026-09-02T10:00:00Z')]

    const r = await fetchReachedAudience()

    expect(r.total).toBe(2)
    expect(r.bySource).toEqual({ campanha: 1, inbox: 1 })
  })

  it('o mesmo telefone nas duas origens conta uma vez só', async () => {
    campaignRows = [campanha('+5511999990001', '2026-09-01T10:00:00Z')]
    inboxRows = [inbox('+5511999990001', '2026-09-05T10:00:00Z')]

    const r = await fetchReachedAudience()

    expect(r.total).toBe(1)
    expect(r.contacts[0].sources.sort()).toEqual(['campanha', 'inbox'])
    expect(r.contacts[0].messageCount).toBe(2)
  })

  it('telefone escrito de formas diferentes é a mesma pessoa', async () => {
    // Sem normalizar, a campanha sairia duplicada para o mesmo número.
    campaignRows = [
      campanha('+55 11 99999-0001', '2026-09-01T10:00:00Z'),
      campanha('5511999990001', '2026-09-03T10:00:00Z'),
    ]

    const r = await fetchReachedAudience()

    expect(r.total).toBe(1)
    expect(r.contacts[0].messageCount).toBe(2)
  })

  it('guarda o primeiro e o último contato', async () => {
    campaignRows = [
      campanha('+5511999990001', '2026-09-01T10:00:00Z'),
      campanha('+5511999990001', '2026-09-20T10:00:00Z'),
      campanha('+5511999990001', '2026-09-10T10:00:00Z'),
    ]

    const r = await fetchReachedAudience()

    expect(r.contacts[0].firstReachedAt).toBe('2026-09-01T10:00:00Z')
    expect(r.contacts[0].lastReachedAt).toBe('2026-09-20T10:00:00Z')
  })

  it('telefone inválido não entra no público', async () => {
    campaignRows = [campanha('', '2026-09-01T10:00:00Z'), campanha('123', '2026-09-01T10:00:00Z')]

    const r = await fetchReachedAudience()

    expect(r.total).toBe(0)
  })

  it('ordena do contato mais recente para o mais antigo', async () => {
    campaignRows = [
      campanha('+5511999990001', '2026-09-01T10:00:00Z'),
      campanha('+5511999990002', '2026-09-30T10:00:00Z'),
    ]

    const r = await fetchReachedAudience()

    expect(r.contacts.map((c) => c.phone)).toEqual(['+5511999990002', '+5511999990001'])
  })
})

describe('filtros', () => {
  it('source restringe a origem consultada', async () => {
    campaignRows = [campanha('+5511999990001', '2026-09-01T10:00:00Z')]
    inboxRows = [inbox('+5511999990002', '2026-09-02T10:00:00Z')]

    const r = await fetchReachedAudience({ source: 'campanha' })

    expect(r.total).toBe(1)
    expect(r.contacts[0].phone).toBe('+5511999990001')
  })

  it('since vira filtro na consulta, não corte em memória', async () => {
    campaignRows = [campanha('+5511999990001', '2026-09-10T10:00:00Z')]

    await fetchReachedAudience({ since: '2026-09-01' })

    expect(applied).toContain('gte:sent_at=2026-09-01')
    expect(applied).toContain('gte:created_at=2026-09-01')
  })

  it('onlyDelivered exige confirmação de entrega nas duas origens', async () => {
    await fetchReachedAudience({ onlyDelivered: true })

    expect(applied).toContain('not:delivered_at:is')
    expect(applied).toContain('in:delivery_status=delivered|read')
  })

  it('só conta mensagem que saiu — inbound não é alcance', async () => {
    await fetchReachedAudience({ source: 'inbox' })

    expect(applied).toContain('eq:direction=outbound')
    expect(applied).toContain('neq:delivery_status=failed')
  })
})

describe('sem banco configurado', () => {
  it('devolve público vazio em vez de explodir', async () => {
    vi.resetModules()
    vi.doMock('@/lib/supabase', () => ({ getSupabaseAdmin: () => null }))
    const { fetchReachedAudience: fn } = await import('./reached')

    const r = await fn()

    expect(r).toEqual({ contacts: [], total: 0, bySource: { campanha: 0, inbox: 0 } })
    vi.doUnmock('@/lib/supabase')
    vi.resetModules()
  })
})
