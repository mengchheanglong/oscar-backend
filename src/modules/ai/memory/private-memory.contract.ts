import { createHash } from 'node:crypto';
import { CopilotMemoryKind } from '../entities/copilot-memory.entity';

export interface PrivateMemoryScope {
  projectId: string;
  userId: string;
}
export interface PrivateMemoryResult {
  id: string;
  kind: CopilotMemoryKind;
  content: string;
  version: number;
}
export interface MemoryEmbeddingProvider {
  readonly identity: string;
  embed(texts: string[]): Promise<number[][]>;
}
export const MEMORY_DIMENSIONS = 1536;
export function embeddingIdentity(namespace: string, model: string): string {
  // Persist a readable, canonical identity, not merely an unrecoverable hash.
  const identity = JSON.stringify([namespace, model, MEMORY_DIMENSIONS, 'raw-v1']);
  if (identity.length > 1000) throw new Error('MEMORY_EMBEDDING_IDENTITY_INVALID');
  return identity;
}
export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
export function validateVectors(vectors: number[][], count: number): void {
  if (
    !Array.isArray(vectors) ||
    vectors.length !== count ||
    vectors.some(
      (v) =>
        !Array.isArray(v) ||
        v.length !== MEMORY_DIMENSIONS ||
        v.some((n) => !Number.isFinite(n)) ||
        !v.some((n) => n !== 0),
    )
  ) {
    throw new Error('MEMORY_EMBEDDING_INVALID');
  }
}
