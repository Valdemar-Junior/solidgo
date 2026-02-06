/**
 * Photos Components - Exports centralizados
 * Componentes isolados para funcionalidade de fotos de montagem e entrega
 */

// Componentes principais
export { default as PhotoCaptureModal } from './PhotoCaptureModal';
export { default as PhotoGallery } from './PhotoGallery';
export { default as PhotoThumbnail } from './PhotoThumbnail';
export { default as AssemblyPhotosViewer } from './AssemblyPhotosViewer';
export { default as DeliveryPhotosViewer } from './DeliveryPhotosViewer';

// Types
export type { CapturedPhoto, PhotoCaptureModalProps } from './PhotoCaptureModal';
export type { PhotoItem, PhotoGalleryProps } from './PhotoGallery';
export type { PhotoThumbnailProps } from './PhotoThumbnail';
export type { AssemblyPhotosViewerProps } from './AssemblyPhotosViewer';
export type { DeliveryPhotosViewerProps } from './DeliveryPhotosViewer';
