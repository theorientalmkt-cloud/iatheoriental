import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getBaseUrl, absoluteUrl } from './base-url'

const original = { app: process.env.NEXT_PUBLIC_APP_URL, vercel: process.env.VERCEL_URL }

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL
  delete process.env.VERCEL_URL
})

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = original.app
  process.env.VERCEL_URL = original.vercel
})

describe('getBaseUrl', () => {
  it('prefere NEXT_PUBLIC_APP_URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://theoriental.com.br'
    process.env.VERCEL_URL = 'preview.vercel.app'

    expect(getBaseUrl()).toBe('https://theoriental.com.br')
  })

  it('cai para VERCEL_URL, acrescentando o esquema', () => {
    process.env.VERCEL_URL = 'iatheoriental.vercel.app'

    expect(getBaseUrl()).toBe('https://iatheoriental.vercel.app')
  })

  it('remove barra final, para não gerar URL com barra dupla', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://theoriental.com.br/'

    expect(getBaseUrl()).toBe('https://theoriental.com.br')
  })

  it('sem nenhuma das duas, devolve null em vez de uma URL quebrada', () => {
    expect(getBaseUrl()).toBeNull()
  })
})

describe('absoluteUrl', () => {
  it('monta a URL da arte a partir do caminho em public/', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://theoriental.com.br'

    expect(absoluteUrl('/menu/retrospectiva-2.jpg')).toBe(
      'https://theoriental.com.br/menu/retrospectiva-2.jpg'
    )
  })

  it('não duplica a barra quando o caminho já vem sem ela', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://theoriental.com.br/'

    expect(absoluteUrl('menu/arte.jpg')).toBe('https://theoriental.com.br/menu/arte.jpg')
  })

  it('sem base, devolve null — a Meta precisa de URL absoluta', () => {
    expect(absoluteUrl('/menu/arte.jpg')).toBeNull()
  })
})
