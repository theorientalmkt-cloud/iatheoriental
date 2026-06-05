/**
 * Contact Tool for AI Agents
 * The Oriental Sushiya
 *
 * Permite que a IA:
 * 1. Saiba se o cliente já é conhecido pelo telefone
 * 2. Salve o nome do cliente quando ele se identificar
 * 3. Personalize a conversa para clientes recorrentes
 */

import { supabase } from '@/lib/supabase'

// =============================================================================
// TYPES
// =============================================================================

export interface ContactInfo {
  contact_id: string | null
  contact_name: string | null
  is_known: boolean
  total_reservas: number
  ultima_visita: string | null
  preferred_menu: string | null
}

// =============================================================================
// TOOL 1: Buscar info do contato
// =============================================================================

export async function getContactInfo(phone: string): Promise<ContactInfo | null> {
  try {
    const { data, error } = await supabase
      .rpc('get_contact_info', { p_phone: phone })

    if (error) {
      console.error('[ContactTool] Erro ao buscar contato:', error)
      return null
    }

    if (!data || data.length === 0) {
      return {
        contact_id: null,
        contact_name: null,
        is_known: false,
        total_reservas: 0,
        ultima_visita: null,
        preferred_menu: null,
      }
    }

    return data[0] as ContactInfo
  } catch (err) {
    console.error('[ContactTool] Exception:', err)
    return null
  }
}

// =============================================================================
// TOOL 2: Atualizar nome do contato
// =============================================================================

export async function updateContactName(
  phone: string,
  name: string
): Promise<boolean> {
  try {
    if (!name || name.trim().length < 2) {
      console.warn('[ContactTool] Nome inválido:', name)
      return false
    }

    const { data, error } = await supabase
      .rpc('update_contact_name', {
        p_phone: phone,
        p_name: name.trim(),
      })

    if (error) {
      console.error('[ContactTool] Erro ao atualizar nome:', error)
      return false
    }

    return data === true
  } catch (err) {
    console.error('[ContactTool] Exception:', err)
    return false
  }
}

// =============================================================================
// HELPER: Formatar greeting baseado no contato
// =============================================================================

export function formatGreeting(contactInfo: ContactInfo | null): string {
  if (!contactInfo || !contactInfo.is_known) {
    return 'Olá, tudo bem? Obrigado pelo seu contato! Bem-vindo ao The Oriental Sushiya. Como posso te ajudar?'
  }

  const name = contactInfo.contact_name
  const reservas = contactInfo.total_reservas

  if (reservas === 0) {
    return `Olá, ${name}! Obrigado pelo seu contato. Bem-vindo ao The Oriental Sushiya. Como posso te ajudar?`
  }

  if (reservas >= 3) {
    // Cliente VIP — recebe cortesia
    return `Olá, ${name}! Que alegria ter você de volta ao The Oriental Sushiya. Como nosso cliente recorrente, você terá uma dose de sake japonês como cortesia. Como posso te ajudar hoje?`
  }

  return `Olá, ${name}! Bem-vindo de volta ao The Oriental Sushiya. Como posso te ajudar?`
}
