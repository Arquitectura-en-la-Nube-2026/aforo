import { Inject, Injectable } from "@nestjs/common";
import type { GatewayConfig } from "../config/gateway-config";

// ID tokens last one hour. Reusing one for 50 minutes leaves a margin for clock skew and slow calls.
const TOKEN_REUSE_MS = 50 * 60 * 1000;
const METADATA_TIMEOUT_MS = 1000;

/**
 * Google OIDC ID tokens for the Gateway's calls to private services (contracts/conventions.md,
 * "Service-to-service calls"). In `dev` on GCP, private Catalog and Queue accept the Gateway's
 * service account (infra/envs/dev/services.tf). Cloud Run checks the token before the request
 * reaches either service.
 *
 * - AUTH_MODE=cloud (set by Terraform): the token comes from the instance's metadata server, for the
 *   target's custom audience `aforo-<service>` (infra/modules/cloud-run-service). That audience is
 *   accepted on every URL of the service, and it is the one Pub/Sub and the CI smoke test use too.
 * - AUTH_MODE=dev (local): no token, a local service does not check one.
 *
 * At the opening of a sale hundreds of buyers arrive at once: they share one fetch, not one each.
 */
@Injectable()
export class ServiceIdentityService {
  private readonly tokens = new Map<string, { token: Promise<string>; reuseUntil: number }>();

  constructor(@Inject("GATEWAY_CONFIG") private readonly config: Pick<GatewayConfig, "authMode" | "metadataHost">) {}

  /** The Authorization header for a call to the service with this audience, or null when running locally. */
  async authorizationFor(audience: string, now = Date.now()): Promise<string | null> {
    if (this.config.authMode !== "cloud") return null;
    let entry = this.tokens.get(audience);
    if (!entry || entry.reuseUntil <= now) {
      const token = this.fetchToken(audience);
      const fresh = { token, reuseUntil: now + TOKEN_REUSE_MS };
      // A failed fetch must not be reused for 50 minutes: forget it, so the next call asks again.
      token.catch(() => {
        if (this.tokens.get(audience) === fresh) this.tokens.delete(audience);
      });
      this.tokens.set(audience, fresh);
      entry = fresh;
    }
    return `Bearer ${await entry.token}`;
  }

  private async fetchToken(audience: string): Promise<string> {
    const url =
      `http://${this.config.metadataHost}/computeMetadata/v1/instance/service-accounts/default/identity` +
      `?audience=${encodeURIComponent(audience)}`;
    const response = await fetch(url, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`metadata server answered ${response.status}`);
    const token = (await response.text()).trim();
    if (!token) throw new Error("metadata server returned an empty token");
    return token;
  }
}
