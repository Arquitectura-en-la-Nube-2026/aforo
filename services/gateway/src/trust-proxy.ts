/**
 * Trusts exactly one proxy hop: the one in front of the Gateway (Cloud Run's front end). Then
 * `request.ip`, the quota key, is the address that proxy appended at the END of X-Forwarded-For.
 *  - With no trustProxy every buyer arrives as the proxy's own address and they all share one quota.
 *  - With `true` every hop is trusted and the FIRST entry is taken, which the client writes: anyone
 *    could dodge the quota by sending a fake X-Forwarded-For.
 *  - It is a function and not the number 1 on purpose. Fastify 5.12 made a numeric trustProxy trust
 *    nothing, while the Fastify 5.11 that @nestjs/platform-fastify bundles counts hops. With the number,
 *    this setting would silently flip the day Nest moves to 5.12 and the quota would collapse into one
 *    shared bucket. The function means the same on both (test/proxy-trust.test.cjs).
 * Trusting the immediate peer unconditionally is right on Cloud Run, where only Google's front end can
 * reach the container; it would not be if the Gateway were directly exposed.
 */
export const trustOneProxyHop = (_address: string, hop: number): boolean => hop < 1;
