/**
 * AssemblyPhotosViewer - Botão + Modal para visualizar fotos de montagem
 * 
 * Componente isolado que:
 * 1. Mostra um botão "📸 X fotos" se houver fotos
 * 2. Carrega as fotos APENAS quando o usuário clica (lazy loading)
 * 3. Abre modal com galeria de fotos
 * 
 * Uso:
 * <AssemblyPhotosViewer assemblyProductId="uuid-do-produto" />
 */

import { useState, useEffect } from 'react';
import { Camera, X, Loader2, ImageOff } from 'lucide-react';
import { supabase } from '../../supabase/client';
import { PhotoGallery, PhotoItem } from './index';

export interface AssemblyPhotosViewerProps {
    /** ID do assembly_product para buscar as fotos */
    assemblyProductId: string;
    /** Tamanho do botão: sm, md, lg */
    size?: 'sm' | 'md' | 'lg';
    /** Mostrar mesmo sem fotos (para debug) */
    showEmpty?: boolean;
}

interface PhotoRecord {
    id: string;
    storage_path: string;
    file_name: string;
    created_at: string;
}

export default function AssemblyPhotosViewer({
    assemblyProductId,
    size = 'sm',
    showEmpty = false,
}: AssemblyPhotosViewerProps) {
    // Estado: contagem de fotos (busca leve)
    const [photoCount, setPhotoCount] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Estado: modal e fotos carregadas
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [photos, setPhotos] = useState<PhotoItem[]>([]);
    const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Buscar APENAS contagem de fotos (leve, sem carregar imagens)
    useEffect(() => {
        const fetchCount = async () => {
            try {
                setIsLoading(true);
                const { count, error } = await supabase
                    .from('assembly_photos')
                    .select('*', { count: 'exact', head: true })
                    .eq('assembly_product_id', assemblyProductId);

                if (error) throw error;
                setPhotoCount(count || 0);
            } catch (err) {
                console.error('[AssemblyPhotosViewer] Erro ao buscar contagem:', err);
                setPhotoCount(0);
            } finally {
                setIsLoading(false);
            }
        };

        if (assemblyProductId) {
            fetchCount();
        }
    }, [assemblyProductId]);

    // Carregar fotos completas (só quando abre o modal)
    const loadPhotos = async () => {
        try {
            setIsLoadingPhotos(true);
            setError(null);

            // Buscar registros das fotos
            const { data, error: fetchError } = await supabase
                .from('assembly_photos')
                .select('id, storage_path, file_name, created_at')
                .eq('assembly_product_id', assemblyProductId)
                .order('created_at', { ascending: true });

            if (fetchError) throw fetchError;
            if (!data || data.length === 0) {
                setPhotos([]);
                return;
            }

            // Gerar URLs assinadas para cada foto
            const photosWithUrls: PhotoItem[] = await Promise.all(
                data.map(async (record: PhotoRecord) => {
                    const { data: signedData } = await supabase.storage
                        .from('assembly-photos')
                        .createSignedUrl(record.storage_path, 3600); // 1 hora de validade

                    return {
                        id: record.id,
                        src: signedData?.signedUrl || '',
                        alt: record.file_name,
                        timestamp: record.created_at,
                        isLocal: false,
                        isSynced: true,
                    };
                })
            );

            setPhotos(photosWithUrls.filter(p => p.src)); // Só fotos com URL válida
        } catch (err: any) {
            console.error('[AssemblyPhotosViewer] Erro ao carregar fotos:', err);
            setError('Erro ao carregar fotos');
        } finally {
            setIsLoadingPhotos(false);
        }
    };

    // Abrir modal e carregar fotos
    const handleOpenModal = () => {
        setIsModalOpen(true);
        loadPhotos();
    };

    // Fechar modal
    const handleCloseModal = () => {
        setIsModalOpen(false);
        setPhotos([]);
        setError(null);
    };

    // Se ainda está carregando contagem, não mostra nada
    if (isLoading) {
        return null;
    }

    // Se não tem fotos e não é debug, não mostra nada
    if (photoCount === 0 && !showEmpty) {
        return null;
    }

    // Estilos baseados no tamanho
    const sizeClasses = {
        sm: 'text-xs px-2 py-1',
        md: 'text-sm px-3 py-1.5',
        lg: 'text-base px-4 py-2',
    };

    return (
        <>
            {/* Botão para abrir fotos */}
            <button
                onClick={handleOpenModal}
                className={`
          inline-flex items-center gap-1.5 rounded-lg font-medium
          bg-indigo-50 text-indigo-700 border border-indigo-200
          hover:bg-indigo-100 hover:border-indigo-300
          transition-colors
          ${sizeClasses[size]}
        `}
                title="Ver fotos da montagem"
            >
                <Camera className="w-4 h-4" />
                <span>{photoCount} {photoCount === 1 ? 'foto' : 'fotos'}</span>
            </button>

            {/* Modal de visualização */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                        {/* Header */}
                        <div className="bg-indigo-600 text-white px-6 py-4 flex items-center justify-between flex-shrink-0">
                            <div className="flex items-center gap-2">
                                <Camera className="w-5 h-5" />
                                <h2 className="text-lg font-bold">Fotos da Montagem</h2>
                                <span className="bg-white/20 px-2 py-0.5 rounded text-sm">
                                    {photoCount} {photoCount === 1 ? 'foto' : 'fotos'}
                                </span>
                            </div>
                            <button
                                onClick={handleCloseModal}
                                className="p-2 hover:bg-white/20 rounded-full transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Conteúdo */}
                        <div className="p-6 overflow-y-auto flex-1">
                            {/* Loading */}
                            {isLoadingPhotos && (
                                <div className="flex flex-col items-center justify-center py-12">
                                    <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-3" />
                                    <span className="text-gray-600">Carregando fotos...</span>
                                </div>
                            )}

                            {/* Erro */}
                            {error && (
                                <div className="flex flex-col items-center justify-center py-12 text-red-500">
                                    <ImageOff className="w-10 h-10 mb-3" />
                                    <span>{error}</span>
                                </div>
                            )}

                            {/* Fotos */}
                            {!isLoadingPhotos && !error && photos.length > 0 && (
                                <PhotoGallery
                                    photos={photos}
                                    emptyMessage="Nenhuma foto encontrada"
                                />
                            )}

                            {/* Sem fotos */}
                            {!isLoadingPhotos && !error && photos.length === 0 && (
                                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                                    <ImageOff className="w-10 h-10 mb-3" />
                                    <span>Nenhuma foto encontrada</span>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="bg-gray-50 px-6 py-4 flex justify-end flex-shrink-0 border-t">
                            <button
                                onClick={handleCloseModal}
                                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
                            >
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
