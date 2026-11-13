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
  push<T>(task: () => Promise<T>): Promise<T> { //push doesn't just store the job — it also presses "start" if there's room. 
    return new Promise<T>((resolve, reject) => {
      console.log(2222222222222, resolve, reject, this.#tasks);
      this.#tasks.push(() => task().then(resolve, reject));  //"When this Promise finishes, immediately call resolve or reject , this is just a abbreviation"
      console.log(this.#tasks, 'add task', 3333333333333);
      this.#drain();
    });
  }

  #drain(): void {
    while (this.#running < this.#concurrency && this.#tasks.length > 0) {
      const task = this.#tasks.shift();
      console.log(task, 'the task to execute', 444444444444444); // () => task().then(resolve, reject) 'the task to execute' 444444444444444

      if (!task) {
        return;
      }

      this.#running += 1;
      console.log(this.#running, 'running task', 5555555555555555);

      const release = () => {
        console.log(this.#running, 'release task', 6666666666666);
        this.#running -= 1;
        this.#drain();
      };

      // `push` already routed the task's rejection to its own promise, so the
      // queue never sees an unhandled rejection.
      console.log('task', task, 7777777777777777777777777);
      void task().then(release, release); // this would become task().then(resolve, reject).then(release, release); , and this line will pending until it meeet the first await.
      console.log(this.#tasks, "remove task", 88888888888888888888);
    }
  }
}

function normaliseConcurrency(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
