/**
 * Single import point for the framework-agnostic core of @aforo/common (owner: Juan Jose).
 * The package has no code yet: names are ASSUMED from packages/common/README.md.
 *  - createLogger({ level }) -> { log(entry), warn(entry), error(entry) } writing one JSON line
 *    with `severity` and `correlationId` when present in the entry.
 */
export { createLogger } from '@aforo/common';
export type { Logger } from '@aforo/common';
