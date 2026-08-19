# Geração da Nota Fiscal (DANFE)

Como o sistema gera a DANFE (PDF da nota) em **base64** e salva na tabela `orders`, a partir do **XML** que vem do ERP. A orquestração saiu do n8n e passou a ser feita pelo próprio SolidGo.

## Como funciona

```
Tela do SolidGo (importação, rota ou consulta do pedido)
   │  escolhe o XML certo (venda x devolução)
   ▼
generateDanfeBase64(xml)                       (src/utils/danfe/generateDanfe.ts)
   │  POST /api/danfe  { xml }  + token da sessão   (mesma origem — sem CORS, sem CSP)
   ▼
api/danfe.ts   (função da Vercel)
   │  1. exige usuário logado          (requireUser)
   │  2. busca a logo em app_settings  (key 'nf_config')
   │  3. acrescenta a chave DANFE_API_KEY  ← nunca chega ao navegador
   ▼
API DanfeHub  →  XML vira HTML  →  Gotenberg (VPS)  →  PDF
   ▼
{ danfe_base64, meta }  →  a tela salva em orders
```

## Peças

| Peça | Onde | Papel |
|---|---|---|
| `orders.xml_documento` | banco | XML da NF-e de **venda**, vindo do ERP na importação |
| `orders.return_nfe_xml` | banco | XML da NF-e de **devolução** |
| `orders.danfe_base64` / `return_danfe_base64` | banco | o PDF em base64 (resultado) |
| `orders.danfe_gerada_em` | banco | quando foi gerada |
| `src/utils/danfe/generateDanfe.ts` | front | `generateDanfeBase64(xml)` — único ponto de chamada |
| `api/danfe.ts` | endpoint | autentica, resolve a logo, chama o DanfeHub |
| `api/_lib/auth.ts` | lib | `requireUser` / `requireAdmin` — o endpoint não fica aberto na internet |
| **DanfeHub** | VPS (externo) | desenha a DANFE (XML→HTML) e converte em PDF via Gotenberg |

## Configuração (variáveis de ambiente na Vercel)

- **`DANFE_API_KEY`** — chave do cliente, criada na aba Clientes do DanfeHub. **Obrigatória.** Nunca use prefixo `VITE_`: tudo que é `VITE_` vai para o navegador e viraria público.
- `DANFE_API_URL` — opcional. Só se a URL do DanfeHub mudar (o padrão já é a de produção).
- `SUPABASE_URL` e `SUPABASE_SERVICE_KEY` — já usados pelos outros endpoints; servem para validar o login e ler a logo.

## Logo da DANFE

Fica em **Configurações → Logística → "Configuração de NF (DANFE)"**: o admin envia um PNG ou JPG (máx. 1MB) e o sistema guarda o base64 em `app_settings` (key `nf_config`, campo `logoBase64`, **sem** o prefixo `data:image`).

O `/api/danfe` manda essa logo junto em toda chamada, e ela tem prioridade sobre a cadastrada no painel do DanfeHub. Trocar a logo é trocar a imagem na tela — sem mexer em código nem em outro sistema.

## Onde a DANFE é gerada no app

O `/api/danfe` gera a DANFE de **qualquer XML** — venda ou devolução (é "burro" quanto ao tipo). Quem decide o tipo é a tela, **antes** de chamar:

| Situação | XML usado | Onde salva |
|---|---|---|
| Rota normal (venda) | `orders.xml_documento` | `orders.danfe_base64` |
| Rota de coleta (`COLETA-…`) | `orders.return_nfe_xml` (fallback: XML de devolução do pedido de origem) | `orders.return_danfe_base64` |
| Reimpressão de devolução (Consulta do pedido) | `orders.return_nfe_xml` | `orders.return_danfe_base64` |

Pontos que chamam:

1. **Importação** (`OrdersImport.tsx`) — em segundo plano, logo após salvar os pedidos.
2. **Rota → "Gerar Notas Fiscais"** (`RouteCreation.tsx`) — gera só as que faltam e junta com as existentes num PDF só.
3. **Rota → DANFE individual** (`RouteCreation.tsx`) — um pedido.
4. **Consulta do pedido → nota de devolução** (`OrderLookup.tsx`).

## Detalhes de comportamento

- **Reusa se já existe.** Antes de gerar, o app confere se o base64 salvo começa com `JVBER`. Se já existe, abre o salvo e **não** chama o endpoint. O botão da rota só gera as que faltam.
- **Lotes de 4.** Importações grandes viram 4 chamadas simultâneas por vez, para não sobrecarregar Vercel e Gotenberg.
- **Falha isolada.** Se um pedido falhar, os outros seguem. O que falhou fica sem `danfe_gerada_em` e pode ser gerado de novo pelo botão.
- **Prazo de 30 segundos** no endpoint: se o DanfeHub não responder, a resposta é um erro claro (504) em vez de a função morrer por tempo esgotado.
- **Notas antigas mantêm o layout antigo** — o PDF fica guardado no pedido. Só as geradas depois da virada saem no layout novo.

## O que sobrou do n8n

Os workflows **`gera_nf`** e **`gera_nf_devolucao`** não são mais chamados por nenhuma tela e podem ser **desativados no n8n**.

Do lado do SolidGo a limpeza já foi feita: os dois campos saíram de Configurações → Integrações, e a migração `20260819120000_remove_danfe_webhook_settings.sql` apaga as linhas correspondentes de `webhook_settings`.

Isso tira do n8n a chave `service_role` do Supabase que ele usava para salvar a DANFE — o segredo mais perigoso que estava lá.
