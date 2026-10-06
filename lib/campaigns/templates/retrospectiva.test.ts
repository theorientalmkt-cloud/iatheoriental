import { describe, it, expect } from 'vitest'
import { CreateTemplateSchema } from '@/lib/whatsapp/validators/template.schema'
import { buildRetrospectivaTemplate, RETROSPECTIVA_TEMPLATE_NAME } from './retrospectiva'
import { menuById } from '@/lib/menus/catalog'

// Handle fictício: na criação real vem do upload da arte à Meta.
const RETROSPECTIVA_TEMPLATE = buildRetrospectivaTemplate('4::handle-de-teste')

describe('template da campanha — validade antes de ir para a Meta', () => {
  it('passa no schema de criação', () => {
    const r = CreateTemplateSchema.safeParse(RETROSPECTIVA_TEMPLATE)

    expect(r.success).toBe(true)
  })

  it('o nome segue a regra da Meta (minúsculas, números, underscore)', () => {
    expect(RETROSPECTIVA_TEMPLATE_NAME).toMatch(/^[a-z0-9_]+$/)
  })

  it('é MARKETING — campanha promocional não passa como utilidade', () => {
    expect(RETROSPECTIVA_TEMPLATE.category).toBe('MARKETING')
  })

  it('toda variável do body tem exemplo, senão a Meta recusa', () => {
    const vars = RETROSPECTIVA_TEMPLATE.body.text.match(/\{\{\d+\}\}/g) || []
    const exemplos = RETROSPECTIVA_TEMPLATE.body.example.body_text[0] || []

    expect(vars).toHaveLength(1)
    expect(exemplos).toHaveLength(vars.length)
  })

  it('respeita os limites de tamanho', () => {
    expect(RETROSPECTIVA_TEMPLATE.body.text.length).toBeLessThanOrEqual(1024)
    expect(RETROSPECTIVA_TEMPLATE.footer.text.length).toBeLessThanOrEqual(60)
    for (const b of RETROSPECTIVA_TEMPLATE.buttons) {
      expect(b.text.length).toBeLessThanOrEqual(25)
    }
  })

  it('exige o handle da arte — cabeçalho de imagem sem mídia é recusado', () => {
    expect(() => buildRetrospectivaTemplate('')).toThrow(/headerHandle obrigatório/i)
    expect(() => buildRetrospectivaTemplate('   ')).toThrow(/headerHandle obrigatório/i)
  })

  it('não usa link de WhatsApp em botão — a política da Meta bloqueia', () => {
    expect(RETROSPECTIVA_TEMPLATE.body.text).not.toContain('wa.me')
    expect(JSON.stringify(RETROSPECTIVA_TEMPLATE.buttons)).not.toContain('wa.me')
  })
})

describe('template x catálogo — a campanha não anuncia menu errado', () => {
  it('o preço do texto é o preço vigente', () => {
    const preco = menuById('Retrospectiva').precoPorPessoa

    expect(RETROSPECTIVA_TEMPLATE.body.text).toContain(`R$ ${preco} por pessoa`)
  })

  it('os dias e horários batem com os turnos reservaveis', () => {
    const m = menuById('Retrospectiva')

    expect(m.horarios).toEqual(['19:00', '21:00'])
    expect(RETROSPECTIVA_TEMPLATE.body.text).toContain('19h ou 21h')
    expect(RETROSPECTIVA_TEMPLATE.body.text).toContain('terça a sábado')
  })

  it('o endereço do rodapé é o bairro correto', () => {
    expect(RETROSPECTIVA_TEMPLATE.footer.text).toContain('Mirandópolis')
  })
})
