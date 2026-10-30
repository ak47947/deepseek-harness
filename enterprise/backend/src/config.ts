/** Fail-loud environment resolution for a single-enterprise deployment. */
import { z } from 'zod'
import { endpointSchema } from '@deepseek-ai/dsh-enterprise-protocol'

const oidcUrlSchema = z.url().refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
}, 'Use an HTTPS URL without credentials, query, or fragment')

const environmentSchema = z
  .object({
    DSH_ENTERPRISE_ID: z.string().min(1).max(256),
    DSH_ENTERPRISE_PRODUCT_NAME: z.string().trim().min(1).max(100).default('Atrix Harness'),
    DSH_ENTERPRISE_ORIGIN: endpointSchema
      .refine(value => new URL(value).pathname === '/', 'Configure a service origin without a path')
      .transform(value => new URL(value).origin),
    DATABASE_URL: z
      .url()
      .refine(
        value => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
        'Use a PostgreSQL connection URL',
      ),
    BETTER_AUTH_SECRET: z.string().min(32),
    DSH_ENTERPRISE_HOST: z.string().default('127.0.0.1'),
    DSH_ENTERPRISE_PORT: z.coerce.number().int().min(0).max(65535).default(3090),
    DSH_ENTERPRISE_MODE: z.enum(['basic', 'managed']).default('basic'),
    DSH_ENTERPRISE_AUTHORIZATION_SECONDS: z.coerce.number().int().min(60).max(1800).default(300),
    DSH_ENTERPRISE_OIDC_ENABLED: z.enum(['0', '1']).default('0').transform(value => value === '1'),
    DSH_ENTERPRISE_OIDC_ISSUER: oidcUrlSchema.optional(),
    DSH_ENTERPRISE_OIDC_DISCOVERY_URL: oidcUrlSchema.optional(),
    DSH_ENTERPRISE_OIDC_CLIENT_ID: z.string().min(1).optional(),
    DSH_ENTERPRISE_OIDC_CLIENT_SECRET: z.string().min(1).optional(),
    DSH_ENTERPRISE_OIDC_TOKEN_AUTH_METHOD: z.enum(['client_secret_basic', 'client_secret_post']).default('client_secret_basic'),
    DSH_ENTERPRISE_OIDC_DISPLAY_NAME: z.string().trim().min(1).max(100).default('Company SSO'),
    DSH_ENTERPRISE_OIDC_AUTO_PROVISION: z.enum(['0', '1']).default('0').transform(value => value === '1'),
    DSH_ENTERPRISE_PASSWORD_ENABLED: z.enum(['0', '1']).default('1').transform(value => value === '1'),
    DSH_ENTERPRISE_DIRECT_KEYS_REVOKED_AT: z.iso
      .datetime()
      .refine(value => Date.parse(value) <= Date.now(), 'Revocation confirmation cannot be in the future')
      .optional(),
    DSH_ENTERPRISE_SESSION_SECONDS: z.coerce.number().int().min(60).max(2592000).default(86400),
    DSH_ENTERPRISE_BOOTSTRAP_EMAIL: z.email().optional(),
    DSH_ENTERPRISE_BOOTSTRAP_PASSWORD: z.string().min(8).max(128).optional(),
    DSH_ENTERPRISE_LITELLM_URL: z
      .url()
      .refine((value) => {
        const url = new URL(value)
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
      }, 'Configure an HTTP(S) gateway endpoint without credentials, query, or fragment')
      .optional(),
    DSH_ENTERPRISE_LITELLM_KEY: z.string().min(1).optional(),
    DSH_ENTERPRISE_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(300000),
  })
  .superRefine((value, ctx) => {
    if (value.DSH_ENTERPRISE_OIDC_ENABLED && (!value.DSH_ENTERPRISE_OIDC_ISSUER || !value.DSH_ENTERPRISE_OIDC_DISCOVERY_URL || !value.DSH_ENTERPRISE_OIDC_CLIENT_ID || !value.DSH_ENTERPRISE_OIDC_CLIENT_SECRET || !value.DSH_ENTERPRISE_ORIGIN.startsWith('https:'))) {
      ctx.addIssue({ code: 'custom', message: 'OIDC requires issuer, discovery URL, client ID, client secret, and an HTTPS enterprise origin' })
    }
    if (!value.DSH_ENTERPRISE_OIDC_ENABLED && (!value.DSH_ENTERPRISE_PASSWORD_ENABLED || value.DSH_ENTERPRISE_OIDC_AUTO_PROVISION)) {
      ctx.addIssue({ code: 'custom', message: 'Employee password sign-in is required without OIDC; automatic provisioning requires OIDC' })
    }
    if (Boolean(value.DSH_ENTERPRISE_BOOTSTRAP_EMAIL) !== Boolean(value.DSH_ENTERPRISE_BOOTSTRAP_PASSWORD)) {
      ctx.addIssue({ code: 'custom', message: 'Configure both bootstrap email and password' })
    }
    if (
      value.DSH_ENTERPRISE_MODE === 'managed' &&
      (!value.DSH_ENTERPRISE_LITELLM_URL || !value.DSH_ENTERPRISE_LITELLM_KEY)
    ) {
      ctx.addIssue({ code: 'custom', message: 'Managed mode requires LiteLLM URL and management key' })
    }
  })

/** Validated deployment settings. */
export type EnterpriseConfig = z.infer<typeof environmentSchema>

/**
 * Resolve deployment settings without exposing rejected credential values.
 * @param environment - Application process environment.
 * @returns Validated settings; incomplete managed configuration rejects startup.
 */
export function resolveEnterpriseConfig(environment: NodeJS.ProcessEnv): EnterpriseConfig {
  const result = environmentSchema.safeParse(environment)
  if (!result.success)
    throw new Error(
      `Enterprise configuration: ${result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    )
  return result.data
}
