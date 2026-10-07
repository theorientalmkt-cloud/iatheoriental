import { NextRequest, NextResponse } from 'next/server'
import { requireSessionOrApiKey } from '@/lib/request-auth'
import { sendWhatsAppMessage } from '@/lib/whatsapp-send'
import { inboxDb } from '@/lib/inbox/inbox-db'
import { getStoreInfo, storeWhatsAppLink } from '@/lib/store-info'
import { dispararContatoOficial } from '@/lib/inbox/broadcast-contato-oficial'

export const maxDuration = 300

/**
 * POST /api/inbox/broadcast-contato-oficial
 *
 * Envia o WhatsApp oficial do restaurante às conversas com janela de 24h
 * aberta que ainda não receberam o link.
 *
 * SIMULA por padrão. Para enviar de verdade é preciso `?confirmar=true` —
 * mensagem para cliente real não pode ser o efeito acidental de uma chamada.
 *
 *   POST /api/inbox/broadcast-contato-oficial                 → quantos receberiam
 *   POST /api/inbox/broadcast-contato-oficial?confirmar=true  → envia
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireSessionOrApiKey(request)
    if (auth) return auth

    const confirmar = new URL(request.url).searchParams.get('confirmar') === 'true'

    const store = await getStoreInfo()
    const link = storeWhatsAppLink(store.whatsappConfirm)
    if (!link) {
      return NextResponse.json(
        { error: 'WhatsApp oficial não configurado em Configurações → Dados da Loja.' },
        { status: 400 }
      )
    }

    const resultado = await dispararContatoOficial(
      link,
      { confirmar },
      {
        enviar: ({ to, texto }) => sendWhatsAppMessage({ to, type: 'text', text: texto }),
        registrar: async ({ conversationId, texto, messageId }) => {
          await inboxDb.createMessage({
            conversation_id: conversationId,
            direction: 'outbound',
            content: texto,
            message_type: 'text',
            whatsapp_message_id: messageId,
            delivery_status: 'sent',
          })
        },
      }
    )

    console.log(
      `[broadcast-contato-oficial] ${resultado.simulacao ? 'SIMULAÇÃO' : 'ENVIO'} — ` +
        `elegíveis=${resultado.elegiveis} enviados=${resultado.enviados} ` +
        `já_receberam=${resultado.pulados_ja_receberam} opt_out=${resultado.pulados_opt_out} ` +
        `falhas=${resultado.falhas}`
    )

    return NextResponse.json({
      ...resultado,
      link,
      aviso: resultado.simulacao
        ? 'Nada foi enviado. Repita com ?confirmar=true para disparar de verdade.'
        : undefined,
    })
  } catch (error) {
    console.error('[broadcast-contato-oficial] Falha:', error)
    return NextResponse.json(
      { error: 'Falha no disparo', details: (error as Error).message },
      { status: 500 }
    )
  }
}
