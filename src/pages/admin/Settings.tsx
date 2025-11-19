import { useEffect, useState } from 'react'
import { supabase } from '../../supabase/client'
import { Save, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

export default function Settings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enviaPedidos, setEnviaPedidos] = useState('')
  const [geraNf, setGeraNf] = useState('')
  const [enviaMensagem, setEnviaMensagem] = useState('')
  const [enviaGrupo, setEnviaGrupo] = useState('')

  useEffect(() => { load() }, [])

  const getUrl = async (key: string) => {
    const { data } = await supabase.from('webhook_settings').select('*').eq('key', key).eq('active', true).single()
    return data?.url as string | undefined
  }

  const load = async () => {
    try {
      setLoading(true)
      const [p, n, m, g] = await Promise.all([
        getUrl('envia_pedidos'),
        getUrl('gera_nf'),
        getUrl('envia_mensagem'),
        getUrl('envia_grupo'),
      ])
      setEnviaPedidos(p || '')
      setGeraNf(n || '')
      setEnviaMensagem(m || '')
      setEnviaGrupo(g || '')
    } catch {
      toast.error('Erro ao carregar configurações')
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    try {
      setSaving(true)
      const rows = [
        { key: 'envia_pedidos', url: enviaPedidos, active: true },
        { key: 'gera_nf', url: geraNf, active: true },
        { key: 'envia_mensagem', url: enviaMensagem, active: true },
        { key: 'envia_grupo', url: enviaGrupo, active: true },
      ].filter(r => r.url && r.url.length > 0)
      if (rows.length === 0) { toast.error('Informe ao menos um webhook'); setSaving(false); return }
      const { error } = await supabase.from('webhook_settings').upsert(rows, { onConflict: 'key' })
      if (error) { toast.error('Erro ao salvar'); return }
      toast.success('Configurações salvas')
    } catch {
      toast.error('Erro ao salvar configurações')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-2 text-gray-600">Carregando...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 max-w-3xl">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Configurações de Webhooks</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Webhook Importar Pedidos</label>
          <input type="text" value={enviaPedidos} onChange={e => setEnviaPedidos(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="https://.../envia_pedidos" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Webhook Gerar NF</label>
          <input type="text" value={geraNf} onChange={e => setGeraNf(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="https://.../gera_nf" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Webhook Enviar Mensagem WhatsApp</label>
          <input type="text" value={enviaMensagem} onChange={e => setEnviaMensagem(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="https://.../envia_mensagem" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Webhook Enviar Rota em Grupo</label>
          <input type="text" value={enviaGrupo} onChange={e => setEnviaGrupo(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="https://.../envia_grupo" />
        </div>
      </div>
      <div className="mt-6 flex justify-end space-x-3">
        <button onClick={load} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 flex items-center"><RefreshCw className="h-4 w-4 mr-2" />Recarregar</button>
        <button onClick={save} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center"><Save className="h-4 w-4 mr-2" />Salvar</button>
      </div>
    </div>
  )
}

