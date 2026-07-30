import { api } from '@/lib/api'

export type ReceivedMode = 'sent' | 'delivered' | 'read'

export interface NonResponder {
  contactId: string | null
  phone: string
  name: string | null
  receivedAt: string | null
}

export interface NonResponderResult {
  campaignId: string
  mode: ReceivedMode
  received: number
  responded: number
  nonResponders: NonResponder[]
  taggable: number
}

/**
 * Reengagement Service — leads que receberam campanha mas não responderam.
 */
export const reengagementService = {
  getNonResponders: (campaignId: string, received: ReceivedMode): Promise<NonResponderResult> =>
    api.get<NonResponderResult>(
      `/api/reengagement/non-responders?campaignId=${encodeURIComponent(campaignId)}&received=${received}`,
      { cache: 'no-store' }
    ),

  tag: (contactIds: string[], tag: string): Promise<{ updated: number; tag: string }> =>
    api.post<{ updated: number; tag: string }>('/api/reengagement/tag', { contactIds, tag }),
}
