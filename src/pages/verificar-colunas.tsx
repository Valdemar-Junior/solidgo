import { useState } from 'react';
import { supabase } from '../supabase/client';

export default function VerificarColunasOrders() {
  const [resultado, setResultado] = useState<string>('');
  const [carregando, setCarregando] = useState(false);

  const verificarColunas = async () => {
    setCarregando(true);
    setResultado('=== VERIFICANDO COLUNAS DA TABELA ORDERS ===\n\n');

    try {
      // 1. Verificar estrutura completa da tabela
      setResultado(prev => prev + '1. Verificando estrutura da tabela orders...\n');
      
      const { data: columns, error: columnsError } = await supabase
        .rpc('get_table_columns', { table_name: 'orders' });

      if (columnsError) {
        setResultado(prev => prev + `Erro ao verificar colunas: ${columnsError.message}\n`);
      } else {
        setResultado(prev => prev + `COLUNAS ENCONTRADAS NA TABELA ORDERS:\n`);
        setResultado(prev => prev + `=====================================\n\n`);
        
        columns?.forEach((col: any) => {
          setResultado(prev => prev + `${col.column_name}: ${col.data_type}${col.is_nullable === 'YES' ? ' (opcional)' : ' (obrigatório)'}`);
          if (col.column_default) {
            setResultado(prev => prev + ` DEFAULT: ${col.column_default}`);
          }
          setResultado(prev => prev + '\n');
        });
      }

      // 2. Comparar com o JSON que você está importando
      setResultado(prev => prev + '\n\n2. COLUNAS QUE ESTÃO FALTANDO:\n');
      setResultado(prev => prev + '============================\n');
      
      const colunasDoJSON = [
        'id_unico_integracao',
        'operacoes',
        'filial_venda',
        'lancamento_venda',
        'data_venda',
        'previsao_entrega',
        'codigo_cliente',
        'nome_cliente',
        'cliente_celular',
        'destinatario_endereco',
        'destinatario_complemento',
        'destinatario_bairro',
        'destinatario_cidade',
        'observacoes',
        'tipo',
        'filial_entrega',
        'status_logistica',
        'tem_frete_full',
        'codigo_produto',
        'nome_produto',
        'local_estocagem',
        'tem_montagem'
      ];

      const colunasExistentes = columns?.map((col: any) => col.column_name) || [];
      const colunasFaltando = colunasDoJSON.filter(col => !colunasExistentes.includes(col));

      if (colunasFaltando.length > 0) {
        setResultado(prev => prev + `❌ COLUNAS FALTANDO (${colunasFaltando.length}):\n`);
        colunasFaltando.forEach(col => {
          setResultado(prev => prev + `   - ${col}\n`);
        });
      } else {
        setResultado(prev => prev + '✓ Todas as colunas do JSON existem!\n');
      }

      // 3. Verificar se há colunas extras
      setResultado(prev => prev + '\n\n3. COLUNAS EXTRAS NA TABELA:\n');
      setResultado(prev => prev + '==========================\n');
      
      const colunasExtras = colunasExistentes.filter((col: string) => !colunasDoJSON.includes(col));
      
      if (colunasExtras.length > 0) {
        setResultado(prev => prev + `ℹ️  COLUNAS EXTRAS (${colunasExtras.length}):\n`);
        colunasExtras.forEach(col => {
          setResultado(prev => prev + `   - ${col}\n`);
        });
      } else {
        setResultado(prev => prev + '✓ Nenhuma coluna extra encontrada\n');
      }

      setResultado(prev => prev + '\n\n✅ VERIFICAÇÃO CONCLUÍDA!\n');
      setResultado(prev => prev + '\nSOLUÇÃO: Precisamos adicionar as colunas faltantes à tabela orders.\n');

    } catch (erro) {
      setResultado(prev => prev + `\n❌ ERRO: ${erro}\n`);
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Verificar Colunas da Tabela Orders</h1>
      
      <div className="bg-red-50 border border-red-200 p-4 rounded-lg mb-6">
        <h2 className="font-semibold text-red-800 mb-2">ERRO IDENTIFICADO: Coluna 'cliente_celular' não existe!</h2>
        <p className="text-sm text-red-700">
          O sistema está tentando inserir dados em colunas que não existem na tabela orders.
        </p>
      </div>

      <button
        onClick={verificarColunas}
        disabled={carregando}
        className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 mb-6"
      >
        {carregando ? 'Verificando...' : 'Verificar Todas as Colunas'}
      </button>

      {resultado && (
        <div className="bg-black text-green-400 p-4 rounded-lg font-mono text-sm whitespace-pre-line max-h-96 overflow-y-auto">
          {resultado}
        </div>
      )}

      <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <h3 className="font-semibold text-yellow-800">Script SQL para adicionar colunas faltantes:</h3>
        <pre className="text-xs bg-gray-800 text-green-400 p-3 rounded mt-2 overflow-x-auto">
{`-- ADICIONAR COLUNAS FALTANTES À TABELA ORDERS
ALTER TABLE orders ADD COLUMN cliente_celular TEXT;
ALTER TABLE orders ADD COLUMN destinatario_complemento TEXT;
ALTER TABLE orders ADD COLUMN tem_frete_full TEXT;
ALTER TABLE orders ADD COLUMN local_estocagem TEXT;
ALTER TABLE orders ADD COLUMN tem_montagem TEXT;

-- Verificar se existem mais colunas faltantes executando a verificação`}
        </pre>
      </div>
    </div>
  );
}