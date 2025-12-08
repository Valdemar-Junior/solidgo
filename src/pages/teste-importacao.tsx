import { useState } from 'react';
import { supabase } from '../supabase/client';

export default function TesteImportacao() {
  const [resultado, setResultado] = useState<string>('');
  const [carregando, setCarregando] = useState(false);

  const testarErro = async () => {
    setCarregando(true);
    setResultado('Iniciando teste...\n');

    try {
      // Testar quantos pedidos existem
      setResultado(prev => prev + '1. Verificando quantidade de pedidos...\n');
      const { data: countData, error: countError } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true });

      if (countError) {
        setResultado(prev => prev + `ERRO AO CONTAR: ${countError.message}\n`);
        return;
      }
      setResultado(prev => prev + `Total de pedidos: ${countData?.length || 0}\n`);

      // Testar estrutura da tabela
      setResultado(prev => prev + '\n2. Verificando estrutura da tabela...\n');
      const { data: structureData, error: structureError } = await supabase
        .from('orders')
        .select('id_unico_integracao')
        .limit(1);

      if (structureError) {
        setResultado(prev => prev + `ERRO NA ESTRUTURA: ${structureError.message}\n`);
        return;
      }
      setResultado(prev => prev + `Estrutura OK - Coluna existe\n`);

      // Testar inserção de um pedido
      setResultado(prev => prev + '\n3. Testando inserção de pedido...\n');
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
        setResultado(prev => prev + `ERRO AO INSERIR: ${insertError.message}\n`);
        setResultado(prev => prev + `Detalhes: ${JSON.stringify(insertError, null, 2)}\n`);
        
        // Verificar se é erro de duplicado
        if (insertError.code === '23505') {
          setResultado(prev => prev + `\n⚠️  ISSO É UM ERRO DE DUPLICADO!\n`);
          setResultado(prev => prev + `Verifique se já existe um pedido com id_unico_integracao = ${testOrder.id_unico_integracao}\n`);
        }
      } else {
        setResultado(prev => prev + `✓ Inserido com sucesso!\n`);
        
        // Limpar o pedido de teste
        await supabase.from('orders').delete().eq('id_unico_integracao', 999999);
        setResultado(prev => prev + `✓ Pedido de teste removido\n`);
      }

      // Testar RLS
      setResultado(prev => prev + '\n4. Verificando permissões RLS...\n');
      const { data: rlsTest, error: rlsError } = await supabase
        .from('orders')
        .select('*')
        .limit(5);

      if (rlsError) {
        setResultado(prev => prev + `ERRO RLS: ${rlsError.message}\n`);
      } else {
        setResultado(prev => prev + `✓ Permissões RLS OK - Conseguiu ler ${rlsTest?.length || 0} registros\n`);
      }

      setResultado(prev => prev + '\n✅ Teste concluído!');

    } catch (erro) {
      setResultado(prev => prev + `\n❌ ERRO GERAL: ${erro}\n`);
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Teste de Importação - Debug</h1>
      
      <div className="bg-gray-100 p-4 rounded-lg mb-6">
        <h2 className="font-semibold mb-2">Instruções:</h2>
        <p className="text-sm text-gray-700">
          Clique no botão abaixo para executar os testes e descobrir o que está causando o erro de duplicados.
        </p>
      </div>

      <button
        onClick={testarErro}
        disabled={carregando}
        className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 mb-6"
      >
        {carregando ? 'Testando...' : 'Executar Teste'}
      </button>

      {resultado && (
        <div className="bg-black text-green-400 p-4 rounded-lg font-mono text-sm whitespace-pre-line">
          {resultado}
        </div>
      )}

      <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <h3 className="font-semibold text-yellow-800">Possíveis causas:</h3>
        <ul className="text-sm text-yellow-700 mt-2 space-y-1">
          <li>• Constraint única na coluna errada</li>
          <li>• RLS bloqueando inserção</li>
          <li>• Tipo de dados incorreto</li>
          <li>• Constraint existente no banco</li>
        </ul>
      </div>
    </div>
  );
}
