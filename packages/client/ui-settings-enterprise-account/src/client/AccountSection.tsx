/** Pure account settings presentation over the shell-owned account source. */
import { useState } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { EnterpriseLauncherSnapshot } from './AccountMenu.tsx'
import type {} from './locales.ts'
import css from './AccountSection.module.css'

/** Shell operations injected by the account settings plugin. */
export interface EnterpriseAccountInjected {
  readonly hooks: { readonly account: SnapshotStore<EnterpriseLauncherSnapshot> }
  /** @returns Completion after publishing the latest identity or recording a failed read. */
  readonly refresh: () => Promise<void>
  /** @returns Native sign-out completion; cancellation retains identity and cleanup failures reject. */
  readonly signOut: () => Promise<void>
}
type Props = PropsRuntime<'settings.section'> &
  PropsLocale<'settings.enterprise'> &
  InjectFace<EnterpriseAccountInjected>

/** @param props - Shared account state, shell actions, and locale-owned copy. @returns Account metadata and native sign-out action. */
export function EnterpriseAccountSection({ useAccount, refresh, signOut, t }: Props) {
  const { account, failed } = useAccount(value => value)
  const [busy, setBusy] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)
  const leave = async () => {
    setBusy(true)
    setSignOutFailed(false)
    try {
      await signOut()
    } catch (_error) {
      setSignOutFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={css.section}>
      {account === undefined && !failed && (
        <div className={css.loading}>
          <StateDot state="ongoing" size={24} />
        </div>
      )}
      {account != null && (
        <>
          <div>{account.organization}</div>
          <div className={css.name}>{account.name}</div>
          <div>{account.email}</div>
          <div>{t(account.mode)}</div>
          {account.degraded && <p role="status">{t('degraded')}</p>}
          <Button
            disabled={busy}
            onClick={() => {
              void leave()
            }}
          >
            {t('signOut')}
          </Button>
        </>
      )}
      {(failed || account === null) && (
        <div role="alert">
          <p>{t('unavailable')}</p>
          <Button
            onClick={() => {
              void refresh()
            }}
          >
            {t('retry')}
          </Button>
        </div>
      )}
      {signOutFailed && <p role="alert">{t('failed')}</p>}
    </div>
  )
}
