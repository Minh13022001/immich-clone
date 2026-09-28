import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadState, uploadStore, type UploadItem } from './upload.store.svelte';

/**
 * The state machine in §8.4, asserted directly: every transition, the progress
 * maths behind speed/ETA, and the removal rules the panel depends on.
 */

const START = new Date('2026-01-01T00:00:00.000Z');

function makeFile(name: string, lastModified = 1_700_000_000_000): File {
  return new File(['bytes'], name, { lastModified });
}

/** The store is indexed by position; this fails loudly if the item is missing. */
function itemAt(index = 0): UploadItem {
  const item = uploadStore.items[index];

  if (item === undefined) {
    throw new Error(`No upload item at index ${index}`);
  }

  return item;
}

describe('UploadStore', () => {
  beforeEach(() => {
    uploadStore.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    uploadStore.reset();
  });

  it('adds an item as PENDING at 0% and counts it', () => {
    const added = uploadStore.addItem({ id: 'a', file: makeFile('a.jpg') });

    expect(added).toBe(true);
    expect(uploadStore.total).toBe(1);
    expect(uploadStore.items).toHaveLength(1);
    expect(uploadStore.items[0]).toMatchObject({
      id: 'a',
      state: UploadState.PENDING,
      progress: 0,
    });
  });

  it('refuses a second item with the same id and leaves the counters alone', () => {
    uploadStore.addItem({ id: 'a', file: makeFile('a.jpg') });

    expect(uploadStore.addItem({ id: 'a', file: makeFile('a.jpg') })).toBe(false);
    expect(uploadStore.total).toBe(1);
    expect(uploadStore.items).toHaveLength(1);
  });

  it('moves an item PENDING → STARTED → DONE and tracks what is still running', () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);

    uploadStore.addItem({ id: 'a', file: makeFile('a.jpg') });
    expect(uploadStore.isUploading).toBe(true);
    expect(uploadStore.remainingUploads).toBe(1);

    uploadStore.markStarted('a');
    expect(uploadStore.items[0]).toMatchObject({
      state: UploadState.STARTED,
      startDate: START.getTime(),
    });

    uploadStore.updateItem('a', { state: UploadState.DONE, progress: 100 });

    expect(itemAt().state).toBe(UploadState.DONE);
    expect(uploadStore.isUploading).toBe(false);
    expect(uploadStore.remainingUploads).toBe(0);
  });

  it('derives progress, speed and ETA from the bytes sent so far', () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);

    uploadStore.addItem({ id: 'a', file: makeFile('a.jpg') });
    uploadStore.markStarted('a');

    vi.advanceTimersByTime(1000);
    uploadStore.updateProgress('a', 500, 1000);

    expect(uploadStore.items[0]).toMatchObject({ progress: 50, speed: 500, eta: 1 });
  });

  it('leaves the percentage alone when the total size is unknown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);

    uploadStore.addItem({ id: 'a', file: makeFile('a.jpg') });
    uploadStore.markStarted('a');

    vi.advanceTimersByTime(1000);
    uploadStore.updateProgress('a', 10, 0);

    expect(uploadStore.items[0]).toMatchObject({ progress: 0, speed: 10 });
    // With no total there is nothing to count down to, so no ETA is stored.
    expect(itemAt().eta).toBeUndefined();
  });

  it('ignores progress for finished or unknown items', () => {
    uploadStore.addItem({ id: 'a', file: makeFile('a.jpg') });
    uploadStore.updateItem('a', { state: UploadState.DONE, progress: 100 });

    uploadStore.updateProgress('a', 10, 100);
    expect(itemAt().progress).toBe(100);

    expect(() => uploadStore.updateProgress('missing', 1, 2)).not.toThrow();
    expect(() => uploadStore.updateItem('missing', { progress: 5 })).not.toThrow();
  });

  it('refuses to remove an in-flight item but removes a finished one', () => {
    uploadStore.addItem({ id: 'a', file: makeFile('a.jpg') });

    expect(uploadStore.removeItem('a')).toBe(false);
    expect(uploadStore.removeItem('ghost')).toBe(false);

    uploadStore.markStarted('a');
    expect(uploadStore.removeItem('a')).toBe(false);

    uploadStore.updateItem('a', { state: UploadState.ERROR });
    expect(uploadStore.removeItem('a')).toBe(true);
    expect(uploadStore.items).toHaveLength(0);
  });

  it('dismisses failures and duplicates but keeps successes', () => {
    uploadStore.addItem({ id: 'ok', file: makeFile('ok.jpg') });
    uploadStore.addItem({ id: 'bad', file: makeFile('bad.jpg') });
    uploadStore.addItem({ id: 'dupe', file: makeFile('dupe.jpg') });

    uploadStore.updateItem('ok', { state: UploadState.DONE });
    uploadStore.updateItem('bad', { state: UploadState.ERROR });
    uploadStore.updateItem('dupe', { state: UploadState.DUPLICATED });

    expect(uploadStore.isDismissible).toBe(true);

    uploadStore.dismissErrors();

    expect(uploadStore.items.map((item) => item.id)).toEqual(['ok']);
    expect(uploadStore.isDismissible).toBe(false);
  });

  it('counts each outcome and clears everything on reset', () => {
    uploadStore.track('success');
    uploadStore.track('error');
    uploadStore.track('duplicate');

    expect([uploadStore.success, uploadStore.errors, uploadStore.duplicates]).toEqual([1, 1, 1]);

    uploadStore.addItem({ id: 'a', file: makeFile('a.jpg') });
    uploadStore.reset();

    expect(uploadStore.items).toEqual([]);
    expect([
      uploadStore.total,
      uploadStore.success,
      uploadStore.errors,
      uploadStore.duplicates,
    ]).toEqual([0, 0, 0, 0]);
  });
});
