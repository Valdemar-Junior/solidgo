import { registerSW } from 'virtual:pwa-register'
import { runWhenIdle } from './utils/updateGate'

// App de campo fica dias aberto sem recarregar: sem checagem ativa, o aparelho
// nunca descobre que existe versão nova (a checagem padrão só acontece quando a
// página carrega). Foi assim que os motoristas ficaram presos numa versão antiga.
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000

export function registerServiceWorker() {
  // immediate: true instala o SW mesmo se o usuário não interagir,
  // garantindo cache do shell antes de sair para a rota offline.
  const updateSW = registerSW({
    immediate: true,
    onRegistered(registration) {
      if (!registration) return

      // Checagem periódica enquanto o app está aberto.
      setInterval(() => {
        registration.update().catch(() => { /* sem rede agora; tenta no próximo ciclo */ })
      }, UPDATE_CHECK_INTERVAL_MS)

      // E sempre que o app volta do segundo plano — o motorista faz isso
      // dezenas de vezes por dia sem nunca fechar o app de verdade.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          registration.update().catch(() => { /* idem */ })
        }
      })
    },
    onNeedRefresh() {
      // Atualiza sozinho, sem perguntar nada — o público de campo não deve
      // decidir isso. Mas nunca no meio de uma tarefa: se houver fotos
      // capturadas e ainda não confirmadas, espera a tela ficar livre.
      runWhenIdle(() => updateSW(true))
    },
    onOfflineReady() {
      console.log('PWA pronta para uso offline')
    },
  })
}
