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
    // A "\r" at the very end may be the first half of a "\r\n". Taking it as a finished line would
    // turn the "\n" of the next chunk into an empty line: that dispatches a message with no data and
    // resets `event` to "message", so an `admitted` arrives as an ignored "message". Hold it back.
    const held = buffer.endsWith('\r') ? '\r' : '';
    const lines = buffer.slice(0, buffer.length - held.length).split(/\r\n|\n|\r/);
    buffer = (lines.pop() ?? '') + held;
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

/**
 * Reads a streaming response until it ends or the signal aborts. However it finishes (the end of the
 * stream, an abort, or `onMessage` throwing) the reader is cancelled, which closes the connection:
 * a handler that threw used to leave it open while the screen moved on to polling.
 */
export async function readSse(
  response: Response,
  onMessage: (message: SseMessage) => void,
): Promise<void> {
  if (!response.body) throw new Error('Response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const feed = createSseParser(onMessage);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      feed(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
