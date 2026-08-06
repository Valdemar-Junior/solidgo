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
            // 23505 = a foto deste route_order já está registrada (constraint de unicidade).
            // Trata como sucesso e descarta o arquivo recém-enviado, que ficaria órfão no Storage.
            if ((error as { code?: string } | null)?.code === '23505') {
                console.warn('[DeliveryPhotoService] Foto já registrada, ignorando duplicata:', fileName);

                await supabase.storage.from(BUCKET_NAME).remove([storagePath]);

                const { data: existing } = await supabase
                    .from('delivery_photos')
                    .select()
                    .eq('route_order_id', routeOrderId)
                    .eq('file_name', fileName)
                    .maybeSingle();

                if (existing) return existing;
            }

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
            let dbRecord;
            try {
                dbRecord = await this.registerPhotoInDb(
                    photo.routeOrderId,
                    uploadResult.storagePath,
                    photo.fileName,
                    photo.fileSize,
                    photo.photoType
                );
            } catch (registerError) {
                // Sem registro o arquivo ficaria orfao no Storage — e a proxima
                // tentativa subiria outro. Remove antes de propagar o erro.
                await supabase.storage.from(BUCKET_NAME).remove([uploadResult.storagePath]);
                throw registerError;
            }

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
        // Roda a cada 30s pelo background sync. Trabalha SO com metadados e
        // carrega uma foto por vez, para nao estourar a memoria da aba com o
        // base64 de muitas fotos acumuladas (ver mesmo desenho no PhotoService).
        const meta = await DeliveryPhotoStorage.getPendingSyncMeta();
        if (meta.length === 0) return { processed: 0, failures: 0 };

        console.log(`[DeliveryPhotoService] ${meta.length} fotos pendentes...`);

        let processed = 0;
        let failures = 0;
        let purged = 0;

        // Foto ja registrada no servidor resolve por consulta, sem upload.
        const existingByKey = new Map<string, { id: string; storage_path: string }>();
        const routeOrderIds = Array.from(new Set(meta.map(m => m.routeOrderId)));
        for (let i = 0; i < routeOrderIds.length; i += 50) {
            const { data } = await supabase
                .from('delivery_photos')
                .select('id, route_order_id, file_name, storage_path')
                .in('route_order_id', routeOrderIds.slice(i, i + 50));
            for (const row of (data || []) as Array<{ id: string; route_order_id: string; file_name: string; storage_path: string }>) {
                existingByKey.set(`${row.route_order_id}|${row.file_name}`, row);
            }
        }

        const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
        const MAX_UPLOADS_PER_CYCLE = 5;
        let uploads = 0;

        for (const m of meta) {
            try {
                const found = existingByKey.get(`${m.routeOrderId}|${m.fileName}`);
                if (found) {
                    await DeliveryPhotoStorage.markSynced(m.id, found.storage_path, found.id);
                    processed++;
                    continue;
                }

                // Sobra antiga sem registro no servidor: remove em vez de tentar
                // para sempre (mesma regra do PhotoService).
                if (m.createdAt > 0 && Date.now() - m.createdAt > TWO_WEEKS_MS) {
                    await DeliveryPhotoStorage.remove(m.id);
                    purged++;
                    continue;
                }

                // Foto quebrada nao pode tentar para sempre gastando dados.
                if (m.syncAttempts >= 8) continue;

                if (uploads >= MAX_UPLOADS_PER_CYCLE) continue;
                uploads++;

                const photo = await DeliveryPhotoStorage.getById(m.id);
                if (!photo) continue;

                const success = await this.processPendingPhoto(photo);
                if (success) processed++;
                else failures++;
            } catch (err) {
                console.error('[DeliveryPhotoService] Erro ao processar foto pendente:', m.id, err);
                failures++;
            }
        }

        // Limpar fotos sincronizadas para liberar espaço
        if (processed > 0) {
            await DeliveryPhotoStorage.cleanSynced();
        }

        if (purged > 0) console.log(`[DeliveryPhotoService] ${purged} fotos legadas removidas`);
        return { processed, failures };
    }
};
