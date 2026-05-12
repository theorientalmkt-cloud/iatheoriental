import { describe, it, expect } from 'vitest'
import {
  DEFAULT_AI_ROUTES,
  DEFAULT_AI_DIRECT,
  DEFAULT_AI_PROMPTS,
} from './ai-center-defaults'

// =============================================================================
// DEFAULT_AI_DIRECT
// =============================================================================

describe('DEFAULT_AI_DIRECT', () => {
  it('deve usar Google como provider padrão', () => {
    expect(DEFAULT_AI_DIRECT.provider).toBe('google')
  })

  it('deve usar gemini-1.5-flash como modelo padrão', () => {
    expect(DEFAULT_AI_DIRECT.model).toBe('gemini-1.5-flash')
  })

  it('não deve ter chaves de API definidas no default', () => {
    expect(DEFAULT_AI_DIRECT.googleApiKey).toBeUndefined()
    expect(DEFAULT_AI_DIRECT.openaiApiKey).toBeUndefined()
  })

  it('deve ter exatamente as chaves esperadas', () => {
    expect(Object.keys(DEFAULT_AI_DIRECT).sort()).toEqual(['model', 'provider'])
  })
})

// =============================================================================
// DEFAULT_AI_ROUTES
// =============================================================================

describe('DEFAULT_AI_ROUTES', () => {
  it('deve ter generateUtilityTemplates habilitado', () => {
    expect(DEFAULT_AI_ROUTES.generateUtilityTemplates).toBe(true)
  })

  it('deve ter generateFlowForm habilitado', () => {
    expect(DEFAULT_AI_ROUTES.generateFlowForm).toBe(true)
  })

  it('deve ter exatamente as chaves esperadas', () => {
    expect(Object.keys(DEFAULT_AI_ROUTES).sort()).toEqual([
      'generateFlowForm',
      'generateUtilityTemplates',
    ])
  })
})

// =============================================================================
// DEFAULT_AI_PROMPTS
// =============================================================================

describe('DEFAULT_AI_PROMPTS', () => {
  it('deve ter todas as 6 chaves de prompt', () => {
    expect(Object.keys(DEFAULT_AI_PROMPTS).sort()).toEqual([
      'flowFormTemplate',
      'strategyBypass',
      'strategyMarketing',
      'strategyUtility',
      'utilityGenerationTemplate',
      'utilityJudgeTemplate',
    ])
  })

  it('deve ter strings nao vazias para todos os prompts', () => {
    for (const [key, value] of Object.entries(DEFAULT_AI_PROMPTS)) {
      expect(typeof value).toBe('string')
      expect(value.length, `${key} deve ser nao vazio`).toBeGreaterThan(0)
    }
  })
})
