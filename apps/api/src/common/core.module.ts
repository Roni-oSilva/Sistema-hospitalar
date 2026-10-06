import { Global, Module } from '@nestjs/common';
import { AttendanceCoreService } from '../attendances/attendance-core.service';
import { QueuePriorityService } from '../queue/queue-priority.service';
import { SequenceService } from './sequence.service';

/** Serviços de domínio compartilhados entre recepção, triagem e médico. */
@Global()
@Module({
  providers: [AttendanceCoreService, SequenceService, QueuePriorityService],
  exports: [AttendanceCoreService, SequenceService, QueuePriorityService],
})
export class CoreModule {}
