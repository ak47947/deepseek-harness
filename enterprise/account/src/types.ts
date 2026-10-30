/** Shell-owned account metadata; login tokens and model credentials are excluded. */
export interface EnterpriseAccountView {
  readonly organization: string
  readonly name: string
  readonly email: string
  readonly mode: 'basic' | 'managed'
  readonly expiresAt: string
  readonly degraded: boolean
}

/** Main-process account operations available only through the desktop preload. */
export interface DesktopEnterpriseAccountBridge {
  /** @returns Configured enterprise display name, including before sign-in. */
  readonly organization: () => Promise<string>
  /** @returns Authenticated shell metadata, or null before enterprise sign-in. */
  readonly status: () => Promise<EnterpriseAccountView | null>
  /** @returns Completion after the enterprise authorization page opens in the browser. */
  readonly startSignIn: () => Promise<void>
  /** Request the native task confirmation, stop the Host, and return to sign-in; cancellation retains the account. */
  readonly signOut: () => Promise<void>
  /** @param listener - Metadata invalidation notification. @returns Listener removal. */
  readonly subscribe: (listener: () => void) => () => void
}
