# Brechas da retirada por item — análise pré-produção

Análise do fluxo completo (retirada → fila → rota → motorista → consulta → relatórios),
feita antes de aplicar em produção. Cada item tem: **o que é**, **risco real**, **status**.

## ✅ Já corrigido nesta rodada

1. **Motorista offline entregando item já retirado** (`backgroundSync.ts`)
   Se o item era retirado no balcão *depois* que o motorista carregou a rota offline, ao
   sincronizar o app marcava o item como entregue. Agora a sincronização **pula item cancelado
   por retirada** (guarda anti-entrega-dupla).

2. **Casamento frágil do item retirado** (tela do gerente)
   A retirada do gerente gravava o item sem o `order_item_id` (só sku+local). Agora grava o
   **id real** do item, deixando o casamento estável (não depende de normalização de texto).

3. **Relatório de retiradas mostrava o pedido inteiro** (`ReportsWithdrawals.tsx`)
   Numa retirada parcial, o relatório listava todos os itens do pedido. Agora usa o **snapshot
   real dos itens retirados**.

4. **Liberação de saída de loja "zerava" numa retirada parcial** — **(era prioridade ALTA)**
   `sync_store_release_for_order` marcava a liberação do pedido inteiro como "não se aplica" com
   qualquer retirada. Corrigido (migration `20260710040000`): só zera na retirada do **pedido
   inteiro**; na parcial, os itens que ficaram **continuam exigindo liberação**, e o item retirado
   deixa de exigir. Coberto por teste SQL (SR5/SR6).

5. **Marcação de retirada idempotente** (`pickupCore.ts`)
   `markItemsPickedUp` agora ignora item já retirado (não duplica se rodar de novo/retry).

6. **Várias retiradas por pedido** — **(era brecha C)**
   `order_withdrawals` era 1 linha por pedido (upsert) → 2ª retirada sobrescrevia a 1ª. Agora é
   **1 registro por evento** (migration `20260710050000` remove o UNIQUE; `pickupCore` faz insert).
   A Consulta lista **cada retirada com seu próprio comprovante reimprimível** (e o comprovante
   agora sai só com os itens **daquela** retirada). Teste SQL SR7.

## ⚠️ Recomendado corrigir antes de uso pesado (decisão do dono)

### B. Re-importação pode "perder" a retirada — **prioridade média (mitigado)**
Se o ERP re-importa o pedido e muda sku/local/kit de um item retirado, o item interno é recriado
com id novo e a retirada pode deixar de casar → o item volta a ser entregável (risco de entrega
dupla). A correção 2 acima reduz isso (grava id real), mas o caso de troca de sku/local no ERP
ainda pode escapar.
- **Correção:** re-apontar as retiradas "órfãs" após a re-sincronização (ou casar por sku+local
  de forma imutável).

### C. Retirada em locais diferentes por gerentes diferentes se sobrescreve — **prioridade média**
A retirada é gravada como **1 linha por pedido**. Se dois gerentes (dois locais) retiram partes
em momentos diferentes, a segunda retirada **sobrescreve** o registro da primeira (perde quem
retirou o quê e o comprovante persistido da primeira).
- **Correção:** permitir **várias linhas de retirada por pedido** (1 por evento), em vez de uma só.

### D. Sem transação / sem idempotência — **prioridade média (robustez)**
A retirada é uma sequência de escritas separadas (retirada → marca item → cancela na rota →
status). Se falhar no meio, fica estado parcial. E duas submissões concorrentes podem criar
marcações duplicadas.
- **Correção estrutural:** empacotar tudo num único procedimento transacional e idempotente no
  banco (fecha C, D e boa parte de B de uma vez).

## 🟡 Menores / documentados (baixo risco)

- **Retirada depois da rota já finalizada:** o item retirado não é removido da rota já concluída
  (fica no histórico dela). Não causa entrega dupla (a re-rota já esconde o retirado), só higiene.
- **Devolução no ERP de um item já retirado:** o sistema aceita os dois estados sem alertar.
  Raro (ERP devolver algo retirado no balcão).
- **Montagem de item com 2 unidades do mesmo sku, retirando 1:** a retirada gera montagem das 2.
  Não duplica no total (a montagem da rota desconta), mas cria a montagem cedo demais.
- **Gerente pode ver item já entregue como "disponível pra retirar":** usa a lista crua do pedido;
  o ideal é usar o saldo (como a roteirização faz). Já protegido contra re-retirar item retirado.
- **Desfazer entrega no motorista** reseta o marcador "cancelado" pra "pendente" — não reativa a
  entrega (a quantidade fica 0), mas perde o marcador. Preservar por segurança.

## Cobertura de testes

- **Lógica (vitest):** 54 testes — inclui casamento item↔retirada (`pickupCore.test.ts`) e a fila
  escondendo retirados (`queueLogic.test.ts`).
- **Banco (SQL massivo):** 47 checagens PASS / 0 BUG — 4 cenários novos de retirada (SR1–SR4)
  cobrindo: saldo desconta retirado, snapshot da rota exclui retirado, não re-enfileira, montagem
  do item retirado.
