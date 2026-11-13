import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Observable } from 'rxjs';

import { asUploadRequest, type MulterFile } from '../authentication/upload-request';
import { UploadFieldName } from '../dtos/asset-media.dto';
import { AssetMediaService } from '../services/asset-media.service';

/**
 * Which multer handler a route needs. The reference maps a controller to a
 * handler by name; we carry the same idea as handler metadata so a single
 * interceptor instance can serve every upload route.
 */
export enum RouteKey {
  Asset = 'Asset',
  User = 'User',
}

export const ROUTE_KEY_METADATA = 'upload:route-key';

export const UploadRoute = (key: RouteKey) => SetMetadata(ROUTE_KEY_METADATA, key);

type MulterHandler = (
  request: Request,
  response: Response,
  callback: (error: unknown) => void,
) => void;

/** What `_handleFile` reports back; `checksum` only exists for `assetData`. */
interface UploadFileInfo extends Partial<Express.Multer.File> {
  checksum?: Buffer;
}

type HandleFileCallback = (error: Error | null, info?: UploadFileInfo) => void;

interface UploadStorageEngine {
  _handleFile(request: Request, file: Express.Multer.File, callback: HandleFileCallback): void;
  _removeFile(
    request: Request,
    file: Express.Multer.File,
    callback: (error: Error | null) => void,
  ): void;
}

/**
 * Streaming multer storage (spec §5.3).
 *
 * Nothing is ever buffered: bytes flow from the request straight into a write
 * stream while a SHA-1 digest is computed incrementally for `assetData`. The
 * digest is what the service persists and what the `(ownerId, checksum)` unique
 * index defends, so hashing has to happen on the way through rather than by
 * re-reading the finished file.
 */
@Injectable()
export class FileUploadInterceptor implements NestInterceptor {
  private readonly logger = new Logger(FileUploadInterceptor.name);
  private readonly upload: multer.Multer;   // This declares the property and its type. It doesn't assign a value.

  constructor( // run on register
    private readonly reflector: Reflector,
    private readonly assetService: AssetMediaService,
  ) {
    const storage = this.createStorage();
    const fileFilter: multer.Options['fileFilter'] = (request, file, callback) => {
      try {
        this.assetService.canUploadFile(asUploadRequest(request, file as MulterFile));
        callback(null, true);
      } catch (error) {
        callback(error as Error);
      }
    };

    this.upload = multer({ storage: storage as multer.StorageEngine, fileFilter });
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    // the only method auto run for this class
    const key = this.reflector.get(ROUTE_KEY_METADATA, context.getHandler());

    console.log(key, 77);
    const route = Reflect.getMetadata(ROUTE_KEY_METADATA, context.getHandler()) as
      RouteKey | undefined;

    if (!route) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    await this.run(this.handlerFor(route), request, response);
    console.log('wrong turn');
    return next.handle();          // continue
  }

  private handlerFor(route: RouteKey): MulterHandler {
    switch (route) {
      case RouteKey.Asset:
        return this.upload.fields([
          { name: UploadFieldName.ASSET_DATA, maxCount: 1 },
          { name: UploadFieldName.SIDECAR_DATA, maxCount: 1 },
        ]);
      case RouteKey.User:
        return this.upload.single(UploadFieldName.PROFILE_DATA);
      default:
        return (_request, _response, callback) => callback(null);
    }
  }

  /** Bridges multer's callback API into the promise `intercept` awaits. */
  private run(handler: MulterHandler, request: Request, response: Response): Promise<void> {
    return new Promise((resolve, reject) => {
      handler(request, response, (error) => {
        if (error) {
          reject(this.translateError(error));
          return;
        }

        resolve();
      });
    });
  }

  /** Multer's own errors are opaque; surface them as 400s like the reference. */
  private translateError(error: unknown): Error {
    if (error instanceof BadRequestException) {
      return error;
    }

    if (error instanceof multer.MulterError) {
      return new BadRequestException(error.message);
    }

    return error instanceof Error ? error : new Error(String(error));
  }

  private createStorage(): UploadStorageEngine {
    return {                                          // this object later passed to multer
      _handleFile: (request, file, callback) => {     // for saving uploaded file to disk
  
        
        request.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'ECONNRESET') {
            this.logger.warn(`Upload cancelled: ${file.originalname}`);
          } else {
            this.logger.error(`Upload stream failed: ${error.message}`);
          }

          this.assetService.onUploadError(
            asUploadRequest(request, file as MulterFile),
            file as MulterFile,
          );
        });

        const uploadFile = file as MulterFile;
        uploadFile.uuid = randomUUID();

        const uploadRequest = asUploadRequest(request, uploadFile);
        const folder = this.assetService.getUploadFolder(uploadRequest);
        const path = join(folder, this.assetService.getUploadFilename(uploadRequest));

        const hash = file.fieldname === UploadFieldName.ASSET_DATA ? createHash('sha1') : undefined;
        const writeStream = createWriteStream(path, { flags: 'w', flush: true });
        let size = 0;

        file.stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          hash?.update(chunk);
        });

        file.stream.on('error', (error: Error) => callback(error));
        writeStream.on('error', (error) => callback(error));
        writeStream.on('finish', () => {
          if (size === 0) {
            // The write stream already created the file; remove it before the
            // 400 so an empty part leaves no trace.
            void unlink(path).catch(() => undefined);
            callback(new BadRequestException('File is empty'));
            return;
          }

          callback(null, { path, size, checksum: hash?.digest() });
        });

        file.stream.pipe(writeStream);
      },
      _removeFile: (_request, file, callback) => { 
        unlink(file.path).then(              // function for deleting a flie form disk
          () => callback(null),
          (error: Error) => callback(error),   // the callbak is provided by multer
        );
      },
    };
  }
}
