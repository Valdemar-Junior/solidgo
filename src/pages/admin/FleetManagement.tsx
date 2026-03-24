import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import supabase from '../../supabase/client';
import {
  AlertTriangle,
  CalendarRange,
  Camera,
  CarFront,
  CheckCircle2,
  ClipboardList,
  Edit,
  Eye,
  Loader2,
  PauseCircle,
  Plus,
  Search,
  ShieldAlert,
  Wrench,
  X,
} from 'lucide-react';
import { PhotoCaptureModal, PhotoGallery, type CapturedPhoto, type PhotoItem } from '../../components/photos';
import { FLEET_INSPECTION_CHECKLIST, calculateFleetInspectionOverallStatus } from '../../constants/fleetInspectionChecklist';
import FleetPhotoService from '../../services/fleetPhotoService';
import type {
  FleetInspection,
  FleetInspectionItem,
  FleetInspectionItemStatus,
  FleetOccurrence,
  FleetOccurrenceStatus,
  FleetVehicle,
  FleetVehicleStatus,
} from '../../types/database';

type FleetTab = 'vehicles' | 'inspections' | 'occurrences';

interface FleetVehicleFormState {
  display_name: string;
  plate: string;
  brand: string;
  model: string;
  model_year: string;
  vehicle_type: string;
  renavam: string;
  chassis: string;
  current_odometer: string;
  status: FleetVehicleStatus;
  notes: string;
}

interface InspectionDraftItem {
  item_code: string;
  category: string;
  label: string;
  sort_order: number;
  status: FleetInspectionItemStatus;
  notes: string;
}

const EMPTY_VEHICLE_FORM: FleetVehicleFormState = {
  display_name: '',
  plate: '',
  brand: '',
  model: '',
  model_year: '',
  vehicle_type: '',
  renavam: '',
  chassis: '',
  current_odometer: '0',
  status: 'available',
  notes: '',
};

const VEHICLE_STATUS_LABELS: Record<FleetVehicleStatus, string> = {
  available: 'Disponível',
  maintenance: 'Em manutenção',
  inactive: 'Inativo',
};

const VEHICLE_STATUS_CLASSES: Record<FleetVehicleStatus, string> = {
  available: 'bg-emerald-100 text-emerald-700',
  maintenance: 'bg-amber-100 text-amber-700',
  inactive: 'bg-gray-100 text-gray-600',
};

const INSPECTION_STATUS_LABELS = {
  approved: 'Aprovada',
  attention: 'Atenção',
  critical: 'Crítica',
} as const;

const INSPECTION_STATUS_CLASSES = {
  approved: 'bg-emerald-100 text-emerald-700',
  attention: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
} as const;

const ITEM_STATUS_LABELS: Record<FleetInspectionItemStatus, string> = {
  ok: 'OK',
  attention: 'Atenção',
  critical: 'Crítico',
  na: 'N/A',
};

const OCCURRENCE_STATUS_LABELS: Record<FleetOccurrenceStatus, string> = {
  open: 'Aberta',
  in_progress: 'Em andamento',
  resolved: 'Resolvida',
  cancelled: 'Cancelada',
};

const OCCURRENCE_STATUS_CLASSES: Record<FleetOccurrenceStatus, string> = {
  open: 'bg-red-100 text-red-700',
  in_progress: 'bg-amber-100 text-amber-700',
  resolved: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

function buildInspectionItems(): InspectionDraftItem[] {
  return FLEET_INSPECTION_CHECKLIST.map((item) => ({
    ...item,
    status: 'ok' as FleetInspectionItemStatus,
    notes: '',
  }));
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-BR');
}

function formatDateInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateTimeLocal(value?: string | null) {
  const date = value ? new Date(value) : new Date();
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizePlate(value: string) {
  return value.toUpperCase().replace(/\s+/g, '').trim();
}

function sortInspectionItems(items?: FleetInspectionItem[]) {
  return [...(items || [])].sort((a, b) => a.sort_order - b.sort_order);
}

function ModalShell({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'max-w-4xl',
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`w-full ${size} max-h-[92vh] overflow-hidden rounded-2xl bg-white shadow-2xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4 bg-gray-50">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(92vh-144px)] overflow-auto px-6 py-5">
          {children}
        </div>

        {footer && (
          <div className="border-t border-gray-100 bg-gray-50 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  bgClass,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  bgClass: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl ${bgClass}`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

export default function FleetManagement() {
  const [activeTab, setActiveTab] = useState<FleetTab>('vehicles');
  const [loading, setLoading] = useState(true);

  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [inspections, setInspections] = useState<FleetInspection[]>([]);
  const [occurrences, setOccurrences] = useState<FleetOccurrence[]>([]);

  const [searchTerm, setSearchTerm] = useState('');
  const [vehicleStatusFilter, setVehicleStatusFilter] = useState<'all' | FleetVehicleStatus>('all');
  const [inspectionStatusFilter, setInspectionStatusFilter] = useState<'all' | FleetInspection['overall_status']>('all');
  const [occurrenceStatusFilter, setOccurrenceStatusFilter] = useState<'all' | FleetOccurrenceStatus>('all');
  const [inspectionDateFrom, setInspectionDateFrom] = useState('');
  const [inspectionDateTo, setInspectionDateTo] = useState('');

  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [vehicleSaving, setVehicleSaving] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<FleetVehicle | null>(null);
  const [vehicleForm, setVehicleForm] = useState<FleetVehicleFormState>(EMPTY_VEHICLE_FORM);

  const [showInspectionModal, setShowInspectionModal] = useState(false);
  const [inspectionSaving, setInspectionSaving] = useState(false);
  const [inspectionVehicleId, setInspectionVehicleId] = useState('');
  const [inspectionAt, setInspectionAt] = useState(formatDateTimeLocal());
  const [inspectionOdometer, setInspectionOdometer] = useState('');
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [inspectionItems, setInspectionItems] = useState<InspectionDraftItem[]>(buildInspectionItems());
  const [inspectionPhotos, setInspectionPhotos] = useState<CapturedPhoto[]>([]);
  const [showPhotoCaptureModal, setShowPhotoCaptureModal] = useState(false);

  const [selectedInspection, setSelectedInspection] = useState<FleetInspection | null>(null);
  const [selectedInspectionPhotoItems, setSelectedInspectionPhotoItems] = useState<PhotoItem[]>([]);
  const [inspectionDetailLoading, setInspectionDetailLoading] = useState(false);

  const [occurrenceTarget, setOccurrenceTarget] = useState<FleetOccurrence | null>(null);
  const [occurrenceNextStatus, setOccurrenceNextStatus] = useState<'resolved' | 'cancelled'>('resolved');
  const [occurrenceResolutionNotes, setOccurrenceResolutionNotes] = useState('');
  const [occurrenceSubmitting, setOccurrenceSubmitting] = useState(false);

  useEffect(() => {
    loadFleetData();
  }, []);

  const loadFleetData = async () => {
    try {
      setLoading(true);

      const [vehiclesRes, inspectionsRes, occurrencesRes] = await Promise.all([
        supabase
          .from('fleet_vehicles')
          .select('*')
          .order('active', { ascending: false })
          .order('display_name'),
        supabase
          .from('fleet_inspections')
          .select(`
            *,
            vehicle:fleet_vehicles(*),
            items:fleet_inspection_items(*),
            photos:fleet_inspection_photos(*)
          `)
          .order('inspection_at', { ascending: false }),
        supabase
          .from('fleet_occurrences')
          .select(`
            *,
            vehicle:fleet_vehicles(*)
          `)
          .order('created_at', { ascending: false }),
      ]);

      if (vehiclesRes.error) throw vehiclesRes.error;
      if (inspectionsRes.error) throw inspectionsRes.error;
      if (occurrencesRes.error) throw occurrencesRes.error;

      const inspectionsData = ((inspectionsRes.data || []) as FleetInspection[]).map((inspection) => ({
        ...inspection,
        items: sortInspectionItems(inspection.items),
        photos: inspection.photos || [],
      }));

      setVehicles((vehiclesRes.data || []) as FleetVehicle[]);
      setInspections(inspectionsData);
      setOccurrences((occurrencesRes.data || []) as FleetOccurrence[]);
    } catch (error) {
      console.error(error);
      toast.error('Falha ao carregar o módulo de frota');
    } finally {
      setLoading(false);
    }
  };

  const metrics = useMemo(() => ({
    activeVehicles: vehicles.filter((vehicle) => vehicle.active).length,
    inspections: inspections.length,
    openOccurrences: occurrences.filter((occurrence) => ['open', 'in_progress'].includes(occurrence.status)).length,
  }), [vehicles, inspections, occurrences]);

  const filteredVehicles = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      const matchesStatus = vehicleStatusFilter === 'all' ? true : vehicle.status === vehicleStatusFilter;
      const haystack = [
        vehicle.display_name,
        vehicle.plate,
        vehicle.brand,
        vehicle.model,
      ].join(' ').toLowerCase();
      const matchesSearch = term ? haystack.includes(term) : true;
      return matchesStatus && matchesSearch;
    });
  }, [vehicles, searchTerm, vehicleStatusFilter]);

  const filteredInspections = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return inspections.filter((inspection) => {
      const vehicle = inspection.vehicle;
      const haystack = [
        vehicle?.display_name,
        vehicle?.plate,
        vehicle?.brand,
        vehicle?.model,
      ].join(' ').toLowerCase();
      const matchesSearch = term ? haystack.includes(term) : true;
      const matchesStatus = inspectionStatusFilter === 'all' ? true : inspection.overall_status === inspectionStatusFilter;
      const inspectionDate = formatDateInput(inspection.inspection_at);
      const matchesDateFrom = inspectionDateFrom ? inspectionDate >= inspectionDateFrom : true;
      const matchesDateTo = inspectionDateTo ? inspectionDate <= inspectionDateTo : true;
      return matchesSearch && matchesStatus && matchesDateFrom && matchesDateTo;
    });
  }, [inspections, searchTerm, inspectionStatusFilter, inspectionDateFrom, inspectionDateTo]);

  const filteredOccurrences = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return occurrences.filter((occurrence) => {
      const vehicle = occurrence.vehicle;
      const haystack = [
        occurrence.title,
        occurrence.description,
        vehicle?.display_name,
        vehicle?.plate,
      ].join(' ').toLowerCase();
      const matchesSearch = term ? haystack.includes(term) : true;
      const matchesStatus = occurrenceStatusFilter === 'all' ? true : occurrence.status === occurrenceStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [occurrences, searchTerm, occurrenceStatusFilter]);

  const activeFleetVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.active),
    [vehicles]
  );

  const inspectionDraftStatus = useMemo(
    () => calculateFleetInspectionOverallStatus(inspectionItems),
    [inspectionItems]
  );

  const resetVehicleForm = () => {
    setVehicleForm(EMPTY_VEHICLE_FORM);
    setEditingVehicle(null);
  };

  const openVehicleModal = (vehicle?: FleetVehicle) => {
    if (vehicle) {
      setEditingVehicle(vehicle);
      setVehicleForm({
        display_name: vehicle.display_name,
        plate: vehicle.plate,
        brand: vehicle.brand,
        model: vehicle.model,
        model_year: vehicle.model_year ? String(vehicle.model_year) : '',
        vehicle_type: vehicle.vehicle_type || '',
        renavam: vehicle.renavam || '',
        chassis: vehicle.chassis || '',
        current_odometer: String(vehicle.current_odometer || 0),
        status: vehicle.status,
        notes: vehicle.notes || '',
      });
    } else {
      resetVehicleForm();
    }
    setShowVehicleModal(true);
  };

  const closeVehicleModal = () => {
    setShowVehicleModal(false);
    resetVehicleForm();
  };

  const saveVehicle = async () => {
    if (!vehicleForm.display_name.trim() || !vehicleForm.plate.trim() || !vehicleForm.brand.trim() || !vehicleForm.model.trim()) {
      toast.error('Preencha nome, placa, marca e modelo');
      return;
    }

    const odometer = Number(vehicleForm.current_odometer || 0);
    if (Number.isNaN(odometer) || odometer < 0) {
      toast.error('Informe um hodômetro válido');
      return;
    }

    setVehicleSaving(true);
    try {
      const payload = {
        display_name: vehicleForm.display_name.trim(),
        plate: normalizePlate(vehicleForm.plate),
        brand: vehicleForm.brand.trim(),
        model: vehicleForm.model.trim(),
        model_year: vehicleForm.model_year ? Number(vehicleForm.model_year) : null,
        vehicle_type: vehicleForm.vehicle_type.trim() || null,
        renavam: vehicleForm.renavam.trim() || null,
        chassis: vehicleForm.chassis.trim() || null,
        current_odometer: odometer,
        status: vehicleForm.status,
        notes: vehicleForm.notes.trim() || null,
        active: vehicleForm.status !== 'inactive',
      };

      const query = editingVehicle
        ? supabase.from('fleet_vehicles').update(payload).eq('id', editingVehicle.id)
        : supabase.from('fleet_vehicles').insert(payload);

      const { error } = await query;
      if (error) throw error;

      toast.success(editingVehicle ? 'Veículo atualizado com sucesso' : 'Veículo cadastrado com sucesso');
      closeVehicleModal();
      await loadFleetData();
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || 'Falha ao salvar veículo');
    } finally {
      setVehicleSaving(false);
    }
  };

  const updateVehicleStatus = async (vehicle: FleetVehicle, status: FleetVehicleStatus) => {
    try {
      const { error } = await supabase
        .from('fleet_vehicles')
        .update({
          status,
          active: status !== 'inactive',
        })
        .eq('id', vehicle.id);

      if (error) throw error;
      toast.success('Status do veículo atualizado');
      await loadFleetData();
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || 'Falha ao atualizar veículo');
    }
  };

  const resetInspectionForm = () => {
    setInspectionVehicleId('');
    setInspectionAt(formatDateTimeLocal());
    setInspectionOdometer('');
    setInspectionNotes('');
    setInspectionItems(buildInspectionItems());
    setInspectionPhotos([]);
  };

  const openInspectionModal = () => {
    if (activeFleetVehicles.length === 0) {
      toast.error('Cadastre um veículo no módulo antes de criar inspeções');
      setActiveTab('vehicles');
      return;
    }
    resetInspectionForm();
    setShowInspectionModal(true);
  };

  const closeInspectionModal = () => {
    setShowInspectionModal(false);
    resetInspectionForm();
  };

  const handleInspectionVehicleChange = (vehicleId: string) => {
    setInspectionVehicleId(vehicleId);
    const vehicle = activeFleetVehicles.find((item) => item.id === vehicleId);
    setInspectionOdometer(vehicle ? String(vehicle.current_odometer || 0) : '');
  };

  const updateInspectionItem = (itemCode: string, field: 'status' | 'notes', value: string) => {
    setInspectionItems((current) =>
      current.map((item) =>
        item.item_code === itemCode
          ? { ...item, [field]: value }
          : item
      )
    );
  };

  const removeInspectionPhoto = (photoId: string) => {
    setInspectionPhotos((current) => current.filter((photo) => photo.id !== photoId));
  };

  const saveInspection = async () => {
    if (!inspectionVehicleId) {
      toast.error('Selecione um veículo');
      return;
    }

    const odometer = Number(inspectionOdometer);
    if (Number.isNaN(odometer) || odometer < 0) {
      toast.error('Informe um hodômetro válido');
      return;
    }

    if (inspectionPhotos.length === 0) {
      toast.error('A inspeção precisa ter ao menos uma foto');
      return;
    }

    const invalidItem = inspectionItems.find((item) =>
      ['attention', 'critical'].includes(item.status) && !item.notes.trim()
    );

    if (invalidItem) {
      toast.error(`O item "${invalidItem.label}" exige observação`);
      return;
    }

    const inspectionId = crypto.randomUUID();
    let uploadedPaths: string[] = [];

    setInspectionSaving(true);
    try {
      const uploadedPhotos = await FleetPhotoService.uploadInspectionPhotos(
        inspectionVehicleId,
        inspectionId,
        inspectionPhotos
      );
      uploadedPaths = uploadedPhotos.map((photo) => photo.storage_path);

      const { error } = await supabase.rpc('create_fleet_inspection', {
        p_inspection_id: inspectionId,
        p_vehicle_id: inspectionVehicleId,
        p_inspection_at: new Date(inspectionAt).toISOString(),
        p_odometer: odometer,
        p_general_notes: inspectionNotes.trim() || null,
        p_items: inspectionItems.map((item) => ({
          item_code: item.item_code,
          category: item.category,
          label: item.label,
          status: item.status,
          notes: item.notes.trim() || null,
          sort_order: item.sort_order,
        })),
        p_photos: uploadedPhotos,
      });

      if (error) {
        await FleetPhotoService.removePaths(uploadedPaths);
        throw error;
      }

      toast.success('Inspeção registrada com sucesso');
      closeInspectionModal();
      await loadFleetData();
    } catch (error: any) {
      console.error(error);
      if (uploadedPaths.length > 0) {
        await FleetPhotoService.removePaths(uploadedPaths);
      }
      toast.error(error.message || 'Falha ao registrar inspeção');
    } finally {
      setInspectionSaving(false);
    }
  };

  const openInspectionDetails = async (inspection: FleetInspection) => {
    setSelectedInspection(inspection);
    setInspectionDetailLoading(true);
    try {
      const resolvedPhotos = await FleetPhotoService.resolvePhotoUrls(inspection.photos || []);
      setSelectedInspectionPhotoItems(
        resolvedPhotos
          .filter((photo) => Boolean(photo.signedUrl))
          .map((photo) => ({
            id: photo.id,
            src: photo.signedUrl as string,
            fileName: photo.file_name || undefined,
          }))
      );
    } catch (error) {
      console.error(error);
      toast.error('Falha ao carregar fotos da inspeção');
      setSelectedInspectionPhotoItems([]);
    } finally {
      setInspectionDetailLoading(false);
    }
  };

  const closeInspectionDetails = () => {
    setSelectedInspection(null);
    setSelectedInspectionPhotoItems([]);
    setInspectionDetailLoading(false);
  };

  const advanceOccurrence = async (occurrence: FleetOccurrence, nextStatus: FleetOccurrenceStatus) => {
    try {
      const { error } = await supabase.rpc('update_fleet_occurrence_status', {
        p_occurrence_id: occurrence.id,
        p_new_status: nextStatus,
        p_resolution_notes: null,
      });
      if (error) throw error;
      toast.success('Ocorrência atualizada');
      await loadFleetData();
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || 'Falha ao atualizar ocorrência');
    }
  };

  const openOccurrenceResolution = (occurrence: FleetOccurrence, nextStatus: 'resolved' | 'cancelled') => {
    setOccurrenceTarget(occurrence);
    setOccurrenceNextStatus(nextStatus);
    setOccurrenceResolutionNotes('');
  };

  const closeOccurrenceResolution = () => {
    setOccurrenceTarget(null);
    setOccurrenceResolutionNotes('');
    setOccurrenceSubmitting(false);
  };

  const submitOccurrenceResolution = async () => {
    if (!occurrenceTarget) return;

    if (!occurrenceResolutionNotes.trim()) {
      toast.error('Informe a nota de resolução');
      return;
    }

    setOccurrenceSubmitting(true);
    try {
      const { error } = await supabase.rpc('update_fleet_occurrence_status', {
        p_occurrence_id: occurrenceTarget.id,
        p_new_status: occurrenceNextStatus,
        p_resolution_notes: occurrenceResolutionNotes.trim(),
      });

      if (error) throw error;

      toast.success(
        occurrenceNextStatus === 'resolved'
          ? 'Ocorrência resolvida com sucesso'
          : 'Ocorrência cancelada com sucesso'
      );

      closeOccurrenceResolution();
      await loadFleetData();
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || 'Falha ao atualizar ocorrência');
    } finally {
      setOccurrenceSubmitting(false);
    }
  };

  const linkedInspectionForOccurrence = (occurrence: FleetOccurrence) =>
    inspections.find((inspection) => inspection.id === occurrence.inspection_id) || null;

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Veículos ativos" value={metrics.activeVehicles} icon={CarFront} bgClass="bg-gradient-to-br from-sky-500 to-blue-600" />
        <MetricCard label="Inspeções" value={metrics.inspections} icon={ClipboardList} bgClass="bg-gradient-to-br from-emerald-500 to-green-600" />
        <MetricCard label="Ocorrências abertas" value={metrics.openOccurrences} icon={ShieldAlert} bgClass="bg-gradient-to-br from-rose-500 to-red-600" />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'vehicles', label: 'Veículos' },
            { key: 'inspections', label: 'Inspeções' },
            { key: 'occurrences', label: 'Ocorrências' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as FleetTab)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                activeTab === tab.key
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={
                activeTab === 'vehicles'
                  ? 'Buscar veículos por nome, placa ou modelo...'
                  : activeTab === 'inspections'
                    ? 'Buscar inspeções por veículo...'
                    : 'Buscar ocorrências por veículo ou descrição...'
              }
              className="w-full rounded-xl border border-gray-200 py-2.5 pl-10 pr-4 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {activeTab === 'vehicles' && (
              <select
                value={vehicleStatusFilter}
                onChange={(event) => setVehicleStatusFilter(event.target.value as 'all' | FleetVehicleStatus)}
                className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="all">Todos os status</option>
                <option value="available">Disponível</option>
                <option value="maintenance">Em manutenção</option>
                <option value="inactive">Inativo</option>
              </select>
            )}

            {activeTab === 'inspections' && (
              <>
                <select
                  value={inspectionStatusFilter}
                  onChange={(event) => setInspectionStatusFilter(event.target.value as 'all' | FleetInspection['overall_status'])}
                  className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="all">Todos os status</option>
                  <option value="approved">Aprovada</option>
                  <option value="attention">Atenção</option>
                  <option value="critical">Crítica</option>
                </select>
                <input
                  type="date"
                  value={inspectionDateFrom}
                  onChange={(event) => setInspectionDateFrom(event.target.value)}
                  className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                <input
                  type="date"
                  value={inspectionDateTo}
                  onChange={(event) => setInspectionDateTo(event.target.value)}
                  className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </>
            )}

            {activeTab === 'occurrences' && (
              <select
                value={occurrenceStatusFilter}
                onChange={(event) => setOccurrenceStatusFilter(event.target.value as 'all' | FleetOccurrenceStatus)}
                className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="all">Todos os status</option>
                <option value="open">Aberta</option>
                <option value="in_progress">Em andamento</option>
                <option value="resolved">Resolvida</option>
                <option value="cancelled">Cancelada</option>
              </select>
            )}

            <button
              onClick={activeTab === 'vehicles' ? () => openVehicleModal() : openInspectionModal}
              disabled={activeTab === 'occurrences'}
              className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition ${
                activeTab === 'occurrences'
                  ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              <Plus className="mr-2 h-4 w-4" />
              {activeTab === 'vehicles' ? 'Novo veículo' : activeTab === 'inspections' ? 'Nova inspeção' : 'Ações nas ocorrências'}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 shadow-sm">
          <div className="flex items-center justify-center gap-3 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Carregando módulo de frota...
          </div>
        </div>
      ) : (
        <>
          {activeTab === 'vehicles' && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {filteredVehicles.length === 0 ? (
                <div className="col-span-full rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center text-gray-500 shadow-sm">
                  Nenhum veículo encontrado com os filtros atuais.
                </div>
              ) : (
                filteredVehicles.map((vehicle) => (
                  <div key={vehicle.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-4">
                        <div className="rounded-2xl bg-blue-50 p-3">
                          <CarFront className="h-6 w-6 text-blue-600" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-bold text-gray-900">{vehicle.display_name}</h3>
                            <StatusBadge label={VEHICLE_STATUS_LABELS[vehicle.status]} className={VEHICLE_STATUS_CLASSES[vehicle.status]} />
                          </div>
                          <p className="mt-1 text-sm font-medium text-gray-600">{vehicle.brand} {vehicle.model}</p>
                          <p className="mt-1 font-mono text-sm text-gray-500">{vehicle.plate}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => openVehicleModal(vehicle)}
                          className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Editar
                        </button>

                        {vehicle.status === 'inactive' ? (
                          <button
                            onClick={() => updateVehicleStatus(vehicle, 'available')}
                            className="inline-flex items-center rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            Reativar
                          </button>
                        ) : (
                          <button
                            onClick={() => updateVehicleStatus(vehicle, 'inactive')}
                            className="inline-flex items-center rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                          >
                            <PauseCircle className="mr-2 h-4 w-4" />
                            Inativar
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-3 text-sm text-gray-600 sm:grid-cols-2">
                      <div className="rounded-xl bg-gray-50 px-4 py-3">
                        <p className="text-xs uppercase tracking-wide text-gray-400">Ano / Tipo</p>
                        <p className="mt-1 font-medium text-gray-800">
                          {vehicle.model_year || '-'} {vehicle.vehicle_type ? `• ${vehicle.vehicle_type}` : ''}
                        </p>
                      </div>
                      <div className="rounded-xl bg-gray-50 px-4 py-3">
                        <p className="text-xs uppercase tracking-wide text-gray-400">Hodômetro</p>
                        <p className="mt-1 font-medium text-gray-800">{vehicle.current_odometer.toLocaleString('pt-BR')} km</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 px-4 py-3">
                        <p className="text-xs uppercase tracking-wide text-gray-400">Renavam</p>
                        <p className="mt-1 font-medium text-gray-800">{vehicle.renavam || '-'}</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 px-4 py-3">
                        <p className="text-xs uppercase tracking-wide text-gray-400">Chassi</p>
                        <p className="mt-1 font-medium text-gray-800">{vehicle.chassis || '-'}</p>
                      </div>
                    </div>

                    {vehicle.notes && (
                      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                        {vehicle.notes}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'inspections' && (
            <div className="space-y-4">
              {filteredInspections.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center text-gray-500 shadow-sm">
                  Nenhuma inspeção encontrada com os filtros atuais.
                </div>
              ) : (
                filteredInspections.map((inspection) => (
                  <div key={inspection.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-bold text-gray-900">{inspection.vehicle?.display_name || 'Veículo'}</h3>
                          <StatusBadge
                            label={INSPECTION_STATUS_LABELS[inspection.overall_status]}
                            className={INSPECTION_STATUS_CLASSES[inspection.overall_status]}
                          />
                        </div>
                        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-600">
                          <span className="font-mono">{inspection.vehicle?.plate || '-'}</span>
                          <span>{formatDateTime(inspection.inspection_at)}</span>
                          <span>{inspection.odometer.toLocaleString('pt-BR')} km</span>
                          <span>{inspection.photos?.length || 0} foto(s)</span>
                        </div>
                        {inspection.general_notes && (
                          <p className="max-w-3xl text-sm text-gray-600">{inspection.general_notes}</p>
                        )}
                      </div>

                      <button
                        onClick={() => openInspectionDetails(inspection)}
                        className="inline-flex items-center rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        Ver detalhes
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'occurrences' && (
            <div className="space-y-4">
              {filteredOccurrences.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center text-gray-500 shadow-sm">
                  Nenhuma ocorrência encontrada com os filtros atuais.
                </div>
              ) : (
                filteredOccurrences.map((occurrence) => {
                  const linkedInspection = linkedInspectionForOccurrence(occurrence);
                  return (
                    <div key={occurrence.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-bold text-gray-900">{occurrence.title}</h3>
                            <StatusBadge
                              label={OCCURRENCE_STATUS_LABELS[occurrence.status]}
                              className={OCCURRENCE_STATUS_CLASSES[occurrence.status]}
                            />
                          </div>
                          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-600">
                            <span>{occurrence.vehicle?.display_name || 'Veículo'}</span>
                            <span className="font-mono">{occurrence.vehicle?.plate || '-'}</span>
                            <span>{formatDateTime(occurrence.created_at)}</span>
                          </div>
                          {occurrence.description && (
                            <p className="max-w-3xl text-sm text-gray-600">{occurrence.description}</p>
                          )}
                          {occurrence.resolution_notes && (
                            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                              <p className="font-semibold">Nota registrada</p>
                              <p className="mt-1">{occurrence.resolution_notes}</p>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 lg:justify-end">
                          {linkedInspection && (
                            <button
                              onClick={() => openInspectionDetails(linkedInspection)}
                              className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              Ver inspeção
                            </button>
                          )}

                          {occurrence.status === 'open' && (
                            <button
                              onClick={() => advanceOccurrence(occurrence, 'in_progress')}
                              className="inline-flex items-center rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
                            >
                              <Wrench className="mr-2 h-4 w-4" />
                              Em andamento
                            </button>
                          )}

                          {['open', 'in_progress'].includes(occurrence.status) && (
                            <>
                              <button
                                onClick={() => openOccurrenceResolution(occurrence, 'resolved')}
                                className="inline-flex items-center rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                              >
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Resolver
                              </button>
                              <button
                                onClick={() => openOccurrenceResolution(occurrence, 'cancelled')}
                                className="inline-flex items-center rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                              >
                                <AlertTriangle className="mr-2 h-4 w-4" />
                                Cancelar
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
      )}

      {showVehicleModal && (
        <ModalShell
          title={editingVehicle ? 'Editar veículo' : 'Novo veículo'}
          description="Esse cadastro é exclusivo do módulo de frota e não interfere na tabela atual de veículos."
          onClose={closeVehicleModal}
          size="max-w-3xl"
          footer={(
            <div className="flex justify-end gap-3">
              <button
                onClick={closeVehicleModal}
                className="rounded-xl px-4 py-2.5 font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button
                onClick={saveVehicle}
                disabled={vehicleSaving}
                className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {vehicleSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingVehicle ? 'Salvar alterações' : 'Cadastrar veículo'}
              </button>
            </div>
          )}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Nome do veículo</label>
              <input
                value={vehicleForm.display_name}
                onChange={(event) => setVehicleForm((current) => ({ ...current, display_name: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Ex: Caminhão 01"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Placa</label>
              <input
                value={vehicleForm.plate}
                onChange={(event) => setVehicleForm((current) => ({ ...current, plate: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 font-mono outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="ABC1D23"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Marca</label>
              <input
                value={vehicleForm.brand}
                onChange={(event) => setVehicleForm((current) => ({ ...current, brand: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Volvo"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Modelo</label>
              <input
                value={vehicleForm.model}
                onChange={(event) => setVehicleForm((current) => ({ ...current, model: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="FH 540"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Ano</label>
              <input
                type="number"
                value={vehicleForm.model_year}
                onChange={(event) => setVehicleForm((current) => ({ ...current, model_year: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="2024"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Tipo</label>
              <input
                value={vehicleForm.vehicle_type}
                onChange={(event) => setVehicleForm((current) => ({ ...current, vehicle_type: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Truck, carreta, utilitário..."
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Renavam</label>
              <input
                value={vehicleForm.renavam}
                onChange={(event) => setVehicleForm((current) => ({ ...current, renavam: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Opcional"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Chassi</label>
              <input
                value={vehicleForm.chassis}
                onChange={(event) => setVehicleForm((current) => ({ ...current, chassis: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Opcional"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Hodômetro atual</label>
              <input
                type="number"
                min="0"
                value={vehicleForm.current_odometer}
                onChange={(event) => setVehicleForm((current) => ({ ...current, current_odometer: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
              <select
                value={vehicleForm.status}
                onChange={(event) => setVehicleForm((current) => ({ ...current, status: event.target.value as FleetVehicleStatus }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="available">Disponível</option>
                <option value="maintenance">Em manutenção</option>
                <option value="inactive">Inativo</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Observações</label>
              <textarea
                value={vehicleForm.notes}
                onChange={(event) => setVehicleForm((current) => ({ ...current, notes: event.target.value }))}
                rows={4}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Informações adicionais sobre o veículo"
              />
            </div>
          </div>
        </ModalShell>
      )}

      {showInspectionModal && (
        <ModalShell
          title="Nova inspeção"
          description="A inspeção fica imutável após o envio e exige pelo menos uma foto."
          onClose={closeInspectionModal}
          footer={(
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <CalendarRange className="h-4 w-4" />
                Status calculado: <StatusBadge label={INSPECTION_STATUS_LABELS[inspectionDraftStatus]} className={INSPECTION_STATUS_CLASSES[inspectionDraftStatus]} />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeInspectionModal}
                  className="rounded-xl px-4 py-2.5 font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveInspection}
                  disabled={inspectionSaving}
                  className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {inspectionSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Registrar inspeção
                </button>
              </div>
            </div>
          )}
        >
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Veículo</label>
                <select
                  value={inspectionVehicleId}
                  onChange={(event) => handleInspectionVehicleChange(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">Selecione...</option>
                  {activeFleetVehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.display_name} • {vehicle.plate}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Data e hora</label>
                <input
                  type="datetime-local"
                  value={inspectionAt}
                  onChange={(event) => setInspectionAt(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Hodômetro</label>
                <input
                  type="number"
                  min="0"
                  value={inspectionOdometer}
                  onChange={(event) => setInspectionOdometer(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div className="md:col-span-3">
                <label className="mb-1 block text-sm font-medium text-gray-700">Observação geral</label>
                <textarea
                  value={inspectionNotes}
                  onChange={(event) => setInspectionNotes(event.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="Contexto geral da inspeção"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">Fotos da inspeção</h4>
                  <p className="text-sm text-gray-500">Obrigatório anexar pelo menos uma foto do veículo no momento da inspeção.</p>
                </div>
                <button
                  onClick={() => setShowPhotoCaptureModal(true)}
                  disabled={inspectionPhotos.length >= 10}
                  className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  <Camera className="mr-2 h-4 w-4" />
                  {inspectionPhotos.length === 0 ? 'Adicionar fotos' : 'Adicionar mais'}
                </button>
              </div>

              {inspectionPhotos.length > 0 ? (
                <PhotoGallery
                  photos={inspectionPhotos.map((photo) => ({
                    id: photo.id,
                    src: photo.base64,
                    fileName: photo.fileName,
                    isLocal: true,
                    isSynced: false,
                  }))}
                  canDelete
                  onDelete={removeInspectionPhoto}
                  emptyMessage="Nenhuma foto anexada"
                  columns={4}
                  thumbnailSize="md"
                />
              ) : (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                  Nenhuma foto adicionada ainda.
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">Checklist fixo</h4>
                <p className="text-sm text-gray-500">Itens marcados como atenção ou crítico exigem observação.</p>
              </div>

              {inspectionItems.map((item) => (
                <div key={item.item_code} className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.4fr,220px]">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{item.category}</p>
                      <p className="mt-1 font-semibold text-gray-900">{item.label}</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
                      <select
                        value={item.status}
                        onChange={(event) => updateInspectionItem(item.item_code, 'status', event.target.value)}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      >
                        <option value="ok">OK</option>
                        <option value="attention">Atenção</option>
                        <option value="critical">Crítico</option>
                        <option value="na">N/A</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="mb-1 block text-sm font-medium text-gray-700">Observação do item</label>
                    <textarea
                      value={item.notes}
                      onChange={(event) => updateInspectionItem(item.item_code, 'notes', event.target.value)}
                      rows={2}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      placeholder={
                        ['attention', 'critical'].includes(item.status)
                          ? 'Obrigatório para este status'
                          : 'Opcional'
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ModalShell>
      )}

      {selectedInspection && (
        <ModalShell
          title={`Inspeção • ${selectedInspection.vehicle?.display_name || 'Veículo'}`}
          description={`${selectedInspection.vehicle?.plate || '-'} • ${formatDateTime(selectedInspection.inspection_at)}`}
          onClose={closeInspectionDetails}
          size="max-w-5xl"
          footer={(
            <div className="flex justify-end">
              <button
                onClick={closeInspectionDetails}
                className="rounded-xl px-4 py-2.5 font-medium text-gray-700 hover:bg-gray-100"
              >
                Fechar
              </button>
            </div>
          )}
        >
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-2xl bg-gray-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-400">Status geral</p>
                <div className="mt-2">
                  <StatusBadge
                    label={INSPECTION_STATUS_LABELS[selectedInspection.overall_status]}
                    className={INSPECTION_STATUS_CLASSES[selectedInspection.overall_status]}
                  />
                </div>
              </div>
              <div className="rounded-2xl bg-gray-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-400">Hodômetro</p>
                <p className="mt-2 font-semibold text-gray-900">
                  {selectedInspection.odometer.toLocaleString('pt-BR')} km
                </p>
              </div>
              <div className="rounded-2xl bg-gray-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-400">Criada em</p>
                <p className="mt-2 font-semibold text-gray-900">{formatDateTime(selectedInspection.created_at)}</p>
              </div>
            </div>

            {selectedInspection.general_notes && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                {selectedInspection.general_notes}
              </div>
            )}

            <div>
              <h4 className="mb-3 text-sm font-semibold text-gray-900">Itens avaliados</h4>
              <div className="space-y-3">
                {sortInspectionItems(selectedInspection.items).map((item) => (
                  <div key={item.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{item.category}</p>
                        <p className="mt-1 font-semibold text-gray-900">{item.label}</p>
                      </div>
                      <StatusBadge
                        label={ITEM_STATUS_LABELS[item.status]}
                        className={
                          item.status === 'critical'
                            ? 'bg-red-100 text-red-700'
                            : item.status === 'attention'
                              ? 'bg-amber-100 text-amber-700'
                              : item.status === 'na'
                                ? 'bg-gray-100 text-gray-600'
                                : 'bg-emerald-100 text-emerald-700'
                        }
                      />
                    </div>
                    {item.notes && (
                      <p className="mt-3 text-sm text-gray-600">{item.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="mb-3 text-sm font-semibold text-gray-900">Fotos registradas</h4>
              {inspectionDetailLoading ? (
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 text-center text-gray-500">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                  Carregando fotos...
                </div>
              ) : (
                <PhotoGallery
                  photos={selectedInspectionPhotoItems}
                  emptyMessage="Nenhuma foto encontrada"
                  columns={4}
                  thumbnailSize="md"
                />
              )}
            </div>
          </div>
        </ModalShell>
      )}

      {occurrenceTarget && (
        <ModalShell
          title={occurrenceNextStatus === 'resolved' ? 'Resolver ocorrência' : 'Cancelar ocorrência'}
          description={occurrenceTarget.title}
          onClose={closeOccurrenceResolution}
          size="max-w-2xl"
          footer={(
            <div className="flex justify-end gap-3">
              <button
                onClick={closeOccurrenceResolution}
                className="rounded-xl px-4 py-2.5 font-medium text-gray-700 hover:bg-gray-100"
              >
                Voltar
              </button>
              <button
                onClick={submitOccurrenceResolution}
                disabled={occurrenceSubmitting}
                className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {occurrenceSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar
              </button>
            </div>
          )}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Essa ação exige uma nota registrada e será gravada no histórico da ocorrência.
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Nota</label>
              <textarea
                value={occurrenceResolutionNotes}
                onChange={(event) => setOccurrenceResolutionNotes(event.target.value)}
                rows={5}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Descreva o que foi feito ou o motivo do cancelamento"
              />
            </div>
          </div>
        </ModalShell>
      )}

      <PhotoCaptureModal
        isOpen={showPhotoCaptureModal}
        onClose={() => setShowPhotoCaptureModal(false)}
        onConfirm={(photos) => {
          setInspectionPhotos((current) => [...current, ...photos].slice(0, 10));
          setShowPhotoCaptureModal(false);
        }}
        minPhotos={1}
        maxPhotos={Math.max(1, 10 - inspectionPhotos.length)}
        productName={activeFleetVehicles.find((vehicle) => vehicle.id === inspectionVehicleId)?.display_name}
        title="Fotos da inspeção"
        confirmLabel="Adicionar fotos"
      />
    </div>
  );
}
