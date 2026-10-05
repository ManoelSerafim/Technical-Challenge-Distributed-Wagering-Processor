import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { HttpModule } from './interfaces/http/http.module';
import { ShutdownService } from './common/shutdown/shutdown.service';
import { setupShutdownSignals } from './common/shutdown/shutdown-signals';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    HttpModule,
    new FastifyAdapter({ logger: true })
  );

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  const config = new DocumentBuilder()
    .setTitle('Distributed Wagering Processor')
    .setDescription('iGaming Financial Service API')
    .setVersion('1.0')
    .addTag('Wallets')
    .addTag('Wagering')
    .addTag('Health')
    .addHeader('Idempotency-Key', 'Required for POST /wagering/transactions', 'string')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const shutdownService = app.get(ShutdownService);
  setupShutdownSignals(shutdownService);

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application running on port ${port}`);
  console.log(`Swagger docs available at http://localhost:${port}/api/docs`);
}

bootstrap().catch(console.error);