import { Controller, Post, Get, Delete, Param, HttpCode } from '@nestjs/common';
import { SessionService, Turn } from './session.service';

@Controller('chat')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post('session')
  @HttpCode(201)
  async createSession(): Promise<{ sessionId: string }> {
    const sessionId = await this.sessionService.createSession();
    return { sessionId };
  }

  @Get(':sessionId/history')
  async getHistory(@Param('sessionId') sessionId: string): Promise<{ turns: Turn[] }> {
    const turns = await this.sessionService.getHistory(sessionId);
    return { turns };
  }

  @Delete(':sessionId')
  @HttpCode(204)
  async deleteSession(@Param('sessionId') sessionId: string): Promise<void> {
    await this.sessionService.deleteSession(sessionId);
  }
}
