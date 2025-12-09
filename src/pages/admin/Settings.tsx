import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { 
  ArrowLeft,
  Save, 
  RefreshCw, 
  Settings as SettingsIcon, 
  Webhook, 
  ShoppingCart, 
  FileText, 
  MessageCircle, 
  Users,
  Globe,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';

export default function Settings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // State for webhooks
  const [enviaPedidos, setEnviaPedidos] = useState('');
  const [geraNf, setGeraNf] = useState('');
  const [enviaMensagem, setEnviaMensagem] = useState('');
  const [enviaGrupo, setEnviaGrupo] = useState('');

  useEffect(() => { load() }, []);

  const getUrl = async (key: string) => {
    const { data } = await supabase.from('webhook_settings').select('*').eq('key', key).eq('active', true).single();
    return data?.url as string | undefined;
  };

  const load = async () => {
    try {
      setLoading(true);
      const [p, n, m, g] = await Promise.all([
        getUrl('envia_pedidos'),
        getUrl('gera_nf'),
        getUrl('envia_mensagem'),
        getUrl('envia_grupo'),
      ]);
      setEnviaPedidos(p || '');
      setGeraNf(n || '');
      setEnviaMensagem(m || '');
      setEnviaGrupo(g || '');
    } catch {
      toast.error('Erro ao carregar configurações');
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    try {
      setSaving(true);
      
      // Upsert data
      const rows = [
        { key: 'envia_pedidos', url: enviaPedidos, active: true },
        { key: 'gera_nf', url: geraNf, active: true },
        { key: 'envia_mensagem', url: enviaMensagem, active: true },
        { key: 'envia_grupo', url: enviaGrupo, active: true },
      ].filter(r => r.url !== undefined); // Allow saving empty strings to clear them if needed, or handle validation

      // Basic validation: warn if empty but don't block saving empty to "disable" it? 
      // Current logic: filter(r => r.url && r.url.length > 0) in original code meant we couldn't clear them easily via upsert without active=false logic.
      // Let's stick to the user's original logic intent but maybe allow clearing.
      // Actually, let's just upsert all. If empty, it's empty.
      
      const { error } = await supabase.from('webhook_settings').upsert(rows, { onConflict: 'key' });
      
      if (error) throw error;
      
      toast.success('Configurações salvas com sucesso!');
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao salvar configurações');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => navigate(-1)} 
              className="p-2 -ml-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"
              title="Voltar"
            >
              <ArrowLeft className="h-6 w-6" />
            </button>
            <div className="p-2 bg-blue-50 rounded-lg">
              <SettingsIcon className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
              <p className="text-sm text-gray-500">Gerencie as integrações e parâmetros do sistema</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        
        {/* Webhooks Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 flex items-center gap-2">
            <Webhook className="h-5 w-5 text-purple-600" />
            <h2 className="font-bold text-gray-900">Webhooks de Integração</h2>
          </div>
          
          <div className="p-6 space-y-6">
            <p className="text-sm text-gray-500 bg-blue-50 text-blue-800 p-3 rounded-lg border border-blue-100 flex items-start gap-2">
              <AlertCircle className="h-5 w-5 shrink-0" />
              Configure aqui as URLs (endpoints) do n8n ou outro sistema para onde os eventos serão enviados.
            </p>

            <div className="grid gap-6">
              {/* Importar Pedidos */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
                  <ShoppingCart className="h-4 w-4 text-gray-500" />
                  Importar Pedidos
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input 
                    type="text" 
                    value={enviaPedidos} 
                    onChange={e => setEnviaPedidos(e.target.value)} 
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="https://webhook.n8n.io/..." 
                  />
                </div>
                <p className="text-xs text-gray-500">Acionado ao clicar em "Sincronizar Pedidos" na tela de rotas.</p>
              </div>

              {/* Gerar NF */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
                  <FileText className="h-4 w-4 text-gray-500" />
                  Gerar Nota Fiscal
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input 
                    type="text" 
                    value={geraNf} 
                    onChange={e => setGeraNf(e.target.value)} 
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="https://webhook.n8n.io/..." 
                  />
                </div>
                <p className="text-xs text-gray-500">Acionado ao solicitar emissão de NF para um pedido.</p>
              </div>

              {/* Enviar WhatsApp */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
                  <MessageCircle className="h-4 w-4 text-gray-500" />
                  Notificação WhatsApp (Individual)
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input 
                    type="text" 
                    value={enviaMensagem} 
                    onChange={e => setEnviaMensagem(e.target.value)} 
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="https://webhook.n8n.io/..." 
                  />
                </div>
                <p className="text-xs text-gray-500">Usado para enviar status de entrega ao cliente.</p>
              </div>

              {/* Enviar Grupo */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
                  <Users className="h-4 w-4 text-gray-500" />
                  Notificação WhatsApp (Grupo/Rota)
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input 
                    type="text" 
                    value={enviaGrupo} 
                    onChange={e => setEnviaGrupo(e.target.value)} 
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="https://webhook.n8n.io/..." 
                  />
                </div>
                <p className="text-xs text-gray-500">Usado para enviar o resumo da rota para o grupo da equipe.</p>
              </div>
            </div>
          </div>
          
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <button 
              onClick={load} 
              disabled={loading}
              className="text-gray-600 hover:text-gray-900 text-sm font-medium flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Recarregar
            </button>
            
            <button 
              onClick={save} 
              disabled={saving || loading}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Salvar Alterações
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
