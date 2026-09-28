/**
 * A bounded-concurrency FIFO queue (spec §8.5).
 *
 * Uploads are the most bandwidth-hungry thing the app does, so only a fixed
 * number run at once and the rest wait their turn. The queue knows nothing
 * about uploads — it just runs `() => Promise<T>` tasks — which keeps the
 * concurrency rule testable on its own.
 */
export class ExecutorQueue {
  #concurrency: number;
  #running = 0;
  #tasks: Array<() => Promise<void>> = [];

  constructor(concurrency = 2) {
    this.#concurrency = normaliseConcurrency(concurrency);
  }

  get concurrency(): number {
    return this.#concurrency;
  }

  /** Number of tasks waiting for a free slot. */
  get pending(): number {
    return this.#tasks.length;
  }

  /** Number of tasks currently running. */
  get active(): number {
    return this.#running;
  }

  setConcurrency(value: number): void {
    this.#concurrency = normaliseConcurrency(value);
    this.#drain();
  }

  /**
   * Queues `task` and resolves with its result once a slot frees up. The
   * returned promise settles with the task, so callers never see the queue.
   */
  push<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#tasks.push(() => task().then(resolve, reject));
      this.#drain();
    });
  }

  #drain(): void {
    while (this.#running < this.#concurrency && this.#tasks.length > 0) {
      const task = this.#tasks.shift();

      if (!task) {
        return;
      }

      this.#running += 1;

      const release = () => {
        this.#running -= 1;
        this.#drain();
      };

      // `push` already routed the task's rejection to its own promise, so the
      // queue never sees an unhandled rejection.
      void task().then(release, release);
    }
  }
}

function normaliseConcurrency(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
