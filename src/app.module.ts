import { Module } from '@nestjs/common';
import { GenerateAiModule } from './generate-ai/generate-ai.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot({
    isGlobal: true,
  }),
    GenerateAiModule]
})
export class AppModule { }
