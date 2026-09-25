import { request } from './fetch-client';
import type { User } from './types';

export function getUsers(): Promise<User[]> {
  return request<User[]>('/users');
}

export function getUser(id: string): Promise<User> {
  return request<User>(`/users/${encodeURIComponent(id)}`);
}

export function createUser(name: string, email: string): Promise<User> {
  return request<User>('/users', {
    method: 'POST',
    body: JSON.stringify({ name, email }),
  });
}

export function updateUser(id: string, name: string, email: string): Promise<User> {
  return request<User>(`/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name, email }),
  });
}

export function deleteUser(id: string): Promise<void> {
  return request<void>(`/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
