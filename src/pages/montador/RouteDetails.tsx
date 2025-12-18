import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase/client'
import { OfflineStorage } from '../../utils/offline/storage'
import { backgroundSync } from '../../utils/offline/backgroundSync'
import type { AssemblyRoute, AssemblyProductWithDetails } from '../../types/database'
import { ArrowLeft, Package, MapPin, LogOut, RefreshCw } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { toast } from 'sonner'
import AssemblyMarking from '../../components/AssemblyMarking'

export default function AssemblerRouteDetails() {
  const { routeId } = useParams<{ routeId: string }>()
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const [route, setRoute] = useState<AssemblyRoute | null>(null)
  const [products, setProducts] = useState<AssemblyProductWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (routeId) load()
  }, [routeId])

  const load = async () => {
    try {
      setLoading(true)
      const { data: rData } = await supabase.from('assembly_routes').select('*').eq('id', routeId).single()
      setRoute((rData || null) as any)
      const { data: pData } = await supabase
        .from('assembly_products')
        .select('*, order:order_id (*)')
        .eq('assembly_route_id', routeId)
        .order('created_at', { ascending: true })
      setProducts((pData || []) as any)
      await OfflineStorage.setItem(`assembly_products_${routeId}`, pData || [])
    } catch (e) {
      const cached = await OfflineStorage.getItem(`assembly_products_${routeId}`)
      if (cached) setProducts(cached)
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async () => {
    await backgroundSync.forceSync()
    await load()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando romaneio...</p>
        </div>
      </div>
    )
  }

  if (!route) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Romaneio não encontrado</h3>
          <p className="text-gray-600">Verifique seu acesso ou tente novamente.</p>
        </div>
      </div>
    )
  }

  const groups = (() => {
    const m = new Map<string, AssemblyProductWithDetails[]>()
    products.forEach(p => {
      const k = String(p.order_id)
      const a = m.get(k) || []
      a.push(p)
      m.set(k, a)
    })
    return m
  })()

  const summary = {
    totalOrders: groups.size,
    completed: Array.from(groups.values()).filter(list => list.every(i => i.status === 'completed')).length,
    returned: Array.from(groups.values()).filter(list => list.every(i => i.status === 'cancelled')).length,
    pending: Array.from(groups.values()).filter(list => list.some(i => i.status !== 'completed' && i.status !== 'cancelled')).length,
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <button onClick={()=> navigate(-1)} className="p-2 mr-3 hover:bg-gray-100 rounded-full text-gray-600 transition-colors" title="Voltar">
                  <ArrowLeft className="h-6 w-6" />
                </button>
                <Package className="h-8 w-8 text-indigo-600 mr-3" />
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{route.name}</h1>
                  <p className="text-gray-600">Montador: {user?.name || user?.email}</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <button onClick={handleSync} className="flex items-center px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-sm hover:bg-indigo-200 transition-colors"><RefreshCw className="h-4 w-4 mr-1" /> Sincronizar</button>
                <button onClick={async()=>{ await logout(); window.location.href='/login' }} className="flex items-center px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm hover:bg-gray-200 border border-gray-300"><LogOut className="h-4 w-4 mr-1" /> Sair</button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center"><div className="text-2xl font-bold text-indigo-600">{summary.totalOrders}</div><div className="text-sm text-gray-600">Pedidos</div></div>
              <div className="text-center"><div className="text-2xl font-bold text-green-600">{summary.completed}</div><div className="text-sm text-gray-600">Concluídos</div></div>
              <div className="text-center"><div className="text-2xl font-bold text-yellow-600">{summary.pending}</div><div className="text-sm text-gray-600">Pendentes</div></div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AssemblyMarking routeId={routeId!} onUpdated={load} />
      </div>
    </div>
  )
}
