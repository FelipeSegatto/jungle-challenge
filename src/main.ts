import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ApiErrorFilter } from './presentation/error-filter';
import { RequestLogger } from './infrastructure/observability/request-logger';
async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule);
    app.useGlobalFilters(new ApiErrorFilter());
    app.useGlobalInterceptors(new RequestLogger());
    app.useGlobalPipes(new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
    }));
    app.enableShutdownHooks();
    const port = Number(process.env.PORT ?? '3000');
    await app.listen(port, '0.0.0.0');
    console.log(JSON.stringify({ level: 'info', msg: 'Listening', port }));
}
bootstrap().catch(error => { console.error(error); process.exit(1); });
