-- Estrutura da tabela orders
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'orders' 
ORDER BY ordinal_position;

-- Análise de preenchimento das colunas problemáticas
SELECT 
  count(*) AS total_registros,
  count(*) FILTER (WHERE phone IS NULL OR phone = '') AS phone_vazios,
  count(*) FILTER (WHERE cliente_celular IS NOT NULL AND cliente_celular <> '') AS cliente_celular_preenchidos,
  count(*) FILTER (WHERE id_unico_integracao IS NOT NULL AND id_unico_integracao <> '') AS id_unico_integracao_preenchidos,
  count(*) FILTER (WHERE tem_montagem IS NOT NULL AND tem_montagem <> '') AS tem_montagem_preenchidos,
  count(*) FILTER (WHERE tipo IS NOT NULL AND tipo <> '') AS tipo_preenchidos
FROM orders;

-- Verificando dados no JSON que não estão sendo salvos nas colunas
SELECT 
  id, 
  numero_lancamento,
  raw_json->>'cliente_celular' AS json_cliente_celular, 
  phone AS coluna_phone, 
  cliente_celular AS coluna_cliente_celular,
  raw_json->>'id_unico_integracao' AS json_id_unico_integracao, 
  id_unico_integracao AS coluna_id_unico_integracao,
  raw_json->>'tipo' AS json_tipo,
  tipo AS coluna_tipo
FROM orders 
WHERE (cliente_celular IS NULL OR cliente_celular = '') 
  AND coalesce(raw_json->>'cliente_celular','') <> '' 
LIMIT 10;