import { describe, it, expect } from 'vitest'
import { RESERVA_PELA_IA } from './chat-agent'
import { CONCIERGE_PROMPT } from '@/lib/ai/prompts/concierge'
import { buildMenuRulesBlock } from '@/lib/menus/catalog'

describe('reserva pela IA está desligada', () => {
  it('as ferramentas de agenda não são registradas', () => {
    expect(RESERVA_PELA_IA).toBe(false)
  })

  it('prompt e código concordam: quem reserva é a equipe', () => {
    // Se alguém religar a reserva sem reescrever o prompt, a IA passa a ter a
    // ferramenta e a instrução de nunca usá-la — o pior dos dois mundos.
    if (RESERVA_PELA_IA) {
      expect(CONCIERGE_PROMPT).not.toMatch(/NUNCA informe disponibilidade/i)
      expect(CONCIERGE_PROMPT).toContain('checkAvailability')
    } else {
      expect(CONCIERGE_PROMPT).toMatch(/NUNCA informe disponibilidade/i)
      expect(CONCIERGE_PROMPT).toMatch(/As reservas são feitas direto com a nossa equipe/i)
      expect(CONCIERGE_PROMPT).not.toContain('checkAvailability')
      expect(buildMenuRulesBlock()).not.toContain('checkAvailability')
    }
  })
})
