/** Real HTTP and PostgreSQL-protocol integration; PGlite replaces only the external database process. */
import { afterEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { EnterpriseServer } from '../src/server.ts'
import { resolveEnterpriseConfig } from '../src/config.ts'
import { enterpriseSessionSchema } from '../src/protocol.ts'
import { EnterpriseDepartments } from '../src/departments.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function fixture(mode: 'basic' | 'managed' = 'basic', send: typeof fetch = fetch) {
  const db = await PGlite.create()
  cleanup.push(() => db.close())
  const socket = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 8 })
  await socket.start()
  cleanup.push(async () => {
    await expect.poll(() => socket.getStats()).toMatchObject({ activeConnections: 0, queuedQueries: 0 })
    await socket.stop()
  })
  const connectionString = `postgresql://postgres@${socket.getServerConn()}/postgres`
  const pool = new pg.Pool({ connectionString, max: 4 })
  const config = resolveEnterpriseConfig({
    DSH_ENTERPRISE_ID: 'test-enterprise',
    DSH_ENTERPRISE_ORIGIN: 'http://127.0.0.1',
    DATABASE_URL: connectionString,
    BETTER_AUTH_SECRET: 'test-only-enterprise-secret-at-least-32-characters',
    DSH_ENTERPRISE_PORT: '0',
    DSH_ENTERPRISE_BOOTSTRAP_EMAIL: 'admin@example.test',
    DSH_ENTERPRISE_BOOTSTRAP_PASSWORD: 'test-admin-password',
    DSH_ENTERPRISE_MODE: mode,
    ...(mode === 'managed'
      ? { DSH_ENTERPRISE_LITELLM_URL: 'http://127.0.0.1:9876', DSH_ENTERPRISE_LITELLM_KEY: 'test-management-key' }
      : {}),
  })
  const server = new EnterpriseServer(pool, config, send)
  cleanup.push(() => server.stop())
  const port = await server.start()
  const origin = `http://127.0.0.1:${String(port)}`
  const request = async (path: string, token?: string, payload?: unknown) =>
    fetch(`${origin}${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: {
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        'content-type': 'application/json',
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    })
  const login = async (email: string, password: string) => {
    const response = await request('/api/auth/sign-in/email', undefined, { email, password })
    expect(response.status, await response.clone().text()).toBe(200)
    const result = (await response.json()) as { token: string }
    return result.token
  }
  return { server, pool, request, login, origin }
}

const provisioning = {
  mode: 'basic',
  baseURL: 'https://provider.example.test/v1',
  api: 'openai-completions',
  apiKey: 'employee-provider-key',
  models: [{ id: 'approved-model', name: 'Approved model', contextWindow: 128000, maxTokens: 8192, input: ['text'] }],
  defaultModel: 'approved-model',
}

describe('enterprise service', () => {
  it('maintains department hierarchy, rejects cycles, and preserves child links after migration', async () => {
    const { request, login, pool } = await fixture()
    const admin = await login('admin@example.test', 'test-admin-password')
    const add = async (name: string, parentId: string | null = null) => {
      const result = await request('/v1/admin/departments', admin, { name, description: '', parentId })
      expect(result.status).toBe(201)
      return z.object({ department: z.object({ id: z.uuid(), parentId: z.uuid().nullable() }) }).parse(await result.json()).department
    }
    const root = await add('Engineering')
    const child = await add('Platform', root.id)
    const leaf = await add('Infrastructure', child.id)
    expect(child.parentId).toBe(root.id)
    const move = (id: string, parentId: string | null) => request(`/v1/admin/departments/${id}`, admin, { name: 'Engineering', description: '', parentId })
    for (const parent of [root.id, child.id, leaf.id]) {
      const result = await move(root.id, parent)
      expect(result.status).toBe(409)
      expect(await result.json()).toEqual({ error: { code: 'department_cycle' } })
    }
    expect((await request(`/v1/admin/departments/${root.id}/delete`, admin, {})).status).toBe(409)
    expect((await move(root.id, '00000000-0000-4000-8000-000000000000')).status).toBe(404)
    expect((await request('/v1/admin/departments', admin, { name: 'Invalid', description: '', parentId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404)
    const reopened = new EnterpriseDepartments(pool)
    await reopened.migrate()
    expect(await reopened.list()).toContainEqual(expect.objectContaining({ id: child.id, parentId: root.id }))
    expect((await request(`/v1/admin/departments/${child.id}`, admin, { name: 'Platform', description: '', parentId: null })).status).toBe(200)
    expect((await request(`/v1/admin/departments/${root.id}/delete`, admin, {})).status).toBe(200)
  })

  it('inherits encrypted platform defaults, keeps overrides, and restores inheritance when cleared', async () => {
    const { request, login, pool } = await fixture()
    const admin = await login('admin@example.test', 'test-admin-password')
    const created = await request('/v1/admin/employees', admin, { name: 'Alice', email: 'alice@example.test', password: 'test-alice-password', role: 'user' })
    const { user } = z.object({ user: z.object({ id: z.string() }) }).parse(await created.json())
    const employee = await login('alice@example.test', 'test-alice-password')
    expect((await request('/v1/session', employee)).status).toBe(409)
    expect((await request('/v1/admin/platform-default', employee, provisioning)).status).toBe(403)
    expect((await request('/v1/admin/platform-default', admin, { ...provisioning, defaultModel: 'missing' })).status).toBe(400)
    expect((await request('/v1/admin/platform-default', admin, provisioning)).status).toBe(200)
    const session = async () => enterpriseSessionSchema.parse(await (await request('/v1/session', employee)).json())
    expect((await session()).provisioning).toEqual(provisioning)
    const defaultText = await (await request('/v1/admin/platform-default', admin)).text()
    expect(defaultText).not.toContain(provisioning.apiKey)
    expect((await pool.query('SELECT configuration FROM enterprise_platform_default')).rows[0].configuration).not.toContain(provisioning.apiKey)
    const assignment = `/v1/admin/employees/${user.id}/assignment`
    const override = { ...provisioning, baseURL: 'https://personal.example.test/v1' }
    expect((await request(assignment, admin, override)).status).toBe(200)
    const next = { ...provisioning, apiKey: 'updated-platform-key', baseURL: 'https://new.example.test/v1' }
    expect((await request('/v1/admin/platform-default', admin, next)).status).toBe(200)
    expect((await session()).provisioning).toEqual(override)
    expect((await request(assignment, admin, { usePlatformDefault: true })).status).toBe(200)
    expect((await session()).provisioning).toEqual(next)
    const changed = { ...next, defaultModel: 'next-model', models: [{ ...provisioning.models[0], id: 'next-model', name: 'Next model' }] }
    expect((await request('/v1/admin/platform-default', admin, changed)).status).toBe(200)
    const listing = await (await request('/v1/admin/employees', admin)).text()
    expect(listing).toContain('"assignmentSource":"platform"')
    expect(listing).not.toContain('updated-platform-key')
    expect((await session()).provisioning).toEqual(changed)
    expect((await request('/v1/admin/employees', admin, { name: 'Bob', email: 'bob@example.test', password: 'test-bob-password', role: 'user' })).status).toBe(201)
    const bob = await login('bob@example.test', 'test-bob-password')
    expect(enterpriseSessionSchema.parse(await (await request('/v1/session', bob)).json()).provisioning).toEqual(changed)
  })

  it('refreshes inherited managed access with a private employee key and retries failed provisioning', async () => {
    let key: string | undefined
    let failProvision = true
    const send: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      const data = z.record(z.string(), z.unknown()).parse(typeof init?.body === 'string' ? JSON.parse(init.body) : {})
      if (url.pathname === '/model/info') return Response.json({ data: [{ model_name: 'approved-model' }, { model_name: 'next-model' }] })
      if (url.pathname === '/key/info') return key === undefined ? Response.json({}, { status: 404 }) : Response.json({ info: {} })
      if (url.pathname === '/key/generate') {
        if (failProvision) return Response.json({}, { status: 503 })
        key = z.string().parse(data.key)
        return Response.json({ key })
      }
      return Response.json({ ok: true })
    }
    const { request, login, server } = await fixture('managed', send)
    const admin = await login('admin@example.test', 'test-admin-password')
    const created = await request('/v1/admin/employees', admin, { name: 'Alice', email: 'alice@example.test', password: 'test-alice-password', role: 'user' })
    const { user } = z.object({ user: z.object({ id: z.string() }) }).parse(await created.json())
    const employee = await login('alice@example.test', 'test-alice-password')
    expect((await request('/v1/admin/platform-default', admin, provisioning)).status).toBe(409)
    expect((await request('/v1/admin/platform-default', admin, { ...provisioning, mode: 'managed', models: [{ ...provisioning.models[0], id: 'forbidden' }], defaultModel: 'forbidden' })).status).toBe(403)
    expect((await request('/v1/admin/platform-default', admin, { ...provisioning, mode: 'managed' })).status).toBe(200)
    expect((await request('/v1/session', employee)).status).toBe(503)
    expect((await server.store.assignment(user.id))?.gateway_state).toBe('unconfigured')
    failProvision = false
    const session = enterpriseSessionSchema.parse(await (await request('/v1/session', employee)).json())
    expect(session.provisioning.apiKey).toMatch(/^entm_/u)
    expect(session.provisioning.apiKey).not.toBe(key)
    expect((await request('/v1/chat/completions', session.provisioning.apiKey, { model: 'approved-model' })).status).toBe(200)
    const previousKey = key
    expect((await request('/v1/admin/platform-default', admin, { ...provisioning, mode: 'managed', models: [{ ...provisioning.models[0], id: 'next-model' }], defaultModel: 'next-model' })).status).toBe(200)
    expect((await request('/v1/chat/completions', session.provisioning.apiKey, { model: 'approved-model' })).status).toBe(403)
    expect(enterpriseSessionSchema.parse(await (await request('/v1/session', employee)).json()).provisioning.defaultModel).toBe('next-model')
    expect(key).toBe(previousKey)
    expect((await request('/v1/chat/completions', session.provisioning.apiKey, { model: 'approved-model' })).status).toBe(403)
    expect((await request('/v1/chat/completions', session.provisioning.apiKey, { model: 'next-model' })).status).toBe(200)
  })

  it('persists departments and membership, rejects invalid references, and protects populated departments', async () => {
    const { request, login, pool } = await fixture()
    const admin = await login('admin@example.test', 'test-admin-password')
    const created = await request('/v1/admin/employees', admin, {
      name: 'Alice', email: 'alice@example.test', password: 'test-alice-password', role: 'user',
    })
    const { user } = z.object({ user: z.object({ id: z.string() }) }).parse(await created.json())
    const employee = await login('alice@example.test', 'test-alice-password')
    expect((await request('/v1/admin/departments')).status).toBe(401)
    for (const payload of [undefined, { name: 'Forbidden', description: '' }]) {
      expect((await request('/v1/admin/departments', employee, payload)).status).toBe(403)
    }
    for (const input of [{ name: ' ', description: '' }, { name: 'x'.repeat(101), description: '' }, { name: 'Invalid', description: 'x'.repeat(501) }, { name: 'Invalid', description: '', role: 'admin' }]) {
      expect((await request('/v1/admin/departments', admin, input)).status).toBe(400)
    }
    const departmentSchema = z.object({ id: z.uuid(), name: z.string(), description: z.string(), parentId: z.uuid().nullable(), memberCount: z.number() })
    const addDepartment = async (name: string) => {
      const response = await request('/v1/admin/departments', admin, { name, description: 'Team description' })
      expect(response.status).toBe(201)
      return z.object({ department: departmentSchema }).parse(await response.json()).department
    }
    const engineering = await addDepartment(' Engineering ')
    const operations = await addDepartment('Operations')
    expect(engineering).toMatchObject({ name: 'Engineering', memberCount: 0 })
    const duplicate = await request('/v1/admin/departments', admin, { name: 'Engineering', description: '' })
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toEqual({ error: { code: 'department_name_exists' } })
    const membershipPath = `/v1/admin/employees/${user.id}/department`
    expect((await request(membershipPath, employee, { departmentId: engineering.id })).status).toBe(403)
    expect((await request(membershipPath, admin, { departmentId: 'not-an-id' })).status).toBe(400)
    expect((await request('/v1/admin/employees/missing/department', admin, { departmentId: engineering.id })).status).toBe(404)
    expect((await request(membershipPath, admin, { departmentId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404)
    expect((await request(membershipPath, admin, { departmentId: engineering.id })).status).toBe(200)
    expect((await request(membershipPath, admin, { departmentId: engineering.id })).status).toBe(200)
    const departmentList = async () => z.object({ departments: z.array(departmentSchema) }).parse(await (await request('/v1/admin/departments', admin)).json()).departments
    expect(await departmentList()).toEqual([{ ...engineering, memberCount: 1 }, operations])
    const blocked = await request(`/v1/admin/departments/${engineering.id}/delete`, admin, {})
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toEqual({ error: { code: 'department_not_empty' } })
    const conflictingRename = await request(`/v1/admin/departments/${engineering.id}`, admin, { name: 'Operations', description: '' })
    expect(conflictingRename.status).toBe(409)
    expect((await request(`/v1/admin/departments/${engineering.id}`, admin, { name: 'Research', description: 'Updated' })).status).toBe(200)
    // A new database owner reruns the additive migration without replacing durable membership.
    const reopened = new EnterpriseDepartments(pool)
    await reopened.migrate()
    expect(await reopened.list()).toContainEqual({ ...engineering, name: 'Research', description: 'Updated', memberCount: 1 })
    const directory = await (await request('/v1/admin/employees', admin)).json() as { employees: Array<{ id: string; departmentId: string | null }> }
    expect(directory.employees.find(row => row.id === user.id)?.departmentId).toBe(engineering.id)
    expect((await request(membershipPath, admin, { departmentId: operations.id })).status).toBe(200)
    expect((await request(`/v1/admin/departments/${engineering.id}/delete`, admin, {})).status).toBe(200)
    expect((await request(`/v1/admin/departments/${engineering.id}/delete`, admin, {})).status).toBe(404)
    expect((await request(membershipPath, admin, { departmentId: null })).status).toBe(200)
    expect((await request(`/v1/admin/departments/${operations.id}/delete`, admin, {})).status).toBe(200)
    expect(await departmentList()).toEqual([])
  })

  it('serves the standalone administration page while protecting account data before login', async () => {
    const { request } = await fixture()
    for (const path of ['/admin', '/admin/', '/']) {
      const response = await request(path)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
      const document = await response.text()
      expect(document).toContain('src="/admin/app.js"')
      expect(document).not.toContain('admin@example.test')
    }
    for (const path of ['/admin/app.js', '/admin/app.css', '/app.js', '/app.css']) {
      const response = await request(path)
      expect(response.status).toBe(200)
      await response.body?.cancel()
    }
    expect((await request('/v1/admin/employees')).status).toBe(401)
    expect((await request('/v1/session')).status).toBe(401)
  })

  it('approves browser sign-in once, binds exchange to PKCE, and creates an independent desktop session', async () => {
    const { request, login } = await fixture()
    const verifier = 'v'.repeat(64)
    const state = 's'.repeat(43)
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const created = await request('/api/auth/enterprise/desktop/authorize', undefined, {
      callbackUrl: 'http://127.0.0.1:12345/oauth/callback', state, codeChallenge: challenge,
    })
    expect(created.status, await created.clone().text()).toBe(200)
    const pending = z.object({ authorizeId: z.string(), authorizeUrl: z.url() }).parse(await created.json())
    expect(new URL(pending.authorizeUrl).pathname).toBe('/dsh/authorize')
    expect((await request('/api/auth/enterprise/desktop/approve', undefined, { authorizeId: pending.authorizeId })).status).toBe(401)
    const browserToken = await login('admin@example.test', 'test-admin-password')
    const approved = await request('/api/auth/enterprise/desktop/approve', browserToken, { authorizeId: pending.authorizeId })
    expect(approved.status, await approved.clone().text()).toBe(200)
    const callback = new URL(z.object({ callbackUrl: z.url() }).parse(await approved.json()).callbackUrl)
    expect(callback.searchParams.get('state')).toBe(state)
    expect(callback.searchParams.has('token')).toBe(false)
    expect((await request('/api/auth/enterprise/desktop/approve', browserToken, { authorizeId: pending.authorizeId })).status).toBe(400)
    const code = callback.searchParams.get('code')
    expect((await request('/api/auth/enterprise/desktop/token', undefined, { code, codeVerifier: 'wrong'.repeat(12) })).status).toBe(400)
    const exchange = await request('/api/auth/enterprise/desktop/token', undefined, { code, codeVerifier: verifier })
    expect(exchange.status, await exchange.clone().text()).toBe(200)
    const desktopToken = z.object({ token: z.string() }).parse(await exchange.json()).token
    expect(desktopToken).not.toBe(browserToken)
    expect((await request('/api/auth/get-session', desktopToken)).status).toBe(200)
    expect((await request('/api/auth/enterprise/desktop/token', undefined, { code, codeVerifier: verifier })).status).toBe(400)
    expect((await request('/dsh/authorize')).status).toBe(200)
    const brand = await request('/dsh/brand.svg')
    expect(brand.status).toBe(200)
    expect(brand.headers.get('content-type')).toBe('image/svg+xml')
    expect(await brand.text()).toContain('<svg')
  })

  it.each(['https://outside.example/oauth/callback', 'http://127.0.0.1:12345/other', 'http://user@127.0.0.1:12345/oauth/callback'])(
    'rejects an authorization callback outside the desktop receiver: %s', async (callbackUrl) => {
      const { request } = await fixture()
      expect((await request('/api/auth/enterprise/desktop/authorize', undefined, {
        callbackUrl, state: 's'.repeat(43), codeChallenge: 'c'.repeat(43),
      })).status).toBe(400)
    },
  )

  it('creates employees, provisions direct credentials, rejects employee administration, and revokes disabled sessions', async () => {
    const { pool, request, login } = await fixture()
    const admin = await login('admin@example.test', 'test-admin-password')
    const created = await request('/v1/admin/employees', admin, {
      email: 'alice@example.test',
      name: 'Alice',
      role: 'user',
      password: 'test-alice-password',
    })
    expect(created.status).toBe(201)
    const { user } = (await created.json()) as { user: { id: string } }
    const token = await login('alice@example.test', 'test-alice-password')
    expect((await request('/v1/admin/employees', token)).status).toBe(403)
    expect((await request('/v1/session', token)).status).toBe(409)
    expect((await request(`/v1/admin/employees/${user.id}/assignment`, admin, provisioning)).status).toBe(200)
    const response = await request('/v1/session', token)
    expect(response.status).toBe(200)
    const session = enterpriseSessionSchema.parse(await response.json())
    expect(session.userId).toBe(user.id)
    expect(session.provisioning).toEqual(provisioning)
    const saved = await pool.query<{ configuration: string }>('SELECT configuration FROM enterprise_assignment')
    expect(saved.rows[0]?.configuration).toBeTypeOf('string')
    expect(saved.rows[0]?.configuration).not.toContain('employee-provider-key')
    expect((await request(`/v1/admin/employees/${user.id}/budget`, admin, { maxBudget: 10 })).status).toBe(404)
    expect((await request('/v1/chat/completions', token, { model: 'approved-model' })).status).toBe(404)
    const disabled = await request(`/v1/admin/employees/${user.id}/disable`, admin, {})
    expect(await disabled.json()).toEqual({ disabled: true, upstreamRevocation: 'provider-action-required' })
    expect((await request('/v1/session', token)).status).toBe(401)
    expect(
      (
        await request('/api/auth/sign-in/email', undefined, {
          email: 'alice@example.test',
          password: 'test-alice-password',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await request('/api/auth/sign-up/email', undefined, {
          email: 'other@example.test',
          password: 'test-other-password',
          name: 'Other',
        })
      ).status,
    ).toBe(401)
  })

  it('preserves stable gateway identity, streams tools, enforces approved models, and exposes cleanup failure', async () => {
    const calls: Array<{ path: string; body: Record<string, unknown>; authorization: string | null }> = []
    let failRevocation = true
    let modelError: { type: string } | undefined
    const keys = new Set<string>()
    const send: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      const data = z.record(z.string(), z.unknown()).parse(typeof init?.body === 'string' ? JSON.parse(init.body) : {})
      calls.push({ path: url.pathname, body: data, authorization: new Headers(init?.headers).get('authorization') })
      if (url.pathname === '/model/info') return Response.json({ data: [{ model_name: 'approved-model' }] })
      if (url.pathname === '/user/info')
        return Response.json({
          user_info: { spend: 3, max_budget: 10, api_key: 'must-not-be-returned' },
          keys: ['must-not-be-returned'],
        })
      if (url.pathname === '/key/info')
        return keys.has(url.searchParams.get('key') ?? '')
          ? Response.json({ info: {} })
          : Response.json({}, { status: 404 })
      if (url.pathname === '/key/generate') {
        keys.add(createHash('sha256').update(String(data.key)).digest('hex'))
        return Response.json({ key: data.key })
      }
      if (url.pathname === '/spend/logs/v2')
        return Response.json({
          data: [
            {
              model: 'approved-model',
              startTime: '2026-10-28T00:00:00Z',
              spend: 0.1,
              prompt_tokens: 10,
              completion_tokens: 20,
              api_key: 'must-not-be-returned',
              messages: ['private prompt'],
            },
          ],
          total: 1,
          total_pages: 1,
          page: 1,
        })
      if (url.pathname === '/key/delete' && failRevocation)
        return Response.json({ error: 'unavailable' }, { status: 503 })
      if (url.pathname === '/chat/completions')
        if (modelError !== undefined) return Response.json({ error: modelError }, { status: 422 })
      if (url.pathname === '/chat/completions')
        return new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"read_file","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        )
      return Response.json({ ok: true })
    }
    const { request, login, origin } = await fixture('managed', send)
    const admin = await login('admin@example.test', 'test-admin-password')
    const created = await request('/v1/admin/employees', admin, {
      email: 'bob@example.test',
      name: 'Bob',
      role: 'user',
      password: 'test-bob-password',
    })
    const { user } = (await created.json()) as { user: { id: string } }
    expect(
      (await request(`/v1/admin/employees/${user.id}/assignment`, admin, { ...provisioning, mode: 'managed' })).status,
    ).toBe(200)
    expect(
      (await request(`/v1/admin/employees/${user.id}/assignment`, admin, { ...provisioning, mode: 'managed' })).status,
    ).toBe(200)
    expect(calls.filter(call => call.path === '/key/generate')).toHaveLength(1)
    const firstLogin = await login('bob@example.test', 'test-bob-password')
    const first = enterpriseSessionSchema.parse(await (await request('/v1/session', firstLogin)).json())
    const second = enterpriseSessionSchema.parse(
      await (await request('/v1/session', await login('bob@example.test', 'test-bob-password'))).json(),
    )
    expect(first.provisioning.apiKey).not.toBe(second.provisioning.apiKey)
    expect(first.provisioning.apiKey).not.toContain('virtual-key')
    expect((await request('/v1/chat/completions', first.provisioning.apiKey, { model: 'unapproved' })).status).toBe(403)
    expect(
      (
        await request('/v1/chat/completions', first.provisioning.apiKey, {
          model: 'approved-model',
          api_base: 'https://unapproved.example.test',
        })
      ).status,
    ).toBe(400)
    const response = await request('/v1/chat/completions', first.provisioning.apiKey, {
      model: 'approved-model',
      stream: true,
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('tool_calls')
    for (const [type, status] of [
      ['budget_exceeded', 429],
      ['invalid_request_error', 422],
    ] as const) {
      modelError = { type }
      const denied = await request('/v1/chat/completions', first.provisioning.apiKey, { model: 'approved-model' })
      expect(denied.status).toBe(status)
      expect(await denied.text()).not.toContain('Spend=')
    }
    modelError = undefined
    expect(calls.find(call => call.path === '/chat/completions')?.authorization).toMatch(/^Bearer sk-[a-f0-9]{64}$/u)
    const anthropic = await fetch(`${origin}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': first.provisioning.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'approved-model', messages: [], max_tokens: 10 }),
    })
    expect(anthropic.status).toBe(200)
    expect(calls.some(call => call.path === '/v1/messages')).toBe(true)
    const usage = await request(
      `/v1/admin/employees/${user.id}/usage?start=2026-10-01&end=2026-10-28&model=approved-model&page=1`,
      admin,
    )
    expect(usage.status).toBe(200)
    const usageText = await usage.text()
    expect(usageText).toContain('managedSince')
    expect(usageText).not.toContain('must-not-be-returned')
    expect(usageText).not.toContain('private prompt')
    expect((await request('/api/auth/sign-out', firstLogin, {})).status).toBe(200)
    expect((await request('/v1/chat/completions', first.provisioning.apiKey, { model: 'approved-model' })).status).toBe(
      403,
    )
    expect(
      (await request('/v1/chat/completions', second.provisioning.apiKey, { model: 'approved-model' })).status,
    ).toBe(200)
    expect((await request(`/v1/admin/employees/${user.id}/budget`, admin, { maxBudget: 10 })).status).toBe(200)
    expect((await request(`/v1/admin/employees/${user.id}/disable`, admin, {})).status).toBe(503)
    expect((await request('/v1/chat/completions', first.provisioning.apiKey, { model: 'approved-model' })).status).toBe(
      403,
    )
    const listing = (await (await request('/v1/admin/employees', admin)).json()) as {
      employees: Array<{ id: string; gatewayState: string }>
    }
    expect(listing.employees.find(employee => employee.id === user.id)?.gatewayState).toBe('cleanup-required')
    failRevocation = false
    expect((await request(`/v1/admin/employees/${user.id}/retry-cleanup`, admin, {})).status).toBe(200)
  })
})
