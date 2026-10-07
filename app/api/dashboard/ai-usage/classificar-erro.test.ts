import { describe, it, expect } from 'vitest'
import { classificarErroProvider } from './route'

describe('classificação do erro do provider principal', () => {
  it('reconhece crédito esgotado — a falha que derrubou o atendimento', () => {
    // Texto exato que o Google devolveu quando a chave zerou.
    const erro =
      'Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/ to purchase more.'

    expect(classificarErroProvider(erro)).toBe('creditos')
  })

  it('reconhece cota e rate limit', () => {
    expect(classificarErroProvider('RESOURCE_EXHAUSTED: quota exceeded')).toBe('cota')
    expect(classificarErroProvider('429 Too Many Requests')).toBe('cota')
    expect(classificarErroProvider('Rate limit reached for model')).toBe('cota')
  })

  it('reconhece problema de credencial', () => {
    expect(classificarErroProvider('API key not valid')).toBe('credencial')
    expect(classificarErroProvider('401 Unauthorized')).toBe('credencial')
    expect(classificarErroProvider('PERMISSION_DENIED')).toBe('credencial')
  })

  it('reconhece incompatibilidade de modelo', () => {
    // Era a minha hipótese inicial; continua valendo como causa possível.
    expect(classificarErroProvider('Malformed function call')).toBe('modelo')
    expect(classificarErroProvider('model not found in v1beta')).toBe('modelo')
  })

  it('não inventa causa quando não reconhece', () => {
    expect(classificarErroProvider('socket hang up')).toBe('desconhecida')
    expect(classificarErroProvider('')).toBe('desconhecida')
    expect(classificarErroProvider(null)).toBe('desconhecida')
    expect(classificarErroProvider(undefined)).toBe('desconhecida')
  })

  it('não depende de caixa alta ou baixa', () => {
    expect(classificarErroProvider('YOUR PREPAYMENT CREDITS ARE DEPLETED')).toBe('creditos')
    expect(classificarErroProvider('Quota Exceeded')).toBe('cota')
  })
})
