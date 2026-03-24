import { supabase } from '../supabase/client';
import { base64ToBlob } from '../utils/imageCompression';
import type { CapturedPhoto } from '../components/photos';
import type { FleetInspectionPhoto } from '../types/database';

const BUCKET_NAME = 'fleet-inspections';
const URL_EXPIRY_SECONDS = 3600;

export interface FleetUploadedPhotoPayload {
  storage_path: string;
  file_name: string;
  file_size: number;
  caption?: string | null;
}

export const FleetPhotoService = {
  async uploadInspectionPhotos(
    vehicleId: string,
    inspectionId: string,
    photos: CapturedPhoto[]
  ): Promise<FleetUploadedPhotoPayload[]> {
    const uploaded: FleetUploadedPhotoPayload[] = [];

    for (const photo of photos) {
      const blob = base64ToBlob(photo.base64);
      const storagePath = `${vehicleId}/${inspectionId}/${Date.now()}_${photo.fileName}`;

      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, blob, {
          contentType: photo.mimeType || 'image/jpeg',
          upsert: false,
        });

      if (error) {
        await this.removePaths(uploaded.map((item) => item.storage_path));
        throw new Error(error.message || 'Falha no upload das fotos da inspeção');
      }

      uploaded.push({
        storage_path: storagePath,
        file_name: photo.fileName,
        file_size: photo.fileSize,
      });
    }

    return uploaded;
  },

  async removePaths(paths: string[]) {
    if (paths.length === 0) {
      return;
    }

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove(paths);

    if (error) {
      console.error('[FleetPhotoService] erro ao remover fotos:', error);
    }
  },

  async getSignedUrl(storagePath: string): Promise<string | null> {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(storagePath, URL_EXPIRY_SECONDS);

    if (error) {
      console.error('[FleetPhotoService] erro ao gerar signed url:', error);
      return null;
    }

    return data.signedUrl;
  },

  async resolvePhotoUrls(photos: FleetInspectionPhoto[]) {
    const resolved = await Promise.all(
      photos.map(async (photo) => ({
        ...photo,
        signedUrl: await this.getSignedUrl(photo.storage_path),
      }))
    );

    return resolved;
  },
};

export default FleetPhotoService;
