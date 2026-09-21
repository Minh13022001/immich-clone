<script lang="ts">
  import type { Photo } from '@immich/sdk';

  import PhotoItem from './photo-item.svelte';

  interface Props {
    photos: Photo[];
    onRename: (id: string, name: string) => Promise<boolean>;
    onDelete: (id: string) => Promise<void>;
  }

  let { photos, onRename, onDelete }: Props = $props();
</script>

{#if photos.length === 0}
  <p class="muted">No photos yet.</p>
{:else}
  <ul class="photo-list">
    {#each photos as photo (photo.id)}
      <PhotoItem
        {photo}
        onRename={(name) => onRename(photo.id, name)}
        onDelete={() => onDelete(photo.id)}
      />
    {/each}
  </ul>
{/if}

<style>
  .photo-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
</style>
