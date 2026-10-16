import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Continuum API')
      .setDescription(
        'Continuum project work, files, search, conversations, memory, and agent APIs.',
      )
      .setVersion('0.1.0')
      .build(),
  );
}
