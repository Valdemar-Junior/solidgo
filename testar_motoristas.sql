-- TESTE COMPLETO PARA VERIFICAR MOTORISTAS

-- 1. Verificar se há usuários com papel motorista
SELECT '=== USUÁRIOS MOTORISTA ===' as info;
SELECT id, nome, email, papel 
FROM usuarios 
WHERE papel = 'motorista';

-- 2. Verificar tabela drivers
SELECT '=== TABELA DRIVERS ===' as info;
SELECT id, user_id, active, created_at 
FROM drivers 
WHERE active = true;

-- 3. Verificar se a função RPC existe
SELECT '=== FUNÇÃO RPC LIST_DRIVERS ===' as info;
SELECT routine_name, routine_type, created 
FROM information_schema.routines 
WHERE routine_name = 'list_drivers';

-- 4. Verificar rotas existentes
SELECT '=== ROTAS EXISTENTES ===' as info;
SELECT id, nome, motorista_id, data_rota, status 
FROM rotas 
ORDER BY data_rota DESC 
LIMIT 5;

-- 5. Verificar relacionamento completo
SELECT '=== ROTAS COM NOMES DE MOTORISTAS ===' as info;
SELECT 
    r.id, 
    r.nome, 
    r.motorista_id,
    u.nome as motorista_nome,
    r.data_rota,
    r.status
FROM rotas r
LEFT JOIN usuarios u ON r.motorista_id = u.id
ORDER BY r.data_rota DESC
LIMIT 5;

-- 6. Criar função RPC se não existir
CREATE OR REPLACE FUNCTION list_drivers()
RETURNS TABLE(driver_id uuid, name text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT d.id as driver_id, u.nome as name
    FROM drivers d
    INNER JOIN usuarios u ON d.user_id = u.id
    WHERE d.active = true;
END;
$$;

-- 7. Testar a função
SELECT '=== TESTE DA FUNÇÃO RPC ===' as info;
SELECT * FROM list_drivers();