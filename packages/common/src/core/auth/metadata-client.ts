const METADATA_TIMEOUT_MS = 1000;
// Google tokens live one hour. Reuse them for most of it, never up to the edge.
const TOKEN_REUSE_MS = 50 * 60 * 1000;
const ACCESS_TOKEN_MARGIN_MS = 60 * 1000;

interface CachedToken {
  value: string;
  expiresAtMs: number;
}

/**
 * Tokens from the instance's metadata server (Cloud Run): Google OIDC ID tokens for calls to private
 * services, and OAuth access tokens for Google APIs such as Pub/Sub. Both are cached per instance.
 * `GCE_METADATA_HOST` points it at a fake server in tests.
 */
export class MetadataClient {
  private readonly idTokens = new Map<string, CachedToken>();
  private accessTokenCache: CachedToken | undefined;
  private readonly host: string;

  constructor(host = process.env.GCE_METADATA_HOST?.trim() || "metadata.google.internal") {
    this.host = host;
  }

  async identityToken(audience: string, now = Date.now()): Promise<string> {
    const cached = this.idTokens.get(audience);
    if (cached && cached.expiresAtMs > now) return cached.value;
    const path = `instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`;
    const value = (await this.get(path)).trim();
    if (!value) throw new Error("metadata server returned an empty identity token");
    this.idTokens.set(audience, { value, expiresAtMs: now + TOKEN_REUSE_MS });
    return value;
  }

  async accessToken(now = Date.now()): Promise<string> {
    if (this.accessTokenCache && this.accessTokenCache.expiresAtMs > now) return this.accessTokenCache.value;
    const body = JSON.parse(await this.get("instance/service-accounts/default/token")) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token) throw new Error("metadata server returned no access token");
    const lifetimeMs = (body.expires_in ?? 0) * 1000 - ACCESS_TOKEN_MARGIN_MS;
    this.accessTokenCache = {
      value: body.access_token,
      expiresAtMs: now + Math.max(lifetimeMs, 0),
    };
    return body.access_token;
  }

  private async get(path: string): Promise<string> {
    const response = await fetch(`http://${this.host}/computeMetadata/v1/${path}`, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`metadata server answered ${response.status}`);
    return response.text();
  }
}
