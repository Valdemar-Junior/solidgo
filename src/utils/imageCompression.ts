/**
 * Utilitário para compressão de imagens
 * Redimensiona e comprime imagens antes de salvar/enviar
 */

interface CompressionOptions {
    maxWidth?: number;      // Largura máxima (default: 1200px)
    maxHeight?: number;     // Altura máxima (default: mantém proporção)
    quality?: number;       // Qualidade 0-1 (default: 0.75)
    mimeType?: string;      // Tipo de saída (default: image/jpeg)
}

const DEFAULT_OPTIONS: CompressionOptions = {
    maxWidth: 1200,
    quality: 0.75,
    mimeType: 'image/jpeg',
};

/**
 * Comprime uma imagem (File ou Blob) para reduzir tamanho
 * @param file - Arquivo de imagem original
 * @param options - Opções de compressão
 * @returns Promise<Blob> - Imagem comprimida
 */
export async function compressImage(
    file: File | Blob,
    options: CompressionOptions = {}
): Promise<Blob> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);

            // Calcular novas dimensões mantendo proporção
            let { width, height } = img;
            const maxW = opts.maxWidth || 1200;
            const maxH = opts.maxHeight || Infinity;

            if (width > maxW) {
                height = Math.round((height * maxW) / width);
                width = maxW;
            }

            if (height > maxH) {
                width = Math.round((width * maxH) / height);
                height = maxH;
            }

            // Criar canvas para redimensionar
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Não foi possível criar contexto 2D'));
                return;
            }

            // Desenhar imagem redimensionada
            ctx.drawImage(img, 0, 0, width, height);

            // Converter para blob comprimido
            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Falha ao comprimir imagem'));
                    }
                },
                opts.mimeType,
                opts.quality
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Falha ao carregar imagem'));
        };

        img.src = url;
    });
}

/**
 * Converte um Blob para Base64 string
 * Útil para armazenamento temporário no IndexedDB
 */
export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error('Falha ao converter para base64'));
            }
        };
        reader.onerror = () => reject(new Error('Falha ao ler blob'));
        reader.readAsDataURL(blob);
    });
}

/**
 * Converte Base64 string para Blob
 * Útil para recuperar do IndexedDB
 */
export function base64ToBlob(base64: string): Blob {
    const parts = base64.split(';base64,');
    const mimeType = parts[0].split(':')[1] || 'image/jpeg';
    const byteString = atob(parts[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);

    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }

    return new Blob([ab], { type: mimeType });
}

/**
 * Gera um nome de arquivo único baseado em timestamp
 */
export function generatePhotoFileName(prefix: string = 'photo'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}.jpg`;
}

/**
 * Formata tamanho de arquivo para exibição
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
