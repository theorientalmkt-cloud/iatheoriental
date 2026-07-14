import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { settingsDb } from '@/lib/supabase-db'
import { clearSettingsCache } from '@/lib/ai'
import { DEFAULT_AI_DIRECT, DEFAULT_AI_PROMPTS, DEFAULT_AI_ROUTES } from '@/lib/ai/ai-center-defaults'
import { DEFAULT_OCR_MODEL } from '@/lib/ai/ocr/providers/gemini'
import {
  clearAiCenterCache,
  getAiDirectConfig,
  getAiPromptsConfig,
  getAiRoutesConfig,
  prepareAiDirectUpdate,
  prepareAiPromptsUpdate,
  prepareAiRoutesUpdate,
} from '@/lib/ai/ai-center-config'

// =============================================================================
// Key validation helpers — verificam autenticação sem fazer chamadas LLM
// =============================================================================

interface ValidationResult {
  valid: boolean
  error?: string
}

async function validateGoogleKey(apiKey: string): Promise<ValidationResult> {
  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
      { headers: { 'x-goog-api-key': apiKey } }
    )
    if (res.ok) return { valid: true }
    if (res.status === 400 || res.status === 401 || res.status === 403)
      return { valid: false, error: 'Chave Google inválida. Verifique se a chave está correta e ativa.' }
    return { valid: false, error: `Erro ao validar chave Google: HTTP ${res.status}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    return { valid: false, error: `Erro ao validar chave Google: ${message}` }
  }
}

async function validateOpenAIKey(apiKey: string): Promise<ValidationResult> {
  try {
    const res = await fetch('https://api.openai.com/v1/models?limit=1', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (res.ok) return { valid: true }
    if (res.status === 401) return { valid: false, error: 'Chave OpenAI inválida. Verifique se a chave está correta e ativa.' }
    if (res.status === 403) return { valid: false, error: 'Acesso negado. A chave pode estar desativada.' }
    if (res.status === 429) return { valid: false, error: 'Quota excedida. Verifique seu plano OpenAI.' }
    return { valid: false, error: `Erro ao validar chave OpenAI: HTTP ${res.status}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    return { valid: false, error: `Erro ao validar chave OpenAI: ${message}` }
  }
}

// Lê uma chave de API já salva no banco (para validar o modelo quando o usuário
// troca só o modelo, sem reenviar a chave).
async function getExistingKey(provider: 'google' | 'openai'): Promise<string | null> {
  const keyName = provider === 'google' ? 'google_api_key' : 'openai_api_key'
  const { data } =
    (await supabase.admin?.from('settings').select('value').eq('key', keyName).single()) || {
      data: null,
    }
  return (data?.value as string) || null
}

// Valida que o MODELO realmente gera conteúdo — não só que a chave é válida.
// Faz uma chamada mínima (1 token). Evita salvar um modelo que a API do provedor
// LISTA mas que falha em generateContent (ex.: gemini-2.5-flash-lite), o que
// jogaria todo o atendimento no failover lento sem ninguém perceber.
async function validateModel(
  provider: 'google' | 'openai',
  model: string,
  apiKey: string
): Promise<ValidationResult> {
  try {
    const { generateText } = await import('ai')
    let instance
    if (provider === 'google') {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      instance = createGoogleGenerativeAI({ apiKey })(model)
    } else {
      const { createOpenAI } = await import('@ai-sdk/openai')
      instance = createOpenAI({ apiKey })(model)
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await generateText({
        model: instance,
        prompt: 'Responda apenas: ok',
        maxOutputTokens: 8,
        abortSignal: controller.signal,
      })
      if (res.finishReason === 'error') {
        return { valid: false, error: `O modelo "${model}" não conseguiu responder. Escolha outro modelo.` }
      }
      return { valid: true }
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    return {
      valid: false,
      error: `O modelo "${model}" não funcionou (${message.slice(0, 140)}). Escolha outro modelo da lista.`,
    }
  }
}

function parseJsonSetting<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback
  // Se Supabase já desserializou (coluna jsonb), retorna direto sem JSON.parse.
  // Sem isso, JSON.parse(objeto) lança SyntaxError → catch → retorna fallback
  // → UI mostra DEFAULT_AI_DIRECT (gemini-flash-latest) toda vez que recarrega,
  // ignorando o model que o usuário acabou de salvar.
  if (typeof value === 'object') return value as T
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const getPreview = (key: string) =>
  key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : null

// =============================================================================
// GET — retorna configuração atual de IA
// =============================================================================

export async function GET() {
  try {
    const { data, error } = await supabase.admin
      ?.from('settings')
      .select('key, value')
      .in('key', [
        'ai_direct',
        'google_api_key',
        'openai_api_key',
        'ai_routes',
        'ai_prompts',
        'ocr_gemini_model',
        'strategyMarketing',
        'strategyUtility',
        'strategyBypass',
      ]) || { data: null, error: null }

    if (error) console.error('Supabase error:', error)

    const settingsMap = new Map(data?.map((s) => [s.key, s.value]) || [])

    const directRaw = parseJsonSetting(
      settingsMap.get('ai_direct') as string | null,
      DEFAULT_AI_DIRECT
    )
    const direct = prepareAiDirectUpdate(directRaw)

    const routes = prepareAiRoutesUpdate(
      parseJsonSetting(settingsMap.get('ai_routes') as string | null, DEFAULT_AI_ROUTES)
    )

    const basePrompts = parseJsonSetting(settingsMap.get('ai_prompts') as string | null, {})
    const prompts = prepareAiPromptsUpdate({
      ...basePrompts,
      strategyMarketing: (settingsMap.get('strategyMarketing') as string) || '',
      strategyUtility: (settingsMap.get('strategyUtility') as string) || '',
      strategyBypass: (settingsMap.get('strategyBypass') as string) || '',
    })

    const googleApiKey = (settingsMap.get('google_api_key') as string) || ''
    const openaiApiKey = (settingsMap.get('openai_api_key') as string) || ''
    const ocrGeminiModel = (settingsMap.get('ocr_gemini_model') as string) || DEFAULT_OCR_MODEL

    return NextResponse.json({
      provider: direct.provider,
      model: direct.model,
      routes,
      prompts,
      keys: {
        google: {
          isConfigured: !!googleApiKey,
          source: googleApiKey ? 'database' : 'none',
          tokenPreview: googleApiKey ? getPreview(googleApiKey) : null,
        },
        openai: {
          isConfigured: !!openaiApiKey,
          source: openaiApiKey ? 'database' : 'none',
          tokenPreview: openaiApiKey ? getPreview(openaiApiKey) : null,
        },
      },
      ocr: {
        provider: 'gemini',
        geminiModel: ocrGeminiModel,
      },
    })
  } catch (error) {
    console.error('Error fetching AI settings:', error)
    return NextResponse.json({ error: 'Failed to fetch AI settings' }, { status: 500 })
  }
}

// =============================================================================
// POST — salva configuração de IA
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      provider,
      model,
      google_api_key,
      openai_api_key,
      routes,
      prompts,
      ocr_gemini_model,
    } = body

    if (!provider && !model && !google_api_key && !openai_api_key && !routes && !prompts && !ocr_gemini_model) {
      return NextResponse.json({ error: 'At least one field is required' }, { status: 400 })
    }

    const updates: Array<{ key: string; value: string; updated_at: string }> = []
    const now = new Date().toISOString()

    // Salva provider + model em ai_direct (JSON unificado)
    if (provider || model) {
      const current = await getAiDirectConfig()
      const normalized = prepareAiDirectUpdate({
        provider: provider ?? current.provider,
        model: model ?? current.model,
      })

      // ESTABILIDADE: valida que o modelo REALMENTE funciona antes de ativar.
      // Sem isso, dá pra salvar um modelo que a API lista mas que não gera resposta
      // (ex.: gemini-2.5-flash-lite) — e o atendimento cai no failover lento.
      const apiKey =
        (normalized.provider === 'google' ? google_api_key : openai_api_key) ||
        (await getExistingKey(normalized.provider))
      if (!apiKey) {
        return NextResponse.json(
          {
            error: `Configure a chave do ${
              normalized.provider === 'google' ? 'Google' : 'OpenAI'
            } antes de escolher o modelo.`,
          },
          { status: 400 }
        )
      }
      const modelCheck = await validateModel(normalized.provider, normalized.model, apiKey)
      if (!modelCheck.valid) {
        return NextResponse.json({ error: modelCheck.error }, { status: 400 })
      }

      updates.push({ key: 'ai_direct', value: JSON.stringify(normalized), updated_at: now })
    }

    // Valida e salva chave Google
    if (google_api_key) {
      const result = await validateGoogleKey(google_api_key)
      if (!result.valid) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }
      updates.push({ key: 'google_api_key', value: google_api_key, updated_at: now })
    }

    // Valida e salva chave OpenAI
    if (openai_api_key) {
      const result = await validateOpenAIKey(openai_api_key)
      if (!result.valid) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }
      updates.push({ key: 'openai_api_key', value: openai_api_key, updated_at: now })
    }

    // Rotas de IA
    if (routes) {
      const current = await getAiRoutesConfig()
      const normalized = prepareAiRoutesUpdate({ ...current, ...routes })
      updates.push({ key: 'ai_routes', value: JSON.stringify(normalized), updated_at: now })
    }

    // Prompts
    if (prompts) {
      const current = await getAiPromptsConfig()
      const { strategyMarketing, strategyUtility, strategyBypass, ...basePromptsInput } = {
        ...current,
        ...prompts,
      }
      const normalizedBase = {
        utilityGenerationTemplate: basePromptsInput.utilityGenerationTemplate || '',
        utilityJudgeTemplate: basePromptsInput.utilityJudgeTemplate || '',
        flowFormTemplate: basePromptsInput.flowFormTemplate || '',
      }
      updates.push({ key: 'ai_prompts', value: JSON.stringify(normalizedBase), updated_at: now })

      if (prompts.strategyMarketing !== undefined)
        updates.push({ key: 'strategyMarketing', value: strategyMarketing || '', updated_at: now })
      if (prompts.strategyUtility !== undefined)
        updates.push({ key: 'strategyUtility', value: strategyUtility || '', updated_at: now })
      if (prompts.strategyBypass !== undefined)
        updates.push({ key: 'strategyBypass', value: strategyBypass || '', updated_at: now })
    }

    // Modelo OCR Gemini
    if (ocr_gemini_model) {
      updates.push({ key: 'ocr_gemini_model', value: ocr_gemini_model, updated_at: now })
    }

    if (updates.length > 0) {
      // IMPORTANTE: usar settingsDb.set() em vez de supabase.upsert direto.
      // settingsDb.set() invalida automaticamente o cache Redis (TTL 60s) de cada
      // chave alterada. Sem isso, workers/inbox continuam usando provider/model
      // antigo até o cache expirar, gerando o sintoma "salvei mas não funcionou".
      try {
        await Promise.all(updates.map((u) => settingsDb.set(u.key, u.value)))
      } catch (error) {
        console.error('Supabase error:', error)
        throw new Error('Failed to save to database')
      }
    }

    clearSettingsCache()
    clearAiCenterCache()

    return NextResponse.json({
      success: true,
      message: 'AI configuration saved successfully',
      saved: updates.map((u) => u.key),
    })
  } catch (error) {
    console.error('Error saving AI settings:', error)
    return NextResponse.json({ error: 'Failed to save AI settings' }, { status: 500 })
  }
}

// =============================================================================
// DELETE — remove chave de API de um provider
// =============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const provider = searchParams.get('provider')

    if (provider !== 'google' && provider !== 'openai') {
      return NextResponse.json(
        { error: 'Provider inválido. Use "google" ou "openai".' },
        { status: 400 }
      )
    }

    const keyName = provider === 'google' ? 'google_api_key' : 'openai_api_key'

    // Usa settingsDb.delete() em vez de supabase.delete() direto pra invalidar
    // automaticamente o cache Redis. Sem isso a chave deletada continua valendo
    // até 60s nos workers que usam settingsDb.get().
    try {
      await settingsDb.delete(keyName)
    } catch (error) {
      console.error('Supabase error:', error)
      throw new Error('Failed to delete from database')
    }

    clearSettingsCache()
    clearAiCenterCache()

    return NextResponse.json({
      success: true,
      message: `${provider} API key removed successfully`,
      deleted: keyName,
    })
  } catch (error) {
    console.error('Error removing AI settings:', error)
    return NextResponse.json({ error: 'Failed to remove AI settings' }, { status: 500 })
  }
}
