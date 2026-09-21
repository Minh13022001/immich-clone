import { createPhoto, deletePhoto, getPhotos, updatePhoto, type Photo } from '@immich/sdk';

/**
 * Thin, app-shaped wrappers around the SDK.
 *
 * They exist so managers never import the SDK directly: swapping the transport,
 * or pointing the web app at a different backend, happens in this folder alone.
 */
export function listPhotos(): Promise<Photo[]> {
  return getPhotos();
}

export function addPhoto(name: string): Promise<Photo> {
  return createPhoto(name);
}

export function renamePhoto(id: string, name: string): Promise<Photo> {
  return updatePhoto(id, name);
}

export function removePhoto(id: string): Promise<void> {
  return deletePhoto(id);
}
