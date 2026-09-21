<script lang="ts">
  import { PHOTO_NAME_MAX_LENGTH } from '$lib/constants';

  interface Props {
    /** Called with the trimmed name. Resolve `false` to keep the input filled. */
    onSubmit: (name: string) => Promise<boolean>;
    submitLabel?: string;
    placeholder?: string;
  }

  let { onSubmit, submitLabel = 'Add photo', placeholder = 'sunset.jpg' }: Props = $props();

  let name = $state('');
  let busy = $state(false);

  const canSubmit = $derived(name.trim().length > 0 && !busy);

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    const trimmed = name.trim();

    if (!trimmed) {
      return;
    }

    busy = true;

    try {
      if (await onSubmit(trimmed)) {
        name = '';
      }
    } finally {
      busy = false;
    }
  }
</script>

<form class="photo-form" onsubmit={handleSubmit}>
  <input
    type="text"
    bind:value={name}
    maxlength={PHOTO_NAME_MAX_LENGTH}
    {placeholder}
    aria-label="Photo name"
    required
  />
  <button type="submit" disabled={!canSubmit}>{submitLabel}</button>
</form>

<style>
  .photo-form {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
</style>
