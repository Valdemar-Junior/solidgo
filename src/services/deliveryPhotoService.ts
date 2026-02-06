/**
 * DeliveryPhotoService - Serviço para upload/download de fotos de entrega
 */

import { supabase } from '../supabase/client';
import { DeliveryPhotoStorage, PendingDeliveryPhoto } from '../utils/offline/deliveryPhotoStorage';
import { base64ToBlob } from '../utils/imageCompression';

// Nome do bucket no Supabase Storage
const BUCKET_NAME = 'delivery-photos';

// Tempo de expiração da URL assinada (1 hora)
const URL_EXPIRY_SECONDS = 3600;

export interface DeliveryUploadResult {
    success: boolean;
    storagePath?: string;
    error?: string;
}

export const DeliveryPhotoService = {
    /**
     * Retorna a URL pública (ou assinada) para visualização
     */
    async getPhotoUrl(path: string): Promise<string | null> {
        try {
            // Tentar obter URL assinada primeiro (mais seguro se bucket for privado)
            const { data, error } = await supabase
                .storage
                .from(BUCKET_NAME)
                .createSignedUrl(path, URL_EXPIRY_SECONDS);

            if (error || !data) {
                // Fallback para URL pública
                const { data: publicData } = supabase
                    .storage
                    .from(BUCKET_NAME)
                    .getPublicUrl(path);
                return publicData.publicUrl;
            }

            return data.signedUrl;
        } catch (error) {
            console.error('[DeliveryPhotoService] Erro ao obter URL:', error);
            return null;
        }
    },

    /**
     * Faz upload de uma foto (online)
     */
    async uploadPhoto(
        routeOrderId: string,
        base64Data: string,
        fileName: string,
        photoType: string = 'general'
    ): Promise<DeliveryUploadResult> {
        try {
            // Converter base64 para Blob
            const blob = await base64ToBlob(base64Data);
            const file = new File([blob], fileName, { type: 'image/jpeg' });

            // Caminho: route_order_id/timestamp_filename
            const storagePath = `${routeOrderId}/${Date.now()}_${fileName}`;

            // Upload para o Storage
            const { data, error } = await supabase
                .storage
                .from(BUCKET_NAME)
                .upload(storagePath, file, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (error) throw error;

            return {
                success: true,
                storagePath: data.path
            };
        } catch (error: any) {
            console.error('[DeliveryPhotoService] Erro no upload:', error);
            return {
                success: false,
                error: error.message || 'Erro desconhecido no upload'
            };
        }
    },

    /**
     * Registra a foto na tabela delivery_photos
     */
    async registerPhotoInDb(
        routeOrderId: string,
        storagePath: string,
        fileName: string,
        fileSize: number,
        photoType: string
    ) {
        try {
            const userId = (await supabase.auth.getUser()).data.user?.id;

            const { data, error } = await supabase
                .from('delivery_photos')
                .insert({
                    route_order_id: routeOrderId,
                    storage_path: storagePath,
                    file_name: fileName,
                    file_size: fileSize,
                    photo_type: photoType,
                    is_synced: true,
                    created_by: userId
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('[DeliveryPhotoService] Erro ao registrar no banco:', error);
            throw error;
        }
    },

    /**
     * Processa o sync de uma foto pendente
     * Usado pelo worker de sincronização
     */
    async processPendingPhoto(photo: PendingDeliveryPhoto): Promise<boolean> {
        console.log(`[DeliveryPhotoService] Iniciando sync da foto: ${photo.id}`);

        try {
            // 1. Upload para o Storage
            const uploadResult = await this.uploadPhoto(
                photo.routeOrderId,
                photo.base64Data,
                photo.fileName,
                photo.photoType
            );

            if (!uploadResult.success || !uploadResult.storagePath) {
                throw new Error(uploadResult.error || 'Falha no upload');
            }

            // 2. Registrar no Banco
            const dbRecord = await this.registerPhotoInDb(
                photo.routeOrderId,
                uploadResult.storagePath,
                photo.fileName,
                photo.fileSize,
                photo.photoType
            );

            // 3. Atualizar status local
            await DeliveryPhotoStorage.markSynced(
                photo.id,
                uploadResult.storagePath,
                dbRecord.id
            );

            return true;
        } catch (error: any) {
            console.error(`[DeliveryPhotoService] Falha no sync da foto ${photo.id}:`, error);
            await DeliveryPhotoStorage.recordSyncError(photo.id, error.message);
            return false;
        }
    },

    /**
     * Sincroniza todas as fotos pendentes
     */
    async syncAllPending(): Promise<{ processed: number, failures: number }> {
        const pending = await DeliveryPhotoStorage.getPendingSync();
        let processed = 0;
        let failures = 0;

        if (pending.length === 0) return { processed: 0, failures: 0 };

        console.log(`[DeliveryPhotoService] Sincronizando ${pending.length} fotos pendentes...`);

        for (const photo of pending) {
            const success = await this.processPendingPhoto(photo);
            if (success) processed++;
            else failures++;
        }

        // Limpar fotos sincronizadas para liberar espaço
        if (processed > 0) {
            await DeliveryPhotoStorage.cleanSynced();
        }

        return { processed, failures };
    }
};
