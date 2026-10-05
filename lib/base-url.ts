/**
 * URL pública do deploy, para montar links absolutos.
 *
 * A Meta busca a mídia por URL — um caminho relativo não serve.
 *
 * Nota: `lib/google-calendar.ts` e `lib/whatsapp-status-events.ts` têm cada um
 * a sua cópia privada desta lógica. Unificar as três fica para um PR próprio.
 */
export function getBaseUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`

  return null
}

/** Caminho em `public/` para URL absoluta. Null se a base não estiver definida. */
export function absoluteUrl(path: string): string | null {
  const base = getBaseUrl()
  if (!base) return null
  return `${base}/${path.replace(/^\/+/, '')}`
}
