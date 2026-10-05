import { Inject, Injectable } from "@nestjs/common";
import { DomainError, getCorrelationId } from "@aforo/common";
import { ShutdownService } from "@aforo/common/nest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { PassThrough, Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { GatewayConfig } from "../config/gateway-config";

export type QueueOperation = "join" | "status" | "stream";

// contracts/conventions.md: connect 0.5 s and response 2 s by default. fetch has one timer, so the
// whole request gets the sum; for the stream it only covers the wait for the response headers.
const UPSTREAM_TIMEOUT_MS = 2500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Set by SessionAuthGuard on a request whose bearer token was valid. */
type AuthenticatedRequest = FastifyRequest & { user?: { sub: string; email: string } };

/**
 * Forwards the three queue operations to the queue service. It is deliberately not a generic proxy:
 *  - the path is rebuilt from a fixed operation and a UUID, so nobody can aim a request at another
 *    route of the queue (for example /internal/v1/**, which must never be exposed);
 *  - the identity headers are set here from the validated token. Whatever X-User-Id the browser sent
 *    is never copied, otherwise anyone could join the queue as someone else;
 *  - the browser's Authorization header is not forwarded: logic services trust the Gateway's headers
 *    and never see the user token (contracts/conventions.md).
 */
@Injectable()
export class QueueProxyService {
  private readonly streams = new Set<{ controller: AbortController; done: Promise<void> }>();

  constructor(
    @Inject("GATEWAY_CONFIG") private readonly config: GatewayConfig,
    shutdown: ShutdownService,
  ) {
    // An open stream is an in-flight request: end them before the HTTP server stops. The client's
    // stream ends and it falls back to polling `status` (D-13).
    shutdown.onDrain("queue-streams", async () => {
      const open = [...this.streams];
      for (const { controller } of open) controller.abort();
      // Wait until the responses have really finished, not just been told to. Fastify closes the
      // idle connections once, when it starts closing: a connection still writing its last bytes is
      // not idle yet, and would hold the server open until the keep-alive timeout (72 s), far past
      // the ~10 s Cloud Run gives after SIGTERM.
      await Promise.race([Promise.allSettled(open.map(({ done }) => done)), delay(1000)]);
    });
  }

  async forward(operation: QueueOperation, eventId: string, request: AuthenticatedRequest, reply: FastifyReply): Promise<void> {
    if (!UUID.test(eventId)) {
      throw new DomainError("VALIDATION_ERROR", "Request does not match the schema", [
        { field: "eventId", message: "eventId must be a UUID" },
      ]);
    }
    const user = request.user;
    if (!user) throw new DomainError("UNAUTHENTICATED");

    const headers: Record<string, string> = {
      Accept: operation === "stream" ? "text/event-stream" : "application/json",
      "X-User-Id": user.sub,
      "X-User-Email": user.email,
    };
    const correlationId = getCorrelationId();
    if (correlationId) headers["X-Correlation-Id"] = correlationId;
    const queuePass = request.headers["x-queue-pass"];
    if (typeof queuePass === "string") headers["X-Queue-Pass"] = queuePass; // forwarded and logged, never verified (D-07)

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(`${this.config.queueUrl}/api/v1/queue/${eventId}/${operation}`, {
        method: operation === "join" ? "POST" : "GET",
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      throw new DomainError("INTERNAL", "queue service unavailable");
    }

    const contentType = upstream.headers.get("content-type") ?? "application/json";
    if (operation === "stream" && upstream.ok && upstream.body && contentType.startsWith("text/event-stream")) {
      clearTimeout(timer); // from here on there is no response timeout: the stream lasts as long as the wait
      this.pipeStream(upstream.body, controller, reply);
      return;
    }

    try {
      const body = Buffer.from(await upstream.arrayBuffer());
      reply.status(upstream.status).header("content-type", contentType).send(body);
    } catch {
      throw new DomainError("INTERNAL", "queue service unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  private pipeStream(body: unknown, controller: AbortController, reply: FastifyReply): void {
    // Through a PassThrough, so that ending the upstream (or aborting it on shutdown) ends the
    // client's stream cleanly instead of tearing the socket down mid-message.
    const out = new PassThrough();
    const upstream = Readable.fromWeb(body as WebReadableStream);
    upstream.on("error", () => out.end());
    upstream.pipe(out);

    const stream = { controller, done: new Promise<void>((resolve) => reply.raw.once("close", resolve)) };
    this.streams.add(stream);
    // The response is over (the client left, or the stream ended): stop reading from the queue service.
    void stream.done.then(() => {
      this.streams.delete(stream);
      controller.abort();
    });

    reply
      .status(200)
      .header("content-type", "text/event-stream")
      .header("cache-control", "no-cache, no-transform")
      .header("x-accel-buffering", "no") // do not let a proxy in front buffer the stream
      .send(out);
  }
}
