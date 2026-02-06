/**
 * useDeliveryPhotos - Hook para isolar lógica de captura de fotos de entrega
 */

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../supabase/client';
import { NetworkStatus, SyncQueue } from '../utils/offline/storage';
import { DeliveryPhotoService } from '../services/deliveryPhotoService';
import { DeliveryPhotoStorage } from '../utils/offline/deliveryPhotoStorage';
import PhotoCaptureModal, { CapturedPhoto } from '../components/photos/PhotoCaptureModal';
import { toast } from 'sonner';

type DeliveryAction = 'delivered' | 'returned';

interface UseDeliveryPhotosResult {
    renderModal: () => React.ReactNode;
    capturePhotos: (action: DeliveryAction, orderId: string, routeOrderId: string) => Promise<boolean>;
    isProcessing: boolean;
}

export function useDeliveryPhotos(): UseDeliveryPhotosResult {
    const [isOpen, setIsOpen] = useState(false);
    const [action, setAction] = useState<DeliveryAction | null>(null);
    const [currentRouteOrderId, setCurrentRouteOrderId] = useState<string>('');
    const [photosRequired, setPhotosRequired] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [resolvePromise, setResolvePromise] = useState<((value: boolean) => void) | null>(null);

    // Configuração
    const [configEnabled, setConfigEnabled] = useState(false);

    useEffect(() => {
        const loadConfig = async () => {
            try {
                const { data } = await supabase.from('app_settings').select('value').eq('key', 'require_delivery_photos').single();
                if (data?.value?.enabled) {
                    setConfigEnabled(true);
                }
            } catch { }
        };
        loadConfig();
    }, []);

    const capturePhotos = useCallback((actionType: DeliveryAction, orderId: string, routeOrderId: string): Promise<boolean> => {
        if (!configEnabled) return Promise.resolve(true);

        return new Promise((resolve) => {
            setAction(actionType);
            setCurrentRouteOrderId(routeOrderId);
            setPhotosRequired(actionType === 'delivered');
            setResolvePromise(() => resolve);
            setIsOpen(true);
        });
    }, [configEnabled]);

    const handleConfirm = async (capturedPhotos: CapturedPhoto[]) => {
        setIsProcessing(true);
        try {
            const userId = (await supabase.auth.getUser()).data.user?.id || 'offline_user';
            const isOnline = NetworkStatus.isOnline();

            let index = 0;
            for (const photo of capturedPhotos) {
                index++;
                let type = 'general';
                if (action === 'delivered') {
                    type = index === 1 ? 'product' : 'receipt';
                } else if (action === 'returned') {
                    type = 'return_evidence';
                }

                if (isOnline) {
                    const result = await DeliveryPhotoService.uploadPhoto(currentRouteOrderId, photo.base64, photo.fileName, type);
                    if (result.success && result.storagePath) {
                        await DeliveryPhotoService.registerPhotoInDb(currentRouteOrderId, result.storagePath, photo.fileName, photo.fileSize, type);
                    } else {
                        throw new Error(result.error);
                    }
                } else {
                    await DeliveryPhotoStorage.saveLocal(
                        currentRouteOrderId,
                        type,
                        photo.base64,
                        photo.fileName,
                        photo.fileSize,
                        photo.mimeType,
                        userId
                    );
                }
            }

            if (!isOnline && capturedPhotos.length > 0) {
                toast.success('Fotos salvas (offline)');
            } else if (capturedPhotos.length > 0) {
                toast.success('Fotos enviadas com sucesso');
            }

            setIsOpen(false);
            if (resolvePromise) resolvePromise(true);

        } catch (error) {
            console.error('[useDeliveryPhotos] Erro ao salvar:', error);
            toast.error('Erro ao salvar fotos. Tente novamente.');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleClose = () => {
        const canSkip = !photosRequired;
        setIsOpen(false);
        if (resolvePromise) resolvePromise(canSkip);
    };

    const renderModal = () => (
        <PhotoCaptureModal
            isOpen={isOpen}
            onClose={handleClose}
            onConfirm={handleConfirm}
            minPhotos={photosRequired ? 2 : 0}
            maxPhotos={3}
            productName={action === 'delivered' ? 'Entrega: Foto do Produto + Recibo' : 'Retorno: Foto (Opcional)'}
            isOffline={!NetworkStatus.isOnline()}
            title="Fotos da Entrega"
            confirmLabel="Confirmar Entrega"
        />
    );

    return {
        renderModal,
        capturePhotos,
        isProcessing
    };
}
