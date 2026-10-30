/** Isolated PostgreSQL-protocol enterprise service fixture with quiescent teardown. */
import { expect, onTestFinished } from 'vitest'
import { COVERAGE_TEST_TIMEOUT_ENV, coverageTestTimeoutOptions } from '../../../../scripts/coverage-partitions.ts'
import pg from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { z } from 'zod'
import { EnterpriseServer } from '../../src/server.ts'
import { resolveEnterpriseConfig } from '../../src/config.ts'

/**
 * Start one service with private database and ephemeral listeners.
 * @param mode - Model routing mode.
 * @param send - Instance-local upstream transport.
 * @param environment - Deployment configuration overrides.
 * @returns Service, database, and authenticated HTTP helpers, disposed after the current test.
 */
export async function fixture(mode: 'basic' | 'managed' = 'basic', send: typeof fetch = fetch, environment: Record<string, string> = {}) {
  const cleanup: Array<() => Promise<void>> = []
  onTestFinished(async () => { for (const close of cleanup.reverse()) await close() }, Math.max(30_000, coverageTestTimeoutOptions(process.env[COVERAGE_TEST_TIMEOUT_ENV]).hookTimeout ?? 0))
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
    ...environment,
    ...(mode === 'managed'
      ? { DSH_ENTERPRISE_LITELLM_URL: 'http://127.0.0.1:9876', DSH_ENTERPRISE_LITELLM_KEY: 'test-management-key' }
      : {}),
  })
  const server = new EnterpriseServer(pool, config, send)
  let stopping: Promise<void> | undefined
  const close = () => { stopping ??= server.stop(); return stopping }
  cleanup.push(close)
  const port = await server.start()
  const origin = `http://127.0.0.1:${String(port)}`
  const request = async (path: string, token?: string, payload?: unknown) =>
    fetch(`${origin}${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: {
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        'content-type': 'application/json',
        origin: config.DSH_ENTERPRISE_ORIGIN,
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    })
  const login = async (email: string, password: string) => {
    const response = await request('/api/auth/sign-in/email', undefined, { email, password })
    expect(response.status, await response.clone().text()).toBe(200)
    const result = z.object({ token: z.string() }).parse(await response.json())
    return result.token
  }
  return { server, pool, request, login, origin, close }
}
