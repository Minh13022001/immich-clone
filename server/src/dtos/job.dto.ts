/**
 * Job vocabulary (spec §3.5, §7).
 *
 * The reference uses BullMQ; this clone keeps the same named jobs and typed
 * payloads but runs them through an in-process serial queue (`JobRepository`),
 * so the observable pipeline and event names are unchanged.
 */
export enum JobName {
  AssetExtractMetadata = 'AssetExtractMetadata',
  AssetGenerateThumbnails = 'AssetGenerateThumbnails',
  SmartSearch = 'SmartSearch',
  AssetDetectFaces = 'AssetDetectFaces',
  Ocr = 'Ocr',
  AssetEncodeVideo = 'AssetEncodeVideo',
  AssetDetectDuplicates = 'AssetDetectDuplicates',
  FileDelete = 'FileDelete',
}

/** Why a job was enqueued; drives whether the upload pipeline notifies clients. */
export enum JobSource {
  UPLOAD = 'upload',
  COPY = 'copy',
  MOVE = 'move',
  BACKGROUND = 'background',
}

/** Payload for every asset-scoped job. */
export interface AssetJobPayload {
  id: string;
  source: JobSource;
  notify?: boolean;
}

/** Payload for `FileDelete`; `undefined` entries are ignored. */
export interface FileDeleteJobPayload {
  files: (string | undefined)[];
}
