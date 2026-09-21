import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import type { Photo } from '../database';
import { CreatePhotoDto, UpdatePhotoDto } from '../dtos/photo.dto';
import { PhotoService } from '../services/photo.service';

/**
 * Thin HTTP layer: routing, parameter validation and status codes only.
 *
 * `ParseUUIDPipe` rejects non-UUID ids with a 400 before the service runs, so
 * the service never has to wonder whether an id is well-formed.
 */
@Controller('photos')
export class PhotoController {
  constructor(private readonly photoService: PhotoService) {}

  @Get()
  getAll(): Promise<Photo[]> {
    return this.photoService.getAll();
  }

  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<Photo> {
    return this.photoService.getById(id);
  }

  @Post()
  create(@Body() dto: CreatePhotoDto): Promise<Photo> {
    return this.photoService.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePhotoDto): Promise<Photo> {
    return this.photoService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.photoService.delete(id);
  }
}
