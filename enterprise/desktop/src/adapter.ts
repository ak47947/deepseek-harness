/** Enterprise sign-in and account lifecycle composed with the Electron shell through explicit operations. */
import { join } from 'node:path'
import { app, clipboard, dialog, ipcMain, nativeTheme, powerMonitor, safeStorage, session, shell, type BrowserWindow, type IpcMainInvokeEvent, type Session } from 'electron'
import type { AccountView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
import type { EnterpriseSession } from '@deepseek-ai/dsh-enterprise-protocol'
import { DesktopEnterpriseSession } from './enterprise-session.ts'
import { EnterpriseBrowserSignIn } from './enterprise-browser-sign-in.ts'
import { assertEnterpriseProfile, prepareEnterpriseProfile, writeEnterpriseCredentials } from './enterprise-profile.ts'
import { rotateEnterpriseModel } from './enterprise-rpc.ts'
import { ENTERPRISE_IPC, enterpriseSignInNotice } from './enterprise-window.ts'
import type { EnterpriseDesktopConfig } from './enterprise-config.ts'

/** Credential-free welcome actions supplied to the shell-owned native window. */
export interface EnterpriseWelcomeOperations {
  readonly enterprise: true
  /** @returns False because native sign-in runs before Host analytics is available. */
  analyticsEnabled(): Promise<boolean>
  /** @returns No official-account notice. */
  takeNotice(): Promise<undefined>
  /** @returns The browser authorization view after starting the attempt. */
  startSignIn(): Promise<AccountView>
  /** @param id - Owned authorization attempt. @returns The settled authorization view. */
  cancelSignIn(id: SignInAttemptId): Promise<AccountView>
  /** @param id - Current attempt. @returns Completion after its public authorization URL is copied. */
  copySignInLink(id: SignInAttemptId): Promise<void>
  /** @param value - Rejected manual key input. @returns A failed write without accepting the key. */
  saveApiKey(value: string): Promise<{ ok: false }>
  /** @returns A rejection because enterprise authentication is required. */
  skip(): Promise<void>
}

/** Desktop capabilities retained by the shell; enterprise policy stays in this package. */
export interface EnterpriseDesktopOperations {
  /** @param operations - Credential-free welcome actions. @returns The visible shell-owned window. */
  openWelcome(operations: EnterpriseWelcomeOperations): Promise<BrowserWindow>
  /** @returns The current welcome window, absent after it closes. */
  welcomeWindow(): BrowserWindow | undefined
  /** @param window - New window ownership, or undefined after closure. */
  setWelcomeWindow(window: BrowserWindow | undefined): void
  /** @returns The current primary-window focus operation. */
  focusHandler(): () => void
  /** @param focus - Primary-window focus operation to install. */
  setFocusHandler(focus: () => void): void
  /** @returns Whether shutdown prevents further activation or restart. */
  isStopping(): boolean
  /** @returns Completion after Host and tasks have stopped; failure prevents account switching. */
  stopHost(): Promise<void>
  /** @param home - Authenticated account home. @returns Completion after its standard profile is prepared. */
  prepareRelease(home: string): Promise<void>
  /** @returns The selected installed Desktop runtime directory. */
  runtimeDirectory(): string
  /** @param channel - Credential-free account invalidation channel for the owned main frame. */
  publishAccount(channel: string): void
  /** @param error - Failure requiring the shell fatal-recovery path. */
  failure(error: unknown): void
  /** Quit without requesting another task confirmation. */
  quit(): void
}

/**
 * Compose enterprise authentication before opening account data or restoring Host work.
 * @param config - Explicit enterprise distribution settings.
 * @param operations - Shell-owned windows and Host lifecycle operations.
 * @returns Account selection, profile preparation, authenticated updates, and quiescent disposal.
 */
export function createEnterpriseDesktop(config: EnterpriseDesktopConfig, operations: EnterpriseDesktopOperations) {
  let browser: Session | undefined
  let updateModel: ((value: EnterpriseSession) => Promise<void>) | undefined
  let degraded = false
  let choosingWorkspace = true
  let restartAfterAuthorization = false
  let disposal: Promise<void> | undefined
  const selectedWorkspace = Promise.withResolvers<undefined>()
  const profileCommitted = Promise.withResolvers<undefined>()
  const account = new DesktopEnterpriseSession(join(app.getPath('userData'), 'enterprise'), config, {
    encrypt: (value) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Enterprise desktop: secure credential storage is unavailable')
      return safeStorage.encryptString(value)
    },
    decrypt: value => safeStorage.decryptString(value),
    degraded: (value) => { degraded = value; operations.publishAccount('dsh-enterprise:changed') },
    failure: operations.failure,
    update: (value) => {
      if (updateModel === undefined) return Promise.reject(new Error('Enterprise desktop: Host is unavailable during model synchronization'))
      return updateModel(value)
    },
    invalidate: async (reason, updating, clearSaved) => {
      await operations.stopHost()
      await updating?.catch(() => undefined)
      const paths = account.paths
      const results = await Promise.allSettled([clearSaved, paths === undefined ? undefined : writeEnterpriseCredentials(paths.home, {}),
        browser?.clearStorageData(), browser?.clearCache()])
      const failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw new Error('Enterprise desktop: work stopped, but sign-out cleanup failed; retry after checking local storage', { cause: failure.reason })
      if (operations.isStopping()) return
      if (reason !== 'signed-out') await dialog.showMessageBox({ type: 'info', title: config.productName,
        message: enterpriseSignInNotice(app.getLocale(), reason) })
      app.relaunch()
      operations.quit()
    },
  })
  const authorization = new EnterpriseBrowserSignIn(config, async (token) => {
    const authenticated = await account.acceptBrowserToken(token)
    try {
      if (choosingWorkspace) {
        selectedWorkspace.resolve(undefined)
        await profileCommitted.promise
      } else {
        const paths = account.paths
        if (paths === undefined) throw new Error('Enterprise desktop: authenticated account is unavailable')
        await account.prepareAndCommit(async () => {
          await operations.prepareRelease(paths.home)
          await prepareEnterpriseProfile(paths, authenticated, config.productName)
          assertEnterpriseProfile(paths, operations.runtimeDirectory())
        })
        restartAfterAuthorization = true
      }
    } catch (error) {
      operations.failure(error)
      throw error
    }
  }, () => {
    if (restartAfterAuthorization && !operations.isStopping()) {
      try { app.relaunch(); operations.quit() } catch (error) { operations.failure(error) }
    }
  }, url => shell.openExternal(url))
  const openWelcome = async (): Promise<BrowserWindow> => {
    const previousFocus = operations.focusHandler()
    const window = await operations.openWelcome({
      enterprise: true, analyticsEnabled: () => Promise.resolve(false), takeNotice: () => Promise.resolve(undefined),
      startSignIn: () => authorization.start(nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
      cancelSignIn: id => authorization.cancel(id),
      copySignInLink: async (id) => {
        const attempt = authorization.view().attempt
        if (attempt?.id !== id || attempt.authorizeUrl === undefined) throw new Error('Enterprise desktop: authorization link is unavailable')
        clipboard.writeText(attempt.authorizeUrl)
      },
      saveApiKey: () => Promise.resolve({ ok: false }),
      skip: () => Promise.reject(new Error('Enterprise desktop: sign in before opening a workspace')),
    })
    window.once('closed', () => {
      if (operations.welcomeWindow() === window) operations.setWelcomeWindow(undefined)
      if (operations.focusHandler() === focusWelcome) operations.setFocusHandler(previousFocus)
      if (choosingWorkspace) {
        selectedWorkspace.resolve(undefined)
        profileCommitted.resolve(undefined)
        operations.quit()
      } else {
        const attempt = authorization.view().attempt
        if (attempt !== null && ['initializing', 'waiting-browser', 'exchanging'].includes(attempt.phase)) {
          void authorization.cancel(attempt.id).catch((error: unknown) => { console.error(error) })
        }
      }
    })
    const focusWelcome = () => { if (!window.isDestroyed()) { window.show(); window.focus() } }
    operations.setFocusHandler(focusWelcome)
    return window
  }
  const offAuthorization = authorization.subscribe((view) => {
    const window = operations.welcomeWindow()
    if (window !== undefined && !window.isDestroyed()) window.webContents.send('dsh-welcome:state', view)
    operations.publishAccount('dsh-enterprise:changed')
  })
  let startup: { session: EnterpriseSession; paths: NonNullable<DesktopEnterpriseSession['paths']> } | undefined
  const requireStartup = () => {
    if (startup === undefined || !account.authorized) throw new Error('Enterprise desktop: sign in before opening a workspace')
    return startup
  }
  const sync = (): void => { void account.synchronize().catch(operations.failure) }
  const channels: string[] = []
  const dispose = (): Promise<void> => disposal ??= (async () => {
    profileCommitted.resolve(undefined)
    selectedWorkspace.resolve(undefined)
    offAuthorization()
    powerMonitor.off('resume', sync)
    app.off('will-quit', onQuit)
    for (const channel of channels) ipcMain.removeHandler(channel)
    await Promise.all([authorization.dispose(), account.dispose()])
  })()
  const onQuit = (): void => { void dispose().catch(operations.failure) }
  app.on('will-quit', onQuit)
  return {
    async initialize(): Promise<boolean> {
      if (!await account.restore()) {
        operations.setWelcomeWindow(await openWelcome())
        await selectedWorkspace.promise
        if (operations.isStopping() || disposal !== undefined) return false
      }
      choosingWorkspace = false
      const paths = account.paths
      const current = account.session
      if (paths === undefined || current === undefined || !account.authorized) throw new Error('Enterprise desktop: sign in before opening a workspace')
      startup = { session: current, paths }
      browser = session.fromPartition(`persist:dsh-enterprise-${paths.key}`)
      return true
    },
    get home(): string { return requireStartup().paths.home },
    get browserSession(): Session {
      if (browser === undefined) throw new Error('Enterprise desktop: account browser is unavailable')
      return browser
    },
    assertAuthorized(): void { requireStartup() },
    async prepareHost(): Promise<void> {
      const selected = requireStartup()
      await account.prepareAndCommit(async () => {
        await prepareEnterpriseProfile(selected.paths, selected.session, config.productName)
        assertEnterpriseProfile(selected.paths, operations.runtimeDirectory())
      })
      profileCommitted.resolve(undefined)
    },
    async hostStarted(url: string, stop: () => Promise<void>): Promise<void> {
      if (!account.authorized) { await stop(); throw new Error('Enterprise desktop: account expired during Host startup') }
      const transport = this.browserSession
      updateModel = value => rotateEnterpriseModel(url,
        (input, init) => transport.fetch(input instanceof URL ? input.href : input, init), value, () => account.authorized)
      account.startSynchronization()
      powerMonitor.off('resume', sync)
      powerMonitor.on('resume', sync)
    },
    hostStopped(): void { updateModel = undefined },
    async welcomeState(readLocale: () => Promise<string | null>) {
      return { loggedIn: true, hasApiKey: true, writable: false, localePreference: await readLocale() }
    },
    bindApplication(assertSender: (event: IpcMainInvokeEvent) => void, confirmQuit: () => Promise<boolean>): void {
      const handle = (channel: string, action: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
        ipcMain.handle(channel, (event, ...args: unknown[]) => { assertSender(event); return action(event, ...args) })
        channels.push(channel)
      }
      handle(ENTERPRISE_IPC.organization, () => config.enterpriseName)
      handle(ENTERPRISE_IPC.account, () => {
        const current = account.session
        return current === undefined ? null : { organization: config.enterpriseName, name: current.name, email: current.email,
          mode: current.provisioning.mode, expiresAt: current.expiresAt, degraded }
      })
      handle(ENTERPRISE_IPC.signOut, async () => { if (await confirmQuit()) await account.signOut() })
      handle(ENTERPRISE_IPC.start, async () => {
        const window = operations.welcomeWindow()
        if (window === undefined || window.isDestroyed()) operations.setWelcomeWindow(await openWelcome())
        return authorization.start(nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
      })
      handle(ENTERPRISE_IPC.state, () => authorization.view())
      handle(ENTERPRISE_IPC.cancel, (_event, id) => {
        if (typeof id !== 'string') throw new Error('Enterprise desktop: invalid sign-in attempt')
        return authorization.cancel(id as SignInAttemptId)
      })
    },
    openWelcome,
    releaseStartup(): void { profileCommitted.resolve(undefined) },
    dispose,
  }
}
