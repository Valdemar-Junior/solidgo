// CÓDIGO PARA DEBUGAR A IMPORTAÇÃO PASSO A PASSO
// Cole este código no console (F12) na página de importação

console.log('=== DEBUG DA IMPORTAÇÃO ===');

async function debugImportacao() {
    try {
        // 1. Verificar se a tabela orders está vazia
        console.log('1. Verificando se a tabela orders está vazia...');
        const { data: countData, error: countError } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true });
        
        console.log('Total de pedidos na tabela:', countData?.length || 0);
        console.log('Erro na contagem:', countError);

        // 2. Simular os dados do webhook
        console.log('2. Simulando dados do webhook...');
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

        console.log('Dados simulados:', mockData[0]);

        // 3. Testar a transformação dos dados
        console.log('3. Testando transformação dos dados...');
        const toDb = mockData.map((o) => {
            const produtos = Array.isArray(o.produtos_locais) ? o.produtos_locais : [];
            const xmls = Array.isArray(o.xmls_documentos) ? o.xmls_documentos : [];
            const firstXml = Array.isArray(xmls) && xmls.length > 0
                ? (typeof xmls[0] === 'string' ? xmls[0] : (xmls[0]?.xml || xmls[0]?.base64 || ''))
                : '';
            
            return {
                order_id_erp: String(o.lancamento_venda ?? o.codigo_cliente ?? Math.random().toString(36).slice(2)),
                id_unico_integracao: o.id_unico_integracao ? BigInt(o.id_unico_integracao) : null,
                customer_name: String(o.nome_cliente ?? ''),
                phone: String(o.cliente_celular ?? ''),
                
                // Todos os campos do JSON
                operacoes: String(o.operacoes ?? ''),
                filial_venda: String(o.filial_venda ?? ''),
                data_venda: o.data_venda ? new Date(o.data_venda).toISOString() : null,
                previsao_entrega: o.previsao_entrega ? new Date(o.previsao_entrega).toISOString() : null,
                codigo_cliente: String(o.codigo_cliente ?? ''),
                tipo: o.tipo ? parseInt(String(o.tipo)) : null,
                filial_entrega: String(o.filial_entrega ?? ''),
                status_logistica: String(o.status_logistica ?? ''),
                tem_frete_full: String(o.tem_frete_full ?? ''),
                codigo_produto: String(o.codigo_produto ?? ''),
                nome_produto: String(o.nome_produto ?? ''),
                local_estocagem: String(o.local_estocagem ?? ''),
                tem_montagem: String(o.tem_montagem ?? ''),
                
                // Endereço
                address_json: {
                    street: String(o.destinatario_endereco ?? ''),
                    neighborhood: String(o.destinatario_bairro ?? ''),
                    city: String(o.destinatario_cidade ?? ''),
                    state: '',
                    zip: String(o.destinatario_cep ?? ''),
                    complement: String(o.destinatario_complemento ?? '')
                },
                
                // Produtos
                items_json: produtos.map((p) => ({
                    sku: String(p.codigo_produto ?? ''),
                    name: String(p.nome_produto ?? ''),
                    quantity: 1,
                    price: 0,
                    location: String(p.local_estocagem ?? ''),
                })),
                
                total: 0,
                observations: String(o.observacoes ?? ''),
                destinatario_complemento: String(o.destinatario_complemento ?? ''),
                status: 'pending',
                raw_json: o,
                xml_documento: firstXml || null,
            };
        });

        console.log('Dados transformados:', toDb[0]);

        // 4. Testar a verificação de duplicados
        console.log('4. Testando verificação de duplicados...');
        const idsUnicos = toDb.map((o) => o.id_unico_integracao).filter(Boolean);
        console.log('IDs únicos encontrados:', idsUnicos);

        if (idsUnicos.length > 0) {
            const { data: existentes, error: existentesError } = await supabase
                .from('orders')
                .select('id, id_unico_integracao')
                .in('id_unico_integracao', idsUnicos);
            
            console.log('Pedidos existentes com estes IDs:', existentes);
            console.log('Erro na consulta:', existentesError);

            const existentesSet = new Set((existentes || []).map((e) => String(e.id_unico_integracao)));
            console.log('Set de existentes:', Array.from(existentesSet));

            const paraInserir = toDb.filter((o) => {
                if (o.id_unico_integracao) {
                    return !existentesSet.has(String(o.id_unico_integracao));
                }
                return true;
            });

            console.log('Para inserir:', paraInserir.length);
            console.log('Duplicados:', toDb.length - paraInserir.length);
        }

        // 5. Testar inserção manual
        console.log('5. Testando inserção manual...');
        if (toDb.length > 0) {
            const { data: insertData, error: insertError } = await supabase
                .from('orders')
                .insert(toDb[0])
                .select();
            
            console.log('Resultado da inserção:', insertData);
            console.log('Erro da inserção:', insertError);
        }

    } catch (error) {
        console.error('Erro no debug:', error);
    }
}

// Executar o debug
debugImportacao();