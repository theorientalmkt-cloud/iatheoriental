/**
 * Card — Funil "Campanhas → Reservas".
 *
 * Mostra a conversão global: quantas mensagens as campanhas enviaram vs.
 * quantas reservas a IA marcou (source = 'whatsapp_ia'). O CÓDIGO conta —
 * a UI só exibe. É um indicador AGREGADO (total x total), não atribuição
 * por campanha (isso exigiria vincular cada reserva à campanha de origem).
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CANCELLED = new Set(['cancelado', 'no_show'])

export async function GET() {
  const supabase = getSupabaseAdmin()
  if (!supabase) return NextResponse.json({ error: 'Supabase não configurado' }, { status: 500 })

  // Mensagens enviadas em campanhas (soma do contador `sent`)
  const { data: camps } = await supabase.from('campaigns').select('sent')
  const mensagensEnviadas = (camps || []).reduce((s, c) => s + (Number(c.sent) || 0), 0)

  // Reservas criadas pela IA (source = 'whatsapp_ia')
  const { data: res } = await supabase
    .from('reservations')
    .select('status, party_size')
    .eq('source', 'whatsapp_ia')
    .limit(10000)

  const rows = res || []
  const reservasIA = rows.length
  const pessoasIA = rows.reduce((s, r) => s + (Number(r.party_size) || 0), 0)
  const reservasIAAtivas = rows.filter((r) => !CANCELLED.has(String(r.status || '').toLowerCase())).length

  const statusMap = new Map<string, number>()
  for (const r of rows) {
    const st = String(r.status || 'pendente').toLowerCase()
    statusMap.set(st, (statusMap.get(st) || 0) + 1)
  }
  const porStatus = Array.from(statusMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([status, qtd]) => ({ status, qtd }))

  const taxaConversao =
    mensagensEnviadas > 0 ? Math.round((reservasIA / mensagensEnviadas) * 1000) / 10 : 0

  return NextResponse.json({
    mensagensEnviadas,
    reservasIA,
    reservasIAAtivas,
    pessoasIA,
    taxaConversao,
    porStatus,
    generatedAt: new Date().toISOString(),
  })
}
