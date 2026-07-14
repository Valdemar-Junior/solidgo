# Geração da Nota Fiscal (DANFE) via XML

Como o sistema gera a DANFE (PDF da nota) em **base64** e salva na tabela `orders`, a partir do **XML** que vem na importação do pedido.

## Arquitetura ATUAL (endpoint no próprio projeto)

A geração de DANFE foi trazida **pra dentro do projeto** (antes era orquestrada pelo n8n). Agora:

```
Importar pedidos (tela Importação)
   │  salva orders.xml_documento = XML da NF-e            (OrdersImport.tsx)
   ▼  (em segundo plano, logo após salvar)
generateDanfeInBackground()  →  pra cada pedido com XML:
   │  POST /api/danfe  { xml }   (mesma origem, autenticado — sem n8n, sem CORS)
   ▼
Endpoint api/danfe.ts
   │  1. XML → HTML   (api/_lib/danfe-html.ts — parse + template + código de barras; leve)
   │  2. HTML → PDF   (POST pro Gotenberg no seu VPS — a parte pesada)
   ▼  devolve { danfe_base64, meta }
App salva: orders.danfe_base64 + danfe_gerada_em         (sempre no ambiente CERTO, automático)
```

**Por que ficou melhor:**
- **Sem n8n no caminho da DANFE** → acabou o risco de "salvar no ambiente errado" (o app salva no banco onde ele já está logado).
- **Sem chave `service_role` no n8n** → o segredo mais perigoso saiu de lá.
- **Sem CORS** — o app chama uma URL do próprio projeto (`/api/danfe`).
- **Um repositório, um deploy** → manutenção num lugar só.
- **Endpoint autenticado** (`requireUser`) — não é uma API aberta na internet.
- **Gotenberg continua no VPS** (motor de PDF pesado; a serverless só orquestra).

## Peças

| Peça | Onde | Papel |
|---|---|---|
| `orders.xml_documento` | banco | XML da NF-e vindo do ERP (salvo na importação) |
| `orders.danfe_base64` / `danfe_gerada_em` | banco | o PDF da DANFE em base64 (resultado) + quando |
| `api/danfe.ts` | endpoint | orquestra: XML→HTML→(Gotenberg)→PDF base64; exige login |
| `api/_lib/danfe-html.ts` | lib | **converte XML → HTML** (`processXmlToHtml`) |
| `generateDanfeInBackground` | `OrdersImport.tsx` | após importar, chama `/api/danfe` por pedido (em lotes de 4) e salva |
| **Gotenberg** | VPS (externo) | HTML → PDF |

## Logo da DANFE (Configuração de NF na tela)

O logo da empresa saiu do n8n e virou **configuração**: em **Configurações → Geral → "Configuração de NF (DANFE)"**, o admin **envia a imagem** (PNG/JPG) e o sistema guarda o base64 em `app_settings` (key `nf_config`, campo `logoBase64`, **sem** o prefixo `data:image`).

- O endpoint `/api/danfe` puxa esse logo automaticamente (a não ser que o chamador mande um `logoBase64` explícito no corpo).
- **Facilita replicar pra outra empresa:** cada instalação tem seu próprio `nf_config` — troca o logo na tela, sem tocar em código nem no n8n.

## Configuração (variáveis de ambiente na Vercel)

- **`GOTENBERG_URL`** — a URL do seu Gotenberg no VPS. Pode ser a base (o endpoint completa com `/forms/chromium/convert/html`) ou a URL completa de conversão.
- `SUPABASE_URL` e `SUPABASE_SERVICE_KEY` — já usados pelos outros endpoints (auth). Não precisa mexer se já estão configurados.

> Nada de chave de banco no n8n; nada de segredo no código. O Gotenberg vai por variável de ambiente.

## Detalhes de comportamento

- Roda **em segundo plano** após a importação e **loga no console** (`[Import] ...`). Se um pedido falhar, os outros seguem.
- Pedido **sem XML válido** é pulado.
- Processa em **lotes de 4** (não sobrecarrega Vercel/Gotenberg em importações grandes).
- Depende do navegador ficar aberto alguns segundos após importar (a geração é feita a partir da tela). Pra lotes muito grandes, é normal levar um tempo — cada pedido é uma DANFE.

## Onde a DANFE é gerada no app (tudo via `/api/danfe`)

O endpoint `/api/danfe` gera a DANFE de **qualquer XML** — nota de **venda** OU de **devolução** (é "burro" quanto ao tipo). Helper compartilhado: `src/utils/danfe/generateDanfe.ts` (`generateDanfeBase64(xml)`). Pontos que usam:
1. **Importação** (`OrdersImport.tsx`) — DANFE de venda, em segundo plano.
2. **Rota → "Gerar Nota Fiscal"** (RouteCreation) — venda e devolução.
3. **Rota → "Gerar DANFE individual"** (por pedido) — venda e devolução.

### Venda × Devolução: quem escolhe o XML e onde salva

O tipo é decidido **ANTES** de chamar o endpoint, pela **rota**: `isCollectionRouteName(nome)` (rota que começa com `COLETA-` = devolução). A seleção do XML (função `getXml` e o botão individual em RouteCreation):

| Tipo de rota | XML usado | Onde salva |
|---|---|---|
| Normal (venda) | `orders.xml_documento` | `orders.danfe_base64` |
| Coleta (devolução) | `orders.return_nfe_xml` (fallback: `fetchPickupSourceReturnXmlMap` — pega o XML de devolução do pedido de origem por `order_id_erp`) | `orders.return_danfe_base64` |

Ou seja: no fluxo de devolução entra o **XML da devolução**, nunca o da venda. O `/api/danfe` só recebe o XML já escolhido.

### Reusa se já existe (não regera à toa)

Antes de gerar, o app **consulta se a DANFE já existe** (base64 salvo no pedido, começando com `JVBER`):
- **Botão individual:** se já existe → abre a salva e para (**não** chama o endpoint). Só gera se faltar.
- **Botão da rota inteira:** se **todos** já têm DANFE → só junta as existentes e abre; chama o endpoint **só** pros que faltam.

Economiza tempo e não sobrecarrega o Gotenberg.

## Migração / limpeza (quando validar em produção)

- Os workflows **`gera_nf` E `gera_nf_devolucao` do n8n** deixam de ser usados pela DANFE — podem ser **desativados** depois de validar (o app gera as duas via `/api/danfe`).
- A API antiga (`danfe_generation-main`, projeto Vercel separado) pode ser **aposentada** — o conversor foi portado pra `api/_lib/danfe-html.ts`. O `danfe.lojaodosmoveis` também sai (o HTML é gerado dentro do projeto).
- O **Gotenberg (VPS) continua** — é a única peça externa que fica.

## Próxima fase: polir o LAYOUT

O conversor foi portado **como estava** (funciona). Os ajustes de **quebra de página / alinhamento** que incomodam são quase todos **CSS** em `api/_lib/danfe-html.ts` — dá pra melhorar iterando com preview visual, sem reescrever o parser do XML.
