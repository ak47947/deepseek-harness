/** Real Better Auth redirect flows and PostgreSQL records with a local signing OIDC provider. */
import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { COVERAGE_TEST_TIMEOUT_ENV, coverageTestTimeoutOptions } from '../../../scripts/coverage-partitions.ts'
import { z } from 'zod'
import { fixture } from './fixtures/enterprise.ts'
import { oidcProvider } from './fixtures/oidc.ts'
import { resolveEnterpriseConfig } from '../src/config.ts'

async function setup(autoProvision = false, passwordEnabled = false, authentication = 'client_secret_basic') {
  const provider = await oidcProvider()
  const service = await fixture('basic', fetch, { ...provider.environment,
    DSH_ENTERPRISE_OIDC_AUTO_PROVISION: autoProvision ? '1' : '0', DSH_ENTERPRISE_PASSWORD_ENABLED: passwordEnabled ? '1' : '0',
    DSH_ENTERPRISE_OIDC_TOKEN_AUTH_METHOD: authentication })
  const admin = await service.login('admin@example.test', 'test-admin-password')
  const employee = async (name = 'Alice', email = 'alice@example.test') => {
    const response = await service.request('/v1/admin/employees', admin, { name, email, role: 'user', ...(passwordEnabled ? { password: 'test-employee-password' } : {}) })
    expect(response.status).toBe(201)
    return z.object({ user: z.object({ id: z.string() }) }).parse(await response.json()).user
  }
  const begin = async () => {
    // Protocol cases share this private database but do not test the per-IP login quota.
    await service.pool.query('DELETE FROM "rateLimit"')
    const verifier = randomBytes(48).toString('base64url')
    const state = randomBytes(32).toString('base64url')
    const pending = await service.request('/api/auth/enterprise/desktop/authorize', undefined, {
      callbackUrl: 'http://127.0.0.1:43817/oauth/callback', state, codeChallenge: createHash('sha256').update(verifier).digest('base64url') })
    const authorization = z.object({ authorizeId: z.string() }).parse(await pending.json())
    const response = await service.request('/api/auth/sign-in/social', undefined, { provider: 'enterprise-oidc', additionalData: { authorizeId: authorization.authorizeId } })
    expect(response.status, await response.clone().text()).toBe(200)
    const url = new URL(z.object({ url: z.url() }).parse(await response.json()).url)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('nonce')).toBeTruthy()
    const cookies = response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ')
    const callbackUrl = provider.authorize(url)
    const callback = (cookie = cookies) => fetch(`${service.origin}${callbackUrl.pathname}${callbackUrl.search}`, { redirect: 'manual', headers: { cookie } })
    return { ...authorization, callback, verifier, state, callbackUrl }
  }
  const browserToken = async (response: Response) => {
    expect(response.status).toBe(302)
    expect(new URL(response.headers.get('location')!).searchParams.has('error'), response.headers.get('location') ?? '').toBe(false)
    expect(new URL(response.headers.get('location')!).searchParams.get('authorize_id')).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const session = await fetch(`${service.origin}/api/auth/get-session`, { headers: { cookie } })
    return z.object({ session: z.object({ token: z.string() }), user: z.object({ id: z.string() }) }).parse(await session.json())
  }
  return { ...service, provider, admin, employee, begin, browserToken }
}

// Each case initializes PostgreSQL WASM, generates RSA keys, hashes credentials and completes real HTTP exchanges.
// Allow the integration workload without shortening a caller's larger lane budget.
describe('enterprise OIDC', { timeout: Math.max(30_000, coverageTestTimeoutOptions(process.env[COVERAGE_TEST_TIMEOUT_ENV]).testTimeout ?? 0) }, () => {
  it('rejects a discovered issuer that differs from deployment configuration before listening', async () => {
    const provider = await oidcProvider()
    provider.controls.discoveryIssuer = 'https://another-issuer.example.test'
    await expect(fixture('basic', fetch, provider.environment)).rejects.toThrow('discovery issuer does not match')
    expect(provider.controls.exchanges).toBe(0)
  })

  it('requires complete secure OIDC configuration and keeps automatic provisioning disabled by default', async () => {
    const service = await fixture()
    expect(service.server.config.DSH_ENTERPRISE_OIDC_AUTO_PROVISION).toBe(false)
    expect(service.server.config.DSH_ENTERPRISE_OIDC_TOKEN_AUTH_METHOD).toBe('client_secret_basic')
    expect(() => resolveEnterpriseConfig({ DATABASE_URL: service.server.config.DATABASE_URL,
      DSH_ENTERPRISE_ID: 'test-enterprise', DSH_ENTERPRISE_ORIGIN: 'https://enterprise.example.test',
      BETTER_AUTH_SECRET: 'test-only-enterprise-secret-at-least-32-characters', DSH_ENTERPRISE_OIDC_ENABLED: '1' })).toThrow('OIDC requires')
  })

  it('signs in explicitly bound employees with stable identity and independent Desktop sessions', async () => {
    const service = await setup()
    const alice = await service.employee()
    expect((await service.request(`/v1/admin/employees/${alice.id}/oidc`, service.admin, { subject: service.provider.controls.subject })).status).toBe(200)
    const flow = await service.begin()
    const session = await service.browserToken(await flow.callback())
    expect(session.user.id).toBe(alice.id)
    expect(service.provider.controls.authentication).toBe('client_secret_basic')
    const approval = await service.request('/api/auth/enterprise/desktop/approve', session.session.token, { authorizeId: flow.authorizeId })
    const callback = new URL(z.object({ callbackUrl: z.url() }).parse(await approval.json()).callbackUrl)
    expect(callback.searchParams.get('state')).toBe(flow.state)
    const exchange = await service.request('/api/auth/enterprise/desktop/token', undefined, { code: callback.searchParams.get('code'), codeVerifier: flow.verifier })
    expect(exchange.status).toBe(200)
    expect(z.object({ token: z.string() }).parse(await exchange.json()).token).not.toBe(session.session.token)
    const next = await service.begin()
    expect((await service.browserToken(await next.callback())).user.id).toBe(alice.id)
    service.provider.controls.email = 'admin@example.test'
    const conflictingEmail = await service.begin()
    expect(new URL((await conflictingEmail.callback()).headers.get('location')!).searchParams.has('error')).toBe(true)
    const account = await service.pool.query('SELECT "accountId", "accessToken", "idToken" FROM account WHERE "providerId" = \'enterprise-oidc\'')
    expect(account.rows).toEqual([{ accountId: JSON.stringify([service.provider.issuer, service.provider.controls.subject]), accessToken: null, idToken: null }])
  })

  it('supports registered client-secret POST authentication without changing the OIDC flow', async () => {
    const service = await setup(true, false, 'client_secret_post')
    const flow = await service.begin()
    await service.browserToken(await flow.callback())
    expect(service.provider.controls.authentication).toBe('client_secret_post')
  })

  it('rejects unknown identities and matching emails instead of implicitly linking existing employees or administrators', async () => {
    const service = await setup()
    const unknown = await service.begin()
    expect(new URL((await unknown.callback()).headers.get('location')!).searchParams.has('error')).toBe(true)
    await service.employee()
    const unbound = await service.begin()
    expect(new URL((await unbound.callback()).headers.get('location')!).searchParams.get('error')).toBe('account_not_linked')
    service.provider.controls.email = 'admin@example.test'
    const adminFlow = await service.begin()
    expect(new URL((await adminFlow.callback()).headers.get('location')!).searchParams.has('error')).toBe(true)
    expect((await service.pool.query('SELECT * FROM account WHERE "providerId" = \'enterprise-oidc\'')).rowCount).toBe(0)
    const adminId = (await service.pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = \'admin@example.test\'')).rows[0]!.id
    await service.pool.query('INSERT INTO account (id, "providerId", "accountId", "userId", "createdAt", "updatedAt") VALUES ($1, \'enterprise-oidc\', $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)', [randomBytes(16).toString('hex'), JSON.stringify([service.provider.issuer, service.provider.controls.subject]), adminId])
    const linkedAdmin = await service.begin()
    expect(new URL((await linkedAdmin.callback()).headers.get('location')!).searchParams.get('error')).toBe('enterprise_oidc_account_unavailable')
  })

  it('automatically provisions only ordinary employees and inherits platform defaults without a personal assignment', async () => {
    const service = await setup(true)
    service.provider.controls.claims = { role: 'admin' }
    const configuration = { mode: 'basic', api: 'openai-completions', baseURL: 'https://provider.example.test/v1', apiKey: 'test-provider-key',
      models: [{ id: 'approved-model', name: 'Approved model', contextWindow: 128000, maxTokens: 8192, input: ['text'] }], defaultModel: 'approved-model' }
    expect((await service.request('/v1/admin/platform-default', service.admin, configuration)).status).toBe(200)
    const flow = await service.begin()
    const session = await service.browserToken(await flow.callback())
    const result = await service.request('/v1/session', session.session.token)
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ userId: session.user.id, role: 'user', provisioning: configuration })
    expect((await service.request('/v1/admin/employees', session.session.token)).status).toBe(403)
  })

  it('rejects signatures and OIDC claims before creating accounts or sessions', async () => {
    const service = await setup(true)
    const cases = [{ aud: 'another-client' }, { aud: ['enterprise-test-client', 'untrusted-client'], azp: 'enterprise-test-client' }, { iss: 'https://another-issuer.test' }, { exp: 1 }, { nonce: 'wrong-nonce' }, { email_verified: false }, { azp: 'another-client' }]
    for (const claims of cases) {
      service.provider.controls.claims = claims
      const flow = await service.begin()
      expect(new URL((await flow.callback()).headers.get('location')!).searchParams.has('error')).toBe(true)
    }
    service.provider.controls.claims = {}
    service.provider.controls.badSignature = true
    const flow = await service.begin()
    expect(new URL((await flow.callback()).headers.get('location')!).searchParams.has('error')).toBe(true)
    expect((await service.pool.query('SELECT * FROM "user" WHERE role = \'user\'')).rowCount).toBe(0)
    expect((await service.pool.query('SELECT * FROM account WHERE "providerId" = \'enterprise-oidc\'')).rowCount).toBe(0)
  })

  it('rejects missing browser state, callback replay, and withdrawn or expired Desktop authorization', async () => {
    const service = await setup(true)
    const stolen = await service.begin()
    expect(new URL((await stolen.callback('')).headers.get('location')!).searchParams.has('error')).toBe(true)
    const cancelled = await service.begin()
    expect((await service.request('/api/auth/enterprise/desktop/cancel', undefined, { authorizeId: cancelled.authorizeId, codeVerifier: cancelled.verifier })).status).toBe(200)
    expect(new URL((await cancelled.callback()).headers.get('location')!).searchParams.has('error')).toBe(true)
    const expired = await service.begin()
    await service.pool.query('UPDATE verification SET "expiresAt" = CURRENT_TIMESTAMP - INTERVAL \'1 second\' WHERE identifier LIKE \'enterprise-desktop-request:%\'')
    expect(new URL((await expired.callback()).headers.get('location')!).searchParams.has('error')).toBe(true)
    expect((await service.pool.query('SELECT * FROM "user" WHERE role = \'user\'')).rowCount).toBe(0)
    const valid = await service.begin()
    const session = await service.browserToken(await valid.callback())
    expect(new URL((await valid.callback()).headers.get('location')!).searchParams.has('error')).toBe(true)
    const approval = await service.request('/api/auth/enterprise/desktop/approve', session.session.token, { authorizeId: valid.authorizeId })
    const code = new URL(z.object({ callbackUrl: z.url() }).parse(await approval.json()).callbackUrl).searchParams.get('code')
    expect((await service.request('/api/auth/enterprise/desktop/cancel', undefined, { authorizeId: valid.authorizeId, codeVerifier: valid.verifier })).status).toBe(200)
    expect((await service.request('/api/auth/enterprise/desktop/token', undefined, { code, codeVerifier: valid.verifier })).status).toBe(400)
  })

  it('revokes sessions and pending codes on binding recovery and rejects disabled employees and password bypass', async () => {
    const service = await setup()
    const created = await service.request('/v1/admin/employees', service.admin, { name: 'Alice', email: 'alice@example.test', role: 'user', password: 'existing-employee-password' })
    const alice = z.object({ user: z.object({ id: z.string() }) }).parse(await created.json()).user
    const binding = `/v1/admin/employees/${alice.id}/oidc`
    expect((await service.request(binding, service.admin, { subject: service.provider.controls.subject })).status).toBe(200)
    const flow = await service.begin()
    const session = await service.browserToken(await flow.callback())
    expect((await service.request('/api/auth/sign-in/email', undefined, { email: 'alice@example.test', password: 'existing-employee-password' })).status).toBe(401)
    const approval = await service.request('/api/auth/enterprise/desktop/approve', session.session.token, { authorizeId: flow.authorizeId })
    const code = new URL(z.object({ callbackUrl: z.url() }).parse(await approval.json()).callbackUrl).searchParams.get('code')
    expect((await service.request(binding, service.admin, { subject: null })).status).toBe(200)
    expect((await service.request('/api/auth/enterprise/desktop/approve', session.session.token, { authorizeId: flow.authorizeId })).status).toBe(401)
    expect((await service.request('/api/auth/enterprise/desktop/token', undefined, { code, codeVerifier: flow.verifier })).status).toBe(400)
    expect((await service.request(binding, service.admin, { subject: service.provider.controls.subject })).status).toBe(200)
    expect((await service.request(`/v1/admin/employees/${alice.id}/disable`, service.admin, {})).status).toBe(200)
    const disabled = await service.begin()
    expect(new URL((await disabled.callback()).headers.get('location')!).searchParams.has('error')).toBe(true)
  })

  it('preserves existing bindings on conflicts and keeps equal subjects under different issuers separate', async () => {
    const service = await setup()
    const alice = await service.employee()
    const bob = await service.employee('Bob', 'bob@example.test')
    const binding = (id: string, subject: string) => service.request(`/v1/admin/employees/${id}/oidc`, service.admin, { subject })
    expect((await binding(alice.id, service.provider.controls.subject)).status).toBe(200)
    expect((await binding(bob.id, service.provider.controls.subject)).status).toBe(409)
    const otherIssuer = 'https://previous-idp.example.test'
    await service.pool.query('UPDATE account SET "accountId" = $1 WHERE "userId" = $2 AND "providerId" = \'enterprise-oidc\'', [JSON.stringify([otherIssuer, service.provider.controls.subject]), alice.id])
    const unknown = await service.begin()
    expect(new URL((await unknown.callback()).headers.get('location')!).searchParams.get('error')).toBe('account_not_linked')
    expect((await binding(alice.id, service.provider.controls.subject)).status).toBe(200)
    const returning = await service.begin()
    expect((await service.browserToken(await returning.callback())).user.id).toBe(alice.id)
  })

  it('requires a password before promoting passwordless employees and revokes their OIDC access', async () => {
    const service = await setup()
    const alice = await service.employee()
    expect((await service.request(`/v1/admin/employees/${alice.id}/oidc`, service.admin, { subject: service.provider.controls.subject })).status).toBe(200)
    const flow = await service.begin()
    const session = await service.browserToken(await flow.callback())
    const role = `/v1/admin/employees/${alice.id}/role`
    expect((await service.request(role, service.admin, { role: 'admin' })).status).toBe(400)
    expect((await service.request(role, service.admin, { role: 'admin', password: 'new-administrator-password' })).status).toBe(200)
    expect((await service.request('/v1/session', session.session.token)).status).toBe(401)
    expect((await service.pool.query('SELECT * FROM account WHERE "userId" = $1 AND "providerId" = \'enterprise-oidc\'', [alice.id])).rowCount).toBe(0)
    const administrator = await service.login('alice@example.test', 'new-administrator-password')
    expect((await service.request('/v1/admin/employees', administrator)).status).toBe(200)
    expect((await service.request(`/v1/admin/employees/${alice.id}/oidc`, service.admin, { subject: service.provider.controls.subject })).status).toBe(409)
  })
})
