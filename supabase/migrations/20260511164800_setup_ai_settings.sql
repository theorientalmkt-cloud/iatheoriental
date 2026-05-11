        -- ==============================================================================
        -- Ajuste da Tabela de Settings e Configuração das Chaves de IA
        -- ==============================================================================

        -- 1. Cria a tabela 'settings' caso ela não exista.
        -- Nota: A tabela utiliza o formato EAV (Entity-Attribute-Value), ou seja, 
        -- ela possui colunas 'key' e 'value' em vez de uma coluna por configuração.
        CREATE TABLE IF NOT EXISTS public.settings (
            key text PRIMARY KEY,
            value text NOT NULL,
            updated_at timestamp with time zone DEFAULT now()
        );

        -- 2. Habilita Row Level Security (RLS) para proteção
        ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

        -- 3. Revoga acessos públicos (evita vazamento de chaves)
        -- O cliente service_role (usado no backend) contorna o RLS automaticamente,
        -- mas removemos o acesso direto do front-end por segurança.
        REVOKE ALL ON TABLE public.settings FROM anon;

        -- Permite que usuários administradores autenticados possam ler/atualizar via dashboard
        -- (Caso você leia/grave isso via browser. Se usar apenas Server Actions com service_role, essa policy nem será usada).
        CREATE POLICY "Admin pode gerenciar settings" 
        ON public.settings 
        FOR ALL 
        TO authenticated 
        USING (true) 
        WITH CHECK (true);

        -- 4. Inserção (ou Atualização) das chaves de API iniciais.
        -- Os nomes (keys) batem EXATAMENTE com os definidos no arquivo ai-center-config.ts
        INSERT INTO public.settings (key, value, updated_at) 
        VALUES 
            ('google_api_key', 'COLE_SUA_CHAVE_DO_GOOGLE_AQUI', now()),
            ('openai_api_key', 'COLE_SUA_CHAVE_DA_OPENAI_AQUI', now())
        ON CONFLICT (key) DO UPDATE 
        SET value = EXCLUDED.value,
            updated_at = now();
