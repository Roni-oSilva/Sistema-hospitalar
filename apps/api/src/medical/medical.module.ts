import { Module } from '@nestjs/common';
import { AttendancesModule } from '../attendances/attendances.module';
import { MedicalController } from './medical.controller';
import { MedicalService } from './medical.service';

@Module({
  imports: [AttendancesModule],
  controllers: [MedicalController],
  providers: [MedicalService],
})
export class MedicalModule {}
