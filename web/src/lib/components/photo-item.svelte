<script lang="ts">
  import type { Photo } from '@immich/sdk';
  import { PHOTO_NAME_MAX_LENGTH } from '$lib/constants';
  import { formatTimestamp } from '$lib/utils';

  interface Props {
    photo: Photo;
    /** Resolve `false` to stay in edit mode (the rename failed). */
    onRename: (name: string) => Promise<boolean>;
    onDelete: () => Promise<void>;
  }

  let { photo, onRename, onDelete }: Props = $props();

  let editing = $state(false);
  // Seeded in `startEditing` rather than from `photo.name`: copying a prop into
  // local state at initialisation would freeze the first value it ever had.
  let draft = $state('');
  let busy = $state(false);

  function startEditing(): void {
    draft = photo.name;
    editing = true;
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    const name = draft.trim();

    if (!name || name === photo.name) {
      editing = false;

      return;
    }

    busy = true;

    try {
      editing = !(await onRename(name));
    } finally {
      busy = false;
    }
  }

  async function handleDelete(): Promise<void> {
    busy = true;

    try {
      await onDelete();
    } finally {
      busy = false;
    }
  }
</script>

<li class="photo">
  {#if editing}
    <form onsubmit={save}>
      <input
        type="text"
        bind:value={draft}
        maxlength={PHOTO_NAME_MAX_LENGTH}
        aria-label="New name"
      />
      <button type="submit" disabled={busy}>Save</button>
      <button type="button" class="secondary" onclick={() => (editing = false)} disabled={busy}>
        Cancel
      </button>
    </form>
  {:else}
    <div class="details">
      <p class="name">{photo.name}</p>
      <p class="muted">updated {formatTimestamp(photo.updatedAt)}</p>
    </div>
    <div class="actions">
      <button type="button" class="secondary" onclick={startEditing} disabled={busy}>Rename</button>
      <button type="button" class="danger" onclick={handleDelete} disabled={busy}>Delete</button>
    </div>
  {/if}
</li>

<style>
  .photo {
    align-items: center;
    border-bottom: 1px solid var(--border);
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
    padding: 0.75rem 0;
  }

  .photo form {
    display: flex;
    flex: 1;
    gap: 0.5rem;
  }

  .name {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .photo p.muted {
    font-size: 0.8rem;
    margin: 0.15rem 0 0;
  }

  .actions {
    display: flex;
    flex-shrink: 0;
    gap: 0.4rem;
  }
</style>
