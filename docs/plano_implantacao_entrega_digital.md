# Plano de Implementacao: Comprovacao Digital de Entrega (SOLIDGO)

## Objetivo
Implantar comprovacao digital de entrega sem quebrar o que ja funciona em producao, com rollout em duas fases:

1. Mes 1: operacao hibrida (papel + digital).
2. Mes 2: operacao 100% digital (sem papel no motorista).

## Regras de Negocio Ja Definidas
1. O fluxo atual de entrega deve continuar funcionando.
2. A regra de foto continua como hoje: minimo 2 fotos.
3. Novos campos no PWA: nome de quem recebeu e relacao/parentesco.
4. GPS: obrigatorio quando disponivel; se falhar, exigir motivo tecnico e registrar para auditoria.
5. No mes 1, assinatura em papel continua obrigatoria.
6. No mes 2, assinatura em papel deixa de ser usada no motorista.

## Principios Anti-Quebra
1. Mudancas aditivas (sem remover colunas/fluxos existentes no inicio).
2. Controle por feature flags (liga/desliga rapido).
3. Rollout gradual (piloto antes de 100%).
4. Rollback por configuracao na Vercel, sem reverter schema.

## Feature Flags (Vercel)
Configurar em `Project > Settings > Environment Variables`.

| Flag | Mes 1 (Hibrido) | Mes 2 (Sem papel) |
| --- | --- | --- |
| `DELIVERY_PROOF_ENABLED` | `true` | `true` |
| `DELIVERY_PROOF_REQUIRE_RECIPIENT` | `true` | `true` |
| `DELIVERY_PROOF_REQUIRE_GPS` | `false` (com captura e tentativa) | `true` (com excecao tecnica) |
| `DELIVERY_PROOF_BLOCK_ON_ERROR` | `false` | `true` (avaliar no go-live) |

## Modelo de Dados (Novo)
Tabela nova: `delivery_receipts` (prova digital).

Campos planejados:
1. `id` (uuid)
2. `order_id` (uuid)
3. `route_id` (uuid)
4. `route_order_id` (uuid)
5. `delivered_by_user_id` (uuid)
6. `delivered_at_server` (timestamptz)
7. `device_timestamp` (timestamptz)
8. `gps_lat` (numeric)
9. `gps_lng` (numeric)
10. `gps_accuracy_m` (numeric)
11. `gps_status` (text: `ok` / `failed`)
12. `gps_failure_reason` (text, quando falhar)
13. `recipient_name` (text)
14. `recipient_relation` (text)
15. `recipient_notes` (text)
16. `photo_count` (int)
17. `photo_refs` (jsonb, ids/paths das fotos)
18. `network_mode` (text: `online` / `offline`)
19. `device_info` (jsonb)
20. `app_version` (text)
21. `sync_status` (text)
22. `created_at` (timestamptz)

Opcional recomendado:
1. Tabela de eventos `delivery_receipt_events` (auditoria append-only).

## Backlog de Implementacao (Checklist)
Legenda: `Pendente`, `Em andamento`, `Concluido`, `Bloqueado`.

| ID | Task | Status | Entrega Esperada | Criterio de Aceite |
| --- | --- | --- | --- | --- |
| `TASK-01` | Baseline de producao | Concluido | Mapeamento do fluxo atual sem alteracoes | Fluxo de entrega/consulta validado e documentado |
| `TASK-02` | Migration aditiva `delivery_receipts` | Concluido | Nova tabela, indices e constraints | Schema aplicado sem impacto em `orders`/`route_orders` |
| `TASK-03` | RLS e permissoes da nova tabela | Concluido | Politicas de leitura/escrita por perfil | Admin enxerga tudo; motorista grava apenas o proprio registro |
| `TASK-04` | Leitura central de feature flags | Concluido | Arquivo backend para flags | Flags alteram comportamento sem mudar codigo |
| `TASK-05` | Endpoint backend de confirmacao digital | Concluido | Gravacao de `delivery_receipts` em paralelo | Entrega atual continua mesmo com falha no receipt (mes 1) |
| `TASK-06` | PWA: campos de recebedor | Concluido | Nome + relacao no fluxo de "Entregue" | Campos obrigatorios quando flag exigir |
| `TASK-07` | PWA: captura GPS + excecao tecnica | Concluido | Captura `lat/lng/accuracy` e motivo tecnico | Sem GPS, exige motivo tecnico e segue fluxo definido |
| `TASK-08` | Sync offline do comprovante | Pendente | Persistencia local e sincronizacao posterior | Entrega offline sincroniza e grava `delivered_at_server` |
| `TASK-09` | Auditoria de excecoes GPS | Pendente | Lista para admin revisar excecoes | Excecoes visiveis por data, rota e entregador |
| `TASK-10` | PDF de comprovante digital | Concluido | PDF 1 pagina com dados, mapa e fotos | PDF gerado por pedido entregue com layout aprovado |
| `TASK-11` | Piloto controlado (1 equipe) | Pendente | Rollout parcial com monitoramento | Sem regressao critica por 7 dias |
| `TASK-12` | Go/No-Go para operacao sem papel | Pendente | Decisao formal para mes 2 | Metricas minimas atingidas e aprovadas |

## Sequencia Recomendada (Semanas)
1. Semana 1: `TASK-01`, `TASK-02`, `TASK-03`, `TASK-04`.
2. Semana 2: `TASK-05`, `TASK-06`, `TASK-07`, `TASK-08`.
3. Semana 3: `TASK-09`, `TASK-10`, `TASK-11`.
4. Semana 4: avaliacao de metricas e execucao do `TASK-12`.

## Metricas de Qualidade (Gate de Virada para Mes 2)
1. 100% das entregas com `recipient_name`.
2. 100% das entregas com `recipient_relation`.
3. 100% das entregas com `photo_count >= 2`.
4. >=95% com GPS valido; restante com motivo tecnico registrado.
5. Erro de sync <1%.
6. Zero regressao critica no fluxo atual de entrega e consulta.

## Politica de Excecao de GPS
Quando GPS falhar, o app deve exigir um motivo tecnico padronizado:

1. Permissao de localizacao negada.
2. GPS do aparelho desligado.
3. Sinal GPS fraco (timeout).
4. Area interna sem fixacao de satelite.
5. Falha temporaria de app/dispositivo.

Sem motivo tecnico, a entrega nao deve ser concluida quando a regra de GPS estiver obrigatoria.

## Rollback Rapido
1. Desligar `DELIVERY_PROOF_ENABLED` na Vercel.
2. Manter fluxo atual de entrega ativo (sem mexer em schema existente).
3. Investigar logs e corrigir antes de novo rollout.

## Itens Fora de Escopo Nesta Fase
1. Troca completa de geocodificacao para Google.
2. Refatoracao profunda de telas administrativas existentes.
3. Remocao de estruturas antigas antes da estabilizacao.

## Registro de Decisoes
Atualizar esta secao ao longo da implantacao:

1. Data:
2. Decisao:
3. Responsavel:
4. Impacto:
