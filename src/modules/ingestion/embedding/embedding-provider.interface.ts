export interface EmbeddingResult {
  embedding: number[];
  tokenCount?: number;
}

export interface EmbeddingProvider {
  readonly dimensions: number;
  readonly modelName: string;
  readonly identity?: string;
  embedQuery?(texts: string[]): Promise<number[][]>;
  embed(texts: string[]): Promise<number[][]>;
}
