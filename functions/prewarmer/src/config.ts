export interface Target {
  service: string;
  warmMinimum: number;
}

export interface Config {
  projectId: string;
  region: string;
  tasksQueue: string;
  selfUrl: string;
  tasksInvokerServiceAccount: string;
  targets: Target[];
  baselineMinInstances: number;
  leadSeconds: number;
  holdSeconds: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

// TARGET_SERVICES=aforo-gateway:1,aforo-queue:1
export function parseTargets(raw: string): Target[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [service, minimum] = item.split(":");
      const warmMinimum = Number(minimum);
      if (!service || !Number.isInteger(warmMinimum) || warmMinimum < 0) {
        throw new Error(`TARGET_SERVICES entry "${item}" must be <service>:<minimum>`);
      }
      return { service, warmMinimum };
    });
}

export function loadConfig(env = process.env): Config {
  return {
    projectId: required(env, "GCP_PROJECT_ID"),
    region: required(env, "GCP_REGION"),
    tasksQueue: required(env, "TASKS_QUEUE"),
    selfUrl: required(env, "SELF_URL").replace(/\/$/, ""),
    tasksInvokerServiceAccount: required(env, "TASKS_INVOKER_SERVICE_ACCOUNT"),
    targets: parseTargets(required(env, "TARGET_SERVICES")),
    baselineMinInstances: integer(env, "BASELINE_MIN_INSTANCES", 0),
    leadSeconds: integer(env, "PREWARM_LEAD_SECONDS", 600),
    holdSeconds: integer(env, "PREWARM_HOLD_SECONDS", 3600),
  };
}
