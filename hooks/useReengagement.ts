import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { campaignService } from '@/services'
import { reengagementService, type ReceivedMode } from '@/services/reengagementService'
import type { Campaign } from '@/types'

/** Controller do Reengajamento: escolhe campanha, vê não-respondentes e marca com tag. */
export function useReengagement() {
  const queryClient = useQueryClient()

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('')
  const [receivedMode, setReceivedMode] = useState<ReceivedMode>('delivered')
  const [tagName, setTagName] = useState<string>('')

  // Campanhas para o seletor — só as que já enviaram algo.
  const campaignsQuery = useQuery({
    queryKey: ['campaigns'],
    queryFn: campaignService.getAll,
    staleTime: 30 * 1000,
  })

  const campaigns = useMemo<Campaign[]>(() => {
    const all = campaignsQuery.data || []
    return all
      .filter((c) => (c.sent || 0) > 0 || (c.delivered || 0) > 0 || (c.read || 0) > 0)
      .sort((a, b) => {
        const ta = new Date(a.lastSentAt || a.createdAt || 0).getTime()
        const tb = new Date(b.lastSentAt || b.createdAt || 0).getTime()
        return tb - ta
      })
  }, [campaignsQuery.data])

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
  )

  // Tag padrão sugerida a partir do nome da campanha.
  useEffect(() => {
    if (!selectedCampaign) return
    const base = selectedCampaign.name.replace(/^campanha\s+/i, '').trim() || selectedCampaign.name
    setTagName(`Não respondeu · ${base}`)
  }, [selectedCampaign])

  const nonRespondersQuery = useQuery({
    queryKey: ['reengagement-non-responders', selectedCampaignId, receivedMode],
    queryFn: () => reengagementService.getNonResponders(selectedCampaignId, receivedMode),
    enabled: !!selectedCampaignId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })

  const result = nonRespondersQuery.data || null

  const tagMutation = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error('Nada para marcar')
      const ids = result.nonResponders
        .map((n) => n.contactId)
        .filter((id): id is string => !!id)
      if (!ids.length) throw new Error('Nenhum dos não-respondentes tem cadastro para receber tag')
      const tag = tagName.trim()
      if (!tag) throw new Error('Defina o nome da tag')
      return reengagementService.tag(ids, tag)
    },
    onSuccess: (res) => {
      toast.success(`${res.updated} contato(s) marcados com "${res.tag}"`)
      // Atualiza tudo que depende de tags/contatos (inclui a montagem de campanha).
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      queryClient.invalidateQueries({ queryKey: ['contact-tags'] })
      queryClient.invalidateQueries({ queryKey: ['contact-tag-counts'] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Falha ao marcar contatos')
    },
  })

  return {
    // seletor
    campaigns,
    campaignsLoading: campaignsQuery.isLoading,
    selectedCampaignId,
    setSelectedCampaignId,
    selectedCampaign,
    // critério "recebeu"
    receivedMode,
    setReceivedMode,
    // resultado
    result,
    isLoading: nonRespondersQuery.isFetching,
    error: nonRespondersQuery.error as Error | null,
    // ação de tag
    tagName,
    setTagName,
    applyTag: () => tagMutation.mutate(),
    isTagging: tagMutation.isPending,
    tagged: tagMutation.data || null,
  }
}
