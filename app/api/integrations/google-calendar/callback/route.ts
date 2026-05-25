import { NextRequest, NextResponse } from 'next/server'
import {
  exchangeCodeForTokens,
  fetchGoogleAccountEmail,
  saveTokens,
  buildDefaultCalendarConfig,
  saveCalendarConfig,
  ensureCalendarChannel,
} from '@/lib/google-calendar'
import { settingsDb } from '@/lib/supabase-db'

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')

    if (!code) {
      return NextResponse.json({ error: 'Codigo OAuth ausente' }, { status: 400 })
    }

    let savedState: string | null = null
    let returnTo = '/settings'

    const stateRaw = await settingsDb.get('gc_oauth_state')
    if (stateRaw) {
      try {
        const parsed = JSON.parse(stateRaw)
        savedState = parsed.state
        returnTo = parsed.returnTo || '/settings'

        const age = Date.now() - (parsed.createdAt || 0)
        if (age > 10 * 60 * 1000) {
          savedState = null
        }
      } catch {
        savedState = null
      }
    }

    if (!savedState) {
      savedState = request.cookies.get('gc_oauth_state')?.value || null
      returnTo = request.cookies.get('gc_oauth_return')?.value || '/settings'
    }

    if (!state || !savedState || state !== savedState) {
      return NextResponse.json({ error: 'Estado OAuth invalido' }, { status: 400 })
    }

    await settingsDb.set('gc_oauth_state', '')

    const tokens = await exchangeCodeForTokens(code)
    await saveTokens(tokens)

    const accountEmail = await fetchGoogleAccountEmail(tokens.accessToken)
    const config = await buildDefaultCalendarConfig(accountEmail, tokens.accessToken)
    await saveCalendarConfig(config)

    await ensureCalendarChannel(config.calendarId, tokens.accessToken)

    const safePath = returnTo.startsWith('/') ? returnTo : '/settings'
    const absoluteReturnUrl = `${url.origin}${safePath}`

    const response = NextResponse.redirect(absoluteReturnUrl)
    response.cookies.delete('gc_oauth_state')
    response.cookies.delete('gc_oauth_return')
    return response
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido'
    console.error('[google-calendar] callback error:', errorMessage, error)
    return NextResponse.json({
      error: 'Falha ao concluir OAuth',
      details: errorMessage
    }, { status: 500 })
  }
}
