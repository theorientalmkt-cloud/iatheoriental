/**
 * Menu Vigente — GET/POST de settings.menu_info.
 * Usado pela telinha Configurações → Menu Vigente.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getMenuInfo, setMenuInfo } from '@/lib/menu-info'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const info = await getMenuInfo()
  return NextResponse.json(info)
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  // Validação leve da data (yyyy-mm-dd; vazio é permitido = limpa a vigência).
  if (body.validoAte !== undefined && body.validoAte !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.validoAte))) {
    return NextResponse.json(
      { error: 'Data inválida. Use o formato yyyy-mm-dd.' },
      { status: 400 }
    )
  }

  const saved = await setMenuInfo({
    nome: body.nome,
    validoAte: body.validoAte,
    nota: body.nota,
  })
  return NextResponse.json({ success: true, ...saved })
}
