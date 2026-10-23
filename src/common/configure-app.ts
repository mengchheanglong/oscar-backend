import { randomUUID } from 'node:crypto';
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ValidationError } from 'class-validator';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { Request, Response, NextFunction } from 'express';
import { Environment } from '../config/environment';
import { ApiExceptionFilter } from './filters/api-exception.filter';

function validationDetails(
  errors: ValidationError[],
  parent = '',
): { field: string; message: string }[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    return [
      ...Object.values(error.constraints ?? {}).map((message) => ({ field, message })),
      ...validationDetails(error.children ?? [], field),
    ];
  });
}

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<Environment, true>);
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.use(helmet());
  app.use((_: Request, response: Response, next: NextFunction) => {
    response.setHeader('x-request-id', randomUUID());
    next();
  });
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  const configuredOrigin = config.get('APP_ORIGIN', { infer: true });
  const allowedOrigins =
    nodeEnv === 'development'
      ? Array.from(
          new Set([
            configuredOrigin,
            'http://localhost:43101',
            'http://localhost:43100',
            'http://127.0.0.1:43101',
            'http://127.0.0.1:43100',
          ]),
        )
      : configuredOrigin;

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: ['x-csrf-token', 'x-request-id'],
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
      exceptionFactory: (errors) =>
        new BadRequestException({
          message: 'Please correct the highlighted fields.',
          details: validationDetails(errors),
        }),
    }),
  );
}
