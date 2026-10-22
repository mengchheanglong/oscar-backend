import { ServiceUnavailableException } from '@nestjs/common';
import {
  LlmProvider,
  GenerateAnswerResult,
  GenerateStructuredOutputResult,
} from './llm-provider.interface';

export class UnavailableLlmProvider implements LlmProvider {
  async generateAnswer(): Promise<GenerateAnswerResult> {
    throw new ServiceUnavailableException('AI generation is not configured.');
  }

  async generateStructuredOutput<T>(): Promise<GenerateStructuredOutputResult<T>> {
    throw new ServiceUnavailableException('AI generation is not configured.');
  }
}
