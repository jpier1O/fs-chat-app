import { Test, TestingModule } from '@nestjs/testing';
import { GoneException, NotFoundException } from '@nestjs/common';
import type Redis from 'ioredis';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { MockRedis } from '../test/mock-redis';

describe('SessionController', () => {
  let controller: SessionController;
  let service: SessionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        SessionService,
        { provide: 'REDIS', useValue: new MockRedis() as unknown as Redis },
      ],
    }).compile();

    controller = module.get<SessionController>(SessionController);
    service = module.get<SessionService>(SessionService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /chat/session', () => {
    it('should create a new session and return sessionId', async () => {
      const result = await controller.createSession();
      expect(result).toHaveProperty('sessionId');
      expect(typeof result.sessionId).toBe('string');
      expect(result.sessionId.length).toBeGreaterThan(0);
    });

    it('should create unique session IDs', async () => {
      const r1 = await controller.createSession();
      const r2 = await controller.createSession();
      expect(r1.sessionId).not.toBe(r2.sessionId);
    });
  });

  describe('GET /chat/:sessionId/history', () => {
    it('should return empty turns for new session', async () => {
      const sessionId = await service.createSession();
      const result = await controller.getHistory(sessionId);
      expect(result).toHaveProperty('turns');
      expect(result.turns).toEqual([]);
    });

    it('should return all turns for session with history', async () => {
      const sessionId = await service.createSession();
      await service.addTurn(sessionId, 'Message 1', 'Reply 1');
      await service.addTurn(sessionId, 'Message 2', 'Reply 2');

      const result = await controller.getHistory(sessionId);
      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].message).toBe('Message 1');
      expect(result.turns[1].message).toBe('Message 2');
    });

    it('should throw NotFoundException for unknown sessionId', async () => {
      await expect(controller.getHistory('unknown-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('DELETE /chat/:sessionId', () => {
    it('should delete an existing session', async () => {
      const sessionId = await service.createSession();
      await expect(controller.deleteSession(sessionId)).resolves.not.toThrow();
      // ID stays in session_ids → GoneException (not 404) on subsequent access
      await expect(service.getSession(sessionId)).rejects.toThrow(GoneException);
    });

    it('should throw NotFoundException for unknown sessionId', async () => {
      await expect(controller.deleteSession('unknown-id')).rejects.toThrow(NotFoundException);
    });
  });
});
