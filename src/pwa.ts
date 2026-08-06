import { registerSW } from 'virtual:pwa-register'
import { runWhenIdle } from './utils/updateGate'

export function registerServiceWorker() {
  // immediate: true instala o SW mesmo se o usuário não interagir,
  // garantindo cache do shell antes de sair para a rota offline.
  const updateSW = registerSW({
    immediate: true,
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
