/**
 * Upload state machine + statistics (spec §8.4).
 *
 * The store owns the *what* (which items, in which state, at which progress)
 * and nothing else: transport lives in `upload-request.ts`, decisions live in
 * `file-uploader.ts` and the manager. Every field is `$state`, so the panel
 * re-renders as progress ticks.
 */

/** `PENDING → STARTED → {DONE | ERROR | DUPLICATED}`. */
export enum UploadState {
  PENDING = 'pending',
  STARTED = 'started',
  DONE = 'done',
  ERROR = 'error',
  DUPLICATED = 'duplicated',
}

export type UploadStat = 'success' | 'error' | 'duplicate';

export interface UploadItem {
  /** `web-<name>-<lastModified>`; also the de-duplication key. */
  id: string;
  file: File;
  albumId?: string;
  /** Id of the asset this upload produced (or matched, for a duplicate). */
  assetId?: string;
  /** Duplicates only: whether the existing asset already sits in the trash. */
  isTrashed?: boolean;
  /** 0–100. */
  progress?: number;
  state?: UploadState;
  /** Epoch millis at which the upload started, for speed/ETA maths. */
  startDate?: number;
  /** Seconds remaining, derived from the current speed. */
  eta?: number;
  /** Bytes per second. */
  speed?: number;
  error?: string;
  message?: string;
}

class UploadStore {
  items = $state<UploadItem[]>([]);
  total = $state(0);
  success = $state(0);
  errors = $state(0);
  duplicates = $state(0);
  /** Parallel uploads, surfaced by the panel's picker (1–50, default 2). */
  concurrency = $state(2);

  /** True while at least one item is in flight. */
  get isUploading(): boolean {
    return this.items.some(
      (item) => item.state === UploadState.PENDING || item.state === UploadState.STARTED,
    );
  }

  /** Items still queued or running. */
  get remainingUploads(): number {
    return this.items.filter(
      (item) => item.state === UploadState.PENDING || item.state === UploadState.STARTED,
    ).length;
  }

  /** True when there is something the user can clear from the panel. */
  get isDismissible(): boolean {
    return this.items.some(
      (item) => item.state === UploadState.ERROR || item.state === UploadState.DUPLICATED,
    );
  }

  /** Adds an item unless the same file was already queued. Returns success. */
  addItem(item: UploadItem): boolean {
    if (this.items.some((existing) => existing.id === item.id)) {
      return false;
    }

    this.items = [...this.items, { state: UploadState.PENDING, progress: 0, ...item }];
    this.total += 1;

    return true;
  }

  markStarted(id: string): void {
    this.updateItem(id, { state: UploadState.STARTED, startDate: Date.now() });
  }

  /**
   * Recomputes progress, speed and ETA from a raw byte count. Speed is total
   * bytes over elapsed wall-clock time, so it reflects real throughput rather
   * than an instantaneous sample that would jitter.
   */
  updateProgress(id: string, loaded: number, total: number): void {
    const item = this.#find(id);

    if (item === undefined || item.state === UploadState.DONE) {
      return;
    }

    const startDate = item.startDate ?? Date.now();
    const elapsedSeconds = (Date.now() - startDate) / 1000;
    const speed = elapsedSeconds > 0 ? loaded / elapsedSeconds : 0;

    item.startDate = startDate;
    item.speed = speed;

    if (total > 0) {
      item.progress = Math.floor((loaded / total) * 100);
      item.eta = speed > 0 ? (total - loaded) / speed : undefined;
    }
  }

  updateItem(id: string, patch: Partial<UploadItem>): void {
    const item = this.#find(id);

    if (item === undefined) {
      return;
    }

    Object.assign(item, patch);
  }

  /** Removes a finished item; in-flight items are refused (spec §8.4). */
  removeItem(id: string): boolean {
    const item = this.#find(id);

    if (
      item === undefined ||
      item.state === UploadState.PENDING ||
      item.state === UploadState.STARTED
    ) {
      return false;
    }

    this.items = this.items.filter((existing) => existing.id !== id);

    return true;
  }

  /** Clears everything the user can dismiss: failures and duplicates. */
  dismissErrors(): void {
    this.items = this.items.filter(
      (item) => item.state !== UploadState.ERROR && item.state !== UploadState.DUPLICATED,
    );
  }

  track(stat: UploadStat): void {
    switch (stat) {
      case 'success': {
        this.success += 1;
        break;
      }
      case 'error': {
        this.errors += 1;
        break;
      }
      case 'duplicate': {
        this.duplicates += 1;
        break;
      }
    }
  }

  /** Drops every item and counter; used on logout and after the summary. */
  reset(): void {
    this.items = [];
    this.total = 0;
    this.success = 0;
    this.errors = 0;
    this.duplicates = 0;
  }

  #find(id: string): UploadItem | undefined {
    return this.items.find((item) => item.id === id);
  }
}

export const uploadStore = new UploadStore();
