/** Browser acceptance uses real enterprise endpoints and an explicitly local signing OIDC provider. */
import { createServer, request as forward, type Server } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import { fixture } from './fixtures/enterprise.ts'
import { oidcProvider } from './fixtures/oidc.ts'

async function listen(server: Server): Promise<number> {
  onTestFinished(() => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Browser fixture did not bind')
  return address.port
}

it.each(['en-US', 'zh-CN'])('binds an employee, signs in through OIDC, and clears sessions in %s', { retry: 0 }, async (locale) => {
  const zh = locale === 'zh-CN'
  const provider = await oidcProvider('https://idp.example.test')
  const route: { target?: string } = {}
  const proxy = createHttpsServer({
    key: await readFile(new URL('./fixtures/tls/localhost-key.pem', import.meta.url)),
    cert: await readFile(new URL('./fixtures/tls/localhost-cert.pem', import.meta.url)),
  }, (request, response) => {
    if (route.target === undefined) { response.writeHead(503).end(); return }
    const upstream = forward(new URL(request.url ?? '/', route.target), { method: request.method, headers: request.headers }, incoming => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers); incoming.pipe(response)
    })
    upstream.on('error', () => response.destroy()); request.pipe(upstream)
  })
  const origin = `https://127.0.0.1:${String(await listen(proxy))}`
  const service = await fixture('basic', fetch, { ...provider.environment, DSH_ENTERPRISE_ORIGIN: origin, DSH_ENTERPRISE_PASSWORD_ENABLED: '0' })
  route.target = service.origin
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const administrator = await browser.newContext({ locale, ignoreHTTPSErrors: true })
  const page = await administrator.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/admin?lang=${zh ? 'zh' : 'en'}#users`)
  await page.locator('#login-form [name=email]').fill('admin@example.test')
  await page.locator('#login-form [name=password]').fill('test-admin-password')
  await page.locator('#login-form button').click()
  await page.locator('#primary-action').click()
  const editor = page.locator('#editor')
  expect(await editor.locator('[name=password]').isVisible()).toBe(false)
  await editor.locator('[name=role]').selectOption('admin')
  expect(await editor.locator('[name=password]').isVisible()).toBe(true)
  await editor.locator('[name=role]').selectOption('user')
  expect(await editor.locator('[name=password]').isVisible()).toBe(false)
  await editor.locator('[name=name]').fill('Alice')
  await editor.locator('[name=email]').fill('alice@example.test')
  await editor.locator('#editor-save').click()
  const row = page.locator('#employees tr').filter({ hasText: 'alice@example.test' })
  await row.waitFor()
  const employee = z.object({ id: z.string() }).parse((await service.pool.query('SELECT id FROM "user" WHERE email = \'alice@example.test\'')).rows[0])
  await row.locator('summary').click()
  await row.getByRole('button', { name: zh ? '统一登录身份' : 'SSO identity', exact: true }).click()
  await editor.locator('[name=subject]').fill(provider.controls.subject)
  expect(await editor.locator('[name=issuer]').inputValue()).toBe(provider.issuer)
  await expect((await editor.ariaSnapshot()) + '\n').toMatchFileSnapshot(join(import.meta.dirname, 'expected', `oidc-binding-${locale}.aria.txt`))
  await editor.locator('#editor-save').click()
  await expect.poll(() => page.locator('#notice').textContent()).toBe(zh ? '更改已保存。' : 'Changes saved.')

  const received = Promise.withResolvers<URL>()
  const receiver = createServer((request, response) => {
    received.resolve(new URL(request.url ?? '/', 'http://127.0.0.1'))
    response.writeHead(200, { 'content-type': 'text/html' }).end('<p>Desktop authorization received</p>')
  })
  const callbackUrl = `http://127.0.0.1:${String(await listen(receiver))}/oauth/callback`
  const verifier = randomBytes(48).toString('base64url')
  const state = randomBytes(32).toString('base64url')
  const pending = await service.request('/api/auth/enterprise/desktop/authorize', undefined, { callbackUrl, state, codeChallenge: createHash('sha256').update(verifier).digest('base64url') })
  const authorization = z.object({ authorizeUrl: z.url() }).parse(await pending.json())
  const employeeContext = await browser.newContext({ locale, ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } })
  await employeeContext.route(`${provider.issuer}/**`, async (interception) => {
    const url = new URL(interception.request().url())
    const response = await fetch(new URL(url.pathname + url.search, provider.origin))
    await interception.fulfill({ status: response.status, contentType: 'text/html', body: await response.text() })
  })
  const login = await employeeContext.newPage()
  login.on('pageerror', error => errors.push(error.message))
  await login.goto(authorization.authorizeUrl)
  await login.locator('#oidc').waitFor()
  expect(await login.locator('#login').isVisible()).toBe(false)
  await expect((await login.locator('.content').ariaSnapshot()) + '\n').toMatchFileSnapshot(join(import.meta.dirname, 'expected', `oidc-login-${locale}.aria.txt`))
  expect(await login.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const pictures = process.env.DSH_ENTERPRISE_ACCEPTANCE_DIR
  if (pictures !== undefined) {
    await mkdir(pictures, { recursive: true })
    await login.screenshot({ path: join(pictures, `oidc-login-${locale}.png`), fullPage: true })
  }
  await login.locator('#oidc').click()
  await login.getByRole('link', { name: 'Sign in as Alice', exact: true }).waitFor()
  provider.controls.unavailable = true
  await login.getByRole('link', { name: 'Sign in as Alice', exact: true }).click()
  await expect.poll(() => login.locator('#notice').textContent()).toBe(zh ? '企业统一登录未能完成，请重试或联系管理员。' : 'Company SSO could not be completed. Retry or contact your administrator.')
  provider.controls.unavailable = false
  await login.locator('#oidc').click()
  await login.getByRole('link', { name: 'Sign in as Alice', exact: true }).click()
  await login.locator('#known').waitFor()
  expect(await login.locator('#email').textContent()).toBe('alice@example.test')
  await login.locator('#approve').click()
  await login.getByText('Desktop authorization received', { exact: true }).waitFor()
  const callback = await received.promise
  expect(callback.searchParams.get('state')).toBe(state)
  const exchange = await service.request('/api/auth/enterprise/desktop/token', undefined, { code: callback.searchParams.get('code'), codeVerifier: verifier })
  expect(exchange.status).toBe(200)
  const token = z.object({ token: z.string() }).parse(await exchange.json()).token
  expect((await service.pool.query('SELECT "userId" FROM "session" WHERE token = $1', [token])).rows[0].userId).toBe(employee.id)

  await row.locator('summary').click()
  await row.getByRole('button', { name: zh ? '清除统一登录身份' : 'Clear SSO identity', exact: true }).click()
  await editor.locator('#editor-save').click()
  await expect.poll(() => page.locator('#notice').textContent()).toBe(zh ? '更改已保存。' : 'Changes saved.')
  expect((await service.request('/v1/session', token)).status).toBe(401)
  expect(errors).toEqual([])
})
