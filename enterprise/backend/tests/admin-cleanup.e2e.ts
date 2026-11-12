/** Administrator cleanup retries retain authenticated accounts after model access is removed. */
import { fileURLToPath } from 'node:url'
import { createServer, request as forward } from 'node:http'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import { enterpriseSessionSchema } from '@deepseek-ai/dsh-enterprise-protocol'
import { fixture } from './fixtures/enterprise.ts'

const locales = [
  {
    language: 'en', locale: 'en-US', retry: 'Retry gateway cleanup', disable: 'Disable',
    cleanup: 'Gateway cleanup required', unconfigured: 'Models not assigned',
    confirm: 'Retry revoking obsolete gateway credentials for this account?',
    disableConfirmation: 'Disable this employee? Their sessions will expire. Basic-mode provider keys must be revoked separately.',
  },
  {
    language: 'zh', locale: 'zh-CN', retry: '重试网关清理', disable: '停用账号',
    cleanup: '网关清理未完成', unconfigured: '未分配模型',
    confirm: '重试撤销该账号待清理的网关凭据？',
    disableConfirmation: '确定停用该成员？其登录会话将失效，基础模式的供应商凭证还需单独撤销。',
  },
] as const

it.each(locales)('retries gateway cleanup without disabling accounts in $language', { retry: 0 }, async (copy) => {
  let failRevocation = true
  let revocations = 0
  const send: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.pathname === '/model/info') return Response.json({ data: [{ model_name: 'approved-model' }] })
    if (url.pathname === '/key/info' || url.pathname === '/user/info') return Response.json({}, { status: 404 })
    if (url.pathname === '/key/generate') return Response.json(z.object({ key: z.string() }).parse(JSON.parse(String(init?.body))))
    if (url.pathname === '/key/delete') {
      revocations += 1
      if (failRevocation) return Response.json({}, { status: 503 })
    }
    return Response.json({ ok: true })
  }
  const route: { target?: string } = {}
  const proxy = createServer((request, response) => {
    if (route.target === undefined) { response.writeHead(503).end(); return }
    const upstream = forward(new URL(request.url ?? '/', route.target), { method: request.method, headers: request.headers }, incoming => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers); incoming.pipe(response)
    })
    upstream.on('error', () => response.destroy()); request.pipe(upstream)
  })
  onTestFinished(() => new Promise<void>((resolve, reject) => {
    proxy.close(error => error ? reject(error) : resolve()); proxy.closeAllConnections()
  }))
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const address = proxy.address()
  if (address === null || typeof address === 'string') throw new Error('Browser origin did not bind')
  const origin = `http://127.0.0.1:${String(address.port)}`
  const { request, login, origin: serviceOrigin } = await fixture('managed', send, { DSH_ENTERPRISE_ORIGIN: origin })
  route.target = serviceOrigin
  const admin = await login('admin@example.test', 'test-admin-password')
  expect((await request('/v1/admin/employees', admin, {
    name: 'Alice', email: 'alice@example.test', password: 'test-alice-password', role: 'user',
  })).status).toBe(201)
  const employee = await login('alice@example.test', 'test-alice-password')
  expect((await request('/v1/admin/platform-default', admin, {
    mode: 'managed', baseURL: 'https://provider.example.test/v1', api: 'openai-completions', apiKey: 'server-managed',
    models: [{ id: 'approved-model', name: 'Approved model', contextWindow: 128000, maxTokens: 8192, input: ['text'] }], defaultModel: 'approved-model',
  })).status).toBe(200)
  const accounts = await Promise.all([employee, admin].map(async (token) => {
    const response = await request('/v1/session', token)
    expect(response.status).toBe(200)
    const session = enterpriseSessionSchema.parse(await response.json())
    expect(session.provisioning).not.toBeNull()
    return { token, id: session.userId, email: session.email }
  }))
  expect((await request('/v1/admin/platform-default', admin, { configurationId: null })).status).toBe(200)
  for (const account of accounts) expect((await request('/v1/session', account.token)).status).toBe(503)

  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const context = await browser.newContext({ locale: copy.locale, extraHTTPHeaders: {
    authorization: `Bearer ${admin}`,
  } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/admin?lang=${copy.language}#users`)
  failRevocation = false
  for (const account of accounts) {
    const row = page.locator('#employees tr').filter({ hasText: account.email })
    await row.getByText(copy.cleanup, { exact: true }).waitFor()
    await row.locator('summary').click()
    expect(await row.getByRole('button', { name: copy.disable, exact: true }).isDisabled()).toBe(account.token === admin)
    await row.getByRole('button', { name: copy.retry, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByText(copy.confirm, { exact: true }).waitFor()
    expect(await dialog.getByText(copy.disableConfirmation, { exact: true }).count()).toBe(0)
    if (account.token === employee) await expect((await dialog.ariaSnapshot()) + '\n')
      .toMatchFileSnapshot(fileURLToPath(new URL(`./expected/admin-cleanup.${copy.language}.aria.txt`, import.meta.url)))
    const retryResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/v1/admin/employees/${account.id}/retry-cleanup`)
    await dialog.getByRole('button', { name: copy.retry, exact: true }).click()
    const response = await retryResponse
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ disabled: false, upstreamRevocation: 'complete' })
    await row.getByText(copy.unconfigured, { exact: true }).waitFor()
    const session = await request('/v1/session', account.token)
    expect(session.status).toBe(200)
    expect(enterpriseSessionSchema.parse(await session.json()).provisioning).toBeNull()
    await row.locator('summary').click()
    expect(await row.getByRole('button', { name: copy.retry, exact: true }).count()).toBe(0)
    await row.locator('summary').click()
  }
  const employees = z.object({ employees: z.array(z.object({ id: z.string(), banned: z.boolean(), gatewayState: z.string() })) })
    .parse(await (await request('/v1/admin/employees', admin)).json()).employees
  for (const account of accounts) expect(employees.find(user => user.id === account.id))
    .toMatchObject({ banned: false, gatewayState: 'unconfigured' })
  expect(revocations).toBe(4)
  expect(errors).toEqual([])
})
