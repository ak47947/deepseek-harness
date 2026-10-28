/** Main-process browser authorization with a private loopback receiver and cancellation-owned PKCE secrets. */
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { z } from 'zod'
import type { AccountView, SignInAttemptId, SignInAttemptView } from '@deepseek-ai/dsh-deepseek-account/types'
import type { EnterpriseDesktopConfig } from './enterprise-config.ts'

interface Attempt {
  readonly id: SignInAttemptId
  readonly state: string
  readonly verifier: string
  readonly controller: AbortController
  readonly server: Server
  timer: ReturnType<typeof setTimeout>
  busy: boolean
}

/** One shell-owned sign-in flow; safe snapshots reuse the existing welcome presentation. */
export class EnterpriseBrowserSignIn {
  private attempt: Attempt | undefined
  private snapshot: SignInAttemptView | null = null
  private readonly listeners = new Set<(view: AccountView) => void>()

  /**
   * @param config - Enterprise origin and deadlines.
   * @param accept - Verify and commit the authenticated account before reporting success.
   * @param completed - Runs after the browser receives its completion redirect.
   * @param open - Open the approved enterprise authorization URL in the system browser.
   * @param send - Main-process HTTP transport; tokens never reach the renderer.
   */
  constructor(
    private readonly config: EnterpriseDesktopConfig,
    private readonly accept: (token: string) => Promise<void>,
    private readonly completed: () => void,
    private readonly open: (url: string) => Promise<void>,
    private readonly send: typeof fetch = fetch,
  ) {}

  /** @returns A credential-free snapshot for the welcome window and account launcher. */
  view(): AccountView {
    return { status: this.snapshot?.phase === 'succeeded' ? 'credential-stored' : 'signed-out',
      links: { usageUrl: this.config.origin, topUpUrl: this.config.origin }, attempt: this.snapshot }
  }

  /** @param listener - Safe snapshot recipient. @returns Listener removal. */
  subscribe(listener: (view: AccountView) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(view: SignInAttemptView): void {
    this.snapshot = view
    for (const listener of this.listeners) {
      try { listener(this.view()) } catch (error) { console.error('Enterprise sign-in state could not be delivered', error) }
    }
  }

  /** @param theme - Resolved desktop appearance. @returns The browser-waiting state; repeated starts join the same attempt. */
  async start(theme: 'light' | 'dark'): Promise<AccountView> {
    if (this.attempt !== undefined) return this.view()
    const id = randomBytes(32).toString('base64url') as SignInAttemptId
    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(48).toString('base64url')
    const controller = new AbortController()
    const server = createServer((request, response) => {
      const attempt = this.attempt
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const code = url.searchParams.get('code')
      if (attempt?.id !== id || request.method !== 'GET' || url.pathname !== '/oauth/callback'
        || url.searchParams.get('state') !== state || code === null || !/^[A-Za-z0-9_-]{43}$/u.test(code)) {
        response.writeHead(400, { 'cache-control': 'no-store' }).end()
        return
      }
      if (attempt.busy) { response.writeHead(409).end(); return }
      attempt.busy = true
      this.publish({ id, phase: 'exchanging' })
      void (async () => {
        const payload = await this.request('/api/auth/enterprise/desktop/token', { code, codeVerifier: verifier }, controller.signal)
        const token = z.object({ token: z.string().min(1) }).parse(payload).token
        controller.signal.throwIfAborted()
        this.publish({ id, phase: 'committing' })
        clearTimeout(attempt.timer)
        await this.accept(token)
        controller.signal.throwIfAborted()
        const complete = new URL('/dsh/authorized', this.config.origin)
        complete.searchParams.set('login_source', 'desktop')
        complete.searchParams.set('theme', theme)
        response.writeHead(302, { location: complete.href, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).end()
        await this.close(attempt)
        this.publish({ id, phase: 'succeeded' })
        this.completed()
      })().catch(async (_error: unknown) => {
        if (!controller.signal.aborted) this.publish({ id, phase: 'failed', errorCode: 'network' })
        if (!response.destroyed && !response.writableEnded) {
          const failed = new URL('/dsh/authorized', this.config.origin)
          failed.searchParams.set('error', 'authorization_failed')
          failed.searchParams.set('theme', theme)
          response.writeHead(302, { location: failed.href, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).end()
        }
        await this.close(attempt)
      })
    })
    const timer = setTimeout(() => {
      void this.cancel(id, 'expired').catch((error: unknown) => { console.error('Enterprise sign-in expiry failed', error) })
    }, this.config.authorizationTimeoutMs)
    const attempt: Attempt = { id, state, verifier, controller, server, timer, busy: false }
    this.attempt = attempt
    this.publish({ id, phase: 'initializing' })
    try {
      controller.signal.throwIfAborted()
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
      })
      controller.signal.throwIfAborted()
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('Enterprise authorization receiver is unavailable')
      const payload = await this.request('/api/auth/enterprise/desktop/authorize', {
        callbackUrl: `http://127.0.0.1:${String(address.port)}/oauth/callback`, state,
        codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      }, controller.signal)
      const result = z.object({ authorizeUrl: z.url(), expiresAt: z.number() }).parse(payload)
      if (result.expiresAt <= Date.now()) throw new Error('Enterprise authorization has expired')
      clearTimeout(attempt.timer)
      attempt.timer = setTimeout(() => {
        void this.cancel(id, 'expired').catch((error: unknown) => { console.error('Enterprise sign-in expiry failed', error) })
      }, Math.min(this.config.authorizationTimeoutMs, result.expiresAt - Date.now()))
      const authorize = new URL(result.authorizeUrl)
      if (authorize.origin !== new URL(this.config.origin).origin || authorize.pathname !== '/dsh/authorize') throw new Error('Enterprise authorization destination is invalid')
      authorize.searchParams.set('theme', theme)
      controller.signal.throwIfAborted()
      this.publish({ id, phase: 'waiting-browser', authorizeUrl: authorize.href, expiresAt: result.expiresAt })
      await this.open(authorize.href)
      return this.view()
    } catch (error) {
      if (!controller.signal.aborted) this.publish({ id, phase: 'failed', errorCode: 'network' })
      await this.close(attempt)
      throw error
    }
  }

  /**
   * @param id - Local attempt identity.
   * @param phase - Cancellation or expiry.
   * @returns Settled safe view; an admitted commit must finish.
   */
  async cancel(id: SignInAttemptId, phase: 'cancelled' | 'expired' = 'cancelled'): Promise<AccountView> {
    const attempt = this.attempt
    if (attempt?.id !== id) return this.view()
    if (this.snapshot?.phase === 'committing') throw new Error('Enterprise sign-in is committing')
    attempt.controller.abort()
    this.publish({ id, phase })
    await this.close(attempt)
    return this.view()
  }

  /** @returns Closure of the receiver; listeners are released after any waiting attempt is withdrawn. */
  async dispose(): Promise<void> {
    const attempt = this.attempt
    if (attempt !== undefined) {
      attempt.controller.abort()
      await this.close(attempt)
    }
    this.listeners.clear()
  }

  private async close(attempt: Attempt): Promise<void> {
    clearTimeout(attempt.timer)
    await new Promise<void>((resolve, reject) => {
      attempt.server.close((error) => { if (error && !('code' in error && error.code === 'ERR_SERVER_NOT_RUNNING')) reject(error); else resolve() })
      if ('closeAllConnections' in attempt.server && typeof attempt.server.closeAllConnections === 'function') {
        attempt.server.closeAllConnections()
      } else {
        attempt.server.closeIdleConnections()
      }
    })
    if (this.attempt === attempt) this.attempt = undefined
  }

  private async request(path: string, body: object, signal: AbortSignal): Promise<unknown> {
    const response = await this.send(new URL(path, this.config.origin), { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', origin: new URL(this.config.origin).origin }, body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.requestTimeoutMs)]) })
    if (!response.ok) { await response.body?.cancel(); throw new Error('Enterprise authorization request failed') }
    return response.json()
  }
}
