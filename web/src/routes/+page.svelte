<script lang="ts">
  import UserForm from '$lib/components/user-form.svelte';
  import UserTable from '$lib/components/user-table.svelte';
  import { userManager } from '$lib/managers/user-manager.svelte';
</script>

<section>
  <h2>Users</h2>

  <UserForm onSubmit={(name, email) => userManager.create(name, email)} />

  {#if userManager.error}
    <p class="error" role="alert">{userManager.error}</p>
  {/if}

  <div class="toolbar">
    <button
      type="button"
      class="secondary"
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

<style>
  .toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 0.75rem;
  }
</style>
