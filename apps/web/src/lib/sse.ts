// Minimal Server-Sent Events reader over fetch. The browser's EventSource cannot send an
// `Authorization` header, and the queue stream is authenticated with a bearer token
// (contracts/openapi/queue.yaml), so we read the stream ourselves.

export interface SseMessage {
  event: string;
  data: string;
}

/** Incremental parser: feed text chunks, get complete messages. */
export function createSseParser(onMessage: (message: SseMessage) => void) {
  let buffer = '';
  let event = 'message';
  let data: string[] = [];

  const dispatch = () => {
    if (data.length > 0) onMessage({ event, data: data.join('\n') });
    event = 'message';
    data = [];
  };

  return (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r\n|\n|\r/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line === '') dispatch();
      else if (line.startsWith(':'))
        continue; // comment / keep-alive
      else {
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }
    }
  };
}

/** Reads a streaming response until it ends or the signal aborts. */
export async function readSse(
  response: Response,
  onMessage: (message: SseMessage) => void,
): Promise<void> {
  if (!response.body) throw new Error('Response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const feed = createSseParser(onMessage);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    feed(decoder.decode(value, { stream: true }));
  }
}
