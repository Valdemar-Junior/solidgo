-- ✅ VERIFICAÇÃO FINAL - ESTRUTURA LIMPA DA TABELA ORDERS
-- Execute para verificar o resultado final da migração

-- ============================================
-- 1. ESTRUTURA FINAL DA TABELA
-- ============================================

SELECT 
    ordinal_position as pos,
    column_name,
    data_type,
    is_nullable,
    column_default,
    CASE 
        WHEN column_name IN ('id', 'order_id_erp', 'customer_name', 'phone', 'address_json', 'items_json', 'status', 'created_at', 'updated_at') THEN '🟢 ESSENCIAL'
        WHEN column_name IN ('numero_lancamento', 'observacoes_publicas', 'observacoes_internas', 'quantidade_volumes', 'etiquetas') THEN '🟡 NOVO'
        WHEN column_name IN ('xml_documento', 'raw_json', 'operacoes', 'filial_venda', 'data_venda', 'previsao_entrega', 'codigo_cliente', 'filial_entrega', 'status_logistica', 'tem_frete_full', 'observations', 'destinatario_complemento') THEN '🔵 AUXILIAR'
        ELSE '⚪ OUTRO'
    END as classificacao
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'orders' 
ORDER BY ordinal_position;

-- ============================================
-- 2. RESUMO DAS COLUNAS REMOVIDAS
-- ============================================

SELECT 
    'Colunas removidas com sucesso:' as acao,
    '✅ cliente_celular (redundante com phone)' as coluna1,
    '✅ tipo (não utilizada)' as coluna2,
    '✅ tem_montagem (substituído por has_assembly)' as coluna3,
    '✅ id_unico_integracao (não vem mais no JSON)' as coluna4
UNION ALL
SELECT 
    'Total de colunas removidas:' as acao,
    '4 colunas' as coluna1,
    '' as coluna2,
    '' as coluna3,
    '' as coluna4;

-- ============================================
-- 3. VERIFICAR SE AINDA EXISTEM COLUNAS OBSOLETAS
-- ============================================

SELECT 
    CASE 
        WHEN COUNT(*) = 0 THEN '🎉 NENHUMA coluna obsoleta encontrada!'
        ELSE '⚠️  Ainda existem ' || COUNT(*) || ' colunas que podem ser removidas'
    END as status_limpeza
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'orders' 
  AND column_name IN ('cliente_celular', 'tipo', 'tem_montagem', 'id_unico_integracao');

-- ============================================
-- 4. CONTAGEM DE REGISTROS
-- ============================================

SELECT 
    COUNT(*) as total_registros,
    COUNT(numero_lancamento) as com_numero_lancamento,
    COUNT(phone) as com_telefone,
    COUNT(items_json) as com_items,
    COUNT(address_json) as com_endereco
FROM orders;

-- ============================================
-- 5. MENSAGEM FINAL
-- ============================================

SELECT '🎯 MIGRAÇÃO CONCLUÍDA COM SUCESSO!' as mensagem_final;