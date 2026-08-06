/**
 * PhotoCaptureModal - Modal para captura de fotos de montagem
 * Permite tirar fotos com câmera ou selecionar da galeria
 * Suporta modo offline com indicador de sync pendente
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Image, X, Check, AlertCircle, Loader2 } from 'lucide-react';
import { compressImageWithFallback, blobToBase64, generatePhotoFileName } from '../../utils/imageCompression';
import PhotoThumbnail from './PhotoThumbnail';
import { markBusy, markIdle } from '../../utils/updateGate';

export interface CapturedPhoto {
    id: string;
    base64: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
}

export interface PhotoCaptureModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (photos: CapturedPhoto[]) => void;
    minPhotos?: number;
    maxPhotos?: number;
    productName?: string;
    isOffline?: boolean;
    title?: string; // Título do modal (default: "Fotos da Montagem")
    confirmLabel?: string; // Texto do botão de confirmar (default: "Confirmar Montagem")
    /** Envio em andamento no consumidor (upload/gravação). Trava o modal para evitar reenvio do mesmo lote. */
    isSubmitting?: boolean;
}

export default function PhotoCaptureModal({
    isOpen,
    onClose,
    onConfirm,
    minPhotos = 1,
    maxPhotos = 3,
    productName,
    isOffline = false,
    title = 'Fotos da Montagem',
    confirmLabel = 'Confirmar Montagem',
    isSubmitting = false,
}: PhotoCaptureModalProps) {
    const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cameraError, setCameraError] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    // Limpar estado ao fechar
    useEffect(() => {
        if (!isOpen) {
            setPhotos([]);
            setError(null);
            setCameraError(null);
        }
    }, [isOpen]);

    // Enquanto o modal está aberto há fotos não confirmadas: segura a
    // atualização automática do app, que recarregaria a tela e as perderia.
    useEffect(() => {
        if (!isOpen) return;
        markBusy();
        return () => markIdle();
    }, [isOpen]);

    // Gerar ID único para foto
    const generatePhotoId = () => `photo_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Processar arquivo selecionado
    const processFile = useCallback(async (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('Por favor, selecione apenas imagens.');
            return;
        }

        if (photos.length >= maxPhotos) {
            setError(`Máximo de ${maxPhotos} fotos permitido.`);
            return;
        }

        try {
            setIsProcessing(true);
            setError(null);

            const resultado = await compressImageWithFallback(file);
            const processedBlob = resultado.blob;
            const outputMimeType = resultado.compressed ? 'image/jpeg' : (file.type || 'image/jpeg');

            // Avisa so quando o tamanho vai doer de verdade no envio. Antes isso
            // passava calado e a foto subia inteira, com varios megabytes.
            // Linguagem leiga de proposito: o usuario nao tem o que resolver,
            // so precisa saber que a espera maior e normal.
            if (!resultado.compressed && processedBlob.size > 1024 * 1024) {
                setCameraError('Essa foto ficou pesada. Pode confirmar normalmente — só vai demorar um pouco mais para enviar.');
            }

            // Converter para base64
            const base64 = await blobToBase64(processedBlob);

            // Criar objeto da foto
            const photo: CapturedPhoto = {
                id: generatePhotoId(),
                base64,
                fileName: generatePhotoFileName('montagem'),
                fileSize: processedBlob.size,
                mimeType: outputMimeType,
            };

            setPhotos((prev) => [...prev, photo]);
        } catch (err: any) {
            console.error('Erro ao processar imagem:', err);
            setError('Erro ao processar imagem. Tente novamente.');
        } finally {
            setIsProcessing(false);
        }
    }, [photos.length, maxPhotos]);

    // Handler para seleção de arquivo
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            processFile(files[0]);
        }
        // Limpar input para permitir selecionar a mesma foto novamente
        e.target.value = '';
    };

    // Abrir câmera
    const openCamera = () => {
        if (cameraInputRef.current) {
            cameraInputRef.current.click();
        }
    };

    // Abrir galeria
    const openGallery = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    // Remover foto
    const removePhoto = (photoId: string) => {
        setPhotos((prev) => prev.filter((p) => p.id !== photoId));
        setError(null);
    };

    // Confirmar fotos
    const handleConfirm = () => {
        // Trava contra toques repetidos: o envio leva segundos e o modal segue aberto até concluir.
        if (isSubmitting) return;
        if (photos.length < minPhotos) {
            setError(`Mínimo de ${minPhotos} foto(s) obrigatória(s).`);
            return;
        }
        onConfirm(photos);
    };

    // Cancelar
    const handleCancel = () => {
        if (isSubmitting) return;
        if (photos.length > 0) {
            if (!window.confirm('Tem certeza que deseja cancelar? As fotos serão descartadas.')) {
                return;
            }
        }
        onClose();
    };

    if (!isOpen) return null;

    const canAddMore = photos.length < maxPhotos && !isSubmitting;
    const canConfirm = photos.length >= minPhotos && !isProcessing && !isSubmitting;

    return createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center p-4">
            <div className="bg-white w-[94%] max-w-md rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="bg-indigo-600 text-white px-6 py-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                            <h2 className="text-lg font-bold">{title}</h2>
                            {productName && (
                                <p className="text-indigo-200 text-sm break-words leading-snug mt-1">{productName}</p>
                            )}
                        </div>
                        <button
                            onClick={handleCancel}
                            disabled={isSubmitting}
                            className="p-2 hover:bg-white/20 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Offline Warning */}
                {isOffline && (
                    <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                        <span className="text-yellow-800 text-sm">
                            Modo offline. Fotos serão sincronizadas quando houver conexão.
                        </span>
                    </div>
                )}

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {/* Contador */}
                    <div className="flex justify-between items-center mb-4">
                        <span className="text-sm text-gray-600">
                            {photos.length} de {maxPhotos} fotos
                        </span>
                        <span className={`text-sm ${photos.length >= minPhotos ? 'text-green-600' : 'text-red-600'}`}>
                            {photos.length >= minPhotos ? '✓ Mínimo atingido' : `Mínimo: ${minPhotos}`}
                        </span>
                    </div>

                    {/* Barra de progresso */}
                    <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
                        <div
                            className={`h-2 rounded-full transition-all ${photos.length >= minPhotos ? 'bg-green-500' : 'bg-indigo-500'}`}
                            style={{ width: `${(photos.length / maxPhotos) * 100}%` }}
                        />
                    </div>

                    {/* Grid de fotos */}
                    {photos.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                            {photos.map((photo) => (
                                <PhotoThumbnail
                                    key={photo.id}
                                    src={photo.base64}
                                    alt={photo.fileName}
                                    size="md"
                                    isLocal={true}
                                    isSynced={false}
                                    showStatus={isOffline}
                                    onRemove={isSubmitting ? undefined : () => removePhoto(photo.id)}
                                />
                            ))}

                            {/* Botão adicionar mais - CÂMERA (Prioridade) */}
                            {canAddMore && !isProcessing && (
                                <button
                                    onClick={openCamera}
                                    className="aspect-square border-2 border-dashed border-gray-300 rounded-lg
                           flex flex-col items-center justify-center text-gray-400
                           hover:border-indigo-400 hover:text-indigo-500 transition-colors"
                                >
                                    <Camera className="w-8 h-8" />
                                    <span className="text-xs mt-1">Câmera</span>
                                </button>
                            )}
                        </div>
                    )}

                    {/* Link para Galeria (Secundário) quando já tem fotos */}
                    {photos.length > 0 && canAddMore && !isProcessing && (
                        <div className="flex justify-center mb-6">
                            <button
                                onClick={openGallery}
                                className="text-sm text-indigo-600 font-medium hover:text-indigo-800 underline flex items-center gap-1"
                            >
                                <Image className="w-4 h-4" />
                                Adicionar da Galeria
                            </button>
                        </div>
                    )}

                    {/* Botões de captura (quando não há fotos ainda) */}
                    {photos.length === 0 && !isProcessing && (
                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <button
                                onClick={openCamera}
                                className="flex flex-col items-center justify-center p-6 border-2 border-dashed 
                          border-indigo-300 rounded-xl hover:bg-indigo-50 transition-colors"
                            >
                                <Camera className="w-10 h-10 text-indigo-500 mb-2" />
                                <span className="text-sm font-medium text-indigo-700">Tirar Foto</span>
                            </button>

                            <button
                                onClick={openGallery}
                                className="flex flex-col items-center justify-center p-6 border-2 border-dashed 
                          border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
                            >
                                <Image className="w-10 h-10 text-gray-500 mb-2" />
                                <span className="text-sm font-medium text-gray-700">Galeria</span>
                            </button>
                        </div>
                    )}

                    {/* Loading */}
                    {isProcessing && (
                        <div className="flex flex-col items-center justify-center py-8">
                            <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-3" />
                            <span className="text-sm text-gray-600">Processando imagem...</span>
                        </div>
                    )}

                    {/* Erro */}
                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 flex items-center gap-2">
                            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                            <span className="text-red-700 text-sm">{error}</span>
                        </div>
                    )}

                    {/* Camera Error */}
                    {cameraError && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 mb-4">
                            <span className="text-yellow-700 text-sm">{cameraError}</span>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="bg-gray-50 px-6 py-4 flex gap-3">
                    <button
                        onClick={handleCancel}
                        disabled={isSubmitting}
                        className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-gray-700
                      font-medium hover:bg-gray-100 transition-colors h-auto min-h-[48px] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!canConfirm}
                        className={`flex-1 px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors h-auto min-h-[48px] whitespace-normal text-center leading-tight
                       ${canConfirm
                                ? 'bg-green-500 text-white hover:bg-green-600'
                                : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-5 h-5 flex-shrink-0 animate-spin" />
                                <span>Enviando fotos...</span>
                            </>
                        ) : (
                            <>
                                <Check className="w-5 h-5 flex-shrink-0" />
                                <span>{confirmLabel}</span>
                            </>
                        )}
                    </button>
                </div>

                {/* Hidden Inputs */}
                <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileSelect}
                />
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileSelect}
                />
            </div>
        </div>,
        document.body
    );
}
