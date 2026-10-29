/** Enterprise sidebar identity using the same account launcher as the official account menu. */
import { useRef, useState } from 'react'
import {
  AccountLauncher, Menu, Toast, IconSettingsOutlineMedium, IconUserOutlineMedium, LogoutIcon,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { EnterpriseAccountView } from '../types.ts'
import type {} from './locales.ts'
import css from './AccountMenu.module.css'

/** Safe identity read; a failed refresh retains the last successful identity. */
export interface EnterpriseLauncherSnapshot {
  readonly account: EnterpriseAccountView | null | undefined
  readonly failed: boolean
}

/** Native operations and registrant-owned identity source. */
export interface EnterpriseLauncherInjected {
  readonly hooks: { readonly account: SnapshotStore<EnterpriseLauncherSnapshot> }
  readonly startSignIn: () => Promise<void>
  readonly signOut: () => Promise<void>
  readonly refresh: () => Promise<void>
}

type Props = PropsRuntime<'settings.launcher'> & PropsLocale<'settings.enterprise'> & InjectFace<EnterpriseLauncherInjected>

/** @param props - Shared sidebar geometry, native actions, and locale-owned menu copy. @returns The enterprise account launcher. */
export function EnterpriseAccountMenu({ wide, openSettings, useAccount, startSignIn, signOut, refresh, t }: Props) {
  const account = useAccount(state => state.account)
  const failed = useAccount(state => state.failed)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await action() } catch (_error) { setError(true) } finally { setBusy(false) }
  }
  return <div className={css.root}>
    {error && <Toast text={t('actionFailed')} onDone={() => { setError(false) }} />}
    <Menu open={open} side="top" portal autoFocus className={css.anchor}
      anchor={<AccountLauncher ref={trigger} wide={wide} signedIn={account != null} label={account?.name ?? t('signIn')}
        ariaLabel={account == null ? t('signIn') : t('menu')} open={open} menu={account !== null}
        onClick={() => { if (account === null) void run(startSignIn); else { setOpen(value => !value); void refresh() } }} />}
      onClose={() => { setOpen(false) }} onSelect={(id) => {
        setOpen(false)
        if (id === 'sign-in') void run(startSignIn)
        else if (id === 'sign-out') void run(signOut)
        else if (id === 'settings') openSettings()
        else if (id === 'retry') void run(refresh)
      }} items={[
        ...(account == null ? [{ id: 'sign-in', label: t('signIn'), icon: <IconUserOutlineMedium size={16} />,
          disabled: busy }] : [
          { id: 'identity', label: account.email, disabled: true },
          { id: 'sign-out', label: t('signOut'), icon: <LogoutIcon />, disabled: busy },
        ]),
        { id: 'settings', label: t('settings'), icon: <IconSettingsOutlineMedium size={16} /> },
        ...(failed ? [{ id: 'retry', label: t('retry') }] : []),
      ]} />
  </div>
}
