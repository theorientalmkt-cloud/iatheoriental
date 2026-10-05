/**
 * Catálogo de menus — FONTE ÚNICA da verdade.
 *
 * Antes, as mesmas regras viviam em três lugares que podiam divergir (e
 * divergiram): o system_prompt da IA, as constantes do internal-booking-tool e
 * o texto que a IA mostrava ao cliente. O prompt chegava a instruir o modelo a
 * IGNORAR a ferramenta quando os horários não batessem — ou seja, texto
 * estático vencendo o banco.
 *
 * Aqui ficam menu, preço, turnos válidos, capacidade e taxa de no-show. Deste
 * módulo saem, derivados:
 *   - os turnos que o checkAvailability oferece,
 *   - a validação de horário do confirmBooking,
 *   - o bloco de texto injetado no prompt da IA.
 *
 * Trocar de menu = editar este arquivo. Horários, validação e o que a IA diz
 * ao cliente passam a concordar por construção.
 */

/** Dia da semana como o JS devolve em getDay(): 0=Dom .. 6=Sáb. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface Menu {
  /** Identificador estável, usado em `reservations.menu_choice`. */
  id: string
  /** Nome como o cliente vê. */
  nome: string
  /** Preço por pessoa, em reais. */
  precoPorPessoa: number
  /** Taxa de no-show por pessoa, em reais. Cobrada só se o cliente faltar. */
  noShowPorPessoa: number
  /** Dias em que este menu é servido. */
  dias: Weekday[]
  /** Horários exatos de início. Não existe horário fora desta lista. */
  horarios: string[]
  /** Rótulo curto por horário, para apresentar a disponibilidade. */
  rotulo: (horario: string) => string
  /** Descrição que a IA pode usar ao falar do menu. */
  descricao: string
  /** Aceita reserva pela IA. */
  reservavel: boolean
}

export const CAPACITY_TOTAL = 9
/** Lugares no deck/janela — os únicos que aceitam pet. */
export const DECK_CAPACITY = 3
export const MIN_ADVANCE_HOURS = 2
export const TIMEZONE = 'America/Sao_Paulo'

/**
 * Menus vigentes.
 *
 * O Retrospectiva 2.0 substituiu o Nippon (que substituíra o Furusato) no
 * jantar. Menus encerrados não ficam aqui: enquanto o Nippon seguiu no prompt
 * depois de sair de cartaz, a IA anunciou a clientes um menu que não existia.
 */
export const MENUS: Menu[] = [
  {
    id: 'Retrospectiva',
    nome: 'Menu Retrospectiva 2.0',
    precoPorPessoa: 380,
    noShowPorPessoa: 100,
    dias: [2, 3, 4, 5, 6], // Ter a Sáb
    horarios: ['19:00', '21:00'],
    rotulo: (h) => `Jantar ${h.slice(0, 2)}h`,
    descricao:
      'Os melhores pratos dos menus 5, 6 e 7. Experiência de 19 etapas: 12 do sushibar, ' +
      '5 da cozinha, sobremesa e chá especial. Bebidas e serviço não inclusos. ' +
      'Não aceitamos vouchers ou cupons. Pagamento: PIX, débito, crédito ou dinheiro.',
    reservavel: true,
  },
  {
    id: 'XP',
    nome: 'Omakase Experience XP',
    precoPorPessoa: 210,
    noShowPorPessoa: 50,
    dias: [4, 5, 6, 0], // Qui a Dom
    horarios: ['13:00'],
    rotulo: () => 'Almoço XP 13h',
    descricao:
      'Foco em sushis tradicionais: 1 misoshiru, 12 peças (peixes variados, Blue Fin, ovas), ' +
      '1 sobremesa e chá japonês com refil. Reservar não é obrigatório, mas é recomendado ' +
      'para evitar filas.',
    reservavel: true,
  },
]

/** Menu por id. Lança se não existir — id inválido é erro de programação. */
export function menuById(id: string): Menu {
  const m = MENUS.find((x) => x.id === id)
  if (!m) throw new Error(`Menu desconhecido: ${id}`)
  return m
}

export interface Turno {
  time: string
  menu: string
  label: string
}

/** Turnos válidos num dia da semana, derivados do catálogo. */
export function turnosForWeekday(wd: number): Turno[] {
  const out: Turno[] = []
  for (const menu of MENUS) {
    if (!menu.reservavel) continue
    if (!menu.dias.includes(wd as Weekday)) continue
    for (const h of menu.horarios) {
      out.push({ time: h, menu: menu.id, label: menu.rotulo(h) })
    }
  }
  // Ordena por horário para a disponibilidade sair na ordem do dia.
  return out.sort((a, b) => a.time.localeCompare(b.time))
}

/**
 * O par dia+horário é um turno real da casa?
 *
 * É a REGRA 4 do prompt ("horários válidos são apenas os listados, proibido
 * inventar") virando checagem. Como instrução, ela dependia de o modelo
 * obedecer; aqui, um horário inventado simplesmente não passa.
 */
export function isTurnoValido(wd: number, horario: string): boolean {
  return turnosForWeekday(wd).some((t) => t.time === horario)
}

/** Taxa de no-show total do grupo. Cálculo sai do LLM e vem para o código. */
export function noShowTotal(menuId: string, pessoas: number): number {
  return menuById(menuId).noShowPorPessoa * pessoas
}

const WD_NOME: Record<number, string> = {
  0: 'Domingo', 1: 'Segunda', 2: 'Terça', 3: 'Quarta',
  4: 'Quinta', 5: 'Sexta', 6: 'Sábado',
}

/** Lista os dias de um menu de forma legível ("Terça a Sábado", "Quinta, Sexta"). */
function diasLegiveis(dias: Weekday[]): string {
  // Ordem da semana começando na terça, que é quando a casa abre.
  const ordem: Weekday[] = [2, 3, 4, 5, 6, 0]
  const presentes = ordem.filter((d) => dias.includes(d))
  if (presentes.length === 0) return ''

  // Sequência contígua vira intervalo ("Terça a Sábado").
  const idx = presentes.map((d) => ordem.indexOf(d))
  const contiguo = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)
  if (contiguo && presentes.length > 2) {
    return `${WD_NOME[presentes[0]]} a ${WD_NOME[presentes[presentes.length - 1]]}`
  }
  return presentes.map((d) => WD_NOME[d]).join(', ')
}

/**
 * Bloco de menus/horários/taxas injetado no prompt da IA.
 *
 * Gerado a partir do catálogo, e não escrito à mão: é isso que impede o texto
 * que a IA lê de divergir dos turnos que a ferramenta oferece.
 */
export function buildMenuRulesBlock(): string {
  const linhas: string[] = []

  linhas.push('## MENUS E HORÁRIOS (oficiais — fonte única, nunca invente)')
  linhas.push('')

  for (const m of MENUS) {
    linhas.push(`### ${m.nome} — R$ ${m.precoPorPessoa} por pessoa`)
    linhas.push(`- Dias: ${diasLegiveis(m.dias)}`)
    linhas.push(`- Horários: APENAS ${m.horarios.map((h) => `${h.slice(0, 2)}h`).join(' ou ')}`)
    linhas.push(`- Taxa de no-show: R$ ${m.noShowPorPessoa} por pessoa, cobrada SOMENTE se o cliente não comparecer (não é sinal nem entrada)`)
    linhas.push(`- ${m.descricao}`)
    linhas.push('')
  }

  const fechados = ([1, 0] as Weekday[]).filter((d) => !MENUS.some((m) => m.dias.includes(d)))
  if (fechados.length) {
    linhas.push(`FECHADO: ${fechados.map((d) => WD_NOME[d]).join(' e ')}. Nenhum horário disponível.`)
    linhas.push('')
  }

  linhas.push('Não existe nenhum horário além dos listados acima. Se o cliente pedir outro,')
  linhas.push('informe que não está disponível e ofereça os horários válidos mais próximos.')
  linhas.push('')
  linhas.push(`Capacidade: ${CAPACITY_TOTAL} lugares por turno, dos quais ${DECK_CAPACITY} ficam no deck/janela`)
  linhas.push('(os únicos que aceitam pet). O cliente NUNCA escolhe o local — a casa aloca.')
  linhas.push('')
  linhas.push('Os números de vagas vêm SEMPRE da ferramenta checkAvailability, que lê a agenda')
  linhas.push('em tempo real. Este bloco não contém vaga nenhuma — sem consultar, você não sabe.')

  return linhas.join('\n')
}
