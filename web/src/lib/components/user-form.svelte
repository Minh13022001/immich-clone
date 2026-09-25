<script lang="ts">
  import { USER_EMAIL_MAX_LENGTH, USER_NAME_MAX_LENGTH } from '$lib/constants';

  interface Props {
    /** Called with the trimmed name/email. Resolve `false` to keep the inputs filled. */
    onSubmit: (name: string, email: string) => Promise<boolean>;
    submitLabel?: string;
    namePlaceholder?: string;
    emailPlaceholder?: string;
  }

  let {
    onSubmit,
    submitLabel = 'Add user',
    namePlaceholder = 'Ada Lovelace',
    emailPlaceholder = 'ada@example.com',
  }: Props = $props();

  let name = $state('');
  let email = $state('');
  let busy = $state(false);

  const canSubmit = $derived(name.trim().length > 0 && email.trim().length > 0 && !busy);

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName || !trimmedEmail) {
      return;
    }

    busy = true;

    try {
      if (await onSubmit(trimmedName, trimmedEmail)) {
        name = '';
        email = '';
      }
    } finally {
      busy = false;
    }
  }
</script>

<form class="user-form" onsubmit={handleSubmit}>
  <input
    type="text"
    bind:value={name}
    maxlength={USER_NAME_MAX_LENGTH}
    placeholder={namePlaceholder}
    aria-label="User name"
    required
  />
  <input
    type="email"
    bind:value={email}
    maxlength={USER_EMAIL_MAX_LENGTH}
    placeholder={emailPlaceholder}
    aria-label="User email"
    required
  />
  <button type="submit" disabled={!canSubmit}>{submitLabel}</button>
</form>

<style>
  .user-form {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
</style>
