import { ReengagementView } from '@/components/features/reengagement/ReengagementView'

// Dados sempre frescos (não-respondentes dependem de campanha + inbox atuais).
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Reengajamento — leads que receberam campanha mas não responderam.
 */
export default function ReengagementPage() {
  return <ReengagementView />
}
