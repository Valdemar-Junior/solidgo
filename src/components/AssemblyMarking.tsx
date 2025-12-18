import { useEffect, useState } from 'react'
import { supabase } from '../supabase/client'
import { OfflineStorage, SyncQueue, NetworkStatus } from '../utils/offline/storage'
import { backgroundSync } from '../utils/offline/backgroundSync'
import type { AssemblyProductWithDetails } from '../types/database'
import { Package, CheckCircle, XCircle, MapPin } from 'lucide-react'
import { toast } from 'sonner'

export default function AssemblyMarking({ routeId, onUpdated }: { routeId: string, onUpdated?: ()=>void }) {
  const [items, setItems] = useState<AssemblyProductWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [isOnline, setIsOnline] = useState(NetworkStatus.isOnline())
  const [processingOrders, setProcessingOrders] = useState<Set<string>>(new Set())

  useEffect(() => {
    const listener = (online:boolean)=> setIsOnline(online)
    NetworkStatus.addListener(listener)
    load()
    return () => { NetworkStatus.removeListener(listener) }
  }, [routeId])

  useEffect(() => { (async()=>{ await backgroundSync.forceSync(); await load() })() }, [isOnline])

  const load = async () => {
    try {
      setLoading(true)
      if (NetworkStatus.isOnline()) {
        const { data, error } = await supabase
          .from('assembly_products')
          .select('*, order:order_id (*)')
          .eq('assembly_route_id', routeId)
          .order('created_at', { ascending: true })
        if (error) throw error
        setItems((data || []) as any)
        await OfflineStorage.setItem(`assembly_products_${routeId}`, data || [])
      } else {
        const cached = await OfflineStorage.getItem(`assembly_products_${routeId}`)
        setItems(cached || [])
      }
    } catch (e) {
      console.error(e)
      toast.error('Erro ao carregar produtos da montagem')
    } finally {
      setLoading(false)
    }
  }

  const groups = (() => {
    const m = new Map<string, AssemblyProductWithDetails[]>()
    items.forEach(p => { const k = String(p.order_id); const a = m.get(k) || []; a.push(p); m.set(k, a) })
    return Array.from(m.entries())
  })()

  const markOrder = async (orderId: string, action: 'complete'|'return') => {
    try {
      if (processingOrders.has(orderId)) return
      setProcessingOrders(prev => { const n = new Set(prev); n.add(orderId); return n })
      const now = new Date().toISOString()

      if (NetworkStatus.isOnline()) {
        if (action === 'complete') {
          const { error } = await supabase
            .from('assembly_products')
            .update({ status: 'completed', completion_date: now })
            .eq('order_id', orderId)
            .eq('assembly_route_id', routeId)
          if (error) throw error
          toast.success('Pedido montado')
        } else {
          const { error } = await supabase
            .from('assembly_products')
            .update({ status: 'cancelled', assembly_date: null, completion_date: null })
            .eq('order_id', orderId)
            .eq('assembly_route_id', routeId)
          if (error) throw error
          const { data: pendenteExistente } = await supabase
            .from('assembly_products')
            .select('*')
            .eq('order_id', orderId)
            .is('assembly_route_id', null)
            .eq('status', 'pending')
          if (!pendenteExistente || pendenteExistente.length === 0) {
            const base = items.filter(i => String(i.order_id) === String(orderId))
            const clones = base.map(it => ({
              assembly_route_id: null,
              order_id: it.order_id,
              product_name: it.product_name,
              product_sku: it.product_sku,
              customer_name: it.customer_name,
              customer_phone: (it as any).customer_phone,
              installation_address: it.installation_address,
              installer_id: null,
              status: 'pending',
              observations: it.observations,
            }))
            if (clones.length) await supabase.from('assembly_products').insert(clones)
          }
          toast.success('Pedido retornado e liberado para nova rota')
        }
        await load()
        if (onUpdated) onUpdated()
      } else {
        await SyncQueue.addItem({ type: 'assembly_update', data: { route_id: routeId, order_id: orderId, action, local_timestamp: now } })
        const updated = items.map(it => {
          if (String(it.order_id) !== String(orderId)) return it
          return action === 'complete' ? { ...it, status: 'completed', completion_date: now } : { ...it, status: 'cancelled', completion_date: null, assembly_date: null }
        })
        setItems(updated)
        await OfflineStorage.setItem(`assembly_products_${routeId}`, updated)
        toast.success(action === 'complete' ? 'Pedido montado (offline)' : 'Pedido retornado (offline)')
      }
    } catch (e) {
      console.error(e)
      toast.error('Erro ao atualizar pedido')
    } finally {
      setProcessingOrders(prev => { const n = new Set(prev); n.delete(orderId); return n })
    }
  }

  const statusOfGroup = (list: AssemblyProductWithDetails[]) => {
    const statuses = list.map(i => i.status)
    if (statuses.every(s => s === 'completed')) return 'completed'
    if (statuses.every(s => s === 'cancelled')) return 'returned'
    return 'pending'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        <span className="ml-2 text-gray-600">Carregando pedidos...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className={`p-3 rounded-lg flex items-center ${isOnline ? 'bg-green-50 text-green-800' : 'bg-yellow-50 text-yellow-800'}`}>
        <div className={`w-2 h-2 rounded-full mr-2 ${isOnline ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
        <span className="text-sm font-medium">{isOnline ? 'Online' : 'Modo Offline'}</span>
      </div>

      {groups.map(([orderId, list]) => {
        const order = list[0]?.order || {} as any
        const status = statusOfGroup(list)
        const toDigits = (s: string) => String(s || '').replace(/\D/g, '')
        const d = toDigits(order.phone || '')
        const n = d ? (d.startsWith('55') ? d : '55' + d) : ''
        const href = n ? `https://wa.me/${n}` : ''
        return (
          <div key={orderId} className="bg-white rounded-lg shadow p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center mb-2">
                  <Package className="h-5 w-5 text-indigo-600 mr-2" />
                  <span className="font-semibold text-gray-900">{order.customer_name}</span>
                  <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${status==='completed'?'bg-green-100 text-green-800':status==='returned'?'bg-red-100 text-red-800':'bg-yellow-100 text-yellow-800'}`}>{status==='completed'?'Concluído':status==='returned'?'Retornado':'Pendente'}</span>
                </div>
                <div className="text-sm text-gray-600 space-y-1">
                  <div className="flex items-center"><MapPin className="h-4 w-4 mr-1" />{(() => { const a = order.address_json || {}; return [a.street, a.number, a.neighborhood, a.city].filter(Boolean).join(', ') })()}</div>
                  <div>
                    Telefone: {order.phone || '-'}
                    {href && (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center text-green-600 hover:text-green-700" title="Abrir WhatsApp">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M20.52 3.48A11.84 11.84 0 0 0 12.04 0C5.48 0 .16 5.32.16 11.88c0 2.08.56 4.08 1.6 5.84L0 24l6.48-1.68a11.66 11.66 0 0 0 5.56 1.44h.04c6.56 0 11.88-5.32 11.88-11.88 0-3.2-1.24-6.2-3.52-8.4ZM12.08 21.2h-.04a9.7 9.7 0 0 1-4.96-1.36l-.36-.2-3.84 1L3.96 16l-.24-.4A9.86 9.86 0 0 1 2 11.88c0-5.52 4.52-10.04 10.08-10.04 2.68 0 5.2 1.04 7.08 2.92a9.9 9.9 0 0 1 2.96 7.12c0 5.56-4.52 10.32-10.04 10.32Zm5.76-7.44c-.32-.2-1.88-.92-2.16-1.04-.28-.12-.48-.2-.68.12-.2.32-.8 1.04-.98 1.24-.2.2-.36.24-.68.08-.32-.16-1.36-.5-2.6-1.6-.96-.84-1.6-1.88-1.8-2.2-.2-.32 0-.52.16-.68.16-.16.32-.4.48-.6.16-.2.2-.36.32-.6.12-.24.08-.44-.04-.64-.12-.2-.68-1.64-.92-2.2-.24-.56-.48-.48-.68-.48h-.56c-.2 0-.52.08-.8.4-.28.32-1.08 1.08-1.08 2.64s1.12 3.08 1.28 3.3c.16.2 2.24 3.42 5.4 4.72.76.32 1.36.52 1.82.66.76.24 1.44.2 1.98.12.6-.1 1.88-.76 2.14-1.5.26-.74.26-1.36.18-1.5-.08-.14-.28-.22-.6-.4Z" /></svg>
                      </a>
                    )}
                  </div>
                  <div>Pedido: {order.order_id_erp || orderId}</div>
                  <div className="mt-2 text-xs text-gray-600">
                    <strong>Produtos:</strong>
                    <ul className="list-disc list-inside">
                      {list.map(it => (<li key={it.id}>{it.product_sku || ''} - {it.product_name}</li>))}
                    </ul>
                  </div>
                </div>
              </div>
              <div className="ml-4 flex flex-col space-y-2">
                {status === 'pending' && (
                  <>
                    <button onClick={()=> markOrder(orderId, 'complete')} disabled={processingOrders.has(orderId)} className="flex items-center px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 text-sm">
                      <CheckCircle className="h-4 w-4 mr-1" /> Concluir
                    </button>
                    <button onClick={()=> markOrder(orderId, 'return')} disabled={processingOrders.has(orderId)} className="flex items-center px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 text-sm">
                      <XCircle className="h-4 w-4 mr-1" /> Retornar
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
