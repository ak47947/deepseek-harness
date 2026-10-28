/** Shell-owned authentication, encrypted session recovery, expiry enforcement, and serialized configuration synchronization. */
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  enterpriseSessionSchema,
  EnterpriseRequestError,
  type EnterpriseSession,
} from '@deepseek-ai/dsh-enterprise/protocol'
import type { EnterpriseDesktopConfig } from './enterprise-config.ts'
import {
  enterpriseAccountPaths,
  enterpriseCredentialRef,
  readCredentialDocument,
  writeEnterpriseCredentials,
  type EnterpriseAccountPaths,
} from './enterprise-profile.ts'

const cachedSchema = z.object({
  token: z.string().min(1),
  session: enterpriseSessionSchema,
  ref: z.string().regex(/^DSH_ENT_KEY_[A-F0-9]{64}$/u),
})

/** Electron and Host operations whose lifetime is owned by the shell. */
export interface EnterpriseSessionOperations {
  encrypt(text: string): Buffer
  decrypt(bytes: Buffer): string
  /** Credentials are written before provider settings; old references remain until the Host stops. */
  update(session: EnterpriseSession): Promise<void>
  /** Stops the Host, clears credentials and renderer storage, then returns to sign-in. */
  invalidate(
    reason: 'expired' | 'configuration' | 'signed-out',
    updating: Promise<void> | undefined,
    clearSaved: Promise<void>,
  ): Promise<void>
  /** Persistent degraded state; transport errors never imply successful synchronization. */
  degraded(value: boolean): void
  /** Report an owned background operation that could not reach a safe stopped state. */
  failure(error: unknown): void
}

/** One authenticated account; invalidation preempts in-flight synchronization and cannot publish a late result. */
export class DesktopEnterpriseSession {
  private account: { token: string; session: EnterpriseSession } | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private expiryTimer: ReturnType<typeof setTimeout> | undefined
  private sync: Promise<void> | undefined
  private request: AbortController | undefined
  private closed = false
  private invalidation: Promise<void> | undefined
  private running = false
  private unreadableSavedSession = false
  private updating: Promise<void> | undefined

  /**
   * @param root - Enterprise shell data root.
   * @param config - Validated deployment choices.
   * @param operations - Encryption and Host lifecycle owner.
   * @param send - Authenticated HTTP transport, without shared browser cookies.
   * @param now - Wall clock used for hard expiry.
   */
  constructor(
    readonly root: string,
    readonly config: EnterpriseDesktopConfig,
    private readonly operations: EnterpriseSessionOperations,
    private readonly send: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Authenticated account metadata; tokens remain private. */
  get session(): EnterpriseSession | undefined {
    return this.account?.session
  }
  /** A corrupt or unreadable cached login was removed; a fresh sign-in preserves account history. */
  get restoreIssue(): boolean {
    return this.unreadableSavedSession
  }
  /** Whether startup and configuration writes are still authorized at the local wall clock. */
  get authorized(): boolean {
    return !this.closed && this.account !== undefined && !this.expired()
  }
  /** Account-owned Harness paths, absent until authentication succeeds. */
  get paths(): EnterpriseAccountPaths | undefined {
    return this.account === undefined ? undefined : enterpriseAccountPaths(this.root, this.account.session)
  }

  /**
   * Recover only a previously encrypted identity. A temporary outage permits cached configuration until its hard expiry.
   * @returns True when an account is authorized; false requires the native sign-in form.
   */
  async restore(): Promise<boolean> {
    let encrypted: Buffer
    try {
      encrypted = await readFile(join(this.root, 'session.bin'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
    let stored: z.infer<typeof cachedSchema>
    try {
      stored = cachedSchema.parse(JSON.parse(this.operations.decrypt(encrypted)))
    } catch (_error) {
      await this.clearSaved()
      this.unreadableSavedSession = true
      return false
    }
    const paths = enterpriseAccountPaths(this.root, stored.session)
    const credentials = await readCredentialDocument(paths.home)
    const apiKey = credentials.refs[stored.ref]
    this.account = { token: stored.token, session: stored.session }
    if (this.expired() || apiKey === undefined) {
      await this.clearSaved()
      await writeEnterpriseCredentials(paths.home, {})
      this.account = undefined
      return false
    }
    this.account.session = { ...stored.session, provisioning: { ...stored.session.provisioning, apiKey } }
    try {
      this.account.session = await this.readSession(stored.token)
    } catch (error) {
      if (error instanceof EnterpriseRequestError && [401, 403].includes(error.status)) {
        await this.clearSaved()
        await writeEnterpriseCredentials(paths.home, {})
        this.account = undefined
        return false
      }
      if (!(error instanceof EnterpriseRequestError) || (error.status !== 0 && error.status < 500)) throw error
      this.operations.degraded(true)
    }
    if (
      this.account.session.enterpriseId !== stored.session.enterpriseId ||
      this.account.session.userId !== stored.session.userId
    )
      throw new Error('Enterprise desktop: restored identity does not match the authenticated account')
    if (this.expired()) {
      await this.clearSaved()
      this.account = undefined
      return false
    }
    await this.persist()
    this.armExpiry()
    return true
  }

  /**
   * @param token - Main-process token obtained through PKCE exchange.
   * @returns Validated identity and model assignment before any local commit.
   */
  async acceptBrowserToken(token: string): Promise<EnterpriseSession> {
    if (this.closed || this.account !== undefined) throw new Error('Enterprise desktop: sign-in is unavailable')
    const session = await this.readSession(token)
    if (this.isClosed() || Date.parse(session.expiresAt) <= this.now()) throw new EnterpriseRequestError(401)
    this.account = { token, session }
    this.armExpiry()
    return session
  }

  /** Persist after account profile preparation succeeds and before the Host starts. */
  async commit(): Promise<void> {
    if (this.account === undefined || this.expired() || this.closed) throw new EnterpriseRequestError(401)
    await this.persist()
    if (!this.authorized) throw new EnterpriseRequestError(401)
    this.armExpiry()
  }

  /**
   * Keep invalidation waiting until account-profile and credential writes finish, then persist the login.
   * @param prepare - Account-owned writes while its Host remains stopped.
   * @returns A committed sign-in; invalidation prevents commit and clears credentials after these writes settle.
   */
  async prepareAndCommit(prepare: () => Promise<void>): Promise<void> {
    if (!this.authorized) throw new EnterpriseRequestError(401)
    const updating = (async () => { await prepare(); await this.commit() })()
    this.updating = updating
    try { await updating } finally { if (this.updating === updating) this.updating = undefined }
  }

  /** Start periodic synchronization only after the Host can accept configuration writes. */
  startSynchronization(): void {
    if (!this.authorized) throw new EnterpriseRequestError(401)
    this.running = true
    this.schedule()
  }

  /** @returns One synchronization attempt; overlapping wake and periodic requests share it. */
  synchronize(): Promise<void> {
    if (this.closed || this.account === undefined) return this.invalidation ?? Promise.resolve()
    if (this.expired()) return this.invalidate('expired')
    if (this.sync !== undefined) return this.sync
    const account = this.account
    const pending = (async () => {
      let next: EnterpriseSession
      try {
        next = await this.readSession(account.token)
      } catch (error) {
        if (this.isClosed()) {
          await this.invalidation
          return
        }
        if (error instanceof EnterpriseRequestError && [401, 403].includes(error.status)) {
          await this.invalidate('expired')
          return
        }
        if (!(error instanceof EnterpriseRequestError) || (error.status !== 0 && error.status < 500)) {
          await this.invalidate('configuration')
          return
        }
        this.operations.degraded(true)
        if (this.expired()) await this.invalidate('expired')
        return
      }
      if (this.isClosed()) {
        await this.invalidation
        return
      }
      if (next.enterpriseId !== account.session.enterpriseId || next.userId !== account.session.userId) {
        await this.invalidate('configuration')
        return
      }
      if (Date.parse(next.expiresAt) <= this.now()) {
        await this.invalidate('expired')
        return
      }
      // A verified renewal extends authorization even while Host configuration writes are pending.
      account.session = { ...account.session, expiresAt: next.expiresAt }
      this.armExpiry()
      try {
        const updating = (async () => {
          if (JSON.stringify(next.provisioning) !== JSON.stringify(account.session.provisioning)) {
            await this.operations.update(next)
          }
          if (this.isClosed()) return
          this.account = { token: account.token, session: next }
          await this.persist()
          if (this.isClosed()) return
          this.operations.degraded(false)
        })()
        this.updating = updating
        try {
          await updating
        } finally {
          if (this.updating === updating) this.updating = undefined
        }
        if (this.isClosed()) await this.invalidation
      } catch (_error) {
        await this.invalidate('configuration')
      }
    })().finally(() => {
      if (this.sync === pending) this.sync = undefined
      this.schedule()
    })
    this.sync = pending
    return pending
  }

  /** Revoke the enterprise login best-effort; local invalidation always owns stopping work and clearing credentials. */
  async signOut(): Promise<void> {
    const token = this.account?.token
    if (token !== undefined) {
      try {
        const response = await this.fetch('/api/auth/sign-out', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: '{}',
        })
        await response.body?.cancel()
      } catch (_error) {
        /* Local sign-out must remain available during an outage; the server session retains its hard expiry. */
      }
    }
    await this.invalidate('signed-out')
  }

  /** Stop shell timers and network operations on application exit without logging the employee out. */
  async dispose(): Promise<void> {
    this.closed = true
    clearTimeout(this.timer)
    clearTimeout(this.expiryTimer)
    this.request?.abort()
    // Their callers report rejected synchronization and sign-in work; shutdown still waits for their writes.
    await Promise.allSettled([this.sync, this.updating])
    await this.invalidation
  }

  private isClosed(): boolean {
    return this.closed
  }
  private expired(): boolean {
    return this.account !== undefined && Date.parse(this.account.session.expiresAt) <= this.now()
  }
  private schedule(): void {
    clearTimeout(this.timer)
    if (!this.closed && this.running)
      this.timer = setTimeout(() => {
        void this.synchronize().catch((error: unknown) => {
          this.operations.failure(error)
        })
      }, this.config.syncIntervalMs)
  }
  private armExpiry(): void {
    clearTimeout(this.expiryTimer)
    if (this.account === undefined || this.closed) return
    this.expiryTimer = setTimeout(
      () => {
        if (this.expired())
          void this.invalidate('expired').catch((error: unknown) => {
            this.operations.failure(error)
          })
        else this.armExpiry()
      },
      Math.min(2_147_483_647, Math.max(0, Date.parse(this.account.session.expiresAt) - this.now())),
    )
  }
  private invalidate(reason: 'expired' | 'configuration' | 'signed-out'): Promise<void> {
    if (this.invalidation !== undefined) return this.invalidation
    this.closed = true
    clearTimeout(this.timer)
    clearTimeout(this.expiryTimer)
    this.request?.abort()
    const updating = this.updating
    const clearSaved = this.clearSaved()
    // Register the observer immediately; Host shutdown must still run if local session deletion fails.
    void clearSaved.catch((_error: unknown) => {})
    this.invalidation = this.operations.invalidate(reason, updating, clearSaved)
    return this.invalidation
  }
  private async persist(): Promise<void> {
    if (this.account === undefined) throw new Error('Enterprise desktop: account is unavailable')
    const { session, token } = this.account
    const cached = {
      token,
      session: { ...session, provisioning: { ...session.provisioning, apiKey: 'stored-in-account-home' } },
      ref: enterpriseCredentialRef(session),
    }
    await writeFileAtomic(join(this.root, 'session.bin'), this.operations.encrypt(JSON.stringify(cached)), {
      mode: 0o600,
      dirMode: 0o700,
    })
    if (this.invalidation !== undefined) await this.clearSaved()
  }
  private clearSaved(): Promise<void> {
    return rm(join(this.root, 'session.bin'), { force: true })
  }
  private async readSession(token: string): Promise<EnterpriseSession> {
    const response = await this.fetch('/v1/session', { headers: { authorization: `Bearer ${token}` } })
    const result = enterpriseSessionSchema.safeParse(await response.json())
    if (!result.success) throw new EnterpriseRequestError(422)
    return result.data
  }
  private async fetch(path: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController()
    this.request = controller
    // Better Auth requires the trusted deployment origin even for main-process requests.
    const headers = new Headers(options.headers)
    headers.set('origin', this.config.origin)
    let response: Response
    try {
      response = await this.send(new URL(path, this.config.origin), {
        ...options,
        headers,
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(this.config.requestTimeoutMs)]),
      })
    } catch (_error) {
      throw new EnterpriseRequestError(0)
    } finally {
      if (this.request === controller) this.request = undefined
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new EnterpriseRequestError(response.status)
    }
    return response
  }
}
