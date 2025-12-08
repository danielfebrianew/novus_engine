import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { TransformInterceptor } from './common/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe());

  app.setGlobalPrefix('api/v1');

  app.useGlobalInterceptors(new TransformInterceptor());

  const server = app.getHttpServer();
  server.setTimeout(600000); 
  
  // 2. Timeout Keep-Alive (PENTING: Biar socket dianggap aktif walau idle)
  server.keepAliveTimeout = 600000; 
  
  // 3. Headers Timeout (Wajib lebih besar dari keepAliveTimeout)
  server.headersTimeout = 601000;

  await app.listen(process.env.PORT ?? 3000);

  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
