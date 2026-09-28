import { describe, expect, it } from 'vitest';

import { ExecutorQueue } from './executor-queue';

/** Lets the tasks that were released by a resolution actually run. */
const settle = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A task that stays running until the test releases it. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe('ExecutorQueue', () => {
  it('runs at most `concurrency` tasks at once, in FIFO order', async () => {
    const queue = new ExecutorQueue(2);
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred>>();

    for (const name of ['a', 'b', 'c']) {
      const gate = deferred();
      gates.set(name, gate);

      void queue.push(async () => {
        started.push(name);
        await gate.promise;
      });
    }

    expect(started).toEqual(['a', 'b']);
    expect(queue.active).toBe(2);
    expect(queue.pending).toBe(1);

    gates.get('a')?.resolve();
    await settle();

    expect(started).toEqual(['a', 'b', 'c']);
    expect(queue.active).toBe(2);
    expect(queue.pending).toBe(0);

    gates.get('b')?.resolve();
    gates.get('c')?.resolve();
    await settle();

    expect(queue.active).toBe(0);
  });

  it('resolves each pushed task with its own value', async () => {
    const queue = new ExecutorQueue(2);

    const results = await Promise.all([
      queue.push(async () => 'a'),
      queue.push(async () => 'b'),
      queue.push(async () => 'c'),
    ]);

    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('propagates a rejection and still runs the task behind it', async () => {
    const queue = new ExecutorQueue(1);
    const boom = new Error('boom');
    const order: string[] = [];

    const failing = queue.push(async () => {
      throw boom;
    });
    const following = queue.push(async () => {
      order.push('second');

      return 'done';
    });

    await expect(failing).rejects.toBe(boom);
    await expect(following).resolves.toBe('done');

    expect(order).toEqual(['second']);
    expect(queue.active).toBe(0);
  });

  it('starts queued tasks when the concurrency is raised', async () => {
    const queue = new ExecutorQueue(1);
    const started: number[] = [];
    const gate = deferred();

    void queue.push(async () => {
      started.push(1);
      await gate.promise;
    });
    void queue.push(async () => {
      started.push(2);
    });
    void queue.push(async () => {
      started.push(3);
    });

    expect(started).toEqual([1]);
    expect(queue.pending).toBe(2);

    queue.setConcurrency(3);

    expect(started).toEqual([1, 2, 3]);
    expect(queue.pending).toBe(0);

    gate.resolve();
    await settle();
  });

  it('never drops below one runner', () => {
    expect(new ExecutorQueue(0).concurrency).toBe(1);
    expect(new ExecutorQueue(-5).concurrency).toBe(1);
    expect(new ExecutorQueue(Number.NaN).concurrency).toBe(1);
    expect(new ExecutorQueue(3.7).concurrency).toBe(3);

    const queue = new ExecutorQueue(2);
    queue.setConcurrency(0);

    expect(queue.concurrency).toBe(1);
  });
});
