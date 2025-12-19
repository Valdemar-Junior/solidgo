# Planejamento: Rastreamneto de Pedidos para Clientes (Customer Order Tracking)

## Objetivo
Permitir que o cliente final acompanhe o status do seu pedido através de uma página pública, utilizando um código de rastreio único enviado via WhatsApp.

## 1. Banco de Dados e Segurança

### Adicionar Coluna de Rastreio
Adicionar uma coluna `tracking_code` na tabela `orders`.
- **Tipo:** TEXT
- **Unique:** SIM
- **Indexed:** SIM (para busca rápida)
- **Formato Sugerido:** `LM-{ORDER_ID_ERP}-{RANDOM_4_DIGITS}` (Ex: LM-98765-AB12). Isso torna o código difícil de adivinhar.

### Segurança (Acesso Público)
Como a tabela `orders` é protegida e não queremos deixá-la pública:
- Criaremos uma **Postgres Function (RPC)** chamada `get_order_status_public`.
- **Entrada:** `tracking_code` (string).
- **Saída:** JSON contendo apenas dados não sensíveis:
    - Status (Ex: "Em separação", "Saiu para entrega", "Entregue").
    - Data da última atualização.
    - Cidade/Bairro de destino (apenas para confirmação visual).
    - Histórico simplificado (Data de compra, Data de saída para entrega).
- Essa função será executada com `SECURITY DEFINER`, permitindo que usuários anônimos consultem o status sem ter acesso direto à tabela de pedidos.

## 2. Geração do Código (Processo de Importação)

### Atualizar `OrdersImport.tsx`
- No momento da importação (leitura da planilha/ERP), gerar o `tracking_code` para cada novo pedido.
- Salvar este código no banco junto com o pedido.

### Migração de Dados (Opcional)
- Criar um script para gerar códigos para pedidos que já estão no sistema, caso queira disponibilizar rastreio para o passado.

## 3. Página de Rastreio (Frontend Público)

### Mapeamento de Rota (`App.tsx`)
A página será **interna à aplicação** (React), mas configurada como uma rota **pública**, fora do bloqueio de login (`ProtectedRoute`).
- **Rota:** `/rastreio`
- **Exemplo Real:** `https://solidgo.lojaodosmoveis.shop/rastreio`
- **Acesso:** Livre (qualquer pessoa com o link).
- **Dados:** A página não acessará o banco diretamente via client Supabase normal (que exige login), mas sim consumirá a **RPC Public Function** que definimos acima. Isso garante que, mesmo sem login, a segurança seja mantida.

### Estrutura da Página (White Label)
Embora a URL seja do sistema logístico (`app.solidgo...` ou similar), a **identidade visual será 100% da Loja**. O cliente não deve se sentir em um sistema de terceiros.

1.  **Header:** Apenas a Logo do **Lojão dos Móveis**. Nenhuma menção ao SolidGO.
2.  **Cores:** Usar a paleta de cores da loja (ex: Vermelho/Branco se for o caso).
3.  **Rodapé:** "Entregue por Lojão dos Móveis" (ou a transportadora oficial).
4.  **Conceito:** O SolidGO atua aqui como a "Transportadora Digital". É o mesmo comportamento de quando compramos online e recebemos um link dos Correios ou Jadlog. O cliente entende que é o parceiro logístico.

## 4. Integração com WhatsApp

### Atualizar Botão de Envio
- No componente que dispara a mensagem (hoje `RouteCreation` ou `DeliveryCard`), incluir o link no texto padrão.
- **Mensagem Exemplo:**
  > "Olá [Nome], seu pedido no Lojão dos Móveis já está conosco! Acompanhe a entrega pelo link: https://solidgo.lojaodosmoveis.shop/rastreio?codigo=LM-12345-X9X9"

## Passos para Execução Futura
1.  [DB] Criar coluna e função RPC no Supabase.
2.  [FRONT] Atualizar lógica de importação para gerar códigos.
3.  [FRONT] Criar página `/rastreio`.
4.  [FRONT] Atualizar templates de mensagem de WhatsApp.
