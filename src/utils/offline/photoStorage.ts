/**
 * PhotoStorage - Gerenciamento de fotos offline usando localforage (IndexedDB)
 * Armazena fotos localmente até serem sincronizadas com o Supabase Storage
 */

import localforage from 'localforage';

// Instância dedicada para fotos
const photoStorage = localforage.createInstance({
    name: 'deliveryApp',
    storeName: 'assembly_photos',
    description: 'Offline storage for assembly photos',
});

// Estrutura de uma foto pendente
export interface PendingPhoto {
    id: string;                      // ID local único
    assemblyProductId: string;       // ID do assembly_product relacionado
    base64Data: string;              // Dados da imagem em base64
    fileName: string;                // Nome do arquivo
    fileSize: number;                // Tamanho em bytes
    mimeType: string;                // Tipo MIME
    createdAt: number;               // Timestamp de criação
    createdBy: string;               // ID do usuário
    isSynced: boolean;               // Se já foi enviada ao Storage
    storagePath?: string;            // Caminho no Storage (após sync)
    remoteId?: string;               // ID no banco remoto (após sync)
    syncAttempts: number;            // Tentativas de sync
    lastSyncError?: string;          // Último erro de sync
}

/**
 * Gera ID único para foto local
 */
function generateLocalId(): string {
    return `photo_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export const PhotoStorage = {
    /**
     * Salva uma foto localmente
     */
    async saveLocal(
        assemblyProductId: string,
        base64Data: string,
        fileName: string,
        fileSize: number,
        mimeType: string,
        userId: string
    ): Promise<PendingPhoto> {
        const photo: PendingPhoto = {
            id: generateLocalId(),
            assemblyProductId,
            base64Data,
            fileName,
            fileSize,
            mimeType,
            createdAt: Date.now(),
            createdBy: userId,
            isSynced: false,
            syncAttempts: 0,
        };

        await photoStorage.setItem(photo.id, photo);
        console.log('[PhotoStorage] Foto salva localmente:', photo.id);

        return photo;
    },

    /**
     * Recupera todas as fotos de um produto específico
     */
    async getByProduct(assemblyProductId: string): Promise<PendingPhoto[]> {
        const photos: PendingPhoto[] = [];

        await photoStorage.iterate<PendingPhoto, void>((value) => {
            if (value.assemblyProductId === assemblyProductId) {
                photos.push(value);
            }
        });

        // Ordenar por data de criação
        return photos.sort((a, b) => a.createdAt - b.createdAt);
    },

    /**
     * Recupera todas as fotos pendentes de sync
     */
    async getPendingSync(): Promise<PendingPhoto[]> {
        const pending: PendingPhoto[] = [];

        await photoStorage.iterate<PendingPhoto, void>((value) => {
            if (!value.isSynced) {
                pending.push(value);
            }
        });

        return pending.sort((a, b) => a.createdAt - b.createdAt);
    },

    /**
     * Recupera uma foto específica pelo ID
     */
    async getById(id: string): Promise<PendingPhoto | null> {
        return await photoStorage.getItem(id);
    },

    /**
     * Marca foto como sincronizada
     */
    async markSynced(
        localId: string,
        storagePath: string,
        remoteId: string
    ): Promise<void> {
        const photo = await photoStorage.getItem<PendingPhoto>(localId);

        if (photo) {
            photo.isSynced = true;
            photo.storagePath = storagePath;
            photo.remoteId = remoteId;
            await photoStorage.setItem(localId, photo);
            console.log('[PhotoStorage] Foto marcada como sincronizada:', localId);
        }
    },

    /**
     * Registra erro de sync
     */
    async recordSyncError(localId: string, error: string): Promise<void> {
        const photo = await photoStorage.getItem<PendingPhoto>(localId);

        if (photo) {
            photo.syncAttempts += 1;
            photo.lastSyncError = error;
            await photoStorage.setItem(localId, photo);
        }
    },

    /**
     * Remove foto do armazenamento local
     */
    async remove(localId: string): Promise<void> {
        await photoStorage.removeItem(localId);
        console.log('[PhotoStorage] Foto removida:', localId);
    },

    /**
     * Limpa todas as fotos já sincronizadas (libera espaço)
     */
    async cleanSynced(): Promise<number> {
        const toRemove: string[] = [];

        await photoStorage.iterate<PendingPhoto, void>((value, key) => {
            if (value.isSynced) {
                toRemove.push(key);
            }
        });

        for (const key of toRemove) {
            await photoStorage.removeItem(key);
        }

        console.log(`[PhotoStorage] Limpeza: ${toRemove.length} fotos sincronizadas removidas`);
        return toRemove.length;
    },

    /**
     * Conta fotos pendentes de sync
     */
    async countPending(): Promise<number> {
        const pending = await this.getPendingSync();
        return pending.length;
    },

    /**
     * Conta fotos de um produto
     */
    async countByProduct(assemblyProductId: string): Promise<number> {
        const photos = await this.getByProduct(assemblyProductId);
        return photos.length;
    },

    /**
     * Limpa todo o banco (usar com cuidado!)
     */
    async clearAll(): Promise<void> {
        await photoStorage.clear();
        console.log('[PhotoStorage] Banco limpo completamente');
    },
};

export default PhotoStorage;
