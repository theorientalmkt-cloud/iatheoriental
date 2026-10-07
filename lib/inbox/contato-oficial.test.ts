import { describe, it, expect, vi, beforeEach } from 'vitest'

let encontrados: Array<{ id: string }> = []
let erro: { message: string } | null = null
/** Filtros aplicados, para conferir que a busca é da conversa e só das nossas. */
let aplicados: string[] = []

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q,
        eq: (c: string, v: unknown) => { aplicados.push(`eq:${c}=${v}`); return q },
        ilike: (c: string, v: unknown) => { aplicados.push(`ilike:${c}=${v}`); return q },
        limit: () => Promise.resolve({ data: erro ? null : encontrados, error: erro }),
      })
      return q
    },
  }),
}))

import { precisaEnviarContatoOficial, mensagemContatoOficial } from './contato-oficial'

const LINK = 'https://wa.me/5511973832745'

beforeEach(() => {
  encontrados = []
  erro = null
  aplicados = []
})

describe('envio único do WhatsApp oficial por conversa', () => {
  it('envia quando a conversa ainda não recebeu o link', async () => {
    expect(await precisaEnviarContatoOficial('conv_1', LINK)).toBe(true)
  })

  it('não repete quando o link já foi enviado', async () => {
    encontrados = [{ id: 'msg_1' }]

    expect(await precisaEnviarContatoOficial('conv_1', LINK)).toBe(false)
  })

  it('procura só nas mensagens daquela conversa, e só nas nossas', async () => {
    await precisaEnviarContatoOficial('conv_42', LINK)

    expect(aplicados).toContain('eq:conversation_id=conv_42')
    expect(aplicados).toContain('eq:direction=outbound')
  })

  it('procura pelo número, ignorando o protocolo e o texto ao redor', async () => {
    // O link pode ter sido enviado dentro de outra frase (ex.: após a reserva
    // confirmada). Casar só a URL exata deixaria passar e repetiria o envio.
    await precisaEnviarContatoOficial('conv_1', LINK)

    expect(aplicados).toContain('ilike:content=%wa.me/5511973832745%')
  })

  it('sem número configurado, não envia nada', async () => {
    expect(await precisaEnviarContatoOficial('conv_1', '')).toBe(false)
  })

  it('em falha na consulta, prefere não enviar', async () => {
    // Repetir o link para quem já recebeu incomoda mais do que atrasar para
    // quem ainda não recebeu.
    erro = { message: 'timeout' }

    expect(await precisaEnviarContatoOficial('conv_1', LINK)).toBe(false)
  })
})

describe('mensagem com o número oficial de reservas', () => {
  it('traz o link completo, clicável no WhatsApp', () => {
    expect(mensagemContatoOficial(LINK)).toContain(LINK)
  })

  it('diz que é para reserva, não só atendimento genérico', () => {
    // A campanha saiu com o link errado; a mensagem precisa deixar claro para
    // que serve o número, senão o cliente ignora como assinatura.
    expect(mensagemContatoOficial(LINK)).toMatch(/para reservas e atendimento/i)
  })

  it('pede o contato de forma explícita', () => {
    expect(mensagemContatoOficial(LINK)).toMatch(/é só chamar/i)
  })

  it('identifica a casa, para o cliente saber de quem é o número', () => {
    expect(mensagemContatoOficial(LINK)).toContain('The Oriental Sushiya')
  })
})
