import { describe, expect, it } from 'vitest';
import { createSseParser, type SseMessage } from '@/lib/sse';

const collect = () => {
  const messages: SseMessage[] = [];
  return { messages, feed: createSseParser((m) => messages.push(m)) };
};

describe('createSseParser', () => {
  it('parses the position and admitted events of the queue contract', () => {
    const { messages, feed } = collect();
    feed('event: position\ndata: {"state":"WAITING","position":12}\n\n');
    feed('event: admitted\ndata: {"state":"ADMITTED","position":0}\n\n');
    expect(messages).toEqual([
      { event: 'position', data: '{"state":"WAITING","position":12}' },
      { event: 'admitted', data: '{"state":"ADMITTED","position":0}' },
    ]);
  });

  it('handles a message split across chunks', () => {
    const { messages, feed } = collect();
    feed('event: posi');
    feed('tion\ndata: {"position"');
    feed(':7}\n');
    expect(messages).toEqual([]);
    feed('\n');
    expect(messages).toEqual([{ event: 'position', data: '{"position":7}' }]);
  });

  it('ignores keep-alive comments and uses CRLF line endings', () => {
    const { messages, feed } = collect();
    feed(': keep-alive\r\n\r\nevent: position\r\ndata: 1\r\n\r\n');
    expect(messages).toEqual([{ event: 'position', data: '1' }]);
  });

  it('defaults the event name to "message" and joins multi-line data', () => {
    const { messages, feed } = collect();
    feed('data: a\ndata: b\n\n');
    expect(messages).toEqual([{ event: 'message', data: 'a\nb' }]);
  });
});
