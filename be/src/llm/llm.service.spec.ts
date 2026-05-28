import { Test, TestingModule } from '@nestjs/testing';
import { LlmService } from './llm.service';

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      startChat: jest.fn().mockReturnValue({
        sendMessageStream: jest.fn(),
      }),
    }),
  })),
  SchemaType: {
    OBJECT: 'object',
    STRING: 'string',
  },
}));

function makeStream(texts: string[]) {
  return (async function* () {
    for (const t of texts) yield { text: () => t };
  })();
}

describe('LlmService', () => {
  let service: LlmService;
  let mockModel: { startChat: jest.Mock };
  let mockChat: { sendMessageStream: jest.Mock };

  beforeEach(async () => {
    process.env.LLM_API_KEY = 'test-api-key';
    process.env.LLM_MODEL = 'gemini-2.0-flash';

    const module: TestingModule = await Test.createTestingModule({
      providers: [LlmService],
    }).compile();

    service = module.get<LlmService>(LlmService);

    mockChat = { sendMessageStream: jest.fn() };
    mockModel = { startChat: jest.fn().mockReturnValue(mockChat) };
    (service as unknown as { model: typeof mockModel }).model = mockModel;
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
  });

  describe('constructor', () => {
    it('throws when LLM_API_KEY is missing', () => {
      delete process.env.LLM_API_KEY;
      delete process.env.GEMINI_API_KEY;
      expect(() => new LlmService()).toThrow(
        'LLM_API_KEY or GEMINI_API_KEY environment variable is required',
      );
    });

    it('accepts GEMINI_API_KEY as a fallback', () => {
      delete process.env.LLM_API_KEY;
      process.env.GEMINI_API_KEY = 'fallback-key';
      expect(() => new LlmService()).not.toThrow();
    });
  });

  describe('generateStream', () => {
    it('yields the full text when there are no tool calls', async () => {
      mockChat.sendMessageStream.mockResolvedValue({
        stream: makeStream(['Hello, this is a test response!']),
        response: Promise.resolve({
          text: () => 'Hello, this is a test response!',
          functionCalls: () => undefined,
          candidates: [],
        }),
      });

      const tokens: string[] = [];
      for await (const token of service.generateStream(
        [
          { role: 'user', content: 'Hello' },
          { role: 'model', content: 'Hi there!' },
        ],
        'How are you?',
      )) {
        tokens.push(token);
      }

      expect(mockModel.startChat).toHaveBeenCalledWith({
        history: [
          { role: 'user', parts: [{ text: 'Hello' }] },
          { role: 'model', parts: [{ text: 'Hi there!' }] },
        ],
      });
      expect(mockChat.sendMessageStream).toHaveBeenCalledWith('How are you?');
      expect(tokens.join('')).toBe('Hello, this is a test response!');
    });

    it('executes the tool call loop before yielding text', async () => {
      mockChat.sendMessageStream
        .mockResolvedValueOnce({
          stream: makeStream([]),
          response: Promise.resolve({
            functionCalls: () => [
              { name: 'lookup_recipe', args: { recipe_name: 'chocolate chip cookies' } },
            ],
            text: () => '',
            candidates: [],
          }),
        })
        .mockResolvedValueOnce({
          stream: makeStream(['Here is the recipe for chocolate chip cookies...']),
          response: Promise.resolve({
            text: () => 'Here is the recipe for chocolate chip cookies...',
            functionCalls: () => undefined,
            candidates: [],
          }),
        });

      const tokens: string[] = [];
      for await (const token of service.generateStream(
        [],
        'Can you give me a recipe for chocolate chip cookies?',
      )) {
        tokens.push(token);
      }

      expect(mockChat.sendMessageStream).toHaveBeenCalledTimes(2);
      expect(mockChat.sendMessageStream).toHaveBeenNthCalledWith(
        1,
        'Can you give me a recipe for chocolate chip cookies?',
      );
      expect(mockChat.sendMessageStream).toHaveBeenNthCalledWith(2, [
        {
          functionResponse: {
            name: 'lookup_recipe',
            response: expect.objectContaining({
              name: 'Chocolate Chip Cookies',
              ingredients: expect.any(Array),
              instructions: expect.any(Array),
            }),
          },
        },
      ]);
      expect(tokens.join('')).toBe('Here is the recipe for chocolate chip cookies...');
    });

    it('yields a refusal message when finish_reason is SAFETY', async () => {
      mockChat.sendMessageStream.mockResolvedValue({
        stream: makeStream([]),
        response: Promise.resolve({
          text: () => '',
          functionCalls: () => undefined,
          candidates: [{ finishReason: 'SAFETY' }],
        }),
      });

      const tokens: string[] = [];
      for await (const token of service.generateStream([], 'Tell me something unsafe')) {
        tokens.push(token);
      }

      expect(tokens.join('')).toContain("I'm sorry");
    });

    it('propagates LLM errors as "Failed to generate response from LLM"', async () => {
      mockChat.sendMessageStream.mockRejectedValue(new Error('API Error'));

      await expect(async () => {
        for await (const _ of service.generateStream([], 'Hello')) {
          // no-op
        }
      }).rejects.toThrow('Failed to generate response from LLM');
    });
  });

  describe('tool execution', () => {
    it('lookup_recipe returns data for a known recipe', async () => {
      const result = await (
        service as unknown as {
          executeToolCall: (tc: { name: string; args: Record<string, unknown> }) => Promise<unknown>;
        }
      ).executeToolCall({ name: 'lookup_recipe', args: { recipe_name: 'chocolate chip cookies' } });

      expect(result).toEqual(
        expect.objectContaining({
          name: 'Chocolate Chip Cookies',
          ingredients: expect.any(Array),
          instructions: expect.any(Array),
        }),
      );
    });

    it('lookup_recipe returns error for an unknown recipe', async () => {
      const result = await (
        service as unknown as {
          executeToolCall: (tc: { name: string; args: Record<string, unknown> }) => Promise<unknown>;
        }
      ).executeToolCall({ name: 'lookup_recipe', args: { recipe_name: 'nonexistent recipe' } });

      expect(result).toEqual(
        expect.objectContaining({ error: 'Recipe not found', available_recipes: expect.any(Array) }),
      );
    });

    it('run_typescript_code returns a stub result with the code field', async () => {
      const result = await (
        service as unknown as {
          executeToolCall: (tc: { name: string; args: Record<string, unknown> }) => Promise<unknown>;
        }
      ).executeToolCall({ name: 'run_typescript_code', args: { code: '2 + 2' } });

      expect(result).toMatchObject({ success: true, code: '2 + 2' });
    });

    it('get_department_info returns data for a known department', async () => {
      const result = await (
        service as unknown as {
          executeToolCall: (tc: { name: string; args: Record<string, unknown> }) => Promise<unknown>;
        }
      ).executeToolCall({ name: 'get_department_info', args: { department_name: 'engineering' } });

      expect(result).toEqual(
        expect.objectContaining({
          name: 'Engineering',
          head: 'Sarah Johnson',
          team_size: 45,
        }),
      );
    });

    it('get_department_info returns error for an unknown department', async () => {
      const result = await (
        service as unknown as {
          executeToolCall: (tc: { name: string; args: Record<string, unknown> }) => Promise<unknown>;
        }
      ).executeToolCall({
        name: 'get_department_info',
        args: { department_name: 'nonexistent' },
      });

      expect(result).toEqual(
        expect.objectContaining({
          error: 'Department not found',
          available_departments: expect.any(Array),
        }),
      );
    });

    it('returns error for an unknown tool name', async () => {
      const result = await (
        service as unknown as {
          executeToolCall: (tc: { name: string; args: Record<string, unknown> }) => Promise<unknown>;
        }
      ).executeToolCall({ name: 'unknown_tool', args: {} });

      expect(result).toEqual({ error: 'Unknown tool: unknown_tool' });
    });
  });
});
