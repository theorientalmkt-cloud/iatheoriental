'use client'

/**
 * AIAgentCard - Display single AI agent with clean, minimal design
 * Redesign: Removed technical metrics, added semantic description, cleaner layout
 */

import React from 'react'
import {
  Pencil,
  Trash2,
  Star,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { AIAgent } from '@/types'
import { CONCIERGE_DESCRICAO } from '@/lib/ai/prompts/concierge'

export interface AIAgentCardProps {
  agent: AIAgent
  onEdit: (agent: AIAgent) => void
  onDelete: (agent: AIAgent) => void
  onSetDefault: (agent: AIAgent) => void
  onToggleActive: (agent: AIAgent, isActive: boolean) => void
  isUpdating?: boolean
  disabled?: boolean
}

// Extrai descrição curta do system prompt (primeira frase ou função principal)
// Gera iniciais do nome (até 2 letras)
function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase()
}

export function AIAgentCard({
  agent,
  onEdit,
  onDelete,
  onSetDefault,
  onToggleActive,
  isUpdating,
  disabled,
}: AIAgentCardProps) {
  return (
    <Card
      className={cn(
        'group relative overflow-hidden transition-all duration-200',
        'hover:shadow-lg hover:shadow-primary-500/5',
        !agent.is_active && 'opacity-50',
        agent.is_default && 'ring-1 ring-primary-500/30'
      )}
    >
      {/* Status bar no topo */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/50 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          {/* Indicador de status clicável */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onToggleActive(agent, !agent.is_active)}
                disabled={isUpdating || disabled}
                className={cn(
                  'w-2 h-2 rounded-full transition-all cursor-pointer',
                  'disabled:cursor-not-allowed',
                  agent.is_active
                    ? 'bg-primary-400 shadow-[0_0_8px] shadow-primary-400/50'
                    : 'bg-zinc-600 hover:bg-zinc-500'
                )}
                aria-label={agent.is_active ? 'Desativar agente' : 'Ativar agente'}
              />
            </TooltipTrigger>
            <TooltipContent>
              {agent.is_active ? 'Ativo - Clique para desativar' : 'Inativo - Clique para ativar'}
            </TooltipContent>
          </Tooltip>

          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            {agent.is_active ? 'Ativo' : 'Inativo'}
          </span>
        </div>

        {agent.is_default && (
          <Badge
            variant="secondary"
            className="h-5 text-[10px] bg-primary-500/10 text-primary-400 border-0"
          >
            <Star className="h-2.5 w-2.5 mr-1" />
            Padrão
          </Badge>
        )}
      </div>

      {/* Conteúdo principal */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Avatar com inicial */}
          <div
            className={cn(
              'flex items-center justify-center w-10 h-10 rounded-xl text-sm font-semibold transition-colors flex-shrink-0',
              agent.is_active
                ? 'bg-gradient-to-br from-primary-500/20 to-primary-600/10 text-primary-400'
                : 'bg-zinc-800 text-zinc-500'
            )}
          >
            {getInitials(agent.name)}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-white truncate">{agent.name}</h3>
            <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">
              {CONCIERGE_DESCRICAO}
            </p>
          </div>
        </div>
      </div>

      {/* Ações sempre visíveis no footer */}
      <div
        className={cn(
          'flex items-center justify-end gap-1 px-4 py-2 border-t border-zinc-800/50',
          'bg-zinc-900/30'
        )}
      >
        {!agent.is_default && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSetDefault(agent)}
                disabled={isUpdating || disabled}
                className="h-7 text-xs text-zinc-400 hover:text-primary-400"
              >
                <Star className="h-3 w-3 mr-1" />
                Tornar padrão
              </Button>
            </TooltipTrigger>
            <TooltipContent>Definir como agente principal</TooltipContent>
          </Tooltip>
        )}

        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(agent)}
              disabled={isUpdating || disabled}
              className="h-7 w-7 text-zinc-400 hover:text-white"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Editar</TooltipContent>
        </Tooltip>

        {!agent.is_default && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onDelete(agent)}
                disabled={isUpdating || disabled}
                className="h-7 w-7 text-zinc-400 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Excluir</TooltipContent>
          </Tooltip>
        )}
      </div>
    </Card>
  )
}
