import { NextRequest, NextResponse } from 'next/server'
import { requireSessionOrApiKey } from '@/lib/request-auth'
import { fetchReachedAudience, type ReachedSource } from '@/lib/business/audience/reached'

/**
 * GET /api/contacts/reached
 *
 * Público já alcançado: quem JÁ RECEBEU alguma mensagem nossa, somando os
 * disparos de campanha e o que saiu pelo inbox, deduplicado por telefone.
 *
 * Query params:
 *   since=2026-09-01   só quem recebeu a partir da data
 *   source=campanha    restringe a origem (campanha | inbox)
 *   delivered=true     exige confirmação de entrega pela Meta
 *   format=csv         devolve CSV em vez de JSON
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireSessionOrApiKey(request)
    if (auth) return auth

    const { searchParams } = new URL(request.url)

    const sourceRaw = searchParams.get('source')
    if (sourceRaw && sourceRaw !== 'campanha' && sourceRaw !== 'inbox') {
      return NextResponse.json(
        { error: "Parâmetro 'source' inválido. Use 'campanha' ou 'inbox'." },
        { status: 400 }
      )
    }

    const result = await fetchReachedAudience({
      since: searchParams.get('since'),
      source: (sourceRaw as ReachedSource | null) ?? null,
      onlyDelivered: searchParams.get('delivered') === 'true',
    })

    if (searchParams.get('format') === 'csv') {
      const linhas = [
        'telefone,nome,primeiro_contato,ultimo_contato,mensagens,origens',
        ...result.contacts.map((c) =>
          [
            c.phone,
            // Aspas duplicadas: nome com vírgula quebraria a coluna.
            `"${(c.name || '').replace(/"/g, '""')}"`,
            c.firstReachedAt || '',
            c.lastReachedAt || '',
            String(c.messageCount),
            c.sources.join('|'),
          ].join(',')
        ),
      ]
      return new NextResponse(linhas.join('\n'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="publico-alcancado.csv"',
          'Cache-Control': 'private, no-store',
        },
      })
    }

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0' },
    })
  } catch (error) {
    console.error('Failed to fetch reached audience:', error)
    return NextResponse.json(
      { error: 'Falha ao buscar o público alcançado', details: (error as Error).message },
      { status: 500 }
    )
  }
}
