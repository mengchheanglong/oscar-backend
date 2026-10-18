import { PlainTextExtractor } from '../../src/modules/ingestion/extractors/plain-text-extractor';
import { EntityExtractor } from '../../src/modules/ingestion/extractors/entity-extractor';

describe('TextExtractors', () => {
  describe('PlainTextExtractor', () => {
    const extractor = new PlainTextExtractor();

    it('should support text and markdown MIME types and extensions', () => {
      expect(extractor.supports('text/plain')).toBe(true);
      expect(extractor.supports('text/markdown')).toBe(true);
      expect(extractor.supports('application/octet-stream', 'doc.md')).toBe(true);
      expect(extractor.supports('application/octet-stream', 'notes.txt')).toBe(true);
      expect(extractor.supports('image/png', 'img.png')).toBe(false);
    });

    it('should extract text and markdown headings into sections', async () => {
      const mdContent = `# Section 1\nFirst paragraph.\n\n# Section 2\nSecond paragraph.`;
      const buffer = Buffer.from(mdContent, 'utf-8');

      const result = await extractor.extract(buffer, 'text/markdown', 'readme.md');
      expect(result.text).toBe(mdContent);
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0]!.title).toBe('Section 1');
      expect(result.sections[0]!.content).toContain('First paragraph.');
      expect(result.sections[1]!.title).toBe('Section 2');
      expect(result.sections[1]!.content).toContain('Second paragraph.');
    });
  });

  describe('EntityExtractor', () => {
    const extractor = new EntityExtractor();

    it('should extract structured decision into searchable document', () => {
      const doc = extractor.extractDecision({
        id: '22222222-2222-2222-2222-222222222222',
        title: 'Use DeepSeek V4 Pro for LLM generation',
        category: 'ARCHITECTURE',
        status: 'ACCEPTED',
        context: 'Cost-effective reasoning model required.',
        decision: 'Use DeepSeek V4 Pro through adapter.',
        consequences: 'Embeddings must use separate provider.',
      });

      expect(doc.text).toContain('Use DeepSeek V4 Pro for LLM generation');
      expect(doc.text).toContain('Cost-effective reasoning model required.');
      expect(doc.text).toContain('Embeddings must use separate provider.');
      expect(doc.metadata.sourceType).toBe('DECISION');
    });

    it('should extract structured task into searchable document', () => {
      const doc = extractor.extractTask({
        id: '33333333-3333-3333-3333-333333333333',
        title: 'Implement vector embeddings pipeline',
        description: 'Store embeddings in pgvector table knowledge_chunks.',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        dueDate: '2026-10-01',
      });

      expect(doc.text).toContain('Implement vector embeddings pipeline');
      expect(doc.text).toContain('Store embeddings in pgvector table knowledge_chunks.');
      expect(doc.metadata.sourceType).toBe('TASK');
    });
  });
});
