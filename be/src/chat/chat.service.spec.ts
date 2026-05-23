import { Test, TestingModule } from '@nestjs/testing';
import type Redis from 'ioredis';
import { ChatService } from './chat.service';
import { SessionService } from '../session/session.service';
import { LlmService } from '../llm/llm.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MockRedis } from '../test/mock-redis';

describe('ChatService', () => {
  let service: ChatService;
  let sessionService: SessionService;
  let llmService: LlmService;

  beforeEach(async () => {
    const mockLlmService = { generateStream: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        SessionService,
        { provide: 'REDIS', useValue: new MockRedis() as unknown as Redis },
        { provide: LlmService, useValue: mockLlmService },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    sessionService = module.get<SessionService>(SessionService);
    llmService = module.get<LlmService>(LlmService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendMessage', () => {
    it('should send a message and return reply with turnIndex', async () => {
      const sessionId = await sessionService.createSession();
      const dto: SendMessageDto = { message: 'Hello' };

      const result = await service.sendMessage(sessionId, dto);

      expect(result).toHaveProperty('reply');
      expect(result).toHaveProperty('turnIndex');
      expect(result.turnIndex).toBe(0);
      expect(typeof result.reply).toBe('string');
    });

    it('should trim message before processing', async () => {
      const sessionId = await sessionService.createSession();
      const dto: SendMessageDto = { message: '  Hello  ' };

      const result = await service.sendMessage(sessionId, dto);

      expect(result.reply).toContain('Hello');
      expect(result.reply).not.toContain('  ');
    });

    it('should store message in session history', async () => {
      const sessionId = await sessionService.createSession();
      const dto: SendMessageDto = { message: 'Test message' };

      await service.sendMessage(sessionId, dto);

      const history = await sessionService.getHistory(sessionId);
      expect(history).toHaveLength(1);
      expect(history[0].message).toBe('Test message');
    });

    it('should increment turnIndex for multiple messages', async () => {
      const sessionId = await sessionService.createSession();

      const r1 = await service.sendMessage(sessionId, { message: 'First' });
      const r2 = await service.sendMessage(sessionId, { message: 'Second' });
      const r3 = await service.sendMessage(sessionId, { message: 'Third' });

      expect(r1.turnIndex).toBe(0);
      expect(r2.turnIndex).toBe(1);
      expect(r3.turnIndex).toBe(2);
    });
  });

  describe('sendMessageStream', () => {
    it('should generate streaming response and store in history', async () => {
      const sessionId = await sessionService.createSession();
      const dto: SendMessageDto = { message: 'Hello' };

      const mockTokens = ['Hello', ' there', '!', ' How', ' can', ' I', ' help', '?'];
      (llmService.generateStream as jest.Mock).mockImplementation(async function* () {
        for (const token of mockTokens) yield token;
      });

      const tokens: string[] = [];
      for await (const token of service.sendMessageStream(sessionId, dto)) {
        tokens.push(token);
      }

      expect(tokens).toEqual(mockTokens);
      expect(llmService.generateStream).toHaveBeenCalledWith([], 'Hello');

      const history = await sessionService.getHistory(sessionId);
      expect(history).toHaveLength(1);
      expect(history[0].message).toBe('Hello');
      expect(history[0].reply).toBe('Hello there! How can I help?');
    });

    it('should pass conversation history to LLM', async () => {
      const sessionId = await sessionService.createSession();
      await sessionService.addTurn(sessionId, 'Previous message', 'Previous reply');

      const dto: SendMessageDto = { message: 'New message' };
      (llmService.generateStream as jest.Mock).mockImplementation(async function* () {
        yield 'Response';
      });

      const tokens: string[] = [];
      for await (const token of service.sendMessageStream(sessionId, dto)) {
        tokens.push(token);
      }

      expect(llmService.generateStream).toHaveBeenCalledWith(
        [
          { role: 'user', content: 'Previous message' },
          { role: 'model', content: 'Previous reply' },
        ],
        'New message',
      );
    });

    it('should handle LLM errors', async () => {
      const sessionId = await sessionService.createSession();
      const dto: SendMessageDto = { message: 'Hello' };

      (llmService.generateStream as jest.Mock).mockImplementation(async function* () {
        throw new Error('LLM Error');
      });

      await expect(async () => {
        for await (const _ of service.sendMessageStream(sessionId, dto)) { /* no-op */ }
      }).rejects.toThrow('LLM Error');
    });

    it('should trim message before processing', async () => {
      const sessionId = await sessionService.createSession();
      const dto: SendMessageDto = { message: '  Hello  ' };

      (llmService.generateStream as jest.Mock).mockImplementation(async function* () {
        yield 'Response';
      });

      for await (const _ of service.sendMessageStream(sessionId, dto)) { /* no-op */ }

      expect(llmService.generateStream).toHaveBeenCalledWith([], 'Hello');
    });
  });
});
