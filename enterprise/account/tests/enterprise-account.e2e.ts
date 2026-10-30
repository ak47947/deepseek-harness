/** Recorded history remains visible beside enterprise account settings in the real Web Loader composition. */
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { enterpriseSessionSchema } from '@deepseek-ai/dsh-enterprise-protocol'
import { enterpriseAccountPaths, prepareEnterpriseProfile } from '../../desktop/src/enterprise-profile.ts'
import {
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  seedSession,
  webSnapshotMode,
  watchConsole,
} from '../../../apps/web/tests/scaffold.ts'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const expected = join(repository, 'snapshots/web/enterprise-account')

it.skipIf(webSnapshotMode() === 'record')(
  'shows enterprise identity beside recorded conversation history and routes sign-out to the shell',
  { retry: 0 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'enterprise-web-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const account = enterpriseSessionSchema.parse({
      enterpriseId: 'example-company',
      userId: 'alice',
      name: 'Alice',
      email: 'alice@example.test',
      role: 'user',
      expiresAt: '2026-10-29T00:00:00.000Z',
      provisioning: {
        mode: 'basic',
        baseURL: 'https://provider.example.test/v1',
        api: 'openai-completions',
        apiKey: 'test-only-employee-key',
        defaultModel: 'approved',
        models: [{ id: 'approved', name: 'Approved', contextWindow: 128000, maxTokens: 8192, input: ['text'] }],
      },
    })
    const paths = enterpriseAccountPaths(root, account)
    await prepareEnterpriseProfile(paths, account, 'Atrix Harness')
    const scaffold = await launchWebScaffold({
      extraOverlayPath: [
        join(repository, 'apps/web/tests/pin-browse-picker.overlay.yml'),
        join(paths.profile, 'cordis.patch.yml'),
      ],
      profile: { packages: [{ dir: join(repository, 'enterprise/bundle'), enabled: true }] },
    })
    onTestFinished(() => scaffold.close())
    const identity = (await scaffold.ctx.systemPrompt.assemble()).sections.find(section => section.name === 'harness:identity')
    expect(identity?.text).toBe('You are Atrix Harness, the enterprise AI assistant. Your name is Atrix Harness.')
    await seedSession(
      scaffold,
      await readFile(join(repository, 'snapshots/web/fresh-round-trip/session.v4.jsonl'), 'utf8'),
      'enterprise-history',
    )
    const browser = await chromium.launch()
    onTestFinished(() => browser.close())
    const page = await browser.newPage({ viewport: { width: 1360, height: 960 }, locale: 'en-US' })
    const tripwire = watchConsole(page)
    await page.addInitScript(() => {
      let degraded = false
      let signOuts = 0
      const listeners = new Set<() => void>()
      Object.defineProperty(globalThis, 'dshDesktop', {
        value: {
          protocolVersion: 1,
          enterpriseAccount: {
            organization: async () => 'Example organization',
            startSignIn: async () => {},
            status: async () => ({
              organization: 'Example organization',
              name: 'Alice',
              email: 'alice@example.test',
              mode: 'basic',
              expiresAt: '2026-10-29T00:00:00.000Z',
              degraded,
            }),
            signOut: async () => {
              signOuts++
            },
            subscribe: (listener: () => void) => {
              listeners.add(listener)
              return () => {
                listeners.delete(listener)
              }
            },
          },
        },
      })
      Object.defineProperty(globalThis, 'enterpriseTest', {
        value: {
          degrade: () => {
            degraded = true
            for (const listener of listeners) listener()
          },
          signOuts: () => signOuts,
        },
      })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    try {
      await page.getByText('Example organization', { exact: true }).waitFor({ state: 'visible' })
    } catch (error) {
      throw new Error(JSON.stringify({ console: tripwire, document: await page.locator('body').innerText() }), {
        cause: error,
      })
    }
    const workspace = page.getByRole('treeitem').first()
    await workspace.click()
    await page.getByRole('treeitem').nth(1).click()
    await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    await page.getByRole('button', { name: 'View Web search', exact: true }).waitFor()
    await compareOrRefreshGolden(join(expected, 'plugins.expected.md'),
      await captureStableAria(page, '[data-plugin-panel]', scaffold.workspaceCwd), webSnapshotMode())
    expect(await page.getByRole('button', { name: 'Account menu', exact: true }).innerText()).toContain('Alice')
    await compareOrRefreshGolden(join(expected, 'launcher.expected.md'),
      await captureStableAria(page, 'button[aria-label="Account menu"]', scaffold.workspaceCwd), webSnapshotMode())
    await page.getByRole('button', { name: 'Account menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Enterprise account', exact: true }).click()
    await page.getByText('alice@example.test', { exact: true }).waitFor()
    const aria = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    expect(aria).not.toContain('test-only-employee-key')
    await compareOrRefreshGolden(join(expected, 'account.expected.md'), aria, webSnapshotMode())
    const pictures = process.env.DSH_ENTERPRISE_ACCEPTANCE_DIR
    if (pictures !== undefined) {
      await mkdir(pictures, { recursive: true })
      await page.screenshot({ path: join(pictures, 'account-light.png') })
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.screenshot({ path: join(pictures, 'account-dark-narrow.png') })
      await page.setViewportSize({ width: 1360, height: 960 })
    }
    await page.evaluate(() => {
      ;(globalThis as typeof globalThis & { enterpriseTest: { degrade(): void } }).enterpriseTest.degrade()
    })
    await page
      .getByText(
        'Enterprise synchronization is unavailable. Cached configuration remains usable until sign-in expires.',
      )
      .waitFor()
    await compareOrRefreshGolden(
      join(expected, 'offline.expected.md'),
      await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd),
      webSnapshotMode(),
    )
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    expect(
      await page.evaluate(() =>
        (globalThis as typeof globalThis & { enterpriseTest: { signOuts(): number } }).enterpriseTest.signOuts(),
      ),
    ).toBe(1)
    expect(tripwire).toEqual({ warnings: [], pageErrors: [] })
  },
)
