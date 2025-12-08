-- Adicionar campos adicionais na tabela orders para armazenar todos os dados do JSON

-- Adicionar campos principais
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS id_unico_integracao bigint UNIQUE,
ADD COLUMN IF NOT EXISTS operacoes text,
ADD COLUMN IF NOT EXISTS filial_venda text,
ADD COLUMN IF NOT EXISTS data_venda timestamptz,
ADD COLUMN IF NOT EXISTS previsao_entrega timestamptz,
ADD COLUMN IF NOT EXISTS codigo_cliente text,
ADD COLUMN IF NOT EXISTS destinatario_complemento text,
ADD COLUMN IF NOT EXISTS tipo integer,
ADD COLUMN IF NOT EXISTS filial_entrega text,
ADD COLUMN IF NOT EXISTS status_logistica text,
ADD COLUMN IF NOT EXISTS tem_frete_full text,
ADD COLUMN IF NOT EXISTS codigo_produto text,
ADD COLUMN IF NOT EXISTS nome_produto text,
ADD COLUMN IF NOT EXISTS local_estocagem text,
ADD COLUMN IF NOT EXISTS tem_montagem text;

-- Criar índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_orders_id_unico_integracao ON orders(id_unico_integracao);
CREATE INDEX IF NOT EXISTS idx_orders_codigo_cliente ON orders(codigo_cliente);
CREATE INDEX IF NOT EXISTS idx_orders_filial_venda ON orders(filial_venda);
CREATE INDEX IF NOT EXISTS idx_orders_status_logistica ON orders(status_logistica);

-- Atualizar comentários das colunas
COMMENT ON COLUMN orders.id_unico_integracao IS 'ID único de integração do ERP';
COMMENT ON COLUMN orders.operacoes IS 'Tipo de operação (Venda com Entrega, etc)';
COMMENT ON COLUMN orders.filial_venda IS 'Filial onde foi realizada a venda';
COMMENT ON COLUMN orders.data_venda IS 'Data da venda';
COMMENT ON COLUMN orders.previsao_entrega IS 'Data prevista para entrega';
COMMENT ON COLUMN orders.codigo_cliente IS 'Código do cliente no ERP';
COMMENT ON COLUMN orders.destinatario_complemento IS 'Complemento do endereço do destinatário';
COMMENT ON COLUMN orders.tipo IS 'Tipo de venda';
COMMENT ON COLUMN orders.filial_entrega IS 'Filial responsável pela entrega';
COMMENT ON COLUMN orders.status_logistica IS 'Status logístico no ERP';
COMMENT ON COLUMN orders.tem_frete_full IS 'Indica se tem frete full';
COMMENT ON COLUMN orders.codigo_produto IS 'Código do produto principal';
COMMENT ON COLUMN orders.nome_produto IS 'Nome do produto principal';
COMMENT ON COLUMN orders.local_estocagem IS 'Local de estocagem do produto';
COMMENT ON COLUMN orders.tem_montagem IS 'Indica se precisa de montagem';