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

  it('proíbe informar disponibilidade, em qualquer forma', () => {
    // A IA não enxerga a agenda. Dizer que há (ou não há) vaga seria inventar.
    expect(CONCIERGE_PROMPT).toMatch(/NUNCA informe disponibilidade/i)
    expect(CONCIERGE_PROMPT).toMatch(/nunca diga quantos lugares restam/i)
    expect(CONCIERGE_PROMPT).toMatch(/nunca afirme nem negue que há vaga/i)
  })

  it('manda encaminhar a reserva para o WhatsApp oficial', () => {
    expect(CONCIERGE_PROMPT).toMatch(/As reservas são feitas direto com a nossa equipe/i)
  })

  it('não promete reserva nem confirma pedido', () => {
    expect(CONCIERGE_PROMPT).toMatch(/nunca prometa, confirme ou registre uma reserva/i)
  })

  it('não coleta mais dados de reserva — isso é da equipe', () => {
    expect(CONCIERGE_PROMPT).not.toMatch(/preciso de 3 informações/i)
    expect(CONCIERGE_PROMPT).not.toContain('confirmBooking')
    expect(CONCIERGE_PROMPT).not.toContain('checkAvailability')
  })

  it('não decide mais o local da mesa', () => {
    expect(CONCIERGE_PROMPT).not.toMatch(/prefere balcão ou deck/i)
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

describe('caminho para o atendimento humano', () => {
  it('manda oferecer o WhatsApp oficial quando precisa de gente', () => {
    expect(CONCIERGE_PROMPT).toContain('Falar com a equipe')
    expect(CONCIERGE_PROMPT).toMatch(/whatsapp oficial do restaurante/i)
  })

  it('proíbe prometer encaminhamento sem dar o link', () => {
    // O prompt antigo dizia "vou direcionar você para nossa equipe" e parava
    // aí: o cliente ficava esperando um contato que nunca vinha.
    expect(CONCIERGE_PROMPT).toMatch(/nunca diga apenas "vou direcionar/i)
  })

  it('deixa claro que o link não substitui a reserva', () => {
    expect(CONCIERGE_PROMPT).toMatch(/você conduz normalmente até o fim/i)
  })

  it('não escreve o número no prompt — ele vem dos DADOS DA LOJA', () => {
    // Número fixo aqui divergiria do painel na primeira troca.
    expect(CONCIERGE_PROMPT).not.toContain('5511973832745')
    expect(CONCIERGE_PROMPT).not.toContain('97383-2745')
  })
})

describe('taxa de no-show — informada, sem calcular', () => {
  it('está na lista do que a IA pode e deve informar', () => {
    // A IA não reserva mais, mas a taxa é fato fixo do menu e o cliente
    // pergunta. Omitir viraria surpresa de cobrança lá na frente.
    expect(CONCIERGE_PROMPT).toMatch(/a taxa de no-show, que é um valor único por reserva/i)
  })

  it('deixa claro que só vale para quem falta', () => {
    expect(CONCIERGE_PROMPT).toMatch(/apenas em caso de não comparecimento/i)
  })

  it('proíbe multiplicar pelo número de pessoas', () => {
    // O prompt antigo mandava "R$ 100 x [pessoas]": um grupo de 6 era
    // informado de R$ 600 onde o certo são R$ 100.
    expect(CONCIERGE_PROMPT).toMatch(/nunca multiplicada pelo número de pessoas/i)
  })

  it('não escreve o valor — ele vem do catálogo', () => {
    expect(CONCIERGE_PROMPT).not.toMatch(/taxa de no-show[^.\n]*R\$\s*\d/i)
  })

  it('mantém a taxa fora de negociação', () => {
    expect(CONCIERGE_PROMPT).toMatch(/Não negocie preços, taxa de no-show/i)
  })
})
