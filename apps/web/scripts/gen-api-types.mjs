// Generates TypeScript types from the OpenAPI contracts. Never hand-write response types.
// Usage: npm run gen:api --workspace @aforo/web
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const out = join(root, 'apps', 'web', 'src', 'api', 'generated');
mkdirSync(out, { recursive: true });

// Only the contracts the browser talks to.
for (const name of ['gateway', 'catalog', 'queue', 'orders', 'inventory']) {
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules', 'openapi-typescript', 'bin', 'cli.js'),
      join(root, 'contracts', 'openapi', `${name}.yaml`),
      '-o',
      join(out, `${name}.d.ts`),
    ],
    { stdio: 'inherit' },
  );
}
