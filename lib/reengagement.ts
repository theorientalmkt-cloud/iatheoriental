/**
 * Reengajamento — identifica leads que RECEBERAM uma campanha mas NÃO responderam.
 *
 * "Recebeu"   → linha em campaign_contacts com o timestamp do modo escolhido
 *               (sent_at / delivered_at / read_at).
 * "Respondeu" → existe mensagem inbound (inbox_messages) daquele telefone
 *               DEPOIS do envio da campanha (comparado ao sent_at de cada contato).
 *
 * Tudo é calculado com queries em lote + diff em memória (sem RPC nova, então
 * não depende de migration manual no banco). Pagina além de 1000 linhas.
 */

import { supabase } from '@/lib/supabase'
import { normalizePhoneNumber } from '@/lib/phone-formatter'

export type ReceivedMode = 'sent' | 'delivered' | 'read'

export interface NonResponder {
  contactId: string | null
  phone: string
  name: string | null
  /** Quando a campanha chegou nesse contato (delivered/read/sent, o que houver). */
  receivedAt: string | null
}

export interface NonResponderResult {
  campaignId: string
  mode: ReceivedMode
  /** Quantos receberam (conforme o modo). */
  received: number
  /** Quantos, dos que receberam, responderam depois do envio. */
  responded: number
  /** Lista de quem recebeu e ficou quieto. */
  nonResponders: NonResponder[]
  /** Quantos não-respondentes têm contact_id (podem ser marcados com tag). */
  taggable: number
}

interface ReceivedRow {
  contactId: string | null
  phone: string
  phoneNorm: string
  name: string | null
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
}

const PAGE = 1000
const IN_CHUNK = 300

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function norm(phone: string): string {
  const p = String(phone || '').trim()
  return normalizePhoneNumber(p) || p
}

/** Contatos que RECEBERAM a campanha, conforme o modo (paginado). */
async function fetchReceived(campaignId: string, mode: ReceivedMode): Promise<ReceivedRow[]> {
  const seen = new Set<string>()
  const out: ReceivedRow[] = []

  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('campaign_contacts')
      .select('contact_id, phone, name, sent_at, delivered_at, read_at')
      .eq('campaign_id', campaignId)
      .order('sent_at', { ascending: true, nullsFirst: false })
      .range(from, from + PAGE - 1)

    if (mode === 'read') q = q.not('read_at', 'is', null)
    else if (mode === 'delivered') q = q.not('delivered_at', 'is', null)
    else q = q.not('sent_at', 'is', null)

    const { data, error } = await q
    if (error) throw error
    const batch = (data || []) as Array<Record<string, unknown>>

    for (const r of batch) {
      const phone = String(r.phone || '').trim()
      if (!phone) continue
      const phoneNorm = norm(phone)
      // Dedup por telefone (uma campanha não deveria repetir, mas é defensivo).
      if (seen.has(phoneNorm)) continue
      seen.add(phoneNorm)
      out.push({
        contactId: (r.contact_id as string) ?? null,
        phone,
        phoneNorm,
        name: (r.name as string) ?? null,
        sentAt: (r.sent_at as string) ?? null,
        deliveredAt: (r.delivered_at as string) ?? null,
        readAt: (r.read_at as string) ?? null,
      })
    }

    if (batch.length < PAGE) break
  }

  return out
}

/**
 * Mapa telefone(normalizado) → epoch(ms) da resposta inbound MAIS RECENTE,
 * considerando apenas mensagens a partir de `sinceIso`.
 */
async function fetchLatestInboundByPhone(
  rawPhones: string[],
  sinceIso: string
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (!rawPhones.length) return result

  // 1) Conversas desses telefones → mapa convId → telefone normalizado.
  const convIdToPhone = new Map<string, string>()
  for (const part of chunk(rawPhones, IN_CHUNK)) {
    const { data, error } = await supabase
      .from('inbox_conversations')
      .select('id, phone')
      .in('phone', part)
    if (error) throw error
    for (const row of (data || []) as Array<Record<string, unknown>>) {
      if (!row.id) continue
      convIdToPhone.set(String(row.id), norm(String(row.phone || '')))
    }
  }

  const convIds = Array.from(convIdToPhone.keys())
  if (!convIds.length) return result

  // 2) Mensagens inbound dessas conversas, a partir de sinceIso.
  for (const part of chunk(convIds, IN_CHUNK)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('inbox_messages')
        .select('conversation_id, created_at')
        .in('conversation_id', part)
        .eq('direction', 'inbound')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1)
      if (error) throw error
      const batch = (data || []) as Array<Record<string, unknown>>

      for (const row of batch) {
        const phone = convIdToPhone.get(String(row.conversation_id))
        if (!phone) continue
        const ts = new Date(String(row.created_at)).getTime()
        if (!Number.isFinite(ts)) continue
        const prev = result.get(phone)
        if (prev === undefined || ts > prev) result.set(phone, ts)
      }

      if (batch.length < PAGE) break
    }
  }

  return result
}

/** Núcleo: quem recebeu a campanha e não respondeu depois do envio. */
export async function getNonResponders(
  campaignId: string,
  mode: ReceivedMode = 'delivered'
): Promise<NonResponderResult> {
  const received = await fetchReceived(campaignId, mode)
  if (!received.length) {
    return { campaignId, mode, received: 0, responded: 0, nonResponders: [], taggable: 0 }
  }

  // Janela de busca de respostas: a partir do envio mais antigo desta campanha.
  const times = received
    .map((r) => new Date(r.sentAt || r.deliveredAt || r.readAt || 0).getTime())
    .filter((n) => Number.isFinite(n) && n > 0)
  const windowStartMs = times.length ? Math.min(...times) : Date.now() - 90 * 24 * 3600 * 1000
  const windowStartIso = new Date(windowStartMs).toISOString()

  const rawPhones = Array.from(new Set(received.map((r) => r.phone)))
  const latestInbound = await fetchLatestInboundByPhone(rawPhones, windowStartIso)

  const nonResponders: NonResponder[] = []
  let responded = 0

  for (const r of received) {
    // Respondeu = tem inbound DEPOIS do momento em que a campanha saiu pra ele.
    const cmpMs = new Date(r.sentAt || r.deliveredAt || r.readAt || windowStartIso).getTime()
    const latest = latestInbound.get(r.phoneNorm)
    if (latest !== undefined && latest >= cmpMs) {
      responded += 1
      continue
    }
    nonResponders.push({
      contactId: r.contactId,
      phone: r.phone,
      name: r.name,
      receivedAt: r.deliveredAt || r.readAt || r.sentAt,
    })
  }

  const taggable = nonResponders.filter((n) => n.contactId).length
  return { campaignId, mode, received: received.length, responded, nonResponders, taggable }
}
