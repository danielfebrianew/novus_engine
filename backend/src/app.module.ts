import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GenerateAiModule } from './generate-ai/generate-ai.module';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), EventEmitterModule.forRoot(),
    GenerateAiModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule { }