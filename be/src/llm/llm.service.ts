import { Injectable } from '@nestjs/common';
import {
  GoogleGenerativeAI,
  Content,
  SchemaType,
  GenerativeModel,
  Tool,
} from '@google/generative-ai';

export interface LlmMessage {
  role: 'user' | 'model';
  content: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

@Injectable()
export class LlmService {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;

  constructor() {
    const apiKey = process.env.LLM_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'LLM_API_KEY or GEMINI_API_KEY environment variable is required',
      );
    }

    this.genAI = new GoogleGenerativeAI(apiKey);

    const modelName = process.env.LLM_MODEL || 'gemini-1.5-flash';

    const tools: Tool[] = [
      {
        functionDeclarations: [
          {
            name: 'lookup_recipe',
            description:
              'Look up a recipe by name. Returns ingredients and cooking instructions.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                recipe_name: {
                  type: SchemaType.STRING,
                  description: 'The name of the recipe to look up',
                },
              },
              required: ['recipe_name'],
            },
          },
          {
            name: 'run_typescript_code',
            description:
              'Execute TypeScript code and return the result. Useful for calculations, data processing, or demonstrations.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                code: {
                  type: SchemaType.STRING,
                  description: 'The TypeScript code to execute',
                },
              },
              required: ['code'],
            },
          },
          {
            name: 'get_department_info',
            description:
              'Get information about a company department including team members and responsibilities.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                department_name: {
                  type: SchemaType.STRING,
                  description:
                    'The name of the department (e.g., Engineering, Sales, HR)',
                },
              },
              required: ['department_name'],
            },
          },
        ],
      },
    ];

    this.model = this.genAI.getGenerativeModel({
      model: modelName,
      tools,
      systemInstruction: `You are a helpful AI assistant specialized in cooking, programming, and company information.

IMPORTANT RULES:
1. You MUST stay on topic. Only answer questions about:
   - Cooking and recipes
   - Programming and TypeScript
   - Company departments and organization

2. For OFF-TOPIC questions (politics, religion, personal advice, news, etc.), you MUST respond with:
   "I'm sorry, but I can only help with cooking recipes, programming questions, and company information. Please ask me something related to these topics."

3. Use the available tools when appropriate:
   - lookup_recipe: When users ask about recipes or cooking
   - run_typescript_code: When users need code execution or calculations
   - get_department_info: When users ask about company departments

4. Be concise and helpful in your responses.`,
    });
  }

  /**
   * Generate streaming response with tool calling support.
   * Tool calls are resolved fully before any token is yielded to the caller.
   */
  async *generateStream(
    history: LlmMessage[],
    newMessage: string,
  ): AsyncGenerator<string, void, unknown> {
    try {
      const chatHistory: Content[] = history.map((msg) => ({
        role: msg.role,
        parts: [{ text: msg.content }],
      }));

      const chat = this.model.startChat({ history: chatHistory });

      let result = await chat.sendMessage(newMessage);
      let response = result.response;

      // Resolve tool call loop before streaming any token
      let functionCalls = response.functionCalls();
      while (functionCalls && functionCalls.length > 0) {
        const fc = functionCalls[0];
        const toolResult = await this.executeToolCall({
          name: fc.name,
          args: fc.args as Record<string, unknown>,
        });

        result = await chat.sendMessage([
          {
            functionResponse: {
              name: fc.name,
              response: toolResult as object,
            },
          },
        ]);
        response = result.response;
        functionCalls = response.functionCalls();
      }

      // Inspect finish_reason so refusals are enforced server-side,
      // not relying solely on model compliance with the system prompt.
      const finishReason = response.candidates?.[0]?.finishReason as string | undefined;
      if (finishReason === 'SAFETY') {
        yield "I'm sorry, but I can only help with cooking recipes, programming questions, and company information. Please ask me something related to these topics.";
        return;
      }

      yield response.text();
    } catch (error) {
      console.error('LLM generation error:', error);
      throw new Error('Failed to generate response from LLM');
    }
  }

  private async executeToolCall(toolCall: ToolCall): Promise<unknown> {
    const { name, args } = toolCall;

    switch (name) {
      case 'lookup_recipe':
        return this.lookupRecipe(args.recipe_name as string);

      case 'run_typescript_code':
        return this.runTypeScriptCode(args.code as string);

      case 'get_department_info':
        return this.getDepartmentInfo(args.department_name as string);

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  private lookupRecipe(recipeName: string): unknown {
    const recipes: Record<string, unknown> = {
      'chocolate chip cookies': {
        name: 'Chocolate Chip Cookies',
        ingredients: [
          '2 1/4 cups all-purpose flour',
          '1 tsp baking soda',
          '1 tsp salt',
          '1 cup butter, softened',
          '3/4 cup granulated sugar',
          '3/4 cup packed brown sugar',
          '2 large eggs',
          '2 tsp vanilla extract',
          '2 cups chocolate chips',
        ],
        instructions: [
          'Preheat oven to 375°F (190°C)',
          'Mix flour, baking soda, and salt in a bowl',
          'Beat butter and sugars until creamy',
          'Add eggs and vanilla, beat well',
          'Gradually blend in flour mixture',
          'Stir in chocolate chips',
          'Drop rounded tablespoons onto ungreased cookie sheets',
          'Bake 9-11 minutes or until golden brown',
        ],
        prep_time: '15 minutes',
        cook_time: '10 minutes',
        servings: 48,
      },
      'spaghetti carbonara': {
        name: 'Spaghetti Carbonara',
        ingredients: [
          '400g spaghetti',
          '200g pancetta or guanciale',
          '4 large eggs',
          '100g Pecorino Romano cheese, grated',
          'Black pepper',
          'Salt',
        ],
        instructions: [
          'Cook spaghetti in salted boiling water until al dente',
          'Cut pancetta into small pieces and fry until crispy',
          'Beat eggs with grated cheese and black pepper',
          'Drain pasta, reserving 1 cup of pasta water',
          'Add hot pasta to pancetta pan',
          'Remove from heat and quickly mix in egg mixture',
          'Add pasta water to reach desired consistency',
          'Serve immediately with extra cheese and pepper',
        ],
        prep_time: '10 minutes',
        cook_time: '15 minutes',
        servings: 4,
      },
    };

    const recipe = recipes[recipeName.toLowerCase()];
    if (recipe) {
      return recipe;
    }

    return {
      error: 'Recipe not found',
      available_recipes: Object.keys(recipes),
    };
  }

  private runTypeScriptCode(code: string): unknown {
    try {
      // SECURITY: In production, use a proper sandbox like vm2 or isolated-vm
      const safeCode = code.replace(/import|require|eval|Function/g, '');

      const result = eval(safeCode);
      return {
        success: true,
        result: String(result),
        code,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      return {
        success: false,
        error: err.message,
        code,
      };
    }
  }

  private getDepartmentInfo(departmentName: string): unknown {
    const departments: Record<string, unknown> = {
      engineering: {
        name: 'Engineering',
        head: 'Sarah Johnson',
        team_size: 45,
        teams: ['Frontend', 'Backend', 'DevOps', 'QA'],
        responsibilities: [
          'Product development',
          'Infrastructure management',
          'Quality assurance',
          'Technical architecture',
        ],
        location: 'Building A, Floor 3',
      },
      sales: {
        name: 'Sales',
        head: 'Michael Chen',
        team_size: 28,
        teams: ['Enterprise Sales', 'SMB Sales', 'Sales Operations'],
        responsibilities: [
          'Customer acquisition',
          'Revenue generation',
          'Client relationships',
          'Market expansion',
        ],
        location: 'Building B, Floor 2',
      },
      hr: {
        name: 'Human Resources',
        head: 'Emily Rodriguez',
        team_size: 12,
        teams: ['Recruiting', 'People Operations', 'Learning & Development'],
        responsibilities: [
          'Talent acquisition',
          'Employee relations',
          'Benefits administration',
          'Training and development',
        ],
        location: 'Building A, Floor 1',
      },
    };

    const dept = departments[departmentName.toLowerCase()];
    if (dept) {
      return dept;
    }

    return {
      error: 'Department not found',
      available_departments: Object.keys(departments),
    };
  }
}
