// CÓDIGO PARA TESTAR MOTORISTAS NO CONSOLE DO NAVEGADOR
// Cole este código no console (F12) na página de rotas

console.log('=== INICIANDO TESTE DE MOTORISTAS ===');

// Teste 1: Verificar se há motoristas na tabela drivers
async function testarDrivers() {
    console.log('1. Testando tabela drivers...');
    const { data: drivers, error: driversError } = await supabase
        .from('drivers')
        .select('*, user:usuarios!user_id(*)')
        .eq('active', true);
    
    console.log('Drivers encontrados:', drivers);
    console.log('Erro drivers:', driversError);
    return drivers;
}

// Teste 2: Verificar usuários com papel motorista
async function testarUsuariosMotorista() {
    console.log('2. Testando usuários com papel motorista...');
    const { data: users, error: usersError } = await supabase
        .from('usuarios')
        .select('*')
        .eq('papel', 'motorista');
    
    console.log('Usuários motorista:', users);
    console.log('Erro usuários:', usersError);
    return users;
}

// Teste 3: Testar a função RPC list_drivers
async function testarRPC() {
    console.log('3. Testando função RPC list_drivers...');
    try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('list_drivers');
        console.log('RPC list_drivers data:', rpcData);
        console.log('RPC list_drivers error:', rpcError);
        return rpcData;
    } catch (e) {
        console.log('Erro ao chamar RPC:', e);
        return null;
    }
}

// Teste 4: Verificar rotas existentes
async function testarRotas() {
    console.log('4. Testando rotas existentes...');
    const { data: routes, error: routesError } = await supabase
        .from('rotas')
        .select('*, motorista:usuarios!motorista_id(*)')
        .order('data_rota', { ascending: false })
        .limit(5);
    
    console.log('Rotas encontradas:', routes);
    console.log('Erro rotas:', routesError);
    return routes;
}

// Teste 5: Verificar estrutura das tabelas
async function verificarEstrutura() {
    console.log('5. Verificando estrutura das tabelas...');
    
    // Verificar colunas da tabela drivers
    const { data: driversCols } = await supabase
        .from('information_schema.columns')
        .select('column_name, data_type')
        .eq('table_name', 'drivers');
    
    console.log('Colunas da tabela drivers:', driversCols);
    
    // Verificar colunas da tabela usuarios
    const { data: usersCols } = await supabase
        .from('information_schema.columns')
        .select('column_name, data_type')
        .eq('table_name', 'usuarios');
    
    console.log('Colunas da tabela usuarios:', usersCols);
}

// Executar todos os testes
async function executarTodosTestes() {
    console.log('=== EXECUTANDO TODOS OS TESTES ===');
    
    await testarDrivers();
    await testarUsuariosMotorista();
    await testarRPC();
    await testarRotas();
    await verificarEstrutura();
    
    console.log('=== TESTES CONCLUÍDOS ===');
}

// Executar os testes
executarTodosTestes();