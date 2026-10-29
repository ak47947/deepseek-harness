/** Built Desktop profile boots only prepared account state and rotates models through the real Host RPC. */
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import { DesktopHostProcess } from '../src/host-process.ts'
import { DesktopProjectManager } from '../src/project-manager.ts'
import { resolveDesktopPaths } from '../src/paths.ts'
import { enterpriseAccountPaths, enterpriseCredentialRef, prepareEnterpriseProfile, readCredentialDocument } from '../src/enterprise-profile.ts'
import { rotateEnterpriseModel } from '../src/enterprise-rpc.ts'
import { enterpriseSessionSchema, type EnterpriseSession } from '@deepseek-ai/dsh-enterprise/protocol'
import { prepareDevelopmentProject } from '../scripts/development-project.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'

const repository = fileURLToPath(new URL('../../../', import.meta.url))

async function version(path: string): Promise<string> {
  return (JSON.parse(await readFile(path, 'utf8')) as { version: string }).version
}

async function fixture(session: EnterpriseSession, sharedRoot?: string) {
  const root = sharedRoot ?? await mkdtemp(join(tmpdir(), 'dsh-enterprise-host-'))
  if (sharedRoot === undefined) onTestFinished(() => rm(root, { recursive: true, force: true }))
  const runtime = prepareDevelopmentProject({ projectDir: join(root, 'runtime-project'), cliDir: join(repository, 'apps/cli'), hostDir: join(repository, 'apps/desktop-host'),
    dependencyDir: join(repository, 'node_modules/.pnpm/node_modules'), target: 'mac-x64', release: {
      schemaVersion: 1, version: await version(join(repository, 'apps/desktop/package.json')), pnpmVersion: await version(join(repository, 'apps/desktop/node_modules/pnpm/package.json')),
      nodeVersion: process.versions.node, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    } })
  await cp(join(repository, 'packages/skill/skill-office/assets'), join(root, 'runtime/office-skills'), { recursive: true })
  const nodeBin = join(root, 'runtime/primary-runtime/dependencies/node/bin')
  await mkdir(nodeBin, { recursive: true })
  await cp(process.execPath, join(nodeBin, process.platform === 'win32' ? 'node.exe' : 'node'))
  const account = enterpriseAccountPaths(root, session)
  const manager = new DesktopProjectManager(resolveDesktopPaths(account.home), { dsh: runtime })
  await manager.applyRelease()
  await prepareEnterpriseProfile(account, session, join(repository, 'packages/client/ui-settings-enterprise-account/lib/index.js'), 'Atrix Harness')
  const host = new DesktopHostProcess(process.execPath, runtime, account.profile, undefined,
    { ...process.env, DSH_HOME: account.home, DSH_TELEMETRY_MODE: 'DISABLED' })
  onTestFinished(() => host.stop())
  const ready = await host.start()
  const auth = await fetch(ready.url, { redirect: 'manual' })
  const cookie = auth.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  await auth.body?.cancel()
  expect(cookie).not.toBe('')
  const send: typeof fetch = (input, options) => {
    const headers = new Headers(options?.headers)
    headers.set('cookie', cookie)
    return fetch(input, { ...options, headers })
  }
  const rpc = async (method: string, args: object, accepted = true) => {
    const response = await send(new URL(`/api/${method}`, ready.url), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'enterprise-acceptance', method, payload: { args } }),
    })
    expect(response.status, await response.clone().text()).toBe(200)
    const result = z.object({ result: z.object({ ok: z.boolean(), value: z.unknown().optional(), error: z.unknown().optional() }) })
      .parse(await response.json()).result
    expect(result, `${method}: ${JSON.stringify(result)}`).toMatchObject({ ok: accepted })
    return result
  }
  return { root, account, host, ready, send, rpc }
}

it('boots the built enterprise profile and keeps old credential references during live endpoint rotation', { retry: 0 }, async () => {
  const session = enterpriseSessionSchema.parse({ enterpriseId: 'company', userId: 'alice', name: 'Alice', email: 'alice@example.test', role: 'user', expiresAt: '2026-10-29T00:00:00.000Z',
    provisioning: { mode: 'basic', api: 'openai-completions', baseURL: 'https://provider.example.test/v1', apiKey: 'initial-test-key',
      models: [{ id: 'approved', name: 'Approved', contextWindow: 128000, maxTokens: 8192, input: ['text'] }], defaultModel: 'approved' } })
  const { root, account, host, ready, send, rpc } = await fixture(session)
  const personal = { api: 'openai-completions', baseURL: 'https://personal.example.test/v1', apiKeyEnv: 'PERSONAL_KEY',
    models: [{ id: 'personal-model', name: 'Personal model', contextWindow: 128000, maxTokens: 8192, input: ['text'] }] }
  await rpc('settings/mutate', { ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['providers', 'personal'], value: personal }] })
  await rpc('credentials/set', { ref: 'PERSONAL_KEY', value: 'personal-test-key' })
  await rpc('settings/update', { ns: 'agent-default-model', patch: { provider: 'personal', model: 'personal-model' } })
  const next = { ...session, provisioning: { ...session.provisioning, baseURL: 'https://next.example.test/v1', apiKey: 'rotated-test-key' } }
  await rotateEnterpriseModel(ready.url, send, next, () => true)
  const credentials = await readCredentialDocument(account.home)
  expect(credentials.refs[enterpriseCredentialRef(session)]).toBe('initial-test-key')
  expect(credentials.refs[enterpriseCredentialRef(next)]).toBe('rotated-test-key')
  expect(credentials.refs.PERSONAL_KEY).toBe('personal-test-key')
  const patch = await readFile(join(account.profile, 'cordis.patch.yml'), 'utf8')
  expect(patch).toContain('https://next.example.test/v1')
  expect(patch).not.toContain('rotated-test-key')
  const publicDocument = await (await send(new URL('/', ready.url))).text()
  expect(publicDocument).not.toContain('initial-test-key')
  expect(publicDocument).not.toContain('rotated-test-key')
  await host.stop(true)
  const restarted = await fixture(next, root)
  const described = z.object({ value: z.object({ namespaces: z.array(z.object({ ns: z.string(), value: z.unknown() })) }) })
    .parse(await restarted.rpc('settings/describe', {})).value.namespaces
  expect(described.find(row => row.ns === 'llm-pi-ai')?.value).toMatchObject({ providers: {
    personal, enterprise: { baseURL: next.provisioning.baseURL },
  } })
  expect(described.find(row => row.ns === 'agent-default-model')?.value).toMatchObject({ provider: 'personal', model: 'personal-model' })
  const providers = z.object({ providers: z.record(z.string(), z.unknown()) }).parse(described.find(row => row.ns === 'llm-pi-ai')?.value).providers
  const summary = { providers: Object.keys(providers).sort(), default: described.find(row => row.ns === 'agent-default-model')?.value }
  await expect(JSON.stringify(summary, null, 2) + '\n').toMatchFileSnapshot('./expected/enterprise-local-models.json')
  expect((await readCredentialDocument(account.home)).refs.PERSONAL_KEY).toBe('personal-test-key')
  await restarted.host.stop(true)
})

it('preserves each employee workspace and stored Session across account switching and Host restarts', { retry: 0 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-accounts-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const account = (userId: string) => enterpriseSessionSchema.parse({
    enterpriseId: 'company', userId, name: userId, email: `${userId}@example.test`, role: 'user',
    expiresAt: '2099-01-01T00:00:00.000Z', provisioning: {
      mode: 'basic', api: 'openai-completions', baseURL: 'https://provider.example.test/v1', apiKey: `test-${userId}-key`,
      models: [{ id: 'approved', name: 'Approved', contextWindow: 128000, maxTokens: 8192, input: ['text'] }],
      defaultModel: 'approved',
    },
  })
  const alice = account('alice')
  const bob = account('bob')
  const projectDirectory = join(root, 'project')
  await mkdir(projectDirectory)
  const first = await fixture(alice, root)
  const workspace = z.object({ workspace: z.object({ workspaceId: z.string() }) })
    .parse((await first.rpc('workspace/create', { request: { path: projectDirectory } })).value).workspace
  const conversation = z.object({ sessionId: z.string() })
    .parse((await first.rpc('session/create', { request: { workspaceId: workspace.workspaceId } })).value)
  expect(await first.rpc('session/rename', { request: { sessionId: conversation.sessionId, title: 'Alice private work' } }))
    .toMatchObject({ ok: true })
  await first.host.stop(true)

  const second = await fixture(bob, root)
  expect(second.account.home).not.toBe(first.account.home)
  expect((await second.rpc('session/list', { _request: {} })).value).toEqual({ items: [] })
  expect(await second.rpc('session/rename', { request: { sessionId: conversation.sessionId, title: 'Unauthorized' } }, false))
    .toMatchObject({ ok: false })
  expect(await second.rpc('workspace/rename', { request: { workspaceId: workspace.workspaceId, title: 'Unauthorized' } }, false))
    .toMatchObject({ ok: false })
  const bobSession = z.object({ sessionId: z.string() })
    .parse((await second.rpc('session/create', { request: { cwd: projectDirectory } })).value)
  expect(await second.rpc('session/rename', { request: { sessionId: bobSession.sessionId, title: 'Bob private work' } }))
    .toMatchObject({ ok: true })
  await second.host.stop(true)

  const bobRestarted = await fixture(bob, root)
  const bobList = await bobRestarted.rpc('session/list', { _request: {} })
  expect(bobList.value).toMatchObject({ items: [{ sessionId: bobSession.sessionId }] })
  expect(JSON.stringify(bobList)).not.toContain(conversation.sessionId)
  await bobRestarted.host.stop(true)

  const returned = await fixture({ ...alice, name: 'Alice renamed', email: 'renamed@example.test' }, root)
  expect(returned.account).toEqual(first.account)
  const aliceList = await returned.rpc('session/list', { _request: {} })
  expect(aliceList.value).toMatchObject({ items: [{ sessionId: conversation.sessionId }] })
  expect(JSON.stringify(aliceList)).not.toContain(bobSession.sessionId)
  expect(await returned.rpc('workspace/rename', { request: { workspaceId: workspace.workspaceId, title: 'Alice retained project' } }))
    .toMatchObject({ ok: true })
  expect(await returned.rpc('session/rename', { request: { sessionId: conversation.sessionId, title: 'Alice resumed work' } }))
    .toMatchObject({ ok: true })
  await returned.host.stop(true)
})
