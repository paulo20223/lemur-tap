import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';

// BigInt is not JSON-serializable by default; emit as a number string-safe value.
// We serialize money as `number` in DTOs, but guard any stray BigInt in responses.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  // bodyParser:false is CRITICAL — the oRPC node handler reads the raw request
  // stream; Nest's default express body-parser would consume it first and break
  // every POST. All HTTP body routes are now oRPC, so disabling global parsing
  // is safe (the grammY bot uses long-polling, not HTTP).
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    bodyParser: false,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`Lemur Tap API listening on :${port}/api/v1`, 'Bootstrap');
}

void bootstrap();
