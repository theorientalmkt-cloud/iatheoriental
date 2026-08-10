/**
 * Validação de sessão SEM `next/headers` — usável no proxy (Edge runtime) e em
 * rotas de API. Consulta `settings.session_tokens` via Supabase REST (fetch).
 *
 * Política FAIL-OPEN em erro de infra: se não dá para validar (env ausente, fetch
 * falhou, lista legada), retorna `true` para NÃO trancar o dono fora do painel.
 * Retorna `false` apenas quando LÊ a lista de sessões e o token não está lá /
 * está expirado — que é exatamente o caso do cookie forjado por um atacante.
 */

const SESSION_MAX_AGE_MS = 60 * 60 * 24 * 7 * 1000 // 7 dias

export async function isValidSessionTokenEdge(token: string): Promise<boolean> {
  try {
    const t = String(token || '').trim()
    if (t.length < 10) return false

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      console.warn('[session-edge] Supabase env ausente — sessão não validada (fail-open)')
      return true
    }

    const res = await fetch(
      `${url}/rest/v1/settings?key=eq.session_tokens&select=value`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(3000),
      }
    )
    if (!res.ok) {
      console.warn(`[session-edge] settings fetch HTTP ${res.status} — fail-open`)
      return true
    }

    const rows = (await res.json()) as Array<{ value?: string }>
    const raw = rows?.[0]?.value
    if (!raw) {
      // Sem lista de sessões (setup legado com token único, ou ainda não gravada):
      // não dá para validar aqui — fail-open para não trancar.
      return true
    }

    let list: Array<{ token?: string; createdAt?: string }> = []
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) list = parsed
      else return true // formato inesperado — fail-open
    } catch {
      return true // JSON inválido — fail-open
    }

    const now = Date.now()
    return list.some((s) => {
      if (s?.token !== t) return false
      const created = s.createdAt ? new Date(s.createdAt).getTime() : NaN
      if (Number.isNaN(created)) return true // token presente, sem data — aceita
      return now - created <= SESSION_MAX_AGE_MS
    })
  } catch (e) {
    console.warn('[session-edge] erro ao validar sessão — fail-open:', e instanceof Error ? e.message : e)
    return true
  }
}
