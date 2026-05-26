import * as dotenv from 'dotenv';
dotenv.config();

import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, Logger } from '@nestjs/common';

Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.0,
});

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
];

type CorsOriginCallback = (
  err: Error | null,
  allow?: boolean | string | RegExp | Array<boolean | string | RegExp>,
) => void;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const port = configService.get<number>('PORT') ?? 3000;
  const nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';
  const allowedOriginsRaw = configService.get<string>('ALLOWED_ORIGINS');
  const allowedOrigins = allowedOriginsRaw
    ? allowedOriginsRaw.split(',')
    : DEV_ORIGINS;

  app.enableCors({
    origin: (origin: string | undefined, callback: CorsOriginCallback) => {
      // In production, refuse requests without Origin (prevents CSRF from arbitrary clients).
      // In development, allow Origin-less requests for local tooling (curl, Postman).
      if (!origin) {
        if (nodeEnv === 'production') {
          return callback(new Error('Origin header required'));
        }
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Authorization',
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('FheForge API')
    .setDescription('API documentation for the FheForge backend')
    .setVersion('1.0')
    .addBearerAuth();

  if (nodeEnv === 'development') {
    swaggerConfig.addServer(`http://localhost:${port}`, 'Local server');
  } else if (nodeEnv === 'staging') {
    swaggerConfig.addServer(
      'https://fheforge-api-staging.up.railway.app',
      'Staging server',
    );
  } else {
    swaggerConfig.addServer(
      'https://fheforge-api-production.up.railway.app',
      'Production server',
    );
  }

  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig.build()),
  );

  await app.listen(port);
  Logger.log(`FheForge API listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
