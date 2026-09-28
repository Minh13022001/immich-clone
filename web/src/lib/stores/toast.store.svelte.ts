/**
 * Transient notifications (spec §8.6: the upload panel's outro summary).
 *
 * Deliberately tiny: a bounded list that dismisses itself after a moment, with
 * no queueing or grouping. Anything richer belongs to a real notification
 * system, which this clone does not have.
 */

export type ToastVariant = 'primary' | 'danger' | 'warning';

export interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
}

const LIFETIME_MS = 6000;
const MAX_VISIBLE = 4;

class ToastStore {
  toasts = $state<Toast[]>([]);

  #nextId = 1;
  #timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(variant: ToastVariant, message: string): number {
    const id = this.#nextId++;
    const kept = this.toasts.slice(-(MAX_VISIBLE - 1));

    this.toasts = [...kept, { id, variant, message }];
    this.#timers.set(
      id,
      setTimeout(() => this.dismiss(id), LIFETIME_MS),
    );

    return id;
  }

  dismiss(id: number): void {
    const timer = this.#timers.get(id);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.#timers.delete(id);
    }

    this.toasts = this.toasts.filter((toast) => toast.id !== id);
  }

  clear(): void {
    for (const timer of this.#timers.values()) {
      clearTimeout(timer);
    }

    this.#timers.clear();
    this.toasts = [];
  }
}

export const toastStore = new ToastStore();
