-- Função RPC Otimizada e Segura para Rastreio Público
-- Suporta histórico de tentativas de entrega e retornos com detalhe

DROP FUNCTION IF EXISTS get_order_public(text, text);

CREATE OR REPLACE FUNCTION get_order_public(
  p_order_number TEXT,
  p_cpf TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id UUID;
  v_main_order RECORD;
  v_delivery_timeline JSONB;
  v_delivery_history JSONB; -- Novo campo para histórico
  v_assembly_timeline JSONB;
  v_has_assembly_flag BOOLEAN := FALSE;
  v_clean_cpf TEXT;
BEGIN
  v_clean_cpf := regexp_replace(p_cpf, '[^0-9]', '', 'g');
  
  -- 1. Buscar o ID do pedido ÚNICO
  SELECT id INTO v_order_id
  FROM orders
  WHERE order_id_erp = p_order_number
    AND (
      regexp_replace(COALESCE(customer_cpf, ''), '[^0-9]', '', 'g') = v_clean_cpf
      OR regexp_replace(COALESCE(raw_json->>'destinatario_cpf', ''), '[^0-9]', '', 'g') = v_clean_cpf
      OR regexp_replace(COALESCE(raw_json->>'cliente_cpf', ''), '[^0-9]', '', 'g') = v_clean_cpf
      OR regexp_replace(COALESCE(raw_json->>'cpf', ''), '[^0-9]', '', 'g') = v_clean_cpf
    )
  ORDER BY created_at DESC
  LIMIT 1;
  
  IF v_order_id IS NULL THEN RETURN NULL; END IF;

  -- Carregar dados do pedido
  SELECT * INTO v_main_order FROM orders WHERE id = v_order_id;

  -- 2. Construir Histórico de Entregas (NOVO)
  SELECT jsonb_agg(
    jsonb_build_object(
      'route_name', r.name,
      'dispatched_at', r.created_at, -- Data que saiu na rota
      'status', ro.status,
      'delivered_at', ro.delivered_at,
      'returned_at', ro.returned_at,
      'return_reason', rr.reason, -- Nome do motivo de devolução (tabela return_reasons)
      'return_notes', ro.return_notes -- Observações manuais do motorista
    ) ORDER BY ro.created_at ASC
  )
  INTO v_delivery_history
  FROM route_orders ro
  JOIN routes r ON r.id = ro.route_id
  LEFT JOIN return_reasons rr ON rr.id = ro.return_reason_id
  WHERE ro.order_id = v_order_id;

  -- 2.1 Timeline Geral (Resumo da última tentativa/estado atual)
  -- Mantemos para compatibilidade rápida, mas o front deve preferir usar o history
  SELECT jsonb_build_object(
    'sale_date', v_main_order.raw_json->>'data_venda',
    'imported_date', v_main_order.created_at,
    'forecast_date', v_main_order.raw_json->>'previsao_entrega'
  )
  INTO v_delivery_timeline;

  -- 3. Construir Timeline de MONTAGEM
  SELECT jsonb_build_object(
      'product_name', ap.product_name,
      'status', ap.status,
      'scheduled_date', ap.assembly_date,
      'completion_date', ap.completion_date,
      'deadline', ar.deadline,
      'route_name', ar.name,
      'route_created_at', ar.created_at
  )
  INTO v_assembly_timeline
  FROM assembly_products ap
  LEFT JOIN assembly_routes ar ON ar.id = ap.assembly_route_id
  WHERE ap.order_id = v_order_id
  ORDER BY ap.created_at DESC
  LIMIT 1;

  -- 4. Verificar Flags
  IF v_assembly_timeline IS NOT NULL THEN
     v_has_assembly_flag := TRUE;
  ELSE
     DECLARE
        v_items JSONB := v_main_order.items_json;
        v_item JSONB;
     BEGIN
        IF jsonb_typeof(v_items) = 'array' THEN
           FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
           LOOP
             IF (v_item->>'has_assembly')::text ILIKE 'Sim' 
                OR (v_item->>'has_assembly')::text = '1'
                OR (v_item->>'produto_e_montavel')::text ILIKE 'Sim'
             THEN
               v_has_assembly_flag := TRUE;
             END IF;
           END LOOP;
        END IF;
     END;
  END IF;

  RETURN jsonb_build_object(
    'order_number', v_main_order.order_id_erp,
    'customer_name', v_main_order.customer_name,
    'city', v_main_order.address_json->>'city',
    'neighborhood', v_main_order.address_json->>'neighborhood',
    'delivery_timeline', v_delivery_timeline,
    'delivery_history', COALESCE(v_delivery_history, '[]'::jsonb), -- Garante array vazio se null
    'has_assembly', v_has_assembly_flag, 
    'assembly_timeline', v_assembly_timeline
  );
END;
$$;
GRANT EXECUTE ON FUNCTION get_order_public TO anon;
