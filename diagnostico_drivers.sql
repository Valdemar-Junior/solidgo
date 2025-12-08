-- 🔍 DIAGNÓSTICO - VERIFICAR CRIAÇÃO DE DRIVERS PARA MOTORISTAS
-- Execute estas queries para entender o problema

-- 1. Verificar o último usuário motorista criado
SELECT 
    u.id as user_id,
    u.email,
    u.name,
    u.role,
    u.created_at,
    d.id as driver_id,
    d.active as driver_active,
    d.created_at as driver_created_at
FROM users u
LEFT JOIN drivers d ON d.user_id = u.id
WHERE u.role = 'driver'
ORDER BY u.created_at DESC 
LIMIT 5;

-- 2. Verificar se há algum erro ou constraint impedindo criação
SELECT 
    constraint_name,
    constraint_type,
    table_name
FROM information_schema.table_constraints 
WHERE table_name = 'drivers';

-- 3. Verificar estrutura da tabela drivers
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'drivers' AND table_schema = 'public'
ORDER BY ordinal_position;

-- 4. Verificar se há logs de erro recentes (se existir tabela de logs)
-- SELECT * FROM logs WHERE table_name = 'drivers' ORDER BY created_at DESC LIMIT 10;

-- 5. Verificar RLS (Row Level Security) na tabela drivers
SELECT 
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'drivers';

-- 6. Teste manual - criar um driver para o último motorista
-- INSERT INTO drivers (user_id, active, created_at) 
-- VALUES ('USER_ID_AQUI', true, NOW());

-- Mensagem de diagnóstico
SELECT '📋 Execute as queries acima e me diga os resultados!' as instrucao;