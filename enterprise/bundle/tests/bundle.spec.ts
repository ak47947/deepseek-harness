/** Enterprise composition loads through the standard manifest and preserves later profile settings. */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { composeEntries, initProfile, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'

it('loads the enterprise bundle after Web rows and applies account-owned configuration last', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-enterprise-bundle-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const bundle = join(root, 'node_modules/@deepseek-ai/dsh-enterprise-desktop')
  mkdirSync(bundle, { recursive: true })
  for (const filename of ['package.json', 'cordis.patch.yml']) {
    cpSync(fileURLToPath(new URL(`../${filename}`, import.meta.url)), join(bundle, filename))
  }
  const profile = join(root, 'profile')
  initProfile(profile, ['@deepseek-ai/dsh-enterprise-desktop'])
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: ui-settings-enterprise-account\n  config:\n    agentName: Example enterprise\n- id: llm-pi-ai\n  config:\n    providers:\n      enterprise:\n        baseURL: https://models.example.test/v1\n')
  const loaded = loadProfileDirectory('dsh', profile, join(root, 'package.json'))
  expect(loaded.skippedBundles).toEqual([])
  expect(loaded.layers).toHaveLength(1)
  const rows = ['system-prompt', 'ui-settings-account', 'llm-deepseek', 'llm-deepseek-account', 'ui-brand-official', 'ui-settings-models', 'llm-pi-ai']
  const entries = composeEntries([
    [{ insert: rows.map(id => ({ id, name: `test-${id}` })) }],
    ...loaded.layers.map(layer => layer.patches), loaded.patches,
  ])
  expect(entries.find(row => row.id === 'ui-settings-enterprise-account')).toMatchObject({
    name: '@deepseek-ai/dsh-client-ui-settings-enterprise-account', config: { agentName: 'Example enterprise' },
  })
  expect(entries.find(row => row.id === 'llm-pi-ai')).toMatchObject({
    disabled: false, config: { providers: { enterprise: { baseURL: 'https://models.example.test/v1' } } },
  })
  expect(entries.find(row => row.id === 'system-prompt')?.config).toEqual({ includeHarnessIdentity: false })
  expect(entries.find(row => row.id === 'ui-settings-models')?.disabled).toBe(false)
  for (const id of ['ui-settings-account', 'llm-deepseek', 'llm-deepseek-account', 'ui-brand-official']) {
    expect(entries.find(row => row.id === id)?.disabled).toBe(true)
  }
})
