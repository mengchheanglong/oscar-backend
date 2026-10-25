import { ChatCompletionMessage } from '../llm/llm-provider.interface';

/** Historical evidence numbers belong to their original turn, not today's table. */
export function scopeCitationMarkers(
  messages: readonly ChatCompletionMessage[],
): ChatCompletionMessage[] {
  return messages.map((message, index) => {
    if (message.role === 'system' || index === messages.length - 1) return message;
    return {
      ...message,
      content: message.content.replace(
        /\[Evidence\s*#?\d+[^\]\n]{0,80}\]|\bEvidence\s*#\d+\b/gi,
        '',
      ),
    };
  });
}
