import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AuthenticatedOnly, CurrentActor } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @AuthenticatedOnly()
  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.notifications.list(actor);
  }

  @AuthenticatedOnly()
  @Post('read-all')
  @HttpCode(204)
  async readAll(@CurrentActor() actor: Actor): Promise<void> {
    await this.notifications.markAllRead(actor);
  }
}
