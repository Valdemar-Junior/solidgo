/**
 * Photos Components - Exports centralizados
 * Componentes isolados para funcionalidade de fotos de montagem
 */

// Componentes principais
export { default as PhotoCaptureModal } from './PhotoCaptureModal';
export { default as PhotoGallery } from './PhotoGallery';
export { default as PhotoThumbnail } from './PhotoThumbnail';

// Types
export type { CapturedPhoto, PhotoCaptureModalProps } from './PhotoCaptureModal';
export type { PhotoItem, PhotoGalleryProps } from './PhotoGallery';
export type { PhotoThumbnailProps } from './PhotoThumbnail';
