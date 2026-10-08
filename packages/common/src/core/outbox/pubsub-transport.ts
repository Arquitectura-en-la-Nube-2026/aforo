import { MetadataClient } from "../auth/metadata-client";
import { HttpClient } from "../http/http-client";
import type { OutboxTransport } from "./outbox";

export interface PubSubTransportOptions {
  projectId: string;
  /** `host:port` of the Pub/Sub emulator; defaults to PUBSUB_EMULATOR_HOST. No auth is sent to it. */
  emulatorHost?: string;
  metadata?: MetadataClient;
  http?: HttpClient;
}

/**
 * Publishes through the Pub/Sub REST API with the instance's access token, instead of the client
 * library: one HTTPS call per message, no extra dependency or gRPC start-up cost. The service
 * account needs roles/pubsub.publisher on the topic (infra/modules/pubsub-topic).
 */
export class PubSubRestTransport implements OutboxTransport {
  private readonly baseUrl: string;
  private readonly emulator: boolean;
  private readonly metadata: MetadataClient;
  private readonly http: HttpClient;

  constructor(private readonly options: PubSubTransportOptions) {
    if (!options.projectId) throw new Error("PubSubRestTransport needs a projectId");
    const emulatorHost = options.emulatorHost ?? process.env.PUBSUB_EMULATOR_HOST?.trim();
    this.emulator = Boolean(emulatorHost);
    this.baseUrl = emulatorHost ? `http://${emulatorHost}` : "https://pubsub.googleapis.com";
    this.metadata = options.metadata ?? new MetadataClient();
    this.http = options.http ?? new HttpClient({ connectTimeoutMs: 1000, responseTimeoutMs: 5000 });
  }

  async publish(topic: string, data: Buffer, attributes: Record<string, string>): Promise<void> {
    const headers: Record<string, string> = {};
    if (!this.emulator) headers.Authorization = `Bearer ${await this.metadata.accessToken()}`;
    const path = `/v1/projects/${encodeURIComponent(this.options.projectId)}/topics/${encodeURIComponent(topic)}:publish`;
    const response = await this.http.request({
      method: "POST",
      url: `${this.baseUrl}${path}`,
      headers,
      body: { messages: [{ data: data.toString("base64"), attributes }] },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Pub/Sub publish to ${topic} answered ${response.status}`);
    }
  }
}
