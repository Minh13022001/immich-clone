import type { Photo } from '@immich/sdk';

/**
 * A rune-backed store: the fields are `$state`, so any component that reads
 * them re-renders when they change.
 *
 * The store owns no logic beyond holding and editing the collection — network
 * calls live in services, decisions live in managers.
 */
class PhotosStore {
  photos = $state<Photo[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  set(photos: Photo[]): void {
    this.photos = photos;
  }

  prepend(photo: Photo): void {
    this.photos = [photo, ...this.photos];
  }

  replace(photo: Photo): void {
    this.photos = this.photos.map((existing) => (existing.id === photo.id ? photo : existing));
  }

  remove(id: string): void {
    this.photos = this.photos.filter((photo) => photo.id !== id);
  }
}

export const photosStore = new PhotosStore();
