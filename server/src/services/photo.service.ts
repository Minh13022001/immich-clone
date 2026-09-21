import { Injectable, NotFoundException } from '@nestjs/common';

import type { Photo } from '../database';
import type { CreatePhotoDto, UpdatePhotoDto } from '../dtos/photo.dto';
import { PhotoRepository } from '../repositories/photo.repository';
import type { PhotoRow } from '../schema';
import { BaseService } from './base.service';

/**
 * Business rules for photos: trim/normalise input, translate "no row" into 404,
 * and expose domain objects rather than database rows.
 */
@Injectable()
export class PhotoService extends BaseService {
  constructor(private readonly photoRepository: PhotoRepository) {
    super();
  }

  async create(dto: CreatePhotoDto): Promise<Photo> {
    const row = await this.photoRepository.create({ name: dto.name.trim() });
    return this.toPhoto(row);
  }

  async getAll(): Promise<Photo[]> {
    const rows = await this.photoRepository.getAll();
    return rows.map((row) => this.toPhoto(row));
  }

  async getById(id: string): Promise<Photo> {
    const row = await this.photoRepository.getById(id);
    return this.toPhoto(this.assertFound(row, `Photo ${id} not found`));
  }

  async update(id: string, dto: UpdatePhotoDto): Promise<Photo> {
    const row = await this.photoRepository.update(id, {
      name: dto.name.trim(),
      updatedAt: new Date(),
    });

    return this.toPhoto(this.assertFound(row, `Photo ${id} not found`));
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.photoRepository.delete(id);

    if (!deleted) {
      throw new NotFoundException(`Photo ${id} not found`);
    }
  }

  /**
   * Rows and domain objects are structurally identical today. The explicit
   * mapping keeps them decoupled: if the column layout changes, only this
   * method has to follow.
   */
  private toPhoto(row: PhotoRow): Photo {
    return {
      id: row.id,
      name: row.name,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }
}
