import { Global, Module } from '@nestjs/common';
import { PanelGateway } from './panel.gateway';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

@Global()
@Module({
  providers: [RealtimeService, RealtimeGateway, PanelGateway],
  exports: [RealtimeService],
})
export class RealtimeModule {}
