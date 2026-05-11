/**
 * Serviço de IA unificado — providers diretos (Google Gemini / OpenAI).
 *
 * Usa as chaves de API do próprio usuário, armazenadas no Supabase.
 * Cada cliente paga diretamente ao provider — sem intermediação da Vercel.
 *
 * Exemplo:
 * - `import { ai } from '@/lib/ai'`
 * - `const result = await ai.generateText({ prompt: 'Olá' })`
 */

import { generateText as vercelGenerateText, streamText as vercelStreamText, type ModelMessage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'

import { getAiDirectConfig } from './ai-center-config'
import type { AiDirectConfig } from './ai-center-defaults'

// =============================================================================
// TYPES
// =============================================================================

/** Alias para compatibilidade retroativa. */
export type ChatMessage = {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface GenerateTextOptions {
    /** Prompt simples (mutuamente exclusivo com `messages`). */
    prompt?: string;
    /** Mensagens da conversa (mutuamente exclusivo com `prompt`). */
    messages?: ChatMessage[];
    /** Instrução de sistema (contexto) enviada ao modelo. */
    system?: string;
    /** Sobrescreve o modelo configurado nas settings (formato bare, ex: 'gemini-2.5-flash'). */
    model?: string;
    /** Máximo de tokens de saída. */
    maxOutputTokens?: number;
    /** Temperatura (geralmente entre 0 e 2). */
    temperature?: number;
}

export interface StreamTextOptions extends GenerateTextOptions {
    /** Callback chamado a cada chunk de texto recebido. */
    onChunk?: (chunk: string) => void;
    /** Callback chamado quando o streaming terminar, com o texto completo. */
    onComplete?: (text: string) => void;
}

export interface GenerateTextResult {
    text: string;
    model: string;
}

// =============================================================================
// PROVIDER FACTORY (FAILOVER SYSTEM)
// =============================================================================

/**
 * Obtém os provedores disponíveis com base nas chaves configuradas.
 * Tenta usar o provider principal primeiro, seguido do fallback.
 */
function getAvailableProviders(config: AiDirectConfig, modelOverride?: string) {
    const primaryProvider = config.provider
    const primaryModel = modelOverride || config.model

    const providers: { name: string, modelId: string, instance: any }[] = []

    const addGoogle = () => {
        if (config.googleApiKey) {
            const modelId = primaryProvider === 'google' ? primaryModel : 'gemini-2.5-flash'
            providers.push({
                name: 'google',
                modelId,
                instance: createGoogleGenerativeAI({ apiKey: config.googleApiKey })(modelId)
            })
        }
    }

    const addOpenAI = () => {
        if (config.openaiApiKey) {
            const modelId = primaryProvider === 'openai' ? primaryModel : 'gpt-4o-mini'
            providers.push({
                name: 'openai',
                modelId,
                instance: createOpenAI({ apiKey: config.openaiApiKey })(modelId)
            })
        }
    }

    // Prioridade baseada na configuração
    if (primaryProvider === 'google') {
        addGoogle()
        addOpenAI()
    } else {
        addOpenAI()
        addGoogle()
    }

    return providers
}

// =============================================================================
// ERROR HANDLING
// =============================================================================

/**
 * Converte erros de provider em mensagens legíveis.
 */
function formatProviderError(error: unknown, modelId: string): string {
    if (error && typeof error === 'object' && 'statusCode' in error) {
        const status = (error as { statusCode: number }).statusCode
        switch (status) {
            case 401: return `[IA] Chave de API inválida para ${modelId}.`
            case 429: return `[IA] Rate limit atingido para ${modelId}.`
            case 503: return `[IA] Serviço indisponível para ${modelId}.`
        }
    }
    return error instanceof Error ? error.message : String(error)
}

type CallArgs =
    | { model: any; system: string | undefined; temperature: number; maxOutputTokens?: number; messages: ModelMessage[] }
    | { model: any; system: string | undefined; temperature: number; maxOutputTokens?: number; prompt: string }

function buildArgs(
    options: GenerateTextOptions,
    modelInstance: any,
): CallArgs {
    const base = {
        model: modelInstance,
        system: options.system,
        temperature: options.temperature ?? 0.7,
        ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    }
    return (options.messages
        ? { ...base, messages: options.messages as unknown as ModelMessage[] }
        : { ...base, prompt: options.prompt || '' }) as CallArgs
}

// =============================================================================
// MAIN API
// =============================================================================

export async function generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const config = await getAiDirectConfig()
    const availableProviders = getAvailableProviders(config, options.model)

    if (availableProviders.length === 0) {
        console.error('[AI Service] Nenhuma chave de API configurada (nem Google, nem OpenAI). Verifique as variáveis de ambiente na Vercel.')
        return { text: "Sistema de IA temporariamente indisponível. Configuração de chave pendente.", model: "fallback-none" }
    }

    let lastError: unknown

    for (const provider of availableProviders) {
        try {
            console.log(`[AI Service] Tentando gerar com ${provider.name}/${provider.modelId}`)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await vercelGenerateText(buildArgs(options, provider.instance) as any)
            return { text: result.text, model: provider.modelId }
        } catch (error) {
            console.warn(`[AI Service] Falha ao gerar com ${provider.name}:`, formatProviderError(error, provider.modelId))
            lastError = error
        }
    }

    console.error('[AI Service] Todos os provedores falharam para generateText.', lastError)
    return { text: "Sistema de IA indisponível. Por favor, tente novamente mais tarde.", model: "error-fallback" }
}

export async function streamText(options: StreamTextOptions): Promise<GenerateTextResult> {
    const config = await getAiDirectConfig()
    const availableProviders = getAvailableProviders(config, options.model)

    const fallbackText = "Sistema de IA indisponível no momento. Por favor, avise um atendente."

    if (availableProviders.length === 0) {
        console.error('[AI Service] Nenhuma chave de API configurada para streaming.')
        options.onChunk?.(fallbackText)
        options.onComplete?.(fallbackText)
        return { text: fallbackText, model: "fallback-none" }
    }

    let lastError: unknown

    for (const provider of availableProviders) {
        try {
            console.log(`[AI Service] Tentando streaming com ${provider.name}/${provider.modelId}`)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = vercelStreamText(buildArgs(options, provider.instance) as any)

            let fullText = ''
            for await (const part of result.textStream) {
                fullText += part
                options.onChunk?.(part)
            }
            options.onComplete?.(fullText)
            return { text: fullText, model: provider.modelId }
        } catch (error) {
            console.warn(`[AI Service] Falha no streaming com ${provider.name}:`, formatProviderError(error, provider.modelId))
            lastError = error
        }
    }

    console.error('[AI Service] Todos os provedores falharam para streamText.', lastError)
    options.onChunk?.(fallbackText)
    options.onComplete?.(fallbackText)
    return { text: fallbackText, model: "error-fallback" }
}

/**
 * Gera uma resposta em JSON via IA.
 *
 * @typeParam T Tipo esperado do JSON retornado.
 */
export async function generateJSON<T = unknown>(options: GenerateTextOptions): Promise<T> {
    const result = await generateText({
        ...options,
        system: (options.system || '') + '\n\nRespond with valid JSON only, no markdown.',
    })

    if (result.model === 'fallback-none' || result.model === 'error-fallback') {
        throw new Error('AI providers unavailable for JSON generation')
    }

    try {
        const cleanText = result.text
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim()

        try {
            return JSON.parse(cleanText) as T
        } catch {
            const extracted = extractFirstJsonValue(cleanText)
            if (extracted) {
                return JSON.parse(extracted) as T
            }
            throw new Error('AI response was not valid JSON')
        }
    } catch {
        console.error('[AI Service] Failed to parse JSON response:', result.text)
        throw new Error('AI response was not valid JSON')
    }
}

/**
 * Limpa o cache de settings de IA (compatibilidade retroativa).
 */
export function clearSettingsCache() {
    // No-op: cache é gerenciado pela camada de configuração
}

// =============================================================================
// JSON EXTRACTION (fallback)
// =============================================================================

function extractFirstJsonValue(text: string): string | null {
    const start = Math.min(
        ...['{', '[']
            .map((c) => text.indexOf(c))
            .filter((i) => i >= 0)
    )

    if (!Number.isFinite(start) || start < 0) return null

    const open = text[start]
    const close = open === '{' ? '}' : ']'

    let depth = 0
    let inString = false
    let escaped = false

    for (let i = start; i < text.length; i += 1) {
        const ch = text[i]

        if (inString) {
            if (escaped) { escaped = false; continue }
            if (ch === '\\') { escaped = true; continue }
            if (ch === '"') { inString = false }
            continue
        }

        if (ch === '"') { inString = true; continue }
        if (ch === open) depth += 1
        if (ch === close) depth -= 1

        if (depth === 0) {
            return text.slice(start, i + 1).trim()
        }
    }

    return null
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

export const ai = {
    generateText,
    streamText,
    generateJSON,
    clearSettingsCache,
}

export default ai

// Re-export types and providers (compatibilidade retroativa)
export { AI_PROVIDERS, getProvider, getModel, getDefaultModel } from './providers'
export type { AIProvider, AIModel, AIProviderConfig } from './providers'
