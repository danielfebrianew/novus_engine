import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GenerateAiController } from './generate-ai.controller';
import { GenerateAiService } from './generate-ai.service';

@Module({
  imports: [ConfigModule],
  controllers: [GenerateAiController],
  providers: [GenerateAiService],
})
export class GenerateAiModule {}