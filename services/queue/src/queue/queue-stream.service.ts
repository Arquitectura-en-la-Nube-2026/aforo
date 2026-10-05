import { Inject, Injectable } from "@nestjs/common";
import { ShutdownService } from "@aforo/common/nest";
import type { FastifyReply } from "fastify";
import type { QueueConfig } from "../config/queue-config";
import { QUEUE_CONFIG } from "../redis/redis.service";
import { QueueService } from "./queue.service";
import type { QueueStatus } from "./queue-status";

// How often each open stream reads its state from Redis. 250 streams per instance (Cloud Run
// concurrency) are about 250 small script calls per second.
export const STREAM_POLL_MS = 1000;

/**
 * Server-Sent Events for one buyer: `event: position` whenever the position changes and
 * `event: admitted` once, after which the server closes the stream.
 *
 * Why every stream reads Redis instead of waiting for a push: the admission runs on whichever
 * instance wins the tick lock, which is often not the instance this buyer is connected to. A stream
 * that only listened locally would send keep-alives forever and never announce the admission. The
 * first message is a snapshot of the current state, so an admission that happened between `join`
 * and opening the stream is not missed either.
 */
@Injectable()
export class QueueStreamService {
  private readonly open = new Set<() => void>();

  constructor(
    @Inject(QUEUE_CONFIG) private readonly config: QueueConfig,
    private readonly queue: QueueService,
    shutdown: ShutdownService,
  ) {
    // An open stream is an in-flight request: close them first or the HTTP server waits for them.
    shutdown.onDrain("sse-streams", () => {
      for (const close of [...this.open]) close();
    });
  }

  async stream(eventId: string, userId: string, reply: FastifyReply): Promise<void> {
    // Before hijacking, a failure (404 not in the queue, 500 no Redis) is still a normal problem+json.
    const first = await this.queue.status(eventId, userId);

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let closed = false;
    let reading = false;
    let last = "";
    // Declared before use: the timers are cleared from `finish`, which a snapshot can call at once.
    let poll: NodeJS.Timeout | undefined;
    let heartbeat: NodeJS.Timeout | undefined;

    const finish = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
      this.open.delete(finish);
      raw.end();
    };

    const emit = (status: QueueStatus): void => {
      last = `${status.state}:${status.position}`;
      raw.write(`event: ${status.state === "ADMITTED" ? "admitted" : "position"}\ndata: ${JSON.stringify(status)}\n\n`);
      if (status.state === "ADMITTED") finish();
    };

    this.open.add(finish);
    raw.on("close", finish);
    emit(first);
    if (closed) return;

    poll = setInterval(() => {
      if (reading) return; // a slow Redis must not pile up reads
      reading = true;
      this.queue
        .status(eventId, userId)
        .then((status) => {
          if (!closed && `${status.state}:${status.position}` !== last) emit(status);
        })
        // The pass expired, the entry vanished or Redis failed: end the stream. The client falls back
        // to polling `status`, which answers with the real reason (404 or 500).
        .catch(finish)
        .finally(() => {
          reading = false;
        });
    }, STREAM_POLL_MS);
    heartbeat = setInterval(() => raw.write(": keep-alive\n\n"), this.config.sseHeartbeatSeconds * 1000);
  }
}
