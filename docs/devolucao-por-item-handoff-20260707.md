# Handoff — devolução por item, coletas e consulta de pedido

## Regra de ouro deste contexto

Todas as alterações desta frente foram feitas e devem continuar sendo feitas somente no projeto cópia:

- Diretório: `/Users/junior/Projetos/solidgo - cópia`
- Banco/teste usado pelo usuário: ambiente de teste ligado a essa cópia

Não misturar este contexto com o projeto original.

---

## Objetivo desta etapa

Fechar o fluxo de devolução por item sem quebrar o legado, cobrindo:

- devolução parcial antes da rota;
- devolução parcial após entrega;
- devolução total após múltiplos eventos de devolução;
- geração de coleta por evento de devolução;
- visualização clara disso na consulta de pedido;
- bloqueio correto na gestão de entregas, sem deixar item devolvido voltar para rota.

O usuário deixou claro que só quer avançar para outras partes quando esta frente de devolução estiver realmente fechada.

---

## Decisões de negócio confirmadas nesta conversa

### 1. Criação da rota continua por pedido inteiro

Mesmo com entrega por item evoluindo, a criação da rota ainda deve subir o pedido inteiro.

Ou seja:

- neste momento, não pode montar rota levando um produto e deixando outro do mesmo pedido para trás na criação inicial;
- a granularidade por item entra depois, no acompanhamento da devolução/entrega/coleta.

### 2. Devolução fiscal no ERP significa que o cliente não quer mais aquele produto

Quando a devolução ocorre no ERP:

- o item devolvido não pode voltar para a gestão de entrega como item disponível;
- ele precisa ficar bloqueado operacionalmente para entrega;
- se a devolução aconteceu depois de uma entrega concluída, o fluxo correto é coleta.

### 3. Pode existir mais de uma devolução para o mesmo pedido

O usuário confirmou que este cenário é real e válido:

- um item pode ser devolvido hoje;
- outro item do mesmo pedido pode ser devolvido depois;
- cada evento pode gerar sua própria coleta.

Logo, o sistema não pode tratar coleta só no nível do pedido. Precisa tratar no nível do evento de devolução.

### 4. Não existe “desfazer devolução” como fluxo de negócio normal

O usuário confirmou que, na prática:

- depois que a devolução/cancelamento acontece, não existe retroceder;
- mesmo assim, reforços de segurança no código são bem-vindos.

### 5. A UI não pode mostrar inglês nem termos internos confusos

O usuário sinalizou explicitamente:

- evitar mostrar termos como `returned`, `processed`, `pending` para motorista/usuário final;
- evitar poluição com linguagem técnica como “modo sombra”, salvo onde for estritamente de diagnóstico.

---

## Linha do tempo resumida do que foi construído

### Fase 1 — fundação da estrutura por item

Migration principal:

- `supabase/migrations/20260707100000_create_item_fulfillment_shadow_foundation.sql`

O que essa migration introduziu:

- `app_settings.item_fulfillment_control`
- colunas em `routes` para modo de fulfillment
- tabela `order_items`
- tabela `order_returns`
- tabela `order_return_items`
- tabela `item_fulfillment_sync_issues`
- funções de sync e diagnóstico
- view `order_item_shadow_balances`

Objetivo:

- criar uma camada estruturada de itens sem quebrar o fluxo legado;
- começar em modo sombra, com flags desligadas;
- permitir diagnóstico e backfill.

### Fase 2 — snapshot por item dentro da rota

Migration:

- `supabase/migrations/20260707113000_create_route_order_item_snapshots.sql`

O que foi criado:

- `route_order_items`
- função `sync_route_order_item_snapshots_bulk(uuid[])`

Objetivo:

- manter a criação da rota em nível de pedido;
- mas congelar um snapshot por item dentro de cada `route_order`.

Importante:

- isso preparou o terreno para mostrar na rota o que está alocado item a item.

### Fase 3 — sincronização automática após devolução parcial

Migration:

- `supabase/migrations/20260707123000_automate_partial_return_route_snapshot_sync.sql`

O que passou a acontecer:

- ao processar devolução, a view de saldos e os snapshots da rota aberta são recalculados;
- itens devolvidos antes da entrega somem do saldo entregável;
- itens já devolvidos podem aparecer na rota como bloqueados/zerados em vez de simplesmente sumirem sem contexto.

### Fase 4 — permitir item bloqueado com alocação zero

Migration:

- `supabase/migrations/20260707130000_allow_zero_allocated_for_blocked_route_items.sql`

Motivo:

- quando um item já devolvido precisa continuar visível na rota só para informar o motorista, ele pode ficar com alocação/saldo zero;
- a constraint anterior impedia esse cenário.

### Fase 5 — sincronizar devoluções processadas com o estado operacional do pedido

Migration:

- `supabase/migrations/20260707143000_sync_pickups_from_processed_returns.sql`

Objetivo:

- pegar a devolução processada e refletir isso no pedido original;
- diferenciar:
  - devolução total;
  - devolução parcial;
  - devolução após entrega;
  - necessidade de coleta.

Essa migration fez o pedido original passar a carregar melhor:

- `return_flag`
- `requires_pickup`
- `blocked_reason`
- `return_nfe_number`
- `return_type`

### Fase 6 — controlar coleta por evento de devolução, e não só por pedido

Migration:

- `supabase/migrations/20260707153000_track_pickups_per_return_event.sql`

Motivação:

- um pedido pode ter múltiplos eventos de devolução;
- cada evento pode pedir uma coleta própria;
- não pode misturar todas as devoluções num único “estado de coleta do pedido”.

Campos adicionados em `order_returns`:

- `requires_pickup`
- `pickup_created_at`
- `pickup_order_id`
- `pickup_route_id`

Evolução importante:

- o estado operacional do pedido passou a ser recalculado com base nos eventos de devolução processados;
- o pedido fica aguardando coleta quando ainda existe evento de devolução sem coleta criada;
- quando uma coleta já foi criada para um evento, ela deve deixar de aparecer como “pendente”.

### Fase 7 — centralizar o vínculo entre devolução e coleta

Migration:

- `supabase/migrations/20260707164000_manage_return_pickup_links.sql`

Funções criadas:

- `public.register_order_return_pickup(...)`
- `public.clear_order_return_pickup(...)`

Objetivo:

- parar de depender de updates diretos no frontend sobre `order_returns`;
- registrar de forma oficial qual rota/pedido de coleta pertence a qual evento de devolução;
- permitir limpar e recalcular vínculo com segurança.

---

## Problemas reais encontrados e como foram resolvidos

### 1. Erro `crypto.randomUUID is not a function` ao criar rota

Sintoma:

- criação de rota quebrava no frontend.

Contexto:

- isso apareceu quando a interface começou a trabalhar com novas estruturas.

Situação:

- o usuário conseguiu voltar a criar rota e seguir nos testes.

### 2. Snapshot de rota com item devolvido causava erro de constraint

Erro observado:

- violação de constraint em `route_order_items_allocated_quantity_positive`.

Causa:

- item devolvido precisava permanecer visível, mas com quantidade alocada zero.

Correção:

- migration `20260707130000_allow_zero_allocated_for_blocked_route_items.sql`.

### 3. Duplicidade ao ressincronizar snapshots da rota

Erro observado:

- constraint `route_order_items_route_order_line_unique`.

Causa:

- reinserção do snapshot sem limpar/recalcular do jeito certo.

Situação:

- fluxo de snapshot foi ajustado e passou a funcionar nos testes do usuário.

### 4. Recursão/stack depth em trigger de sincronização

Erro observado:

- `stack depth limit exceeded`.

Causa:

- uma função de sync atualizava `order_returns`, que disparava trigger, que chamava a mesma sync de novo.

Correção:

- a lógica foi reorganizada até a migration passar por completo.

### 5. Criação de coleta falhando por `orders_order_id_erp_key`

Erro observado:

- ao tentar criar coleta, o sistema tentava gerar um `order_id_erp` já existente.

Causa:

- o vínculo entre evento de devolução e pedido/rota de coleta ainda não estava centralizado corretamente.

Correção:

- uso da função `register_order_return_pickup(...)`;
- frontend passou a registrar o vínculo de forma explícita.

### 6. Coleta criada continuava aparecendo em “Coletas Pendentes”

Sintoma:

- a coleta era criada com sucesso;
- a rota aparecia em “Rotas de Coleta”;
- mas o evento continuava na lista de “Coletas Pendentes”, com botão “Criar Coleta”.

Causa:

- o retorno processado estava com `requires_pickup = true`, mas sem `pickup_created_at / pickup_order_id / pickup_route_id` preenchidos ou refletidos corretamente no frontend/estado.

Correção:

- migration `20260707164000_manage_return_pickup_links.sql`
- fluxo de criação passou a gravar esse vínculo e recalcular o pedido.

### 7. Comportamento inconsistente entre primeira e segunda devolução do mesmo pedido

Sintoma:

- no primeiro item devolvido, o pedido apareceu em “Bloqueados” e gerou coleta;
- no segundo item devolvido do mesmo pedido, ele foi para “Coletas Pendentes”.

Leitura correta:

- quando existe devolução após entrega e ainda há evento aguardando coleta, o comportamento esperado precisa ser consistente;
- o sistema deve refletir a fase operacional correta, não alternar de forma confusa entre bloqueado e coleta pendente.

Esse ponto motivou o refinamento final da tela e do modelo por evento.

---

## O que foi validado com sucesso pelo usuário

### Estrutura por item e modo sombra

O usuário validou:

- banco novo com dados importados;
- shadow balances corretos;
- consulta mostrando itens estruturados;
- dados de diagnóstico consistentes.

### Rota mostrando itens estruturados

Em rota de entrega:

- os itens aparecem por produto;
- item devolvido antes da rota pode ficar visível como bloqueado com saldo zero;
- item válido segue disponível para entrega.

### Geração de coleta por item

O usuário validou casos reais simulados no banco de teste:

- pedido 139950:
  - devolução parcial de item após entrega;
  - coleta gerada e impressa com um único item.

- pedido 139928:
  - dois itens entregues;
  - depois devolução do primeiro item;
  - criação da primeira coleta ok;
  - depois devolução do segundo item;
  - criação da segunda coleta ok;
  - no final, uma coleta para a lavadora e outra para o fogão.

Isso confirma que:

- duas devoluções do mesmo pedido podem gerar duas coletas diferentes;
- o modelo por evento de devolução faz sentido para a operação do usuário.

---

## Ajustes recentes na tela de consulta de pedido

Arquivo alterado:

- `src/pages/admin/OrderLookup.tsx`

O que já foi feito:

### 1. Buscar eventos de devolução processados com metadados de coleta

Agora a tela consulta `order_returns` processados do pedido e enriquece:

- rota de coleta vinculada;
- pedido de coleta vinculado.

### 2. Consolidar o tipo real de devolução com base no saldo dos itens

Foi criada lógica para derivar:

- se existe devolução;
- se ainda há itens com saldo disponível;
- se todos os itens zeraram.

Com isso a tela deixa de depender só de `orders.return_type`.

### 3. Exibir rotas de coleta criadas dentro do card de devolução

No card vermelho da área “Entrega”, passaram a aparecer:

- NF de devolução;
- rotas de coleta criadas como botões clicáveis.

### 4. Limpeza de duplicação

Foi reaproveitada a mesma função de abrir detalhes da rota, evitando lógica duplicada espalhada.

### 5. Build validado

Foi executado:

- `npm run build`

No diretório:

- `/Users/junior/Projetos/solidgo - cópia`

Resultado:

- build passou com sucesso.

---

## Estado atual exato onde paramos

Estamos num ponto em que:

### Backend

- devolução por item está estruturada;
- coleta por evento de devolução está funcionando;
- vínculo entre devolução e coleta está funcionando;
- múltiplas coletas para o mesmo pedido já funcionaram em teste real do usuário.

### Frontend

- a consulta de pedido já melhorou bastante;
- ela já mostra situação por item;
- já mostra devolução registrada;
- já mostra rotas de coleta criadas.

### Mas ainda há refinamentos importantes de UX/regra

O usuário observou um ponto muito relevante:

- quando todos os itens do pedido já foram devolvidos, visualmente ainda apareceu “Devolução parcial” em algumas partes da tela;
- isso está conceitualmente errado para o usuário, porque o pedido já ficou totalmente devolvido no saldo;
- ele também sugeriu mostrar melhor a rota de coleta criada e, idealmente, facilitar o acesso à impressão da NF daquela rota/coleta.

Esse é exatamente o ponto em que a conversa parou.

---

## O que ainda falta fazer

## 1. Refinar a semântica visual de “devolução parcial” vs “devolução total”

Hoje a regra visual ainda precisa ser unificada.

O comportamento esperado precisa ficar assim:

- se ainda existe ao menos um item com saldo disponível:
  - mostrar `Devolução parcial`

- se todos os itens já estão devolvidos e saldo do pedido zerou:
  - mostrar `Devolução total`

Isso precisa ser consistente em:

- badge do pedido;
- card vermelho de devolução;
- mensagem auxiliar;
- possíveis listas de bloqueados/coletas pendentes.

## 2. Melhorar o card “Devolução registrada” na consulta de pedido

Sugestão validada pelo usuário:

- mostrar melhor a coleta criada;
- idealmente exibir:
  - rota de coleta criada;
  - acesso rápido à impressão da NF/rota relacionada.

Hoje já mostra as rotas criadas como botões, mas ainda pode evoluir.

## 3. Limpar linguagem técnica residual

Na consulta de pedido ainda existem traços de linguagem de diagnóstico, mesmo que já tenha melhorado.

Continuar simplificando:

- evitar termos internos para usuário final;
- manter “verdade operacional” sem expor jargão técnico.

## 4. Validar comportamento das listas operacionais

Conferir e uniformizar:

- `Bloqueados`
- `Coletas Pendentes`
- `Rotas de Coleta`

Pergunta central:

- em que momento um pedido deve sair de “Bloqueados” e entrar só em “Coletas Pendentes”?
- em que momento deve sumir de “Coletas Pendentes” e ficar só em “Rotas de Coleta”?

O usuário percebeu comportamentos diferentes entre o primeiro e o segundo item devolvido do mesmo pedido. Precisamos garantir consistência.

## 5. Endurecer segurança contra over-return

O usuário disse que o ERP, em tese, não deixa acontecer devolução impossível.

Mesmo assim, vale reforçar no sistema:

- impedir que a soma das devoluções de um item ultrapasse a quantidade comprada;
- ou pelo menos registrar divergência forte, sem deixar isso seguir silenciosamente.

Hoje a tela já acusa caso exista `has_over_return`, mas podemos decidir endurecer mais no banco/serviço.

## 6. Escrever uma regra operacional definitiva para múltiplas devoluções do mesmo pedido

Isso agora é requisito real, não hipótese.

Precisamos formalizar:

- cada devolução processada = um evento;
- cada evento pode gerar sua própria coleta;
- o pedido pode continuar com histórico acumulado;
- o status macro do pedido precisa refletir o agregado sem esconder os eventos individuais.

---

## Arquivos principais envolvidos até aqui

### Migrations

- `supabase/migrations/20260707100000_create_item_fulfillment_shadow_foundation.sql`
- `supabase/migrations/20260707113000_create_route_order_item_snapshots.sql`
- `supabase/migrations/20260707123000_automate_partial_return_route_snapshot_sync.sql`
- `supabase/migrations/20260707130000_allow_zero_allocated_for_blocked_route_items.sql`
- `supabase/migrations/20260707143000_sync_pickups_from_processed_returns.sql`
- `supabase/migrations/20260707153000_track_pickups_per_return_event.sql`
- `supabase/migrations/20260707164000_manage_return_pickup_links.sql`

### Frontend

- `src/pages/admin/RouteCreation.tsx`
  - fluxo de criação de coleta/devolução usando vínculo por evento

- `src/pages/admin/OrderLookup.tsx`
  - consulta de pedido
  - resumo de devolução
  - situação dos itens
  - exibição das rotas de coleta criadas

### Documento anterior

- `docs/entrega-por-produto-handoff.md`

Esse documento anterior cobre a fundação macro da entrega por produto.

Este novo handoff cobre especificamente o estado atual da devolução/coleta por item.

---

## Casos reais usados nos testes desta conversa

### Pedido 139922

Usado para validar:

- item devolvido antes da rota;
- rota mostrando item bloqueado com saldo zero e item válido ainda disponível.

### Pedido 139950

Usado para validar:

- devolução parcial após entrega;
- geração de coleta com um item;
- impressão de romaneio/DANFE da coleta.

### Pedido 139928

Usado para validar:

- dois itens entregues;
- primeira devolução de um item;
- primeira coleta criada;
- segunda devolução do outro item;
- segunda coleta criada;
- necessidade de melhorar a leitura visual para “devolução total” no fim do processo.

---

## Resumo executivo

Se outra janela de contexto assumir daqui, o estado correto para continuar é:

1. A base de dados já suporta devolução por item.
2. A base já suporta múltiplas coletas para o mesmo pedido, uma por evento de devolução.
3. O vínculo entre devolução e coleta já existe e funciona.
4. O frontend já foi parcialmente adaptado.
5. O principal trabalho restante agora é de consistência operacional + UX:
   - consolidar parcial vs total;
   - deixar claro quando a coleta foi gerada;
   - melhorar a consulta de pedido;
   - garantir que listas de bloqueados/coletas/rotas reflitam o estado correto sem ambiguidades.

---

## Próximo passo recomendado

Ao retomar em outra janela, começar por aqui:

1. abrir `src/pages/admin/OrderLookup.tsx`;
2. revisar a lógica visual de:
   - `returnScopeSummary`
   - `getReturnFlowSummary`
   - card vermelho de devolução;
3. validar com o caso do pedido `139928`:
   - dois itens com `Saldo disponível: 0`
   - dois itens com `Devolvido: 1`
   - duas coletas já criadas
4. ajustar a tela para exibir isso como `Devolução total`, sem perder o histórico dos dois eventos.

Se depois disso a UX ficar boa e consistente, essa frente de devolução estará perto de ser considerada fechada.

---

## Atualização posterior — reconciliação no encerramento da rota

Foi criado um banco PostgreSQL local isolado e uma suíte reproduzível em:

- `tests/sql/return-flow/`

Comando para repetir os testes:

- `tests/sql/return-flow/run-local.sh`

Nova migration:

- `supabase/migrations/20260707180000_reconcile_returns_on_route_completion.sql`
- `supabase/migrations/20260707183000_harden_return_quantities_and_pickup_links.sql`
- `supabase/migrations/20260708100000_block_route_start_with_fully_returned_orders.sql`

Regra consolidada:

- enquanto a rota está aberta, a devolução bloqueia e avisa, mas não entra em coletas pendentes;
- ao finalizar, pedido/item efetivamente entregue pode gerar coleta;
- pedido retornado pelo motorista não gera coleta;
- item devolvido antes da rota ou bloqueado durante a rota não gera coleta quando somente outro item foi entregue;
- sincronização offline e ações de desfazer chamam uma reconciliação final para não apagar a devolução fiscal;
- múltiplos eventos continuam gerando coletas independentes.
- devolução acima da quantidade comprada vira divergência auditável e não altera saldo;
- cada evento aceita somente seu próprio pedido e sua própria rota de coleta;
- duas tentativas simultâneas não duplicam a coleta;
- excluir rota, pedido ou ligação operacional limpa o vínculo inteiro e devolve o evento à fila;
- falha intermediária na criação da coleta tenta remover os artefatos criados naquela tentativa;
- pedido de coleta órfão antigo pode ser recuperado com segurança em nova tentativa.
- rota pendente com pedido totalmente devolvido não pode ser iniciada;
- rota com devolução parcial ainda pode iniciar se houver produto entregável.

Arquivos de frontend ajustados:

- `src/components/DeliveryMarking.tsx`
- `src/utils/offline/backgroundSync.ts`

Validações executadas na revisão final:

- 28 afirmações SQL passaram em três bancos locais isolados;
- fluxo normal, atualização de dados antigos e concorrência foram testados separadamente;
- as migrations `180000` e `183000` foram reaplicadas sem erro para verificar idempotência operacional;
- `npm run build` passou;
- nenhuma migration foi aplicada automaticamente no Supabase remoto;
- nenhum commit foi criado.

Ordem para aplicação manual no Supabase de teste, considerando que as migrations
até `20260707164000` já foram executadas:

1. `20260707180000_reconcile_returns_on_route_completion.sql`
2. `20260707183000_harden_return_quantities_and_pickup_links.sql`
3. `20260708100000_block_route_start_with_fully_returned_orders.sql`
