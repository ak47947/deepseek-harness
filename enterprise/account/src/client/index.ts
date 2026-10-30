/** Registers enterprise account settings through the existing feature-owned Settings slot. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { DesktopEnterpriseAccountBridge } from '../types.ts'
import { EnterpriseAccountSection } from './AccountSection.tsx'
import { en, zh } from './locales.ts'
import { EnterpriseBrand, EnterpriseBrandMark } from './Brand.tsx'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { EnterpriseAccountMenu, type EnterpriseLauncherSnapshot, type EnterpriseLauncherInjected } from './AccountMenu.tsx'

/** Settings and locale services supplied by the Web client. */
export const inject = ['slots', 'locale']

/** @param ctx - Client lifecycle owning the account Settings contribution. */
export function apply(ctx: Context): void {
  const desktop = globalThis as typeof globalThis & {
    dshDesktop?: { enterpriseAccount?: DesktopEnterpriseAccountBridge }
  }
  const bridge = desktop.dshDesktop?.enterpriseAccount
  if (bridge === undefined) throw new Error('Enterprise account settings require the enterprise desktop shell')
  ctx.effect(() => ctx.locale.register('settings.enterprise', { en, zh }))
  const t = ctx.locale.bind('settings.enterprise')
  const account = createSnapshotStore<EnterpriseLauncherSnapshot>({ account: undefined, failed: false })
  let revision = 0
  let disposed = false
  const refresh = async (): Promise<void> => {
    const expected = ++revision
    try {
      const identity = await bridge.status()
      if (!disposed && expected === revision) account.set({ account: identity, failed: false })
    } catch (_error) {
      if (!disposed && expected === revision) account.set({ ...account.getSnapshot(), failed: true })
    }
  }
  ctx.effect(() => {
    const off = bridge.subscribe(() => { void refresh() })
    void refresh()
    return () => { disposed = true; revision++; off() }
  }, 'enterprise-account: identity')
  ctx.slots.inject('settings.launcher', () => ctx.slots.register({
    name: 'settings.launcher', locale: 'settings.enterprise',
    inject: (): EnterpriseLauncherInjected => ({ hooks: { account }, refresh,
      startSignIn: () => bridge.startSignIn(), signOut: () => bridge.signOut() }),
  }, EnterpriseAccountMenu))
  ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register({ name: 'sidebar.brand.name', inject: () => ({ bridge }) }, EnterpriseBrand),
  )
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark' }, EnterpriseBrandMark))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark' }, EnterpriseBrandMark))
  ctx.slots.inject('conversation.chat.running.mark', () => ctx.slots.register({ name: 'conversation.chat.running.mark' }, EnterpriseBrandMark))
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'enterprise-account',
        order: 1,
        label: () => t('title'),
        locale: 'settings.enterprise',
        inject: () => ({ hooks: { account }, refresh, signOut: () => bridge.signOut() }),
      },
      EnterpriseAccountSection,
    ),
  )
}
