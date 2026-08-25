import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Hammer, Loader2, LogOut, RefreshCw, Search, Store, Undo2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import AssemblyAuditPanel from './AssemblyAuditPanel';
import { fetchInChunks } from '../../utils/supabase/batch';
import { useAuthStore } from '../../stores/authStore';
import type { OrderItem, OrderItemHold, StoreReleaseAssignment, UserStoreReleaseLocation } from '../../types/database';
import { getStoreReleaseStatusLabel, normalizeStoreReleaseLocation } from '../../utils/storeRelease';
import { registerPickupForOrder, pickupItemKey, pickupHoldMatchesItem } from '../../utils/pickup/pickupCore';
import { buildPickupReceiptPdf } from '../../utils/pickup/pickupReceipt';
import { mergeReceiptWithDanfe } from '../../utils/pickup/pickupDanfe';
import { DeliverySheetGenerator } from '../../utils/pdf/deliverySheetGenerator';
import { toast } from 'sonner';

type AssignmentRow = StoreReleaseAssignment & {
  order?: {
    id: string;
    order_id_erp: string;
    status?: string | null;
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

type PanelTab = 'release' | 'assembly-audit';

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
  const [activeTab, setActiveTab] = useState<PanelTab>('release');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  const [locations, setLocations] = useState<UserStoreReleaseLocation[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [releasedUserNames, setReleasedUserNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [actionModal, setActionModal] = useState<ActionModalState>(null);
  const [actionNotes, setActionNotes] = useState('');

  // Itens já retirados (picked_up), por pedido — pra esconder da lista do gerente.
  const [pickedUpByOrderId, setPickedUpByOrderId] = useState<Record<string, OrderItemHold[]>>({});
  // Modal de retirada (cliente veio buscar).
  const [pickupModal, setPickupModal] = useState<{ assignment: AssignmentRow; items: OrderItem[] } | null>(null);
  const [pickupSelectedKeys, setPickupSelectedKeys] = useState<Set<string>>(new Set());
  const [pickupNotes, setPickupNotes] = useState('');
  // Quem esta levando o produto. Antes o sistema gravava o nome do GERENTE, o que
  // deixava o comprovante sem serventia: nao havia registro de quem retirou.
  const [pickupResponsibleName, setPickupResponsibleName] = useState('');
  const [pickupSaving, setPickupSaving] = useState(false);

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

      // Carrega os itens já retirados (picked_up) desses pedidos, pra esconder da lista.
      const orderIds = Array.from(new Set(rows.map((r) => String(r.order_id)).filter(Boolean)));
      if (orderIds.length > 0) {
        // Em lotes: .in() com lista grande estoura a URL (400 silencioso).
        const holdsData = await fetchInChunks<string, any>(orderIds, (ids) => supabase
          .from('order_item_holds')
          .select('*')
          .in('order_id', ids)
          .eq('status', 'picked_up')).catch((holdsError) => {
            console.error('[StoreReleaseManagement] Falha ao carregar itens retirados:', holdsError);
            return [] as any[];
          });
        const map: Record<string, OrderItemHold[]> = {};
        (holdsData || []).forEach((h: any) => {
          const key = String(h.order_id);
          (map[key] = map[key] || []).push(h as OrderItemHold);
        });
        setPickedUpByOrderId(map);
      } else {
        setPickedUpByOrderId({});
      }

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

  // Itens do local do gerente ainda disponíveis (esconde os já retirados).
  const visibleAssignmentItems = (assignment: AssignmentRow): OrderItem[] => {
    const base = getAssignmentItems(assignment.order?.items_json, assignment.store_location);
    const pickedUp = pickedUpByOrderId[String(assignment.order_id)] || [];
    return base.filter((it) => !pickedUp.some((h) => pickupHoldMatchesItem(h, it)));
  };

  const openPickupModal = (assignment: AssignmentRow) => {
    const items = visibleAssignmentItems(assignment);
    if (items.length === 0) {
      toast.error('Nenhum produto deste local disponível para retirada.');
      return;
    }
    setPickupModal({ assignment, items });
    setPickupSelectedKeys(new Set(items.map(pickupItemKey)));
    setPickupNotes('');
    setPickupResponsibleName('');
  };

  const closePickupModal = () => {
    setPickupModal(null);
    setPickupSelectedKeys(new Set());
    setPickupNotes('');
    setPickupSaving(false);
  };

  const togglePickupItem = (key: string) => {
    setPickupSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const confirmPickup = async () => {
    if (pickupResponsibleName.trim().length < 3) {
      toast.error('Informe quem esta retirando o produto.');
      return;
    }
    if (!pickupModal || pickupSaving) return;
    const order = pickupModal.assignment.order;
    if (!order) return;

    const pickedItems = pickupModal.items.filter((it) => pickupSelectedKeys.has(pickupItemKey(it)));
    if (pickedItems.length === 0) {
      toast.error('Selecione ao menos um item para a retirada.');
      return;
    }

    try {
      setPickupSaving(true);

      // Enriquece os itens com order_item_id/source_line_key reais (items_json não tem).
      // Casamento por id é estável e não depende de normalização de sku/local (evita que
      // uma re-importação "perca" a retirada e o item volte a ser entregável).
      const { data: orderItemsRows } = await supabase
        .from('order_items')
        .select('id, sku, storage_location, source_line_key')
        .eq('order_id', order.id);
      const enrich = (it: any) => {
        const match = (orderItemsRows || []).find((oi: any) =>
          String(oi.sku || '').toLowerCase() === String(it.sku || '').toLowerCase() &&
          String(oi.storage_location || '').toLowerCase() === String(it.location || it.storage_location || '').toLowerCase()
        ) || (orderItemsRows || []).find((oi: any) =>
          String(oi.sku || '').toLowerCase() === String(it.sku || '').toLowerCase()
        );
        return match ? { ...it, order_item_id: match.id, source_line_key: match.source_line_key } : it;
      };
      const enrichedPicked = pickedItems.map(enrich);

      // Base = todos os itens do pedido ainda não retirados (de todos os locais),
      // pra decidir se o pedido fecha (delivered) ou continua com o restante.
      const pickedUp = pickedUpByOrderId[String(order.id)] || [];
      const allDeliverableItems = ((order.items_json || []) as OrderItem[])
        .filter((it) => !pickedUp.some((h) => pickupHoldMatchesItem(h, it)))
        .map(enrich);

      const { withdrawal, assemblyError } = await registerPickupForOrder({
        order,
        allDeliverableItems,
        pickedItems: enrichedPicked,
        responsibleName: pickupResponsibleName.trim(),
        notes: pickupNotes.trim() || null,
        registeredByUserId: user?.id || null,
        registeredByName: user?.name || user?.email || null,
      });

      // Comprovante de retirada (só dos itens retirados) + NOTA FISCAL, num PDF
      // unico — o mesmo que a tela de admin entrega. O produto nao sai da loja
      // sem documento.
      try {
        const receipt = await buildPickupReceiptPdf(
          [{ order, items: pickedItems, withdrawal }],
          { conferenteName: user?.name || user?.email || '-' }
        );
        const { pdf, semNota } = await mergeReceiptWithDanfe(receipt, [String(order.id)]);
        DeliverySheetGenerator.openPDFInNewTab(pdf);
        if (semNota) {
          toast.warning('Comprovante gerado, mas este pedido ainda nao tem nota fiscal.');
        }
      } catch (pdfError) {
        console.error('Falha ao gerar documentos da retirada:', pdfError);
        toast.warning('Retirada registrada, mas os documentos não puderam ser gerados.');
      }

      if (assemblyError) {
        console.error('Falha ao sincronizar montagem da retirada:', assemblyError);
        toast.warning('Retirada registrada, mas houve falha ao gerar a montagem.');
      }

      toast.success('Retirada registrada com sucesso!');
      closePickupModal();
      await loadData();
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Erro ao registrar retirada');
    } finally {
      setPickupSaving(false);
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
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Painel do Gerente</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">
              {activeTab === 'release' ? 'Liberacao de pedidos' : 'Auditoria de montagem'}
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              {activeTab === 'release'
                ? 'Libere apenas os locais vinculados ao seu perfil. O pedido so fica apto para roteirizacao quando todas as pendencias forem liberadas.'
                : 'Vendas em que o vendedor nao marcou montagem no ERP. Revise uma a uma e decida se a montagem deve ser gerada.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {activeTab === 'release' && (
              <button
                type="button"
                onClick={() => void loadData()}
                className="inline-flex items-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Atualizar
              </button>
            )}
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

        <div className="flex flex-wrap gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab('release')}
            className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'release' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Store className="mr-2 h-4 w-4" />
            Liberacao de saida
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('assembly-audit')}
            className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'assembly-audit' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Hammer className="mr-2 h-4 w-4" />
            Auditoria de montagem
          </button>
        </div>

        {activeTab === 'assembly-audit' && <AssemblyAuditPanel />}

        {activeTab === 'release' && (
        <>
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
                        const assignmentItems = visibleAssignmentItems(assignment);
                        const allPickedUp = getAssignmentItems(order?.items_json, assignment.store_location).length > 0 && assignmentItems.length === 0;

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
                              ) : allPickedUp ? (
                                <p className="text-xs font-semibold text-purple-700">
                                  Todos os produtos deste local foram retirados pelo cliente.
                                </p>
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
                          <div className="mt-4 flex flex-wrap gap-2">
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
                            {assignmentItems.length > 0 && (
                              <button
                                type="button"
                                onClick={() => openPickupModal(assignment)}
                                className="inline-flex flex-1 items-center justify-center rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-sm font-semibold text-purple-700 hover:bg-purple-100"
                                title="Cliente veio buscar o produto na loja"
                              >
                                <Store className="mr-2 h-4 w-4" />
                                Cliente retirou
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
        </>
        )}
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
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Quem esta retirando <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={pickupResponsibleName}
                  onChange={(event) => setPickupResponsibleName(event.target.value)}
                  disabled={pickupSaving}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100"
                  placeholder="Nome de quem esta levando o produto"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Vai no comprovante. E o registro de quem levou a mercadoria da loja.
                </p>
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

      {pickupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-6 py-4">
              <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                <Store className="h-5 w-5 text-purple-600" />
                Cliente retirou na loja
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Pedido {pickupModal.assignment.order?.order_id_erp || '-'} · {pickupModal.assignment.store_location}
              </p>
            </div>
            <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
              <p className="rounded-xl border border-purple-100 bg-purple-50 p-3 text-sm text-gray-600">
                Marque <strong>o que o cliente está levando</strong>. Sai um comprovante só com esses itens; o que ficar
                desmarcado continua no fluxo pra entregar depois.
              </p>

              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between bg-gray-50 px-3 py-2">
                  <span className="text-sm font-semibold text-gray-700">
                    Itens deste local ({pickupSelectedKeys.size}/{pickupModal.items.length})
                  </span>
                  <div className="flex items-center gap-2 text-xs">
                    <button type="button" onClick={() => setPickupSelectedKeys(new Set(pickupModal.items.map(pickupItemKey)))} className="text-purple-700 hover:underline">Todos</button>
                    <span className="text-gray-300">|</span>
                    <button type="button" onClick={() => setPickupSelectedKeys(new Set())} className="text-gray-500 hover:underline">Nenhum</button>
                  </div>
                </div>
                <div className="max-h-60 divide-y divide-gray-100 overflow-y-auto">
                  {pickupModal.items.map((item, index) => {
                    const key = pickupItemKey(item);
                    const checked = pickupSelectedKeys.has(key);
                    return (
                      <label key={`${key}-${index}`} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
                        <input type="checkbox" checked={checked} onChange={() => togglePickupItem(key)} disabled={pickupSaving} className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500" />
                        <span className="flex-1 text-sm text-gray-700">
                          {item.name || item.sku || 'Item'}
                          <span className="ml-2 text-[11px] text-gray-400">Qtd: {item.quantity ?? '-'}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Observacao (opcional)</label>
                <textarea
                  value={pickupNotes}
                  onChange={(event) => setPickupNotes(event.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100"
                  placeholder="Ex: Cliente conferiu no local."
                />
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                Registrado por: <strong>{user?.name || user?.email || 'Gerente'}</strong>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4">
              <button
                type="button"
                onClick={closePickupModal}
                disabled={pickupSaving}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmPickup()}
                disabled={pickupSaving || pickupSelectedKeys.size === 0 || pickupResponsibleName.trim().length < 3}
                className="inline-flex items-center rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pickupSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Store className="mr-2 h-4 w-4" />}
                {pickupSaving ? 'Registrando...' : 'Confirmar retirada'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
