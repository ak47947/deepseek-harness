// @vitest-environment jsdom
/** The assembled client owns account registrations and releases every contribution on unload. */
import { afterEach, expect, vi } from 'vitest'
import { ClientRoster, createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import type { DesktopEnterpriseAccountBridge, EnterpriseAccountView } from '../src/types.ts'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { EnterpriseAccountInjected } from '../src/client/AccountSection.tsx'

const SELF = '@deepseek-ai/dsh-client-ui-settings-enterprise-account'
const roster = ClientRoster.of([
  ...webApp.rows.filter(row => row.name !== '@deepseek-ai/dsh-client-ui-settings-account'),
  {
    name: SELF,
    inject: [
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-sidebar',
    ],
    immediately: false,
  },
])
const it = createClientTest({ roster })
afterEach(() => {
  vi.unstubAllGlobals()
})

it('registers enterprise account settings and branding, then frees their slots and dictionaries', async ({ start }) => {
  const bridge: DesktopEnterpriseAccountBridge = {
    organization: async () => 'Example organization',
    status: async () => null,
    startSignIn: async () => {},
    signOut: async () => {},
    subscribe: () => () => {},
  }
  vi.stubGlobal('dshDesktop', { enterpriseAccount: bridge })
  const client = await start()
  expect(client.ctx.slots.entries('settings.section').some(entry => entry.options.id === 'enterprise-account')).toBe(
    true,
  )
  expect(client.ctx.slots.entries('sidebar.brand.name')).toHaveLength(1)
  const settings = client.ctx.slots
    .entries('settings.section')
    .find(entry => entry.options.id === 'enterprise-account')!
  expect(resolveSlotLabel(settings.options.label)).toMatch(/Enterprise account|企业账号/u)
  if (typeof settings.inject !== 'function') throw new Error('Enterprise settings require shared account state')
  const injected = settings.inject() as EnterpriseAccountInjected & Record<string, unknown>
  await expect.poll(() => injected.hooks.account.getSnapshot()).toEqual({ account: null, failed: false })
  const launcher = client.ctx.slots.entries('settings.launcher')[0]!
  if (typeof launcher.inject !== 'function') throw new Error('Enterprise launcher requires shared account state')
  expect((launcher.inject() as EnterpriseAccountInjected & Record<string, unknown>).hooks.account).toBe(injected.hooks.account)
  for (const entry of client.ctx.slots.entries('sidebar.brand.name')) {
    if (typeof entry.inject !== 'function') throw new Error('Enterprise brand requires the shell bridge')
    expect(entry.inject()).toEqual({ bridge })
  }
  const t = client.ctx.locale.bind('settings.enterprise')
  expect(t('title')).toMatch(/Enterprise account|企业账号/u)
  await client.unload(SELF)
  await client.flush()
  expect(client.ctx.slots.entries('settings.section').some(entry => entry.options.id === 'enterprise-account')).toBe(
    false,
  )
  expect(client.ctx.slots.entries('sidebar.brand.name')).toHaveLength(0)
  expect(client.ctx.slots.entries('sidebar.brand.mark')).toHaveLength(0)
  expect(() => {
    client.ctx.locale.register('settings.enterprise', 'zh', {})()
  }).not.toThrow()
  expect(() => {
    client.ctx.locale.register('settings.enterprise', 'en', {})()
  }).not.toThrow()
}, 60000)

it('rejects an ordinary browser without the enterprise shell', async ({ start }) => {
  await expect(start()).rejects.toThrow(/enterprise|Enterprise/u)
}, 60000)

it('shares one subscription, retains identity on failure, and ignores obsolete or disposed reads', async ({ start }) => {
  const identity: EnterpriseAccountView = {
    organization: 'Example organization', name: 'Alice', email: 'alice@example.test', mode: 'basic',
    expiresAt: '2099-01-01T00:00:00.000Z', degraded: false,
  }
  const first = Promise.withResolvers<EnterpriseAccountView>()
  const status = vi.fn(async () => identity).mockImplementationOnce(() => first.promise)
  const off = vi.fn()
  let notify = () => {}
  const bridge: DesktopEnterpriseAccountBridge = {
    organization: async () => identity.organization, status, startSignIn: async () => {}, signOut: async () => {},
    subscribe: vi.fn((listener: () => void) => { notify = listener; return off }),
  }
  vi.stubGlobal('dshDesktop', { enterpriseAccount: bridge })
  const client = await start()
  const settings = client.ctx.slots.entries('settings.section').find(entry => entry.options.id === 'enterprise-account')!
  if (typeof settings.inject !== 'function') throw new Error('Enterprise settings require shared account state')
  const injected = settings.inject() as EnterpriseAccountInjected & Record<string, unknown>
  expect(bridge.subscribe).toHaveBeenCalledOnce()
  expect(injected.hooks.account.getSnapshot()).toEqual({ account: undefined, failed: false })
  notify()
  await expect.poll(() => injected.hooks.account.getSnapshot()).toEqual({ account: identity, failed: false })
  first.resolve({ ...identity, name: 'Obsolete' })
  await first.promise
  await client.flush()
  expect(injected.hooks.account.getSnapshot().account).toEqual(identity)

  const obsolete = Promise.withResolvers<EnterpriseAccountView>()
  status.mockImplementationOnce(() => obsolete.promise)
  notify()
  notify()
  await expect.poll(() => status.mock.calls.length).toBe(4)
  obsolete.reject(new Error('obsolete read failed'))
  await obsolete.promise.catch(() => undefined)
  await client.flush()
  expect(injected.hooks.account.getSnapshot()).toEqual({ account: identity, failed: false })
  status.mockRejectedValueOnce(new Error('current read failed'))
  await injected.refresh()
  expect(injected.hooks.account.getSnapshot()).toEqual({ account: identity, failed: true })
  await injected.refresh()
  expect(injected.hooks.account.getSnapshot()).toEqual({ account: identity, failed: false })

  const late = Promise.withResolvers<EnterpriseAccountView>()
  status.mockImplementationOnce(() => late.promise)
  notify()
  await client.unload(SELF)
  expect(off).toHaveBeenCalledOnce()
  late.resolve({ ...identity, name: 'Disposed' })
  await late.promise
  await client.flush()
  expect(injected.hooks.account.getSnapshot()).toEqual({ account: identity, failed: false })
}, 60000)
