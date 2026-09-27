<script lang="ts">
  import type { User } from '@immich/sdk';

  import UserRow from './user-row.svelte';

  interface Props {
    users: User[];
    onUpdate: (id: string, name: string, email: string) => Promise<boolean>;
    onDelete: (id: string) => Promise<void>;
  }

  let { users, onUpdate, onDelete }: Props = $props();

  const HEAD_CELL =
    'border-b border-border px-2 py-2.5 text-left text-xs font-semibold tracking-wide text-muted uppercase';
</script>

{#if users.length === 0}
  <p class="text-muted">No users yet.</p>
{:else}
  <div class="overflow-x-auto">
    <table class="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th scope="col" class={HEAD_CELL}>Name</th>
          <th scope="col" class={HEAD_CELL}>Email</th>
          <th scope="col" class={HEAD_CELL}>Updated</th>
          <th scope="col" class={`${HEAD_CELL} text-right`}>Actions</th>
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
