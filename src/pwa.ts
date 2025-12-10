import { registerSW } from 'virtual:pwa-register'

export function registerServiceWorker() {
  // immediate: true instala o SW mesmo se o usuário não interagir,
  // garantindo cache do shell antes de sair para a rota offline.
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Evita refresh forçado: só atualiza se estiver online e o usuário concordar.
      if (navigator.onLine && confirm('Nova versão disponível. Atualizar agora?')) {
        updateSW(true)
      }
    },
    onOfflineReady() {
      console.log('PWA pronta para uso offline')
    },
  })
}
