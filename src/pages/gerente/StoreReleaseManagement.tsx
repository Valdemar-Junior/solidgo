import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, LogOut, RefreshCw, Search, Store, Undo2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { useAuthStore } from '../../stores/authStore';
import type { OrderItem, StoreReleaseAssignment, UserStoreReleaseLocation } from '../../types/database';
import { getStoreReleaseStatusLabel, normalizeStoreReleaseLocation } from '../../utils/storeRelease';
import { toast } from 'sonner';

type AssignmentRow = StoreReleaseAssignment & {
  order?: {
    id: string;
    order_id_erp: string;
    customer_name: string;
    customer_cpf?: string | null;
    phone?: string | null;
    address_json?: {
      street?: string;
      neighborhood?: string;
      city?: string;
    } | null;
    items_json?: OrderItem[] | null;
    previsao_entrega?: string | null;
    blocked_at?: string | null;
    store_release_status?: string | null;
  } | null;
};

type ActionModalState = {
  action: 'release' | 'revert';
  assignment: AssignmentRow;
} | null;

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
}

function getAssignmentItems(items: OrderItem[] | null | undefined, storeLocation: string): OrderItem[] {
  const normalizedLocation = normalizeStoreReleaseLocation(storeLocation);
  return (items || []).filter((item) => normalizeStoreReleaseLocation(item.location) === normalizedLocation);
}

export default function StoreReleaseManagement() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  const [locations, setLocations] = useState<UserStoreReleaseLocation[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [releasedUserNames, setReleasedUserNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [actionModal, setActionModal] = useState<ActionModalState>(null);
  const [actionNotes, setActionNotes] = useState('');

  const fetchUserNamesByIds = async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)));
    if (uniqueIds.length === 0) return {} as Record<string, string>;

    const namesMap: Record<string, string> = {};

    const { data: directData, error: directError } = await supabase
      .from('users')
      .select('id, name')
      .in('id', uniqueIds);

    if (!directError && directData) {
      for (const row of directData as Array<{ id: string; name: string }>) {
        namesMap[String(row.id)] = String(row.name || '').trim();
      }
    }

    const missingIds = uniqueIds.filter((id) => !namesMap[id]);
    if (missingIds.length > 0) {
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_users_names_by_ids', {
        p_user_ids: missingIds,
      });

      if (rpcError) {
        console.warn('[StoreReleaseManagement] Falha ao buscar nomes via RPC:', rpcError.message);
      } else {
        for (const row of (rpcData || []) as Array<{ id: string; name: string }>) {
          namesMap[String(row.id)] = String(row.name || '').trim();
        }
      }
    }

    return namesMap;
  };

  const loadData = async () => {
    if (!user?.id) return;

    try {
      setLoading(true);

      const { data: myLocations, error: locationsError } = await supabase
        .from('user_store_release_locations')
        .select('id, user_id, store_location, created_at, updated_at')
        .eq('user_id', user.id)
        .order('store_location');

      if (locationsError) throw locationsError;

      const locationRows = (myLocations || []) as UserStoreReleaseLocation[];
      setLocations(locationRows);

      if (locationRows.length === 0) {
        setAssignments([]);
        return;
      }

      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('store_release_assignments')
        .select(`
          id,
          order_id,
          store_location,
          status,
          released_at,
          released_by_user_id,
          release_notes,
          created_at,
          updated_at,
          order:orders(
            id,
            order_id_erp,
            status,
            customer_name,
            customer_cpf,
            phone,
            address_json,
            items_json,
            previsao_entrega,
            blocked_at,
            store_release_status
          )
        `)
        .in('store_location', locationRows.map((item) => item.store_location))
        .order('updated_at', { ascending: false });

      if (assignmentsError) throw assignmentsError;

      const rows = ((assignmentsData || []) as AssignmentRow[]).filter(
        (item) => !item.order?.blocked_at && item.order?.status === 'pending'
      );
      setAssignments(rows);

      const releasedIds = Array.from(
        new Set(
          rows
            .map((item) => String(item.released_by_user_id || '').trim())
            .filter(Boolean)
        )
      );

      if (releasedIds.length > 0) {
        const namesMap = await fetchUserNamesByIds(releasedIds);
        setReleasedUserNames(namesMap);
      } else {
        setReleasedUserNames({});
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro ao carregar liberacoes de saida de loja');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [user?.id]);

  const filteredAssignments = useMemo(() => {
    const term = search.trim().toLowerCase();
    return assignments.filter((assignment) => {
      if (statusFilter === 'pending' && assignment.status !== 'pending') return false;
      const haystack = [
        assignment.order?.order_id_erp,
        assignment.order?.customer_name,
        assignment.order?.customer_cpf,
        assignment.store_location,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return !term || haystack.includes(term);
    });
  }, [assignments, search, statusFilter]);

  const groupedAssignments = useMemo(() => {
    const map = new Map<string, AssignmentRow[]>();
    filteredAssignments.forEach((assignment) => {
      const key = String(assignment.order_id);
      const current = map.get(key) || [];
      current.push(assignment);
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => {
      const aOrder = a[0]?.order?.order_id_erp || '';
      const bOrder = b[0]?.order?.order_id_erp || '';
      return String(bOrder).localeCompare(String(aOrder), 'pt-BR', { numeric: true });
    });
  }, [filteredAssignments]);

  const openActionModal = (assignment: AssignmentRow, action: 'release' | 'revert') => {
    setActionModal({ assignment, action });
    setActionNotes(action === 'release' ? '' : assignment.release_notes || '');
  };

  const closeActionModal = () => {
    setActionModal(null);
    setActionNotes('');
  };

  const submitAction = async () => {
    if (!actionModal) return;

    try {
      setSaving(true);
      const { error } = await supabase.rpc('set_store_release_assignment', {
        p_order_id: actionModal.assignment.order_id,
        p_store_location: actionModal.assignment.store_location,
        p_released: actionModal.action === 'release',
        p_notes: actionNotes.trim() || null,
      });

      if (error) throw error;

      toast.success(actionModal.action === 'release' ? 'Liberacao registrada.' : 'Liberacao revertida.');
      closeActionModal();
      await loadData();
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Erro ao registrar liberacao');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Saida de Loja</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">Liberacao de pedidos</h1>
            <p className="mt-2 text-sm text-gray-500">
              Libere apenas os locais vinculados ao seu perfil. O pedido so fica apto para roteirizacao quando todas as pendencias forem liberadas.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void loadData()}
              className="inline-flex items-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Atualizar
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Locais autorizados</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{locations.length}</p>
            <p className="mt-2 text-xs text-gray-500">
              {locations.map((item) => item.store_location).join(' • ') || 'Nenhum local vinculado'}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Pendencias filtradas</p>
            <p className="mt-2 text-2xl font-bold text-amber-600">
              {filteredAssignments.filter((item) => item.status === 'pending').length}
            </p>
            <p className="mt-2 text-xs text-gray-500">Pendencias em locais sob sua responsabilidade.</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Pedidos no resultado</p>
            <p className="mt-2 text-2xl font-bold text-emerald-600">{groupedAssignments.length}</p>
            <p className="mt-2 text-xs text-gray-500">Agrupados por pedido para liberar de forma objetiva.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-[1fr_220px]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por pedido, cliente, CPF ou local..."
                className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-4 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
            </label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'pending' | 'all')}
              className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            >
              <option value="pending">Somente pendentes</option>
              <option value="all">Todos</option>
            </select>
          </div>
        </div>

        <div className="space-y-4">
          {loading ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-500 shadow-sm">
              Carregando liberacoes...
            </div>
          ) : groupedAssignments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500 shadow-sm">
              Nenhum pedido aguardando liberacao para os filtros atuais.
            </div>
          ) : (
            groupedAssignments.map((group) => {
              const order = group[0]?.order;
              return (
                <div key={group[0].order_id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          Pedido {order?.order_id_erp || '-'}
                        </span>
                        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                          {getStoreReleaseStatusLabel(order?.store_release_status)}
                        </span>
                      </div>
                      <h2 className="text-lg font-bold text-gray-900">{order?.customer_name || 'Cliente nao informado'}</h2>
                      <div className="space-y-1 text-sm text-gray-500">
                        <p>CPF: {order?.customer_cpf || '-'}</p>
                        <p>Telefone: {order?.phone || '-'}</p>
                        <p>
                          Endereco: {order?.address_json?.street || '-'}
                          {order?.address_json?.neighborhood ? ` - ${order.address_json.neighborhood}` : ''}
                          {order?.address_json?.city ? ` - ${order.address_json.city}` : ''}
                        </p>
                        <p>Previsao de entrega: {order?.previsao_entrega ? formatDateTime(order.previsao_entrega) : '-'}</p>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.map((assignment) => {
                        const assignmentItems = getAssignmentItems(order?.items_json, assignment.store_location);

                        return (
                        <div key={assignment.id} className="min-w-[280px] rounded-xl border border-gray-200 bg-gray-50 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Store className="h-4 w-4 text-emerald-600" />
                              <p className="text-sm font-semibold text-gray-900">{assignment.store_location}</p>
                            </div>
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${assignment.status === 'released' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                              {assignment.status === 'released' ? 'Liberado' : 'Pendente'}
                            </span>
                          </div>
                          <div className="mt-3 rounded-xl border border-white bg-white/80 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                              Produtos deste local
                            </p>
                            <div className="mt-2 space-y-2">
                              {assignmentItems.length > 0 ? (
                                assignmentItems.map((item, index) => (
                                  <div key={`${assignment.id}-${item.sku}-${index}`} className="rounded-lg bg-gray-50 px-3 py-2">
                                    <p className="text-xs font-semibold text-gray-900">{item.name || 'Produto sem descricao'}</p>
                                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600">
                                      <span>SKU: {item.sku || '-'}</span>
                                      <span>Qtd: {item.quantity ?? '-'}</span>
                                      <span>Local: {item.location || assignment.store_location}</span>
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <p className="text-xs text-gray-500">
                                  Nenhum produto deste local foi encontrado no pedido.
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="mt-3 space-y-1 text-xs text-gray-600">
                            <p>Criado em: {formatDateTime(assignment.created_at)}</p>
                            {assignment.released_at && <p>Liberado em: {formatDateTime(assignment.released_at)}</p>}
                            {assignment.released_by_user_id && (
                              <p>
                                Liberado por: {releasedUserNames[String(assignment.released_by_user_id)] || assignment.released_by_user_id}
                              </p>
                            )}
                            {assignment.release_notes && <p>Obs.: {assignment.release_notes}</p>}
                          </div>
                          <div className="mt-4 flex gap-2">
                            {assignment.status === 'pending' ? (
                              <button
                                type="button"
                                onClick={() => openActionModal(assignment, 'release')}
                                className="inline-flex flex-1 items-center justify-center rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                              >
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Liberar
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openActionModal(assignment, 'revert')}
                                className="inline-flex flex-1 items-center justify-center rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50"
                              >
                                <Undo2 className="mr-2 h-4 w-4" />
                                Reverter
                              </button>
                            )}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-6 py-4">
              <h3 className="text-lg font-bold text-gray-900">
                {actionModal.action === 'release' ? 'Liberar saida de loja' : 'Reverter liberacao'}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Pedido {actionModal.assignment.order?.order_id_erp || '-'} - {actionModal.assignment.store_location}
              </p>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                {actionModal.action === 'release'
                  ? 'Confirme que o produto deste local esta desmontado e pronto para seguir no fluxo logístico.'
                  : 'Use a reversao apenas quando a liberacao tiver sido feita por engano ou a loja ainda nao estiver pronta.'}
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Observacao (opcional)</label>
                <textarea
                  value={actionNotes}
                  onChange={(event) => setActionNotes(event.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  placeholder="Descreva algo util para consulta futura..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4">
              <button
                type="button"
                onClick={closeActionModal}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void submitAction()}
                disabled={saving}
                className="inline-flex items-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                {actionModal.action === 'release' ? 'Confirmar liberacao' : 'Confirmar reversao'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
