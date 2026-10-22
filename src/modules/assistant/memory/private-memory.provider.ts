import { ConfigService } from '@nestjs/config';
import { OpenAiEmbeddingProvider } from '../../ingestion/embedding/openai-embedding-provider';
import {
  embeddingIdentity,
  MEMORY_DIMENSIONS,
  MemoryEmbeddingProvider,
} from './private-memory.contract';

export function memoryEmbedder(config: ConfigService): MemoryEmbeddingProvider | null {
  if (config.get<string>('AI_EMBEDDING_PROVIDER') !== 'openai') return null;
  const apiKey = config.get<string>('OPENAI_API_KEY');
  if (!apiKey) return null;
  if (config.get<number>('AI_EMBEDDING_DIMENSIONS', 1536) !== MEMORY_DIMENSIONS)
    throw new Error('MEMORY_EMBEDDING_DIMENSIONS_REQUIRE_MIGRATION');
  const modelName = config.get<string>('AI_EMBEDDING_MODEL', 'text-embedding-3-small');
  const baseUrl = config
    .get<string>('OPENAI_EMBEDDING_BASE_URL', 'https://api.openai.com/v1')
    .replace(/\/+$/, '');
  const provider = new OpenAiEmbeddingProvider({
    apiKey,
    modelName,
    baseUrl,
    dimensions: MEMORY_DIMENSIONS,
  });
  return {
    identity: embeddingIdentity(baseUrl, modelName),
    embed: (texts) => provider.embed(texts),
  };
}
