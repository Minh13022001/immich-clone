import { addUser, listUsers, removeUser, saveUser } from '$lib/services/users.service';
import { usersStore } from '$lib/stores/users.store.svelte';
import { describeError } from '$lib/utils';

/**
 * The only place that mutates the user store.
 *
 * Components read `userManager.users` and call the verbs below; the manager
 * decides what happens on success or failure. Errors become a message on the
 * store instead of exceptions, so no component needs a try/catch.
 */
class UserManager {
  readonly #store = usersStore;

  get users() {
    return this.#store.users;
  }

  get loading() {
    return this.#store.loading;
  }

  get error() {
    return this.#store.error;
  }

  async load(): Promise<void> {
    this.#store.loading = true;
    this.#store.error = null;

    try {
      this.#store.set(await listUsers());
    } catch (error) {
      this.#store.error = describeError(error);
    } finally {
      this.#store.loading = false;
    }
  }

  /** Returns `true` when the user was created, so forms can clear themselves. */
  async create(name: string, email: string): Promise<boolean> {
    this.#store.error = null;

    try {
      this.#store.prepend(await addUser(name, email));

      return true;
    } catch (error) {
      this.#store.error = describeError(error);

      return false;
    }
  }

  /** Returns `true` when the user was saved, so rows can leave edit mode. */
  async update(id: string, name: string, email: string): Promise<boolean> {
    this.#store.error = null;

    try {
      this.#store.replace(await saveUser(id, name, email));

      return true;
    } catch (error) {
      this.#store.error = describeError(error);

      return false;
    }
  }

  async remove(id: string): Promise<void> {
    this.#store.error = null;

    try {
      await removeUser(id);
      this.#store.remove(id);
    } catch (error) {
      this.#store.error = describeError(error);
    }
  }
}

export const userManager = new UserManager();
