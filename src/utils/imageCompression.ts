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

// Abaixo disso a foto ja esta pequena: nao vale processar nem arriscar ampliar.
const SKIP_COMPRESSION_BYTES = 400 * 1024;

// Acima disso o envio comeca a pesar em rede de rua; tenta de novo mais agressivo.
const TARGET_MAX_BYTES = 600 * 1024;

// Tentativas em cascata, da melhor qualidade para a mais economica.
const ATTEMPTS: CompressionOptions[] = [
    { maxWidth: 1200, quality: 0.75 },
    { maxWidth: 1000, quality: 0.7 },
    { maxWidth: 800, quality: 0.6 },
];

export interface CompressionOutcome {
    blob: Blob;
    /** false = nao foi possivel reduzir e o original esta sendo usado */
    compressed: boolean;
    originalSize: number;
    attempts: number;
}

interface DecodedImage {
    source: CanvasImageSource;
    width: number;
    height: number;
    release: () => void;
}

/**
 * Decodifica a imagem ja no tamanho de destino quando o navegador permite.
 *
 * Camera de celular hoje gera fotos de 48 a 108 megapixels. O caminho antigo
 * (<img> + canvas) precisa alocar a imagem inteira na memoria para so entao
 * reduzir, e e ai que aparelho mais simples desiste — era a causa de um terco
 * das fotos subirem sem compressao nenhuma.
 */
async function decodeImage(file: File | Blob, maxWidth: number): Promise<DecodedImage> {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(file, {
                resizeWidth: maxWidth,
                resizeQuality: 'high',
                // Sem isso, foto tirada na vertical sobe deitada: o <img> aplicava
                // a rotacao do EXIF sozinho, aqui e preciso pedir.
                imageOrientation: 'from-image',
            });
            return {
                source: bitmap,
                width: bitmap.width,
                height: bitmap.height,
                release: () => bitmap.close(),
            };
        } catch {
            // Navegador sem suporte as opcoes de redimensionamento: usa o caminho antigo.
        }
    }

    return new Promise<DecodedImage>((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            resolve({
                source: img,
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height,
                release: () => URL.revokeObjectURL(url),
            });
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Falha ao carregar imagem'));
        };

        img.src = url;
    });
}

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
    const maxW = opts.maxWidth || 1200;
    const maxH = opts.maxHeight || Infinity;

    const decoded = await decodeImage(file, maxW);

    try {
        // O decodificador pode ter ignorado o redimensionamento: recalcula sempre.
        let width = decoded.width;
        let height = decoded.height;

        if (width > maxW) {
            height = Math.round((height * maxW) / width);
            width = maxW;
        }

        if (height > maxH) {
            width = Math.round((width * maxH) / height);
            height = maxH;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Não foi possível criar contexto 2D');

        ctx.drawImage(decoded.source, 0, 0, width, height);

        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Falha ao comprimir imagem'));
                },
                opts.mimeType,
                opts.quality
            );
        });
    } finally {
        decoded.release();
    }
}

/**
 * Comprime insistindo: se a foto continuar grande, tenta de novo menor.
 *
 * Nunca falha silenciosamente — quando nao consegue reduzir, devolve o original
 * com compressed=false para quem chamou poder avisar o usuario, em vez de subir
 * varios megabytes sem ninguem perceber.
 */
export async function compressImageWithFallback(file: File | Blob): Promise<CompressionOutcome> {
    const originalSize = file.size;

    // Ja esta pequena o bastante: processar so gastaria tempo e poderia ampliar.
    if (originalSize > 0 && originalSize <= SKIP_COMPRESSION_BYTES) {
        return { blob: file, compressed: true, originalSize, attempts: 0 };
    }

    let melhor: Blob | null = null;
    let attempts = 0;

    for (const attempt of ATTEMPTS) {
        attempts++;
        try {
            const blob = await compressImage(file, attempt);

            if (!melhor || blob.size < melhor.size) melhor = blob;
            if (blob.size <= TARGET_MAX_BYTES) break;
        } catch (err) {
            console.warn(`[compressImage] Tentativa ${attempts} falhou:`, err);
        }
    }

    if (melhor && melhor.size < originalSize) {
        return { blob: melhor, compressed: true, originalSize, attempts };
    }

    console.warn(
        `[compressImage] Não foi possível reduzir a imagem (${formatFileSize(originalSize)}). Enviando original.`
    );
    return { blob: file, compressed: false, originalSize, attempts };
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
