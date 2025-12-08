import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GenerateAiController } from './generate-ai.controller';
import { GenerateAiService } from './generate-ai.service';
import { VideoUtilsHelper } from './helpers/video-utils.helper';

@Module({
  imports: [ConfigModule],
  controllers: [GenerateAiController],
  providers: [GenerateAiService, VideoUtilsHelper],
})
export class GenerateAiModule {}