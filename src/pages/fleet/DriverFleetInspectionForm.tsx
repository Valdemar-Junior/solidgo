import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PhotoCaptureModal, PhotoGallery, type CapturedPhoto } from '../../components/photos';
import { FLEET_INSPECTION_CHECKLIST, calculateFleetInspectionOverallStatus } from '../../constants/fleetInspectionChecklist';
import FleetPhotoService from '../../services/fleetPhotoService';
import { supabase } from '../../supabase/client';
import type { FleetInspection, FleetInspectionItemStatus } from '../../types/database';
import { useFleetPwaMeta } from './useFleetPwaMeta';

interface InspectionDraftItem {
  item_code: string;
  category: string;
  label: string;
  sort_order: number;
  status: FleetInspectionItemStatus;
  notes: string;
}

function buildInspectionItems() {
  return FLEET_INSPECTION_CHECKLIST.map((item) => ({
    ...item,
    status: 'ok' as FleetInspectionItemStatus,
    notes: '',
  }));
}

export default function DriverFleetInspectionForm() {
  useFleetPwaMeta();
  const { inspectionId } = useParams<{ inspectionId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPhotoCaptureModal, setShowPhotoCaptureModal] = useState(false);

  const [inspection, setInspection] = useState<FleetInspection | null>(null);
  const [inspectionOdometer, setInspectionOdometer] = useState('');
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [inspectionItems, setInspectionItems] = useState<InspectionDraftItem[]>(buildInspectionItems());
  const [inspectionPhotos, setInspectionPhotos] = useState<CapturedPhoto[]>([]);

  useEffect(() => {
    void loadInspection();
  }, [inspectionId]);

  const loadInspection = async () => {
    if (!inspectionId) return;

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('fleet_inspections')
        .select(`
          *,
          vehicle:fleet_vehicles(*),
          items:fleet_inspection_items(*),
          photos:fleet_inspection_photos(*)
        `)
        .eq('id', inspectionId)
        .single();

      if (error) throw error;

      const nextInspection = data as FleetInspection;
      setInspection(nextInspection);
      setInspectionNotes(nextInspection.general_notes || '');
      setInspectionOdometer(nextInspection.vehicle?.current_odometer != null ? String(nextInspection.vehicle.current_odometer) : '');

      if (nextInspection.items && nextInspection.items.length > 0) {
        setInspectionItems(
          nextInspection.items
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((item) => ({
              item_code: item.item_code,
              category: item.category,
              label: item.label,
              sort_order: item.sort_order,
              status: item.status,
              notes: item.notes || '',
            }))
        );
      }

      if (nextInspection.status === 'pending') {
        const { error: startError } = await supabase.rpc('start_fleet_inspection', {
          p_inspection_id: inspectionId,
        });
        if (startError) {
          throw startError;
        }
      }
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || 'Falha ao carregar inspeção');
      navigate('/fleet/driver');
    } finally {
      setLoading(false);
    }
  };

  const inspectionDraftStatus = useMemo(
    () => calculateFleetInspectionOverallStatus(inspectionItems),
    [inspectionItems]
  );

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
    if (!inspection || !inspectionId) return;

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

    let uploadedPaths: string[] = [];

    setSaving(true);
    try {
      const uploadedPhotos = await FleetPhotoService.uploadInspectionPhotos(
        inspection.vehicle_id,
        inspectionId,
        inspectionPhotos
      );
      uploadedPaths = uploadedPhotos.map((photo) => photo.storage_path);

      const { error } = await supabase.rpc('submit_fleet_inspection', {
        p_inspection_id: inspectionId,
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

      toast.success('Inspeção enviada com sucesso');
      navigate('/fleet/driver');
    } catch (error: any) {
      console.error(error);
      if (uploadedPaths.length > 0) {
        await FleetPhotoService.removePaths(uploadedPaths);
      }
      toast.error(error.message || 'Falha ao enviar inspeção');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !inspection) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-8">
        <div className="mx-auto max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
          <p className="mt-3 text-sm text-slate-500">Carregando inspeção...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-4">
          <button
            onClick={() => navigate('/fleet/driver')}
            className="rounded-xl border border-slate-200 p-2 text-slate-600"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Inspeção</p>
            <h1 className="text-lg font-bold text-slate-900">{inspection.vehicle?.display_name || 'Veículo'}</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-5">
        <section className="rounded-3xl bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">{inspection.vehicle?.plate}</p>
          <p className="mt-1 text-sm text-slate-500">{inspection.vehicle?.brand} {inspection.vehicle?.model}</p>
          {inspection.general_notes && (
            <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {inspection.general_notes}
            </div>
          )}
        </section>

        <section className="rounded-3xl bg-white p-5 shadow-sm">
          <label className="mb-2 block text-sm font-semibold text-slate-900">Hodômetro</label>
          <input
            type="number"
            min="0"
            value={inspectionOdometer}
            onChange={(event) => setInspectionOdometer(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-lg outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            placeholder="Informe o KM atual"
          />
        </section>

        <section className="rounded-3xl bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Fotos da inspeção</h2>
              <p className="text-sm text-slate-500">Ao menos uma foto é obrigatória.</p>
            </div>
            <button
              onClick={() => setShowPhotoCaptureModal(true)}
              disabled={inspectionPhotos.length >= 10}
              className="inline-flex items-center rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              <Camera className="mr-2 h-4 w-4" />
              {inspectionPhotos.length === 0 ? 'Adicionar' : 'Mais fotos'}
            </button>
          </div>

          <div className="mt-4">
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
                columns={3}
                thumbnailSize="md"
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                Nenhuma foto adicionada ainda.
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          {inspectionItems.map((item) => (
            <div key={item.item_code} className="rounded-3xl bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{item.category}</p>
              <h2 className="mt-1 text-base font-semibold text-slate-900">{item.label}</h2>

              <div className="mt-4 grid grid-cols-2 gap-2">
                {[
                  { value: 'ok', label: 'OK' },
                  { value: 'attention', label: 'Atenção' },
                  { value: 'critical', label: 'Crítico' },
                  { value: 'na', label: 'N/A' },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => updateInspectionItem(item.item_code, 'status', option.value)}
                    className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition ${
                      item.status === option.value
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-sm font-medium text-slate-700">Observação</label>
                <textarea
                  value={item.notes}
                  onChange={(event) => updateInspectionItem(item.item_code, 'notes', event.target.value)}
                  rows={3}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder={['attention', 'critical'].includes(item.status) ? 'Obrigatório para este status' : 'Opcional'}
                />
              </div>
            </div>
          ))}
        </section>

        <section className="rounded-3xl bg-white p-5 shadow-sm">
          <label className="mb-2 block text-sm font-semibold text-slate-900">Observação geral</label>
          <textarea
            value={inspectionNotes}
            onChange={(event) => setInspectionNotes(event.target.value)}
            rows={4}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            placeholder="Contexto geral da inspeção"
          />
        </section>

        <section className="rounded-3xl bg-slate-900 p-5 text-white shadow-lg shadow-slate-300/40">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-slate-300">Resultado previsto</p>
              <p className="mt-1 text-lg font-bold">
                {inspectionDraftStatus === 'approved'
                  ? 'Aprovada'
                  : inspectionDraftStatus === 'attention'
                    ? 'Atenção'
                    : 'Crítica'}
              </p>
            </div>
            <button
              onClick={saveInspection}
              disabled={saving}
              className="inline-flex items-center rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 disabled:opacity-60"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Enviar inspeção
            </button>
          </div>
        </section>
      </main>

      <PhotoCaptureModal
        isOpen={showPhotoCaptureModal}
        onClose={() => setShowPhotoCaptureModal(false)}
        onConfirm={(photos) => {
          setInspectionPhotos((current) => [...current, ...photos].slice(0, 10));
          setShowPhotoCaptureModal(false);
        }}
        minPhotos={1}
        maxPhotos={Math.max(1, 10 - inspectionPhotos.length)}
        productName={inspection.vehicle?.display_name}
        title="Fotos da inspeção"
        confirmLabel="Adicionar fotos"
      />
    </div>
  );
}
