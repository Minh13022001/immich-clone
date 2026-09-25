<script lang="ts">
  import type { User } from '@immich/sdk';

  import UserRow from './user-row.svelte';

  interface Props {
    users: User[];
    onUpdate: (id: string, name: string, email: string) => Promise<boolean>;
    onDelete: (id: string) => Promise<void>;
  }

  let { users, onUpdate, onDelete }: Props = $props();
</script>

{#if users.length === 0}
  <p class="muted">No users yet.</p>
{:else}
  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Email</th>
          <th scope="col">Updated</th>
          <th scope="col" class="actions-header">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each users as user (user.id)}
          <UserRow
            {user}
            onUpdate={(name, email) => onUpdate(user.id, name, email)}
            onDelete={() => onDelete(user.id)}
          />
        {/each}
      </tbody>
    </table>
  </div>
{/if}
