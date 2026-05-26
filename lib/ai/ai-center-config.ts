import { supabase } from '@/lib/supabase'
import {
  DEFAULT_AI_DIRECT,
  DEFAULT_AI_PROMPTS,
  DEFAULT_AI_ROUTES,
  type AiDirectConfig,
  type AiProviderType,
  type AiPromptsConfig,
  type AiRoutesConfig,
} from './ai-center-defaults'

const SETTINGS_KEYS = {
  routes: 'ai_routes',
  direct: 'ai_direct',
  prompts: 'ai_prompts',
  googleApiKey: 'google_api_key',
  openaiApiKey: 'openai_api_key',
  // Chaves individuais para prompts de estratégia (fonte única de verdade: banco)
  strategyMarketing: 'strategyMarketing',
  strategyUtility: 'strategyUtility',
  strategyBypass: 'strategyBypass',
} as const

const CACHE_TTL = 60000
let cacheTime = 0
let cachedRoutes: AiRoutesConfig | null = null
let cachedDirect: AiDirectConfig | null = null
let cachedPrompts: AiPromptsConfig | null = null

function parseJsonSetting<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback
  // Se Supabase desserializou (coluna jsonb), retorna direto sem JSON.parse.
  // Sem isso, JSON.parse(objeto) lança SyntaxError → catch → retorna DEFAULT
  // → IA usa modelo/prompt padrão ignorando o que o operador salvou.
  if (typeof value === 'object') return value as T
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizeRoutes(input?: Partial<AiRoutesConfig> | null): AiRoutesConfig {
  const next = { ...DEFAULT_AI_ROUTES, ...(input || {}) }
  return {
    generateUtilityTemplates: !!next.generateUtilityTemplates,
    generateFlowForm: !!next.generateFlowForm,
  }
}

function normalizeDirect(
  input?: Partial<Pick<AiDirectConfig, 'provider' | 'model'>> | null,
  googleApiKey?: string | null,
  openaiApiKey?: string | null,
): AiDirectConfig {
  const provider: AiProviderType =
    input?.provider === 'google' || input?.provider === 'openai'
      ? input.provider
      : DEFAULT_AI_DIRECT.provider

  const model =
    typeof input?.model === 'string' && input.model.trim()
      ? input.model.trim()
      : DEFAULT_AI_DIRECT.model

  return {
    provider,
    model,
    ...(googleApiKey ? { googleApiKey } : {}),
    ...(openaiApiKey ? { openaiApiKey } : {}),
  }
}

// Normaliza prompts gerais (usa defaults do código como fallback)
function normalizeBasePrompts(input?: Partial<AiPromptsConfig> | null): Omit<AiPromptsConfig, 'strategyMarketing' | 'strategyUtility' | 'strategyBypass'> {
  const next = { ...DEFAULT_AI_PROMPTS, ...(input || {}) }
  return {
    utilityGenerationTemplate: next.utilityGenerationTemplate || DEFAULT_AI_PROMPTS.utilityGenerationTemplate,
    utilityJudgeTemplate: next.utilityJudgeTemplate || DEFAULT_AI_PROMPTS.utilityJudgeTemplate,
    flowFormTemplate: next.flowFormTemplate || DEFAULT_AI_PROMPTS.flowFormTemplate,
  }
}

// Normaliza prompts de estratégia (banco tem prioridade, código é fallback)
function normalizeStrategyPrompts(strategies: {
  marketing: string | null
  utility: string | null
  bypass: string | null
}): Pick<AiPromptsConfig, 'strategyMarketing' | 'strategyUtility' | 'strategyBypass'> {
  return {
    strategyMarketing: strategies.marketing || DEFAULT_AI_PROMPTS.strategyMarketing,
    strategyUtility: strategies.utility || DEFAULT_AI_PROMPTS.strategyUtility,
    strategyBypass: strategies.bypass || DEFAULT_AI_PROMPTS.strategyBypass,
  }
}

// Função de compatibilidade para preparar updates
function normalizePrompts(input?: Partial<AiPromptsConfig> | null): AiPromptsConfig {
  const next = { ...DEFAULT_AI_PROMPTS, ...(input || {}) }
  return {
    utilityGenerationTemplate: next.utilityGenerationTemplate || DEFAULT_AI_PROMPTS.utilityGenerationTemplate,
    utilityJudgeTemplate: next.utilityJudgeTemplate || DEFAULT_AI_PROMPTS.utilityJudgeTemplate,
    flowFormTemplate: next.flowFormTemplate || DEFAULT_AI_PROMPTS.flowFormTemplate,
    strategyMarketing: next.strategyMarketing || '',
    strategyUtility: next.strategyUtility || '',
    strategyBypass: next.strategyBypass || '',
  }
}

async function getSettingValue(key: string): Promise<string | null> {
  const { data, error } = await supabase.admin
    ?.from('settings')
    .select('value')
    .eq('key', key)
    .single() || { data: null, error: null }

  if (error || !data) return null
  return data.value
}

function isCacheValid(): boolean {
  return Date.now() - cacheTime < CACHE_TTL
}

export async function getAiRoutesConfig(): Promise<AiRoutesConfig> {
  if (cachedRoutes && isCacheValid()) return cachedRoutes
  const raw = await getSettingValue(SETTINGS_KEYS.routes)
  const parsed = parseJsonSetting<Partial<AiRoutesConfig>>(raw, DEFAULT_AI_ROUTES)
  cachedRoutes = normalizeRoutes(parsed)
  cacheTime = Date.now()
  return cachedRoutes
}

export async function getAiDirectConfig(): Promise<AiDirectConfig> {
  // Leitura em tempo real (sem cache de memória) para garantir que alterações
  // no painel administrativo reflitam imediatamente, sem necessidade de deploy.
  const { data, error } = await supabase.admin
    ?.from('settings')
    .select('key, value')
    .in('key', [SETTINGS_KEYS.direct, SETTINGS_KEYS.googleApiKey, 'gemini_api_key', SETTINGS_KEYS.openaiApiKey]) || { data: null, error: null }

  let rawDirect: string | null = null
  let dbGoogleApiKey: string | null = null
  let dbGeminiApiKeyLegacy: string | null = null
  let dbOpenaiApiKey: string | null = null

  if (!error && data) {
    data.forEach(row => {
      if (row.key === SETTINGS_KEYS.direct) rawDirect = row.value
      if (row.key === SETTINGS_KEYS.googleApiKey) dbGoogleApiKey = row.value
      if (row.key === 'gemini_api_key') dbGeminiApiKeyLegacy = row.value
      if (row.key === SETTINGS_KEYS.openaiApiKey) dbOpenaiApiKey = row.value
    })
  }

  // Variáveis da Vercel servem ESTRITAMENTE como backup de segurança
  const envGoogleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY
  const envOpenaiApiKey = process.env.OPENAI_API_KEY

  // Prioridade 1: Banco de Dados | Prioridade 2: Vercel Env
  const finalGoogleKey = dbGoogleApiKey || dbGeminiApiKeyLegacy || envGoogleApiKey
  const finalOpenaiKey = dbOpenaiApiKey || envOpenaiApiKey

  const parsed = parseJsonSetting<Partial<Pick<AiDirectConfig, 'provider' | 'model'>>>(rawDirect, {})
  const directConfig = normalizeDirect(parsed, finalGoogleKey, finalOpenaiKey)
  
  // Mantemos a referência atualizada, mas não bloqueamos leitura futura
  cachedDirect = directConfig
  
  return directConfig
}

export async function getAiPromptsConfig(): Promise<AiPromptsConfig> {
  if (cachedPrompts && isCacheValid()) return cachedPrompts

  const rawBase = await getSettingValue(SETTINGS_KEYS.prompts)
  const parsedBase = parseJsonSetting<Partial<AiPromptsConfig>>(rawBase, {})
  const basePrompts = normalizeBasePrompts(parsedBase)

  const [marketing, utility, bypass] = await Promise.all([
    getSettingValue(SETTINGS_KEYS.strategyMarketing),
    getSettingValue(SETTINGS_KEYS.strategyUtility),
    getSettingValue(SETTINGS_KEYS.strategyBypass),
  ])
  const strategyPrompts = normalizeStrategyPrompts({ marketing, utility, bypass })

  cachedPrompts = { ...basePrompts, ...strategyPrompts }
  cacheTime = Date.now()
  return cachedPrompts
}

export async function isAiRouteEnabled(routeKey: keyof AiRoutesConfig): Promise<boolean> {
  const routes = await getAiRoutesConfig()
  return routes[routeKey]
}

export function prepareAiRoutesUpdate(input?: Partial<AiRoutesConfig> | null): AiRoutesConfig {
  return normalizeRoutes(input)
}

export function prepareAiDirectUpdate(input?: Partial<Pick<AiDirectConfig, 'provider' | 'model'>> | null): Pick<AiDirectConfig, 'provider' | 'model'> {
  return normalizeDirect(input)
}

export function prepareAiPromptsUpdate(input?: Partial<AiPromptsConfig> | null): AiPromptsConfig {
  return normalizePrompts(input)
}

export function clearAiCenterCache() {
  cacheTime = 0
  cachedRoutes = null
  cachedDirect = null
  cachedPrompts = null
}
