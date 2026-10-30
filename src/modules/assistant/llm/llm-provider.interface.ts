import { CitationItem } from '../entities/chat-message.entity';
import { AssistantEvidence as RetrievedEvidence } from '../../knowledge-client/knowledge-evidence';

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateAnswerParams {
  signal?: AbortSignal;
  messages: ChatCompletionMessage[];
  evidence: RetrievedEvidence[];
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateAnswerResult {
  content: string;
  citations: CitationItem[];
  modelName: string;
  promptTokens: number;
  completionTokens: number;
}

export interface GenerateStructuredOutputParams {
  signal?: AbortSignal;
  systemPrompt: string;
  userPrompt: string;
  schemaDescription?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateStructuredOutputResult<T> {
  data: T;
  rawJson: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
}

export interface LlmProvider {
  generateAnswer(params: GenerateAnswerParams): Promise<GenerateAnswerResult>;
  generateStructuredOutput<T>(
    params: GenerateStructuredOutputParams,
  ): Promise<GenerateStructuredOutputResult<T>>;
}
