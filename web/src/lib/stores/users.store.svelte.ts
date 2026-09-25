import type { User } from '@immich/sdk';

/**
 * A rune-backed store: the fields are `$state`, so any component that reads
 * them re-renders when they change.
 *
 * The store owns no logic beyond holding and editing the collection — network
 * calls live in services, decisions live in managers.
 */
class UsersStore {
  users = $state<User[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  set(users: User[]): void {
    this.users = users;
  }

  prepend(user: User): void {
    this.users = [user, ...this.users];
  }

  replace(user: User): void {
    this.users = this.users.map((existing) => (existing.id === user.id ? user : existing));
  }

  remove(id: string): void {
    this.users = this.users.filter((user) => user.id !== id);
  }
}

export const usersStore = new UsersStore();
