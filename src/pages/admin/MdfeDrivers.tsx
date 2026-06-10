import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, Save, Search, UserRound, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';

type MdfeDriver = {
  id: string;
  name: string;
  cpf: string;
  active: boolean;
  created_at: string;
};

type DriverFormState = Omit<MdfeDriver, 'id' | 'created_at'>;

const EMPTY_FORM: DriverFormState = {
  name: '',
  cpf: '',
  active: true,
};

export default function MdfeDrivers() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [drivers, setDrivers] = useState<MdfeDriver[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DriverFormState>(EMPTY_FORM);

  useEffect(() => {
    load();
  }, []);

  const filteredDrivers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return drivers;
    return drivers.filter((driver) =>
      [driver.name, driver.cpf].some((value) => value.toLowerCase().includes(term))
    );
  }, [drivers, search]);

  const load = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('mdfe_drivers')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      setDrivers((data || []) as MdfeDriver[]);
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Erro ao carregar condutores MDF-e');
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

  const openEdit = (driver: MdfeDriver) => {
    setEditingId(driver.id);
    setForm({
      name: driver.name,
      cpf: driver.cpf,
      active: driver.active,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.cpf.trim()) {
      toast.error('Preencha nome e CPF do condutor');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        id: editingId || undefined,
        name: form.name.trim(),
        cpf: form.cpf.trim(),
        active: form.active,
      };

      const query = editingId
        ? supabase.from('mdfe_drivers').update(payload).eq('id', editingId)
        : supabase.from('mdfe_drivers').insert(payload);

      const { error } = await query;
      if (error) throw error;

      toast.success(editingId ? 'Condutor MDF-e atualizado' : 'Condutor MDF-e cadastrado');
      resetForm();
      await load();
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Erro ao salvar condutor MDF-e');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (driver: MdfeDriver) => {
    try {
      const { error } = await supabase
        .from('mdfe_drivers')
        .update({ active: !driver.active })
        .eq('id', driver.id);

      if (error) throw error;
      toast.success(driver.active ? 'Condutor inativado' : 'Condutor ativado');
      await load();
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Erro ao atualizar status do condutor');
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
            <h1 className="mt-3 text-2xl font-bold text-slate-900">Condutores MDF-e</h1>
            <p className="mt-2 text-sm text-slate-600">
              Cadastro isolado dos condutores usados nas emissoes fiscais do MDF-e.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Novo condutor
          </button>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou CPF..."
              className="w-full rounded-xl border border-slate-300 py-2 pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-blue-500"
            />
          </div>
        </section>

        {showForm && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{editingId ? 'Editar condutor' : 'Novo condutor'}</h2>
                <p className="text-sm text-slate-600">Este cadastro fica isolado do modulo atual de usuarios e motoristas.</p>
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
              <FormField label="Nome" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
              <FormField label="CPF" value={form.cpf} onChange={(value) => setForm((current) => ({ ...current, cpf: value }))} />
            </div>

            <label className="mt-5 inline-flex items-center gap-3 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((current) => ({ ...current, active: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Condutor ativo
            </label>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Salvando...' : 'Salvar condutor'}
              </button>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Lista de condutores</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Condutor</th>
                  <th className="px-5 py-3">CPF</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-500">Carregando condutores...</td>
                  </tr>
                ) : filteredDrivers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-500">Nenhum condutor MDF-e encontrado.</td>
                  </tr>
                ) : (
                  filteredDrivers.map((driver) => (
                    <tr key={driver.id} className="text-sm text-slate-700">
                      <td className="px-5 py-4">
                        <div className="flex items-start gap-3">
                          <div className="rounded-xl bg-slate-100 p-2 text-slate-600">
                            <UserRound className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">{driver.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">{driver.cpf}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${driver.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {driver.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(driver)}
                            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleStatus(driver)}
                            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            {driver.active ? 'Inativar' : 'Ativar'}
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
      />
    </label>
  );
}
