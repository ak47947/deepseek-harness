/** Enterprise OIDC policy and administrator-owned bindings; Better Auth owns the OAuth protocol. */
import { randomUUID } from 'node:crypto'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { BetterAuthOptions } from 'better-auth'
import { APIError, addOAuthServerContext, createAuthMiddleware, getOAuthState } from 'better-auth/api'
import { genericOAuth } from 'better-auth/plugins'
import { decodeJwt } from 'jose'
import type { Pool } from 'pg'
import { z } from 'zod'
import type { EnterpriseConfig } from './config.ts'
import { transaction } from './database.ts'
import { requireDesktopAuthorization } from './desktop-authorization.ts'
import { EnterpriseRequestError, type EnterpriseAuthorizationId, type EnterpriseUserId } from './protocol.ts'

const providerId = 'enterprise-oidc'
/** Immutable external subject, meaningful only under its OIDC issuer. */
export type EnterpriseOidcSubject = Branded<'EnterpriseOidcSubject'>
/** OIDC subject validation at provider-claim and administrator-request inputs. */
export const oidcSubjectSchema = z.string().min(1).max(255).transform(value => value as EnterpriseOidcSubject)
const flowSchema = z.object({ authorizeId: z.string().regex(/^[A-Za-z0-9_-]{43}$/u).transform(value => value as EnterpriseAuthorizationId), theme: z.enum(['light', 'dark']).default('light') })
const claimsSchema = z.object({
  iss: z.string(), sub: oidcSubjectSchema, email: z.email(), email_verified: z.literal(true),
  exp: z.number(), nonce: z.string().min(1), aud: z.union([z.string(), z.array(z.string()).min(1)]),
  azp: z.string().optional(), name: z.string().optional(),
})

/** One deployment owns admission policy and durable external-account associations. */
export class EnterpriseOidc {
  /** @param database - Deployment PostgreSQL pool. @param config - Validated deployment settings. */
  constructor(private readonly database: Pool, private readonly config: EnterpriseConfig) {}

  /** @returns Additive uniqueness enforcement; ambiguous existing bindings reject startup. */
  async migrate(): Promise<void> {
    await this.database.query(`CREATE UNIQUE INDEX IF NOT EXISTS enterprise_oidc_account ON account ("providerId", "accountId") WHERE "providerId" = 'enterprise-oidc'`)
  }

  /** @returns Standard OIDC provider with verified tokens and issuer-scoped subjects; disabled deployments register no provider. */
  provider() {
    if (!this.config.DSH_ENTERPRISE_OIDC_ENABLED) return genericOAuth({ config: [] })
    const issuer = z.string().parse(this.config.DSH_ENTERPRISE_OIDC_ISSUER)
    const clientId = z.string().parse(this.config.DSH_ENTERPRISE_OIDC_CLIENT_ID)
    return genericOAuth({ config: [{
      providerId, discoveryUrl: this.config.DSH_ENTERPRISE_OIDC_DISCOVERY_URL,
      clientId, clientSecret: this.config.DSH_ENTERPRISE_OIDC_CLIENT_SECRET,
      tokenEndpointAuth: { method: this.config.DSH_ENTERPRISE_OIDC_TOKEN_AUTH_METHOD },
      scopes: ['openid', 'profile', 'email'], pkce: true, requireIdTokenVerification: true,
      disableSignUp: !this.config.DSH_ENTERPRISE_OIDC_AUTO_PROVISION,
      disableProviderLogout: true,
      getUserInfo: async (tokens) => {
        // Generic OAuth verifies signature, audience, expiry and nonce before calling this mapper.
        if (!tokens.idToken) return null
        const parsed = claimsSchema.safeParse(decodeJwt(tokens.idToken))
        if (!parsed.success) return null
        const claims = parsed.data
        const audiences = typeof claims.aud === 'string' ? [claims.aud] : claims.aud
        if (claims.iss !== issuer || !audiences.includes(clientId) || audiences.some(value => value !== clientId) || claims.exp <= Date.now() / 1000 ||
          (claims.azp !== undefined && claims.azp !== clientId) || (audiences.length > 1 && claims.azp !== clientId)) return null
        return { ...claims, emailVerified: true, name: claims.name ?? claims.email }
      },
      accountSubject: ({ profile }) => JSON.stringify([issuer, oidcSubjectSchema.parse(profile.sub)]),
    }] })
  }

  /** Authentication hooks restrict public sign-in entrypoints and retain the original Desktop request in server-owned OAuth state. */
  readonly before = createAuthMiddleware(async (ctx) => {
    if (ctx.path === '/sign-in/email' && !this.config.DSH_ENTERPRISE_PASSWORD_ENABLED) {
      const { email } = z.object({ email: z.email() }).parse(ctx.body)
      const found = await this.database.query<{ role: string }>('SELECT role FROM "user" WHERE email = $1', [email.toLowerCase()])
      if (found.rows[0]?.role !== 'admin') throw new APIError('UNAUTHORIZED', { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password.' })
    }
    if (ctx.path !== '/sign-in/social') return
    if (!this.config.DSH_ENTERPRISE_OIDC_ENABLED) throw new APIError('FORBIDDEN', { message: 'OIDC is disabled.' })
    const parsed = z.object({ provider: z.literal(providerId), additionalData: flowSchema }).strict().safeParse(ctx.body)
    if (!parsed.success) throw new APIError('BAD_REQUEST', { code: 'enterprise_oidc_request_rejected', message: 'Restart sign-in from Desktop.' })
    const input = parsed.data
    const provider = ctx.context.socialProviders.find(item => item.id === providerId)
    if (provider !== undefined && provider.issuer !== this.config.DSH_ENTERPRISE_OIDC_ISSUER) throw new APIError('FORBIDDEN', { message: 'OIDC discovery issuer does not match deployment settings.' })
    await requireDesktopAuthorization(ctx.context.internalAdapter, input.additionalData.authorizeId)
    const callback = new URL('/dsh/authorize', this.config.DSH_ENTERPRISE_ORIGIN)
    callback.searchParams.set('authorize_id', input.additionalData.authorizeId)
    callback.searchParams.set('theme', input.additionalData.theme)
    await addOAuthServerContext(input.additionalData)
    return { context: { body: { provider: providerId, callbackURL: callback.href, errorCallbackURL: callback.href, disableRedirect: true } } }
  })

  /** Employee admission is checked on every OIDC creation and returning sign-in, before sessions are issued. */
  readonly validateUserInfo: NonNullable<NonNullable<BetterAuthOptions['user']>['validateUserInfo']> = async ({ user, source }, ctx) => {
    if (source.method !== 'oauth') return
    if (source.oauth?.providerId !== providerId || !this.config.DSH_ENTERPRISE_OIDC_ENABLED || user.emailVerified !== true || typeof user.email !== 'string') return { error: 'enterprise_oidc_rejected' }
    const state = await getOAuthState()
    const flow = flowSchema.safeParse(state?.serverContext)
    if (!flow.success) return { error: 'enterprise_authorization_expired' }
    try { await requireDesktopAuthorization(ctx.context.internalAdapter, flow.data.authorizeId) }
    catch (error) { if (error instanceof APIError) return { error: 'enterprise_authorization_expired' }; throw error }
    if (source.action === 'create-user') {
      if (!this.config.DSH_ENTERPRISE_OIDC_AUTO_PROVISION) return { error: 'enterprise_oidc_not_provisioned' }
      return
    }
    if (source.action !== 'sign-in') return { error: 'enterprise_oidc_binding_required' }
    const found = await this.database.query<{ role: string; banned: boolean; emailConflict: boolean }>(
      'SELECT role, banned, EXISTS (SELECT 1 FROM "user" other WHERE other.email = $2 AND other.id <> $1) AS "emailConflict" FROM "user" WHERE id = $1',
      [user.id, user.email.toLowerCase()],
    )
    if (found.rows[0]?.role !== 'user' || found.rows[0].banned || found.rows[0].emailConflict) return { error: 'enterprise_oidc_account_unavailable' }
  }

  /**
   * Replace or clear a verified employee association and revoke browser/Desktop sessions and pending codes atomically.
   * @param userId - Existing employee selected by an authenticated administrator.
   * @param subject - Subject under the configured issuer; null clears the existing association without replacement.
   * @returns Committed binding change; conflicts leave the original binding intact.
   */
  async bind(userId: EnterpriseUserId, subject: EnterpriseOidcSubject | null): Promise<void> {
    const issuer = this.config.DSH_ENTERPRISE_OIDC_ISSUER
    if (subject !== null && (!this.config.DSH_ENTERPRISE_OIDC_ENABLED || issuer === undefined)) throw new EnterpriseRequestError(409)
    const accountId = subject === null ? null : JSON.stringify([issuer, subject])
    await transaction(this.database, async (client) => {
      const user = await client.query<{ role: string; banned: boolean }>('SELECT role, banned FROM "user" WHERE id = $1 FOR UPDATE', [userId])
      if (user.rows[0] === undefined) throw new EnterpriseRequestError(404)
      if (subject !== null && (user.rows[0].role !== 'user' || user.rows[0].banned)) throw new EnterpriseRequestError(409)
      const existing = await client.query<{ userId: string }>('SELECT "userId" FROM account WHERE "providerId" = $1 AND "accountId" = $2', [providerId, accountId])
      if (existing.rows.some(row => row.userId !== userId)) throw new EnterpriseRequestError(409)
      await client.query('DELETE FROM account WHERE "providerId" = $1 AND "userId" = $2', [providerId, userId])
      if (accountId !== null) await client.query('INSERT INTO account (id, "providerId", "accountId", "userId", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)', [randomUUID(), providerId, accountId, userId])
      await client.query('DELETE FROM "session" WHERE "userId" = $1', [userId])
      await client.query(`DELETE FROM verification WHERE CASE WHEN identifier LIKE 'enterprise-desktop-code:%' THEN value::jsonb ->> 'userId' = $1 ELSE FALSE END`, [userId])
    })
  }
}
