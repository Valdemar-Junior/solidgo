import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import {
  ArrowLeft,
  Save,
  RefreshCw,
  Webhook,
  ShoppingCart,
  FileText,
  MessageCircle,
  Users,
  Globe,
  CheckCircle2,
  AlertCircle,
  FilePlus,
  Truck,
  Settings as SettingsIcon,
  LayoutDashboard,
  Tractor,
  Plus,
  X,
  Clock // Icon for General Config
} from 'lucide-react';
import { toast } from 'sonner';
import { WorkingDaysCalendar } from '../../components/settings/WorkingDaysCalendar';
import { CityRulesTable } from '../../components/settings/CityRulesTable';

type Tab = 'general' | 'logistics' | 'integrations';

export default function Settings() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // State for webhooks
  const [enviaPedidos, setEnviaPedidos] = useState('');
  const [geraNf, setGeraNf] = useState('');
  const [enviaMensagem, setEnviaMensagem] = useState('');
  const [enviaGrupo, setEnviaGrupo] = useState('');

  const [consultaLancamento, setConsultaLancamento] = useState('');
  const [requireConference, setRequireConference] = useState(true);
  const [allowOrderUpdates, setAllowOrderUpdates] = useState(false);

  // State for Logistics
  const [ruralKeywords, setRuralKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');

  // New State for General Defaults
  const [defaultDeliveryDays, setDefaultDeliveryDays] = useState(15);
  const [defaultAssemblyDays, setDefaultAssemblyDays] = useState(15);

  useEffect(() => { load() }, []);

  const getUrl = async (key: string) => {
    const { data } = await supabase.from('webhook_settings').select('*').eq('key', key).eq('active', true).single();
    return data?.url as string | undefined;
  };

  const load = async () => {
    try {
      setLoading(true);
      const [p, n, m, g, l, confFlag, updateFlag, ruralKeys, generalDeadlines] = await Promise.all([
        getUrl('envia_pedidos'),
        getUrl('gera_nf'),
        getUrl('envia_mensagem'),
        getUrl('envia_grupo'),
        getUrl('consulta_lancamento'),
        supabase.from('app_settings').select('value').eq('key', 'require_route_conference').single(),
        supabase.from('app_settings').select('value').eq('key', 'allow_order_updates_on_import').single(),
        supabase.from('app_settings').select('value').eq('key', 'rural_keywords').single(),
        supabase.from('app_settings').select('value').eq('key', 'general_deadlines').single(),
      ]);
      setEnviaPedidos(p || '');
      setGeraNf(n || '');
      setEnviaMensagem(m || '');
      setEnviaGrupo(g || '');
      setConsultaLancamento(l || '');

      const enabled = (confFlag.data as any)?.value?.enabled;
      setRequireConference(enabled === false ? false : true);

      const updatesEnabled = (updateFlag.data as any)?.value?.enabled;
      setAllowOrderUpdates(updatesEnabled === true); // Default to false if missing

      const keywords = (ruralKeys.data as any)?.value?.keywords;
      setRuralKeywords(Array.isArray(keywords) ? keywords : []);

      const general = (generalDeadlines.data as any)?.value;
      setDefaultDeliveryDays(general?.delivery_days || 15);
      setDefaultAssemblyDays(general?.assembly_days || 15);

    } catch {
      toast.error('Erro ao carregar configurações');
    } finally {
      setLoading(false);
    }
  };

  const handleAddKeyword = () => {
    if (!newKeyword.trim()) return;
    const keyword = newKeyword.trim().toUpperCase();
    if (ruralKeywords.includes(keyword)) {
      setNewKeyword('');
      return;
    }
    setRuralKeywords([...ruralKeywords, keyword]);
    setNewKeyword('');
  };

  const handleRemoveKeyword = (keyword: string) => {
    setRuralKeywords(ruralKeywords.filter(k => k !== keyword));
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
        { key: 'consulta_lancamento', url: consultaLancamento, active: true },
      ].filter(r => r.url !== undefined);

      const { error } = await supabase.from('webhook_settings').upsert(rows, { onConflict: 'key' });
      if (error) throw error;

      const { error: flagErr } = await supabase.from('app_settings').upsert([{
        key: 'require_route_conference',
        value: { enabled: requireConference },
        updated_at: new Date().toISOString()
      }, {
        key: 'allow_order_updates_on_import',
        value: { enabled: allowOrderUpdates },
        updated_at: new Date().toISOString()
      }], { onConflict: 'key' });
      if (flagErr) throw flagErr;

      const { error: ruralErr } = await supabase.from('app_settings').upsert([{
        key: 'rural_keywords',
        value: { keywords: ruralKeywords },
        updated_at: new Date().toISOString()
      }], { onConflict: 'key' });
      if (ruralErr) throw ruralErr;

      const { error: generalErr } = await supabase.from('app_settings').upsert([{
        key: 'general_deadlines',
        value: { delivery_days: defaultDeliveryDays, assembly_days: defaultAssemblyDays },
        updated_at: new Date().toISOString()
      }], { onConflict: 'key' });
      if (generalErr) throw generalErr;


      toast.success('Configurações salvas com sucesso!');
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao salvar configurações');
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'general', label: 'Geral', icon: LayoutDashboard },
    { id: 'logistics', label: 'Logística', icon: Truck },
    { id: 'integrations', label: 'Integrações', icon: Webhook },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm flex-none">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
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
              <p className="text-sm text-gray-500">Gerencie as integrações, logística e parâmetros do sistema</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 gap-8 items-start">

        {/* Sidebar Navigation */}
        <nav className="w-64 flex-shrink-0 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden sticky top-24">
          <div className="p-4 space-y-1">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as Tab)}
                  className={`
                    w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors
                    ${isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}
                  `}
                >
                  <Icon className={`h-5 w-5 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Content Area */}
        <div className="flex-1 space-y-6">

          {/* TAB: GERAL */}
          {activeTab === 'general' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-in fade-in duration-300">
              <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-blue-600" />
                <h2 className="font-bold text-gray-900">Rotas — Exigir Conferência</h2>
              </div>
              <div className="p-6 space-y-3">
                <p className="text-sm text-gray-600">
                  Defina se o botão “Iniciar rota” só fica liberado após a conferência estar finalizada.
                  Desative temporariamente para operar sem conferência (útil enquanto as etiquetas não estão prontas).
                </p>
                <label className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-lg px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Exigir conferência antes de iniciar</p>
                    <p className="text-xs text-gray-500">Quando ligado, mantém o bloqueio atual; desligado, permite iniciar rota sem conferência.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={requireConference}
                    onChange={(e) => setRequireConference(e.target.checked)}
                    className="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                </label>

                <hr className="border-gray-100 my-4" />

                <p className="text-sm text-gray-600">
                  Configurações de Importação de Pedidos
                </p>
                <label className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-lg px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Permitir atualização de pedidos na importação</p>
                    <p className="text-xs text-gray-500">
                      Quando ligado, exibe uma opção na tela de importação para atualizar dados (descrição, grupos) de pedidos já existentes.
                      <br />
                      <span className="text-orange-600 font-medium">Atenção:</span> Não altera status, entregas ou devoluções. Apenas dados cadastrais do produto.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={allowOrderUpdates}
                    onChange={(e) => setAllowOrderUpdates(e.target.checked)}
                    className="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                </label>

                {/* Salvar Button inside the module for General */}
                <div className="mt-6 pt-4 border-t border-gray-100 flex justify-end">
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
          )}

          {/* TAB: LOGÍSTICA */}
          {activeTab === 'logistics' && (
            <div className="space-y-6 animate-in fade-in duration-300">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Prazo Padrão Geral Config */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 flex items-center gap-2">
                    <Clock className="h-5 w-5 text-gray-600" />
                    <h2 className="font-bold text-gray-900">Prazo Padrão Geral</h2>
                  </div>
                  <div className="p-6">
                    <p className="text-sm text-gray-600 mb-4">
                      Aplicado para <b>cidades sem regra cadastrada</b> na tabela abaixo.
                    </p>
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Entrega</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={defaultDeliveryDays}
                            onChange={(e) => setDefaultDeliveryDays(parseInt(e.target.value) || 15)}
                            className="w-full border-gray-300 rounded-lg text-sm px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                          />
                          <span className="text-sm text-gray-500">dias</span>
                        </div>
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Montagem</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={defaultAssemblyDays}
                            onChange={(e) => setDefaultAssemblyDays(parseInt(e.target.value) || 15)}
                            className="w-full border-gray-300 rounded-lg text-sm px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                          />
                          <span className="text-sm text-gray-500">dias</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Zona Rural Config */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 flex items-center gap-2">
                    <Tractor className="h-5 w-5 text-green-600" />
                    <h2 className="font-bold text-gray-900">Zona Rural - Palavras-Chave</h2>
                  </div>
                  <div className="p-6 space-y-4">
                    <p className="text-sm text-gray-600">
                      Se o endereço contiver qualquer um destes termos, o sistema aplicará o <b>Prazo Rural</b> da cidade.
                    </p>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newKeyword}
                        onChange={(e) => setNewKeyword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddKeyword()}
                        placeholder="Ex: ZONA RURAL, SÍTIO..."
                        className="flex-1 border-gray-300 rounded-lg text-sm px-3 py-2 focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all uppercase"
                      />
                      <button
                        onClick={handleAddKeyword}
                        className="bg-green-600 text-white px-3 py-2 rounded-lg font-medium hover:bg-green-700 transition-colors flex items-center gap-1 text-sm"
                      >
                        <Plus className="h-4 w-4" />
                        Add
                      </button>

                    </div>

                    <div className="flex flex-wrap gap-2 pt-2">
                      {ruralKeywords.map(keyword => (
                        <span key={keyword} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-100 text-green-700 text-sm font-medium border border-green-200">
                          {keyword}
                          <button onClick={() => handleRemoveKeyword(keyword)} className="hover:text-green-900 p-0.5 rounded-full hover:bg-green-200 transition-colors">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                      {ruralKeywords.length === 0 && (
                        <span className="text-sm text-gray-400 italic">
                          Nenhuma palavra-chave definida (padrão urbano).
                        </span>
                      )}
                    </div>
                  </div>
                </div>

              </div>

              <div className="flex justify-end">
                <button
                  onClick={save}
                  disabled={saving || loading}
                  className=" bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                  title="Salvar Alterações"
                >
                  <Save className="h-4 w-4" />
                  Salvar Tudo
                </button>
              </div>

              <CityRulesTable />
              <WorkingDaysCalendar />
            </div>
          )}

          {/* TAB: INTEGRAÇÕES */}
          {activeTab === 'integrations' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-in fade-in duration-300">
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

                  {/* Consulta Lançamento (Troca/Assistência) */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
                      <FilePlus className="h-4 w-4 text-gray-500" />
                      Consulta Lançamento Avulso
                    </label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        value={consultaLancamento}
                        onChange={e => setConsultaLancamento(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                        placeholder="https://webhook.n8n.io/..."
                      />
                    </div>
                    <p className="text-xs text-gray-500">Usado para buscar dados de Trocas e Assistências pelo número do lançamento.</p>
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
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
          )}

        </div>
      </div>
    </div>
  );
}
