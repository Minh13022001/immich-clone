import { request } from './fetch-client';
import type { Photo } from './types';

export function getPhotos(): Promise<Photo[]> {
  return request<Photo[]>('/photos');
}

export function getPhoto(id: string): Promise<Photo> {
  return request<Photo>(`/photos/${encodeURIComponent(id)}`);
}

export function createPhoto(name: string): Promise<Photo> {
  return request<Photo>('/photos', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function updatePhoto(id: string, name: string): Promise<Photo> {
  return request<Photo>(`/photos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export function deletePhoto(id: string): Promise<void> {
  return request<void>(`/photos/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
