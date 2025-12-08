// Exemplo de webhook para processar e enviar dados com id_unico_integracao
// Este é um exemplo de como o webhook deve funcionar

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Simular dados do ERP com id_unico_integracao
    const mockData = [
      {
        id_unico_integracao: 80248,
        operacoes: "Venda com Entrega",
        filial_venda: "ATACADO LOJA ASSU",
        lancamento_venda: 112436,
        data_venda: "2025-11-22T03:00:00.000Z",
        previsao_entrega: "2025-12-07T03:00:00.000Z",
        codigo_cliente: "C015602",
        nome_cliente: "Paulo Leandro Alves",
        cliente_celular: "(84) 99691-1874",
        destinatario_endereco: "Rua Francisco Das Chagas Ferreira , 156",
        destinatario_complemento: "Proximo A Chico Biancó.. Ultima Casa Da Rua.",
        destinatario_bairro: "Bairro Vermelho",
        destinatario_cidade: "ITAJÁ",
        observacoes: "LIGAR ANTES DA ENTREGA.",
        tipo: 1,
        filial_entrega: "ATACADO LOJA ASSU",
        status_logistica: "FINALIZADO",
        tem_frete_full: "NÃO",
        codigo_produto: "2577",
        nome_produto: "REFRIGERADOR ROC35 PRO 220V - ESMALTEC - BRANCO TOTAL",
        local_estocagem: "ATACADO LOJA ASSU",
        tem_montagem: "NÃO",
        produtos_locais: [
          {
            codigo_produto: "2577",
            nome_produto: "REFRIGERADOR ROC35 PRO 220V - ESMALTEC - BRANCO TOTAL",
            local_estocagem: "ATACADO LOJA ASSU"
          }
        ],
        xmls_documentos: []
      }
    ];

    // Retornar os dados para o frontend
    return res.status(200).json(mockData);
    
  } catch (error) {
    console.error('Erro no webhook:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}