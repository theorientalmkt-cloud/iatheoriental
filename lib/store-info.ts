/**
 * Dados da Loja — fonte FIXA no banco (settings.store_info), não no prompt.
 *
 * Endereço e WhatsApp de confirmação ficam aqui para o sistema usar sempre
 * certo: o endereço é injetado no contexto da IA e o link de confirmação é
 * enviado automaticamente após a reserva. Atualiza num lugar só (Configurações
 * → Dados da Loja) e todo o sistema já usa o novo valor.
 */

import { settingsDb } from '@/lib/supabase-db'

export interface StoreInfo {
  address: string
  /** só dígitos, formato internacional (ex.: 5511973832745) */
  whatsappConfirm: string
  /** se true, envia o link do WhatsApp da loja automaticamente após cada reserva */
  sendLinkAfterBooking: boolean
}

export const DEFAULT_STORE_INFO: StoreInfo = {
  address: 'Rua Luís Góis, 1499 - Vila Clementino, São Paulo - SP, CEP 04043-350',
  whatsappConfirm: '5511973832745',
  sendLinkAfterBooking: true,
}

const KEY = 'store_info'

export async function getStoreInfo(): Promise<StoreInfo> {
  try {
    const raw = await settingsDb.get(KEY)
    if (!raw) return DEFAULT_STORE_INFO
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<StoreInfo>
    return {
      address: String(parsed.address ?? DEFAULT_STORE_INFO.address),
      whatsappConfirm: String(parsed.whatsappConfirm ?? DEFAULT_STORE_INFO.whatsappConfirm).replace(/\D/g, ''),
      sendLinkAfterBooking:
        typeof parsed.sendLinkAfterBooking === 'boolean'
          ? parsed.sendLinkAfterBooking
          : DEFAULT_STORE_INFO.sendLinkAfterBooking,
    }
  } catch {
    return DEFAULT_STORE_INFO
  }
}

export async function setStoreInfo(input: Partial<StoreInfo>): Promise<StoreInfo> {
  const current = await getStoreInfo()
  const next: StoreInfo = {
    address: String(input.address ?? current.address).trim(),
    whatsappConfirm: String(input.whatsappConfirm ?? current.whatsappConfirm).replace(/\D/g, ''),
    sendLinkAfterBooking:
      typeof input.sendLinkAfterBooking === 'boolean' ? input.sendLinkAfterBooking : current.sendLinkAfterBooking,
  }
  await settingsDb.set(KEY, JSON.stringify(next))
  return next
}

/** Monta o link wa.me a partir dos dígitos do número (vazio se não houver número). */
export function storeWhatsAppLink(digits: string): string {
  const clean = String(digits || '').replace(/\D/g, '')
  return clean ? `https://wa.me/${clean}` : ''
}
