/** Saved configuration records resolve through real HTTP and encrypted PostgreSQL storage. */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { provisioningSchema, enterpriseSessionSchema } from '@deepseek-ai/dsh-enterprise-protocol'
import { COVERAGE_TEST_TIMEOUT_ENV, coverageTestTimeoutOptions } from '../../../scripts/coverage-partitions.ts'
import { fixture } from './fixtures/enterprise.ts'

const configuration = {
  mode: 'basic', baseURL: 'https://provider.example.test/v1', api: 'openai-completions', apiKey: 'test-only-provider-key',
  models: [
    { id: 'model-a', name: 'Model A', contextWindow: 128000, maxTokens: 8192, input: ['text'] },
    { id: 'model-b', name: 'Model B', contextWindow: 200000, maxTokens: 4096, input: ['text', 'image'] },
  ], defaultModel: 'model-b',
}
const recordId = z.object({ id: z.string() })

describe('saved model configurations', { timeout: Math.max(30_000, coverageTestTimeoutOptions(process.env[COVERAGE_TEST_TIMEOUT_ENV]).testTimeout ?? 0) }, () => {
  it('publishes models, replaces the unique default, and allows local configuration when no model is distributed', async () => {
    const { request, login, server } = await fixture()
    const admin = await login('admin@example.test', 'test-admin-password')
    const createdUser = await request('/v1/admin/employees', admin, { name: 'Alice', email: 'alice@example.test', password: 'test-alice-password', role: 'user' })
    const { user } = z.object({ user: recordId }).parse(await createdUser.json())
    const employee = await login('alice@example.test', 'test-alice-password')
    const session = async () => {
      const response = await request('/v1/session', employee)
      expect(response.status).toBe(200)
      return enterpriseSessionSchema.parse(await response.json()).provisioning
    }
    const add = async (index: number) => {
      const model = configuration.models[index]!
      const response = await request('/v1/admin/model-configurations', admin, { name: model.name, configuration: { ...configuration, models: [model], defaultModel: model.id } })
      expect(response.status).toBe(201)
      return recordId.parse(await response.json()).id
    }
    const first = await add(0)
    const second = await add(1)
    const path = (id: string, action: string) => `/v1/admin/model-configurations/${id}/${action}`
    const assignment = `/v1/admin/employees/${user.id}/assignment`
    expect(await session()).toBeNull()
    expect((await request(assignment, admin, { usePlatformDefault: true })).status).toBe(200)
    expect(await session()).toBeNull()
    expect((await request(path(first, 'default'), admin, {})).status).toBe(200)
    expect(await session()).toMatchObject({ models: [configuration.models[0]], defaultModel: 'model-a' })
    const results = await Promise.all([first, second].map(id => request(path(id, 'default'), admin, {})))
    expect(results.map(result => result.status)).toEqual([200, 200])
    expect((await server.store.modelConfigurations()).filter(record => record.isDefault)).toHaveLength(1)
    expect((await request(path(second, 'default'), admin, {})).status).toBe(200)
    expect((await server.store.modelConfigurations()).filter(record => record.isDefault).map(record => record.id)).toEqual([second])
    expect(await session()).toMatchObject({ models: [configuration.models[1]], defaultModel: 'model-b' })
    expect((await request(assignment, admin, { configurationId: first })).status).toBe(200)
    expect((await request('/v1/admin/platform-default', admin, { configurationId: null })).status).toBe(200)
    expect(await session()).toMatchObject({ defaultModel: 'model-a' })
    expect((await request(path(first, 'unpublish'), admin, {})).status).toBe(200)
    expect(await session()).toBeNull()
    for (const action of ['publish', 'unpublish']) expect((await request(path(first, action), employee, {})).status).toBe(403)
    expect((await request(assignment, admin, { configurationId: first })).status).toBe(409)
    expect((await request(path(first, 'default'), admin, {})).status).toBe(409)
    expect((await request(path(first, 'publish'), admin, {})).status).toBe(200)
    expect(await session()).toMatchObject({ defaultModel: 'model-a' })
    expect((await request(assignment, admin, { usePlatformDefault: true })).status).toBe(200)
    expect(await session()).toBeNull()
    expect((await request(path(first, 'default'), admin, {})).status).toBe(200)
    expect((await request(path(first, 'unpublish'), admin, {})).status).toBe(200)
    expect(await server.store.platformDefault()).toBeNull()
    expect(await session()).toBeNull()
    expect((await request(path(first, 'publish'), admin, {})).status).toBe(200)
    expect(await session()).toBeNull()
    expect((await request(path(first, 'delete'), admin, {})).status).toBe(200)
  })

  it('shares records, resolves defaults and overrides, and retains keys on edits without exposing them', async () => {
    const { request, login, pool } = await fixture()
    const admin = await login('admin@example.test', 'test-admin-password')
    const create = async (name: string, api = 'openai-completions') => {
      const response = await request('/v1/admin/model-configurations', admin, { name, configuration: { ...configuration, api } })
      expect(response.status).toBe(201)
      return recordId.parse(await response.json()).id
    }
    const first = await create('General')
    const second = await create('Research', 'anthropic-messages')
    const userResponse = await request('/v1/admin/employees', admin, { name: 'Alice', email: 'alice@example.test', password: 'test-alice-password', role: 'user' })
    const { user } = z.object({ user: recordId }).parse(await userResponse.json())
    const employee = await login('alice@example.test', 'test-alice-password')
    expect(enterpriseSessionSchema.parse(await (await request('/v1/session', employee)).json()).provisioning).toBeNull()
    const route = (id: string) => `/v1/admin/model-configurations/${id}`
    expect((await request(`${route(first)}/default`, admin, {})).status).toBe(200)
    const session = async () => enterpriseSessionSchema.extend({ provisioning: provisioningSchema }).parse(await (await request('/v1/session', employee)).json()).provisioning
    expect(await session()).toEqual({ ...configuration, models: [configuration.models[1]] })
    const assignment = `/v1/admin/employees/${user.id}/assignment`
    expect((await request(assignment, admin, { configurationId: second })).status).toBe(200)
    expect((await session()).api).toBe('anthropic-messages')
    const { apiKey: _key, ...withoutKey } = configuration
    expect((await request(route(second), admin, { name: 'Research updated', configuration: { ...withoutKey, api: 'openai-responses', baseURL: 'https://updated.example.test/v1' } })).status).toBe(200)
    expect(await session()).toMatchObject({ api: 'openai-responses', baseURL: 'https://updated.example.test/v1', apiKey: configuration.apiKey })
    expect((await request(`${route(second)}/default`, admin, {})).status).toBe(200)
    expect((await request(assignment, admin, { usePlatformDefault: true })).status).toBe(200)
    expect((await request(`${route(first)}/default`, admin, {})).status).toBe(200)
    expect(await session()).toEqual({ ...configuration, models: [configuration.models[1]] })
    expect((await request('/v1/admin/employees', admin, { name: 'Bob', email: 'bob@example.test', password: 'test-bob-password', role: 'user' })).status).toBe(201)
    const bob = await login('bob@example.test', 'test-bob-password')
    expect(enterpriseSessionSchema.extend({ provisioning: provisioningSchema }).parse(await (await request('/v1/session', bob)).json()).provisioning).toEqual({ ...configuration, models: [configuration.models[1]] })
    const catalog = await (await request('/v1/admin/model-configurations', admin)).text()
    expect(catalog).not.toContain(configuration.apiKey)
    expect(z.object({ configurations: z.array(z.object({ id: z.string(), isDefault: z.boolean() })) }).parse(JSON.parse(catalog)).configurations.filter(record => record.isDefault)).toEqual([{ id: first, isDefault: true }])
    expect(await (await request('/v1/admin/employees', admin)).text()).not.toContain(configuration.apiKey)
    const ciphertext = await pool.query<{ configuration: string }>('SELECT configuration FROM enterprise_model_configuration')
    expect(ciphertext.rows).toHaveLength(2)
    for (const row of ciphertext.rows) expect(row.configuration).not.toContain(configuration.apiKey)
    expect((await request(`${route(second)}/delete`, admin, {})).status).toBe(200)
    expect((await request(`${route(first)}/delete`, admin, {})).status).toBe(409)
  })

  it('rejects invalid, unauthorized, missing, and referenced configuration mutations', async () => {
    const { request, login } = await fixture()
    const admin = await login('admin@example.test', 'test-admin-password')
    const created = await request('/v1/admin/model-configurations', admin, { name: 'General', configuration })
    const id = recordId.parse(await created.json()).id
    const path = `/v1/admin/model-configurations/${id}`
    const userResponse = await request('/v1/admin/employees', admin, { name: 'Alice', email: 'alice@example.test', password: 'test-alice-password', role: 'user' })
    const { user } = z.object({ user: recordId }).parse(await userResponse.json())
    const employee = await login('alice@example.test', 'test-alice-password')
    expect((await request('/v1/admin/model-configurations')).status).toBe(401)
    expect((await request('/v1/admin/model-configurations', employee)).status).toBe(403)
    for (const suffix of ['', '/default', '/delete']) expect((await request(path + suffix, employee, {})).status).toBe(403)
    for (const input of [
      { name: ' ', configuration },
      { name: 'Invalid default', configuration: { ...configuration, defaultModel: 'missing' } },
      { name: 'Duplicate models', configuration: { ...configuration, models: [configuration.models[0], configuration.models[0]] } },
      { name: 'Invalid endpoint', configuration: { ...configuration, baseURL: 'http://public.example.test' } },
      { name: 'Missing key', configuration: { ...configuration, apiKey: undefined } },
      { name: 'Unknown fields', configuration, unexpected: true },
    ]) expect((await request('/v1/admin/model-configurations', admin, input)).status).toBe(400)
    const assignment = `/v1/admin/employees/${user.id}/assignment`
    expect((await request(assignment, admin, { configurationId: 'missing' })).status).toBe(404)
    expect((await request('/v1/admin/employees/missing/assignment', admin, { configurationId: id })).status).toBe(404)
    expect((await request(assignment, admin, { configurationId: id })).status).toBe(200)
    const blocked = await request(path + '/delete', admin, {})
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toEqual({ error: { code: 'model_configuration_in_use' } })
    for (const suffix of ['', '/default', '/delete']) expect((await request('/v1/admin/model-configurations/missing' + suffix, admin, {})).status).toBe(404)
    expect((await request(path, admin, { name: 'Bad update', configuration: { ...configuration, defaultModel: 'missing' } })).status).toBe(400)
    expect((await request('/v1/session', employee)).status).toBe(200)
  })

  it('migrates legacy default and personal routes once while preserving encrypted credentials and inheritance', async () => {
    const { request, login, pool, server } = await fixture()
    const admin = await login('admin@example.test', 'test-admin-password')
    const created = await request('/v1/admin/employees', admin, { name: 'Alice', email: 'alice@example.test', password: 'test-alice-password', role: 'user' })
    const { user } = z.object({ user: recordId }).parse(await created.json())
    expect((await request('/v1/admin/platform-default', admin, configuration)).status).toBe(200)
    const personal = { ...configuration, apiKey: 'test-only-personal-key' }
    expect((await request(`/v1/admin/employees/${user.id}/assignment`, admin, personal)).status).toBe(200)
    // Recreate the pre-catalog columns with the encrypted data produced by the shipped writer.
    await pool.query('ALTER TABLE enterprise_assignment DROP COLUMN configuration_id')
    await pool.query('ALTER TABLE enterprise_platform_default DROP COLUMN configuration_id')
    await pool.query('DROP TABLE enterprise_model_configuration')
    await server.store.migrate()
    const records = await server.store.modelConfigurations()
    expect(records).toHaveLength(2)
    expect(records.find(record => record.isDefault)?.configuration).toEqual(configuration)
    expect(records.find(record => !record.isDefault)).toMatchObject({ name: 'Alice', configuration: personal })
    await server.store.migrate()
    expect(await server.store.modelConfigurations()).toEqual(records)
    const employee = await login('alice@example.test', 'test-alice-password')
    expect(enterpriseSessionSchema.extend({ provisioning: provisioningSchema }).parse(await (await request('/v1/session', employee)).json()).provisioning).toEqual(personal)
  })

  it('retries removed-model cleanup without disabling employees or the administrator', async () => {
    let failRevocation = true
    let revocations = 0
    const send: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      if (url.pathname === '/model/info') return Response.json({ data: [{ model_name: 'model-a' }, { model_name: 'model-b' }] })
      if (url.pathname === '/key/info' || url.pathname === '/user/info') return Response.json({}, { status: 404 })
      if (url.pathname === '/key/generate') return Response.json(z.object({ key: z.string() }).parse(JSON.parse(String(init?.body))))
      if (url.pathname === '/key/delete') {
        revocations += 1
        if (failRevocation) return Response.json({}, { status: 503 })
      }
      return Response.json({ ok: true })
    }
    const { request, login } = await fixture('managed', send)
    const admin = await login('admin@example.test', 'test-admin-password')
    const created = await request('/v1/admin/employees', admin, { name: 'Alice', email: 'alice@example.test', password: 'test-alice-password', role: 'user' })
    expect(created.status).toBe(201)
    const employee = await login('alice@example.test', 'test-alice-password')
    expect((await request('/v1/admin/platform-default', admin, { ...configuration, mode: 'managed' })).status).toBe(200)
    const accounts = await Promise.all([employee, admin].map(async token => {
      const session = enterpriseSessionSchema.extend({ provisioning: provisioningSchema }).parse(await (await request('/v1/session', token)).json())
      return { token, id: session.userId }
    }))
    expect((await request('/v1/admin/platform-default', admin, { configurationId: null })).status).toBe(200)
    for (const account of accounts) expect((await request('/v1/session', account.token)).status).toBe(503)
    const employees = z.object({ employees: z.array(z.object({ id: z.string(), banned: z.boolean(), gatewayState: z.string() })) })
    const pending = employees.parse(await (await request('/v1/admin/employees', admin)).json()).employees
    for (const account of accounts) expect(pending.find(user => user.id === account.id)).toMatchObject({ banned: false, gatewayState: 'cleanup-required' })
    failRevocation = false
    for (const account of accounts) {
      const retry = await request(`/v1/admin/employees/${account.id}/retry-cleanup`, admin, {})
      expect(retry.status).toBe(200)
      expect(await retry.json()).toEqual({ disabled: false, upstreamRevocation: 'complete' })
      const session = await request('/v1/session', account.token)
      expect(session.status).toBe(200)
      expect(enterpriseSessionSchema.parse(await session.json()).provisioning).toBeNull()
      expect((await request(`/v1/admin/employees/${account.id}/retry-cleanup`, admin, {})).status).toBe(409)
    }
    expect(revocations).toBe(4)
    const cleaned = employees.parse(await (await request('/v1/admin/employees', admin)).json()).employees
    for (const account of accounts) expect(cleaned.find(user => user.id === account.id)).toMatchObject({ banned: false, gatewayState: 'unconfigured' })
    expect((await request('/v1/admin/platform-default', admin, { ...configuration, mode: 'managed' })).status).toBe(200)
    for (const account of accounts) {
      const session = enterpriseSessionSchema.extend({ provisioning: provisioningSchema }).parse(await (await request('/v1/session', account.token)).json())
      expect((await request(`/v1/admin/employees/${account.id}/retry-cleanup`, admin, {})).status).toBe(409)
      expect((await request('/v1/chat/completions', session.provisioning.apiKey, { model: 'model-b' })).status).toBe(200)
    }
    expect(revocations).toBe(4)
    const administrator = accounts[1]!
    expect((await request(`/v1/admin/employees/${administrator.id}/disable`, admin, {})).status).toBe(409)
    expect((await request('/v1/session', admin)).status).toBe(200)
  })

  it('blocks stale managed routes until synchronization and retries a failed gateway update', async () => {
    let fail = false
    const send: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      if (url.pathname === '/model/info') return Response.json({ data: [{ model_name: 'model-a' }, { model_name: 'model-b' }] })
      if (url.pathname === '/key/info' || url.pathname === '/user/info') return Response.json({}, { status: 404 })
      if (url.pathname === '/key/generate') {
        if (fail) return Response.json({}, { status: 503 })
        return Response.json(z.object({ key: z.string() }).parse(JSON.parse(String(init?.body))))
      }
      return Response.json({ ok: true })
    }
    const { request, login } = await fixture('managed', send)
    const admin = await login('admin@example.test', 'test-admin-password')
    const managed = { ...configuration, mode: 'managed' }
    const created = await request('/v1/admin/model-configurations', admin, { name: 'Managed', configuration: managed })
    const id = recordId.parse(await created.json()).id
    expect((await request('/v1/admin/model-configurations', admin, { name: 'Wrong mode', configuration })).status).toBe(409)
    expect((await request('/v1/admin/model-configurations', admin, { name: 'Forbidden', configuration: { ...managed, models: [{ ...configuration.models[0], id: 'forbidden' }], defaultModel: 'forbidden' } })).status).toBe(403)
    const userResponse = await request('/v1/admin/employees', admin, { name: 'Alice', email: 'alice@example.test', password: 'test-alice-password', role: 'user' })
    const { user } = z.object({ user: recordId }).parse(await userResponse.json())
    expect((await request(`/v1/admin/employees/${user.id}/assignment`, admin, { configurationId: id })).status).toBe(200)
    const employee = await login('alice@example.test', 'test-alice-password')
    const session = enterpriseSessionSchema.extend({ provisioning: provisioningSchema }).parse(await (await request('/v1/session', employee)).json())
    const token = session.provisioning.apiKey
    expect((await request('/v1/chat/completions', token, { model: 'model-b' })).status).toBe(200)
    const updated = { ...managed, models: [configuration.models[0]], defaultModel: 'model-a' }
    expect((await request(`/v1/admin/model-configurations/${id}`, admin, { name: 'Updated', configuration: updated })).status).toBe(200)
    expect((await request('/v1/chat/completions', token, { model: 'model-b' })).status).toBe(403)
    fail = true
    expect((await request('/v1/session', employee)).status).toBe(503)
    expect((await request('/v1/chat/completions', token, { model: 'model-a' })).status).toBe(403)
    fail = false
    expect(enterpriseSessionSchema.extend({ provisioning: provisioningSchema }).parse(await (await request('/v1/session', employee)).json()).provisioning.defaultModel).toBe('model-a')
    expect((await request('/v1/chat/completions', token, { model: 'model-a' })).status).toBe(200)
    expect((await request('/v1/chat/completions', token, { model: 'model-b' })).status).toBe(403)
    expect((await request(`/v1/admin/model-configurations/${id}/unpublish`, admin, {})).status).toBe(200)
    expect((await request('/v1/chat/completions', token, { model: 'model-a' })).status).toBe(403)
    const unassigned = await request('/v1/session', employee)
    expect(unassigned.status).toBe(200)
    expect(enterpriseSessionSchema.parse(await unassigned.json()).provisioning).toBeNull()
    expect((await request('/v1/chat/completions', token, { model: 'model-a' })).status).toBe(403)
    expect((await request(`/v1/admin/model-configurations/${id}/publish`, admin, {})).status).toBe(200)
    expect(enterpriseSessionSchema.extend({ provisioning: provisioningSchema }).parse(await (await request('/v1/session', employee)).json()).provisioning.defaultModel).toBe('model-a')
    expect((await request('/v1/chat/completions', token, { model: 'model-a' })).status).toBe(200)
    expect((await request(`/v1/admin/employees/${user.id}/assignment`, admin, { usePlatformDefault: true })).status).toBe(200)
    expect(enterpriseSessionSchema.parse(await (await request('/v1/session', employee)).json()).provisioning).toBeNull()
    expect((await request('/v1/chat/completions', token, { model: 'model-a' })).status).toBe(403)
  })
})
