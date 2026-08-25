/**
 * useDeliveryPhotos - Hook para isolar lógica de captura de fotos de entrega
 */

import { useState, useCallback, useEffect, useRef } from 'react';
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
    const [submitLabel, setSubmitLabel] = useState<string | null>(null);
    const [resolvePromise, setResolvePromise] = useState<((value: boolean) => void) | null>(null);

    // Trava síncrona: o estado do React não atualiza a tempo de barrar toques no mesmo tick.
    const isSubmittingRef = useRef(false);
    // Fotos já gravadas na sessão atual do modal, para a retentativa não regravar o que subiu.
    const savedPhotoIdsRef = useRef<Set<string>>(new Set());

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
            savedPhotoIdsRef.current = new Set();
            setAction(actionType);
            setCurrentRouteOrderId(routeOrderId);
            setPhotosRequired(actionType === 'delivered');
            setResolvePromise(() => resolve);
            setIsOpen(true);
        });
    }, [configEnabled]);

    const handleConfirm = async (capturedPhotos: CapturedPhoto[]) => {
        // Barra execuções concorrentes: cada uma regravaria o lote inteiro.
        if (isSubmittingRef.current) return;
        isSubmittingRef.current = true;
        setIsProcessing(true);
        try {
            const userId = (await supabase.auth.getUser()).data.user?.id || 'offline_user';
            const isOnline = NetworkStatus.isOnline();

            let index = 0;
            for (const photo of capturedPhotos) {
                index++;
                // Progresso visível no botão: o público leigo precisa VER que anda.
                setSubmitLabel(`Enviando foto ${index} de ${capturedPhotos.length}...`);
                let type = 'general';
                if (action === 'delivered') {
                    type = index === 1 ? 'product' : 'receipt';
                } else if (action === 'returned') {
                    type = 'return_evidence';
                }

                // Numa retentativa após falha parcial, pula o que já foi gravado.
                if (savedPhotoIdsRef.current.has(photo.id)) continue;

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

                savedPhotoIdsRef.current.add(photo.id);
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
            isSubmittingRef.current = false;
            setIsProcessing(false);
            setSubmitLabel(null);
        }
    };

    // FECHAR A CAIXA DE FOTOS = DESISTIR DA ACAO. Sempre.
    //
    // Antes isto devolvia `!photosRequired`. Como a foto so e obrigatoria na
    // ENTREGA, no RETORNO o cancelar devolvia `true` — o mesmo valor do
    // confirmar. Resultado: o motorista clicava em Cancelar, a caixa fechava, e
    // o pedido era marcado como retornado assim mesmo. "Pular a foto" e
    // "desistir da operacao" tinham virado a mesma resposta.
    //
    // Agora fechar sempre significa desistir. Quem quiser seguir sem foto usa o
    // botao de confirmar com zero fotos, que no retorno e permitido (minPhotos
    // e 0) — a intencao fica explicita, e nao adivinhada pelo tipo da acao.
    const handleClose = () => {
        if (isSubmittingRef.current) return;
        setIsOpen(false);
        if (resolvePromise) resolvePromise(false);
    };

    const renderModal = () => (
        <PhotoCaptureModal
            isOpen={isOpen}
            onClose={handleClose}
            onConfirm={handleConfirm}
            minPhotos={photosRequired ? 2 : 0}
            maxPhotos={5}
            productName={action === 'delivered'
                ? 'Entrega: Foto do Produto + Recibo'
                : 'Retorno: foto opcional — pode confirmar sem tirar'}
            isOffline={!NetworkStatus.isOnline()}
            // Os rotulos seguem a acao: dizer "Confirmar Entrega" numa tela de
            // retorno confundia o motorista sobre o que o botao ia fazer.
            title={action === 'delivered' ? 'Fotos da Entrega' : 'Fotos do Retorno'}
            confirmLabel={action === 'delivered' ? 'Confirmar Entrega' : 'Confirmar Retorno'}
            isSubmitting={isProcessing}
            submittingLabel={submitLabel || undefined}
        />
    );

    return {
        renderModal,
        capturePhotos,
        isProcessing
    };
}
