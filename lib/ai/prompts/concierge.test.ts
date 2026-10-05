import { describe, it, expect } from 'vitest'
import { CONCIERGE_PROMPT } from './concierge'
import { buildMenuRulesBlock } from '@/lib/menus/catalog'

describe('prompt do concierge — o que NÃO pode voltar', () => {
  const p = CONCIERGE_PROMPT.toLowerCase()

  it('não cita menus fora de cartaz', () => {
    // A IA anunciou o Nippon a clientes depois de ele sair. O catálogo é a
    // fonte do que está em cartaz; o prompt não repete nome de menu.
    expect(p).not.toContain('nippon')
    expect(p).not.toContain('furusato')
    expect(p).not.toContain('retrospectiva')
  })

  it('não cita menu sazonal vencido', () => {
    expect(p).not.toContain('namorados')
    expect(p).not.toContain('1290')
  })

  it('não repete preço de menu — preço mora no catálogo', () => {
    expect(p).not.toContain('r$ 380')
    expect(p).not.toContain('r$ 210')
  })

  it('não repete horários de turno — turno mora no catálogo', () => {
    // A duplicação é o que gerava contradição: a REGRA 4 dizia "XP APENAS 13h"
    // e a seção 3 anunciava "Sex: Almoço 12h-15h".
    expect(CONCIERGE_PROMPT).not.toMatch(/almoço\s+12h/i)
    expect(CONCIERGE_PROMPT).not.toMatch(/ter(ça)?\s*a\s*s[áa]b/i)
  })

  it('não manda a IA desconfiar da ferramenta', () => {
    // O prompt antigo dizia: "Se a ferramenta checkAvailability retornar algum
    // horário diferente desses, IGNORE" — texto estático vencendo o banco.
    expect(CONCIERGE_PROMPT).not.toMatch(/ignore/i)
  })

  it('não ensina a montar link wa.me — o código já tem o telefone', () => {
    expect(p).not.toContain('wa.me')
  })

  it('não descreve o bloco de notes que virou argumento tipado', () => {
    expect(CONCIERGE_PROMPT).not.toMatch(/STATUS:\s*PENDENTE/i)
    expect(CONCIERGE_PROMPT).not.toMatch(/\[PENDENTE\]/)
  })

  it('não contém aritmética de taxa de no-show', () => {
    expect(CONCIERGE_PROMPT).not.toMatch(/R\$\s*100\s*x/i)
    expect(CONCIERGE_PROMPT).not.toMatch(/R\$\s*50\s*x/i)
  })
})

describe('prompt do concierge — o que precisa continuar valendo', () => {
  it('mantém a persona e a proibição de emoji', () => {
    expect(CONCIERGE_PROMPT).toContain('The Oriental Sushiya')
    expect(CONCIERGE_PROMPT).toMatch(/nunca use emojis/i)
  })

  it('mantém a barreira contra inventar histórico do cliente', () => {
    expect(CONCIERGE_PROMPT).toMatch(/cliente recorrente/i)
    expect(CONCIERGE_PROMPT).toMatch(/em nossos registros/i)
  })

  it('mantém a regra de não consultar disponibilidade sem pedido', () => {
    expect(CONCIERGE_PROMPT).toContain('checkAvailability')
    expect(CONCIERGE_PROMPT).toMatch(/campanha de marketing/i)
  })

  it('mantém a coleta obrigatória antes da reserva', () => {
    expect(CONCIERGE_PROMPT).toMatch(/nome completo/i)
    expect(CONCIERGE_PROMPT).toMatch(/alergia/i)
    expect(CONCIERGE_PROMPT).toMatch(/pet/i)
  })

  it('mantém a regra de não perguntar o local da mesa', () => {
    expect(CONCIERGE_PROMPT).toMatch(/nunca pergunte "prefere balcão ou deck"/i)
  })

  it('mantém a resposta única de LGPD, sem explicação extra', () => {
    expect(CONCIERGE_PROMPT).toMatch(/por política de privacidade/i)
  })

  it('mantém a saudação usada só na primeira mensagem', () => {
    expect(CONCIERGE_PROMPT).toMatch(/bem-vindo ao the oriental sushiya/i)
    expect(CONCIERGE_PROMPT).toMatch(/nunca repita essa saudação/i)
  })

  it('aponta para os blocos gerados em vez de repetir o conteúdo', () => {
    expect(CONCIERGE_PROMPT).toContain('MENUS E HORÁRIOS')
    expect(CONCIERGE_PROMPT).toContain('DADOS DA LOJA')
  })
})

describe('prompt + catálogo não se contradizem', () => {
  it('o preço e os turnos aparecem uma única vez, no bloco gerado', () => {
    const bloco = buildMenuRulesBlock()

    expect(bloco).toContain('R$ 380')
    expect(CONCIERGE_PROMPT).not.toContain('R$ 380')

    expect(bloco).toContain('19h ou 21h')
    expect(CONCIERGE_PROMPT).not.toContain('19h ou 21h')
  })
})

describe('tamanho', () => {
  it('cabe bem abaixo do prompt antigo de ~4.000 palavras', () => {
    const palavras = CONCIERGE_PROMPT.trim().split(/\s+/).length
    expect(palavras).toBeLessThan(1400)
  })
})
