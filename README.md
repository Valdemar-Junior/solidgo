# Delivery Route Manager - PWA

Um Progressive Web App (PWA) completo para gerenciamento de rotas e entregas, com suporte offline e sincronização em tempo real.

## 🚀 Funcionalidades

### Admin
- ✅ Dashboard com métricas em tempo real
- ✅ Importação de pedidos via webhook (integração com n8n/ERP)
- ✅ Criação e gerenciamento de rotas
- ✅ Atribuição de motoristas e veículos
- ✅ Geração de romaneios em PDF
- ✅ Relatórios e filtros
- ✅ Gerenciamento de motoristas, veículos e conferentes

### Motorista
- ✅ Visualização de rotas atribuídas
- ✅ Marcação de entregas com captura de assinatura
- ✅ Marcação de retornos com motivos
- ✅ Funcionamento offline completo
- ✅ Sincronização automática quando online
- ✅ Interface otimizada para dispositivos móveis

### Técnicas
- ✅ PWA com instalação e funcionamento offline
- ✅ Sincronização de dados em background
- ✅ Realtime updates via Supabase
- ✅ Row Level Security (RLS) no banco de dados
- ✅ Autenticação segura com roles
- ✅ Geração de PDFs com assinaturas

## 🛠️ Tecnologias Utilizadas

- **Frontend**: React + TypeScript + Vite
- **Estilização**: Tailwind CSS
- **Backend/Banco**: Supabase (Auth, Postgres, Realtime)
- **PWA**: Vite PWA Plugin + Workbox
- **Offline Storage**: localforage + IndexedDB
- **PDF Generation**: pdf-lib
- **Signature Capture**: react-signature-canvas
- **State Management**: Zustand
- **Notificações**: Sonner

## 📋 Pré-requisitos

- Node.js 18+ 
- npm ou pnpm
- Conta no Supabase (gratuito)
- (Opcional) n8n para webhook de integração com ERP

## 🔧 Configuração e Instalação

### 1. Clone o repositório
```bash
git clone <url-do-repositorio>
cd delivery-route-manager
```

### 2. Instale as dependências
```bash
npm install
```

### 3. Configure o Supabase

1. Crie um projeto no [Supabase](https://supabase.com)
2. Copie as credenciais do projeto (URL e Anon Key)
3. Configure as variáveis de ambiente:

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas credenciais do Supabase:
```env
VITE_SUPABASE_URL=sua_url_do_supabase
VITE_SUPABASE_ANON_KEY=seu_anon_key
VITE_WEBHOOK_URL=https://seu-n8n-instance.com/webhook/orders-import
VITE_WEBHOOK_SECRET=sua_chave_secreta
```

### 4. Configure o banco de dados

Execute as migrações no Supabase:

1. Acesse o painel SQL do seu projeto Supabase
2. Execute o conteúdo do arquivo: `supabase/migrations/202411130001_initial_schema.sql`
3. Execute o conteúdo do arquivo: `supabase/migrations/202411130002_sample_data.sql` (opcional, para testes)

### 5. Configure o n8n (Webhook)

Crie um workflow no n8n com:
- Webhook trigger (POST)
- Conexão com seu ERP para buscar pedidos
- Retorno no formato especificado no contrato

### 6. Execute o projeto

```bash
npm run dev
```

Acesse: http://localhost:5173

## 👥 Contas de Teste

Após configurar o banco de dados com os dados de exemplo:

**Admin:**
- Email: `admin@delivery.com`
- Senha: `admin123`

**Motorista:**
- Email: `driver@delivery.com` 
- Senha: `driver123`

## 📱 Instalação como PWA

1. Acesse o aplicativo no navegador
2. Clique no ícone de instalação na barra de endereços
3. Ou use o menu "Instalar aplicativo" no navegador
4. O app será instalado e funcionará offline

## 🔗 Contrato do Webhook (n8n)

O webhook deve retornar JSON no seguinte formato:

```json
{
  "status": "ok",
  "fetched_at": "2025-11-13T12:00:00Z",
  "orders": [
    {
      "order_id": "12345",
      "customer_name": "Fulano de Tal",
      "customer_phone": "+55 84 9XXXX-XXXX",
      "address": {
        "street": "Rua Exemplo, 100",
        "neighborhood": "Centro",
        "city": "Assu",
        "state": "RN",
        "zip": "59600-000"
      },
      "items": [
        {"sku":"ABC123","name":"Sofá XYZ","qty":1}
      ],
      "total": 1299.90,
      "observations": "Entrega preferencial pela manhã",
      "erp_metadata": { "erp_order_id": "ERP-98765" }
    }
  ]
}
```

## 🏗️ Estrutura do Projeto

```
src/
├── components/          # Componentes React reutilizáveis
├── pages/              # Páginas da aplicação
│   ├── admin/         # Páginas do administrador
│   └── driver/        # Páginas do motorista
├── stores/            # Estado global (Zustand)
├── services/          # Serviços e APIs
├── supabase/          # Configuração do Supabase
├── types/             # Tipos TypeScript
├── utils/             # Utilitários
│   ├── offline/       # Funcionalidades offline
│   └── pdf/           # Geração de PDFs
└── App.tsx            # Componente principal
```

## 🚀 Deploy

### Frontend (PWA)
O projeto pode ser deployado em qualquer serviço de static hosting:
- Vercel (recomendado)
- Netlify
- GitHub Pages
- AWS S3 + CloudFront

```bash
npm run build
```

### Backend (Supabase)
O backend é gerenciado pelo Supabase. Certifique-se de:
- Configurar as RLS policies corretamente
- Configurar os triggers de realtime se necessário
- Monitorar os logs de sincronização

## 🔒 Segurança

- Autenticação via Supabase Auth
- Row Level Security (RLS) configurado para todas as tabelas
- Dados sensíveis não são expostos no frontend
- Assinaturas e fotos são armazenadas de forma segura

## 📊 Monitoramento

- Logs de sincronização são armazenados na tabela `sync_logs`
- Erros de sincronização são notificados ao administrador
- Métricas de entrega são exibidas em tempo real

## 🐛 Solução de Problemas

### Problemas de Sincronização Offline
1. Verifique a conexão com a internet
2. Confirme que o background sync está ativo
3. Verifique os logs em `sync_logs`
4. Use o botão "Sincronizar" para forçar sincronização

### Problemas de Autenticação
1. Verifique as credenciais do Supabase
2. Confirme que as RLS policies estão configuradas
3. Verifique se o usuário tem a role correta

### Problemas de PWA
1. Certifique-se de que o site está em HTTPS
2. Verifique o manifest.json e service worker
3. Teste em diferentes navegadores

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo `LICENSE` para mais detalhes.

## 📞 Suporte

Para suporte, entre em contato através dos canais oficiais ou abra uma issue no repositório.

---

**Desenvolvido com ❤️ para gerenciamento de entregas eficiente**