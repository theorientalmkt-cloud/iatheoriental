-- Adicionar políticas de SELECT para usuários autenticados para permitir atualizações em tempo real (Realtime) no dashboard administrativo

CREATE POLICY "authenticated_select_inbox_conversations" ON public.inbox_conversations FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_select_inbox_messages" ON public.inbox_messages FOR SELECT TO authenticated USING (true);
