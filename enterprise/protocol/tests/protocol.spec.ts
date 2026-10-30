/** Enterprise wire validation independent of either application implementation. */
import { expect, it } from 'vitest'
import { endpointSchema, enterpriseSessionSchema, EnterpriseRequestError, provisioningSchema } from '../src/index.ts'

const provisioning = {
  mode: 'basic', baseURL: 'https://models.example.test/v1', api: 'openai-completions', apiKey: 'test-only-model-key',
  models: [{ id: 'approved', name: 'Approved', contextWindow: 128000, maxTokens: 8192, input: ['text'] }],
  defaultModel: 'approved',
}

it('accepts complete enterprise responses without loading either application', () => {
  const response = {
    enterpriseId: 'company', userId: 'employee', name: 'Alice', email: 'alice@example.test', role: 'user',
    expiresAt: '2026-10-30T12:00:00.000Z', provisioning,
  }
  expect(enterpriseSessionSchema.parse(response)).toEqual(response)
  expect(new EnterpriseRequestError(401)).toMatchObject({ status: 401, message: 'Enterprise request failed (401)' })
})

it.each(['https://models.example.test/v1', 'http://127.0.0.1:3090', 'http://localhost:3090', 'http://[::1]:3090'])(
  'accepts a supported model endpoint %s', endpoint => {
    expect(endpointSchema.parse(endpoint)).toBe(endpoint)
  },
)

it.each([
  'http://models.example.test/v1', 'https://user:secret@models.example.test/v1',
  'https://models.example.test/v1?key=secret', 'https://models.example.test/v1#fragment', 'file:///models',
])('rejects an unsupported model endpoint %s', endpoint => {
  expect(endpointSchema.safeParse(endpoint).success).toBe(false)
})

it('rejects ambiguous model assignments and executable or unknown configuration', () => {
  expect(provisioningSchema.safeParse({ ...provisioning, models: [...provisioning.models, ...provisioning.models] }).success).toBe(false)
  expect(provisioningSchema.safeParse({ ...provisioning, defaultModel: 'unassigned' }).success).toBe(false)
  expect(provisioningSchema.safeParse({ ...provisioning, plugins: [] }).success).toBe(false)
  expect(provisioningSchema.safeParse({ ...provisioning, apiKey: 'invalid\nkey' }).success).toBe(false)
})
