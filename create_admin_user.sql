-- SCRIPT PARA CRIAR O PRIMEIRO ADM (BOOTSTRAP)
-- Como usar:
-- 1. Vá no Painel do Supabase -> Authentication -> Users
-- 2. Crie o usuário manualmente (Botão "Add User"). Ex: admin@cliente.com / Senha123
-- 3. EDITE O EMAIL ABAIXO e rode este script:

DO $$
DECLARE
    target_email TEXT := 'admin@cliente.com'; -- <--- COLOQUE O EMAIL AQUI
    user_uid UUID;
BEGIN
    -- Busca o ID do usuário que você acabou de criar no painel
    SELECT id INTO user_uid FROM auth.users WHERE email = target_email;

    IF user_uid IS NULL THEN
        RAISE EXCEPTION 'Usuário % não encontrado! Crie ele no Painel Authentication primeiro.', target_email;
    END IF;

    -- Insere (ou atualiza) na tabela pública de usuários como ADMIN
    INSERT INTO public.users (id, email, name, role)
    VALUES (user_uid, target_email, 'Administrador Inicial', 'admin')
    ON CONFLICT (id) DO UPDATE 
    SET role = 'admin', name = 'Administrador Inicial (Recuperado)';

    RAISE NOTICE 'Sucesso! O usuário % agora é um ADMIN no sistema.', target_email;
END $$;
