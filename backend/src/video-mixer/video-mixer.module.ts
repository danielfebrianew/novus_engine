import { Module } from '@nestjs/common';
import { VideoMixerService } from './video-mixer.service';
import { VideoMixerController } from './video-mixer.controller';
import { VideoUtilsHelper } from './helpers/video-utils.helper'; 

@Module({
  controllers: [VideoMixerController],
  providers: [VideoMixerService, VideoUtilsHelper],
})
export class VideoMixerModule {}
