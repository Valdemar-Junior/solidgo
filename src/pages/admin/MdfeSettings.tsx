import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, Save, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';

type MdfeSettingsRow = {
  id: string;
  enabled: boolean;
  environment: 'homologation' | 'production';
  operation_type: 'cargo_propria';
  emit_type: number;
  transport_type: number | null;
  default_emitter_id: string | null;
  loading_city_code: string | null;
  loading_city_name: string | null;
  loading_uf: string | null;
  observations: string | null;
};

type EmitterOption = {
  id: string;
  company_name: string;
  active: boolean;
};

const emptyForm: MdfeSettingsRow = {
  id: '',
  enabled: false,
  environment: 'homologation',
  operation_type: 'cargo_propria',
  emit_type: 2,
  transport_type: null,
  default_emitter_id: null,
  loading_city_code: null,
  loading_city_name: null,
  loading_uf: null,
  observations: null,
};

export default function MdfeSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<MdfeSettingsRow>(emptyForm);
  const [emitters, setEmitters] = useState<EmitterOption[]>([]);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      const [settingsRes, emittersRes] = await Promise.all([
        supabase
          .from('mdfe_settings')
          .select('*')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('mdfe_emitters')
          .select('id, company_name, active')
          .order('company_name', { ascending: true }),
      ]);

      if (settingsRes.error) throw settingsRes.error;
      if (emittersRes.error) throw emittersRes.error;

      if (settingsRes.data) {
        setForm(settingsRes.data as MdfeSettingsRow);
      }

      setEmitters((emittersRes.data || []) as EmitterOption[]);
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Erro ao carregar configuracoes do MDF-e');
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    try {
      setSaving(true);
      const payload = {
        id: form.id || undefined,
        enabled: form.enabled,
        environment: form.environment,
        operation_type: 'cargo_propria',
        emit_type: 2,
        transport_type: form.transport_type ? Number(form.transport_type) : null,
        default_emitter_id: form.default_emitter_id || null,
        loading_city_code: form.loading_city_code?.trim() || null,
        loading_city_name: form.loading_city_name?.trim() || null,
        loading_uf: form.loading_uf?.trim().toUpperCase() || null,
        observations: form.observations?.trim() || null,
      };

      const { data, error } = await supabase
        .from('mdfe_settings')
        .upsert(payload, { onConflict: 'id' })
        .select('*')
        .single();

      if (error) throw error;

      setForm(data as MdfeSettingsRow);
      toast.success('Configuracoes do MDF-e salvas com sucesso');
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Erro ao salvar configuracoes do MDF-e');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 sm:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link to="/admin/mdfe" className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-800">
              <ArrowLeft className="h-4 w-4" />
              Voltar para MDF-e
            </Link>
            <h1 className="mt-3 text-2xl font-bold text-slate-900">Configuracoes MDF-e</h1>
            <p className="mt-2 text-sm text-slate-600">
              Area isolada para controlar as variaveis fixas da emissao antes de integrar o fluxo com as rotas.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={load}
              disabled={loading || saving}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </button>
            <button
              type="button"
              onClick={save}
              disabled={loading || saving}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-50 p-3 text-blue-700">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Controle do modulo</h2>
              <p className="text-sm text-slate-600">A emissao continua isolada e pode ser desligada aqui a qualquer momento.</p>
            </div>
          </div>

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <label className="rounded-2xl border border-slate-200 p-4">
              <span className="block text-sm font-medium text-slate-700">Modulo MDF-e habilitado</span>
              <span className="mt-1 block text-xs text-slate-500">Desligando isso, o modulo pode ser ocultado sem afetar a operacao atual.</span>
              <div className="mt-4">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((current) => ({ ...current, enabled: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </div>
            </label>

            <label className="rounded-2xl border border-slate-200 p-4">
              <span className="block text-sm font-medium text-slate-700">Ambiente</span>
              <span className="mt-1 block text-xs text-slate-500">Separar homologacao de producao ajuda a proteger a operacao durante a integracao.</span>
              <select
                value={form.environment}
                onChange={(e) => setForm((current) => ({ ...current, environment: e.target.value as MdfeSettingsRow['environment'] }))}
                className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-blue-500"
              >
                <option value="homologation">Homologacao</option>
                <option value="production">Producao</option>
              </select>
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Dados fixos da operacao</h2>
          <p className="mt-2 text-sm text-slate-600">
            Aqui ficam as configuracoes que nao dependem da rota: carga propria, emitente padrao e municipio de carregamento.
          </p>

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Tipo de operacao</span>
              <input
                type="text"
                value="Carga propria"
                disabled
                className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Tipo de emitente</span>
              <input
                type="text"
                value="2 - Transportador de Carga Propria"
                disabled
                className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Emitente padrao</span>
              <select
                value={form.default_emitter_id || ''}
                onChange={(e) => setForm((current) => ({ ...current, default_emitter_id: e.target.value || null }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
              >
                <option value="">Selecione um emitente</option>
                {emitters.map((emitter) => (
                  <option key={emitter.id} value={emitter.id}>
                    {emitter.company_name}{emitter.active ? '' : ' (inativo)'}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Tipo do transportador</span>
              <input
                type="number"
                value={form.transport_type ?? ''}
                onChange={(e) => setForm((current) => ({ ...current, transport_type: e.target.value ? Number(e.target.value) : null }))}
                placeholder="Ex: 2"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Codigo do municipio de carregamento</span>
              <input
                type="text"
                value={form.loading_city_code || ''}
                onChange={(e) => setForm((current) => ({ ...current, loading_city_code: e.target.value }))}
                placeholder="Ex: 2400208"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Nome do municipio de carregamento</span>
              <input
                type="text"
                value={form.loading_city_name || ''}
                onChange={(e) => setForm((current) => ({ ...current, loading_city_name: e.target.value }))}
                placeholder="Ex: Assu"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">UF de carregamento</span>
              <input
                type="text"
                maxLength={2}
                value={form.loading_uf || ''}
                onChange={(e) => setForm((current) => ({ ...current, loading_uf: e.target.value }))}
                placeholder="RN"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm uppercase text-slate-900 outline-none focus:border-blue-500"
              />
            </label>
          </div>

          <label className="mt-5 block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Observacoes internas</span>
            <textarea
              value={form.observations || ''}
              onChange={(e) => setForm((current) => ({ ...current, observations: e.target.value }))}
              rows={4}
              placeholder="Anote regras fixas da operacao para a equipe."
              className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm text-slate-900 outline-none focus:border-blue-500"
            />
          </label>
        </section>
      </div>
    </div>
  );
}
