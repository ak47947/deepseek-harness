/** Better Auth owns password hashing, session expiry, login limits, and administrative account changes. */
import { betterAuth, type Auth, type BetterAuthOptions } from 'better-auth'
import { admin, bearer } from 'better-auth/plugins'
import type { AdminOptions } from 'better-auth/plugins/admin'
import type { Pool } from 'pg'
import type { EnterpriseConfig } from './config.ts'
import { enterpriseDesktopAuthorization } from './desktop-authorization.ts'

/**
 * Create authentication for one enterprise deployment. Public self-registration is disabled.
 * @param database - Deployment PostgreSQL pool.
 * @param config - Validated deployment settings.
 * @returns Authentication owner; its administrative APIs are exposed only through the enterprise authorization layer.
 */
export function createEnterpriseAuth(database: Pool, config: EnterpriseConfig): EnterpriseAuth {
  return betterAuth<EnterpriseAuthOptions>({
    database,
    baseURL: config.DSH_ENTERPRISE_ORIGIN,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.DSH_ENTERPRISE_ORIGIN],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128 },
    session: {
      expiresIn: config.DSH_ENTERPRISE_SESSION_SECONDS,
      updateAge: Math.floor(config.DSH_ENTERPRISE_SESSION_SECONDS / 4),
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 10 } },
    },
    advanced: { useSecureCookies: config.DSH_ENTERPRISE_ORIGIN.startsWith('https:') },
    plugins: [admin(), bearer(), enterpriseDesktopAuthorization(config)],
    telemetry: { enabled: false },
    logger: { disabled: true },
  })
}

/** Authentication instance used by the enterprise HTTP service. */
type EnterpriseAuthOptions = Omit<BetterAuthOptions, 'plugins'> & {
  plugins: [ReturnType<typeof admin<AdminOptions>>, ReturnType<typeof bearer>, ReturnType<typeof enterpriseDesktopAuthorization>]
}
export type EnterpriseAuth = Auth<EnterpriseAuthOptions>
/** Fresh authentication result; no cached role or disabled state is accepted. */
export type AuthenticatedEmployee = NonNullable<Awaited<ReturnType<EnterpriseAuth['api']['getSession']>>>
