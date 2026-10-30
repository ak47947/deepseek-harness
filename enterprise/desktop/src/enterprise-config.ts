/** Validated enterprise identity and service settings resolved from the desktop configuration file. */
import { z } from 'zod'
import { endpointSchema } from '@deepseek-ai/dsh-enterprise-protocol'

const configSchema = z
  .object({
    appId: z.string().regex(/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/u),
    productName: z.string().min(1).max(100),
    enterpriseName: z.string().min(1).max(100).default('Atrix Harness'),
    origin: endpointSchema
      .refine(value => new URL(value).pathname === '/', 'Configure a service origin without a path')
      .transform(value => new URL(value).origin),
    syncIntervalMs: z.number().int().min(1000).max(2147483647).default(900000),
    requestTimeoutMs: z.number().int().min(1000).max(60000).default(15000),
    authorizationTimeoutMs: z.number().int().min(60000).max(1800000).default(300000),
  })
  .strict()

/** Enterprise settings resolved before any account directory or Host is opened. */
export type EnterpriseDesktopConfig = z.infer<typeof configSchema>

/**
 * @param value - Explicit enterprise metadata; callers resolve file defaults before invoking this parser.
 * @param development - Development marker; loopback HTTP also supports the default local enterprise service.
 * @returns Validated enterprise configuration or undefined.
 */
export function resolveEnterpriseDesktopConfig(
  value: unknown,
  development: boolean,
): EnterpriseDesktopConfig | undefined {
  if (value === undefined) return undefined
  const result = configSchema.safeParse(value)
  if (!result.success)
    throw new Error(
      'Enterprise desktop: configure appId, productName, HTTPS service origin, and valid synchronization intervals',
    )
  if (!development && !result.data.origin.startsWith('https://') && new URL(result.data.origin).hostname !== '127.0.0.1')
    throw new Error('Enterprise desktop: packaged service origin must use HTTPS')
  return result.data
}
