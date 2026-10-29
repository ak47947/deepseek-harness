/** Account lifecycle failures use deterministic clock and network controls, with private filesystem roots. */
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopEnterpriseSession, type EnterpriseSessionOperations } from '../src/enterprise-session.ts'
import {
  enterpriseAccountPaths,
  enterpriseCredentialRef,
  writeEnterpriseCredentials,
} from '../src/enterprise-profile.ts'
import { enterpriseSessionSchema, type EnterpriseSession } from '@deepseek-ai/dsh-enterprise/protocol'
import { rotateEnterpriseModel } from '../src/enterprise-rpc.ts'
import { DesktopBackendController } from '../src/backend-controller.ts'

const roots: string[] = []
const sessions: DesktopEnterpriseSession[] = []
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose()
  vi.useRealTimers()
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true })
})

function value(userId = 'alice', enterpriseId = 'company-a'): EnterpriseSession {
  return enterpriseSessionSchema.parse({
    enterpriseId,
    userId,
    name: 'Alice',
    email: 'alice@example.test',
    role: 'user',
    expiresAt: '2026-10-28T00:00:00.000Z',
    provisioning: {
      mode: 'basic',
      baseURL: 'https://provider.example.test/v1',
      api: 'openai-completions',
      apiKey: 'test-provider-key',
      models: [{ id: 'model', name: 'Model', contextWindow: 128000, maxTokens: 8192, input: ['text'] }],
      defaultModel: 'model',
    },
  })
}

async function harness(overrides: Partial<EnterpriseSessionOperations> = {}, send?: typeof fetch) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-session-'))
  roots.push(root)
  const operations = {
    encrypt: (text: string) => Buffer.from(text),
    decrypt: (bytes: Buffer) => bytes.toString('utf8'),
    update: vi.fn(async () => {}),
    invalidate: vi.fn(async (_reason: string, _updating: Promise<void> | undefined, clearSaved: Promise<void>) => {
      await clearSaved
    }),
    degraded: vi.fn(),
    failure: vi.fn(),
    ...overrides,
  }
  const transport: typeof fetch =
    send ??
    (async input =>
      new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname ===
      '/api/auth/sign-in/email'
        ? Response.json({ token: 'test-login-token' })
        : Response.json(value()))
  const session = new DesktopEnterpriseSession(
    root,
    {
      appId: 'test.enterprise.app',
      productName: 'Enterprise test', enterpriseName: 'Enterprise test',
      origin: 'http://127.0.0.1',
      syncIntervalMs: 1000,
      requestTimeoutMs: 1000, authorizationTimeoutMs: 300000,
    },
    operations,
    transport,
    () => Date.parse('2026-10-27T00:00:00.000Z'),
  )
  sessions.push(session)
  return { root, operations, session, transport }
}

describe('enterprise desktop accounts', () => {
  it('declares the deployment origin so the account service accepts the request', async () => {
    const origins: (string | null)[] = []
    const send: typeof fetch = async (input, init) => {
      origins.push(new Headers(init?.headers).get('origin'))
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname
      return path === '/api/auth/sign-in/email'
        ? Response.json({ token: 'test-login-token' })
        : Response.json(value())
    }
    const { session } = await harness({}, send)
    await session.acceptBrowserToken('test-login-token')
    expect(origins).toEqual(['http://127.0.0.1'])
  })

  it('removes an unreadable saved login and preserves account history for fresh sign-in', async () => {
    const { root, session } = await harness({
      decrypt: () => {
        throw new Error('unreadable')
      },
    })
    const paths = enterpriseAccountPaths(root, value())
    await mkdir(join(paths.home, 'sessions'), { recursive: true })
    await writeFile(join(paths.home, 'sessions/history.txt'), 'original history')
    await writeFile(join(root, 'session.bin'), 'corrupt')
    expect(await session.restore()).toBe(false)
    expect(session.restoreIssue).toBe(true)
    expect(await readFile(join(root, 'session.bin')).catch(() => undefined)).toBeUndefined()
    expect(await readFile(join(paths.home, 'sessions/history.txt'), 'utf8')).toBe('original history')
    await session.acceptBrowserToken('test-login-token')
    expect(session.paths).toEqual(paths)
  })

  it('never allocates a Host if encrypted login persistence fails', async () => {
    const { session } = await harness({
      encrypt: () => {
        throw new Error('secure storage unavailable')
      },
    })
    await session.acceptBrowserToken('test-login-token')
    const create = vi.fn(() => ({ start: vi.fn(async () => {}), stop: vi.fn(async () => {}) }))
    const backend = new DesktopBackendController(create, () => {})
    try {
      await expect(backend.start(() => session.commit())).rejects.toThrow('secure storage unavailable')
      expect(create).not.toHaveBeenCalled()
    } finally {
      await backend.close()
    }
  })

  it('starts periodic reads only after Host readiness explicitly enables synchronization', async () => {
    vi.useFakeTimers()
    const { session, transport } = await harness()
    const send = vi.fn(transport)
    const other = new DesktopEnterpriseSession(session.root, session.config, (await harness()).operations, send, () =>
      Date.parse('2026-10-27T00:00:00Z'),
    )
    sessions.push(other)
    await other.acceptBrowserToken('test-login-token')
    await other.commit()
    await vi.advanceTimersByTimeAsync(3000)
    expect(send).toHaveBeenCalledTimes(1)
    other.startSynchronization()
    await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('honors verified renewal while a model rotation crosses the previous expiry', async () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-10-27T00:00:00Z')
    vi.setSystemTime(now)
    const initial = { ...value(), expiresAt: new Date(now + 2000).toISOString() }
    const renewed = {
      ...value(),
      expiresAt: new Date(now + 10000).toISOString(),
      provisioning: { ...value().provisioning, apiKey: 'renewed-key' },
    }
    let release!: () => void
    let entered!: () => void
    const rotating = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { root, operations } = await harness({
      update: async () => {
        entered()
        await gate
      },
    })
    let reads = 0
    const send: typeof fetch = async input =>
      new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname ===
      '/api/auth/sign-in/email'
        ? Response.json({ token: 'test-token' })
        : Response.json(reads++ === 0 ? initial : renewed)
    const session = new DesktopEnterpriseSession(
      root,
      {
        appId: 'test.enterprise',
        productName: 'Test', enterpriseName: 'Test',
        origin: 'http://127.0.0.1',
        syncIntervalMs: 1000,
        requestTimeoutMs: 1000, authorizationTimeoutMs: 300000,
      },
      operations,
      send,
    )
    sessions.push(session)
    await session.acceptBrowserToken('test-login-token')
    await session.commit()
    const pending = session.synchronize()
    await rotating
    await vi.advanceTimersByTimeAsync(2500)
    expect(session.authorized).toBe(true)
    expect(operations.invalidate).not.toHaveBeenCalled()
    expect(session.session?.provisioning.apiKey).toBe(initial.provisioning.apiKey)
    release()
    await pending
    expect(session.session).toEqual(renewed)
  })

  it('isolates enterprise and employee IDs, and reuses directories after identity display changes', () => {
    const alice = enterpriseAccountPaths('/enterprise', value())
    expect(alice.key).toMatch(/^[a-f0-9]{64}$/u)
    const renamed = { ...value(), name: 'Renamed' }
    expect(enterpriseAccountPaths('/enterprise', renamed)).toEqual(alice)
    expect(enterpriseAccountPaths('/enterprise', value('bob')).home).not.toBe(alice.home)
    expect(enterpriseAccountPaths('/enterprise', value('alice', 'company-b')).home).not.toBe(alice.home)
    expect(enterpriseAccountPaths('/enterprise', value('../../outside')).home).toMatch(/\/accounts\/[a-f0-9]{64}$/u)
  })

  it('keeps model secrets out of shell storage and preserves projects across sign-out and sign-in', async () => {
    const { root, session } = await harness()
    await session.acceptBrowserToken('test-login-token')
    const paths = session.paths!
    await mkdir(join(paths.home, 'sessions'), { recursive: true })
    await writeFile(join(paths.home, 'sessions', 'history.txt'), 'original conversation')
    await writeEnterpriseCredentials(paths.home, { [enterpriseCredentialRef(value())]: value().provisioning.apiKey })
    await session.commit()
    expect(await readFile(join(root, 'session.bin'), 'utf8')).not.toContain('test-provider-key')
    await session.signOut()
    expect(await readFile(join(paths.home, 'sessions', 'history.txt'), 'utf8')).toBe('original conversation')
    expect(await readFile(join(root, 'session.bin'), 'utf8').catch(() => 'absent')).toBe('absent')
  })

  it('keeps cached configuration during a temporary outage and invalidates on an explicit disabled response', async () => {
    let status = 200
    const send: typeof fetch = async (input) => {
      if (
        new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname ===
        '/api/auth/sign-in/email'
      )
        return Response.json({ token: 'test-token' })
      return Response.json(status === 200 ? value() : {}, { status })
    }
    const { session, operations } = await harness({}, send)
    await session.acceptBrowserToken('test-login-token')
    await session.commit()
    status = 503
    await session.synchronize()
    expect(session.authorized).toBe(true)
    expect(operations.degraded).toHaveBeenCalledWith(true)
    expect(operations.invalidate).not.toHaveBeenCalled()
    status = 403
    await session.synchronize()
    expect(session.authorized).toBe(false)
    expect(operations.invalidate).toHaveBeenCalledWith('expired', undefined, expect.any(Promise))
  })

  it('stops at hard expiry while synchronization is waiting, and ignores a late response', async () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-10-27T00:00:00.000Z')
    vi.setSystemTime(now)
    let complete: (response: Response) => void = () => {}
    let requested = false
    const config = value()
    config.expiresAt = new Date(now + 2000).toISOString()
    const send: typeof fetch = async (input) => {
      if (
        new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname ===
        '/api/auth/sign-in/email'
      )
        return Response.json({ token: 'test-token' })
      if (!requested) {
        requested = true
        return Response.json(config)
      }
      return new Promise<Response>((resolve) => {
        complete = resolve
      })
    }
    const { root, operations } = await harness()
    const session = new DesktopEnterpriseSession(
      root,
      {
        appId: 'test.enterprise',
        productName: 'Test', enterpriseName: 'Test',
        origin: 'http://127.0.0.1',
        syncIntervalMs: 1000,
        requestTimeoutMs: 1000, authorizationTimeoutMs: 300000,
      },
      operations,
      send,
    )
    sessions.push(session)
    await session.acceptBrowserToken('test-login-token')
    await session.commit()
    const pending = session.synchronize()
    await vi.advanceTimersByTimeAsync(2000)
    expect(session.authorized).toBe(false)
    await vi.waitFor(() => {
      expect(operations.invalidate).toHaveBeenCalledTimes(1)
    })
    complete(Response.json(value()))
    await pending
    expect(operations.update).not.toHaveBeenCalled()
    expect(await readFile(join(root, 'session.bin'), 'utf8').catch(() => 'absent')).toBe('absent')
  })

  it('never accepts a different identity during synchronization', async () => {
    let reads = 0
    const { session, operations } = await harness({}, async input =>
      new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname ===
      '/api/auth/sign-in/email'
        ? Response.json({ token: 'test-token' })
        : Response.json(value(reads++ === 0 ? 'alice' : 'bob')),
    )
    await session.acceptBrowserToken('test-login-token')
    await session.commit()
    await session.synchronize()
    expect(operations.update).not.toHaveBeenCalled()
    expect(operations.invalidate).toHaveBeenCalledWith('configuration', undefined, expect.any(Promise))
  })

  it('writes new credential references before switching the complete endpoint and retains old references', async () => {
    const current = value()
    const next = {
      ...current,
      provisioning: { ...current.provisioning, baseURL: 'https://next.example.test/v1', apiKey: 'next-test-key' },
    }
    expect(enterpriseCredentialRef(next)).not.toBe(enterpriseCredentialRef(current))
    const calls: Array<{ method: string; args: Record<string, unknown> }> = []
    const send: typeof fetch = async (_input, options) => {
      const envelope = JSON.parse(typeof options?.body === 'string' ? options.body : '{}') as {
        rpcId: string
        method: string
        payload: { args: Record<string, unknown> }
      }
      calls.push({ method: envelope.method, args: envelope.payload.args })
      return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: envelope.method === 'settings/describe' ? { namespaces: [{ ns: 'agent-default-model', revision: 1, value: { provider: 'enterprise' } }] } : {} } })
    }
    await rotateEnterpriseModel('http://127.0.0.1:1234', send, next, () => true)
    expect(calls.map(call => call.method)).toEqual(['credentials/set', 'settings/mutate', 'settings/describe', 'settings/update'])
    expect(calls[1]?.args).toMatchObject({
      ops: [{ op: 'set', path: ['providers', 'enterprise'], value: { baseURL: next.provisioning.baseURL, apiKeyEnv: enterpriseCredentialRef(next) } }],
    })
    expect(calls.some(call => call.method.includes('unset'))).toBe(false)
  })
})
