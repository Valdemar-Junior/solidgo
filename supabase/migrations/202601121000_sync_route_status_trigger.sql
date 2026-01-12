CREATE OR REPLACE FUNCTION sync_order_status_from_route()
RETURNS TRIGGER AS $$
BEGIN
    -- CENÁRIO 1: Motorista marcou ENTREGUE
    -- Ação: Atualizar pedido para 'delivered' imediatamente (não deixa roteirizar de novo)
    IF NEW.status = 'delivered' THEN
        UPDATE orders 
        SET status = 'delivered', return_flag = false 
        WHERE id = NEW.order_id;
    
    -- CENÁRIO 2: Motorista DESFEZ a entrega (Voltou para Pendente na rota)
    -- Ação: Voltar pedido para 'assigned' (Em Rota). Mantém travado na rota dele.
    ELSIF NEW.status = 'pending' AND OLD.status = 'delivered' THEN
        UPDATE orders 
        SET status = 'assigned' 
        WHERE id = NEW.order_id;

    -- CENÁRIO 3: Motorista marcou RETORNADO
    -- Ação: Apenas marca a FLAG de retorno, mas status continua 'assigned' (travado).
    -- Regra do Usuário: Só libera para roteirizar (pending) na finalização da rota.
    ELSIF NEW.status = 'returned' THEN
        UPDATE orders 
        SET status = 'assigned', -- Garante que continua travado
            return_flag = true, 
            last_return_reason = NEW.return_reason 
        WHERE id = NEW.order_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_route_to_order ON route_orders;

CREATE TRIGGER trigger_sync_route_to_order
AFTER UPDATE ON route_orders
FOR EACH ROW
EXECUTE FUNCTION sync_order_status_from_route();
