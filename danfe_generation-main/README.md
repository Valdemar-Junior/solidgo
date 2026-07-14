# API DANFE HTML

API Node.js (Express) para gerar DANFE em HTML a partir de XML NF-e (modelo 55) e retornar o HTML em Base64.

## 🚀 Instalação

```bash
# Instalar dependências
npm install

# Rodar em desenvolvimento (com auto-reload)
npm run dev

# Rodar em produção
npm start
```

## 📡 Endpoint

### POST `/danfe/html-base64`

Gera DANFE HTML a partir de XML NF-e.

#### Request Body (JSON)

```json
{
  "xml": "<nfeProc>...</nfeProc>",
  "logoBase64": "iVBORw0KGgoAAAANSUhE..."  // opcional, PNG/JPG sem prefixo data:image/...
}
```

#### Response (JSON)

```json
{
  "html_base64": "PCFET0NUWVBFIGh0bWw+...",
  "meta": {
    "nNF": "123456",
    "serie": "1",
    "chave": "35210312345678000123550010001234561234567890",
    "emitente": "EMPRESA LTDA",
    "destinatario": "CLIENTE FINAL"
  }
}
```

#### Códigos de Resposta

| Código | Descrição |
|--------|-----------|
| 200 | Sucesso |
| 400 | Campo `xml` não informado |
| 500 | Erro interno ao processar XML |

## 🔒 Segurança (LGPD)

- ✅ Não salva XML em disco
- ✅ Não salva HTML em disco  
- ✅ Não escreve XML em logs
- ✅ Logs apenas de erros genéricos (sem payload)
- ✅ Stateless total

## 📋 Mapeamento de Campos

### Emitente
| Placeholder | Campo XML |
|-------------|-----------|
| [ds_company_issuer_name] | emit.xNome ou xFant |
| [nl_invoice] | ide.nNF |
| [ds_invoice_serie] | ide.serie |
| [ds_company_address] | emit.enderEmit.xLgr + nro |
| [nl_company_cnpj_cpf] | emit.CNPJ |
| [nl_company_ie] | emit.IE |

### Destinatário
| Placeholder | Campo XML |
|-------------|-----------|
| [ds_client_receiver_name] | dest.xNome |
| [nl_client_cnpj_cpf] | dest.CPF ou CNPJ |
| [ds_client_address] | dest.enderDest.xLgr + nro + xCpl |
| [ds_client_ie] | dest.IE |

### Totais
| Placeholder | Campo XML |
|-------------|-----------|
| [tot_bc_icms] | total.ICMSTot.vBC |
| [tot_icms] | total.ICMSTot.vICMS |
| [vl_total] | total.ICMSTot.vNF |
| {ApproximateTax} | total.ICMSTot.vTotTrib |

## 📦 Dependências

- **express**: Framework web
- **cors**: Habilita CORS
- **fast-xml-parser**: Parser XML rápido e eficiente

## 🧪 Exemplo de Uso (cURL)

```bash
curl -X POST http://localhost:3000/danfe/html-base64 \
  -H "Content-Type: application/json" \
  -d '{"xml": "<nfeProc>...</nfeProc>"}'
```

## 🧪 Exemplo de Uso (JavaScript)

```javascript
const response = await fetch('http://localhost:3000/danfe/html-base64', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    xml: xmlString,
    logoBase64: logoBase64 // opcional
  }),
});

const data = await response.json();
const htmlContent = atob(data.html_base64); // decodifica base64
```

## 📄 Licença

ISC
