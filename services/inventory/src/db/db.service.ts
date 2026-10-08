import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { HealthService } from "@aforo/common/nest";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import type { InventoryConfig } from "../config/inventory-config";

export const INVENTORY_CONFIG = Symbol("INVENTORY_CONFIG");

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
}

/**
 * Lazy pool: nothing connects until the first query, so the service boots without its DB
 * (ADR-0004). The pool waits up to 5 s for a free connection instead of opening more (ADR-0005):
 * instances × DB_POOL_MAX is the aggregate concurrency limit of E-02.
 */
@Injectable()
export class DbService implements Queryable, OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(@Inject(INVENTORY_CONFIG) config: InventoryConfig, health: HealthService) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.dbPoolMax,
      connectionTimeoutMillis: 5000,
    });
    this.pool.on("error", () => undefined);
    health.register("database", () => this.ping());
  }

  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, params);
  }

  /** Commits when `work` resolves, rolls back when it throws (and rethrows). */
  async tx<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    let broken: Error | undefined;
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      // A connection that cannot even roll back is discarded instead of returned to the pool.
      await client.query("ROLLBACK").catch((rollbackError: Error) => {
        broken = rollbackError;
      });
      throw error;
    } finally {
      client.release(broken);
    }
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
