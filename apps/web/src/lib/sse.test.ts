import { describe, expect, it, vi } from 'vitest';
import { createSseParser, readSse, type SseMessage } from '@/lib/sse';

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

  it('does not lose a message when a CRLF is split between two chunks', () => {
    // The chunk ends in the middle of a CRLF. Taking the lone CR as a complete line ending made the
    // next chunk's LF an empty line: it dispatched a message with no data and reset `event` to
    // "message", so the admission arrived as event "message" and the screen ignored it.
    const { messages, feed } = collect();
    feed('event: admitted\r');
    feed('\ndata: {"state":"ADMITTED"}\r\n\r\n');
    expect(messages).toEqual([{ event: 'admitted', data: '{"state":"ADMITTED"}' }]);
  });

  it('handles the blank line that ends a message being split between its CR and LF', () => {
    const { messages, feed } = collect();
    feed('event: position\r\ndata: 5\r\n\r');
    expect(messages).toEqual([]);
    feed('\n');
    expect(messages).toEqual([{ event: 'position', data: '5' }]);
  });

  it('still accepts a bare CR as a line ending once something follows it', () => {
    const { messages, feed } = collect();
    feed('event: position\rdata: 9\r\r');
    feed('event: position\rdata: 8\r\r');
    expect(messages.map((m) => m.data)).toEqual(['9']);
    feed(': keep-alive\n');
    expect(messages.map((m) => m.data)).toEqual(['9', '8']);
  });

  it('delivers every message when the text arrives one character at a time', () => {
    const text =
      ': keep-alive\r\n\r\nevent: position\r\ndata: {"position":3}\r\n\r\nevent: admitted\r\ndata: {"position":0}\r\n\r\n';
    const { messages, feed } = collect();
    for (const character of text) feed(character);
    expect(messages).toEqual([
      { event: 'position', data: '{"position":3}' },
      { event: 'admitted', data: '{"position":0}' },
    ]);
  });

  it('defaults the event name to "message" and joins multi-line data', () => {
    const { messages, feed } = collect();
    feed('data: a\ndata: b\n\n');
    expect(messages).toEqual([{ event: 'message', data: 'a\nb' }]);
  });
});

function streamOf(chunks: string[], { stayOpen = false }: { stayOpen?: boolean } = {}) {
  const encoder = new TextEncoder();
  const cancel = vi.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(encoder.encode(chunks[index++]));
      else if (!stayOpen) controller.close();
      // stayOpen: say nothing more, like a stream the server keeps open.
    },
    cancel,
  });
  return { response: new Response(body), cancel };
}

describe('readSse', () => {
  it('delivers each message and returns when the server ends the stream', async () => {
    const { response } = streamOf(['event: position\ndata: 1\n\n', 'event: admitted\ndata: 2\n\n']);
    const seen: SseMessage[] = [];
    await readSse(response, (message) => seen.push(message));
    expect(seen.map((m) => m.event)).toEqual(['position', 'admitted']);
  });

  it('releases the stream when the message handler throws, instead of leaving it open', async () => {
    // A handler that throws (for example JSON.parse of `data: {`) used to leave the reader locked and
    // the connection open until the page was closed, while the screen moved on to polling.
    const { response, cancel } = streamOf(['event: position\ndata: {\n\n'], { stayOpen: true });
    await expect(
      readSse(response, () => {
        throw new Error('bad message');
      }),
    ).rejects.toThrow('bad message');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('consumes the whole body when the server ends the stream', async () => {
    const { response } = streamOf(['event: position\ndata: 1\n\n']);
    await readSse(response, () => undefined);
    expect(response.bodyUsed).toBe(true);
  });
});
