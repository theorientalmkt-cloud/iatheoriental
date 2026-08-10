/**
 * Preços do Gemini (USD por 1 milhão de tokens) para ESTIMAR o custo da IA a
 * partir dos tokens que registramos em ai_agent_logs.
 *
 * IMPORTANTE: é ESTIMATIVA (fica ~5% do boleto real). NÃO substitui o billing
 * oficial do Google — o saldo/gasto real só aparece no AI Studio
 * (https://aistudio.google.com/billing). Serve para acompanhar o RITMO de gasto
 * e avisar ANTES de zerar os créditos.
 *
 * Fonte dos valores: https://ai.google.dev/gemini-api/docs/pricing (tier pago,
 * entrada de texto). TODO: revisar quando o Google atualizar a tabela.
 */

export interface ModelPrice {
  /** USD por 1M tokens de ENTRADA (texto). */
  inputPerM: number
  /** USD por 1M tokens de SAÍDA. */
  outputPerM: number
}

// Chaveado por ID canônico. Aliases (*-latest) e prefixos resolvidos em priceFor().
const PRICES: Record<string, ModelPrice> = {
  'gemini-2.5-flash': { inputPerM: 0.30, outputPerM: 2.50 },
  'gemini-2.5-flash-lite': { inputPerM: 0.10, outputPerM: 0.40 },
  'gemini-2.5-pro': { inputPerM: 1.25, outputPerM: 10.0 }, // prompts <= 200k
  'gemini-2.0-flash': { inputPerM: 0.10, outputPerM: 0.40 },
  'gemini-2.0-flash-lite': { inputPerM: 0.075, outputPerM: 0.30 },
  'gemini-1.5-flash': { inputPerM: 0.075, outputPerM: 0.30 },
  'gemini-1.5-pro': { inputPerM: 1.25, outputPerM: 5.0 },
}

/** Resolve o preço de um modelo (trata aliases *-latest, lite e prefixos). null se desconhecido. */
export function priceFor(modelId: string): ModelPrice | null {
  const id = String(modelId || '').toLowerCase().trim()
  if (!id) return null
  if (PRICES[id]) return PRICES[id]
  // Match por prefixo de versão (ex.: "gemini-2.5-flash-preview-XX")
  const prefixed = Object.keys(PRICES).find((k) => id.startsWith(k))
  if (prefixed) return PRICES[prefixed]
  // Aliases genéricos (ex.: "gemini-flash-latest", "gemini-flash-lite-latest")
  if (id.includes('flash-lite')) return PRICES['gemini-2.5-flash-lite']
  if (id.includes('flash')) return PRICES['gemini-2.5-flash']
  if (id.includes('pro')) return PRICES['gemini-2.5-pro']
  return null
}

/** Custo estimado (USD) de uma chamada. null se o modelo não tiver preço na tabela. */
export function estimateCostUSD(modelId: string, inputTokens: number, outputTokens: number): number | null {
  const p = priceFor(modelId)
  if (!p) return null
  const inT = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0
  const outT = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0
  return (inT / 1_000_000) * p.inputPerM + (outT / 1_000_000) * p.outputPerM
}
