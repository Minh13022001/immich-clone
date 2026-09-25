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

import type { User } from '../database';
import { CreateUserDto, UpdateUserDto } from '../dtos/user.dto';
import { UserService } from '../services/user.service';

/**
 * Thin HTTP layer: routing, parameter validation and status codes only.
 *
 * `ParseUUIDPipe` rejects non-UUID ids with a 400 before the service runs, so
 * the service never has to wonder whether an id is well-formed.
 */
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  getAll(): Promise<User[]> {
    return this.userService.getAll();
  }

  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<User> {
    return this.userService.getById(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto): Promise<User> { 
    return this.userService.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto): Promise<User> {
    return this.userService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.userService.delete(id);
  }
}
