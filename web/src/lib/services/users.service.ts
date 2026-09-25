import { createUser, deleteUser, getUsers, updateUser, type User } from '@immich/sdk';

/**
 * Thin, app-shaped wrappers around the SDK.
 *
 * They exist so managers never import the SDK directly: swapping the transport,
 * or pointing the web app at a different backend, happens in this folder alone.
 */
export function listUsers(): Promise<User[]> {
  return getUsers();
}

export function addUser(name: string, email: string): Promise<User> {
  return createUser(name, email);
}

export function saveUser(id: string, name: string, email: string): Promise<User> {
  return updateUser(id, name, email);
}

export function removeUser(id: string): Promise<void> {
  return deleteUser(id);
}
