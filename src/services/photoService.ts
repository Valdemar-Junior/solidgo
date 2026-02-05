/**
 * PhotoService - Serviço para upload/download de fotos do Supabase Storage
 */

import { supabase } from '../supabase/client';
import { PhotoStorage, PendingPhoto } from '../utils/offline/photoStorage';
import { base64ToBlob } from '../utils/imageCompression';

// Nome do bucket no Supabase Storage
const BUCKET_NAME = 'assembly-photos';

// Tempo de expiração da URL assinada (1 hora)
const URL_EXPIRY_SECONDS = 3600;

export interface UploadResult {
    success: boolean;
    storagePath?: string;
    error?: string;
}

export interface PhotoRecord {
    id: string;
    assembly_product_id: string;
    storage_path: string;
    file_name: string | null;
    file_size: number | null;
    uploaded_at: string | null;
    created_at: string;
    created_by: string | null;
    is_synced: boolean;
}

export const PhotoService = {
    /**
     * Faz upload de uma foto para o Supabase Storage
     */
    async upload(
        blob: Blob,
        assemblyProductId: string,
        fileName: string
    ): Promise<UploadResult> {
        try {
            // Gerar caminho único: {assembly_product_id}/{timestamp}_{filename}
            const storagePath = `${assemblyProductId}/${Date.now()}_${fileName}`;

            // Upload para o Storage
            const { error: uploadError } = await supabase.storage
                .from(BUCKET_NAME)
                .upload(storagePath, blob, {
                    contentType: blob.type || 'image/jpeg',
                    upsert: false,
                });

            if (uploadError) {
                console.error('[PhotoService] Erro no upload:', uploadError);
                return { success: false, error: uploadError.message };
            }

            return { success: true, storagePath };
        } catch (err: any) {
            console.error('[PhotoService] Exceção no upload:', err);
            return { success: false, error: err.message || 'Erro desconhecido' };
        }
    },

    /**
     * Salva registro da foto no banco de dados
     */
    async saveRecord(
        assemblyProductId: string,
        storagePath: string,
        fileName: string,
        fileSize: number,
        userId: string
    ): Promise<{ success: boolean; id?: string; error?: string }> {
        try {
            const { data, error } = await supabase
                .from('assembly_photos')
                .insert({
                    assembly_product_id: assemblyProductId,
                    storage_path: storagePath,
                    file_name: fileName,
                    file_size: fileSize,
                    uploaded_at: new Date().toISOString(),
                    created_by: userId,
                    is_synced: true,
                })
                .select('id')
                .single();

            if (error) {
                console.error('[PhotoService] Erro ao salvar registro:', error);
                return { success: false, error: error.message };
            }

            return { success: true, id: data.id };
        } catch (err: any) {
            return { success: false, error: err.message || 'Erro desconhecido' };
        }
    },

    /**
     * Faz upload completo: Storage + registro no banco
     */
    async uploadComplete(
        blob: Blob,
        assemblyProductId: string,
        fileName: string,
        userId: string
    ): Promise<{ success: boolean; remoteId?: string; storagePath?: string; error?: string }> {
        // 1. Upload para o Storage
        const uploadResult = await this.upload(blob, assemblyProductId, fileName);
        if (!uploadResult.success || !uploadResult.storagePath) {
            return { success: false, error: uploadResult.error };
        }

        // 2. Salvar registro no banco
        const saveResult = await this.saveRecord(
            assemblyProductId,
            uploadResult.storagePath,
            fileName,
            blob.size,
            userId
        );

        if (!saveResult.success) {
            // Rollback: tentar deletar do Storage
            await this.delete(uploadResult.storagePath);
            return { success: false, error: saveResult.error };
        }

        return {
            success: true,
            remoteId: saveResult.id,
            storagePath: uploadResult.storagePath,
        };
    },

    /**
     * Sincroniza uma foto pendente do armazenamento local
     */
    async syncPendingPhoto(pendingPhoto: PendingPhoto): Promise<boolean> {
        try {
            // Converter base64 de volta para Blob
            const blob = base64ToBlob(pendingPhoto.base64Data);

            // Upload completo
            const result = await this.uploadComplete(
                blob,
                pendingPhoto.assemblyProductId,
                pendingPhoto.fileName,
                pendingPhoto.createdBy
            );

            if (result.success && result.storagePath && result.remoteId) {
                // Marcar como sincronizada no IndexedDB
                await PhotoStorage.markSynced(
                    pendingPhoto.id,
                    result.storagePath,
                    result.remoteId
                );
                return true;
            } else {
                // Registrar erro
                await PhotoStorage.recordSyncError(
                    pendingPhoto.id,
                    result.error || 'Erro desconhecido'
                );
                return false;
            }
        } catch (err: any) {
            await PhotoStorage.recordSyncError(
                pendingPhoto.id,
                err.message || 'Exceção durante sync'
            );
            return false;
        }
    },

    /**
     * Sincroniza todas as fotos pendentes
     */
    async syncAllPending(): Promise<{ synced: number; failed: number }> {
        const pending = await PhotoStorage.getPendingSync();
        let synced = 0;
        let failed = 0;

        for (const photo of pending) {
            const success = await this.syncPendingPhoto(photo);
            if (success) {
                synced++;
            } else {
                failed++;
            }
        }

        // Limpar fotos sincronizadas para liberar espaço
        if (synced > 0) {
            await PhotoStorage.cleanSynced();
        }

        console.log(`[PhotoService] Sync completo: ${synced} sucesso, ${failed} falhas`);
        return { synced, failed };
    },

    /**
     * Gera URL assinada para visualização de uma foto
     */
    async getSignedUrl(storagePath: string): Promise<string | null> {
        try {
            const { data, error } = await supabase.storage
                .from(BUCKET_NAME)
                .createSignedUrl(storagePath, URL_EXPIRY_SECONDS);

            if (error) {
                console.error('[PhotoService] Erro ao gerar URL:', error);
                return null;
            }

            return data.signedUrl;
        } catch (err) {
            console.error('[PhotoService] Exceção ao gerar URL:', err);
            return null;
        }
    },

    /**
     * Busca fotos de um produto (do banco de dados)
     */
    async getByProduct(assemblyProductId: string): Promise<PhotoRecord[]> {
        try {
            const { data, error } = await supabase
                .from('assembly_photos')
                .select('*')
                .eq('assembly_product_id', assemblyProductId)
                .order('created_at', { ascending: true });

            if (error) {
                console.error('[PhotoService] Erro ao buscar fotos:', error);
                return [];
            }

            return data || [];
        } catch (err) {
            console.error('[PhotoService] Exceção ao buscar fotos:', err);
            return [];
        }
    },

    /**
     * Deleta uma foto (Storage + banco)
     * Apenas admin pode usar
     */
    async delete(storagePath: string): Promise<boolean> {
        try {
            // 1. Deletar do Storage
            const { error: storageError } = await supabase.storage
                .from(BUCKET_NAME)
                .remove([storagePath]);

            if (storageError) {
                console.error('[PhotoService] Erro ao deletar do Storage:', storageError);
                // Continua para tentar deletar do banco mesmo assim
            }

            // 2. Deletar do banco
            const { error: dbError } = await supabase
                .from('assembly_photos')
                .delete()
                .eq('storage_path', storagePath);

            if (dbError) {
                console.error('[PhotoService] Erro ao deletar do banco:', dbError);
                return false;
            }

            return true;
        } catch (err) {
            console.error('[PhotoService] Exceção ao deletar:', err);
            return false;
        }
    },

    /**
     * Conta quantas fotos um produto tem (locais + remotas)
     */
    async countPhotos(assemblyProductId: string): Promise<number> {
        // Contar locais
        const localCount = await PhotoStorage.countByProduct(assemblyProductId);

        // Contar remotas
        const remote = await this.getByProduct(assemblyProductId);
        const remoteCount = remote.length;

        // Retornar total (evitando duplicatas - locais já sincronizadas)
        const localPending = await PhotoStorage.getByProduct(assemblyProductId);
        const pendingCount = localPending.filter(p => !p.isSynced).length;

        return remoteCount + pendingCount;
    },
};

export default PhotoService;
