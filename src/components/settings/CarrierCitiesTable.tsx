import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabase/client';
import { Building2, Loader2, Plus, Trash2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import type { CarrierCity } from '../../types/database';

type OrderCityRow = {
  address_json?: {
    city?: string | null;
  } | null;
  raw_json?: {
    destinatario_cidade?: string | null;
  } | null;
};

const normalizeCityName = (value: string) => String(value || '').trim().toUpperCase();

export function CarrierCitiesTable() {
  const [carrierCities, setCarrierCities] = useState<CarrierCity[]>([]);
  const [availableCities, setAvailableCities] = useState<string[]>([]);
  const [selectedCity, setSelectedCity] = useState('');
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [carrierCitiesAvailable, setCarrierCitiesAvailable] = useState(true);

  const carrierCitySet = useMemo(
    () => new Set((carrierCities || []).map((item) => normalizeCityName(item.city_name))),
    [carrierCities]
  );

  const selectableCities = useMemo(
    () => availableCities.filter((city) => !carrierCitySet.has(normalizeCityName(city))),
    [availableCities, carrierCitySet]
  );

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      const [{ data: orderCitiesData, error: orderCitiesError }, { data: carrierData, error: carrierError }] = await Promise.all([
        supabase
          .from('orders')
          .select('address_json, raw_json')
          .order('created_at', { ascending: false }),
        supabase
          .from('carrier_cities')
          .select('id, city_name, active, created_at, updated_at')
          .eq('active', true)
          .order('city_name'),
      ]);

      if (orderCitiesError) throw orderCitiesError;

      if (carrierError) {
        console.warn('carrier_cities unavailable:', carrierError);
        setCarrierCitiesAvailable(false);
        setCarrierCities([]);
      } else {
        setCarrierCitiesAvailable(true);
        setCarrierCities((carrierData || []) as CarrierCity[]);
      }

      const cities = Array.from(
        new Set(
          ((orderCitiesData || []) as OrderCityRow[])
            .map((row) => normalizeCityName(String(row.address_json?.city || row.raw_json?.destinatario_cidade || '')))
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

      setAvailableCities(cities);
    } catch (error) {
      console.error('Error loading carrier cities:', error);
      toast.error('Erro ao carregar cidades disponíveis');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    const cityName = normalizeCityName(selectedCity);
    if (!cityName) {
      toast.error('Selecione uma cidade');
      return;
    }
    if (!carrierCitiesAvailable) {
      toast.error('Rode a migration de carrier_cities antes de salvar cidades de transportadora');
      return;
    }

    try {
      setAdding(true);
      const { data, error } = await supabase
        .from('carrier_cities')
        .insert({ city_name: cityName, active: true })
        .select('id, city_name, active, created_at, updated_at')
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new Error('Cidade já cadastrada como transportadora');
        }
        throw error;
      }

      setCarrierCities((prev) =>
        [...prev, data as CarrierCity].sort((a, b) =>
          String(a.city_name).localeCompare(String(b.city_name), 'pt-BR', { sensitivity: 'base' })
        )
      );
      setSelectedCity('');
      toast.success('Cidade adicionada à lista de transportadora');
    } catch (error: any) {
      console.error('Error adding carrier city:', error);
      toast.error(error?.message || 'Erro ao adicionar cidade');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (city: CarrierCity) => {
    if (!window.confirm(`Remover ${city.city_name} da lista de cidades atendidas por transportadora?`)) {
      return;
    }

    if (!carrierCitiesAvailable) {
      toast.error('Rode a migration de carrier_cities antes de editar esta lista');
      return;
    }

    try {
      setRemovingId(city.id);
      const { error } = await supabase
        .from('carrier_cities')
        .update({ active: false })
        .eq('id', city.id);

      if (error) throw error;

      setCarrierCities((prev) => prev.filter((item) => item.id !== city.id));
      toast.success('Cidade removida da lista de transportadora');
    } catch (error) {
      console.error('Error removing carrier city:', error);
      toast.error('Erro ao remover cidade');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 flex items-center gap-2">
        <Truck className="h-5 w-5 text-amber-600" />
        <h2 className="font-bold text-gray-900">Cidades Atendidas por Transportadora</h2>
      </div>

      <div className="p-6 space-y-4">
        <p className="text-sm text-gray-600">
          Use esta lista para habilitar o filtro de cidades de transportadora na tela de rotas.
          Isso <b>não</b> marca pedidos automaticamente.
        </p>

        {!carrierCitiesAvailable && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            As cidades disponíveis já podem ser consultadas, mas para salvar cidades de transportadora você precisa rodar a migration da tabela <code>carrier_cities</code>.
          </div>
        )}

        <div className="flex flex-col gap-3 md:flex-row">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Cidade</label>
            <select
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
              className="w-full border-gray-300 rounded-lg text-sm px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all"
            >
              <option value="">Selecione uma cidade disponível</option>
              {selectableCities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleAdd}
              disabled={adding || !selectedCity || !carrierCitiesAvailable}
              className="bg-amber-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-amber-600 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Adicionar
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-gray-50/50">
          {loading ? (
            <div className="py-10 text-center text-gray-400">
              <Loader2 className="h-6 w-6 mx-auto animate-spin mb-2" />
              Carregando cidades...
            </div>
          ) : carrierCities.length === 0 ? (
            <div className="py-10 text-center text-gray-400">
              <Building2 className="h-6 w-6 mx-auto mb-2" />
              Nenhuma cidade configurada para transportadora.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 p-4">
              {carrierCities.map((city) => (
                <span
                  key={city.id}
                  className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800"
                >
                  {city.city_name}
                  <button
                    onClick={() => handleRemove(city)}
                    disabled={removingId === city.id || !carrierCitiesAvailable}
                    className="rounded-full p-0.5 text-amber-700 hover:bg-amber-100 hover:text-amber-900 disabled:opacity-50"
                    title={`Remover ${city.city_name}`}
                  >
                    {removingId === city.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
