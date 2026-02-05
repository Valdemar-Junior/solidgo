-- Migration: Criar tabela assembly_photos para armazenar fotos de montagem
-- Data: 2026-02-04
-- Descrição: Permite que montadores anexem fotos aos produtos montados

-- 1. Criar tabela de fotos
CREATE TABLE IF NOT EXISTS public.assembly_photos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Relacionamento com produto de montagem
    assembly_product_id UUID NOT NULL 
        REFERENCES public.assembly_products(id) ON DELETE CASCADE,
    
    -- Dados da foto
    storage_path TEXT NOT NULL,        -- Caminho no Supabase Storage
    file_name TEXT,                    -- Nome original do arquivo
    file_size INTEGER,                 -- Tamanho em bytes (após compressão)
    
    -- Metadados
    uploaded_at TIMESTAMPTZ,           -- Quando foi pro Storage (null = pendente sync)
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    
    -- Controle de sincronização offline
    is_synced BOOLEAN DEFAULT false    -- true quando já subiu pro Storage
);

-- 2. Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_assembly_photos_product 
    ON public.assembly_photos(assembly_product_id);

CREATE INDEX IF NOT EXISTS idx_assembly_photos_synced 
    ON public.assembly_photos(is_synced) 
    WHERE NOT is_synced;

CREATE INDEX IF NOT EXISTS idx_assembly_photos_created_at 
    ON public.assembly_photos(created_at DESC);

-- 3. Habilitar RLS
ALTER TABLE public.assembly_photos ENABLE ROW LEVEL SECURITY;

-- 4. Policies de segurança

-- Admin tem acesso total
CREATE POLICY "Admin acesso total a fotos"
ON public.assembly_photos FOR ALL
TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

-- Montador pode VER fotos dos produtos da rota dele (enquanto rota está ativa)
CREATE POLICY "Montador vê fotos da rota ativa"
ON public.assembly_photos FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.assembly_products ap
        JOIN public.assembly_routes ar ON ap.assembly_route_id = ar.id
        WHERE ap.id = assembly_photos.assembly_product_id
        AND ar.status IN ('pending', 'assigned', 'in_progress')
        AND ap.installer_id = auth.uid()
    )
);

-- Montador pode INSERIR fotos nos produtos dele
CREATE POLICY "Montador insere fotos"
ON public.assembly_photos FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.assembly_products ap
        WHERE ap.id = assembly_photos.assembly_product_id
        AND ap.installer_id = auth.uid()
    )
);

-- Montador pode ATUALIZAR suas próprias fotos (para marcar como synced)
CREATE POLICY "Montador atualiza próprias fotos"
ON public.assembly_photos FOR UPDATE
TO authenticated
USING (
    created_by = auth.uid()
)
WITH CHECK (
    created_by = auth.uid()
);

-- 5. Conceder permissões
GRANT SELECT, INSERT, UPDATE ON public.assembly_photos TO authenticated;

-- 6. Inserir configuração do feature flag (se não existir)
INSERT INTO public.app_settings (key, value)
VALUES ('require_assembly_photos', '{"enabled": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 7. Comentários para documentação
COMMENT ON TABLE public.assembly_photos IS 'Armazena fotos tiradas pelos montadores ao finalizar montagem de produtos';
COMMENT ON COLUMN public.assembly_photos.storage_path IS 'Caminho do arquivo no Supabase Storage bucket assembly-photos';
COMMENT ON COLUMN public.assembly_photos.is_synced IS 'Indica se a foto já foi enviada ao Storage. Usado para controle offline.';
