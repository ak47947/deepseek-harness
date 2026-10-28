/** Opt-in PostgreSQL dump/restore qualification preserves employee identity, roles, and encrypted model assignments. */
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import pg from 'pg'
import { z } from 'zod'
import { expect, it, onTestFinished } from 'vitest'
import { EnterpriseServer } from '../src/server.ts'
import { resolveEnterpriseConfig } from '../src/config.ts'
import { enterpriseSessionSchema } from '../src/protocol.ts'

it.skipIf(process.env.DSH_ENTERPRISE_DOCKER_E2E !== '1')(
  'restores employee login and encrypted provisioning from a PostgreSQL backup with the deployment secret',
  { retry: 0 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-restore-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const container = `dsh-enterprise-restore-${randomBytes(8).toString('hex')}`
    const docker = (...args: string[]) => execa('docker', args, { timeout: 30000 })
    onTestFinished(async () => {
      const existing = await docker('ps', '--all', '--filter', `name=^/${container}$`, '--format', '{{.ID}}')
      if (existing.stdout.trim() !== '') await docker('rm', '--force', container)
    })
    await docker('run', '--detach', '--name', container, '--pull=never',
      '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_PASSWORD=test-only-restore-password',
      '--env', 'POSTGRES_DB=enterprise', '--tmpfs', '/var/lib/postgresql/data',
      process.env.DSH_ENTERPRISE_TEST_POSTGRES_IMAGE ?? 'postgres:17.6-bookworm')
    // PostgreSQL's initialization server accepts Unix sockets before the final TCP server starts.
    await expect.poll(async () => {
      const result = await execa('docker', ['exec', container, 'pg_isready', '--host=127.0.0.1', '--username=postgres', '--dbname=enterprise'],
        { timeout: 5000, reject: false })
      return result.exitCode
    }, { timeout: 60000 }).toBe(0)
    const address = (await docker('port', container, '5432/tcp')).stdout.trim()
    const secret = randomBytes(32).toString('hex')
    const start = async (database: string, bootstrap: boolean) => {
      const config = resolveEnterpriseConfig({
        DSH_ENTERPRISE_ID: 'backup-qualification', DSH_ENTERPRISE_ORIGIN: 'http://127.0.0.1',
        DSH_ENTERPRISE_PORT: '0', DSH_ENTERPRISE_MODE: 'basic', BETTER_AUTH_SECRET: secret,
        DATABASE_URL: `postgresql://postgres:test-only-restore-password@${address}/${database}`,
        ...(bootstrap ? { DSH_ENTERPRISE_BOOTSTRAP_EMAIL: 'admin@example.test',
          DSH_ENTERPRISE_BOOTSTRAP_PASSWORD: 'test-admin-password' } : {}),
      })
      const pool = new pg.Pool({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 5000, max: 4 })
      const server = new EnterpriseServer(pool, config)
      let closing: Promise<void> | undefined
      const close = () => { closing ??= server.stop(); return closing }
      onTestFinished(close)
      const port = await server.start()
      const request = async (path: string, token?: string, body?: object) => {
        const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
        })
        return response
      }
      const login = async (email: string, password: string) => {
        const response = await request('/api/auth/sign-in/email', undefined, { email, password })
        expect(response.status, await response.clone().text()).toBe(200)
        return z.object({ token: z.string() }).parse(await response.json()).token
      }
      return { pool, request, login, close }
    }
    const before = await start('enterprise', true)
    const administrator = await before.login('admin@example.test', 'test-admin-password')
    const createdEmployee = await before.request('/v1/admin/employees', administrator, {
      name: 'Alice', email: 'alice@example.test', password: 'test-alice-password', role: 'user',
    })
    expect(createdEmployee.status).toBe(201)
    const user = z.object({ user: z.object({ id: z.string() }) }).parse(await createdEmployee.json()).user
    const provisioning = {
      mode: 'basic', baseURL: 'https://provider.example.test/v1', api: 'openai-completions', apiKey: 'test-only-provider-key',
      models: [{ id: 'approved-model', name: 'Approved model', contextWindow: 128000, maxTokens: 8192, input: ['text'] }],
      defaultModel: 'approved-model',
    }
    expect((await before.request(`/v1/admin/employees/${user.id}/assignment`, administrator, provisioning)).status).toBe(200)
    const encrypted = await before.pool.query<{ configuration: string }>('SELECT configuration FROM enterprise_assignment')
    expect(encrypted.rows[0]?.configuration).not.toContain(provisioning.apiKey)
    await before.close()
    const backup = join(root, 'enterprise.sql')
    await writeFile(backup, (await docker('exec', container, 'pg_dump', '--username=postgres', '--dbname=enterprise',
      '--no-owner', '--no-privileges')).stdout, { mode: 0o600 })
    await docker('exec', container, 'createdb', '--username=postgres', 'restored')
    await execa('docker', ['exec', '--interactive', container, 'psql', '--username=postgres', '--dbname=restored',
      '--set', 'ON_ERROR_STOP=on'], { input: await readFile(backup, 'utf8'), timeout: 30000 })
    const restored = await start('restored', false)
    const employee = await restored.login('alice@example.test', 'test-alice-password')
    const response = await restored.request('/v1/session', employee)
    expect(response.status).toBe(200)
    expect(enterpriseSessionSchema.parse(await response.json())).toMatchObject({
      enterpriseId: 'backup-qualification', userId: user.id, role: 'user', provisioning,
    })
    expect((await restored.request('/v1/admin/employees', employee)).status).toBe(403)
    const restoredAdmin = await restored.login('admin@example.test', 'test-admin-password')
    expect((await restored.request('/v1/admin/employees', restoredAdmin)).status).toBe(200)
    const restoredCiphertext = await restored.pool.query<{ configuration: string }>('SELECT configuration FROM enterprise_assignment')
    expect(restoredCiphertext.rows).toEqual(encrypted.rows)
    await restored.close()
  },
)
