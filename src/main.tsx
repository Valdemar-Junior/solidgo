import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { registerServiceWorker } from './pwa'

// Garantir registro do service worker para que o shell do app e assets sejam servidos offline,
// evitando erros quando o navegador recarrega a página ao voltar do background.
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
