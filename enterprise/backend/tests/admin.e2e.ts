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

const repository = fileURLToPath(new URL('../../../', import.meta.url))

it.each(['http', 'https'] as const)('manages employees through the independent %s browser origin', { retry: 0 }, async (scheme) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-admin-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const database = await PGlite.create()
  onTestFinished(() => database.close())
  // The shipped pg.Pool can open ten connections while loading a full directory page.
  const socket = new PGLiteSocketServer({ db: database, host: '127.0.0.1', port: 0, maxConnections: 10 })
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
  await execa(process.execPath, ['--import', 'tsx/esm', 'enterprise/backend/deploy/init-profile.ts'], {
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
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()
  const loginCookie = (await page.context().cookies(origin)).find(cookie => cookie.name.endsWith('.session_token'))
  expect(loginCookie).toMatchObject({ secure: scheme === 'https', httpOnly: true, sameSite: 'Lax' })
  expect(await page.getByRole('heading', { name: 'Budget and usage' }).isVisible()).toBe(false)
  const pictures = process.env.DSH_ENTERPRISE_ACCEPTANCE_DIR
  if (pictures !== undefined) {
    await mkdir(pictures, { recursive: true })
    await page.screenshot({ path: join(pictures, `admin-${scheme}-overview.png`), fullPage: true })
  }
  await page.locator('[data-route=departments]').click()
  await page.getByRole('heading', { name: 'Departments', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Create department', exact: true }).first().click()
  await page.getByRole('dialog').getByLabel('Department name', { exact: true }).fill('Engineering')
  await page.getByRole('dialog').getByLabel('Description', { exact: true }).fill('Product and platform engineering')
  await page.getByRole('dialog').getByRole('button', { name: 'Create department', exact: true }).click()
  await page.locator('#departments').getByText('Engineering', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Create department', exact: true }).first().click()
  await page.getByRole('dialog').getByLabel('Department name', { exact: true }).fill('Engineering')
  await page.getByRole('dialog').getByRole('button', { name: 'Create department', exact: true }).click()
  await page.getByRole('dialog').getByText('A department with this name already exists. Choose another name.', { exact: true }).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('#departments tr').filter({ hasText: 'Engineering' }).getByRole('button', { name: 'Add child department', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Department name', { exact: true }).fill('Platform')
  expect(await page.getByRole('dialog').getByLabel('Parent department', { exact: true }).inputValue()).not.toBe('')
  await page.getByRole('dialog').getByRole('button', { name: 'Create department', exact: true }).click()
  await page.locator('#departments').getByText('Platform', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Collapse Engineering', exact: true }).click()
  expect(await page.locator('#departments tr').count()).toBe(1)
  await page.getByRole('searchbox', { name: 'Search departments…', exact: true }).fill('Platform')
  expect(await page.locator('#departments tr').count()).toBe(2)
  await page.getByRole('searchbox', { name: 'Search departments…', exact: true }).fill('')
  await page.getByRole('button', { name: 'Expand all', exact: true }).click()
  await page.locator('#departments tr').filter({ hasText: 'Engineering' }).getByRole('button', { name: 'Edit department', exact: true }).click()
  expect(await page.getByRole('dialog').getByLabel('Parent department', { exact: true }).locator('option').count()).toBe(1)
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('[data-route=users]').click()
  await page.getByRole('heading', { name: 'Users', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Create employee', exact: true }).click()
  const employee = page.locator('#editor-form')
  await employee.getByLabel('Name', { exact: true }).fill('Alice')
  await employee.getByLabel('Email', { exact: true }).fill('alice@example.test')
  await employee.getByLabel('Initial password (8+ characters)', { exact: true }).fill('test-alice-password')
  await employee.getByRole('button', { name: 'Create employee', exact: true }).click()
  let row = page.getByRole('row').filter({ hasText: 'alice@example.test' })
  await row.getByText('Models not assigned', { exact: true }).waitFor()
  await row.getByLabel('More actions for Alice', { exact: true }).click()
  await row.getByRole('button', { name: 'Change department', exact: true }).click()
  await page.getByRole('dialog').getByRole('combobox', { name: 'Department', exact: true }).selectOption({ label: 'Engineering' })
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes', exact: true }).click()
  await row.getByText('Engineering', { exact: true }).waitFor()
  await page.getByRole('combobox', { name: 'Filter by department', exact: true }).selectOption({ label: 'Engineering' })
  expect(await page.locator('#employees tr').count()).toBe(1)
  await page.getByRole('searchbox', { name: 'Search name or email…', exact: true }).fill('missing')
  await page.getByRole('heading', { name: 'No matching users', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await row.getByRole('button', { name: 'Models', exact: true }).click()
  const assignment = page.locator('#assignment-form')
  await assignment.getByLabel('Provider API address', { exact: true }).fill('https://provider.example.test/v1')
  await assignment.getByLabel('Provider key (required when saving)', { exact: true }).fill('test-only-provider-key')
  await assignment.getByLabel('Model ID', { exact: true }).fill('approved-model')
  await assignment.getByLabel('Display name', { exact: true }).fill('Approved model')
  await assignment.getByRole('button', { name: 'Save configuration', exact: true }).click()
  await row.getByText('Active', { exact: true }).waitFor()
  await expect((await page.locator('#page-users').ariaSnapshot()) + '\n').toMatchFileSnapshot(join(repository, 'enterprise/backend/tests/expected/admin-users.aria.txt'))
  await page.locator('[data-route=models]').click()
  await page.getByRole('heading', { name: 'Model configuration', exact: true }).waitFor()
  await page.locator('#model-assignments').getByText('Approved model', { exact: true }).waitFor()
  await page.getByRole('searchbox', { name: 'Search employee or model…', exact: true }).fill('approved-model')
  expect(await page.locator('#model-assignments tr').count()).toBe(1)
  await page.getByRole('button', { name: 'Configure platform default', exact: true }).click()
  await assignment.getByLabel('Provider API address', { exact: true }).fill('https://platform.example.test/v1')
  await assignment.getByLabel('Provider key (required when saving)', { exact: true }).fill('test-only-platform-key')
  await assignment.getByLabel('Model ID', { exact: true }).fill('platform-model')
  await assignment.getByLabel('Display name', { exact: true }).fill('Platform model')
  await assignment.getByRole('button', { name: 'Save configuration', exact: true }).click()
  await page.locator('#platform-default-summary').getByText('Platform model · platform-model', { exact: true }).waitFor()
  await page.getByRole('searchbox', { name: 'Search employee or model…', exact: true }).fill('')
  const modelRow = page.locator('#model-assignments tr').filter({ hasText: 'alice@example.test' })
  await modelRow.getByText('Personal assignment', { exact: true }).waitFor()
  await modelRow.getByRole('button', { name: 'Models', exact: true }).click()
  await assignment.getByRole('button', { name: 'Use platform default', exact: true }).click()
  await modelRow.getByText('Platform default models', { exact: true }).waitFor()
  await modelRow.getByText('Platform model', { exact: true }).waitFor()
  await expect((await page.locator('#page-models').ariaSnapshot()) + '\n').toMatchFileSnapshot(join(repository, 'enterprise/backend/tests/expected/admin-models.aria.txt'))
  if (pictures !== undefined) await page.screenshot({ path: join(pictures, `admin-${scheme}-models.png`), fullPage: true })
  await page.locator('[data-route=users]').click()
  await page.getByRole('heading', { name: 'Users', exact: true }).waitFor()
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
  if (pictures !== undefined) {
    await page.screenshot({ path: join(pictures, `admin-${scheme}-light.png`), fullPage: true })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(pictures, `admin-${scheme}-dark-narrow.png`), fullPage: true, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await row.getByLabel('More actions for Alice', { exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.keyboard.press('Escape')
  expect(await row.locator('details').getAttribute('open')).toBeNull()
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click()
  await page.locator('[data-route=departments]').click()
  await page.getByRole('heading', { name: 'Departments', exact: true }).waitFor()
  expect(await page.locator('#menu-toggle').getAttribute('aria-expanded')).toBe('false')
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click()
  await page.keyboard.press('Escape')
  expect(await page.locator('#menu-toggle').getAttribute('aria-expanded')).toBe('false')
  await page.setViewportSize({ width: 1360, height: 960 })
  await page.locator('[data-route=users]').click()
  await page.getByRole('heading', { name: 'Users', exact: true }).waitFor()
  await row.getByLabel('More actions for Alice', { exact: true }).click()
  await row.getByRole('button', { name: 'Disable', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Disable', exact: true }).click()
  row = page.getByRole('row').filter({ hasText: 'alice@example.test' })
  await row.getByText('Disabled', { exact: true }).waitFor()
  await page
    .getByText('Account disabled. Revoke previously distributed credentials at the provider.', { exact: true })
    .waitFor()
  // Additional real accounts exercise the second page without replacing the directory response.
  for (let index = 1; index <= 9; index++) {
    const created = await page.request.post(`${origin}/v1/admin/employees`, { data: {
      name: `Member ${String(index)}`, email: `member-${String(index)}@example.test`, password: 'test-member-password', role: 'user',
    } })
    expect(created.status()).toBe(201)
  }
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect.poll(() => page.locator('#refresh').isDisabled()).toBe(false)
  await page.getByText('Page 1 of 2', { exact: true }).waitFor()
  expect(await page.locator('#employees tr').count()).toBe(10)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByText('Page 2 of 2', { exact: true }).waitFor()
  expect(await page.locator('#employees tr').count()).toBe(1)
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'light' })
  await page.getByRole('button', { name: 'Toggle color theme', exact: true }).click()
  expect(await page.locator('html').getAttribute('class')).toBe('dark')
  await page.getByRole('button', { name: 'Toggle color theme', exact: true }).click()
  expect(await page.locator('html').getAttribute('class')).toBe('light')
  await page.getByRole('button', { name: '切换到中文', exact: true }).click()
  await page.getByRole('heading', { name: '用户管理', exact: true }).waitFor()
  await page.locator('[data-route=departments]').click()
  await page.getByRole('heading', { name: '部门管理', exact: true }).waitFor()
  await expect((await page.locator('#page-departments').ariaSnapshot()) + '\n').toMatchFileSnapshot(join(repository, 'enterprise/backend/tests/expected/admin-departments-zh.aria.txt'))
  if (pictures !== undefined) await page.screenshot({ path: join(pictures, `admin-${scheme}-departments-zh.png`), fullPage: true })
  expect(errors).toEqual([])
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await page.locator('#login-form').waitFor()
  expect((await page.request.get(`${origin}/v1/admin/employees`)).status()).toBe(401)
})
