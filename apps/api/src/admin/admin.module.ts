import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { UsersService } from './users.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, UsersService],
})
export class AdminModule {}
