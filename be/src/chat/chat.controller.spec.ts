import { Test, TestingModule } from '@nestjs/testing';
import { GoneException, NotFoundException } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Response } from 'express';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { SessionService } from '../session/session.service';
import { LlmService } from '../llm/llm.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MockRedis } from '../test/mock-redis';

// Testable session service with injectable clock (for 410 tests)
class TestableSessionService extends SessionService {
  private mockTime = new Date();
  setMockTime(t: Date) { this.mockTime = t; }
  protected now() { return this.mockTime; }
}

const mockLlmService = { generateStream: jest.fn() };

describe('ChatController', () => {
  let controller: ChatController;
  let sessionService: TestableSessionService;
  let mockRedis: MockRedis;

  beforeEach(async () => {
    mockRedis = new MockRedis();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        ChatService,
        {
          provide: SessionService,
          useFactory: () => new TestableSessionService(mockRedis as unknown as Redis),
        },
        { provide: 'REDIS', useValue: mockRedis as unknown as Redis },
        { provide: LlmService, useValue: mockLlmService },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
    sessionService = module.get<SessionService>(SessionService) as TestableSessionService;
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockRedis.flushAll();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── POST /chat/session → 201 (covered in session.controller.spec) ─────────
  describe('sendMessage (sync helper, no HTTP route)', () => {
    it('returns reply and turnIndex for a valid session', async () => {
      const sessionId = await sessionService.createSession();
      const dto: SendMessageDto = { message: 'Hello' };

      const result = await controller.sendMessage(sessionId, dto);

      expect(result).toHaveProperty('reply');
      expect(result).toHaveProperty('turnIndex');
      expect(result.turnIndex).toBe(0);
    });

    it('throws NotFoundException for an unknown sessionId → 404', async () => {
      const dto: SendMessageDto = { message: 'Hello' };
      await expect(controller.sendMessage('unknown-id', dto)).rejects.toThrow(NotFoundException);
    });

    it('throws GoneException for an idle-expired sessionId → 410', async () => {
      const start = new Date('2026-05-22T10:00:00Z');
      sessionService.setMockTime(start);
      const sessionId = await sessionService.createSession();

      sessionService.setMockTime(new Date('2026-05-22T10:31:00Z'));

      const dto: SendMessageDto = { message: 'Hello' };
      await expect(controller.sendMessage(sessionId, dto)).rejects.toThrow(GoneException);
    });

    it('increments turnIndex for sequential messages', async () => {
      const sessionId = await sessionService.createSession();

      const r1 = await controller.sendMessage(sessionId, { message: 'First' });
      const r2 = await controller.sendMessage(sessionId, { message: 'Second' });

      expect(r1.turnIndex).toBe(0);
      expect(r2.turnIndex).toBe(1);
    });
  });

  // ── POST /chat/:id/message → SSE Content-Type ─────────────────────────────
  describe('streamMessage (SSE route)', () => {
    function makeMockRes() {
      return {
        setHeader: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      } as unknown as Response;
    }

    it('sets Content-Type: text/event-stream on the SSE response', async () => {
      mockLlmService.generateStream.mockImplementation(async function* () {
        yield 'Hello';
      });
      const sessionId = await sessionService.createSession();
      const res = makeMockRes();

      await controller.streamMessage(sessionId, { message: 'Hi' }, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    });

    it('writes data and done events during normal streaming', async () => {
      mockLlmService.generateStream.mockImplementation(async function* () {
        yield 'Hello ';
        yield 'world';
      });
      const sessionId = await sessionService.createSession();
      const res = makeMockRes();

      await controller.streamMessage(sessionId, { message: 'Hi' }, res);

      const written = (res.write as jest.Mock).mock.calls.map((c) => c[0] as string);
      expect(written.some((s) => s.includes('"token":"Hello "'))).toBe(true);
      expect(written.some((s) => s.includes('"done":true'))).toBe(true);
    });

  });
});
