import { scopeCitationMarkers } from '../../src/modules/assistant/context/citation-scope';
import { ChatCompletionMessage } from '../../src/modules/assistant/llm/llm-provider.interface';

it('keeps current evidence numbering but prevents earlier assistant and recalled dialogue markers from rebinding', () => {
  const messages: ChatCompletionMessage[] = [
    { role: 'system', content: '[Evidence #1] MIT marketing, current source' },
    { role: 'user', content: 'Older recalled dialogue: finance [Evidence #1, #2].' },
    {
      role: 'assistant',
      content: 'Earlier finance recommendation [Evidence #1]. Also Evidence #99.',
    },
    { role: 'user', content: 'Compare with my earlier question about Evidence #1.' },
  ];
  const prepared = scopeCitationMarkers(messages);
  expect(prepared[0]).toEqual(messages[0]);
  expect(prepared.at(-1)).toEqual(messages.at(-1));
  expect(prepared[1]!.content).not.toContain('[Evidence');
  expect(prepared[2]!.content).not.toContain('Evidence #');
  expect(prepared[2]!.content).toContain('Earlier finance recommendation');
  expect(messages[2]!.content).toContain('[Evidence #1]'); // Saved history is untouched.
});
