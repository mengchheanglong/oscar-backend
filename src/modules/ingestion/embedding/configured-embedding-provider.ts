import { ConfigService } from '@nestjs/config';
import { OllamaEmbeddingProvider } from './ollama-embedding-provider';

export function localEmbeddingProvider(config: ConfigService): OllamaEmbeddingProvider {
  if (
    config.get<string>('AI_EMBEDDING_MODEL') !== 'qwen3-embedding:0.6b' ||
    config.get<number>('AI_EMBEDDING_DIMENSIONS') !== 1024
  )
    throw new Error('OLLAMA_REQUIRES_QWEN_06B_1024');
  return new OllamaEmbeddingProvider({
    baseUrl: config.get<string>('AI_OLLAMA_BASE_URL', 'http://127.0.0.1:11434'),
    revision: config.get<string>('AI_OLLAMA_MODEL_REVISION', ''),
    queryTimeoutMs: config.get<number>('AI_OLLAMA_QUERY_TIMEOUT_MS', 5000),
    documentTimeoutMs: config.get<number>('AI_OLLAMA_DOCUMENT_TIMEOUT_MS', 120000),
  });
}
