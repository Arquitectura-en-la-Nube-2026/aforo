// Thin REST clients for Cloud Tasks and the Cloud Run Admin API. No SDK clients (cold start):
// one GoogleAuth created lazily in module scope and reused by warm invocations.
import { GoogleAuth } from "google-auth-library";
import type { Config } from "./config.ts";

let auth: GoogleAuth | undefined;
const client = () =>
  (auth ??= new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] })).getClient();

export class TransientError extends Error {}

async function call<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: T }> {
  const c = await client();
  try {
    const res = await c.request<T>({
      url,
      method: (init.method ?? "GET") as "GET",
      data: init.body,
      timeout: 10_000,
      validateStatus: () => true,
    });
    if (res.status >= 500 || res.status === 429) throw new TransientError(`${url} answered ${res.status}`);
    return { status: res.status, data: res.data };
  } catch (error) {
    if (error instanceof TransientError) throw error;
    throw new TransientError(`${url} failed: ${(error as Error).message}`);
  }
}

export interface Gcp {
  /** Creates a named task; false when it already exists (dedup). */
  createTask(taskId: string, at: Date, path: string, body: unknown, correlationId: string): Promise<boolean>;
  /** Ids (last path segment) of every pending task in the queue. */
  listTaskIds(): Promise<string[]>;
  getMinInstances(service: string): Promise<number>;
  setMinInstances(service: string, value: number): Promise<void>;
}

export function createGcp(config: Config): Gcp {
  const queue = `https://cloudtasks.googleapis.com/v2/projects/${config.projectId}/locations/${config.region}/queues/${config.tasksQueue}`;
  const runService = (name: string) =>
    `https://run.googleapis.com/v2/projects/${config.projectId}/locations/${config.region}/services/${name}`;

  return {
    async createTask(taskId, at, path, body, correlationId) {
      const name = `projects/${config.projectId}/locations/${config.region}/queues/${config.tasksQueue}/tasks/${taskId}`;
      const { status, data } = await call(`${queue}/tasks`, {
        method: "POST",
        body: {
          task: {
            name,
            scheduleTime: at.toISOString(),
            httpRequest: {
              url: `${config.selfUrl}${path}`,
              httpMethod: "POST",
              headers: { "Content-Type": "application/json", "X-Correlation-Id": correlationId },
              body: Buffer.from(JSON.stringify(body)).toString("base64"),
              oidcToken: { serviceAccountEmail: config.tasksInvokerServiceAccount, audience: config.selfUrl },
            },
          },
        },
      });
      if (status === 409) return false; // ALREADY_EXISTS: same window already scheduled
      if (status >= 400) throw new Error(`createTask ${taskId}: ${status} ${JSON.stringify(data)}`);
      return true;
    },

    async listTaskIds() {
      const ids: string[] = [];
      let pageToken = "";
      do {
        const { status, data } = await call<{ tasks?: { name: string }[]; nextPageToken?: string }>(
          `${queue}/tasks?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
        );
        if (status >= 400) throw new Error(`listTasks: ${status}`);
        for (const task of data.tasks ?? []) ids.push(task.name.split("/").pop() ?? "");
        pageToken = data.nextPageToken ?? "";
      } while (pageToken);
      return ids;
    },

    async getMinInstances(service) {
      const { status, data } = await call<{ scaling?: { minInstanceCount?: number } }>(runService(service));
      if (status >= 400) throw new Error(`get ${service}: ${status}`);
      return data.scaling?.minInstanceCount ?? 0;
    },

    // Service-level scaling: no new revision. updateMask keeps every other field as it is.
    async setMinInstances(service, value) {
      const { status, data } = await call(`${runService(service)}?updateMask=scaling.minInstanceCount`, {
        method: "PATCH",
        body: { scaling: { minInstanceCount: value } },
      });
      if (status >= 400) throw new Error(`update ${service}: ${status} ${JSON.stringify(data)}`);
    },
  };
}
