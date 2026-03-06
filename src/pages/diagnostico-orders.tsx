import { useState } from 'react';
import { supabase } from '../supabase/client';

export default function DiagnosticoOrders() {
  const [resultado, setResultado] = useState<string>('');
  const [carregando, setCarregando] = useState(false);

  const executarDiagnostico = async () => {
    setCarregando(true);
    setResultado('=== DIAGNÓSTICO DA TABELA ORDERS ===\n\n');

    try {
      // 1. Verificar constraints da tabela
      setResultado(prev => prev + '1. Verificando constraints da tabela orders...\n');

      const { data: constraints, error: constraintsError } = await supabase
        .rpc('get_table_constraints', { table_name: 'orders' });

      if (constraintsError) {
        setResultado(prev => prev + `Erro ao verificar constraints: ${constraintsError.message}\n`);
      } else {
        setResultado(prev => prev + `Constraints encontradas:\n`);
        constraints?.forEach((constraint: any) => {
          setResultado(prev => prev + `  - ${constraint.constraint_name}: ${constraint.constraint_type} (${constraint.column_name})\n`);
        });
      }

      // 2. Verificar índices únicos
      setResultado(prev => prev + '\n2. Verificando índices únicos...\n');

      const { data: indexes, error: indexesError } = await supabase
        .from('information_schema.table_constraints')
        .select(`
          constraint_name,
          constraint_type
        `)
        .eq('table_name', 'orders')
        .eq('table_schema', 'public')
        .or('constraint_type.eq.UNIQUE,constraint_type.eq.PRIMARY KEY');

      if (indexesError) {
        setResultado(prev => prev + `Erro ao verificar índices: ${indexesError.message}\n`);
      } else {
        setResultado(prev => prev + `Índices únicos encontrados:\n`);
        indexes?.forEach((index: any) => {
          setResultado(prev => prev + `  - ${index.constraint_name} (${index.constraint_type})\n`);
        });
      }

      // 3. Verificar se há dados duplicados por lancamento_venda
      setResultado(prev => prev + '\n3. Verificando duplicados por lancamento_venda...\n');

      const { data: duplicadosLancamento, error: dupLancError } = await supabase
        .from('orders')
        .select('lancamento_venda, count(*)')
        .not('lancamento_venda', 'is', null)
        .group('lancamento_venda')
        .gte('count', 2);

      if (dupLancError) {
        setResultado(prev => prev + `Erro ao verificar duplicados: ${dupLancError.message}\n`);
      } else if (duplicadosLancamento && duplicadosLancamento.length > 0) {
        setResultado(prev => prev + `⚠️  ENCONTRADOS ${duplicadosLancamento.length} lancamento_venda DUPLICADOS!\n`);
      } else {
        setResultado(prev => prev + `✓ Nenhum lancamento_venda duplicado encontrado\n`);
      }

      // 4. Verificar se há dados duplicados por id_unico_integracao
      setResultado(prev => prev + '\n4. Verificando duplicados por id_unico_integracao...\n');

      const { data: duplicadosIdUnico, error: dupIdError } = await supabase
        .from('orders')
        .select('id_unico_integracao, count(*)')
        .not('id_unico_integracao', 'is', null)
        .group('id_unico_integracao')
        .gte('count', 2);

      if (dupIdError) {
        setResultado(prev => prev + `Erro ao verificar duplicados: ${dupIdError.message}\n`);
      } else if (duplicadosIdUnico && duplicadosIdUnico.length > 0) {
        setResultado(prev => prev + `⚠️  ENCONTRADOS ${duplicadosIdUnico.length} id_unico_integracao DUPLICADOS!\n`);
      } else {
        setResultado(prev => prev + `✓ Nenhum id_unico_integracao duplicado encontrado\n`);
      }

      // 5. Testar inserção real
      setResultado(prev => prev + '\n5. Testando inserção de pedido de teste...\n');

      const testOrder = {
        id_unico_integracao: 999999,
        operacoes: "Venda com Entrega",
        filial_venda: "TESTE",
        lancamento_venda: 123456,
        data_venda: "2025-11-22T03:00:00.000Z",
        previsao_entrega: "2025-12-07T03:00:00.000Z",
        codigo_cliente: "TESTE001",
        nome_cliente: "CLIENTE TESTE",
        cliente_celular: "(84) 99999-9999",
        address_json: { street: "RUA TESTE, 123", neighborhood: "CENTRO", city: "NATAL", state: "RN", zip: "59000-000", complement: "" },
        observacoes: "TESTE DE INSERÇÃO",
        tipo: 1,
        filial_entrega: "TESTE",
        status_logistica: "PENDENTE",
        tem_frete_full: "NÃO",
        codigo_produto: "9999",
        nome_produto: "PRODUTO TESTE",
        local_estocagem: "TESTE",
        tem_montagem: "NÃO"
      };

      const { data: insertData, error: insertError } = await supabase
        .from('orders')
        .insert([testOrder]);

      if (insertError) {
        setResultado(prev => prev + `❌ ERRO AO INSERIR: ${insertError.message}\n`);
        setResultado(prev => prev + `Código do erro: ${insertError.code}\n`);
        setResultado(prev => prev + `Detalhes: ${JSON.stringify(insertError, null, 2)}\n`);

        if (insertError.code === '23505') {
          setResultado(prev => prev + `\n🎯 ISSO CONFIRMA: É um erro de constraint única!\n`);
          setResultado(prev => prev + `A constraint está impedindo a inserção.\n`);
        }
      } else {
        setResultado(prev => prev + `✓ Pedido de teste inserido com sucesso!\n`);

        // Limpar
        await supabase.from('orders').delete().eq('id_unico_integracao', 999999);
        setResultado(prev => prev + `✓ Pedido de teste removido\n`);
      }

      setResultado(prev => prev + '\n✅ DIAGNÓSTICO COMPLETO!\n');
      setResultado(prev => prev + '\nPRÓXIMOS PASSOS:\n');
      setResultado(prev => prev + '1. Execute o script SQL fornecido\n');
      setResultado(prev => prev + '2. Remova constraints problemáticas\n');
      setResultado(prev => prev + '3. Crie constraint apenas em id_unico_integracao\n');

    } catch (erro) {
      setResultado(prev => prev + `\n❌ ERRO GERAL: ${erro}\n`);
    } finally {
      setCarregando(false);
    }
  };

  const corrigirMontagensPresas = async () => {
    setCarregando(true);
    setResultado('=== BUSCANDO PEDIDOS ENTREGUES COM MONTAGEM FALTANTE ===\n\n');

    try {
      // 1. Buscar pedidos Entregues ('delivered')
      const { data: deliveredOrders, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'delivered');

      if (ordersError) throw ordersError;

      if (!deliveredOrders || deliveredOrders.length === 0) {
        setResultado(prev => prev + 'Nenhum pedido entregue encontrado no banco.\n');
        setCarregando(false);
        return;
      }

      setResultado(prev => prev + `Analisando ${deliveredOrders.length} pedidos entregues...\n`);

      let totalCorrigidos = 0;
      let totalProdutosInjetados = 0;

      for (const order of deliveredOrders) {
        // Obter os itens do pedido
        const items: any[] = Array.isArray(order.items_json) ? order.items_json : [];

        // Filtrar produtos com montagem no items_json
        const produtosComMontagem = items.filter((item: any) =>
          ['SIM', 'sim', 'Sim', 'true', '1', 'yes', 'YES', 'Yes'].includes(String(item.has_assembly)) ||
          item.possui_montagem === true || item.possui_montagem === 'true'
        );

        if (produtosComMontagem.length === 0) continue;

        // Verificar se já existe a quantidade certa em assembly_products
        const assemblyProductsToInsert: any[] = [];
        let missingForThisOrder = false;

        for (const item of produtosComMontagem) {
          const qtyStr = item.purchased_quantity || item.quantity;
          const qty = Math.max(1, parseInt(String(qtyStr)) || 1);
          const cleanSku = item.sku || 'SKU-INDEF';

          const { count: currentCount, error: countError } = await supabase
            .from('assembly_products')
            .select('*', { count: 'exact', head: true })
            .eq('order_id', order.id)
            .eq('product_sku', cleanSku);

          if (countError) {
            console.error('Erro ao verificar count:', countError);
            continue;
          }

          const existingCount = currentCount || 0;
          const itemsToGenerate = qty - existingCount;

          if (itemsToGenerate > 0) {
            missingForThisOrder = true;
            for (let i = 0; i < itemsToGenerate; i++) {
              assemblyProductsToInsert.push({
                order_id: order.id,
                product_name: item.name || 'Produto sem nome',
                product_sku: cleanSku,
                customer_name: order.customer_name,
                customer_phone: order.phone,
                installation_address: order.address_json,
                status: 'pending',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              });
            }
          }
        }

        if (missingForThisOrder && assemblyProductsToInsert.length > 0) {
          totalCorrigidos++;
          setResultado(prev => prev + `-> Pedido ${order.order_id_erp || order.id} precisa gerar ${assemblyProductsToInsert.length} montagem(ns).\n`);

          const { error: insertError } = await supabase
            .from('assembly_products')
            .insert(assemblyProductsToInsert);

          if (insertError) {
            setResultado(prev => prev + `  ❌ ERRO AO INSERIR NO PEDIDO ${order.order_id_erp}: ${insertError.message}\n`);
          } else {
            setResultado(prev => prev + `  ✅ ${assemblyProductsToInsert.length} registro(s) criado(s) com sucesso!\n`);
            totalProdutosInjetados += assemblyProductsToInsert.length;
          }
        }
      }

      setResultado(prev => prev + '\n=== FIM DA CORREÇÃO ===\n');
      setResultado(prev => prev + `Pedidos que precisavam de correção: ${totalCorrigidos}\n`);
      setResultado(prev => prev + `Total de montagens (produtos) inseridas: ${totalProdutosInjetados}\n`);

    } catch (error: any) {
      setResultado(prev => prev + `\n❌ ERRO GERAL: ${error.message || error}\n`);
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Ferramentas de Diagnóstico e Correção</h1>

      {/* SEÇÃO 1: CORREÇÃO DE MONTAGENS */}
      <div className="bg-purple-50 border border-purple-200 p-6 rounded-lg">
        <h2 className="text-xl font-bold text-purple-800 mb-2">1. Corrigir Montagens Presas (Bug do Trigger)</h2>
        <p className="text-sm text-purple-700 mb-4">
          Este script procura por todos os pedidos que já foram marcados como "Entregues", que possuem produtos marcados para montagem, mas que não tiveram suas ordens geradas na tabela "assembly_products" (devido à remoção recente do trigger automático no banco).
        </p>
        <button
          onClick={corrigirMontagensPresas}
          disabled={carregando}
          className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50"
        >
          {carregando ? 'Executando...' : 'Buscar e Gerar Montagens Faltantes'}
        </button>
      </div>

      <hr className="my-8 border-gray-300" />

      {/* SEÇÃO 2: DIAGNÓSTICO DE ORDINÁRIA */}
      <div className="bg-red-50 border border-red-200 p-6 rounded-lg">
        <h2 className="text-xl font-bold text-red-800 mb-2">2. Diagnóstico de Pedidos Duplicados (Antigo)</h2>
        <p className="text-sm text-red-700 mb-4">
          Este diagnóstico vai identificar se há constraints impedindo a inserção de pedidos.
        </p>
        <button
          onClick={executarDiagnostico}
          disabled={carregando}
          className="bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600 disabled:opacity-50"
        >
          {carregando ? 'Diagnosticando...' : 'Executar Diagnóstico Completo'}
        </button>
      </div>

      <div className="mt-6">
        <h3 className="font-bold mb-2">Logs de Execução:</h3>
        {resultado ? (
          <div className="bg-black text-green-400 p-4 rounded-lg font-mono text-sm whitespace-pre-line max-h-96 overflow-y-auto">
            {resultado}
          </div>
        ) : (
          <div className="bg-gray-100 p-4 rounded-lg text-gray-500 text-center border border-gray-200">
            Nenhum script foi executado ainda. Os resultados aparecerão aqui.
          </div>
        )}
      </div>

    </div>
  );
}
