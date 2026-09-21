<script lang="ts">
  import PhotoForm from '$lib/components/photo-form.svelte';
  import PhotoList from '$lib/components/photo-list.svelte';
  import { photoManager } from '$lib/managers/photo-manager.svelte';
</script>

<section>
  <h2>Photos</h2>

  <PhotoForm onSubmit={(name) => photoManager.create(name)} />

  {#if photoManager.error}
    <p class="error" role="alert">{photoManager.error}</p>
  {/if}

  <div class="toolbar">
    <button
      type="button"
      class="secondary"
      onclick={() => void photoManager.load()}
      disabled={photoManager.loading}
    >
      {photoManager.loading ? 'Refreshing…' : 'Refresh'}
    </button>
  </div>

  <PhotoList
    photos={photoManager.photos}
    onRename={(id, name) => photoManager.rename(id, name)}
    onDelete={(id) => photoManager.remove(id)}
  />
</section>

<style>
  .toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 0.75rem;
  }
</style>
