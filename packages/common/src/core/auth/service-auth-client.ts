import { MetadataClient } from "./metadata-client";

export type AuthMode = "dev" | "cloud";

export interface ServiceAuthOptions {
  /** Defaults to AUTH_MODE, then "dev". Terraform sets AUTH_MODE=cloud. */
  mode?: AuthMode;
  metadata?: MetadataClient;
}

/**
 * The `Authorization` header for a call to another private service (contracts/conventions.md,
 * "Service-to-service calls"). Cloud Run checks the token before the request reaches the target.
 *
 * - cloud: a Google OIDC ID token for `audience`. Use the target's custom audience
 *   `aforo-<service>` (infra/modules/cloud-run-service): unlike the URL, it is also valid on the
 *   target's revision tag URLs.
 * - dev: no header; a local service does not check one.
 *
 * The user travels in X-User-Id / X-User-Email, never in this token.
 */
export class ServiceAuthClient {
  private readonly mode: AuthMode;
  private readonly metadata: MetadataClient;

  constructor(options: ServiceAuthOptions = {}) {
    const mode = options.mode ?? (process.env.AUTH_MODE?.trim() || "dev");
    if (mode !== "dev" && mode !== "cloud") throw new Error("AUTH_MODE must be dev or cloud");
    this.mode = mode;
    this.metadata = options.metadata ?? new MetadataClient();
  }

  async header(audience: string): Promise<{ authorization?: string }> {
    if (this.mode === "dev") return {};
    return { authorization: `Bearer ${await this.metadata.identityToken(audience)}` };
  }
}
