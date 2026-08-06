/**
 * DeliveryPhotoStorage - Gerenciamento de fotos de entrega offline (IndexedDB)
 * Armazena fotos localmente até serem sincronizadas com o Supabase Storage
 */

import localforage from 'localforage';

// Instância dedicada para fotos de entrega
const deliveryPhotoStorage = localforage.createInstance({
    name: 'deliveryApp',
    storeName: 'delivery_photos',
    description: 'Offline storage for delivery photos',
});

// Estrutura de uma foto pendente
export interface PendingDeliveryPhoto {
    id: string;                      // ID local único
    routeOrderId: string;            // ID do route_order relacionado
    photoType: string;               // 'product', 'receipt', 'return', etc.
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

// Versão leve de PendingDeliveryPhoto para listagens: sem o base64
export interface PendingDeliveryPhotoMeta {
    id: string;
    routeOrderId: string;
    fileName: string;
    syncAttempts: number;
    createdAt: number;
}

/**
 * Gera ID único para foto local
 */
function generateLocalId(): string {
    return `del_photo_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export const DeliveryPhotoStorage = {
    /**
     * Salva uma foto localmente
     */
    async saveLocal(
        routeOrderId: string,
        photoType: string,
        base64Data: string,
        fileName: string,
        fileSize: number,
        mimeType: string,
        userId: string
    ): Promise<PendingDeliveryPhoto> {
        const photo: PendingDeliveryPhoto = {
            id: generateLocalId(),
            routeOrderId,
            photoType,
            base64Data,
            fileName,
            fileSize,
            mimeType,
            createdAt: Date.now(),
            createdBy: userId,
            isSynced: false,
            syncAttempts: 0,
        };

        await deliveryPhotoStorage.setItem(photo.id, photo);
        console.log('[DeliveryPhotoStorage] Foto salva localmente:', photo.id);

        return photo;
    },

    /**
     * Recupera todas as fotos de um pedido específico
     */
    async getByOrder(routeOrderId: string): Promise<PendingDeliveryPhoto[]> {
        const photos: PendingDeliveryPhoto[] = [];

        await deliveryPhotoStorage.iterate<PendingDeliveryPhoto, void>((value) => {
            if (value.routeOrderId === routeOrderId) {
                photos.push(value);
            }
        });

        // Ordenar por data de criação
        return photos.sort((a, b) => a.createdAt - b.createdAt);
    },

    /**
     * Recupera todas as fotos pendentes de sync
     *
     * ATENCAO: retorna o base64 de TODAS as fotos de uma vez. Com acumulo
     * grande isso estoura a memoria da aba. Para o ciclo de sync use
     * getPendingSyncMeta() e carregue uma foto por vez com getById().
     */
    async getPendingSync(): Promise<PendingDeliveryPhoto[]> {
        const pending: PendingDeliveryPhoto[] = [];

        await deliveryPhotoStorage.iterate<PendingDeliveryPhoto, void>((value) => {
            if (!value.isSynced) {
                pending.push(value);
            }
        });

        return pending.sort((a, b) => a.createdAt - b.createdAt);
    },

    /**
     * Lista leve das fotos pendentes: so metadados, nunca o base64.
     */
    async getPendingSyncMeta(): Promise<PendingDeliveryPhotoMeta[]> {
        const pending: PendingDeliveryPhotoMeta[] = [];

        await deliveryPhotoStorage.iterate<PendingDeliveryPhoto, void>((value) => {
            if (!value.isSynced) {
                pending.push({
                    id: value.id,
                    routeOrderId: value.routeOrderId,
                    fileName: value.fileName,
                    syncAttempts: value.syncAttempts || 0,
                    createdAt: value.createdAt || 0,
                });
            }
        });

        return pending.sort((a, b) => a.createdAt - b.createdAt);
    },

    /**
     * Recupera uma foto específica pelo ID
     */
    async getById(id: string): Promise<PendingDeliveryPhoto | null> {
        return await deliveryPhotoStorage.getItem(id);
    },

    /**
     * Marca foto como sincronizada
     */
    async markSynced(
        localId: string,
        storagePath: string,
        remoteId: string
    ): Promise<void> {
        const photo = await deliveryPhotoStorage.getItem<PendingDeliveryPhoto>(localId);

        if (photo) {
            photo.isSynced = true;
            photo.storagePath = storagePath;
            photo.remoteId = remoteId;
            await deliveryPhotoStorage.setItem(localId, photo);
            console.log('[DeliveryPhotoStorage] Foto marcada como sincronizada:', localId);
        }
    },

    /**
     * Registra erro de sync
     */
    async recordSyncError(localId: string, error: string): Promise<void> {
        const photo = await deliveryPhotoStorage.getItem<PendingDeliveryPhoto>(localId);

        if (photo) {
            photo.syncAttempts += 1;
            photo.lastSyncError = error;
            await deliveryPhotoStorage.setItem(localId, photo);
        }
    },

    /**
     * Remove foto do armazenamento local
     */
    async remove(localId: string): Promise<void> {
        await deliveryPhotoStorage.removeItem(localId);
        console.log('[DeliveryPhotoStorage] Foto removida:', localId);
    },

    /**
     * Limpa todas as fotos já sincronizadas (libera espaço)
     */
    async cleanSynced(): Promise<number> {
        const toRemove: string[] = [];

        await deliveryPhotoStorage.iterate<PendingDeliveryPhoto, void>((value, key) => {
            if (value.isSynced) {
                toRemove.push(key);
            }
        });

        for (const key of toRemove) {
            await deliveryPhotoStorage.removeItem(key);
        }

        console.log(`[DeliveryPhotoStorage] Limpeza: ${toRemove.length} fotos de entrega sincronizadas removidas`);
        return toRemove.length;
    },

    /**
     * Conta fotos pendentes de sync
     */
    async countPending(): Promise<number> {
        const pending = await this.getPendingSyncMeta();
        return pending.length;
    },

    /**
     * Limpa todo o banco (usar com cuidado!)
     */
    async clearAll(): Promise<void> {
        await deliveryPhotoStorage.clear();
        console.log('[DeliveryPhotoStorage] Banco limpo completamente');
    },
};

export default DeliveryPhotoStorage;
