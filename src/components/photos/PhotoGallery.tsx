/**
 * PhotoGallery - Galeria de fotos para exibição
 * Mostra grid de thumbnails com opção de visualização em tela cheia
 */

import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, Trash2, Download, ZoomIn } from 'lucide-react';
import PhotoThumbnail from './PhotoThumbnail';

export interface PhotoItem {
    id: string;
    src: string;                    // URL ou base64
    fileName?: string;
    isLocal?: boolean;
    isSynced?: boolean;
    isSyncing?: boolean;
    hasError?: boolean;
}

export interface PhotoGalleryProps {
    photos: PhotoItem[];
    canDelete?: boolean;            // Mostrar botão de deletar (admin only)
    onDelete?: (photoId: string) => void;
    emptyMessage?: string;
    columns?: 2 | 3 | 4;
    thumbnailSize?: 'sm' | 'md' | 'lg';
}

export default function PhotoGallery({
    photos,
    canDelete = false,
    onDelete,
    emptyMessage = 'Nenhuma foto disponível',
    columns = 3,
    thumbnailSize = 'md',
}: PhotoGalleryProps) {
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

    const gridClasses = {
        2: 'grid-cols-2',
        3: 'grid-cols-3',
        4: 'grid-cols-4',
    };

    const openFullscreen = (index: number) => {
        setSelectedIndex(index);
    };

    const closeFullscreen = () => {
        setSelectedIndex(null);
    };

    const goToPrevious = () => {
        if (selectedIndex !== null && selectedIndex > 0) {
            setSelectedIndex(selectedIndex - 1);
        }
    };

    const goToNext = () => {
        if (selectedIndex !== null && selectedIndex < photos.length - 1) {
            setSelectedIndex(selectedIndex + 1);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') closeFullscreen();
        if (e.key === 'ArrowLeft') goToPrevious();
        if (e.key === 'ArrowRight') goToNext();
    };

    if (photos.length === 0) {
        return (
            <div className="text-center py-8 text-gray-500 text-sm">
                {emptyMessage}
            </div>
        );
    }

    return (
        <>
            {/* Grid de Thumbnails */}
            <div className={`grid ${gridClasses[columns]} gap-3`}>
                {photos.map((photo, index) => (
                    <PhotoThumbnail
                        key={photo.id}
                        src={photo.src}
                        alt={photo.fileName || `Foto ${index + 1}`}
                        isLocal={photo.isLocal}
                        isSynced={photo.isSynced}
                        isSyncing={photo.isSyncing}
                        hasError={photo.hasError}
                        size={thumbnailSize}
                        onClick={() => openFullscreen(index)}
                        onRemove={canDelete && onDelete ? () => onDelete(photo.id) : undefined}
                    />
                ))}
            </div>

            {/* Modal Fullscreen */}
            {selectedIndex !== null && (
                <div
                    className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center"
                    onClick={closeFullscreen}
                    onKeyDown={handleKeyDown}
                    tabIndex={0}
                >
                    {/* Botão Fechar */}
                    <button
                        onClick={closeFullscreen}
                        className="absolute top-4 right-4 text-white p-2 hover:bg-white/10 rounded-full transition-colors"
                    >
                        <X className="w-8 h-8" />
                    </button>

                    {/* Contador */}
                    <div className="absolute top-4 left-4 text-white text-sm bg-black/50 px-3 py-1 rounded-full">
                        {selectedIndex + 1} / {photos.length}
                    </div>

                    {/* Navegação Anterior */}
                    {selectedIndex > 0 && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                goToPrevious();
                            }}
                            className="absolute left-4 text-white p-2 hover:bg-white/10 rounded-full transition-colors"
                        >
                            <ChevronLeft className="w-10 h-10" />
                        </button>
                    )}

                    {/* Imagem */}
                    <img
                        src={photos[selectedIndex].src}
                        alt={photos[selectedIndex].fileName || `Foto ${selectedIndex + 1}`}
                        className="max-w-[90vw] max-h-[85vh] object-contain"
                        onClick={(e) => e.stopPropagation()}
                    />

                    {/* Navegação Próximo */}
                    {selectedIndex < photos.length - 1 && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                goToNext();
                            }}
                            className="absolute right-4 text-white p-2 hover:bg-white/10 rounded-full transition-colors"
                        >
                            <ChevronRight className="w-10 h-10" />
                        </button>
                    )}

                    {/* Ações (deletar) */}
                    {canDelete && onDelete && (
                        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-4">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete(photos[selectedIndex].id);
                                    closeFullscreen();
                                }}
                                className="text-white p-3 bg-red-500 hover:bg-red-600 rounded-full transition-colors"
                                title="Deletar foto"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
