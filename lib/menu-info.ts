/**
 * Menu Vigente — fonte FIXA no banco (settings.menu_info), não no prompt.
 *
 * Guarda o menu atual e a DATA DE VALIDADE. É injetado no contexto da IA para
 * que ela SEMPRE crave a data certa (nunca invente) e crie urgência real nos
 * últimos dias. Atualiza num lugar só (Configurações → Menu Vigente).
 */

import { settingsDb } from '@/lib/supabase-db'

export interface MenuInfo {
  /** Nome/tema do menu vigente (ex.: "Omakase Nippon"). Vazio = "menu da casa". */
  nome: string
  /** Data de validade, ISO 'yyyy-mm-dd'. Vazio = não menciona vigência. */
  validoAte: string
  /** Observação opcional para a IA (ex.: "troca toda terça"). */
  nota: string
}

// Pré-configurado com o menu atual (válido até 18/08). Edite em
// Configurações → Menu Vigente. Assim que o usuário salvar, o valor do banco
// passa a valer sobre este default.
export const DEFAULT_MENU_INFO: MenuInfo = {
  nome: '',
  validoAte: '2026-08-18',
  nota: '',
}

// Estado "sem vigência" — usado quando a leitura FALHA, para não injetar a data
// hardcoded por cima de um valor real salvo (a IA simplesmente não menciona).
const EMPTY_MENU_INFO: MenuInfo = { nome: '', validoAte: '', nota: '' }

const KEY = 'menu_info'

/** yyyy-mm-dd estrito E data real de calendário (rejeita 2026-02-30, 2026-99-99). */
function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export async function getMenuInfo(): Promise<MenuInfo> {
  try {
    const raw = await settingsDb.get(KEY)
    if (!raw) return DEFAULT_MENU_INFO
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<MenuInfo>
    return {
      nome: String(parsed.nome ?? DEFAULT_MENU_INFO.nome).trim(),
      validoAte: isYmd(parsed.validoAte) ? String(parsed.validoAte) : '',
      nota: String(parsed.nota ?? DEFAULT_MENU_INFO.nota).trim(),
    }
  } catch {
    // Erro transitório NÃO deve injetar a data hardcoded por cima de um valor
    // real salvo — degrada para "sem vigência" (a IA não menciona o menu).
    return EMPTY_MENU_INFO
  }
}

export async function setMenuInfo(input: Partial<MenuInfo>): Promise<MenuInfo> {
  const current = await getMenuInfo()
  const next: MenuInfo = {
    nome: String(input.nome ?? current.nome).trim(),
    validoAte:
      input.validoAte !== undefined
        ? isYmd(input.validoAte)
          ? input.validoAte
          : '' // string vazia limpa a vigência; valor inválido também zera
        : current.validoAte,
    nota: String(input.nota ?? current.nota).trim(),
  }
  await settingsDb.set(KEY, JSON.stringify(next))
  return next
}

/**
 * Dias entre hoje (ymd, fuso de quem chamou) e validoAte. Negativo = vencido,
 * 0 = último dia. Usa Date.UTC nos dois lados (comparação dia-a-dia, sem drift
 * de fuso). Retorna null se alguma data for inválida.
 */
export function daysUntil(validoAte: string, todayYmd: string): number | null {
  if (!isYmd(validoAte) || !isYmd(todayYmd)) return null
  const a = Date.UTC(+validoAte.slice(0, 4), +validoAte.slice(5, 7) - 1, +validoAte.slice(8, 10))
  const b = Date.UTC(+todayYmd.slice(0, 4), +todayYmd.slice(5, 7) - 1, +todayYmd.slice(8, 10))
  return Math.round((a - b) / 86_400_000)
}
