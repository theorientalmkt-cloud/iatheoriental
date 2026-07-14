/**
 * Chat Agent - Tool-based RAG (Vercel AI SDK pattern)
 *
 * Agente de chat que processa conversas do inbox usando IA.
 * Suporta Google Gemini e OpenAI diretamente com chave do usuário.
 *
 * Usa RAG próprio com Supabase pgvector seguindo o padrão recomendado pela Vercel:
 * - O LLM recebe uma tool `searchKnowledgeBase` e DECIDE quando usá-la
 * - Para saudações ("oie") → responde direto, sem buscar
 * - Para perguntas ("qual o horário?") → chama a tool, depois responde
 *
 * Isso é mais eficiente que "eager RAG" (sempre buscar) porque:
 * - Reduz latência em mensagens que não precisam de contexto
 * - Reduz custos de embedding (menos queries)
 * - Evita injetar ruído em conversas simples
 */

import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase'
import { DEFAULT_MODEL_ID } from '@/lib/ai/model'
import { getAiDirectConfig } from '@/lib/ai/ai-center-config'
import type { AIAgent, InboxConversation, InboxMessage } from '@/types'

// NOTE: AI dependencies are imported DYNAMICALLY inside processChatAgent
// This is required because static imports can cause issues when called from
// background contexts (like debounced webhook handlers)

// =============================================================================
// Debounce Manager
// =============================================================================

/**
 * Track pending responses to implement debounce
 * Key: conversationId, Value: timeout handle and last message timestamp
 */
const pendingResponses = new Map<
  string,
  {
    timeout: NodeJS.Timeout
    lastMessageAt: number
    messageIds: string[]
  }
>()

/**
 * Check if we should wait for more messages (debounce)
 * Returns true if we should delay processing
 */
export function shouldDebounce(
  conversationId: string,
  debounceSec: number = 5
): boolean {
  const pending = pendingResponses.get(conversationId)
  if (!pending) return false

  const elapsed = Date.now() - pending.lastMessageAt
  return elapsed < debounceSec * 1000
}

/**
 * Schedule agent processing with debounce
 * Returns a promise that resolves when processing should begin
 */
export function scheduleWithDebounce(
  conversationId: string,
  messageId: string,
  debounceSec: number = 5
): Promise<string[]> {
  return new Promise((resolve) => {
    const pending = pendingResponses.get(conversationId)

    // Clear existing timeout
    if (pending?.timeout) {
      clearTimeout(pending.timeout)
    }

    // Accumulate message IDs
    const messageIds = pending?.messageIds || []
    messageIds.push(messageId)

    // Set new timeout
    const timeout = setTimeout(() => {
      const accumulated = pendingResponses.get(conversationId)
      pendingResponses.delete(conversationId)
      resolve(accumulated?.messageIds || messageIds)
    }, debounceSec * 1000)

    pendingResponses.set(conversationId, {
      timeout,
      lastMessageAt: Date.now(),
      messageIds,
    })
  })
}

/**
 * Cancel pending debounce for a conversation
 */
export function cancelDebounce(conversationId: string): void {
  const pending = pendingResponses.get(conversationId)
  if (pending?.timeout) {
    clearTimeout(pending.timeout)
    pendingResponses.delete(conversationId)
  }
}

// =============================================================================
// Types
// =============================================================================

export interface ContactContext {
  name?: string
  email?: string
  created_at?: string
}

export interface SupportAgentConfig {
  agent: AIAgent
  conversation: InboxConversation
  messages: InboxMessage[]
  contactData?: ContactContext
}

export interface SupportAgentResult {
  success: boolean
  response?: SupportResponse
  error?: string
  latencyMs: number
  logId?: string
}

// =============================================================================
// Response Schema
// =============================================================================

// Schema base (sem handoff)
// IMPORTANTE: usamos .nullable() em vez de .optional() em campos que o LLM pode
// pular. Gemini Flash rejeita function calls como "malformed" quando tenta
// preencher campos optional com valores vazios — nullable é explícito.
const baseResponseSchema = z.object({
  message: z.string().describe('A resposta para enviar ao usuário'),
  sentiment: z
    .enum(['positive', 'neutral', 'negative', 'frustrated'])
    .describe('Sentimento detectado na mensagem do usuário'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Nível de confiança na resposta (0 = incerto, 1 = certo)'),
  // sources é preenchido server-side pelo searchKnowledgeBase, mas mantido
  // no schema por compatibilidade. LLM pode mandar null.
  sources: z
    .array(
      z.object({
        title: z.string(),
        content: z.string(),
      })
    )
    .nullable()
    .describe('Fontes utilizadas para gerar a resposta. Use null se não houver.'),
  shouldQuoteUserMessage: z
    .boolean()
    .nullable()
    .describe('Se a resposta deve citar a mensagem do usuário (reply). Use null ou false se não.'),
})

// Campos de handoff (adicionados quando habilitado)
// NOTA: A lógica de QUANDO fazer handoff deve estar no system_prompt do agente,
// não aqui. Este schema apenas define a estrutura da resposta.
//
// IMPORTANTE: usamos .nullable() em vez de .optional() porque o Gemini Flash
// rejeita function calls "malformed" quando tenta preencher campos optional
// com strings vazias. Nullable é mais explícito — Gemini entende que pode mandar null
// e não tenta gerar string vazia que quebra o parser.
const handoffFields = {
  shouldHandoff: z
    .boolean()
    .describe('Se deve transferir para um atendente humano (true) ou continuar atendendo (false)'),
  handoffReason: z
    .string()
    .nullable()
    .describe('Motivo da transferência para humano. Use null se shouldHandoff=false'),
  handoffSummary: z
    .string()
    .nullable()
    .describe('Resumo da conversa para o atendente. Use null se shouldHandoff=false'),
}

// Schema completo (com handoff) - mantido para compatibilidade
const supportResponseSchema = baseResponseSchema.extend(handoffFields)

/**
 * Gera o schema de resposta baseado na configuração do agente
 */
function getResponseSchema(handoffEnabled: boolean) {
  if (handoffEnabled) {
    return baseResponseSchema.extend(handoffFields)
  }
  return baseResponseSchema
}

export type SupportResponse = z.infer<typeof supportResponseSchema>

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_TEMPERATURE = 0.7
const DEFAULT_MAX_TOKENS = 2048
const AI_TIMEOUT_MS = 30_000 // 30s - timeout por tentativa de chamada à IA
const MAX_TOOL_RETRIES = 2 // Tentativas extras quando LLM não chama respond tool
const MAX_PROVIDER_RETRIES = 2 // Tentativas extras em erro/timeout do provider (rate-limit, rede)
const PROVIDER_RETRY_BACKOFF_MS = 800 // Backoff base entre tentativas (dobra a cada retry)

/**
 * Converte formatação Markdown para WhatsApp.
 * Executado após a resposta do LLM (zero tokens extras).
 *
 * Markdown → WhatsApp:
 * - **texto** → *texto* (negrito)
 * - __texto__ → *texto* (negrito alternativo)
 * - ~~texto~~ → ~texto~ (riscado)
 * - [texto](url) → texto (url) ou só url se forem iguais
 */
function convertMarkdownToWhatsApp(text: string): string {
  return text
    // **texto** ou __texto__ → *texto* (negrito)
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '*$1*')
    // ~~texto~~ → ~texto~ (riscado)
    .replace(/~~(.+?)~~/g, '~$1~')
    // [texto](url) → converte links Markdown
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) => {
      // Se o texto é basicamente a URL (com ou sem protocolo), só retorna a URL
      const cleanText = linkText.replace(/^https?:\/\//, '').replace(/\/$/, '')
      const cleanUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '')
      if (cleanText === cleanUrl || linkText === url) {
        return url
      }
      // Senão, retorna "texto: url"
      return `${linkText}: ${url}`
    })
}

// =============================================================================
// Helpers
// =============================================================================

function convertToAIMessages(
  messages: InboxMessage[]
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((m) => m.message_type !== 'internal_note')
    .map((m) => ({
      role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    }))
}


async function persistAILog(data: {
  conversationId: string
  agentId: string
  messageIds: string[]
  input: string
  output: SupportResponse | null
  latencyMs: number
  error: string | null
  modelUsed: string
  failover?: boolean
  primaryModel?: string
}): Promise<string | undefined> {
  try {
    const supabase = getSupabaseAdmin()
    if (!supabase) {
      console.error('[chat-agent] Supabase admin client not available')
      return undefined
    }
    const { data: log, error } = await supabase
      .from('ai_agent_logs')
      .insert({
        conversation_id: data.conversationId,
        ai_agent_id: data.agentId,
        input_message: data.input,
        output_message: data.output?.message || null,
        response_time_ms: data.latencyMs,
        model_used: data.modelUsed,
        tokens_used: null,
        sources_used: data.output?.sources || null,
        error_message: data.error,
        metadata: {
          messageIds: data.messageIds,
          sentiment: data.output?.sentiment,
          confidence: data.output?.confidence,
          shouldHandoff: data.output?.shouldHandoff,
          handoffReason: data.output?.handoffReason,
          // Observabilidade do failover: torna VISIVEL quando o primario falhou
          failover: data.failover ?? false,
          primaryModel: data.primaryModel || data.modelUsed,
        },
      })
      .select('id')
      .single()

    if (error) {
      console.error('[chat-agent] Failed to persist log:', error)
      return undefined
    }
    return log?.id
  } catch (err) {
    console.error('[chat-agent] Log error:', err)
    return undefined
  }
}

// =============================================================================
// Main Function
// =============================================================================

export async function processChatAgent(
  config: SupportAgentConfig
): Promise<SupportAgentResult> {
  const { agent, conversation, messages } = config
  const startTime = Date.now()

  // Dynamic imports - required for background execution context
  const { generateText, tool, stepCountIs } = await import('ai')
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
  const { createOpenAI } = await import('@ai-sdk/openai')
  const { withDevTools } = await import('@/lib/ai/devtools')
  const {
    findRelevantContent,
    hasIndexedContent,
    buildEmbeddingConfigFromAgentWithKey,
    buildRerankConfigFromAgent,
  } = await import('@/lib/ai/rag-store')

  // Setup message context
  const lastUserMessage = messages.filter((m) => m.direction === 'inbound').slice(-1)[0]
  const inputText = lastUserMessage?.content || ''
  const messageIds = messages.map((m) => m.id)
  const aiMessages = convertToAIMessages(messages.slice(-10))

  // =======================================================================
  // MEM0: Fetch relevant memories (graceful degradation)
  // =======================================================================
  const { fetchRelevantMemories, saveInteractionMemory, isMem0EnabledAsync } = await import('@/lib/ai/mem0-client')

  let memoryContext = { systemPromptAddition: '', memoryCount: 0 }
  let mem0Enabled = false
  try {
    mem0Enabled = await isMem0EnabledAsync()
    if (mem0Enabled) {
      console.log(`[chat-agent] Mem0 enabled, fetching memories for ${conversation.phone}...`)
      memoryContext = await fetchRelevantMemories(inputText, {
        user_id: conversation.phone,
        agent_id: agent.id,
      })
      if (memoryContext.memoryCount > 0) {
        console.log(`[chat-agent] Found ${memoryContext.memoryCount} memories`)
      }
    } else {
      console.log(`[chat-agent] Mem0 disabled (configure mem0_enabled e mem0_api_key nas settings)`)
    }
  } catch (mem0Error) {
    // Falha no Mem0 não deve derrubar o agente — continua sem memória
    console.warn(`[chat-agent] Mem0 unavailable (degradação graceful):`, mem0Error instanceof Error ? mem0Error.message : mem0Error)
    mem0Enabled = false
  }

  // Obter configuração de provider direto (Google / OpenAI)
  const directConfig = await getAiDirectConfig()
  if (!directConfig.googleApiKey && !directConfig.openaiApiKey) {
    return {
      success: false,
      error: 'Nenhuma chave de API configurada. Acesse Configurações → IA.',
      latencyMs: Date.now() - startTime,
    }
  }

  // O provedor configurado diretamente no agente deve SEMPRE ter prioridade sobre o global.
  // Isso garante que se a UI disser "OpenAI", usamos OpenAI.
  // `let` porque o failover pode trocar provedor/modelo em tempo de execução
  let resolvedProvider = agent.provider || directConfig.provider || 'google'
  let modelId = agent.model || directConfig.model || DEFAULT_MODEL_ID
  const primaryModelId = modelId // modelo primário (antes de qualquer failover), para o log

  // Criar instância do modelo com a chave correspondente ao provedor
  let rawModel
  if (resolvedProvider === 'openai') {
    if (!directConfig.openaiApiKey) {
      return {
        success: false,
        error: 'Chave OpenAI não configurada. Acesse Configurações → IA.',
        latencyMs: Date.now() - startTime,
      }
    }
    const openai = createOpenAI({ apiKey: directConfig.openaiApiKey })
    rawModel = openai(modelId)
  } else if (resolvedProvider === 'google') {
    if (!directConfig.googleApiKey) {
      return {
        success: false,
        error: 'Chave Google não configurada. Acesse Configurações → IA.',
        latencyMs: Date.now() - startTime,
      }
    }
    const google = createGoogleGenerativeAI({ apiKey: directConfig.googleApiKey })
    rawModel = google(modelId)
  } else {
    return {
      success: false,
      error: `Provedor ${resolvedProvider} não suportado.`,
      latencyMs: Date.now() - startTime,
    }
  }

  let model = await withDevTools(rawModel, { name: `agente:${agent.name}` })
  console.log(`[chat-agent] Using ${resolvedProvider}/${modelId}`)

  // ---------------------------------------------------------------------------
  // FAILOVER entre provedores (Gemini ↔ OpenAI)
  // Se o provedor primário cair (timeout/erro repetido), troca UMA vez para o
  // outro provedor configurado e reinicia as tentativas com ele. No-op quando
  // só há uma chave — comportamento idêntico ao atual. O modelo primário
  // continua sendo o configurado; o alternativo só entra quando o primário falha.
  // ---------------------------------------------------------------------------
  let failoverTried = false
  async function attemptProviderFailover(): Promise<boolean> {
    if (failoverTried) return false
    const altProvider = resolvedProvider === 'google' ? 'openai' : 'google'
    const altKey = altProvider === 'openai' ? directConfig.openaiApiKey : directConfig.googleApiKey
    if (!altKey) return false // sem chave do outro provedor → não há failover
    // Reserva RAPIDA: gpt-4o-mini (o gpt-4o e lento). Se o primario for OpenAI, cai no Gemini.
    const altModelId = altProvider === 'openai' ? 'gpt-4o-mini' : DEFAULT_MODEL_ID
    const altRaw =
      altProvider === 'openai'
        ? createOpenAI({ apiKey: altKey })(altModelId)
        : createGoogleGenerativeAI({ apiKey: altKey })(altModelId)
    model = await withDevTools(altRaw, { name: `agente:${agent.name}:failover` })
    console.warn(`[chat-agent] 🔁 FAILOVER ${resolvedProvider}/${modelId} → ${altProvider}/${altModelId}`)
    resolvedProvider = altProvider
    modelId = altModelId
    failoverTried = true
    return true
  }

  // Check if agent has indexed content in pgvector
  let hasKnowledgeBase = false
  try {
    hasKnowledgeBase = await hasIndexedContent(agent.id)
  } catch (ragError) {
    // Falha no pgvector não deve derrubar o agente — continua sem RAG
    console.warn(`[chat-agent] pgvector check unavailable (degradação graceful):`, ragError instanceof Error ? ragError.message : ragError)
  }

  console.log(`[chat-agent] Processing: model=${modelId}, hasKnowledgeBase=${hasKnowledgeBase}`)
  console.log(`[chat-agent] Total messages received: ${messages.length}`)
  console.log(`[chat-agent] Last user message: "${inputText.slice(0, 100)}..."`)

  let response: SupportResponse | undefined
  let error: string | null = null
  let sources: Array<{ title: string; content: string }> | undefined
  // Rede de seguranca (nivel 3): marca se a IA REALMENTE consultou disponibilidade neste turno
  let calledCheckAvailability = false

  // Data/hora atuais (America/Sao_Paulo) — sem isso a IA "chuta" datas (ex.: "dia 11" -> novembro).
  const TZ_SP = 'America/Sao_Paulo'
  const nowExtensoSP = new Date().toLocaleString('pt-BR', {
    timeZone: TZ_SP, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const nowYmdSP = new Date().toLocaleDateString('en-CA', { timeZone: TZ_SP })
  const dateContextBlock =
    `## DATA E HORA ATUAIS (America/Sao_Paulo)\n` +
    `Agora e ${nowExtensoSP} (hoje = ${nowYmdSP}). Use SEMPRE esta data como referencia. ` +
    `Quando o cliente disser apenas o dia ou o dia da semana (ex.: "dia 11", "sabado"), calcule a proxima data ` +
    `correspondente A PARTIR de hoje — nunca chute mes ou ano diferente e nunca sugira datas passadas.`

  try {
    // =======================================================================
    // TOOL-BASED RAG: LLM decides when to search
    // =======================================================================

    // Define respond tool (required for structured output)
    // Schema é dinâmico baseado em handoff_enabled
    // Default false: handoff agora é opt-in. Evita LLMs com prompt fraco transferirem sem motivo.
    const handoffEnabled = agent.handoff_enabled ?? false

    // Build system prompt: base + data atual + contact context + handoff instructions + memory context
    let systemPrompt = agent.system_prompt

    // Injeta a data/hora atuais no contexto (evita a IA "chutar" datas)
    systemPrompt += `\n\n${dateContextBlock}`

    // Adiciona contexto do contato (nome, email). NAO injeta "Cliente desde":
    // a REGRA 1 do prompt proibe a IA de citar a data de cadastro do contato.
    const { contactData } = config
    if (contactData && (contactData.name || contactData.email)) {
      const contactLines: string[] = []
      if (contactData.name) contactLines.push(`- Nome: ${contactData.name}`)
      if (contactData.email) contactLines.push(`- Email: ${contactData.email}`)
      systemPrompt += `\n\n## Contexto do Contato\n${contactLines.join('\n')}`
    }

    // Adiciona instruções de handoff se habilitado e configurado
    if (handoffEnabled && agent.handoff_instructions) {
      systemPrompt += `\n\n## Transferência para Humano\n${agent.handoff_instructions}`
    }

    // Adiciona contexto de memória (Mem0) se disponível
    if (memoryContext.systemPromptAddition) {
      systemPrompt += `\n\n${memoryContext.systemPromptAddition}`
    }

    // Reforço de idioma: garante português brasileiro com acentuação correta,
    // independente de como o operador escreveu o system_prompt do agente.
    // Sem isso, o LLM tende a mimetizar prompts escritos sem acento.
    systemPrompt += `\n\n## Idioma e Ortografia
Responda SEMPRE em português brasileiro (pt-BR) com ortografia e acentuação completas e corretas.
- Use ç, ã, õ, á, é, í, ó, ú, â, ê, ô, à conforme as regras da norma culta.
- Exemplos do certo: "você" (não "voce"), "não" (não "nao"), "está" (não "esta" como verbo), "atenção" (não "atencao"), "endereço" (não "endereco"), "serviço" (não "servico"), "informação" (não "informacao"), "horário" (não "horario"), "obrigado/obrigada" (não "obrigad@"), "também" (não "tambem").
- Pontuação e maiúsculas conforme a língua portuguesa.
- Se receber mensagem do usuário sem acentos, AINDA assim responda com acentos corretos.`

    const responseSchema = getResponseSchema(handoffEnabled)

    console.log(`[chat-agent] Handoff enabled: ${handoffEnabled}`)

    // Flags de estado
    let hasResponded = false
    let shouldQuoteUserMessage = false // Setado pelo tool quoteMessage

    const respondTool = tool({
      description: 'Envia uma resposta estruturada ao usuário. Use APENAS quando tiver a resposta final. NÃO use para respostas parciais.',
      inputSchema: responseSchema,
      execute: async (params) => {
        // Cast permissivo: o schema é dinâmico (handoff fields presentes ou não),
        // mas SupportResponse (tipo do response) sempre inclui esses campos.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = params as any
        // Converte Markdown → WhatsApp (zero tokens extras, só post-processing)
        const formattedMessage = convertMarkdownToWhatsApp(params.message)
        response = {
          message: formattedMessage,
          sentiment: params.sentiment,
          confidence: params.confidence,
          sources: sources ?? p.sources ?? null,
          shouldQuoteUserMessage, // Flag setada pelo tool quoteMessage (boolean)
          shouldHandoff: p.shouldHandoff ?? false,
          // Quando handoff não está habilitado, esses campos não existem em params.
          // Preenchemos com null para satisfazer o tipo SupportResponse.
          handoffReason: p.handoffReason ?? null,
          handoffSummary: p.handoffSummary ?? null,
        }
        hasResponded = true // Marca que já respondeu
        return { success: true, message: formattedMessage }
      },
    })

    // Knowledge base search tool - only created if agent has indexed content
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let searchKnowledgeBaseTool: any = undefined

    if (hasKnowledgeBase) {
      searchKnowledgeBaseTool = tool({
        description: 'Busca informações na base de conhecimento do agente. Use para responder perguntas que precisam de dados específicos.',
        inputSchema: z.object({
          query: z.string().describe('A pergunta ou termos de busca para encontrar informações relevantes'),
        }),
        execute: async ({ query }) => {
          console.log(`[chat-agent] LLM requested knowledge search: "${query.slice(0, 100)}..."`)
          const ragStartTime = Date.now()

          // Build configs
          const embeddingConfig = await buildEmbeddingConfigFromAgentWithKey(agent)
          const rerankConfig = await buildRerankConfigFromAgent(agent)

          // Search
          const relevantContent = await findRelevantContent({
            agentId: agent.id,
            query,
            embeddingConfig,
            rerankConfig,
            topK: agent.rag_max_results || 5,
            threshold: agent.rag_similarity_threshold || 0.5,
          })

          console.log(`[chat-agent] RAG search completed in ${Date.now() - ragStartTime}ms, found ${relevantContent.length} chunks`)

          if (relevantContent.length === 0) {
            return { found: false, message: 'Nenhuma informação relevante encontrada na base de conhecimento.' }
          }

          // Track sources for logging
          sources = relevantContent.map((r, i) => ({
            title: `Fonte ${i + 1}`,
            content: r.content.slice(0, 200) + '...',
          }))

          // Return formatted content for LLM to use
          const contextText = relevantContent
            .map((r, i) => `[${i + 1}] ${r.content}`)
            .join('\n\n')

          return {
            found: true,
            content: contextText,
            sourceCount: relevantContent.length,
          }
        },
      })
    }

    // Build tools object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, any> = { respond: respondTool }
    if (searchKnowledgeBaseTool) {
      tools.searchKnowledgeBase = searchKnowledgeBaseTool
    }

    // Booking tools - only created if agent has booking tool enabled.
    // Registra duas vias em paralelo:
    //   A) Flow form (mini-app Meta) — requer Flow aprovado pela Meta
    //   B) Booking por texto (checkAvailability + confirmBooking) — só requer Calendar conectado
    // O LLM escolhe a via mais apropriada baseado no prompt e disponibilidade.
    if (agent.booking_tool_enabled) {
      console.log(`[chat-agent] 📅 Booking tool enabled, checking prerequisites...`)

      // --- Via A: Flow form ---
      const { sendBookingFlow, checkBookingPrerequisites, BOOKING_TOOL_DESCRIPTION } = await import('@/lib/ai/tools/booking-tool')
      const flowPrereqs = await checkBookingPrerequisites()
      console.log(`[chat-agent] 📅 Flow prereqs: ready=${flowPrereqs.ready}, missing=${flowPrereqs.missing.join(', ') || 'none'}`)

      // --- Via B: prereqs avaliados ANTES para decidir a via primária ---
      const {
        checkAvailability,
        confirmBooking,
        checkTextBookingPrerequisites,
        CHECK_AVAILABILITY_DESCRIPTION,
        CONFIRM_BOOKING_DESCRIPTION,
      } = await import('@/lib/ai/tools/internal-booking-tool')
      const textPrereqs = await checkTextBookingPrerequisites()
      console.log(`[chat-agent] 📅 Text booking prereqs: ready=${textPrereqs.ready}, missing=${textPrereqs.missing.join(', ') || 'none'}`)

      // Via primária = texto (interna, lê a tabela `reservations`). O Flow da Meta
      // entra só como FALLBACK quando a via texto não está pronta — evita a IA
      // escolher na hora entre dois caminhos e marcar por vias divergentes.
      if (flowPrereqs.ready && !textPrereqs.ready) {
        const sendBookingFlowTool = tool({
          description: BOOKING_TOOL_DESCRIPTION,
          inputSchema: z.object({
            confirm: z.boolean().optional().describe('Confirmação para enviar o formulário de agendamento (sempre true)')
          }),
          execute: async () => {
            console.log(`[chat-agent] 📅 LLM requested booking flow for: ${conversation.phone}`)
            const result = await sendBookingFlow(conversation.phone)

            if (result.success) {
              console.log(`[chat-agent] 📅 Booking flow sent successfully: ${result.messageId}`)
              return {
                sent: true,
                message: 'Formulário de agendamento enviado com sucesso. O cliente verá os horários disponíveis.',
              }
            }
            console.log(`[chat-agent] 📅 Failed to send booking flow: ${result.error}`)
            return {
              sent: false,
              message: `Não foi possível enviar o formulário: ${result.error}`,
            }
          },
        })
        tools.sendBookingFlow = sendBookingFlowTool
        console.log(`[chat-agent] 📅 sendBookingFlow tool added`)
      }

      // --- Via B: Booking por texto (checkAvailability + confirmBooking) — via primária ---
      if (textPrereqs.ready) {
        const checkAvailabilityTool = tool({
          description: CHECK_AVAILABILITY_DESCRIPTION,
          inputSchema: z.object({
            daysAhead: z.number().int().min(1).max(30).optional().describe('Quantos dias à frente consultar (padrão: 7)'),
            preferredDate: z.string().optional().describe('Data específica solicitada pelo cliente (formato YYYY-MM-DD)'),
          }),
          execute: async ({ daysAhead, preferredDate }) => {
            calledCheckAvailability = true
            console.log(`[chat-agent] 📅 LLM requested availability check: daysAhead=${daysAhead}, preferredDate=${preferredDate}`)
            const result = await checkAvailability({ daysAhead, preferredDate })
            console.log(`[chat-agent] 📅 Availability: available=${result.available}, dias=${result.days?.length ?? 0}`)
            return result
          },
        })
        tools.checkAvailability = checkAvailabilityTool

        const confirmBookingTool = tool({
          description: CONFIRM_BOOKING_DESCRIPTION,
          inputSchema: z.object({
            slotStart: z.string().describe('ISO string exato do slot escolhido (retornado por checkAvailability)'),
            customerName: z.string().describe('Nome completo do cliente'),
            service: z.string().optional().describe('Tipo de serviço (ex: consulta, visita, suporte)'),
            notes: z.string().optional().describe('Observações adicionais do agendamento'),
          }),
          execute: async ({ slotStart, customerName, service, notes }) => {
            console.log(`[chat-agent] 📅 LLM requested confirmBooking: ${customerName} @ ${slotStart}`)
            const result = await confirmBooking({
              slotStart,
              customerName,
              customerPhone: conversation.phone,
              service,
              notes,
            })
            if (result.success) {
              console.log(`[chat-agent] ✅ Booking confirmed: ${result.reservationId}`)
            } else {
              console.log(`[chat-agent] ❌ Booking failed: ${result.error}`)
            }
            return result
          },
        })
        tools.confirmBooking = confirmBookingTool
        console.log(`[chat-agent] 📅 checkAvailability + confirmBooking tools added`)
      }

      if (!flowPrereqs.ready && !textPrereqs.ready) {
        console.log(`[chat-agent] ⚠️ Booking enabled but nenhuma via disponível. Flow missing: ${flowPrereqs.missing.join(', ')}. Text missing: ${textPrereqs.missing.join(', ')}`)
      }
    }

    // Reaction tool - allows the agent to react to user messages with emojis
    // Only available if: 1) we have the user's message ID, 2) agent allows reactions
    const allowReactions = agent.allow_reactions !== false // default true
    const allowQuotes = agent.allow_quotes !== false // default true

    if (lastUserMessage?.whatsapp_message_id && allowReactions) {
      const { sendReaction } = await import('@/lib/whatsapp-send')

      const reactToMessageTool = tool({
        description: 'Reage à mensagem do usuário com um emoji. A reação aparece grudada na mensagem dele como feedback visual instantâneo.',
        inputSchema: z.object({
          emoji: z.string().describe('O emoji para reagir à mensagem do usuário'),
        }),
        execute: async ({ emoji }) => {
          console.log(`[chat-agent] 😀 LLM requested reaction: ${emoji} on message ${lastUserMessage.whatsapp_message_id}`)

          const result = await sendReaction({
            to: conversation.phone,
            messageId: lastUserMessage.whatsapp_message_id!,
            emoji,
          })

          if (result.success) {
            console.log(`[chat-agent] 😀 Reaction sent successfully`)
            return { reacted: true, emoji }
          }

          console.log(`[chat-agent] 😀 Reaction failed: ${result.error}`)
          return { reacted: false, error: result.error }
        },
      })

      tools.reactToMessage = reactToMessageTool
      console.log(`[chat-agent] 😀 Reaction tool added to tools list`)
    } else if (!allowReactions) {
      console.log(`[chat-agent] 😀 Reaction tool disabled by agent settings`)
    } else {
      console.log(`[chat-agent] ⚠️ Reaction tool not available: no whatsapp_message_id on last user message`)
    }

    // Quote Message tool - allows the agent to quote/reply to the user's message
    if (lastUserMessage?.whatsapp_message_id && allowQuotes) {
      const quoteMessageTool = tool({
        description: 'Faz a resposta aparecer como citação da mensagem do usuário (reply). Use para destacar que está respondendo diretamente a algo específico que o usuário disse.',
        inputSchema: z.object({
          reason: z.string().optional().describe('Motivo opcional para citar a mensagem'),
        }),
        execute: async ({ reason }) => {
          console.log(`[chat-agent] 💬 LLM requested to quote user message${reason ? `: ${reason}` : ''}`)
          shouldQuoteUserMessage = true
          return { willQuote: true, reason }
        },
      })

      tools.quoteMessage = quoteMessageTool
      console.log(`[chat-agent] 💬 Quote tool added to tools list`)
    } else if (!allowQuotes) {
      console.log(`[chat-agent] 💬 Quote tool disabled by agent settings`)
    }

    // Determina se precisa de multi-step (mais de uma tool além de respond)
    const hasMultipleTools = Object.keys(tools).length > 1
    console.log(`[chat-agent] Generating response with tools: ${Object.keys(tools).join(', ')}, multiStep: ${hasMultipleTools}`)

    // Generate with multi-step support when we have multiple tools
    // Condição de parada: para assim que respond for chamado OU após 3 steps
    const stopCondition = () => {
      if (hasResponded) {
        console.log(`[chat-agent] 🛑 Stopping: respond tool was called`)
        return true
      }
      return false
    }

    console.log(`[chat-agent] 🚀 Calling generateText...`)
    const startGenerate = Date.now()

    // =======================================================================
    // RETRY LOOP: Tenta novamente se LLM não chamar respond tool
    // Issue #8992: toolChoice: 'required' não é garantia, LLM pode retornar texto puro
    // Solução: retry com prompt reforçado até MAX_TOOL_RETRIES tentativas
    // =======================================================================
    let retryCount = 0
    let lastLLMText = '' // Guarda texto que o LLM gerou sem chamar tool

    while (!hasResponded && retryCount <= MAX_TOOL_RETRIES) {
      // Se é retry, adiciona instrução reforçada ao system prompt
      let currentSystemPrompt = systemPrompt
      // Usa cópia do array base para não acumular contexto de retries entre iterações
      let currentMessages = [...aiMessages]
      if (retryCount > 0) {
        console.log(`[chat-agent] 🔄 Retry ${retryCount}/${MAX_TOOL_RETRIES} - LLM não chamou respond tool`)
        currentSystemPrompt += `\n\n## INSTRUÇÃO CRÍTICA\nVocê DEVE chamar a tool "respond" para enviar sua resposta. NÃO responda com texto direto. Use a tool respond com message, sentiment e confidence.`

        // Adiciona o texto anterior como contexto na CÓPIA, sem mutar o array original
        if (lastLLMText) {
          currentMessages = [
            ...currentMessages,
            {
              role: 'assistant' as const,
              content: lastLLMText,
            },
            {
              role: 'user' as const,
              content: '[SISTEMA] Você precisa usar a tool "respond" para enviar sua resposta. Reformule sua resposta anterior usando a tool.',
            },
          ]
        }
      }

      // =====================================================================
      // PROVIDER RETRY: tenta novamente em erro/timeout do provider antes
      // de propagar pro catch externo (que faria handoff automático).
      // Trata: timeout (abort), erros transitórios (rate-limit, rede),
      // e finishReason === 'error' (provider sinalizou falha no resultado).
      // =====================================================================
      let providerAttempt = 0
      let providerSuccess = false
      let lastProviderError: unknown = null

      while (providerAttempt <= MAX_PROVIDER_RETRIES && !providerSuccess) {
        // AbortController por tentativa - cada retry tem timeout próprio
        const abortController = new AbortController()
        const timeoutId = setTimeout(() => {
          console.error(`[chat-agent] ⏱️ AI call timed out after ${AI_TIMEOUT_MS}ms (attempt ${providerAttempt + 1}/${MAX_PROVIDER_RETRIES + 1})`)
          abortController.abort()
        }, AI_TIMEOUT_MS)

        try {
          // Safety settings relaxadas para Google Gemini. Sem isso, o Gemini bloqueia
          // silenciosamente conversas com termos sensíveis (alergias, restrições,
          // contexto médico/saúde, etc.) retornando finishReason=error sem warning.
          // BLOCK_ONLY_HIGH = só bloqueia conteúdo claramente perigoso, não falso-positivo.
          // Gemini "thinking" (modelos 2.5 / *-latest) quebra o tool-calling, gerando
          // "Malformed function call" e finishReason=error. Desligar o raciocínio
          // (thinkingBudget=0) resolve. Aplicado SÓ nesses modelos — 1.5/2.0 não recebem a opção.
          const isGeminiThinking = /2\.5|latest|thinking/i.test(modelId)
          const providerOptions = resolvedProvider === 'google'
            ? {
                google: {
                  ...(isGeminiThinking
                    ? { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } }
                    : {}),
                  safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
                  ],
                },
              }
            : undefined

          const result = await generateText({
            model,
            system: currentSystemPrompt,
            messages: currentMessages,
            tools,
            toolChoice: 'required', // FORÇA o LLM a chamar uma tool (respond)
            // Para quando respond for chamado OU após 3 steps (o que vier primeiro)
            stopWhen: (event) => stopCondition() || stepCountIs(3)(event),
            temperature: agent.temperature ?? DEFAULT_TEMPERATURE,
            maxOutputTokens: agent.max_tokens ?? DEFAULT_MAX_TOKENS,
            abortSignal: abortController.signal,
            ...(providerOptions ? { providerOptions } : {}),
          })

          // Detecta erro sinalizado pelo provider no próprio resultado
          if (result.finishReason === 'error') {
            console.error(`[chat-agent] 🔴 PROVIDER ERROR DETAILS (attempt ${providerAttempt + 1}/${MAX_PROVIDER_RETRIES + 1}):`)
            console.error(`[chat-agent] - finishReason: ${result.finishReason}`)
            console.error(`[chat-agent] - text: ${result.text?.slice(0, 200) || 'none'}`)
            console.error(`[chat-agent] - response headers: ${JSON.stringify(result.response?.headers || {})}`)
            console.error(`[chat-agent] - warnings: ${JSON.stringify(result.warnings || [])}`)
            console.error(`[chat-agent] - usage: ${JSON.stringify(result.usage || {})}`)
            // Logar providerMetadata revela safety blocks do Gemini (promptFeedback, candidates[].finishReason etc.)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const providerMetadata = (result as any).providerMetadata || (result.response as any)?.body || {}
            console.error(`[chat-agent] - providerMetadata: ${JSON.stringify(providerMetadata, null, 2).slice(0, 2000)}`)
            result.steps?.forEach((step, i) => {
              console.error(`[chat-agent] - Step ${i + 1} details:`, JSON.stringify({
                finishReason: step.finishReason,
                text: step.text?.slice(0, 100),
                toolCalls: step.toolCalls?.length || 0,
                warnings: step.warnings,
              }))
            })

            // Trata como erro do provider — agenda retry se ainda houver tentativas
            lastProviderError = new Error(`Provider returned finishReason=error`)
            if (providerAttempt < MAX_PROVIDER_RETRIES) {
              const backoff = PROVIDER_RETRY_BACKOFF_MS * Math.pow(2, providerAttempt)
              console.warn(`[chat-agent] ⏳ Provider error, retry ${providerAttempt + 1}/${MAX_PROVIDER_RETRIES} in ${backoff}ms`)
              clearTimeout(timeoutId)
              await new Promise((r) => setTimeout(r, backoff))
              providerAttempt++
              continue
            }
            // Esgotou tentativas neste provedor: tenta failover p/ o outro
            clearTimeout(timeoutId)
            if (await attemptProviderFailover()) { providerAttempt = 0; continue }
            // Sem failover disponível: propaga pro catch externo
            throw lastProviderError
          }

          clearTimeout(timeoutId) // Limpa timeout - sucesso real

          const attemptLabel = retryCount === 0 && providerAttempt === 0
            ? ''
            : ` (toolRetry=${retryCount}, providerRetry=${providerAttempt})`
          console.log(`[chat-agent] ✅ generateText completed${attemptLabel} in ${Date.now() - startGenerate}ms`)
          console.log(`[chat-agent] Steps executed: ${result.steps?.length || 0}`)
          console.log(`[chat-agent] Tool calls: ${JSON.stringify(result.steps?.map(s => s.toolCalls?.map(tc => tc.toolName)).flat().filter(Boolean) || [])}`)
          console.log(`[chat-agent] Finish reason: ${result.finishReason}`)

          // Log each step for debugging
          result.steps?.forEach((step, i) => {
            console.log(`[chat-agent] Step ${i + 1}: toolCalls=${step.toolCalls?.map(tc => tc.toolName).join(', ') || 'none'}, text=${step.text?.slice(0, 50) || 'none'}...`)
          })

          // Se LLM retornou texto mas não chamou respond, guarda para retry
          if (!hasResponded && result.text) {
            lastLLMText = result.text
            console.log(`[chat-agent] ⚠️ LLM retornou texto sem chamar respond: "${result.text.slice(0, 100)}..."`)
          }

          providerSuccess = true
        } catch (genError) {
          clearTimeout(timeoutId)
          const elapsed = Date.now() - startGenerate
          lastProviderError = genError

          const isTimeout = abortController.signal.aborted
          if (isTimeout) {
            console.error(`[chat-agent] ❌ generateText ABORTED (timeout) after ${elapsed}ms (attempt ${providerAttempt + 1}/${MAX_PROVIDER_RETRIES + 1})`)
          } else {
            console.error(`[chat-agent] ❌ generateText failed after ${elapsed}ms (attempt ${providerAttempt + 1}/${MAX_PROVIDER_RETRIES + 1}):`, genError)
          }

          if (providerAttempt < MAX_PROVIDER_RETRIES) {
            const backoff = PROVIDER_RETRY_BACKOFF_MS * Math.pow(2, providerAttempt)
            console.warn(`[chat-agent] ⏳ Retrying provider in ${backoff}ms...`)
            await new Promise((r) => setTimeout(r, backoff))
            providerAttempt++
            continue
          }

          // Esgotou retries neste provedor: tenta failover p/ o outro provedor
          if (await attemptProviderFailover()) { providerAttempt = 0; continue }

          // Sem failover disponível: propaga pro catch externo (handoff)
          if (isTimeout) {
            throw new Error(`AI call timed out after ${MAX_PROVIDER_RETRIES + 1} attempts of ${AI_TIMEOUT_MS / 1000}s each`)
          }
          throw genError
        }
      }

      retryCount++
    }

    // Se ainda não respondeu após todos os retries, usa o texto como fallback
    if (!response) {
      if (lastLLMText) {
        // Fallback: usa o texto que o LLM gerou como resposta
        console.log(`[chat-agent] ⚠️ Fallback: usando texto direto do LLM como resposta`)
        response = {
          message: convertMarkdownToWhatsApp(lastLLMText),
          sentiment: 'neutral',
          confidence: 0.3, // Baixa confiança pois não seguiu o formato
          sources: sources ?? null,
          shouldQuoteUserMessage: null,
          shouldHandoff: false,
          handoffReason: null,
          handoffSummary: null,
        }
      } else {
        console.error(`[chat-agent] ⚠️ No response object after ${retryCount} attempts - respond tool was not called`)
        throw new Error('No response generated - LLM did not call respond tool after retries')
      }
    }

    console.log(`[chat-agent] Response generated: "${response.message.slice(0, 100)}..."`)
    if (sources) {
      console.log(`[chat-agent] Used ${sources.length} knowledge base sources`)
    } else {
      console.log(`[chat-agent] No knowledge base search performed`)
    }

  } catch (err) {
    error = err instanceof Error ? err.message : 'Unknown error'
    console.error('[chat-agent] ❌ Error:', error)
    console.error('[chat-agent] ❌ Stack:', err instanceof Error ? err.stack : 'no-stack')
    console.error('[chat-agent] ❌ Full error object:', JSON.stringify(err, Object.getOwnPropertyNames(err instanceof Error ? err : {}), 2))
    console.error('[chat-agent] ❌ Context:', {
      modelId,
      agentId: agent.id,
      agentName: agent.name,
      hasKnowledgeBase,
      messageCount: messages.length,
      conversationId: conversation.id,
      conversationPhone: conversation.phone,
      lastInputText: inputText.slice(0, 300),
      // Lista das tools que estavam disponíveis nesse turno (ajuda a diagnosticar
      // "LLM tentou chamar uma tool que não tinha schema válido")
      // (definido fora do try, este é o snapshot final)
    })
  }

  // =========================================================================
  // REDE DE SEGURANCA (nivel 3) — a IA nunca NEGA nem AFIRMA disponibilidade errada.
  // Dispara em dois casos:
  //  a) A resposta NEGA disponibilidade ("sem vaga", "nao temos horario/turno") —
  //     mesmo que a IA tenha chamado a ferramenta (pode ter ignorado o resultado).
  //     Se houver vaga real no periodo, REFAZ a resposta com os dados reais.
  //  b) A resposta AFIRMA vagas mas a IA NAO chamou a ferramenta — verifica.
  // =========================================================================
  if (response && agent.booking_tool_enabled) {
    const negaDisponibilidade =
      /(n[ãa]o\s+(temos|tem|h[áa]|possu[íi]mos|existe[m]?)|sem\b|indispon|lotad|esgotad|nenhum)[^.!?\n]{0,60}(vaga|hor[áa]ri|dispon|turno|agenda)/i.test(response.message)
    const afirmaVagas =
      /(temos|tem|h[áa])\s+[^.!?\n]{0,25}(vaga|hor[áa]ri|dispon)|\b\d+\s+vaga/i.test(response.message)

    if (negaDisponibilidade || (afirmaVagas && !calledCheckAvailability)) {
      try {
        const { checkAvailability } = await import('@/lib/ai/tools/internal-booking-tool')
        const avail = await checkAvailability({ daysAhead: 21 })
        // Negativa: so refaz se REALMENTE ha vaga em algum dia (senao a negativa procede).
        // Afirmacao sem consulta: sempre verifica.
        const deveRefazer = negaDisponibilidade ? avail.available : true
        if (deveRefazer) {
          console.warn(`[chat-agent] 🛡️ Rede de seguranca disparou (nega=${negaDisponibilidade}, afirma=${afirmaVagas}, consultou=${calledCheckAvailability}). Refazendo com dados reais.`)
          const grounded = await generateText({
            model,
            system:
              `${agent.system_prompt || ''}\n\n${dateContextBlock}\n\n` +
              `## DADOS REAIS DE DISPONIBILIDADE (consultados agora — fonte da verdade)\n${avail.message}\n\n` +
              `Sua resposta anterior foi:\n"${response.message}"\n\n` +
              `Essa resposta pode ter negado ou afirmado disponibilidade de forma incorreta. Reescreva-a usando SOMENTE os DADOS REAIS acima: se o dia/horario que o cliente pediu tem vaga, ofereca; se aquele dia esta lotado ou nao funciona, diga isso e ofereca a data valida mais proxima COM vaga que aparece nos dados. NUNCA diga que nao ha vaga se os dados mostram vaga. Nao invente horarios nem vagas. Responda apenas com a mensagem final ao cliente, tom sofisticado e cordial, texto simples, sem emojis.`,
            messages: aiMessages,
            temperature: agent.temperature ?? DEFAULT_TEMPERATURE,
            maxOutputTokens: agent.max_tokens ?? DEFAULT_MAX_TOKENS,
          })
          const groundedText = (grounded.text || '').trim()
          if (groundedText) {
            response = {
              ...response,
              message: convertMarkdownToWhatsApp(groundedText),
              confidence: Math.min(response.confidence ?? 0.5, 0.6),
            }
            console.log('[chat-agent] 🛡️ Resposta refeita com disponibilidade real.')
          }
        }
      } catch (gErr) {
        console.error('[chat-agent] 🛡️ Rede de seguranca falhou (mantendo resposta original):', gErr instanceof Error ? gErr.message : gErr)
      }
    }
  }

  const latencyMs = Date.now() - startTime

  // Success case
  if (response) {
    const logId = await persistAILog({
      conversationId: conversation.id,
      agentId: agent.id,
      messageIds,
      input: inputText,
      output: response,
      latencyMs,
      error: null,
      modelUsed: modelId,
      failover: failoverTried,
      primaryModel: primaryModelId,
    })

    // Save interaction to Mem0 (fire-and-forget, não bloqueia resposta)
    if (mem0Enabled) {
      saveInteractionMemory(
        [
          { role: 'user', content: inputText },
          { role: 'assistant', content: response.message },
        ],
        {
          user_id: conversation.phone,
          agent_id: agent.id,
        }
      ).catch((err) => {
        console.warn(`[chat-agent] Failed to save memory: ${err.message}`)
      })
    }

    return { success: true, response, latencyMs, logId }
  }

  // Error case - fallback amigável (sem handoff automático).
  // Handoff só acontece quando o LLM decide explicitamente (shouldHandoff=true em response)
  // ou quando o operador transfere manualmente. Erros transitórios pedem retry do usuário,
  // não escalonamento — evita inchar a fila humana por hiccup técnico.
  const fallbackResponse: SupportResponse = {
    message: 'Tive um problema técnico momentâneo. Pode repetir sua última mensagem, por favor?',
    sentiment: 'neutral',
    confidence: 0,
    sources: null,
    shouldQuoteUserMessage: null,
    shouldHandoff: false,
    handoffReason: null,
    handoffSummary: null,
  }

  const logId = await persistAILog({
    conversationId: conversation.id,
    agentId: agent.id,
    messageIds,
    input: inputText,
    output: fallbackResponse,
    latencyMs,
    error,
    modelUsed: modelId,
    failover: failoverTried,
    primaryModel: primaryModelId,
  })

  return {
    success: false,
    response: fallbackResponse,
    error: error || 'Unknown error',
    latencyMs,
    logId,
  }
}
