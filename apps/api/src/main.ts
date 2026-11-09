import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'] });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`FireControl 360 API listening on :${port}/api/v1`);
}
bootstrap();
