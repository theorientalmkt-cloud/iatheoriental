import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  MENUS,
  menuById,
  turnosForWeekday,
  isTurnoValido,
  noShowDaReserva,
  buildMenuRulesBlock,
  menuComArte,
  CAPACITY_TOTAL,
  DECK_CAPACITY,
} from './catalog'

// Dias: 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb

describe('turnos derivados do catálogo', () => {
  it('segunda não tem turno — a casa fecha', () => {
    expect(turnosForWeekday(1)).toEqual([])
  })

  it('terça e quarta têm só o jantar (19h e 21h)', () => {
    for (const wd of [2, 3]) {
      expect(turnosForWeekday(wd).map((t) => t.time)).toEqual(['19:00', '21:00'])
    }
  })

  it('quinta a sábado somam almoço XP e jantar, em ordem de horário', () => {
    for (const wd of [4, 5, 6]) {
      expect(turnosForWeekday(wd).map((t) => t.time)).toEqual(['13:00', '19:00', '21:00'])
    }
  })

  it('domingo tem só o almoço XP', () => {
    expect(turnosForWeekday(0).map((t) => t.time)).toEqual(['13:00'])
  })
})

describe('isTurnoValido — a REGRA 4 como checagem, não como instrução', () => {
  it('aceita os turnos reais', () => {
    expect(isTurnoValido(2, '19:00')).toBe(true)
    expect(isTurnoValido(6, '21:00')).toBe(true)
    expect(isTurnoValido(0, '13:00')).toBe(true)
  })

  it('recusa os horários que o prompt listava como inventados', () => {
    // O prompt proibia explicitamente estes; agora não passam.
    for (const h of ['12:00', '12:30', '13:30', '14:00', '15:00', '18:00', '20:00', '22:00']) {
      expect(isTurnoValido(5, h)).toBe(false)
    }
  })

  it('recusa turno em dia que ele não funciona', () => {
    expect(isTurnoValido(0, '19:00')).toBe(false) // jantar no domingo
    expect(isTurnoValido(2, '13:00')).toBe(false) // almoço XP na terça
    expect(isTurnoValido(1, '19:00')).toBe(false) // segunda, fechado
  })
})

describe('catálogo do menu vigente', () => {
  it('só o Retrospectiva 2.0 e o XP estão no ar', () => {
    expect(MENUS.map((m) => m.id).sort()).toEqual(['Retrospectiva', 'XP'])
  })

  it('menus encerrados não estão no catálogo', () => {
    // Nippon e Furusato saíram de cartaz; enquanto seguiram no prompt, a IA
    // anunciou a clientes um menu que não existia mais.
    const nomes = MENUS.map((m) => `${m.id} ${m.nome}`).join(' ').toLowerCase()
    expect(nomes).not.toContain('nippon')
    expect(nomes).not.toContain('furusato')
    expect(nomes).not.toContain('namorados')
  })

  it('preços e turnos batem com a arte vigente', () => {
    const r = menuById('Retrospectiva')
    expect(r.precoPorPessoa).toBe(380)
    expect(r.horarios).toEqual(['19:00', '21:00'])
    expect(r.dias).toEqual([2, 3, 4, 5, 6]) // Terça à Sábado

    const xp = menuById('XP')
    expect(xp.precoPorPessoa).toBe(210)
    expect(xp.horarios).toEqual(['13:00'])
  })

  it('id desconhecido falha alto, em vez de virar um menu qualquer', () => {
    expect(() => menuById('Nippon')).toThrow(/desconhecido/i)
  })
})

describe('taxa de no-show — valor da reserva, não por pessoa', () => {
  it('é o mesmo valor independente do tamanho do grupo', () => {
    // O prompt antigo mandava multiplicar ("R$ 100 x [pessoas]"), então um
    // grupo de 6 ouvia R$ 600 em vez de R$ 100.
    expect(noShowDaReserva('Retrospectiva')).toBe(100)
    expect(noShowDaReserva('XP')).toBe(50)
  })

  it('o bloco do prompt proíbe multiplicar', () => {
    expect(buildMenuRulesBlock()).toMatch(/NÃO multiplique pelo número de pessoas/i)
  })
})

describe('bloco de prompt gerado', () => {
  const bloco = buildMenuRulesBlock()

  it('traz o menu vigente com preço e horários', () => {
    expect(bloco).toContain('Menu Retrospectiva 2.0')
    expect(bloco).toContain('R$ 380 por pessoa')
    expect(bloco).toContain('Terça a Sábado')
    expect(bloco).toContain('APENAS 19h ou 21h')
  })

  it('não cita menus encerrados', () => {
    expect(bloco.toLowerCase()).not.toContain('nippon')
    expect(bloco.toLowerCase()).not.toContain('furusato')
  })

  it('diz que segunda é fechado', () => {
    expect(bloco).toMatch(/FECHADO: Segunda/)
  })

  it('não declara capacidade — a IA não aloca mesa nem conta lugar', () => {
    expect(bloco).not.toMatch(/lugares por turno/i)
    expect(bloco).not.toMatch(/deck\/janela/i)
  })

  it('deixa claro que é horário de funcionamento, não agenda', () => {
    // Sem isso a IA leria "jantar terça a sábado" como "há vaga terça a sábado".
    expect(bloco).toMatch(/horário de FUNCIONAMENTO, não a agenda/i)
    expect(bloco).toMatch(/disponibilidade é com a equipe/i)
    expect(bloco).not.toContain('checkAvailability')
  })
})

describe('arte do menu', () => {
  it('o menu vigente do jantar tem arte para enviar na saudação', () => {
    const m = menuComArte()

    expect(m?.id).toBe('Retrospectiva')
    expect(m?.arte).toBe('/menu/retrospectiva-2.jpg')
    expect(m?.arteLegenda).toBeTruthy()
  })

  it('a arte existe no disco, em public/', () => {
    const m = menuComArte()
    const caminho = path.join(process.cwd(), 'public', m!.arte!)

    expect(fs.existsSync(caminho)).toBe(true)
  })

  it('a arte cabe no limite de imagem da Meta (5 MB)', () => {
    const m = menuComArte()
    const bytes = fs.statSync(path.join(process.cwd(), 'public', m!.arte!)).size

    expect(bytes).toBeLessThan(5 * 1024 * 1024)
  })
})
