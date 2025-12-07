import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GenerateAiModule } from './generate-ai/generate-ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    GenerateAiModule, 
  ],
  controllers: [],
  providers: [], 
})
export class AppModule {}