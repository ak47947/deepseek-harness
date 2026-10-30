/** One-use, PKCE-bound browser approval; Better Auth owns independent desktop sessions and expiry. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api'
import { z } from 'zod'
import type { Pool, PoolClient } from 'pg'
import { transaction } from './database.ts'
import type { EnterpriseConfig } from './config.ts'
import type { EnterpriseAuthorizationId, EnterpriseAuthorizationCode, EnterpriseUserId } from './protocol.ts'

const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/u)
const requestSchema = z.object({
  callbackUrl: z.url().refine((value) => {
    const url = new URL(value)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port !== ''
      && url.pathname === '/oauth/callback' && !url.username && !url.password && !url.search && !url.hash
  }, 'Use a loopback callback at /oauth/callback'),
  state: opaque,
  codeChallenge: opaque,
}).strict()
const storedRequest = requestSchema.extend({ expiresAt: z.number().int().positive() })
const storedCode = storedRequest.extend({ userId: z.string().min(1).transform(value => value as EnterpriseUserId), authorizeId: opaque.transform(value => value as EnterpriseAuthorizationId) })
const hash = (value: string): string => createHash('sha256').update(value).digest('base64url')

/**
 * Consume the browser request and mint its one-use code in the caller's transaction.
 * @param client - Transaction holding any associated identity changes.
 * @param authorizeId - Desktop-created request identity.
 * @param userId - Existing employee verified by the authentication owner.
 * @returns Loopback callback carrying only a code and the original desktop state.
 */
export async function issueDesktopCode(client: PoolClient, authorizeId: EnterpriseAuthorizationId, userId: EnterpriseUserId): Promise<string> {
  const user = await client.query<{ banned: boolean }>('SELECT banned FROM "user" WHERE id = $1 FOR NO KEY UPDATE', [userId])
  if (user.rows[0] === undefined || user.rows[0].banned) throw new APIError('FORBIDDEN', { code: 'enterprise_account_unavailable', message: 'Contact your enterprise administrator.' })
  const consumed = await client.query<{ value: string; expiresAt: Date }>('DELETE FROM verification WHERE identifier = $1 AND "expiresAt" > CURRENT_TIMESTAMP RETURNING value, "expiresAt"', [`enterprise-desktop-request:${hash(authorizeId)}`])
  const record = consumed.rows[0]
  if (record === undefined) throw new APIError('BAD_REQUEST', { code: 'enterprise_authorization_expired', message: 'Authorization expired. Return to the application and retry.' })
  const request = storedRequest.parse(JSON.parse(record.value))
  if (request.expiresAt <= Date.now()) throw new APIError('BAD_REQUEST', { code: 'enterprise_authorization_expired', message: 'Authorization expired. Return to the application and retry.' })
  const code = randomBytes(32).toString('base64url') as EnterpriseAuthorizationCode
  await client.query('INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)', [
    randomBytes(32).toString('base64url'), `enterprise-desktop-code:${hash(code)}`, JSON.stringify({ ...request, userId, authorizeId }), record.expiresAt,
  ])
  const callback = new URL(request.callbackUrl)
  callback.searchParams.set('code', code)
  callback.searchParams.set('state', request.state)
  return callback.href
}

/**
 * Register browser approval and token exchange without exposing session tokens to browser URLs.
 * @param config - Deployment origin and authorization lifetime.
 * @param database - Pool for atomic request consumption and code issuance.
 * @returns Better Auth endpoints backed by its atomic verification-record consumption.
 */
export function enterpriseDesktopAuthorization(config: EnterpriseConfig, database: Pool) {
  return {
    id: 'enterprise-desktop-authorization',
    endpoints: {
      createDesktopAuthorization: createAuthEndpoint('/enterprise/desktop/authorize', {
        method: 'POST', body: requestSchema,
      }, async (ctx) => {
        const authorizeId = randomBytes(32).toString('base64url') as EnterpriseAuthorizationId
        const expiresAt = Date.now() + config.DSH_ENTERPRISE_AUTHORIZATION_SECONDS * 1000
        await ctx.context.internalAdapter.createVerificationValue({
          identifier: `enterprise-desktop-request:${hash(authorizeId)}`,
          value: JSON.stringify({ ...ctx.body, expiresAt }), expiresAt: new Date(expiresAt),
        })
        const url = new URL('/dsh/authorize', config.DSH_ENTERPRISE_ORIGIN)
        url.searchParams.set('authorize_id', authorizeId)
        return ctx.json({ authorizeId, authorizeUrl: url.href, expiresAt })
      }),
      approveDesktopAuthorization: createAuthEndpoint('/enterprise/desktop/approve', {
        method: 'POST', body: z.object({ authorizeId: opaque.transform(value => value as EnterpriseAuthorizationId) }).strict(), use: [sessionMiddleware],
      }, async (ctx) => {
        const callbackUrl = await transaction(database, client => issueDesktopCode(client, ctx.body.authorizeId, ctx.context.session.user.id as EnterpriseUserId))
        return ctx.json({ callbackUrl })
      }),
      cancelDesktopAuthorization: createAuthEndpoint('/enterprise/desktop/cancel', {
        method: 'POST', body: z.object({ authorizeId: opaque.transform(value => value as EnterpriseAuthorizationId), codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/u) }).strict(),
      }, async (ctx) => {
        const identifier = `enterprise-desktop-request:${hash(ctx.body.authorizeId)}`
        const record = await ctx.context.internalAdapter.findVerificationValue(identifier)
        if (record !== null) {
          const request = storedRequest.parse(JSON.parse(record.value))
          const received = Buffer.from(hash(ctx.body.codeVerifier))
          const expected = Buffer.from(request.codeChallenge)
          if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new APIError('BAD_REQUEST', { message: 'Authorization could not be verified.' })
          await ctx.context.internalAdapter.consumeVerificationValue(identifier)
        }
        await database.query(`DELETE FROM verification WHERE CASE WHEN identifier LIKE 'enterprise-desktop-code:%'
          THEN value::jsonb ->> 'authorizeId' = $1 AND value::jsonb ->> 'codeChallenge' = $2 ELSE FALSE END`, [ctx.body.authorizeId, hash(ctx.body.codeVerifier)])
        return ctx.json({ ok: true })
      }),
      exchangeDesktopAuthorization: createAuthEndpoint('/enterprise/desktop/token', {
        method: 'POST', body: z.object({ code: opaque.transform(value => value as EnterpriseAuthorizationCode), codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/u) }).strict(),
      }, async (ctx) => {
        const identifier = `enterprise-desktop-code:${hash(ctx.body.code)}`
        const record = await ctx.context.internalAdapter.findVerificationValue(identifier)
        if (record === null || record.expiresAt.getTime() <= Date.now()) throw new APIError('BAD_REQUEST', { message: 'Authorization expired. Return to the application and retry.' })
        const approved = storedCode.parse(JSON.parse(record.value))
        const received = Buffer.from(hash(ctx.body.codeVerifier))
        const expected = Buffer.from(approved.codeChallenge)
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new APIError('BAD_REQUEST', { message: 'Authorization could not be verified.' })
        const consumed = await ctx.context.internalAdapter.consumeVerificationValue(identifier)
        if (consumed === null || consumed.value !== record.value || approved.expiresAt <= Date.now()) throw new APIError('BAD_REQUEST', { message: 'Authorization expired. Return to the application and retry.' })
        const user = await ctx.context.internalAdapter.findUserById(approved.userId)
        if (user === null || ('banned' in user && user.banned === true)) throw new APIError('FORBIDDEN', { message: 'Contact your enterprise administrator.' })
        const session = await ctx.context.internalAdapter.createSession(user.id)
        return ctx.json({ token: session.token })
      }),
    },
  }
}

/**
 * Reject expired or withdrawn Desktop requests before upstream sign-in can change employee records.
 * @param adapter - Authentication adapter for the current endpoint and transaction.
 * @param authorizeId - Desktop-created request identifier.
 * @returns Completion when the request remains pending and unexpired.
 */
export async function requireDesktopAuthorization(adapter: { findVerificationValue(identifier: string): Promise<{ value: string; expiresAt: Date } | null> }, authorizeId: EnterpriseAuthorizationId): Promise<void> {
  const record = await adapter.findVerificationValue(`enterprise-desktop-request:${hash(authorizeId)}`)
  if (record === null || record.expiresAt.getTime() <= Date.now() || storedRequest.parse(JSON.parse(record.value)).expiresAt <= Date.now()) {
    throw new APIError('BAD_REQUEST', { code: 'enterprise_authorization_expired', message: 'Restart sign-in from Desktop.' })
  }
}
