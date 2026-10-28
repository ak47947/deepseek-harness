/** Real loopback callbacks with an isolated enterprise transport; approval, cancellation, and commit use explicit barriers. */
import { createHash } from 'node:crypto'
import { expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import { EnterpriseBrowserSignIn } from '../src/enterprise-browser-sign-in.ts'
import { resolveEnterpriseDesktopConfig } from '../src/enterprise-config.ts'

function fixture(accept: (token: string) => Promise<void> = async () => {}) {
  const created = Promise.withResolvers<{ callbackUrl: string; state: string; codeChallenge: string }>()
  const completed = Promise.withResolvers<undefined>()
  const open = vi.fn(async (_url: string) => {})
  let challenge = ''
  const send = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    expect(url.origin).toBe('https://enterprise.example')
    expect(new Headers(init?.headers).get('origin')).toBe('https://enterprise.example')
    if (typeof init?.body !== 'string') throw new Error('Authorization requests need JSON')
    const body: unknown = JSON.parse(init.body)
    if (url.pathname.endsWith('/authorize')) {
      const request = z.object({ callbackUrl: z.url(), state: z.string(), codeChallenge: z.string() }).parse(body)
      challenge = request.codeChallenge
      created.resolve(request)
      return Response.json({ authorizeUrl: 'https://enterprise.example/dsh/authorize?authorize_id=pending', expiresAt: Date.now() + 60000 })
    }
    const exchange = z.object({ code: z.literal('c'.repeat(43)), codeVerifier: z.string() }).parse(body)
    expect(createHash('sha256').update(exchange.codeVerifier).digest('base64url')).toBe(challenge)
    return Response.json({ token: 'desktop-session-token' })
  })
  const config = resolveEnterpriseDesktopConfig({ appId: 'example.enterprise', productName: 'Enterprise', origin: 'https://enterprise.example' }, true)!
  const flow = new EnterpriseBrowserSignIn(config, accept, () => { completed.resolve(undefined) }, open, send)
  onTestFinished(() => flow.dispose())
  return { flow, created: created.promise, completed: completed.promise, send, open }
}

it('opens enterprise browser sign-in, rejects an unrelated callback, and redirects only after the account commits', async () => {
  const accepted = Promise.withResolvers<undefined>()
  const committed = Promise.withResolvers<undefined>()
  const accept = vi.fn(async (token: string) => {
    expect(token).toBe('desktop-session-token')
    accepted.resolve(undefined)
    await committed.promise
  })
  const { flow, created, completed, open } = fixture(accept)
  const view = await flow.start('dark')
  expect(open).toHaveBeenCalledExactlyOnceWith('https://enterprise.example/dsh/authorize?authorize_id=pending&theme=dark')
  expect(await flow.start('light')).toEqual(view)
  const request = await created
  const unrelated = new URL(request.callbackUrl)
  unrelated.searchParams.set('state', 'unrelated')
  unrelated.searchParams.set('code', 'c'.repeat(43))
  expect((await fetch(unrelated)).status).toBe(400)
  expect(accept).not.toHaveBeenCalled()
  const callback = new URL(request.callbackUrl)
  callback.searchParams.set('state', request.state)
  callback.searchParams.set('code', 'c'.repeat(43))
  const response = fetch(callback, { redirect: 'manual' })
  try {
    await accepted.promise
    expect(flow.view().attempt?.phase).toBe('committing')
    await expect(flow.cancel(view.attempt!.id)).rejects.toThrow('committing')
    committed.resolve(undefined)
    const result = await response
    expect(result.status).toBe(302)
    expect(result.headers.get('location')).toBe('https://enterprise.example/dsh/authorized?login_source=desktop&theme=dark')
    await result.body?.cancel()
    await completed
    expect(flow.view().status).toBe('credential-stored')
  } finally {
    committed.resolve(undefined)
    await response.then(result => result.body?.cancel())
  }
})

it('withdraws a waiting authorization and publishes cancellation without accepting an account', async () => {
  const accept = vi.fn(async (_token: string) => {})
  const { flow } = fixture(accept)
  const listener = vi.fn<(view: AccountView) => void>()
  const off = flow.subscribe(listener)
  const view = await flow.start('light')
  const cancelled = await flow.cancel(view.attempt!.id)
  expect(cancelled.attempt?.phase).toBe('cancelled')
  expect(accept).not.toHaveBeenCalled()
  off()
  await flow.dispose()
  expect(listener.mock.lastCall?.[0].attempt?.phase).toBe('cancelled')
})

it('expires at the server deadline while the local authorization budget is longer', async () => {
  vi.useFakeTimers()
  const { flow } = fixture()
  try {
    await flow.start('light')
    await vi.advanceTimersByTimeAsync(60000)
    expect(flow.view().attempt?.phase).toBe('expired')
    expect(flow.view().status).toBe('signed-out')
  } finally {
    await flow.dispose()
    vi.useRealTimers()
  }
})
