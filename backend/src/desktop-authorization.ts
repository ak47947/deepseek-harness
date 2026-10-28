/** One-use, PKCE-bound browser approval; Better Auth owns independent desktop sessions and expiry. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api'
import { z } from 'zod'
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
const storedCode = storedRequest.extend({ userId: z.string().min(1).transform(value => value as EnterpriseUserId) })
const hash = (value: string): string => createHash('sha256').update(value).digest('base64url')

/**
 * Register browser approval and token exchange without exposing session tokens to browser URLs.
 * @param config - Deployment origin and authorization lifetime.
 * @returns Better Auth endpoints backed by its atomic verification-record consumption.
 */
export function enterpriseDesktopAuthorization(config: EnterpriseConfig) {
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
        const record = await ctx.context.internalAdapter.consumeVerificationValue(`enterprise-desktop-request:${hash(ctx.body.authorizeId)}`)
        if (record === null || record.expiresAt.getTime() <= Date.now()) throw new APIError('BAD_REQUEST', { message: 'Authorization expired. Return to the application and retry.' })
        const request = storedRequest.parse(JSON.parse(record.value))
        if (request.expiresAt <= Date.now()) throw new APIError('BAD_REQUEST', { message: 'Authorization expired. Return to the application and retry.' })
        const code = randomBytes(32).toString('base64url') as EnterpriseAuthorizationCode
        await ctx.context.internalAdapter.createVerificationValue({
          identifier: `enterprise-desktop-code:${hash(code)}`,
          value: JSON.stringify({ ...request, userId: ctx.context.session.user.id }), expiresAt: new Date(request.expiresAt),
        })
        const callback = new URL(request.callbackUrl)
        callback.searchParams.set('code', code)
        callback.searchParams.set('state', request.state)
        return ctx.json({ callbackUrl: callback.href })
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
