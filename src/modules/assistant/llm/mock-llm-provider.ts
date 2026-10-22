import { Injectable } from '@nestjs/common';
import {
  GenerateAnswerParams,
  GenerateAnswerResult,
  GenerateStructuredOutputParams,
  GenerateStructuredOutputResult,
  LlmProvider,
} from './llm-provider.interface';
import { CitationItem } from '../entities/chat-message.entity';
import { Priority } from '../../../common/enums/priority.enum';

const STOP_WORDS = new Set([
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'whose',
  'why',
  'how',
  'the',
  'and',
  'for',
  'with',
  'about',
  'from',
  'into',
  'during',
  'including',
  'until',
  'against',
  'among',
  'throughout',
  'despite',
  'towards',
  'upon',
  'concerning',
  'to',
  'in',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'shall',
  'should',
  'can',
  'could',
  'may',
  'might',
  'must',
  'that',
  'this',
  'these',
  'those',
  'there',
  'their',
  'they',
  'you',
  'your',
  'our',
  'we',
  'any',
  'all',
  'some',
]);

@Injectable()
export class MockLlmProvider implements LlmProvider {
  async generateAnswer(params: GenerateAnswerParams): Promise<GenerateAnswerResult> {
    const { messages, evidence } = params;

    // Estimate prompt tokens
    const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    const promptTokens = Math.max(1, Math.ceil(promptChars / 4));

    // Check for adversarial prompt injection attempts
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    const ADVERSARIAL_PATTERNS = [
      /system\s+override/i,
      /ignore\s+(all\s+)?previous/i,
      /\bdan\b/i,
      /admin\s+command/i,
      /drop\s+table/i,
      /root\s+master\s+encryption\s+key/i,
      /project\s+sec/i,
    ];

    if (ADVERSARIAL_PATTERNS.some((p) => p.test(lastUserMessage))) {
      const content =
        'Based on the current project knowledge, there is insufficient evidence to answer this question.';
      return {
        content,
        citations: [],
        modelName: 'mock-llm',
        promptTokens,
        completionTokens: Math.max(1, Math.ceil(content.length / 4)),
      };
    }

    if (!evidence || evidence.length === 0) {
      const content =
        'Based on the current project knowledge, there is insufficient evidence to answer this question.';
      return {
        content,
        citations: [],
        modelName: 'mock-llm',
        promptTokens,
        completionTokens: Math.max(1, Math.ceil(content.length / 4)),
      };
    }

    // Check relevance: extract keywords from user query
    const queryKeywords = lastUserMessage
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

    // Check for out-of-scope inquiry where evidence lacks key subject terms
    const OUT_OF_SCOPE_TERMS = [
      'telephone',
      'residential',
      'stripe',
      'kubernetes',
      'helm',
      'speech-to-text',
      'microphone',
      'mobile',
      'ios',
      'android',
    ];
    const requestedOutOfScope = OUT_OF_SCOPE_TERMS.some((term) =>
      new RegExp(`\\b${term}\\b`, 'i').test(lastUserMessage),
    );
    if (requestedOutOfScope) {
      const evidenceContainsTerm = evidence.some((item) => {
        const text = `${item.title} ${item.snippet}`.toLowerCase();
        return OUT_OF_SCOPE_TERMS.some(
          (t) =>
            new RegExp(`\\b${t}\\b`, 'i').test(lastUserMessage) &&
            new RegExp(`\\b${t}\\b`, 'i').test(text),
        );
      });
      if (!evidenceContainsTerm) {
        const content =
          'Based on the current project knowledge, there is insufficient evidence to answer this question.';
        return {
          content,
          citations: [],
          modelName: 'mock-llm',
          promptTokens,
          completionTokens: Math.max(1, Math.ceil(content.length / 4)),
        };
      }
    }

    // Filter evidence to those relevant to query keywords using whole-word boundary
    const relevantEvidence =
      queryKeywords.length === 0
        ? evidence
        : evidence.filter((item) => {
            const target = `${item.title} ${item.locator || ''} ${item.snippet}`.toLowerCase();
            return queryKeywords.some((kw) => {
              const regex = new RegExp(`\\b${kw}\\b`, 'i');
              return regex.test(target);
            });
          });

    if (relevantEvidence.length === 0) {
      const content =
        'Based on the current project knowledge, there is insufficient evidence to answer this question.';
      return {
        content,
        citations: [],
        modelName: 'mock-llm',
        promptTokens,
        completionTokens: Math.max(1, Math.ceil(content.length / 4)),
      };
    }

    const citations: CitationItem[] = [];
    const points: string[] = [];

    relevantEvidence.slice(0, 4).forEach((item, index) => {
      const evidenceNum = index + 1;
      const snippetClean = item.snippet.replace(/\s+/g, ' ').trim();
      const shortSnippet =
        snippetClean.length > 120 ? `${snippetClean.slice(0, 117)}...` : snippetClean;

      points.push(
        `- **${item.title}** (${item.locator}): ${shortSnippet} [Evidence #${evidenceNum}]`,
      );

      citations.push({
        chunkId: item.chunkId,
        sourceId: item.sourceId,
        sourceType: item.sourceType,
        title: item.title,
        revision: item.revision,
        locator: item.locator,
        score: item.score,
        snippet: item.snippet,
      });
    });

    const content = `Based on the project documentation, here is what has been determined:\n\n${points.join(
      '\n\n',
    )}\n\nPlease refer to the cited references for complete details.`;

    return {
      content,
      citations,
      modelName: 'mock-llm',
      promptTokens,
      completionTokens: Math.max(1, Math.ceil(content.length / 4)),
    };
  }

  async generateStructuredOutput<T>(
    params: GenerateStructuredOutputParams,
  ): Promise<GenerateStructuredOutputResult<T>> {
    const { systemPrompt, userPrompt } = params;
    const promptTokens = Math.max(1, Math.ceil((systemPrompt.length + userPrompt.length) / 4));

    // Default: Task Proposal generation (e.g. from a decision)
    const reqTitleMatch = userPrompt.match(/(?:Decision|Architectural Decision):\s*([^\n]+)/i);
    const reqTitle = reqTitleMatch ? reqTitleMatch[1]!.trim() : 'Feature Implementation';

    const taskProposal = {
      type: 'CREATE_TASKS',
      items: [
        {
          itemId: 'draft-item-1',
          title: `Implement backend service and endpoints for: ${reqTitle}`,
          description: `Develop business logic, persistence, and REST API controller for ${reqTitle}.`,
          priority: Priority.HIGH,
          assigneeId: null,
          dueDate: null,
          sourceIds: [],
        },
        {
          itemId: 'draft-item-2',
          title: `Build frontend components and forms for: ${reqTitle}`,
          description: `Connect UI views, state management, and user interaction for ${reqTitle}.`,
          priority: Priority.MEDIUM,
          assigneeId: null,
          dueDate: null,
          sourceIds: [],
        },
        {
          itemId: 'draft-item-3',
          title: `Add automated regression tests for: ${reqTitle}`,
          description: `Write unit and end-to-end test suites verifying ${reqTitle}.`,
          priority: Priority.MEDIUM,
          assigneeId: null,
          dueDate: null,
          sourceIds: [],
        },
      ],
    };

    const rawJson = JSON.stringify(taskProposal, null, 2);
    return {
      data: taskProposal as unknown as T,
      rawJson,
      modelName: 'mock-llm',
      promptTokens,
      completionTokens: Math.max(1, Math.ceil(rawJson.length / 4)),
    };
  }
}
