import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';

@Module({
  controllers: [SessionController],
  providers: [
    {
      provide: 'REDIS',
      useFactory: (): Redis => {
        const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
        client.on('error', (err: Error) =>
          console.error('[Redis]', err.message),
        );
        return client;
      },
    },
    SessionService,
  ],
  exports: [SessionService],
})
export class SessionModule {}
