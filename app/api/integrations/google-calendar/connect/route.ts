import { NextRequest, NextResponse } from 'next/server'
import { createOAuthState, buildGoogleCalendarAuthUrl } from '@/lib/google-calendar'
import { settingsDb } from '@/lib/supabase-db'

function normalizeReturnTo(value: string | null): string {
  if (!value) return '/settings'
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) return '/settings'
  return trimmed
}

export async function GET(request: NextRequest) {
  try {
    const state = createOAuthState()
    const authUrl = await buildGoogleCalendarAuthUrl(state)
    const returnTo = normalizeReturnTo(request.nextUrl.searchParams.get('returnTo'))

    await settingsDb.set('gc_oauth_state', JSON.stringify({
      state,
      returnTo,
      createdAt: Date.now(),
    }))

    return NextResponse.redirect(authUrl)
  } catch (error) {
    console.error('[google-calendar] connect error:', error)
    return NextResponse.json({ error: 'Falha ao iniciar OAuth' }, { status: 500 })
  }
}
