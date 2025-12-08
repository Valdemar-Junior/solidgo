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

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Diagnóstico Completo - Tabela Orders</h1>
      
      <div className="bg-red-50 border border-red-200 p-4 rounded-lg mb-6">
        <h2 className="font-semibold text-red-800 mb-2">Problema: 1350 pedidos com erro de duplicados</h2>
        <p className="text-sm text-red-700">
          Este diagnóstico vai identificar exatamente qual constraint está causando o erro.
        </p>
      </div>

      <button
        onClick={executarDiagnostico}
        disabled={carregando}
        className="bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600 disabled:opacity-50 mb-6"
      >
        {carregando ? 'Diagnosticando...' : 'Executar Diagnóstico Completo'}
      </button>

      {resultado && (
        <div className="bg-black text-green-400 p-4 rounded-lg font-mono text-sm whitespace-pre-line max-h-96 overflow-y-auto">
          {resultado}
        </div>
      )}

      <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="font-semibold text-blue-800">Script SQL para correção:</h3>
        <pre className="text-xs bg-gray-800 text-green-400 p-3 rounded mt-2 overflow-x-auto">
{`-- REMOVER CONSTRAINTS PROBLEMÁTICAS
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_lancamento_venda_key;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_id_erp_key;

-- GARANTIR CONSTRAINT ÚNICA APENAS EM id_unico_integracao
ALTER TABLE orders ADD CONSTRAINT orders_id_unico_integracao_unique UNIQUE (id_unico_integracao);`}
        </pre>
      </div>
    </div>
  );
}
