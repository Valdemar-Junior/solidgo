import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, Plus, Save, Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';

type MdfeEmitter = {
  id: string;
  company_name: string;
  trade_name: string | null;
  cnpj: string;
  state_registration: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city_code: string;
  city_name: string;
  uf: string;
  zip_code: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  created_at: string;
};

type EmitterFormState = Omit<MdfeEmitter, 'id' | 'created_at'>;

const EMPTY_FORM: EmitterFormState = {
  company_name: '',
  trade_name: '',
  cnpj: '',
  state_registration: '',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city_code: '',
  city_name: '',
  uf: '',
  zip_code: '',
  phone: '',
  email: '',
  active: true,
};

export default function MdfeEmitters() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [emitters, setEmitters] = useState<MdfeEmitter[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EmitterFormState>(EMPTY_FORM);

  useEffect(() => {
    load();
  }, []);

  const filteredEmitters = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return emitters;
    return emitters.filter((emitter) =>
      [
        emitter.company_name,
        emitter.trade_name || '',
        emitter.cnpj,
        emitter.city_name,
        emitter.uf,
      ].some((value) => value.toLowerCase().includes(term))
    );
  }, [emitters, search]);

  const load = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('mdfe_emitters')
        .select('*')
        .order('company_name', { ascending: true });

      if (error) throw error;
      setEmitters((data || []) as MdfeEmitter[]);
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Erro ao carregar emitentes MDF-e');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(false);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (emitter: MdfeEmitter) => {
    setEditingId(emitter.id);
    setForm({
      company_name: emitter.company_name,
      trade_name: emitter.trade_name || '',
      cnpj: emitter.cnpj,
      state_registration: emitter.state_registration,
      street: emitter.street,
      number: emitter.number,
      complement: emitter.complement || '',
      neighborhood: emitter.neighborhood,
      city_code: emitter.city_code,
      city_name: emitter.city_name,
      uf: emitter.uf,
      zip_code: emitter.zip_code || '',
      phone: emitter.phone || '',
      email: emitter.email || '',
      active: emitter.active,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.company_name.trim() || !form.cnpj.trim() || !form.state_registration.trim()) {
      toast.error('Preencha razao social, CNPJ e inscricao estadual');
      return;
    }

    if (!form.street.trim() || !form.number.trim() || !form.neighborhood.trim()) {
      toast.error('Preencha o endereco principal do emitente');
      return;
    }

    if (!form.city_code.trim() || !form.city_name.trim() || !form.uf.trim()) {
      toast.error('Preencha codigo do municipio, cidade e UF');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        id: editingId || undefined,
        company_name: form.company_name.trim(),
        trade_name: form.trade_name?.trim() || null,
        cnpj: form.cnpj.trim(),
        state_registration: form.state_registration.trim(),
        street: form.street.trim(),
        number: form.number.trim(),
        complement: form.complement?.trim() || null,
        neighborhood: form.neighborhood.trim(),
        city_code: form.city_code.trim(),
        city_name: form.city_name.trim(),
        uf: form.uf.trim().toUpperCase(),
        zip_code: form.zip_code?.trim() || null,
        phone: form.phone?.trim() || null,
        email: form.email?.trim() || null,
        active: form.active,
      };

      const query = editingId
        ? supabase.from('mdfe_emitters').update(payload).eq('id', editingId)
        : supabase.from('mdfe_emitters').insert(payload);

      const { error } = await query;
      if (error) throw error;

      toast.success(editingId ? 'Emitente MDF-e atualizado' : 'Emitente MDF-e cadastrado');
      resetForm();
      await load();
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Erro ao salvar emitente MDF-e');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (emitter: MdfeEmitter) => {
    try {
      const { error } = await supabase
        .from('mdfe_emitters')
        .update({ active: !emitter.active })
        .eq('id', emitter.id);

      if (error) throw error;
      toast.success(emitter.active ? 'Emitente inativado' : 'Emitente ativado');
      await load();
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Erro ao atualizar status do emitente');
    }
  };

  return (
    <div className="p-6 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link to="/admin/mdfe" className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-800">
              <ArrowLeft className="h-4 w-4" />
              Voltar para MDF-e
            </Link>
            <h1 className="mt-3 text-2xl font-bold text-slate-900">Emitentes MDF-e</h1>
            <p className="mt-2 text-sm text-slate-600">
              Cadastro fiscal isolado para manter os dados da empresa emissora fora do fluxo operacional atual.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Novo emitente
          </button>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por razao social, CNPJ ou cidade..."
              className="w-full rounded-xl border border-slate-300 py-2 pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-blue-500"
            />
          </div>
        </section>

        {showForm && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{editingId ? 'Editar emitente' : 'Novo emitente'}</h2>
                <p className="text-sm text-slate-600">Preencha os dados fiscais fixos que a emissao do MDF-e exige.</p>
              </div>
              <button
                type="button"
                onClick={resetForm}
                className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <FormField label="Razao social" value={form.company_name} onChange={(value) => setForm((current) => ({ ...current, company_name: value }))} />
              <FormField label="Nome fantasia" value={form.trade_name || ''} onChange={(value) => setForm((current) => ({ ...current, trade_name: value }))} />
              <FormField label="CNPJ" value={form.cnpj} onChange={(value) => setForm((current) => ({ ...current, cnpj: value }))} />
              <FormField label="Inscricao estadual" value={form.state_registration} onChange={(value) => setForm((current) => ({ ...current, state_registration: value }))} />
              <FormField label="Logradouro" value={form.street} onChange={(value) => setForm((current) => ({ ...current, street: value }))} />
              <FormField label="Numero" value={form.number} onChange={(value) => setForm((current) => ({ ...current, number: value }))} />
              <FormField label="Complemento" value={form.complement || ''} onChange={(value) => setForm((current) => ({ ...current, complement: value }))} />
              <FormField label="Bairro" value={form.neighborhood} onChange={(value) => setForm((current) => ({ ...current, neighborhood: value }))} />
              <FormField label="Codigo do municipio" value={form.city_code} onChange={(value) => setForm((current) => ({ ...current, city_code: value }))} />
              <FormField label="Cidade" value={form.city_name} onChange={(value) => setForm((current) => ({ ...current, city_name: value }))} />
              <FormField label="UF" value={form.uf} maxLength={2} onChange={(value) => setForm((current) => ({ ...current, uf: value.toUpperCase() }))} />
              <FormField label="CEP" value={form.zip_code || ''} onChange={(value) => setForm((current) => ({ ...current, zip_code: value }))} />
              <FormField label="Telefone" value={form.phone || ''} onChange={(value) => setForm((current) => ({ ...current, phone: value }))} />
              <FormField label="E-mail" value={form.email || ''} onChange={(value) => setForm((current) => ({ ...current, email: value }))} />
            </div>

            <label className="mt-5 inline-flex items-center gap-3 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((current) => ({ ...current, active: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Emitente ativo
            </label>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Salvando...' : 'Salvar emitente'}
              </button>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Lista de emitentes</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Emitente</th>
                  <th className="px-5 py-3">CNPJ</th>
                  <th className="px-5 py-3">Cidade</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">Carregando emitentes...</td>
                  </tr>
                ) : filteredEmitters.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">Nenhum emitente MDF-e encontrado.</td>
                  </tr>
                ) : (
                  filteredEmitters.map((emitter) => (
                    <tr key={emitter.id} className="text-sm text-slate-700">
                      <td className="px-5 py-4">
                        <div className="flex items-start gap-3">
                          <div className="rounded-xl bg-slate-100 p-2 text-slate-600">
                            <Building2 className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">{emitter.company_name}</p>
                            <p className="text-xs text-slate-500">{emitter.trade_name || 'Sem nome fantasia'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">{emitter.cnpj}</td>
                      <td className="px-5 py-4">{emitter.city_name}/{emitter.uf}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${emitter.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {emitter.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(emitter)}
                            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleStatus(emitter)}
                            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            {emitter.active ? 'Inativar' : 'Ativar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
      />
    </label>
  );
}
