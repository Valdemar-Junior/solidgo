# Rotacionar a chave `service_role` da PRODUÇÃO (passo a passo)

> Guia pra trocar a chave mais poderosa do banco de **produção** por uma nova, sem derrubar o sistema. Fazer com calma, em horário de pouco movimento. **Não é emergência** — é higiene de segurança.

## Regra de ouro (a ordem que evita susto)

**CRIAR a nova → TROCAR em todos os lugares → TESTAR → só então REVOGAR a velha.**

Enquanto você não revoga, a chave velha continua funcionando. Isso é sua rede de segurança: se algo quebrar, é só voltar pra velha. **Nunca revogue antes de testar.**

---

## Onde a chave de produção é usada (os 3 sistemas)

A `service_role` de produção vive em **três lugares**. Todos precisam receber a chave nova:

### 1. Vercel — funções `/api/*`
Variável **`SUPABASE_SERVICE_KEY`** (escopo **Production**). Usada por:
- `api/_lib/auth.ts` (o "porteiro", usado por quase todas)
- `api/danfe.ts`, `api/delete-user.ts`, `api/delete-users-bulk.ts`, `api/reset-password.ts`
- `api/delivery-proof.ts`, `api/geocode-order.ts`, `api/geocode-route.ts`, `api/create-admin.ts`

⚠️ **Pegadinha:** o arquivo `api/webhook-envia-grupo.ts` usa a chave com **outro nome**: **`SUPABASE_SERVICE_ROLE_KEY`**. Se essa variável existir no Vercel, troque as **duas**.

### 2. Supabase Edge Functions
Rodam dentro do Supabase (MDF-e e criação de usuário): `create-user`, `emit-mdfe`, `cancel-mdfe`, `close-mdfe`, `refresh-mdfe`, `auto-close-route-mdfe`. Elas pegam a chave de um jeito próprio do Supabase — **conferir junto** se precisam de atualização manual (depende de a chave nova ser "secret key" nova ou rotação do JWT).

### 3. n8n  ⚠️ o mais fácil de esquecer
Os fluxos que gravam na **produção** têm chave **chumbada** nos nós (ex.: "SALVA NO SUPABASE", importar pedidos, atualizar status). Se esquecer o n8n, **param de entrar pedidos novos**. Abrir cada nó de conexão com o Supabase e trocar.

---

## Passo a passo

### Passo 0 — Escolher o método (no Supabase)
- **Recomendado — "Secret key" nova:** em **Settings → API Keys**, criar uma **nova secret key** (`sb_secret_...`) e depois revogar a `service_role` legada. **Não desloga usuários.**
- **Evitar — regenerar o "JWT Secret":** mata `anon` E `service_role` de uma vez e **desloga todo mundo**. Só em caso de vazamento real.

### Passo 1 — Criar a chave nova
No painel do Supabase (projeto de **produção**, ref `fjbqpmpvnfczbjzkgbjr`): criar a nova secret key. **Não revogar nada ainda.** Copiar a chave nova (guardar com cuidado — é segredo).

### Passo 2 — Trocar no Vercel (produção)
- Settings → Environment Variables → editar **`SUPABASE_SERVICE_KEY`** (escopo Production) → colar a chave nova → salvar.
- Se existir **`SUPABASE_SERVICE_ROLE_KEY`**, trocar também.
- **Reimplantar a produção** pra pegar o valor novo.

### Passo 3 — Trocar nas Edge Functions
Conferir se as functions de MDF-e/create-user precisam da chave manualmente (Supabase → Edge Functions → Secrets). Atualizar se preciso.

### Passo 4 — Trocar no n8n
Abrir os fluxos de produção, achar as conexões com o Supabase, trocar a chave pela nova. Salvar e ativar.

### Passo 5 — TESTAR (com a velha ainda viva)
Conferir que tudo funciona na produção:
- [ ] Login no sistema
- [ ] Gerar um DANF-e
- [ ] Importar um pedido (fluxo do n8n)
- [ ] Atualizar status / pedido devolvido (n8n)
- [ ] Emitir/consultar MDF-e
- [ ] Apagar/criar usuário e resetar senha (as telas de admin)

### Passo 6 — Revogar a velha
Só depois que **tudo** acima passou: no Supabase, **revogar** a `service_role` antiga. Pronto — chave rotacionada.

---

## Se algo quebrar (rollback)
Antes do Passo 6, é só **voltar a chave velha** nos lugares que você trocou (Vercel/n8n) e reimplantar. Como a velha ainda não foi revogada, volta a funcionar na hora.

## Observações
- A **`anon` não precisa rotacionar** — é pública por natureza (já aparece no navegador).
- O maior ganho de segurança é ter **menos cópias** da chave espalhadas. Enquanto ela seguir chumbada no n8n, o risco continua ali — trazer os processos pra dentro do projeto reduz isso de verdade.
- **Banco de teste** (`lbidznhkhtwamgaexgyy`) é outro projeto, com chave própria — rotacionar produção não mexe nele, e vice-versa.
