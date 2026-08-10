/**
 * Entendimento de mídia (multimodal) — imagem e áudio do cliente.
 *
 * Baixa a mídia da Meta (media_id) e usa o Gemini para:
 *  - IMAGEM: extrair texto + descrever (endereço, comprovante, print, foto)
 *  - AUDIO:  transcrever para texto
 *
 * O texto retornado vira o conteúdo que a IA lê, como se o cliente tivesse
 * digitado. Reusa o mesmo padrão do OCR (generateText com file-part).
 */

import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'
import { getAiDirectConfig } from '@/lib/ai/ai-center-config'

export type MediaKind = 'image' | 'audio' | 'document'

// Teto de bytes por tipo (defesa contra DoS/custo — a Meta aceita doc até 100MB).
const MAX_BYTES: Record<MediaKind, number> = {
  image: 5 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 10 * 1024 * 1024,
}
// Allowlist de mimetypes por tipo — rejeita o resto.
const ALLOWED_MIME: Record<MediaKind, RegExp> = {
  image: /^image\/(jpe?g|png|webp|gif)$/i,
  audio: /^audio\/(ogg|mpeg|mp3|mp4|amr|aac|x-m4a|webm)$/i,
  document: /^application\/pdf$/i,
}

/** Baixa os bytes de uma mídia da Meta a partir do media_id (respeitando o teto). */
async function downloadMetaMedia(
  mediaId: string,
  maxBytes: number
): Promise<{ data: Buffer; mimeType: string } | null> {
  const credentials = await getWhatsAppCredentials()
  if (!credentials?.accessToken) return null
  const headers = {
    Authorization: `Bearer ${credentials.accessToken}`,
    // Alguns endpoints do CDN da Meta exigem User-Agent
    'User-Agent': 'iatheoriental-bot/1.0',
  }

  // 1) Resolve a URL temporária da mídia
  const infoRes = await fetch(`https://graph.facebook.com/v24.0/${mediaId}`, {
    headers,
    signal: AbortSignal.timeout(8000),
  })
  if (!infoRes.ok) {
    console.error(`[media-understanding] Meta info error: HTTP ${infoRes.status}`)
    return null
  }
  const info = (await infoRes.json()) as { url?: string; mime_type?: string }
  if (!info.url) return null

  // 2) Baixa o arquivo
  const fileRes = await fetch(info.url, { headers, signal: AbortSignal.timeout(30000) })
  if (!fileRes.ok) {
    console.error(`[media-understanding] Meta download error: HTTP ${fileRes.status}`)
    return null
  }
  // Aborta cedo se o Content-Length já ultrapassa o teto (evita baixar 100MB).
  const declared = Number(fileRes.headers.get('content-length') || 0)
  if (declared && declared > maxBytes) {
    console.warn(`[media-understanding] mídia excede o teto (${declared} > ${maxBytes} bytes) — ignorada`)
    return null
  }
  const mimeType = (info.mime_type || fileRes.headers.get('content-type') || 'application/octet-stream')
    .split(';')[0]
    .trim()
  const buf = Buffer.from(await fileRes.arrayBuffer())
  // Rede de segurança: alguns CDNs não mandam Content-Length.
  if (buf.byteLength > maxBytes) {
    console.warn(`[media-understanding] mídia excede o teto após download (${buf.byteLength} > ${maxBytes} bytes) — ignorada`)
    return null
  }
  return { data: buf, mimeType }
}

const PROMPTS: Record<MediaKind, string> = {
  audio:
    'Transcreva este áudio para texto em português brasileiro. Retorne APENAS a transcrição literal do que foi dito, sem comentários, sem aspas e sem rótulos.',
  image:
    'Esta imagem foi enviada por um cliente de um restaurante no WhatsApp. Extraia TODO o texto visível e descreva de forma objetiva o que é (ex.: endereço, comprovante de pagamento, print de conversa, foto, cardápio). Responda em português brasileiro, curto e direto, apenas com o conteúdo útil.',
  document:
    'Este arquivo/documento foi enviado por um cliente de um restaurante no WhatsApp. Extraia o texto e resuma de forma objetiva o conteúdo relevante (ex.: comprovante de pagamento, lista de convidados, contrato, cardápio, cupom). Responda em português brasileiro, curto e direto, apenas com o conteúdo útil.',
}

/**
 * Baixa a mídia e devolve o texto entendido (transcrição/descrição).
 * Retorna string vazia se não conseguir (fail-safe — o fluxo segue sem mídia).
 */
export async function understandMedia(mediaId: string, kind: MediaKind): Promise<string> {
  try {
    if (!mediaId) return ''
    const cfg = await getAiDirectConfig()
    const apiKey = cfg.googleApiKey
    if (!apiKey) {
      console.warn('[media-understanding] google_api_key ausente — mídia não processada')
      return ''
    }
    const modelId = cfg.provider === 'google' && cfg.model ? cfg.model : 'gemini-flash-latest'

    const media = await downloadMetaMedia(mediaId, MAX_BYTES[kind])
    if (!media) return ''

    // Só processa tipos esperados para cada modalidade.
    if (!ALLOWED_MIME[kind].test(media.mimeType)) {
      console.warn(`[media-understanding] tipo não permitido para ${kind}: ${media.mimeType} — ignorado`)
      return ''
    }

    const { generateText } = await import('ai')
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    const model = createGoogleGenerativeAI({ apiKey })(modelId)

    const { text } = await generateText({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'file', data: media.data, mediaType: media.mimeType },
            { type: 'text', text: PROMPTS[kind] },
          ],
        },
      ],
      maxOutputTokens: 700,
      // Timeout próprio — diferente do agente principal, essa chamada não tinha.
      abortSignal: AbortSignal.timeout(15000),
    })
    return (text || '').trim()
  } catch (e) {
    console.error('[media-understanding]', e instanceof Error ? e.message : e)
    return ''
  }
}
