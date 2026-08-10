import { describe, it, expect } from 'vitest'
import { daysUntil, buildMenuContextBlock } from './menu-info'

describe('daysUntil — cálculo de dias até o fim do menu', () => {
  it('conta os dias corretamente (10/08 → 18/08 = 8 dias)', () => {
    expect(daysUntil('2026-08-18', '2026-08-10')).toBe(8)
  })
  it('último dia = 0', () => {
    expect(daysUntil('2026-08-18', '2026-08-18')).toBe(0)
  })
  it('vencido = negativo', () => {
    expect(daysUntil('2026-08-18', '2026-08-19')).toBe(-1)
    expect(daysUntil('2026-08-18', '2026-08-25')).toBe(-7)
  })
  it('data inexistente (30/02) = null (não calcula lixo)', () => {
    expect(daysUntil('2026-02-30', '2026-08-10')).toBeNull()
  })
  it('vazio = null', () => {
    expect(daysUntil('', '2026-08-10')).toBeNull()
  })
  it('não depende da ordem dos meses/anos (virada de ano)', () => {
    expect(daysUntil('2027-01-02', '2026-12-31')).toBe(2)
  })
})

describe('buildMenuContextBlock — o que a IA recebe (data VERBATIM)', () => {
  it('crava a data e o "faltam N dias"', () => {
    const b = buildMenuContextBlock(
      { nome: 'Omakase Nippon', validoAte: '2026-08-18', nota: '' },
      '2026-08-10'
    )
    expect(b).toContain('válido até 2026-08-18')
    expect(b).toContain('faltam 8 dias')
    expect(b).toContain('Omakase Nippon')
  })
  it('nos últimos 3 dias, pede urgência', () => {
    const b = buildMenuContextBlock({ nome: '', validoAte: '2026-08-18', nota: '' }, '2026-08-16')
    expect(b).toContain('faltam só 2 dia(s)')
    expect(b).toContain('urgência')
  })
  it('último dia = urgência máxima', () => {
    const b = buildMenuContextBlock({ nome: '', validoAte: '2026-08-18', nota: '' }, '2026-08-18')
    expect(b).toContain('ÚLTIMO DIA')
  })
  it('vencido = avisa que mudou e NÃO oferece o vencido', () => {
    const b = buildMenuContextBlock({ nome: '', validoAte: '2026-08-18', nota: '' }, '2026-08-25')
    expect(b).toContain('VENCEU em 2026-08-18')
    expect(b).toContain('NÃO ofereça o menu vencido')
  })
  it('inclui a observação quando houver', () => {
    const b = buildMenuContextBlock(
      { nome: 'X', validoAte: '2026-08-18', nota: 'degustação de 7 tempos' },
      '2026-08-10'
    )
    expect(b).toContain('degustação de 7 tempos')
  })
  it('sem data configurada = não injeta NADA (IA não inventa)', () => {
    expect(buildMenuContextBlock({ nome: 'X', validoAte: '', nota: '' }, '2026-08-10')).toBeNull()
  })
})
