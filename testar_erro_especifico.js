// TESTAR QUAL ERRO EXATO ESTÁ ACONTECENDO
// Cole este código no console (F12)

console.log('=== TESTANDO ERRO ESPECÍFICO ===');

async function testarErro() {
    try {
        // Criar um pedido de teste exatamente como o sistema faz
        const pedidoTeste = {
            order_id_erp: "112436",
            id_unico_integracao: BigInt(80248),
            customer_name: "Paulo Leandro Alves",
            phone: "(84) 99691-1874",
            
            // Todos os campos
            operacoes: "Venda com Entrega",
            filial_venda: "ATACADO LOJA ASSU",
            data_venda: "2025-11-22T03:00:00.000Z",
            previsao_entrega: "2025-12-07T03:00:00.000Z",
            codigo_cliente: "C015602",
            tipo: 1,
            filial_entrega: "ATACADO LOJA ASSU",
            status_logistica: "FINALIZADO",
            tem_frete_full: "NÃO",
            codigo_produto: "2577",
            nome_produto: "REFRIGERADOR ROC35 PRO 220V - ESMALTEC - BRANCO TOTAL",
            local_estocagem: "ATACADO LOJA ASSU",
            tem_montagem: "NÃO",
            
            address_json: {
                street: "Rua Francisco Das Chagas Ferreira , 156",
                neighborhood: "Bairro Vermelho",
                city: "ITAJÁ",
                state: "",
                zip: "",
                complement: "Proximo A Chico Biancó.. Ultima Casa Da Rua."
            },
            
            items_json: [{
                sku: "2577",
                name: "REFRIGERADOR ROC35 PRO 220V - ESMALTEC - BRANCO TOTAL",
                quantity: 1,
                price: 0,
                location: "ATACADO LOJA ASSU"
            }],
            
            total: 0,
            observations: "LIGAR ANTES DA ENTREGA.",
            destinatario_complemento: "Proximo A Chico Biancó.. Ultima Casa Da Rua.",
            status: "pending",
            raw_json: {},
            xml_documento: null
        };

        console.log('Pedido de teste:', pedidoTeste);

        // Tentar inserir
        console.log('Tentando inserir pedido...');
        const { data, error } = await supabase
            .from('orders')
            .insert(pedidoTeste)
            .select();

        console.log('Resultado:', data);
        console.log('Erro completo:', error);
        
        if (error) {
            console.log('Mensagem de erro:', error.message);
            console.log('Detalhes do erro:', error.details);
            console.log('Código do erro:', error.code);
        }

        // Verificar se foi inserido
        if (!error) {
            console.log('Pedido inserido com sucesso!');
            
            // Verificar se o pedido está na tabela
            const { data: verificar, error: verificarError } = await supabase
                .from('orders')
                .select('id, order_id_erp, id_unico_integracao')
                .eq('id_unico_integracao', 80248);
            
            console.log('Pedido encontrado na tabela:', verificar);
            console.log('Erro na verificação:', verificarError);
        }

    } catch (e) {
        console.error('Erro geral:', e);
        console.error('Stack:', e.stack);
    }
}

testarErro();