import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import type { AuthContext } from '../authentication/context';
import { AssetMediaStatus, AssetVisibility, type CreateAssetDto } from '../dtos/asset-media.dto';
import type {
  AssetUploadCompleteResponseDto,
  AssetUploadInitiateResponseDto,
  AssetUploadPartsResponseDto,
  AssetUploadPresignedPartDto,
  CompleteAssetUploadDto,
  CompleteAssetUploadPartDto,
  InitiateAssetUploadDto,
  RequestAssetUploadPartsDto,
} from '../dtos/asset-upload.dto';
import { AssetRepository } from '../repositories/asset.repository';
import {
  ACTIVE_UPLOAD_STATUSES,
  AssetUploadRepository,
  isActiveUploadConstraint,
} from '../repositories/asset-upload.repository';
import { ObjectStorageRepository } from '../repositories/object-storage.repository';
import { UserRepository } from '../repositories/user.repository';
import type { AssetUploadRow } from '../schema';
import type { AssetUploadSnapshot, StoredUploadPart } from '../schema/tables/asset-upload.table';
import { decodeChecksum, fromChecksum, isAssetChecksumConstraint } from '../utils/checksum';
import { getMimeType, isAssetFile } from '../utils/mime-types';
import { buildObjectKey } from '../utils/storage-keys';
import { AssetFinalizerService } from './asset-finalizer.service';
import { BaseService } from './base.service';

/**
 * Presigned direct uploads (initiate → PUT → complete).
 *
 * The API authorises an exact object (key, size, content type, digest), then
 * gets out of the way. It never trusts the client's word that the bytes arrived:
 * `/complete` re-derives size and digest from storage before any asset row is
 * created, and the duplicate check runs *after* that verification so a forged
 * checksum cannot be used to claim somebody else's bytes.
 *
 * Every step is idempotent:
 * - initiate reuses an active session for the same digest;
 * - complete is a no-op that replays the outcome once the session is finished;
 * - abort is a no-op on an already-terminal session.
 */
@Injectable()
export class AssetUploadService extends BaseService {
  private readonly logger = new Logger(AssetUploadService.name);

  constructor(
    private readonly assetRepository: AssetRepository,
    private readonly uploadRepository: AssetUploadRepository,
    private readonly userRepository: UserRepository,
    private readonly storage: ObjectStorageRepository,
    private readonly finalizer: AssetFinalizerService,
  ) {
    super();
  }

  /** `POST /assets/uploads` — validate the declaration, reserve quota, presign. */
  async initiate(
    auth: AuthContext,
    dto: InitiateAssetUploadDto,
  ): Promise<AssetUploadInitiateResponseDto> {
    this.requireUploadAccess(auth);

    if (!isAssetFile(dto.filename)) {
      throw new BadRequestException(`Unsupported file type ${dto.filename}`);
    }

    const maxUploadSize = this.storage.getMaxUploadSize();
    if (dto.fileSize > maxUploadSize) {
      throw new BadRequestException(`Upload exceeds the maximum size of ${maxUploadSize} bytes`);
    }

    const checksum = decodeChecksum(dto.checksum);
    if (checksum.length !== 20) {
      throw new BadRequestException('Invalid checksum');
    }

    const checksumSha1Hex = fromChecksum(checksum);

    // The bytes are already on the server: nothing to upload, nothing to bill.
    const existing = await this.assetRepository.getByChecksum(auth.user.id, checksum);
    if (existing) {
      return this.duplicateResponse(existing.id);
    }

    // A retry or a second tab for the same bytes joins the session in flight
    // instead of allocating a second object key and a second reservation.
    const active = await this.uploadRepository.getActiveByChecksum(auth.user.id, checksum);
    if (active) {
      if (active.expiresAt.getTime() > Date.now()) {
        return this.describeSession(active, checksumSha1Hex);
      }

      // The sweeper has not reached this one yet; reclaim it first.
      await this.settleExpired(active);
    }

    const uploadId = randomUUID();
    const storageKey = buildObjectKey('original', auth.user.id, uploadId, extname(dto.filename));
    const contentType = dto.contentType || getMimeType(dto.filename);
    const multipart =
      this.storage.supportsMultipart() && dto.fileSize > this.storage.getMultipartThreshold();

    // Reserve before creating anything: no object and no session row exist for
    // an upload the account cannot pay for.
    const reserved = await this.userRepository.reserveQuota(auth.user.id, dto.fileSize);
    if (!reserved) {
      throw new BadRequestException('Quota has been exceeded!');
    }

    let multipartUploadId: string | null = null;
    let row: AssetUploadRow | undefined;

    try {
      if (multipart) {
        multipartUploadId = await this.storage.createMultipartUpload(storageKey, contentType);
      }

      row = await this.uploadRepository.create({
        id: uploadId,
        ownerId: auth.user.id,
        status: 'pending',
        checksum,
        checksumAlgorithm: 'sha1File',
        declaredSize: dto.fileSize,
        declaredContentType: contentType,
        assetId: null,
        bucket: this.storage.getBucket(),
        storageKey,
        multipartUploadId,
        partSize: multipart ? this.storage.getPartSize() : null,
        parts: [],
        dto: this.toSnapshot(dto),
        reservedBytes: dto.fileSize,
        attempts: 0,
        error: null,
        expiresAt: new Date(Date.now() + this.storage.getSessionTtlSeconds() * 1000),
      });
    } catch (error) {
      await this.userRepository.releaseQuota(auth.user.id, dto.fileSize);
      if (multipartUploadId) {
        await this.storage.abortMultipartUpload(storageKey, multipartUploadId);
      }

      // Lost the race against another initiate for the same digest: answer with
      // the winner's session rather than a 500.
      if (isActiveUploadConstraint(error)) {
        const winner = await this.uploadRepository.getActiveByChecksum(auth.user.id, checksum);
        if (winner) {
          return this.describeSession(winner, checksumSha1Hex);
        }
      }

      throw error;
    }

    if (!row) {
      throw new InternalServerErrorException('Upload session was not created');
    }

    try {
      return await this.describeSession(row, checksumSha1Hex);
    } catch (error) {
      // Presigning failed, so the client can never upload: undo the session
      // instead of leaving it to the sweeper.
      await this.uploadRepository.remove(row.id);
      await this.userRepository.releaseQuota(auth.user.id, dto.fileSize);
      if (multipartUploadId) {
        await this.storage.abortMultipartUpload(storageKey, multipartUploadId);
      }
      throw error;
    }
  }

  /** `POST /assets/uploads/:id/parts` — presign a bounded batch of part URLs. */
  async requestParts(
    auth: AuthContext,
    uploadId: string,
    dto: RequestAssetUploadPartsDto,
  ): Promise<AssetUploadPartsResponseDto> {
    const row = await this.requireSession(auth, uploadId);

    if (!row.multipartUploadId) {
      throw new BadRequestException('Upload session is not multipart');
    }

    if (!ACTIVE_UPLOAD_STATUSES.includes(row.status)) {
      throw new ConflictException('Upload session is no longer active');
    }

    const partSize = row.partSize ?? this.storage.getPartSize();
    const partCount = Math.max(1, Math.ceil(row.declaredSize / partSize));
    const parts: AssetUploadPresignedPartDto[] = [];
    const seen = new Set<number>();
    let expiresAt = new Date(Date.now() + this.storage.getPresignTtlSeconds() * 1000).toISOString();

    for (const requested of dto.parts) {
      if (seen.has(requested.partNumber)) {
        continue;
      }
      seen.add(requested.partNumber);

      if (requested.partNumber > partCount) {
        throw new BadRequestException(`Part ${requested.partNumber} is out of range`);
      }

      let checksumSha1Hex: string | undefined;
      if (requested.checksum) {
        const partChecksum = decodeChecksum(requested.checksum);
        if (partChecksum.length !== 20) {
          throw new BadRequestException(`Invalid checksum for part ${requested.partNumber}`);
        }
        checksumSha1Hex = fromChecksum(partChecksum);
      }

      const presigned = await this.storage.presignPart({
        key: row.storageKey,
        uploadId: row.multipartUploadId,
        partNumber: requested.partNumber,
        checksumSha1Hex,
      });

      parts.push({
        partNumber: requested.partNumber,
        url: presigned.url,
        method: presigned.method,
        headers: presigned.headers,
      });
      expiresAt = presigned.expiresAt;
    }

    return { parts, expiresAt };
  }

  /** `POST /assets/uploads/:id/complete` — verify the bytes, then finalize. */
  async complete(
    auth: AuthContext,
    uploadId: string,
    dto: CompleteAssetUploadDto,
  ): Promise<AssetUploadCompleteResponseDto> {
    const row = await this.requireSession(auth, uploadId);

    if (row.status === 'completed' || row.status === 'duplicate') {
      return this.terminalResult(row);
    }

    if (!ACTIVE_UPLOAD_STATUSES.includes(row.status)) {
      throw new ConflictException('Upload session is no longer active');
    }

    // Single atomic transition: two concurrent completes cannot both create an
    // asset, and the loser replays the winner's outcome.
    const claimed = await this.uploadRepository.claimForVerification(uploadId, auth.user.id);
    if (!claimed) {
      const current = await this.uploadRepository.getById(uploadId);
      if (current && (current.status === 'completed' || current.status === 'duplicate')) {
        return this.terminalResult(current);
      }
      throw new ConflictException('Upload session is no longer active');
    }

    try {
      if (claimed.multipartUploadId) {
        const stored = await this.storage.listParts(claimed.storageKey, claimed.multipartUploadId);
        const partSize = claimed.partSize ?? this.storage.getPartSize();
        const expected = Math.max(1, Math.ceil(claimed.declaredSize / partSize));

        if (stored.length === 0) {
          throw new BadRequestException('No parts were uploaded');
        }

        if (stored.length !== expected) {
          throw new BadRequestException(
            `Expected ${expected} uploaded parts but storage reported ${stored.length}`,
          );
        }

        // `ListParts` is authoritative; the client's list only has to agree with
        // it, so inventing a part can never advance the upload.
        this.assertClientPartsMatch(dto.parts, stored);

        await this.storage.completeMultipartUpload(
          claimed.storageKey,
          claimed.multipartUploadId,
          stored,
        );
      }

      const head = await this.storage.head(claimed.storageKey);
      if (!head) {
        throw new BadRequestException('The uploaded object was not found');
      }

      if (head.size !== claimed.declaredSize) {
        throw new BadRequestException(
          `Uploaded size ${head.size} does not match the declared size ${claimed.declaredSize}`,
        );
      }

      // S3 can prove a single-part digest itself. Multipart (composite digest)
      // and the local backend cannot, so those bytes are re-read and hashed here.
      const digest = head.checksumSha1Hex ?? (await this.storage.hashObject(claimed.storageKey));

      if (digest !== fromChecksum(claimed.checksum)) {
        throw new BadRequestException('Uploaded file does not match the declared checksum');
      }

      const duplicate = await this.assetRepository.getByChecksum(auth.user.id, claimed.checksum);
      if (duplicate) {
        return await this.settleDuplicate(claimed, duplicate.id);
      }

      const asset = await this.finalizer.finalizeAsset({
        auth,
        dto: this.toCreateAssetDto(claimed.dto),
        checksum: claimed.checksum,
        size: claimed.declaredSize,
        originalFileName: claimed.dto.originalFileName,
        storageBackend: this.storage.getBackend(),
        storageKey: claimed.storageKey,
      });

      await this.userRepository.commitQuota(auth.user.id, claimed.reservedBytes);
      await this.uploadRepository.markCompleted(claimed.id, asset.id);

      return { id: asset.id, status: AssetMediaStatus.CREATED };
    } catch (error) {
      // A concurrent insert of the same digest means the bytes are a duplicate
      // after all — the unique index, not the earlier lookup, is the authority.
      if (isAssetChecksumConstraint(error)) {
        const duplicate = await this.assetRepository.getByChecksum(auth.user.id, claimed.checksum);
        if (duplicate) {
          return await this.settleDuplicate(claimed, duplicate.id);
        }
      }

      await this.failSession(claimed, error);
      throw error;
    }
  }

  /** `POST /assets/uploads/:id/abort` — idempotent teardown. */
  async abort(auth: AuthContext, uploadId: string): Promise<void> {
    const row = await this.requireSession(auth, uploadId);

    if (row.status === 'completed') {
      throw new ConflictException('A completed upload cannot be aborted');
    }

    if (
      row.status === 'duplicate' ||
      row.status === 'aborted' ||
      row.status === 'expired' ||
      row.status === 'failed'
    ) {
      return;
    }

    if (row.multipartUploadId) {
      await this.storage.abortMultipartUpload(row.storageKey, row.multipartUploadId);
    }

    await this.storage.deleteObjects([row.storageKey]);
    await this.userRepository.releaseQuota(row.ownerId, row.reservedBytes);
    await this.uploadRepository.markTerminal(row.id, 'aborted');
  }

  // --- internals ----------------------------------------------------------

  private toSnapshot(dto: InitiateAssetUploadDto): AssetUploadSnapshot {
    return {
      filename: dto.filename,
      originalFileName: dto.filename,
      fileCreatedAt: dto.fileCreatedAt,
      fileModifiedAt: dto.fileModifiedAt,
      isFavorite: dto.isFavorite,
      visibility: dto.visibility,
      livePhotoVideoId: dto.livePhotoVideoId ?? null,
      duration: dto.duration ?? null,
      metadata: dto.metadata?.map((item) => ({ key: item.key, value: item.value })),
    };
  }

  /** Rebuilds the legacy DTO shape so both paths share one finalizer. */
  private toCreateAssetDto(snapshot: AssetUploadSnapshot): CreateAssetDto {
    return {
      fileCreatedAt: snapshot.fileCreatedAt,
      fileModifiedAt: snapshot.fileModifiedAt,
      filename: snapshot.filename,
      isFavorite: snapshot.isFavorite,
      visibility: snapshot.visibility as AssetVisibility | undefined,
      livePhotoVideoId: snapshot.livePhotoVideoId ?? undefined,
      duration: snapshot.duration ?? undefined,
      metadata: snapshot.metadata,
    };
  }

  private async describeSession(
    row: AssetUploadRow,
    checksumSha1Hex: string,
  ): Promise<AssetUploadInitiateResponseDto> {
    const partSize = row.partSize ?? this.storage.getPartSize();
    const expiresAt = new Date(
      Date.now() + this.storage.getPresignTtlSeconds() * 1000,
    ).toISOString();

    if (row.multipartUploadId) {
      return {
        uploadId: row.id,
        key: row.storageKey,
        status: 'upload',
        multipart: true,
        partSize,
        partCount: Math.max(1, Math.ceil(row.declaredSize / partSize)),
        // Part URLs are minted on demand by `/parts`, so a 20 GB upload does not
        // return thousands of URLs in one response.
        expiresAt,
      };
    }

    const presigned = await this.storage.presignPut({
      key: row.storageKey,
      size: row.declaredSize,
      contentType: row.declaredContentType ?? getMimeType(row.dto.originalFileName),
      checksumSha1Hex,
    });

    return {
      uploadId: row.id,
      key: row.storageKey,
      status: 'upload',
      multipart: false,
      partSize: row.declaredSize,
      partCount: 1,
      url: presigned.url,
      method: presigned.method,
      headers: presigned.headers,
      expiresAt: presigned.expiresAt,
    };
  }

  private duplicateResponse(assetId: string): AssetUploadInitiateResponseDto {
    return {
      uploadId: '',
      key: '',
      status: 'duplicate',
      assetId,
      multipart: false,
      partSize: 0,
      partCount: 0,
    };
  }

  /** Replays a finished session so a retried `/complete` is harmless. */
  private terminalResult(row: AssetUploadRow): AssetUploadCompleteResponseDto {
    if (!row.assetId) {
      throw new ConflictException('Upload session has no asset');
    }

    return {
      id: row.assetId,
      status: row.status === 'duplicate' ? AssetMediaStatus.DUPLICATE : AssetMediaStatus.CREATED,
    };
  }

  /** A duplicate never becomes an asset: drop the bytes and refund the reservation. */
  private async settleDuplicate(
    row: AssetUploadRow,
    assetId: string,
  ): Promise<AssetUploadCompleteResponseDto> {
    await this.storage.deleteObjects([row.storageKey]);
    await this.userRepository.releaseQuota(row.ownerId, row.reservedBytes);
    await this.uploadRepository.markTerminal(row.id, 'duplicate', { assetId });

    return { id: assetId, status: AssetMediaStatus.DUPLICATE };
  }

  /** Verification failure: no bytes, no reservation, no open session. */
  private async failSession(row: AssetUploadRow, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Upload ${row.id} failed verification: ${message}`);

    try {
      if (row.multipartUploadId) {
        await this.storage.abortMultipartUpload(row.storageKey, row.multipartUploadId);
      }
      await this.storage.deleteObjects([row.storageKey]);
    } finally {
      await this.userRepository.releaseQuota(row.ownerId, row.reservedBytes);
      await this.uploadRepository.markTerminal(row.id, 'failed', { error: message });
    }
  }

  /** Reclaims a session whose deadline passed before the sweeper ran. */
  private async settleExpired(row: AssetUploadRow): Promise<void> {
    if (row.multipartUploadId) {
      await this.storage.abortMultipartUpload(row.storageKey, row.multipartUploadId);
    }
    await this.storage.deleteObjects([row.storageKey]);
    await this.userRepository.releaseQuota(row.ownerId, row.reservedBytes);
    await this.uploadRepository.markTerminal(row.id, 'expired');
  }

  private assertClientPartsMatch(
    clientParts: CompleteAssetUploadPartDto[] | undefined,
    stored: StoredUploadPart[],
  ): void {
    if (!clientParts?.length) {
      return;
    }

    const clientNumbers = [...new Set(clientParts.map((part) => part.partNumber))].sort(
      (a, b) => a - b,
    );
    const storedNumbers = stored.map((part) => part.partNumber);
    const matches =
      clientNumbers.length === storedNumbers.length &&
      clientNumbers.every((partNumber, index) => partNumber === storedNumbers[index]);

    if (!matches) {
      throw new BadRequestException('Completed part list does not match the uploaded parts');
    }
  }

  private async requireSession(auth: AuthContext, uploadId: string): Promise<AssetUploadRow> {
    this.requireUploadAccess(auth);

    const row = await this.uploadRepository.getById(uploadId);

    // A foreign session answers 404, exactly like a foreign asset.
    if (!row || row.ownerId !== auth.user.id) {
      throw new NotFoundException(`Upload ${uploadId} was not found`);
    }

    return row;
  }

  /** Every resolved identity may upload (D2). */
  private requireUploadAccess(auth: AuthContext): void {
    if (!auth?.user) {
      throw new BadRequestException('Authentication required');
    }
  }
}
