// Redis keys (services/queue/README.md). Built here so no other file concatenates a key by hand.
export const queueKey = (eventId: string) => `queue:${eventId}`;
export const admittedKey = (eventId: string, userId: string) => `admitted:${eventId}:${userId}`;
export const admittedPrefix = (eventId: string) => `admitted:${eventId}:`;
export const eventKey = (eventId: string) => `event:${eventId}`;
export const inboxKey = (messageId: string) => `inbox:${messageId}`;
export const admissionLockKey = (eventId: string, tick: number) => `admission:${eventId}:${tick}`;

// Each script runs as one unit: Redis executes nothing else while it runs. They exist because the
// move between "in the queue" and "has a pass" is two keys, and two separate commands leave a gap:
//  - join as GET (no pass) then ZADD: an admission in between pops the user and gives them a pass,
//    and the ZADD then puts them back in the queue too (admitted AND waiting).
//  - status as GET (no pass) then ZRANK: an admission in between leaves both empty, and a buyer who
//    was just admitted gets a 404.
//  - admit as ZPOPMIN then SET: a crash in between takes users out of the queue without a pass.
// The pass key is not declared in KEYS for admit because its name depends on the popped users; this
// is valid on a single Redis node (Memorystore basic, local), not on Redis Cluster.

/**
 * KEYS[1] queue:{eventId}, KEYS[2] admitted:{eventId}:{userId}
 * ARGV[1] userId, ARGV[2] score, ARGV[3] "1" when the sale is open.
 * Admitted wins over everything: a buyer with a pass gets it back even if the sale just closed.
 */
export const JOIN_LUA = `
local pass = redis.call('GET', KEYS[2])
if pass then return {'ADMITTED', pass} end
if ARGV[3] ~= '1' then return {'NOT_OPEN'} end
redis.call('ZADD', KEYS[1], 'NX', ARGV[2], ARGV[1])
return {'WAITING', redis.call('ZRANK', KEYS[1], ARGV[1]) + 1}
`;

/** KEYS[1] queue:{eventId}, KEYS[2] admitted:{eventId}:{userId}; ARGV[1] userId. */
export const STATUS_LUA = `
local pass = redis.call('GET', KEYS[2])
if pass then return {'ADMITTED', pass} end
local rank = redis.call('ZRANK', KEYS[1], ARGV[1])
if rank then return {'WAITING', rank + 1} end
return {'NONE'}
`;

/**
 * KEYS[1] queue:{eventId}
 * ARGV[1] batch size, ARGV[2] pass TTL in seconds, ARGV[3] pass expiry in epoch ms,
 * ARGV[4] pass key prefix "admitted:{eventId}:", ARGV[5..] one fresh token per slot of the batch.
 * Pops the first `batch` members and gives each a pass. Returns the admitted user ids.
 */
export const ADMIT_LUA = `
local popped = redis.call('ZPOPMIN', KEYS[1], ARGV[1])
local users = {}
for i = 1, #popped, 2 do
  local user = popped[i]
  local token = ARGV[4 + (i + 1) / 2]
  redis.call('SET', ARGV[4] .. user, ARGV[3] .. ':' .. token, 'EX', ARGV[2])
  users[#users + 1] = user
end
return users
`;

export type JoinReply = ["ADMITTED", string] | ["NOT_OPEN"] | ["WAITING", number];
export type StatusReply = ["ADMITTED", string] | ["WAITING", number] | ["NONE"];

/** The scripts as methods of the ioredis client (registered with defineCommand in RedisService). */
export interface QueueScripts {
  queueJoin(queueKey: string, admittedKey: string, userId: string, score: number, open: string): Promise<JoinReply>;
  queueStatus(queueKey: string, admittedKey: string, userId: string): Promise<StatusReply>;
  queueAdmit(queueKey: string, ...args: Array<string | number>): Promise<string[]>;
}
