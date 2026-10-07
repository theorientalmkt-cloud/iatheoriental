import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Linha { conversation_id: string; inbox_conversations: { id: string; phone: string } }

let inbound: Linha[] = []
let contatos: Array<{ phone: string; status: string }> = []
/** Conversas que JÁ receberam o link. */
let jaReceberam = new Set<string>()
let filtros: string[] = []

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (tabela: string) => {
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q,
        eq: (c: string, v: unknown) => { filtros.push(`eq:${c}=${v}`); return q },
        gte: (c: string, v: unknown) => { filtros.push(`gte:${c}`); return q },
        in: () => q,
        ilike: () => q,
        limit: () => Promise.resolve({ data: tabela === 'contacts' ? contatos : inbound, error: null }),
        then: (resolve: (v: unknown) => void) =>
          Promise.resolve({ data: tabela === 'contacts' ? contatos : inbound, error: null }).then(resolve),
      })
      return q
    },
  }),
}))

vi.mock('./contato-oficial', () => ({
  precisaEnviarContatoOficial: (conversationId: string) =>
    Promise.resolve(!jaReceberam.has(conversationId)),
}))

import { dispararContatoOficial } from './broadcast-contato-oficial'

const LINK = 'https://wa.me/5511973832745'

const conversa = (id: string, phone: string): Linha => ({
  conversation_id: id,
  inbox_conversations: { id, phone },
})

const enviados: Array<{ to: string; texto: string }> = []
const registrados: string[] = []

const deps = {
  enviar: async ({ to, texto }: { to: string; texto: string }) => {
    enviados.push({ to, texto })
    return { success: true, messageId: `msg_${enviados.length}` }
  },
  registrar: async ({ conversationId }: { conversationId: string }) => {
    registrados.push(conversationId)
  },
  pausar: async () => {},
}

beforeEach(() => {
  inbound = []
  contatos = []
  jaReceberam = new Set()
  filtros = []
  enviados.length = 0
  registrados.length = 0
})

describe('simulação é o padrão', () => {
  it('sem confirmar, não envia nada — só conta quem receberia', async () => {
    inbound = [conversa('c1', '+5511999990001'), conversa('c2', '+5511999990002')]

    const r = await dispararContatoOficial(LINK, {}, deps)

    expect(r.simulacao).toBe(true)
    expect(r.enviados).toBe(2)
    expect(enviados).toHaveLength(0) // nada saiu de verdade
  })

  it('com confirmar, envia e registra cada mensagem', async () => {
    inbound = [conversa('c1', '+5511999990001')]

    const r = await dispararContatoOficial(LINK, { confirmar: true }, deps)

    expect(r.simulacao).toBe(false)
    expect(enviados).toEqual([{ to: '+5511999990001', texto: expect.stringContaining(LINK) }])
    expect(registrados).toEqual(['c1'])
  })
})

describe('salvaguardas', () => {
  it('só considera conversa com mensagem RECEBIDA na janela', async () => {
    // `last_message_at` sobe também com mensagem nossa e não serviria: diria
    // janela aberta onde a Meta recusaria o envio.
    await dispararContatoOficial(LINK, {}, deps)

    expect(filtros).toContain('eq:direction=inbound')
    expect(filtros).toContain('gte:created_at')
  })

  it('não repete para quem já recebeu o link', async () => {
    inbound = [conversa('c1', '+5511999990001'), conversa('c2', '+5511999990002')]
    jaReceberam.add('c1')

    const r = await dispararContatoOficial(LINK, { confirmar: true }, deps)

    expect(r.pulados_ja_receberam).toBe(1)
    expect(enviados.map((e) => e.to)).toEqual(['+5511999990002'])
  })

  it('pula contato em opt-out, mesmo tendo escrito no inbox', async () => {
    // Ter respondido não revoga o pedido de não receber mensagens.
    inbound = [conversa('c1', '+5511999990001'), conversa('c2', '+5511999990002')]
    contatos = [{ phone: '+5511999990001', status: 'Opt-out' }]

    const r = await dispararContatoOficial(LINK, { confirmar: true }, deps)

    expect(r.pulados_opt_out).toBe(1)
    expect(enviados.map((e) => e.to)).toEqual(['+5511999990002'])
  })

  it('a mesma conversa com várias mensagens recebe uma vez só', async () => {
    inbound = [conversa('c1', '+5511999990001'), conversa('c1', '+5511999990001')]

    const r = await dispararContatoOficial(LINK, { confirmar: true }, deps)

    expect(r.elegiveis).toBe(1)
    expect(enviados).toHaveLength(1)
  })

  it('sem link configurado, não faz nada', async () => {
    inbound = [conversa('c1', '+5511999990001')]

    const r = await dispararContatoOficial('', { confirmar: true }, deps)

    expect(r.elegiveis).toBe(0)
    expect(enviados).toHaveLength(0)
  })
})

describe('falha de envio', () => {
  it('uma falha não interrompe o resto do disparo', async () => {
    inbound = [conversa('c1', '+5511999990001'), conversa('c2', '+5511999990002')]
    const comFalha = {
      ...deps,
      enviar: async ({ to, texto }: { to: string; texto: string }) => {
        if (to.endsWith('0001')) return { success: false, error: 'fora da janela' }
        enviados.push({ to, texto })
        return { success: true, messageId: 'msg_ok' }
      },
    }

    const r = await dispararContatoOficial(LINK, { confirmar: true }, comFalha)

    expect(r.falhas).toBe(1)
    expect(r.enviados).toBe(1)
    expect(r.detalheFalhas[0]).toContain('fora da janela')
  })
})
