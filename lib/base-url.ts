/**
 * URL pública do deploy, para montar links absolutos.
 *
 * A Meta busca a mídia por URL — um caminho relativo não serve.
 *
 * A origem sai, nesta ordem:
 *   1. NEXT_PUBLIC_APP_URL — domínio fixo, quando configurado de propósito
 *   2. os cabeçalhos da própria requisição — o serviço já sabe onde está
 *   3. VERCEL_URL — depende de "System Environment Variables" estar ligado
 *
 * O passo 2 existe para que nada precise ser configurado: exigir uma variável
 * para o servidor descobrir o próprio endereço é trabalho inventado, e vira
 * uma falha silenciosa quando alguém esquece.
 *
 * Nota: `lib/google-calendar.ts` e `lib/whatsapp-status-events.ts` têm cada um
 * a sua cópia privada desta lógica. Unificar as três fica para um PR próprio.
 */

/** Origem a partir dos cabeçalhos. Atrás de proxy, o host real vem em x-forwarded-*. */
function fromHeaders(headers: Headers): string | null {
  const host = headers.get('x-forwarded-host') || headers.get('host')
  if (!host) return null
  // Em produção o proxy informa o esquema; localmente assume http.
  const proto = headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host.replace(/\/+$/, '')}`
}

export function getBaseUrl(headers?: Headers): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  if (headers) {
    const fromReq = fromHeaders(headers)
    if (fromReq) return fromReq
  }

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`

  return null
}

/** Caminho em `public/` para URL absoluta. Null se a origem for desconhecida. */
export function absoluteUrl(path: string, headers?: Headers): string | null {
  const base = getBaseUrl(headers)
  if (!base) return null
  return `${base}/${path.replace(/^\/+/, '')}`
}
