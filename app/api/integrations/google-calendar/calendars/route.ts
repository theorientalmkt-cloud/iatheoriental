import { NextResponse } from 'next/server'
import { listCalendars, getStoredTokens, ensureAccessToken, saveTokens } from '@/lib/google-calendar'
import { isSupabaseConfigured } from '@/lib/supabase'

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Supabase nao configurado' }, { status: 400 })
    }

    const tokens = await getStoredTokens()
    if (!tokens?.accessToken) {
      return NextResponse.json({
        error: 'Google Calendar nao conectado',
        hint: 'Conecte pelo wizard em Configuracoes'
      }, { status: 400 })
    }

    try {
      const freshTokens = await ensureAccessToken()
      if (freshTokens.accessToken !== tokens.accessToken) {
        await saveTokens(freshTokens)
      }
    } catch (refreshError) {
      console.warn('[google-calendar] Token refresh failed, trying with current token:', refreshError)
    }

    const calendars = await listCalendars()
    const payload = calendars.map((item: any) => ({
      id: String(item.id),
      summary: String(item.summary || ''),
      primary: Boolean(item.primary),
      timeZone: item.timeZone ? String(item.timeZone) : null,
    }))

    return NextResponse.json({ calendars: payload })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Erro desconhecido'
    console.error('[google-calendar] calendars error:', msg)

    if (msg.includes('nao conectado') || msg.includes('Invalid Credentials') || msg.includes('401')) {
      return NextResponse.json({
        error: 'Token do Google Calendar expirou. Reconecte pelo wizard.',
        needsReconnect: true
      }, { status: 401 })
    }

    return NextResponse.json({ error: 'Falha ao listar calendarios' }, { status: 500 })
  }
}
