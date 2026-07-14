# Entrega por produto — contexto, decisões e plano seguro

## Regra de segurança do ambiente

Este trabalho deve ser executado exclusivamente na cópia de teste:

- Diretório: `/Users/junior/Projetos/solidgo - cópia`
- Supabase project ref: `lbidznhkhtwamgaexgyy`

Antes de qualquer alteração, confirmar os dois valores. Se algum deles não coincidir, parar.
O projeto original usa outro project ref e não deve ser alterado.

Existem mudanças locais anteriores no módulo de inspeção/frota. Elas pertencem ao usuário e devem ser preservadas e mantidas fora dos commits desta funcionalidade.

## Problema original

Pedidos podem sofrer devolução total ou parcial. A devolução total funciona razoavelmente porque o sistema atual trata o pedido como uma unidade binária. A devolução parcial expõe o problema: um pedido com três produtos pode ter apenas um produto devolvido, mas o sistema bloqueia ou entrega o pedido inteiro.

Exemplo:

- Pedido: produtos A, B e C.
- Devolução parcial antes da rota: produto C.
- Resultado correto: somente A e B podem entrar no romaneio de entrega.
- C continua no histórico como devolvido.

Também existem necessidades atuais de:

- retirada parcial pelo cliente;
- entrega parcial;
- produto recusado no endereço e retornando ao depósito;
- produto agendado/aguardando autorização do cliente;
- múltiplas rotas para o saldo restante do mesmo pedido.

A primeira fase deve tratar entrega. Montagem será analisada e adaptada depois.

## Comportamento fiscal decidido

NF-e e MDF-e permanecem como estão.

- A NF-e original continua vinculada ao romaneio/MDF-e.
- O MDF-e não será alterado nesta fase.
- Devolução parcial é um processo separado, com NF de devolução e itens devolvidos.
- Não remover a NF-e original de MDF-e autorizado.

## Kits

O ERP sempre envia na nota todos os componentes do kit e a devolução do kit sempre é completa. Não criar validação especial de kit na primeira fase. Componentes podem continuar estruturados por SKU, mantendo metadados do kit apenas para agrupamento e uso futuro na montagem.

## Diagnóstico do código atual

### Importação

- `orders` é a tabela principal.
- Produtos ficam em `orders.items_json`.
- `orders.order_id_erp` já possui restrição única no banco.
- A importação em lote consulta por `order_id_erp` e evita duplicação.
- Quando atualização de existentes está habilitada, `items_json` é substituído.
- Portanto, histórico operacional não pode ser salvo dentro de `items_json`.

### Roteirização

- `route_orders` vincula rota e pedido inteiro.
- Não há vínculo por produto ou quantidade.
- Pedidos com `blocked_at` são excluídos integralmente da lista de roteirização.

### Documentos e conferência

- Romaneios percorrem o `items_json` completo.
- Conferência cria expectativa usando etiquetas ou todos os itens do pedido.
- “Não bipado” é apenas divergência; não altera saldo ou composição por produto.
- Alterar a composição depois da conferência precisa invalidar a conferência.

### Motorista e offline

- Motorista marca pedido inteiro como entregue ou retornado.
- Entrega atual coloca `route_orders.status = delivered` e `orders.status = delivered`.
- Também limpa `return_flag`, `last_return_reason` e `last_return_notes`.
- Offline repete a mesma lógica.
- A finalização offline atual marca a rota como concluída antes de uma validação transacional de resultados. Não reutilizar esse caminho para rotas itemizadas.

### Retirada

- `order_withdrawals` possui um único registro por pedido.
- Retirada atual marca o pedido inteiro como entregue.

### Comprovante e relatórios

- `delivery_receipts` comprova o pedido/rota, mas não produtos e quantidades.
- Relatórios classificam todas as unidades pelo status geral do pedido.
- Rastreio público também trabalha no nível do pedido.

### Devolução

- O XML da NF de devolução já é armazenado.
- O código já interpreta `cProd`, `xProd`, `qCom`/`qTrib` para documentos de coleta.
- Esses dados ainda não afetam saldo, romaneio ou entrega.

## Modelo conceitual aprovado

`orders` e `items_json` permanecem. Novas estruturas devem ser aditivas.

### `order_items`

Representação operacional estruturada dos itens originais:

- `id`
- `order_id`
- chave estável da linha/origem
- SKU
- descrição
- quantidade comprada
- quantidade de volumes
- local de estoque
- payload/metadados originais

Como o payload atual não mostrou um ID estável de linha, usar identidade composta por SKU, local e código do kit. Linhas equivalentes podem ser agregadas. Se um SKU tiver múltiplos candidatos ambíguos para uma devolução, registrar divergência e não adivinhar.

### `order_returns`

Cabeçalho de cada devolução/NF. Um pedido pode ter várias devoluções.

### `order_return_items`

Produtos e quantidades de cada devolução.

### `order_item_holds`

Quantidades agendadas/aguardando cliente. Enquanto ativas, não podem ser roteirizadas.

### `route_order_items`

Produtos e quantidades efetivamente alocados em cada `route_order`.

### Movimentações/eventos

Histórico append-only das ações por produto:

- entregue;
- retirada pelo cliente;
- recusado;
- não entregue;
- avariado/quarentena;
- ajustes controlados.

Eventos offline precisam de chave idempotente única.

### Retorno físico

Produto recusado pelo cliente não vira automaticamente devolução fiscal.

Fluxo:

1. Motorista registra recusa.
2. Produto fica `retornando ao depósito`.
3. Conferente confirma recebimento físico e condição.
4. Destino: disponível para nova rota, aguardando cliente, quarentena ou aguardando devolução no ERP.

Regra: recusado não significa devolvido definitivamente.

## Fórmulas centrais

Por produto:

`pendente = comprado - devolvido fiscalmente - retirado - entregue`

`disponível para rota = pendente - agendado - alocado em rota ativa - retornando ao depósito - em quarentena`

Invariantes:

- nenhuma quantidade pode ser negativa;
- devolvido + retirado + entregue não pode superar comprado;
- alocado não pode superar disponível;
- uma unidade não pode estar simultaneamente entregue e devolvida;
- uma unidade não pode estar em duas rotas ativas;
- produto retornando ao depósito não pode ser roteirizado novamente;
- produto agendado não pode entrar em rota.

## Feature flags e compatibilidade

Modos previstos:

- desligado;
- sombra;
- piloto;
- ativado.

Flags funcionais separadas podem controlar:

- controle por produto;
- devolução parcial;
- alocação por produto;
- entrega por produto;
- agendamento por produto.

Toda rota deve congelar o modo em que foi criada:

- `legacy`: fluxo atual;
- `itemized`: fluxo por produto.

Desligar uma flag impede novas rotas itemizadas, mas não converte rotas já abertas.

Rotas itemizadas também precisam de uma versão de composição. Qualquer alteração incrementa a versão e invalida conferência anterior. Ao iniciar a rota, composição fica congelada.

## Estratégia de implantação aprovada

1. Criar migrations somente aditivas.
2. Inserir configurações desligadas.
3. Criar `order_items` e backfill de `items_json`.
4. Executar modo sombra e diagnóstico sem alterar telas operacionais.
5. Mostrar prévia administrativa comparando fluxo atual e saldo novo.
6. Ativar piloto somente para rotas escolhidas.
7. Implementar devolução parcial antes da rota.
8. Romaneio e conferência passam a usar `route_order_items` em rotas piloto.
9. Manter inicialmente o botão do motorista “Entregar tudo”. O servidor expande a ação para todos os itens alocados.
10. Somente depois implementar entrega com divergência por produto.
11. Testar online primeiro e offline depois.
12. Montagem fica fora da primeira fase.

## Regras de concorrência

Saldo deve ser recalculado dentro do banco no momento da confirmação. Não confiar no saldo carregado pela tela.

Operações de alocação, retirada, agendamento, devolução e entrega devem usar RPCs transacionais com bloqueio das linhas relevantes.

Casos:

- devolução após alocação em rota pendente: reduzir/remover alocação, incrementar versão e exigir nova conferência;
- devolução depois de rota iniciada: não alterar silenciosamente a carga; criar ocorrência operacional;
- retirada de item já alocado: bloquear, ou remover primeiro se a rota ainda estiver pendente;
- agendamento de item alocado: mesma regra;
- exclusão de rota pendente: liberar alocações;
- rota iniciada: não permitir exclusão/edição de composição.

## Reimportação

- Pedido continua sendo localizado pelo `order_id_erp` existente.
- Não alterar a proteção atual contra duplicação de pedidos.
- Sincronizar `order_items` depois de localizar o mesmo UUID de `orders`.
- Reimportação nunca apaga movimentações.
- Produto removido do payload com histórico vira divergência, não é apagado.
- Quantidade nova abaixo da quantidade já comprometida vira divergência.
- Aumento de quantidade pode criar saldo novo após validação.

## Offline e idempotência

Cada confirmação deve ter um UUID persistido no dispositivo antes do envio.

O banco deve garantir `UNIQUE(idempotency_key)`. Reenviar o mesmo evento retorna sucesso sem somar novamente.

Finalização de rota itemizada deve ocorrer em RPC própria:

- valida versão da composição;
- valida todos os produtos resolvidos;
- rejeita quantidades excedentes;
- somente então conclui a rota;
- se a finalização chegar antes dos eventos, falha de forma recuperável e é tentada novamente.

Não reutilizar diretamente a rotina offline legada de finalização para rotas itemizadas.

## Testes de mesa já executados

Foram executados:

- 34 cenários dirigidos;
- 10.000 sequências aleatórias;
- 50 operações por sequência;
- 500.000 tentativas;
- 73.735 operações válidas;
- zero violações das invariantes no modelo proposto.

Cenários cobertos:

- entrega completa;
- devolução parcial antes da rota;
- evento offline duplicado;
- segundo evento diferente excedendo alocação;
- conferência antiga após edição;
- edição/exclusão de rota iniciada;
- exclusão de rota pendente liberando saldo;
- finalização com item não resolvido;
- recusa parcial, retorno ao depósito e nova entrega;
- tentativa de nova rota antes do retorno físico;
- quarentena e liberação;
- devolução do ERP após alocação;
- retirada/agendamento concorrendo com alocação;
- desfazer antes e depois do fechamento da rota;
- flags alteradas com rotas abertas;
- duas rotas concorrendo pela mesma unidade;
- finalização offline antes dos eventos;
- repetição da mesma confirmação;
- reimportação igual;
- novo produto;
- aumento e redução de quantidade;
- linha removida com histórico;
- SKU duplicado;
- mesmo SKU em locais diferentes.

## Primeira implementação autorizada

Começar somente por:

1. migration aditiva da fundação;
2. feature flags desligadas/modo sombra;
3. `order_items`;
4. sincronização idempotente de `items_json` para `order_items`;
5. diagnóstico/saldos sombra;
6. tipos mínimos na aplicação;
7. testes e build.

Não ativar nem alterar ainda:

- roteirização real;
- romaneio real;
- conferência real;
- aplicativo do motorista;
- offline;
- MDF-e;
- montagem.

## Critério de segurança

A implementação estrutural e o modo sombra são considerados seguros para começar na cópia de teste. A ativação funcional deve ocorrer somente após validar backfill, saldos e divergências com pedidos controlados.
