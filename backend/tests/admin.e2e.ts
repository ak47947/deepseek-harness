/** Real dsh profile startup and administrator browser flow over an isolated PostgreSQL-protocol database. */
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, request as forward, type RequestListener } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { execa } from 'execa'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'

const repository = fileURLToPath(new URL('../../', import.meta.url))

it.each(['http', 'https'] as const)('manages employees through the independent %s browser origin', { retry: 0 }, async (scheme) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-admin-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const database = await PGlite.create()
  onTestFinished(() => database.close())
  const socket = new PGLiteSocketServer({ db: database, host: '127.0.0.1', port: 0, maxConnections: 8 })
  await socket.start()
  onTestFinished(async () => {
    await expect.poll(() => socket.getStats()).toMatchObject({ activeConnections: 0, queuedQueries: 0 })
    await socket.stop()
  })
  const route: { target?: string } = {}
  const proxyRequest: RequestListener = (request, response) => {
    if (route.target === undefined) {
      response.writeHead(503).end()
      return
    }
    const upstream = forward(
      new URL(request.url ?? '/', route.target),
      { method: request.method, headers: { ...request.headers, 'x-forwarded-proto': scheme } },
      (incoming) => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers)
        incoming.pipe(response)
      },
    )
    upstream.on('error', () => {
      response.destroy()
    })
    request.pipe(upstream)
  }
  // The public loopback fixture key tests HTTPS cookies; certificate trust remains deployment-owned.
  const proxy = scheme === 'https' ? createHttpsServer({
    key: await readFile(new URL('./fixtures/tls/localhost-key.pem', import.meta.url)),
    cert: await readFile(new URL('./fixtures/tls/localhost-cert.pem', import.meta.url)),
  }, proxyRequest) : createServer(proxyRequest)
  await new Promise<void>((resolve) => {
    proxy.listen(0, '127.0.0.1', resolve)
  })
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        proxy.close(() => {
          resolve()
        })
        proxy.closeAllConnections()
      }),
  )
  const address = proxy.address()
  if (address === null || typeof address === 'string') throw new Error('Browser origin did not bind')
  const origin = `${scheme}://127.0.0.1:${String(address.port)}`
  const env = {
    ...process.env,
    DSH_HOME: root,
    DSH_TELEMETRY_MODE: 'DISABLED',
    DSH_ENTERPRISE_ID: 'browser-acceptance',
    DSH_ENTERPRISE_ORIGIN: origin,
    DSH_ENTERPRISE_PORT: '0',
    DATABASE_URL: `postgresql://postgres@${socket.getServerConn()}/postgres`,
    BETTER_AUTH_SECRET: 'test-only-browser-acceptance-secret-over-32-characters',
    DSH_ENTERPRISE_BOOTSTRAP_EMAIL: 'admin@example.test',
    DSH_ENTERPRISE_BOOTSTRAP_PASSWORD: 'test-admin-password',
    DSH_ENTERPRISE_MODE: 'basic',
  }
  await execa(process.execPath, ['--import', 'tsx/esm', 'backend/deploy/init-profile.ts'], {
    cwd: repository,
    env,
  })
  const child = execa(process.execPath, ['apps/cli/lib/bin.js', '--profile', 'enterprise'], {
    cwd: repository,
    env,
    reject: false,
  })
  onTestFinished(async () => {
    child.kill('SIGTERM')
    await child
  })
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  await expect.poll(() => output, { timeout: 30000 }).toMatch(/Enterprise service listening on 127\.0\.0\.1:\d+/u)
  const port = /Enterprise service listening on 127\.0\.0\.1:(\d+)/u.exec(output)?.[1]
  if (port === undefined) throw new Error('Enterprise listener did not publish its assigned port')
  route.target = `http://127.0.0.1:${port}`
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1360, height: 960 }, ignoreHTTPSErrors: true })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/admin`)
  await page.locator('#login-form').getByLabel('Email', { exact: true }).fill('admin@example.test')
  await page.locator('#login-form').getByLabel('Password', { exact: true }).fill('test-admin-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('heading', { name: 'Employees', exact: true }).waitFor()
  const loginCookie = (await page.context().cookies(origin)).find(cookie => cookie.name.endsWith('.session_token'))
  expect(loginCookie).toMatchObject({ secure: scheme === 'https', httpOnly: true, sameSite: 'Lax' })
  expect(await page.getByRole('heading', { name: 'Budget and usage' }).isVisible()).toBe(false)
  await page.locator('summary').click()
  const employee = page.locator('#employee-form')
  await employee.getByLabel('Name', { exact: true }).fill('Alice')
  await employee.getByLabel('Email', { exact: true }).fill('alice@example.test')
  await employee.getByLabel('Initial password (12+ characters)', { exact: true }).fill('test-alice-password')
  await employee.getByRole('button', { name: 'Create employee', exact: true }).click()
  let row = page.getByRole('row').filter({ hasText: 'alice@example.test' })
  await row.getByText('Models not assigned', { exact: true }).waitFor()
  await row.getByRole('button', { name: 'Models', exact: true }).click()
  const assignment = page.locator('#assignment-form')
  await assignment.getByLabel('Provider API address', { exact: true }).fill('https://provider.example.test/v1')
  await assignment.getByLabel('Provider key (required when saving)', { exact: true }).fill('test-only-provider-key')
  await assignment.getByLabel('Model ID', { exact: true }).fill('approved-model')
  await assignment.getByLabel('Display name', { exact: true }).fill('Approved model')
  await assignment.getByRole('button', { name: 'Save configuration', exact: true }).click()
  await row.getByText('Active', { exact: true }).waitFor()
  const employeeContext = await browser.newContext({ locale: 'en-US', ignoreHTTPSErrors: true })
  onTestFinished(() => employeeContext.close())
  const employeePage = await employeeContext.newPage()
  await employeePage.goto(`${origin}/admin`)
  await employeePage.locator('#login-form').getByLabel('Email', { exact: true }).fill('alice@example.test')
  await employeePage.locator('#login-form').getByLabel('Password', { exact: true }).fill('test-alice-password')
  await employeePage.getByRole('button', { name: 'Sign in', exact: true }).click()
  await employeePage.getByText('An administrator account is required.', { exact: true }).waitFor()
  expect(await employeePage.locator('#workspace').isVisible()).toBe(false)
  expect((await employeeContext.request.get(`${origin}/v1/admin/employees`)).status()).toBe(403)
  const pictures = process.env.DSH_ENTERPRISE_ACCEPTANCE_DIR
  if (pictures !== undefined) {
    await mkdir(pictures, { recursive: true })
    await page.screenshot({ path: join(pictures, `admin-${scheme}-light.png`), fullPage: true })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(pictures, `admin-${scheme}-dark-narrow.png`), fullPage: true })
  }
  page.once('dialog', (dialog) => {
    void dialog.accept()
  })
  await row.getByRole('button', { name: 'Disable', exact: true }).click()
  row = page.getByRole('row').filter({ hasText: 'alice@example.test' })
  await row.getByText('Disabled', { exact: true }).waitFor()
  await page
    .getByText('Account disabled. Revoke previously distributed credentials at the provider.', { exact: true })
    .waitFor()
  expect(errors).toEqual([])
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.locator('#login-form').waitFor()
  expect((await page.request.get(`${origin}/v1/admin/employees`)).status()).toBe(401)
})
