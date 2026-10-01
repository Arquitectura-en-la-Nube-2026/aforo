import * as functions from '@google-cloud/functions-framework';
import { createLogger } from './common';
import { loadConfig } from './config';
import { FirestorePaymentRepository } from './firestore-repository';
import { Deps, handle } from './handler';
import { CloudTasksWebhookScheduler } from './scheduler';

// Lazy, module-scope init: clients are created on the first invocation and reused while warm.
let deps: Deps | undefined;

function getDeps(): Deps {
  if (!deps) {
    const config = loadConfig();
    const logger = createLogger({ level: config.logLevel });
    deps = {
      config,
      repo: new FirestorePaymentRepository(config.gcpProjectId),
      scheduler: new CloudTasksWebhookScheduler(config),
      logger: { log: (entry) => logger.log(entry) },
      fetch,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
    };
  }
  return deps;
}

functions.http('mockPaymentGateway', async (req, res) => {
  const out = await handle(
    {
      method: req.method,
      path: req.path,
      query: Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, typeof v === 'string' ? v : undefined])),
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
      ),
      rawBody: (req as unknown as { rawBody?: Buffer }).rawBody?.toString('utf8') ?? '',
    },
    getDeps(),
  );
  res.status(out.status).set(out.headers).send(out.body ?? '');
});
