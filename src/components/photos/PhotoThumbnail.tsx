/**
 * PhotoThumbnail - Preview individual de foto
 * Mostra thumbnail com indicador de status de sincronização
 */

import { useState } from 'react';
import { X, Cloud, CloudOff, Loader2, CheckCircle } from 'lucide-react';

export interface PhotoThumbnailProps {
    src: string;                    // URL ou base64 da imagem
    alt?: string;
    isLocal?: boolean;              // Se é foto local (ainda não sincronizada)
    isSyncing?: boolean;            // Se está sincronizando agora
    isSynced?: boolean;             // Se já foi sincronizada
    hasError?: boolean;             // Se teve erro no sync
    onRemove?: () => void;          // Callback para remover (opcional)
    onClick?: () => void;           // Callback para clique (abrir fullscreen)
    size?: 'sm' | 'md' | 'lg';      // Tamanho do thumbnail
    showStatus?: boolean;           // Mostrar indicador de status
}

const sizeClasses = {
    sm: 'w-16 h-16',
    md: 'w-24 h-24',
    lg: 'w-32 h-32',
};

export default function PhotoThumbnail({
    src,
    alt = 'Foto',
    isLocal = false,
    isSyncing = false,
    isSynced = true,
    hasError = false,
    onRemove,
    onClick,
    size = 'md',
    showStatus = true,
}: PhotoThumbnailProps) {
    const [imageError, setImageError] = useState(false);

    // Determinar status para exibição
    const getStatusIcon = () => {
        if (isSyncing) {
            return (
                <div className="absolute bottom-1 right-1 bg-blue-500 rounded-full p-1" title="Sincronizando...">
                    <Loader2 className="w-3 h-3 text-white animate-spin" />
                </div>
            );
        }
        if (hasError) {
            return (
                <div className="absolute bottom-1 right-1 bg-red-500 rounded-full p-1" title="Erro ao sincronizar">
                    <CloudOff className="w-3 h-3 text-white" />
                </div>
            );
        }
        if (isLocal && !isSynced) {
            return (
                <div className="absolute bottom-1 right-1 bg-yellow-500 rounded-full p-1" title="Aguardando sincronização">
                    <Cloud className="w-3 h-3 text-white" />
                </div>
            );
        }
        if (isSynced && showStatus) {
            return (
                <div className="absolute bottom-1 right-1 bg-green-500 rounded-full p-1" title="Sincronizada">
                    <CheckCircle className="w-3 h-3 text-white" />
                </div>
            );
        }
        return null;
    };

    if (imageError) {
        return (
            <div
                className={`${sizeClasses[size]} bg-gray-200 rounded-lg flex items-center justify-center`}
            >
                <span className="text-gray-400 text-xs">Erro</span>
            </div>
        );
    }

    return (
        <div className={`relative ${sizeClasses[size]} group`}>
            {/* Imagem */}
            <img
                src={src}
                alt={alt}
                className={`
          ${sizeClasses[size]} 
          object-cover rounded-lg border-2 
          ${hasError ? 'border-red-300' : isLocal && !isSynced ? 'border-yellow-300' : 'border-gray-200'}
          ${onClick ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}
        `}
                onClick={onClick}
                onError={() => setImageError(true)}
            />

            {/* Botão de remover */}
            {onRemove && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 
                     opacity-0 group-hover:opacity-100 transition-opacity
                     hover:bg-red-600 shadow-md"
                    title="Remover foto"
                >
                    <X className="w-3 h-3" />
                </button>
            )}

            {/* Indicador de status */}
            {showStatus && getStatusIcon()}
        </div>
    );
}
