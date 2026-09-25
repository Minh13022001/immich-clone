<script lang="ts">
  import type { User } from '@immich/sdk';
  import { USER_EMAIL_MAX_LENGTH, USER_NAME_MAX_LENGTH } from '$lib/constants';
  import { formatTimestamp } from '$lib/utils';

  interface Props {
    user: User;
    /** Resolve `false` to stay in edit mode (the save failed). */
    onUpdate: (name: string, email: string) => Promise<boolean>;
    onDelete: () => Promise<void>;
  }

  let { user, onUpdate, onDelete }: Props = $props();

  let editing = $state(false);
  // Seeded in `startEditing` rather than from `user`: copying a prop into local
  // state at initialisation would freeze the first value it ever had.
  let nameDraft = $state('');
  let emailDraft = $state('');
  let busy = $state(false);

  function startEditing(): void {
    nameDraft = user.name;
    emailDraft = user.email;
    editing = true;
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    const name = nameDraft.trim();
    const email = emailDraft.trim();

    if (!name || !email || (name === user.name && email === user.email)) {
      editing = false;

      return;
    }

    busy = true;

    try {
      editing = !(await onUpdate(name, email));
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

<tr>
  {#if editing}
    <td colspan="4">
      <form class="editor" onsubmit={save}>
        <input
          type="text"
          bind:value={nameDraft}
          maxlength={USER_NAME_MAX_LENGTH}
          aria-label="User name"
        />
        <input
          type="email"
          bind:value={emailDraft}
          maxlength={USER_EMAIL_MAX_LENGTH}
          aria-label="User email"
        />
        <button type="submit" disabled={busy}>Save</button>
        <button type="button" class="secondary" onclick={() => (editing = false)} disabled={busy}>
          Cancel
        </button>
      </form>
    </td>
  {:else}
    <td class="name">{user.name}</td>
    <td class="email">{user.email}</td>
    <td class="muted">{formatTimestamp(user.updatedAt)}</td>
    <td class="actions">
      <button type="button" class="secondary" onclick={startEditing} disabled={busy}>Edit</button>
      <button type="button" class="danger" onclick={handleDelete} disabled={busy}>Delete</button>
    </td>
  {/if}
</tr>
