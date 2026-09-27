<script lang="ts">
  import UserForm from '$lib/components/user-form.svelte';
  import UserTable from '$lib/components/user-table.svelte';
  import { userManager } from '$lib/managers/user-manager.svelte';
</script>

<section>
  <div class="mb-4">
    <h2 class="text-lg font-semibold">Users</h2>
    <p class="mt-1 text-sm text-muted">Create, edit and remove users on this instance.</p>
  </div>

  <UserForm onSubmit={(name, email) => userManager.create(name, email)} />

  {#if userManager.error}
    <p class="text-danger" role="alert">{userManager.error}</p>
  {/if}

  <div class="mb-3 flex justify-end">
    <button
      type="button"
      class="btn btn-secondary"
      onclick={() => void userManager.load()}
      disabled={userManager.loading}
    >
      {userManager.loading ? 'Refreshing…' : 'Refresh'}
    </button>
  </div>

  <UserTable
    users={userManager.users}
    onUpdate={(id, name, email) => userManager.update(id, name, email)}
    onDelete={(id) => userManager.remove(id)}
  />
</section>
