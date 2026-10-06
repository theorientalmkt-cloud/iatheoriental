'use client'

import { useContactsController } from '@/hooks/useContacts'
import { ContactListView } from '@/components/features/contacts/ContactListView'
import { ReachedAudienceView } from '@/components/features/contacts/ReachedAudienceView'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ContactsInitialData } from './actions'

interface ContactsClientWrapperProps {
  initialData?: ContactsInitialData
}

export function ContactsClientWrapper({ initialData }: ContactsClientWrapperProps) {
  const controller = useContactsController(initialData)

  // Não mostra loading se já temos initialData do servidor
  const showLoading = controller.isLoading && !initialData

  return (
    <Tabs defaultValue="contatos" className="space-y-4">
      <TabsList>
        <TabsTrigger value="contatos">Contatos</TabsTrigger>
        <TabsTrigger value="alcancados">Público alcançado</TabsTrigger>
      </TabsList>

      <TabsContent value="contatos">
    <ContactListView
      contacts={controller.contacts}
      stats={controller.stats}
      tags={controller.tags}
      customFields={controller.customFields}
      onRefreshCustomFields={controller.refreshCustomFields}
      isLoading={showLoading}
      searchTerm={controller.searchTerm}
      onSearchChange={controller.setSearchTerm}
      statusFilter={controller.statusFilter}
      onStatusFilterChange={controller.setStatusFilter}
      tagFilter={controller.tagFilter}
      onTagFilterChange={controller.setTagFilter}
      currentPage={controller.currentPage}
      totalPages={controller.totalPages}
      totalFiltered={controller.totalFiltered}
      onPageChange={controller.setCurrentPage}
      selectedIds={controller.selectedIds}
      onToggleSelect={controller.toggleSelect}
      onToggleSelectAll={controller.toggleSelectAll}
      selectAllGlobal={controller.selectAllGlobal}
      clearSelection={controller.clearSelection}
      isAllSelected={controller.isAllSelected}
      isSomeSelected={controller.isSomeSelected}
      isAddModalOpen={controller.isAddModalOpen}
      setIsAddModalOpen={controller.setIsAddModalOpen}
      isImportModalOpen={controller.isImportModalOpen}
      setIsImportModalOpen={controller.setIsImportModalOpen}
      isEditModalOpen={controller.isEditModalOpen}
      setIsEditModalOpen={controller.setIsEditModalOpen}
      isDeleteModalOpen={controller.isDeleteModalOpen}
      editingContact={controller.editingContact}
      deleteTarget={controller.deleteTarget}
      onAddContact={controller.onAddContact}
      onEditContact={controller.onEditContact}
      onUpdateContact={controller.onUpdateContact}
      onDeleteClick={controller.onDeleteClick}
      onBulkDeleteClick={controller.onBulkDeleteClick}
      onConfirmDelete={controller.onConfirmDelete}
      onCancelDelete={controller.onCancelDelete}
      onImport={controller.onImport}
      isImporting={controller.isImporting}
      isDeleting={controller.isDeleting}
      onUnsuppress={controller.onUnsuppress}
    />
      </TabsContent>

      <TabsContent value="alcancados">
        <ReachedAudienceView />
      </TabsContent>
    </Tabs>
  )
}
