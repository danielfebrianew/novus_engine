import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. AKTIFKAN CORS (Agar Frontend 3001 bisa tembak Backend 3000)
  app.enableCors({
    origin: "http://localhost:3001", 
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });

  // 2. NAIKKAN LIMIT UPLOAD (Penting buat upload gambar/video)
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  app.useGlobalPipes(new ValidationPipe());

  app.setGlobalPrefix('api/v1');

  const server = app.getHttpServer();
  server.setTimeout(600000); 
  
  server.keepAliveTimeout = 600000; 
  
  server.headersTimeout = 601000;

  await app.listen(process.env.PORT ?? 3000);

  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
