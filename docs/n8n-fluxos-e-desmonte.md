# n8n — mapa dos fluxos e estratégia de "desmonte"

Contexto de infra: o SolidGo se integra ao ERP **Solidus Smart**, que **só libera acesso ao banco por um IP fixo**. Hoje o **n8n** roda num **computador físico** dentro da rede liberada e faz essa ponte. Este documento mapeia o que o n8n faz, separa o que **precisa** desse IP do que é só **processamento**, e registra o plano de ir tirando o n8n aos poucos.

## Os dois papéis do n8n

1. **Ponte com o Solidus (precisa do IP fixo)** — buscar dados no ERP. **Não dá pra remover**, só **mover** pra outro lugar com IP liberado (ex: uma VPS, pedindo pro Solidus liberar o IP dela).
2. **Processamento (não precisa de IP)** — gerar DANFE, salvar no Supabase, transformar dados, mandar mensagem. **Isso pode sair do n8n** e ir pra dentro do app/endpoints.

## Mapa dos fluxos (jul/2026)

| Fluxo (n8n) | O que faz | Precisa do IP Solidus? | Situação |
|---|---|---|---|
| **IMPORTA OS PEDIDOS** | webhook → `executeQuery` no Solidus → devolve os pedidos (com XML) | ✅ **SIM — ponte** | fica |
| **ATUALIZA STATUS (pedidos devolvidos)** | cron (a cada ~5 min) → `executeQuery` puxa devolvidos do Solidus → `SALVA NO SUPABASE` | ✅ **SIM — ponte** (a parte de puxar) | fica |
| **GERA DANFE** | XML da venda → PDF (API HTML + Gotenberg) → salva `danfe_base64` | ❌ não | ✅ **já trazido** (`/api/danfe`) — pode desativar |
| **GERA DANFE (devolução)** | igual, mas nota de devolução → `return_danfe_base64` | ❌ não | ✅ **já trazido** (`/api/danfe`) — pode desativar |
| **ENVIA MENSAGEM AO CLIENTE** (WhatsApp) | avisos de montagem/entrega via API não oficial | ❌ não | **desativado** (número caiu — API não oficial) |
| **ENVIA MENSAGEM NO GRUPO** (WhatsApp) | manda rota no grupo | ❌ não | processamento — pode sair |
| **IMPORTA AVULSO** | webhook → `executeQuery` insere pedido avulso | depende (se grava no Supabase, não precisa) | a avaliar |

Ver detalhes da DANFE em [geracao-nota-fiscal-danfe.md](geracao-nota-fiscal-danfe.md).

## O que já saiu do n8n

- **Geração de DANFE (venda e devolução)** — feita agora pelo endpoint `/api/danfe` do próprio projeto (XML→HTML→Gotenberg→PDF), com o app salvando no banco. Fora o Gotenberg (que fica no VPS), não depende mais do n8n. Os dois workflows de DANFE do n8n podem ser **desativados** depois de validar.

## Estratégia (desmonte gradual)

A meta **não** é "remover o n8n" — é **encolher** ele até sobrar só a **ponte com o Solidus**:

1. Trazer os **processamentos** pra dentro do app, um a um (DANFE ✅; depois avulso, mensagens quando voltar com API oficial, etc.).
2. No fim, o n8n faz **só** duas coisas: **importar pedidos** e **puxar devolvidos** do Solidus.
3. **Mover essa ponte pra uma VPS** (mais confiável que o PC físico, que pode desligar/cair a luz) — precisa **pedir ao Solidus pra liberar o IP fixo da VPS**. A ponte pode continuar sendo n8n na VPS, ou um serviço leve (Python/Node) que só faz "busca no Solidus → joga no Supabase".

## Segurança: senhas chumbadas no n8n

Alguns nós do n8n têm **credenciais do Supabase escritas direto** (ex: o nó `SALVA NO SUPABASE` tem um aviso: *"Se resetar a senha do Supabase, trocar aqui também"*; o nó que salvava a DANFE também tinha). Cada processamento que a gente traz pra casa **tira uma dessas credenciais de lá** — o n8n vai ficando mais "burro" e mais seguro. Idealmente, o que sobrar no n8n deve usar **Credenciais** do n8n (não chaves soltas no nó).

## Resumo

- **Fica no n8n (precisa do IP):** importar pedidos + puxar devolvidos do Solidus.
- **Sai do n8n (processamento):** DANFE (✅), WhatsApp (quando voltar), avulso, etc.
- **Próximo salto de confiabilidade:** ponte numa VPS com IP liberado pelo Solidus.
