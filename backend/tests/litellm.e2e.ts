/** Opt-in qualification against the pinned LiteLLM image and its real PostgreSQL accounting database. */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { execa } from 'execa'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import pg from 'pg'
import { expect, it, onTestFinished } from 'vitest'
import { EnterpriseServer } from '../src/server.ts'
import { resolveEnterpriseConfig } from '../src/config.ts'
import { enterpriseSessionSchema } from '../src/protocol.ts'

it.skipIf(process.env.DSH_ENTERPRISE_LITELLM_E2E !== '1')(
  'provisions, meters, limits, and revokes employee calls through LiteLLM v1.106.4',
  {
    // First-time image acquisition and gateway schema initialization own this opt-in integration budget.
    timeout: 600000,
    retry: 0,
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-litellm-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const provider = createServer((request, response) => {
      if (request.headers.authorization !== 'Bearer test-supplier-key') {
        response.writeHead(401).end()
        return
      }
      request.resume()
      request.once('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            id: 'test-chat',
            object: 'chat.completion',
            created: 1,
            model: 'test-model',
            choices: [
              { index: 0, message: { role: 'assistant', content: 'Enterprise gateway OK' }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
        )
      })
    })
    await new Promise<void>((resolve) => {
      provider.listen(0, '0.0.0.0', resolve)
    })
    onTestFinished(
      () =>
        new Promise<void>((resolve) => {
          provider.close(() => {
            resolve()
          })
          provider.closeAllConnections()
        }),
    )
    const address = provider.address()
    if (address === null || typeof address === 'string') throw new Error('Provider fixture did not bind a port')
    const master = `sk-${randomBytes(32).toString('hex')}`
    const salt = randomBytes(32).toString('hex')
    const configuration = join(root, 'litellm.yml')
    await writeFile(
      configuration,
      `model_list:\n  - model_name: approved-model\n    litellm_params:\n      model: openai/test-model\n      api_base: http://host.docker.internal:${String(address.port)}/v1\n      api_key: test-supplier-key\n    model_info:\n      input_cost_per_token: 0.001\n      output_cost_per_token: 0.002\ngeneral_settings:\n  master_key: os.environ/LITELLM_MASTER_KEY\n  database_url: os.environ/DATABASE_URL\nlitellm_settings:\n  telemetry: false\n  turn_off_message_logging: true\n`,
      { mode: 0o600 },
    )
    const databaseImage = process.env.DSH_ENTERPRISE_TEST_POSTGRES_IMAGE ?? 'postgres:17.6-bookworm'
    const compose = join(root, 'compose.yml')
    await writeFile(
      compose,
      `services:\n  db:\n    image: ${JSON.stringify(databaseImage)}\n    environment:\n      POSTGRES_PASSWORD: test-db-password\n      POSTGRES_DB: litellm\n    tmpfs: [/var/lib/postgresql/data]\n    healthcheck:\n      test: [CMD-SHELL, 'pg_isready -U postgres -d litellm']\n      interval: 2s\n      timeout: 5s\n      retries: 60\n  litellm:\n    image: ghcr.io/berriai/litellm-database:v1.106.4\n    command: [--config, /app/config.yml, --port, '4000']\n    ports: ['127.0.0.1::4000']\n    environment:\n      LITELLM_MASTER_KEY: ${master}\n      LITELLM_SALT_KEY: ${salt}\n      DATABASE_URL: postgresql://postgres:test-db-password@db:5432/litellm\n      LITELLM_TELEMETRY: 'False'\n    volumes: ['${configuration}:/app/config.yml:ro']\n    depends_on:\n      db: {condition: service_healthy}\n`,
      { mode: 0o600 },
    )
    const project = basename(root).toLowerCase()
    const docker = (...args: string[]) =>
      execa('docker', ['compose', '-p', project, '-f', compose, ...args], { timeout: 540000 })
    onTestFinished(async () => {
      await docker('down', '--volumes', '--remove-orphans')
    })
    await docker('up', '-d')
    const binding = (await docker('port', 'litellm', '4000')).stdout.trim()
    const gateway = `http://${binding}`
    await expect
      .poll(
        async () => {
          try {
            return (
              await fetch(`${gateway}/model/info`, {
                headers: { authorization: `Bearer ${master}` },
                signal: AbortSignal.timeout(5000),
              })
            ).status
          } catch (_error) {
            return 0
          }
        },
        { timeout: 180000, interval: 1000 },
      )
      .toBe(200)
    const database = await PGlite.create()
    onTestFinished(() => database.close())
    const socket = new PGLiteSocketServer({ db: database, host: '127.0.0.1', port: 0, maxConnections: 8 })
    await socket.start()
    onTestFinished(async () => {
      await expect.poll(() => socket.getStats()).toMatchObject({ activeConnections: 0, queuedQueries: 0 })
      await socket.stop()
    })
    const config = resolveEnterpriseConfig({
      DSH_ENTERPRISE_ID: 'gateway-qualification',
      DSH_ENTERPRISE_ORIGIN: 'http://127.0.0.1',
      DATABASE_URL: `postgresql://postgres@${socket.getServerConn()}/postgres`,
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
      DSH_ENTERPRISE_PORT: '0',
      DSH_ENTERPRISE_MODE: 'managed',
      DSH_ENTERPRISE_LITELLM_URL: gateway,
      DSH_ENTERPRISE_LITELLM_KEY: master,
      DSH_ENTERPRISE_BOOTSTRAP_EMAIL: 'admin@example.test',
      DSH_ENTERPRISE_BOOTSTRAP_PASSWORD: 'test-admin-password',
    })
    const service = new EnterpriseServer(new pg.Pool({ connectionString: config.DATABASE_URL }), config)
    onTestFinished(() => service.stop())
    const port = await service.start()
    const origin = `http://127.0.0.1:${String(port)}`
    const request = (path: string, token?: string, body?: unknown) =>
      fetch(`${origin}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    const login = async (email: string, password: string) => {
      const response = await request('/api/auth/sign-in/email', undefined, { email, password })
      expect(response.status).toBe(200)
      return ((await response.json()) as { token: string }).token
    }
    const admin = await login('admin@example.test', 'test-admin-password')
    const created = await request('/v1/admin/employees', admin, {
      email: 'employee@example.test',
      name: 'Employee',
      password: 'test-employee-password',
      role: 'user',
    })
    expect(created.status).toBe(201)
    const user = ((await created.json()) as { user: { id: string } }).user
    const assignment = {
      mode: 'managed',
      baseURL: `${origin}/v1`,
      api: 'openai-completions',
      apiKey: 'server-managed',
      models: [
        { id: 'approved-model', name: 'Approved model', contextWindow: 128000, maxTokens: 8192, input: ['text'] },
      ],
      defaultModel: 'approved-model',
    }
    const assigned = await request(`/v1/admin/employees/${user.id}/assignment`, admin, assignment)
    expect(assigned.status, await assigned.clone().text()).toBe(200)
    const first = enterpriseSessionSchema.parse(
      await (await request('/v1/session', await login('employee@example.test', 'test-employee-password'))).json(),
    )
    const second = enterpriseSessionSchema.parse(
      await (await request('/v1/session', await login('employee@example.test', 'test-employee-password'))).json(),
    )
    expect(first.provisioning.apiKey).not.toBe(second.provisioning.apiKey)
    for (const session of [first, second]) {
      const response = await request('/v1/chat/completions', session.provisioning.apiKey, {
        model: 'approved-model',
        messages: [{ role: 'user', content: 'test' }],
      })
      expect(response.status, await response.clone().text()).toBe(200)
      expect(await response.text()).toContain('Enterprise gateway OK')
    }
    const assignedRow = await service.store.assignment(user.id)
    expect(assignedRow?.gateway_key).toBeTruthy()
    const gatewayUser = `dsh_${(await import('node:crypto'))
      .createHash('sha256')
      .update(JSON.stringify([config.DSH_ENTERPRISE_ID, user.id]))
      .digest('hex')}`
    const usage = async () => {
      const response = await fetch(`${gateway}/user/info?user_id=${gatewayUser}`, {
        headers: { authorization: `Bearer ${master}` },
      })
      return (await response.json()) as { user_info: { spend: number } }
    }
    await expect
      .poll(async () => (await usage()).user_info.spend, { timeout: 90000, interval: 1000 })
      .toBeGreaterThan(0)
    const before = (await usage()).user_info.spend
    const updated = await request(`/v1/admin/employees/${user.id}/assignment`, admin, assignment)
    expect(updated.status, await updated.clone().text()).toBe(200)
    expect((await usage()).user_info.spend).toBeGreaterThanOrEqual(before)
    expect((await request(`/v1/admin/employees/${user.id}/budget`, admin, { maxBudget: before / 2 })).status).toBe(200)
    await expect
      .poll(
        async () => {
          const response = await request('/v1/chat/completions', first.provisioning.apiKey, {
            model: 'approved-model',
            messages: [{ role: 'user', content: 'denied' }],
          })
          const result: unknown = await response.json()
          return { status: response.status, result }
        },
        { timeout: 30000, interval: 1000 },
      )
      .toMatchObject({ status: 429, result: { error: { code: 'budget_or_rate_limit' } } })
    expect((await request(`/v1/admin/employees/${user.id}/disable`, admin, {})).status).toBe(200)
    expect(
      (await request('/v1/chat/completions', second.provisioning.apiKey, { model: 'approved-model', messages: [] }))
        .status,
    ).toBe(403)
  },
)
