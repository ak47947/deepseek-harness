/** Shared sidebar identity button for official and enterprise account menus. */
import { forwardRef } from 'react'
import { IconEllipsisOutlineMedium, IconUserOutlineMedium } from './icons/index.tsx'
import css from './AccountLauncher.module.css'
import { Tooltip } from './Tooltip.tsx'

/** Locale-owned labels and credential-free identity supplied by the account feature. */
export interface AccountLauncherProps {
  readonly wide: boolean
  readonly signedIn: boolean
  readonly label: string | null
  readonly ariaLabel: string
  readonly open: boolean
  /** Whether activation opens an account menu; false is a direct sign-in action. */
  readonly menu?: boolean
  readonly avatarUrl?: string | undefined
  readonly avatarStatus?: string | undefined
  readonly onAvatarError?: (() => void) | undefined
  readonly onClick: () => void
}

/** @param props - Identity, sidebar geometry, and menu action. @param ref - Menu focus anchor. @returns The shared account row. */
export const AccountLauncher = forwardRef<HTMLButtonElement, AccountLauncherProps>(function AccountLauncher({
  wide, signedIn, label, ariaLabel, open, avatarUrl, avatarStatus, onAvatarError, onClick, menu = true,
}, ref) {
  return <Tooltip label={label ?? ariaLabel} disabled={wide || open} portal>
    <button ref={ref} type="button" className={css.trigger} data-collapsed={!wide} data-signed-out={!signedIn}
      aria-label={ariaLabel} aria-haspopup={menu ? 'menu' : undefined} aria-expanded={menu ? open : undefined} onClick={onClick}>
      {signedIn ? <span className={css.avatar} data-avatar-status={avatarStatus}>
        {avatarUrl === undefined ? <IconUserOutlineMedium size={16} />
          : <img className={css.image} src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={onAvatarError} />}
      </span> : <IconEllipsisOutlineMedium size={14} />}
      {wide && <span className={css.label}>{label}</span>}
    </button>
  </Tooltip>
})
