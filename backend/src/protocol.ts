/** Validated employee identity and model provisioning exchanged with the desktop shell. */
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable tenant identity authenticated by the enterprise service. */
export type EnterpriseId = Branded<'EnterpriseId'>
/** Stable employee identity assigned by the authentication service. */
export type EnterpriseUserId = Branded<'EnterpriseUserId'>
/** Fixed-format account-directory identifier derived from authenticated IDs. */
export type EnterpriseAccountKey = Branded<'EnterpriseAccountKey'>
/** One short-lived browser authorization request. */
export type EnterpriseAuthorizationId = Branded<'EnterpriseAuthorizationId'>
/** One-use approval code bound to the desktop's PKCE verifier. */
export type EnterpriseAuthorizationCode = Branded<'EnterpriseAuthorizationCode'>

/** Only HTTPS endpoints, with loopback HTTP reserved for local development. */
export const endpointSchema = z.url().refine((value) => {
  const url = new URL(value)
  return (
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
  )
}, 'Use HTTPS, or loopback HTTP for development')

/** Explicit model capabilities; no executable configuration is accepted. */
export const modelSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().min(1).max(256),
    contextWindow: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    input: z.array(z.enum(['text', 'image'])).min(1),
  })
  .strict()

/** One approved provider route. Credentials travel only in authenticated provisioning responses. */
export const provisioningSchema = z
  .object({
    mode: z.enum(['basic', 'managed']),
    baseURL: endpointSchema,
    api: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']),
    apiKey: z
      .string()
      .min(1)
      .max(8192)
      .regex(/^[\x21-\x7e]+$/),
    models: z.array(modelSchema).min(1).max(64),
    defaultModel: z.string().min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.models.map(model => model.id)
    if (new Set(ids).size !== ids.length || !ids.includes(value.defaultModel)) {
      ctx.addIssue({ code: 'custom', message: 'Model IDs must be unique and include the default model' })
    }
  })

/** Authenticated account response; directory identity never comes from form fields. */
export const enterpriseSessionSchema = z
  .object({
    enterpriseId: z
      .string()
      .min(1)
      .max(256)
      .transform(value => value as EnterpriseId),
    userId: z
      .string()
      .min(1)
      .max(256)
      .transform(value => value as EnterpriseUserId),
    name: z.string().min(1).max(256),
    email: z.email(),
    role: z.enum(['admin', 'user']),
    expiresAt: z.iso.datetime(),
    provisioning: provisioningSchema,
  })
  .strict()

/** Model route stored as a platform default or an employee assignment. */
export type Provisioning = z.infer<typeof provisioningSchema>
/** Server-authenticated account and its complete model configuration. */
export type EnterpriseSession = z.infer<typeof enterpriseSessionSchema>

/** Expected HTTP failures, safe for logs; upstream response bodies and tokens are excluded. */
export class EnterpriseRequestError extends Error {
  /** @param status - HTTP response status, or zero for an invalid response. */
  constructor(readonly status: number) {
    super(`Enterprise request failed (${String(status)})`)
  }
}
