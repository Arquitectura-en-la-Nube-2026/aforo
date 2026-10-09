import { Inject, Injectable } from "@nestjs/common";
import { DomainError, StructuredLogger, getCorrelationId } from "@aforo/common";
import { ShutdownService } from "@aforo/common/nest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { PassThrough, Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { ServiceIdentityService } from "../auth/service-identity.service";
import type { GatewayConfig } from "../config/gateway-config";

export type QueueOperation = "join" | "status" | "stream";

// Not the 2.5 s default of contracts/conventions.md: the queue scales to zero after ~15 min idle and a
// cold start took ~3.2 s on dev (NestJS + Redis), so the first join after a pause became a 500 while
// the queue went on to admit the buyer. The prewarmer only keeps it warm inside sales windows (D-21).
// fetch has one timer for the whole request; for the stream it only covers the response headers.
const UPSTREAM_TIMEOUT_MS = 8000;

// The queue's custom ID-token audience (infra/modules/cloud-run-service: "aforo-<name>").
const QUEUE_AUDIENCE = "aforo-queue";

// What the queue itself answers. Anything else did not come from the queue: in the cloud, Google's front
// end answers an IAM rejection with an HTML 403 page.
const JSON_CONTENT = /^application\/(problem\+)?json\b/i;

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
 *    and never see the user token (contracts/conventions.md). In the cloud the Authorization the queue
 *    gets is the Gateway's own Google ID token, which is what lets Cloud Run IAM pass the call.
 */
@Injectable()
export class QueueProxyService {
  private readonly logger = new StructuredLogger(process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "gateway");
  private readonly streams = new Set<{ controller: AbortController; done: Promise<void> }>();

  constructor(
    @Inject("GATEWAY_CONFIG") private readonly config: GatewayConfig,
    private readonly identity: ServiceIdentityService,
    private readonly shutdown: ShutdownService,
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
    // Listened to before anything is awaited: `close` fires once, so a client that leaves while we fetch
    // the ID token or wait for the upstream headers would otherwise go unnoticed and its stream stay open.
    let clientGone = false;
    const done = new Promise<void>((resolve) => reply.raw.once("close", resolve));
    void done.then(() => {
      clientGone = true;
      controller.abort(); // nobody will read the answer: stop asking the queue service for it
    });
    if (operation === "stream") {
      // Known to the drain from the start, not only once the queue's headers arrive: a SIGTERM while
      // this stream waits for them would otherwise run the drain without it, and the stream would then
      // hold the HTTP server open until Cloud Run kills the instance. Aborted, it answers 500 and the
      // client falls back to polling.
      const stream = { controller, done };
      this.streams.add(stream);
      void done.then(() => this.streams.delete(stream));
      // Asked for after the drain already ran: nothing would end it, so do not open it.
      if (this.shutdown.isShuttingDown) controller.abort();
    }

    try {
      const authorization = await this.identity.authorizationFor(QUEUE_AUDIENCE);
      if (authorization) headers.Authorization = authorization;
    } catch (error) {
      if (clientGone) return;
      // Without the token Cloud Run would answer 403 anyway: do not call, say what failed.
      this.logger.write("ERROR", "queue.identity_token_failed", { error: error instanceof Error ? error.message : String(error) });
      throw new DomainError("INTERNAL", "queue service unavailable");
    }

    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(`${this.config.queueUrl}/api/v1/queue/${eventId}/${operation}`, {
        method: operation === "join" ? "POST" : "GET",
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (clientGone) return; // aborted because the client left: there is no one to answer
      this.logger.write("ERROR", "queue.upstream_failed", {
        operation,
        timeoutMs: UPSTREAM_TIMEOUT_MS,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DomainError("INTERNAL", "queue service unavailable");
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (operation === "stream" && upstream.ok && upstream.body && contentType.startsWith("text/event-stream")) {
      clearTimeout(timer); // from here on there is no response timeout: the stream lasts as long as the wait
      this.pipeStream(upstream.body, reply);
      return;
    }
    if (!JSON_CONTENT.test(contentType)) {
      // Not the queue's answer (Google's HTML 403 when IAM rejects the call, a proxy error page...): the
      // browser must still get problem+json with a code. The log keeps what really came back.
      clearTimeout(timer);
      await upstream.body?.cancel().catch(() => undefined);
      this.logger.write("ERROR", "queue.unexpected_answer", { status: upstream.status, contentType });
      throw new DomainError("INTERNAL", "queue service unavailable");
    }

    try {
      const body = Buffer.from(await upstream.arrayBuffer());
      reply.status(upstream.status).header("content-type", contentType).send(body);
    } catch {
      if (clientGone) return;
      throw new DomainError("INTERNAL", "queue service unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  private pipeStream(body: unknown, reply: FastifyReply): void {
    // Through a PassThrough, so that ending the upstream (or aborting it on shutdown) ends the
    // client's stream cleanly instead of tearing the socket down mid-message. The stream is already
    // known to the drain, and the upstream is aborted when the response is over (see forward).
    const out = new PassThrough();
    const upstream = Readable.fromWeb(body as WebReadableStream);
    upstream.on("error", () => out.end());
    upstream.pipe(out);

    reply
      .status(200)
      .header("content-type", "text/event-stream")
      .header("cache-control", "no-cache, no-transform")
      .header("x-accel-buffering", "no") // do not let a proxy in front buffer the stream
      .send(out);
  }
}
