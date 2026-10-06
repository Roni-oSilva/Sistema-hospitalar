import { Global, Module } from '@nestjs/common';
import { AttendanceCoreService } from '../attendances/attendance-core.service';
import { QueuePriorityService } from '../queue/queue-priority.service';
import { SequenceService } from './sequence.service';
import { ClinicalVersioningService } from '../clinical/clinical-versioning.service';

/** Serviços de domínio compartilhados entre recepção, triagem e médico. */
@Global()
@Module({
  providers: [AttendanceCoreService, SequenceService, QueuePriorityService, ClinicalVersioningService],
  exports: [AttendanceCoreService, SequenceService, QueuePriorityService, ClinicalVersioningService],
})
export class CoreModule {}
