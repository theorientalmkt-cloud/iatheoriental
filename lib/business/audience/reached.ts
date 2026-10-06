/**
 * Público já alcançado — quem JÁ RECEBEU alguma mensagem nossa.
 *
 * Os presets de audiência filtram por atributo do contato (status, tag, data
 * de criação, UF, DDI). Nenhum deles responde "quem já recebeu mensagem",
 * porque isso não está no contato: está no histórico de envio, em duas
 * tabelas diferentes.
 *
 *   campaign_contacts  → disparos de campanha (template da Meta)
 *   inbox_messages     → conversa no inbox, incluindo as respostas da IA
 *
 * Um mesmo telefone costuma aparecer nas duas. A união é deduplicada por
 * telefone normalizado, guardando o primeiro e o último contato e de onde
 * cada um veio.
 *
 * Uso típico: montar a audiência de uma campanha de reengajamento (quem já
 * conhece a casa) ou o seu complemento (quem nunca foi abordado).
 */

import { getSupabaseAdmin } from '@/lib/supabase'
import { normalizePhoneNumber } from '@/lib/phone-formatter'

/** De onde veio o alcance. */
export type ReachedSource = 'campanha' | 'inbox'

export interface ReachedContact {
  /** Telefone normalizado (E.164). É a chave de deduplicação. */
  phone: string
  /** Id do contato, quando o envio estava ligado a um. */
  contactId: string | null
  name: string | null
  /** Primeira vez que recebeu algo nosso (ISO). */
  firstReachedAt: string | null
  /** Última vez que recebeu algo nosso (ISO). */
  lastReachedAt: string | null
  /** Quantas mensagens recebeu, somando as duas origens. */
  messageCount: number
  /** Origens em que esse telefone aparece. */
  sources: ReachedSource[]
}

export interface ReachedAudienceOptions {
  /** Só quem recebeu a partir desta data (ISO 'yyyy-mm-dd' ou timestamp). */
  since?: string | null
  /** Restringe a origem. Sem valor, soma as duas. */
  source?: ReachedSource | null
  /**
   * `true` exige confirmação de entrega pela Meta (delivered/read).
   * `false` (padrão) considera basta ter sido enviada — uma mensagem enviada
   * e não confirmada ainda significa que a pessoa foi abordada.
   */
  onlyDelivered?: boolean
}

export interface ReachedAudienceResult {
  contacts: ReachedContact[]
  /** Telefones distintos alcançados. */
  total: number
  /** Quantos vieram de cada origem (um telefone pode contar nas duas). */
  bySource: Record<ReachedSource, number>
}

/** Páginas de leitura — o Supabase corta em 1000 por padrão. */
const PAGE = 1000

function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a < b ? a : b
}

function latest(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

/**
 * Lê todas as páginas de uma consulta.
 *
 * Sem isso, uma base com mais de 1000 envios devolveria um público truncado
 * em silêncio — e a campanha sairia para menos gente do que o painel mostrou.
 */
async function readAllPages<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await run(page * PAGE, (page + 1) * PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

export async function fetchReachedAudience(
  options: ReachedAudienceOptions = {}
): Promise<ReachedAudienceResult> {
  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return { contacts: [], total: 0, bySource: { campanha: 0, inbox: 0 } }
  }

  const { since = null, source = null, onlyDelivered = false } = options
  const byPhone = new Map<string, ReachedContact>()

  const add = (
    rawPhone: string | null,
    origem: ReachedSource,
    at: string | null,
    contactId: string | null,
    name: string | null
  ) => {
    // Mesma validação do envio (lib/whatsapp-send): normalizar não basta —
    // "123" atravessa a normalização e viraria público para onde nada pode
    // ser enviado, inflando a contagem da campanha.
    const phone = normalizePhoneNumber(rawPhone || '')
    if (!phone || !/^\+\d{8,15}$/.test(phone)) return

    const found = byPhone.get(phone)
    if (!found) {
      byPhone.set(phone, {
        phone,
        contactId: contactId || null,
        name: name || null,
        firstReachedAt: at,
        lastReachedAt: at,
        messageCount: 1,
        sources: [origem],
      })
      return
    }

    found.messageCount += 1
    found.firstReachedAt = earliest(found.firstReachedAt, at)
    found.lastReachedAt = latest(found.lastReachedAt, at)
    found.contactId = found.contactId || contactId || null
    found.name = found.name || name || null
    if (!found.sources.includes(origem)) found.sources.push(origem)
  }

  // --- Origem A: disparos de campanha ---------------------------------------
  if (source === null || source === 'campanha') {
    type Row = {
      phone: string | null
      contact_id: string | null
      name: string | null
      sent_at: string | null
      delivered_at: string | null
      read_at: string | null
    }

    const rows = await readAllPages<Row>((from, to) => {
      let q = supabase
        .from('campaign_contacts')
        .select('phone, contact_id, name, sent_at, delivered_at, read_at')
        .not('sent_at', 'is', null)
        .order('sent_at', { ascending: true })
        .range(from, to)
      if (since) q = q.gte('sent_at', since)
      if (onlyDelivered) q = q.not('delivered_at', 'is', null)
      return q
    })

    for (const r of rows) {
      add(r.phone, 'campanha', r.delivered_at || r.sent_at, r.contact_id, r.name)
    }
  }

  // --- Origem B: mensagens que saíram pelo inbox ----------------------------
  if (source === null || source === 'inbox') {
    type Row = {
      created_at: string | null
      delivered_at: string | null
      delivery_status: string | null
      // O tipo gerado pelo Supabase para join embutido é array, embora a
      // relação seja para-um e o runtime devolva objeto. Aceita os dois.
      inbox_conversations:
        | { phone: string | null; contact_id: string | null }
        | Array<{ phone: string | null; contact_id: string | null }>
        | null
    }

    const rows = await readAllPages<Row>((from, to) => {
      let q = supabase
        .from('inbox_messages')
        .select('created_at, delivered_at, delivery_status, inbox_conversations!inner(phone, contact_id)')
        .eq('direction', 'outbound')
        .neq('delivery_status', 'failed')
        .order('created_at', { ascending: true })
        .range(from, to)
      if (since) q = q.gte('created_at', since)
      if (onlyDelivered) q = q.in('delivery_status', ['delivered', 'read'])
      return q
    })

    for (const r of rows) {
      const raw = r.inbox_conversations
      const conv = Array.isArray(raw) ? raw[0] : raw
      add(conv?.phone ?? null, 'inbox', r.delivered_at || r.created_at, conv?.contact_id ?? null, null)
    }
  }

  const contacts = [...byPhone.values()].sort((a, b) =>
    (b.lastReachedAt || '').localeCompare(a.lastReachedAt || '')
  )

  return {
    contacts,
    total: contacts.length,
    bySource: {
      campanha: contacts.filter((c) => c.sources.includes('campanha')).length,
      inbox: contacts.filter((c) => c.sources.includes('inbox')).length,
    },
  }
}
