import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CarFront, Plus, Save, Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../supabase/client';

type MdfeVehicle = {
  id: string;
  display_name: string;
  plate: string;
  renavam: string | null;
  tara_kg: number;
  capacity_kg: number | null;
  capacity_m3: number | null;
  body_type: string;
  rodado_type: string | null;
  licensing_uf: string;
  active: boolean;
  created_at: string;
};

type VehicleFormState = Omit<MdfeVehicle, 'id' | 'created_at'>;

const RODADO_OPTIONS = [
  { value: '01', label: '01 - Truck' },
  { value: '02', label: '02 - Toco' },
  { value: '03', label: '03 - Cavalo Mecânico' },
  { value: '04', label: '04 - VAN' },
  { value: '05', label: '05 - Utilitário' },
  { value: '06', label: '06 - Outros' },
];

const CARROCERIA_OPTIONS = [
  { value: '00', label: '00 - Não Aplicável' },
  { value: '01', label: '01 - Aberta' },
  { value: '02', label: '02 - Fechada/Baú' },
  { value: '03', label: '03 - Graneleira' },
  { value: '04', label: '04 - Porta Container' },
  { value: '05', label: '05 - Sider' },
];

const EMPTY_FORM: VehicleFormState = {
  display_name: '',
  plate: '',
  renavam: '',
  tara_kg: 0,
  capacity_kg: null,
  capacity_m3: null,
  body_type: '',
  rodado_type: '',
  licensing_uf: '',
  active: true,
};

export default function MdfeVehicles() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [vehicles, setVehicles] = useState<MdfeVehicle[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<VehicleFormState>(EMPTY_FORM);

  useEffect(() => {
    load();
  }, []);

  const filteredVehicles = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return vehicles;
    return vehicles.filter((vehicle) =>
      [
        vehicle.display_name,
        vehicle.plate,
        vehicle.body_type,
        vehicle.licensing_uf,
      ].some((value) => String(value || '').toLowerCase().includes(term))
    );
  }, [vehicles, search]);

  const load = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('mdfe_vehicles')
        .select('*')
        .order('display_name', { ascending: true });

      if (error) throw error;
      setVehicles((data || []) as MdfeVehicle[]);
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Erro ao carregar veiculos MDF-e');
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

  const openEdit = (vehicle: MdfeVehicle) => {
    setEditingId(vehicle.id);
    setForm({
      display_name: vehicle.display_name,
      plate: vehicle.plate,
      renavam: vehicle.renavam || '',
      tara_kg: vehicle.tara_kg,
      capacity_kg: vehicle.capacity_kg,
      capacity_m3: vehicle.capacity_m3,
      body_type: vehicle.body_type,
      rodado_type: vehicle.rodado_type || '',
      licensing_uf: vehicle.licensing_uf,
      active: vehicle.active,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.display_name.trim() || !form.plate.trim() || !form.body_type.trim() || !form.rodado_type?.trim() || !form.licensing_uf.trim()) {
      toast.error('Preencha nome, placa, tipo de rodado, carroceria e UF de licenciamento');
      return;
    }

    if (Number(form.tara_kg) < 0) {
      toast.error('Informe uma tara valida');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        id: editingId || undefined,
        display_name: form.display_name.trim(),
        plate: form.plate.trim().toUpperCase(),
        renavam: form.renavam?.trim() || null,
        tara_kg: Number(form.tara_kg || 0),
        capacity_kg: form.capacity_kg === null || form.capacity_kg === undefined || String(form.capacity_kg) === '' ? null : Number(form.capacity_kg),
        capacity_m3: form.capacity_m3 === null || form.capacity_m3 === undefined || String(form.capacity_m3) === '' ? null : Number(form.capacity_m3),
        body_type: form.body_type.trim(),
        rodado_type: form.rodado_type?.trim() || null,
        licensing_uf: form.licensing_uf.trim().toUpperCase(),
        active: form.active,
      };

      const query = editingId
        ? supabase.from('mdfe_vehicles').update(payload).eq('id', editingId)
        : supabase.from('mdfe_vehicles').insert(payload);

      const { error } = await query;
      if (error) throw error;

      toast.success(editingId ? 'Veiculo MDF-e atualizado' : 'Veiculo MDF-e cadastrado');
      resetForm();
      await load();
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Erro ao salvar veiculo MDF-e');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (vehicle: MdfeVehicle) => {
    try {
      const { error } = await supabase
        .from('mdfe_vehicles')
        .update({ active: !vehicle.active })
        .eq('id', vehicle.id);

      if (error) throw error;
      toast.success(vehicle.active ? 'Veiculo inativado' : 'Veiculo ativado');
      await load();
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Erro ao atualizar status do veiculo');
    } finally {
      setSaving(false);
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
            <h1 className="mt-3 text-2xl font-bold text-slate-900">Veiculos MDF-e</h1>
            <p className="mt-2 text-sm text-slate-600">
              Cadastro isolado com os campos fiscais e logísticos que a emissao do MDF-e exige.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Novo veiculo
          </button>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, placa ou carroceria..."
              className="w-full rounded-xl border border-slate-300 py-2 pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-blue-500"
            />
          </div>
        </section>

        {showForm && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{editingId ? 'Editar veiculo' : 'Novo veiculo'}</h2>
                <p className="text-sm text-slate-600">Use apenas os dados do veiculo fiscal que serao enviados no MDF-e.</p>
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
              <FormField label="Nome do veiculo" value={form.display_name} onChange={(value) => setForm((current) => ({ ...current, display_name: value }))} />
              <FormField label="Placa" value={form.plate} onChange={(value) => setForm((current) => ({ ...current, plate: value.toUpperCase() }))} />
              <FormField label="RENAVAM" value={form.renavam || ''} onChange={(value) => setForm((current) => ({ ...current, renavam: value }))} />
              <NumberField label="Tara (KG)" value={form.tara_kg} onChange={(value) => setForm((current) => ({ ...current, tara_kg: value }))} />
              <NumberField label="Capacidade (KG)" value={form.capacity_kg} onChange={(value) => setForm((current) => ({ ...current, capacity_kg: value }))} />
              <NumberField label="Capacidade (M3)" value={form.capacity_m3} onChange={(value) => setForm((current) => ({ ...current, capacity_m3: value }))} />
              <SelectCodeField
                label="Tipo de carroceria"
                value={form.body_type}
                onChange={(value) => setForm((current) => ({ ...current, body_type: value }))}
                options={CARROCERIA_OPTIONS}
              />
              <SelectCodeField
                label="Tipo de rodado"
                value={form.rodado_type || ''}
                onChange={(value) => setForm((current) => ({ ...current, rodado_type: value }))}
                options={RODADO_OPTIONS}
              />
              <FormField label="UF licenciamento" value={form.licensing_uf} maxLength={2} onChange={(value) => setForm((current) => ({ ...current, licensing_uf: value.toUpperCase() }))} />
            </div>

            <label className="mt-5 inline-flex items-center gap-3 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((current) => ({ ...current, active: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Veiculo ativo
            </label>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Salvando...' : 'Salvar veiculo'}
              </button>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Lista de veiculos</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Veiculo</th>
                  <th className="px-5 py-3">Placa</th>
                  <th className="px-5 py-3">Tara</th>
                  <th className="px-5 py-3">UF</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">Carregando veiculos...</td>
                  </tr>
                ) : filteredVehicles.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">Nenhum veiculo MDF-e encontrado.</td>
                  </tr>
                ) : (
                  filteredVehicles.map((vehicle) => (
                    <tr key={vehicle.id} className="text-sm text-slate-700">
                      <td className="px-5 py-4">
                        <div className="flex items-start gap-3">
                          <div className="rounded-xl bg-slate-100 p-2 text-slate-600">
                            <CarFront className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">{vehicle.display_name}</p>
                            <p className="text-xs text-slate-500">{vehicle.body_type}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">{vehicle.plate}</td>
                      <td className="px-5 py-4">{vehicle.tara_kg} KG</td>
                      <td className="px-5 py-4">{vehicle.licensing_uf}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${vehicle.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {vehicle.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(vehicle)}
                            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleStatus(vehicle)}
                            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            {vehicle.active ? 'Inativar' : 'Ativar'}
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

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
      />
    </label>
  );
}

function SelectCodeField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
      >
        <option value="">Selecione...</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
