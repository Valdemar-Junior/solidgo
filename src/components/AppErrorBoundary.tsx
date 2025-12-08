import React from 'react'

type State = { hasError: boolean; error?: any }

export default class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error }
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('Unhandled app error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-lg shadow p-6 text-center">
            <h1 className="text-xl font-semibold text-gray-900 mb-2">Ocorreu um erro inesperado</h1>
            <p className="text-gray-600 mb-4">Tente atualizar a página ou voltar para a tela de login.</p>
            <div className="flex items-center justify-center space-x-3">
              <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={()=>window.location.reload()}>Atualizar</button>
              <a className="px-4 py-2 bg-gray-100 rounded border" href="/login">Ir para Login</a>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

