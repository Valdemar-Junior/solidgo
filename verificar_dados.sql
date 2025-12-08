-- Verificar dados das tabelas principais
SELECT '=== ROTAS ===' as info;
SELECT id, nome, motorista_id, data_rota, status FROM rotas ORDER BY data_rota DESC LIMIT 10;

SELECT '=== USUÁRIOS COM PAPEL MOTORISTA ===' as info;
SELECT u.id, u.nome, u.email, u.papel, p.nome as perfil_nome 
FROM usuarios u 
LEFT JOIN public.users p ON u.id = p.id 
WHERE u.papel = 'motorista' 
ORDER BY u.nome;

SELECT '=== PERFIL DE USUÁRIOS (public.users) ===' as info;
SELECT id, nome, email, role FROM public.users ORDER BY nome;

SELECT '=== ROTAS COM MOTORISTA ===' as info;
SELECT r.id, r.nome, r.motorista_id, u.nome as motorista_nome, r.data_rota 
FROM rotas r 
LEFT JOIN usuarios u ON r.motorista_id = u.id 
ORDER BY r.data_rota DESC LIMIT 10;

SELECT '=== VERIFICAR FUNÇÃO list_drivers ===' as info;
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_name = 'list_drivers';

SELECT '=== CONTAR PEDIDOS POR ROTA ===' as info;
SELECT rota_id, COUNT(*) as total_pedidos 
FROM route_orders 
GROUP BY rota_id 
ORDER BY total_pedidos DESC;