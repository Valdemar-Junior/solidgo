import { useEffect, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { supabase } from '../../supabase/client'
import type { AssemblyRoute } from '../../types/database'
import { Truck, MapPin, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function AssemblerDashboard() {
  const { user, logout } = useAuthStore()
  const [routes, setRoutes] = useState<AssemblyRoute[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    loadAssemblerRoutes()
  }, [user?.id])

  const loadAssemblerRoutes = async () => {
    if (!user?.id) return
    try {
      setLoading(true)
      const { data: routesData } = await supabase
        .from('assembly_routes')
        .select('*')
        .eq('assembler_id', user.id)
        .order('created_at', { ascending: false })
      setRoutes((routesData || []) as AssemblyRoute[])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Truck className="h-12 w-12 text-blue-600 mx-auto mb-4 animate-pulse" />
          <p className="text-gray-600">Carregando romaneios...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Minhas Montagens</h1>
                <p className="text-gray-600 mt-1">Bem-vindo, {user?.name || user?.email}</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="bg-indigo-100 text-indigo-800 px-3 py-1 rounded-full text-sm font-medium">Montador</span>
              <button onClick={async()=>{ await logout(); window.location.href = '/login'; }} className="inline-flex items-center px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 border border-gray-300">
                <LogOut className="h-4 w-4 mr-2" /> Sair
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {routes.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <Truck className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Nenhum romaneio atribuído</h3>
            <p className="text-gray-600">Você não tem romaneios atribuídos no momento.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {routes.map((route) => (
              <div key={route.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center">
                    <MapPin className="h-5 w-5 text-indigo-600 mr-2" />
                    <h3 className="text-lg font-semibold text-gray-900">{route.name}</h3>
                  </div>
                  <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">{route.status === 'completed' ? 'Concluído' : 'Pendente'}</span>
                </div>
                <div className="text-sm text-gray-600 mb-4">Criado em: {new Date(route.created_at).toLocaleDateString('pt-BR')}</div>
                <button onClick={()=> navigate(`/montador/route/${route.id}`)} className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-indigo-700 transition-colors">Abrir Romaneio</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
