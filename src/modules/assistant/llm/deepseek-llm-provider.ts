import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  ChatCompletionMessage,
  GenerateAnswerParams,
  GenerateAnswerResult,
  GenerateStructuredOutputParams,
  GenerateStructuredOutputResult,
  LlmProvider,
} from './llm-provider.interface';
import { CitationItem } from '../entities/chat-message.entity';

interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface DeepSeekChoice {
  message?: {
    role: string;
    content: string;
  };
  finish_reason?: string;
}

interface DeepSeekApiResponse {
  id?: string;
  choices?: DeepSeekChoice[];
  usage?: DeepSeekUsage;
  model?: string;
}

@Injectable()
export class DeepSeekLlmProvider implements LlmProvider {
  private readonly logger = new Logger(DeepSeekLlmProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.deepseek.com',
    private readonly modelName = 'deepseek-flash',
  ) {}

  async generateAnswer(params: GenerateAnswerParams): Promise<GenerateAnswerResult> {
    const { messages, evidence, temperature = 0.2, maxTokens = 3000 } = params;

    const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelName,
          thinking: { type: 'disabled' },
          messages: messages.map((m: ChatCompletionMessage) => ({
            role: m.role,
            content: m.content,
          })),
          temperature,
          max_tokens: maxTokens,
        }),
        signal: params.signal
          ? AbortSignal.any([controller.signal, params.signal])
          : controller.signal,
      });

      if (!response.ok) {
        const status = response.status;
        this.logger.error(`DeepSeek API returned HTTP status ${status}`);
        throw new Error(`DeepSeek API request failed with status ${status}`);
      }

      const data = (await response.json()) as DeepSeekApiResponse;
      const content = data.choices?.[0]?.message?.content || '';
      if (!content.trim() || data.choices?.[0]?.finish_reason === 'length') {
        throw new ServiceUnavailableException({
          code: 'AI_OUTPUT_TRUNCATED',
          message: 'AI could not complete its answer. Please retry with a shorter question.',
        });
      }

      const citations = this.extractCitations(content, evidence);

      return {
        content,
        citations,
        modelName: data.model || this.modelName,
        promptTokens: data.usage?.prompt_tokens ?? Math.ceil(content.length / 4),
        completionTokens: data.usage?.completion_tokens ?? Math.ceil(content.length / 4),
      };
    } catch (error: unknown) {
      if (params.signal?.aborted)
        throw new ServiceUnavailableException({
          code: 'AI_DEADLINE_EXCEEDED',
          message: 'The bounded answer-validation deadline expired.',
        });
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.error('DeepSeek API request timed out after 60s');
        throw new Error('DeepSeek API request timed out', { cause: error });
      }
      this.logger.error(
        `DeepSeek API error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async generateStructuredOutput<T>(
    params: GenerateStructuredOutputParams,
  ): Promise<GenerateStructuredOutputResult<T>> {
    const {
      systemPrompt,
      userPrompt,
      schemaDescription,
      temperature = 0.1,
      maxTokens = 6000,
    } = params;

    const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const fullSystemPrompt = schemaDescription
      ? `${systemPrompt}\n\nYou must respond strictly with valid JSON matching this schema:\n${schemaDescription}`
      : `${systemPrompt}\n\nYou must respond strictly with a valid JSON object.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: [
            { role: 'system', content: fullSystemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
          temperature,
          max_tokens: maxTokens,
        }),
        signal: params.signal
          ? AbortSignal.any([controller.signal, params.signal])
          : controller.signal,
      });

      if (!response.ok) {
        const status = response.status;
        this.logger.error(`DeepSeek API returned HTTP status ${status} during structured output`);
        throw new Error(`DeepSeek API request failed with status ${status}`);
      }

      const resData = (await response.json()) as DeepSeekApiResponse;
      if (resData.choices?.[0]?.finish_reason === 'length') {
        throw new ServiceUnavailableException({
          code: 'AI_OUTPUT_TRUNCATED',
          message:
            'AI output exceeded its limit. Retry with shorter input or fewer requested items.',
        });
      }
      const rawJson = resData.choices?.[0]?.message?.content || '{}';

      let parsed: T;
      try {
        parsed = JSON.parse(rawJson) as T;
      } catch (error: unknown) {
        this.logger.error('AI_OUTPUT_INVALID_JSON');
        throw new ServiceUnavailableException(
          {
            code: 'AI_OUTPUT_INVALID_JSON',
            message:
              'AI returned an incomplete or invalid draft. No records were created. Please retry.',
          },
          { cause: error },
        );
      }

      return {
        data: parsed,
        rawJson,
        modelName: resData.model || this.modelName,
        promptTokens: resData.usage?.prompt_tokens ?? Math.ceil(fullSystemPrompt.length / 4),
        completionTokens: resData.usage?.completion_tokens ?? Math.ceil(rawJson.length / 4),
      };
    } catch (error: unknown) {
      if (params.signal?.aborted)
        throw new ServiceUnavailableException({
          code: 'AI_DEADLINE_EXCEEDED',
          message: 'The bounded answer-validation deadline expired.',
        });
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.error('DeepSeek API request timed out after 45s during structured output');
        throw new Error('DeepSeek API request timed out', { cause: error });
      }
      this.logger.error(
        `DeepSeek structured output error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractCitations(
    content: string,
    evidence: GenerateAnswerParams['evidence'],
  ): CitationItem[] {
    if (!evidence || evidence.length === 0) {
      return [];
    }

    const citationMap = new Map<string, CitationItem>();
    const regex = /(?:\[Evidence\s*#?(\d+)\]|Evidence\s*#(\d+))/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const indexStr = match[1] || match[2] || '';
      const index = parseInt(indexStr, 10);
      if (index >= 1 && index <= evidence.length) {
        const item = evidence[index - 1]!;
        if (!citationMap.has(item.chunkId)) {
          citationMap.set(item.chunkId, {
            chunkId: item.chunkId,
            sourceId: item.sourceId,
            sourceType: item.sourceType,
            title: item.title,
            revision: item.revision,
            locator: item.locator,
            score: item.score,
            snippet: item.snippet,
          });
        }
      }
    }

    return Array.from(citationMap.values());
  }
}
