# Setup de uma nova loja (nova instância)

O SolidGo é **single-tenant**: cada loja é uma **instância isolada** — banco (Supabase) próprio + deploy (Vercel) próprio, com o **mesmo código**. Os dados de uma loja **nunca** se misturam com os de outra.

> Isso é uma vantagem: isolamento total (privacidade/LGPD). O custo é manutenção por instância (ver o fim).

## Pré-requisitos
- Uma conta **Supabase** (plano **Pro** recomendado pra ter backup diário).
- Acesso ao **Vercel** (deploy).
- **Acesso ao ERP da loja nova** — se for Solidus com banco réplica, é copiar-e-trocar o n8n (passo 8); se for outro ERP, exige análise.
- O **dump do schema** da produção atual (só estrutura). Gere uma vez, depois de aplicar todas as migrations em produção:
  ```bash
  pg_dump "CONNECTION_STRING_PRODUCAO" --schema-only -n public --no-owner --no-privileges > schema_template.sql
  ```
  ⚠️ **`--schema-only`** — SÓ a estrutura. **Nunca** os dados (senão você joga os pedidos/clientes de uma loja na outra = erro grave + LGPD).

## Passo a passo

**1. Criar o banco (Supabase da loja nova)**
- Cria um projeto novo no Supabase.
- No **SQL Editor**, cola e roda o `schema_template.sql` (a estrutura). Nasce um banco **vazio com a estrutura certa**.

**2. Pegar as chaves do banco novo**
- Supabase → **Settings → API**: anota a **Project URL**, a **anon key** e a **service_role key**.

**3. Criar o deploy (Vercel)**
- Novo projeto na Vercel apontando pro **mesmo repositório** do GitHub.

**4. Configurar as variáveis de ambiente (Vercel → Settings → Environment Variables)**
| Variável | Valor |
|---|---|
| `VITE_SUPABASE_URL` | Project URL da loja nova |
| `VITE_SUPABASE_ANON_KEY` | anon key da loja nova |
| `SUPABASE_URL` | Project URL da loja nova (endpoints) |
| `SUPABASE_SERVICE_KEY` | service_role key da loja nova (endpoints) |
| `GOTENBERG_URL` | o Gotenberg (pode ser o mesmo VPS ou um dedicado) |

**5. CSP (segurança) — já está portável**
- O `vercel.json` aceita **qualquer** Supabase (`*.supabase.co`), então **não precisa mexer** nele por causa do banco.
- **Exceção:** se a loja nova usar um **n8n em outro domínio**, adicione esse domínio no `connect-src` do `vercel.json` (uma linha). O Lojão usa `n8n.lojaodosmoveis.shop`; outra loja com n8n próprio precisa do domínio dela ali. *(Melhoria futura: rotear as chamadas de n8n pelo backend pra nem precisar dessa linha.)*

**6. Fazer o deploy** — a Vercel publica. Já dá pra abrir o app.

**7. Criar o admin e configurar na tela**
- Cria o **usuário admin** da loja nova (no banco / fluxo de setup).
- Em **Configurações**: sobe o **logo da NF**, define os **locais de estoque** (liberação de loja), preenche os **webhooks** (`webhook_settings`), prazos, etc. Tudo isso é **por loja**.

**8. Integração com o ERP da loja nova**
- Todo o **importar pedidos** e **puxar devolvidos** depende do **ERP deles**.
- **Loja Solidus com "banco réplica"** (caso comum, como o Lojão): é **copiar-e-trocar**, não reintegrar do zero. **Copia os fluxos de ponte do n8n** e troca 3 coisas:
  1. credencial do nó **Postgres** → banco réplica do Solidus **deles**;
  2. credencial dos nós que gravam no **Supabase** → banco **novo**;
  3. **webhooks** → e aponta o `webhook_settings` do banco novo pros webhooks do n8n deles.
- **Só precisa copiar a PONTE** (importar pedidos + puxar devolvidos). Os fluxos de **DANFE do n8n NÃO precisam ir** — a DANFE agora é gerada pelo app (`/api/danfe`). Fluxo mais enxuto.
- **Infra (o único ponto de atenção):** o banco réplica do Solidus deles também costuma ser **liberado por IP fixo**. Então o n8n da loja nova roda de um **IP liberado pra eles** (computador deles ou VPS liberada pro CNPJ deles). O fluxo é o mesmo — muda **de qual IP** roda. Ver [n8n-fluxos-e-desmonte.md](n8n-fluxos-e-desmonte.md).
- **Outro ERP (não-Solidus):** aí sim muda a integração — exige análise por cliente.

## Checklist rápido
- [ ] Supabase novo criado + schema aplicado (só estrutura)
- [ ] Chaves anotadas (URL, anon, service_role)
- [ ] Deploy Vercel do mesmo repo
- [ ] Env vars setadas (5 variáveis)
- [ ] (Se n8n em outro domínio) domínio adicionado no CSP
- [ ] Admin criado
- [ ] Configurações na tela (logo, locais, webhooks)
- [ ] Integração com o ERP da loja funcionando

## Manutenção (o custo do single-tenant)
Quando você melhorar o sistema, cada loja precisa:
- **Código:** subir o deploy (mesmo repo → cada projeto Vercel atualiza).
- **Banco:** rodar as **migrations novas** no Supabase **de cada loja** (na mesma ordem).

Pra **poucas lojas**, isso é tranquilo e mais seguro (dados isolados). Se um dia virar **muitas**, aí vale avaliar migrar pra **multitenant** — mas é uma reforma grande, decisão pro futuro.
