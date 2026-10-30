/** Account preparation retains personal configuration and migrates restricted enterprise profiles. */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches, readProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { enterpriseSessionSchema } from '@deepseek-ai/dsh-enterprise-protocol'
import {
  enterpriseAccountPaths,
  enterpriseCredentialRef,
  prepareEnterpriseProfile,
  readCredentialDocument,
  writeEnterpriseCredentials,
} from '../src/enterprise-profile.ts'

const bundlePatches = loadOverlayPatches('dsh', fileURLToPath(new URL('../../../enterprise/bundle/cordis.patch.yml', import.meta.url)))
const webPatches = [
  loadOverlayPatches('dsh', fileURLToPath(new URL('../../../packages/bundle/base/cordis.patch.yml', import.meta.url))),
  loadOverlayPatches('dsh', fileURLToPath(new URL('../../../packages/bundle/web-app/cordis.patch.yml', import.meta.url))),
]

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('enterprise profile preparation', () => {
  it('preserves account history and unrelated settings, and removes managed credentials only after the Host stops', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-profile-'))
    roots.push(root)
    const session = enterpriseSessionSchema.parse({
      enterpriseId: 'company',
      userId: 'alice',
      name: 'Alice',
      email: 'alice@example.test',
      role: 'user',
      expiresAt: '2026-10-29T00:00:00.000Z',
      provisioning: {
        mode: 'basic',
        baseURL: 'https://approved.example.test/v1',
        api: 'openai-completions',
        apiKey: 'test-employee-key',
        defaultModel: 'approved',
        models: [{ id: 'approved', name: 'Approved', contextWindow: 128000, maxTokens: 8192, input: ['text'] }],
      },
    })
    const paths = enterpriseAccountPaths(root, session)
    await mkdir(paths.profile, { recursive: true })
    const originalManifest = {
      name: 'account-profile', private: true, dependencies: { 'personal-bundle': '1.0.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'personal-bundle'] } },
    }
    await writeFile(join(paths.profile, 'package.json'), JSON.stringify(originalManifest))
    await writeFile(join(paths.profile, 'cordis.patch.yml'), '- id: locale\n  config:\n    preference: zh\n- id: llm-pi-ai\n  config:\n    providers:\n      personal:\n        api: openai-completions\n        baseURL: https://personal.example.test/v1\n- id: ui-settings-models\n  disabled: true\n- id: agent-default-model\n  config:\n    provider: personal\n    model: personal-one\n')
    await writeFile(join(paths.home, '.credentials.yaml'), 'version: 1\nrefs:\n  PERSONAL_KEY: personal-test-key\n', {
      mode: 0o600,
    })
    await mkdir(join(paths.home, 'sessions'))
    await writeFile(join(paths.home, 'sessions', 'history.txt'), 'retained conversation')
    await prepareEnterpriseProfile(paths, session, 'Atrix Harness')
    const text = await readFile(join(paths.profile, 'cordis.patch.yml'), 'utf8')
    expect(text).not.toContain('test-employee-key')
    const patches = loadOverlayPatches('dsh', join(paths.profile, 'cordis.patch.yml'))
    const entries = composeEntries([...webPatches, bundlePatches, patches])
    expect(entries.find(row => row.id === 'system-prompt')?.config).toMatchObject({ includeHarnessIdentity: false })
    expect(entries.find(row => row.id === 'ui-settings-enterprise-account')?.config)
      .toEqual({ agentName: 'Atrix Harness' })
    expect(entries.find(row => row.id === 'ui-settings-enterprise-account')?.name)
      .toBe('@deepseek-ai/dsh-client-ui-settings-enterprise-account')
    expect(patches.some(row => row.insert !== undefined)).toBe(false)
    expect(patches.find(row => row.id === 'system-prompt')).toBeUndefined()
    expect(patches.find(row => row.id === 'locale')?.config).toEqual({ preference: 'zh' })
    expect(entries.find(row => row.id === 'ui-settings-models')?.disabled).toBe(false)
    expect(entries.find(row => row.id === 'agent-default-model')?.config).toEqual({ provider: 'personal', model: 'personal-one' })
    expect(readProfileManifest('dsh', paths.profile)).toEqual({
      ...originalManifest,
      dsh: { profile: { bundles: [...originalManifest.dsh.profile.bundles, '@deepseek-ai/dsh-enterprise-desktop'] } },
    })
    const modelConfiguration: unknown = patches.find(row => row.id === 'llm-pi-ai')?.config
    expect(modelConfiguration).toMatchObject({
      providers: {
        personal: { baseURL: 'https://personal.example.test/v1' },
        enterprise: {
          baseURL: session.provisioning.baseURL,
          apiKeyEnv: enterpriseCredentialRef(session),
        },
      },
    })
    for (const id of [
      'llm-deepseek',
      'ui-settings-account',
      'ui-brand-official',
    ]) {
      expect(entries.find(row => row.id === id)?.disabled).toBe(true)
      expect(patches.find(row => row.id === id)).toBeUndefined()
    }
    for (const id of [
      'deepseek-account',
      'account-controller',
      'plugin-manager',
      'plugin-market',
      'ui-plugin-manager',
      'tool-plugin-manager',
      'extensions',
      'product-analytics',
      'desktop-product-telemetry',
      'session-telemetry-otel',
      'anonymous-user-id',
      'web-search-deepseek',
      'cordis-host-runner',
      'cordis-client-runner',
      'ui-cordis',
      'cordis-inspect-providers',
    ]) {
      expect(patches.find(row => row.id === id)).toBeUndefined()
    }
    for (const id of ['standard', 'ptc', 'cordis']) {
      expect(patches.find(row => row.id === `preset-${id}`)).toBeUndefined()
    }
    await prepareEnterpriseProfile(paths, session, 'Atrix Harness')
    expect(readProfileManifest('dsh', paths.profile).dsh?.profile?.bundles?.filter(name => name === '@deepseek-ai/dsh-enterprise-desktop')).toHaveLength(1)
    await writeEnterpriseCredentials(paths.home, {})
    expect((await readCredentialDocument(paths.home)).refs).toEqual({ PERSONAL_KEY: 'personal-test-key' })
    expect(await readFile(join(paths.home, 'sessions', 'history.txt'), 'utf8')).toBe('retained conversation')

    await cp(fileURLToPath(new URL('./fixtures/enterprise-restricted.patch.yml', import.meta.url)), join(paths.profile, 'cordis.patch.yml'))
    await prepareEnterpriseProfile(paths, session, 'Atrix Harness')
    const migrated = loadOverlayPatches('dsh', join(paths.profile, 'cordis.patch.yml'))
    expect(migrated.find(row => row.id === 'locale')?.config).toEqual({ preference: 'zh' })
    expect(migrated.filter(row => row.disabled === true)).toEqual([])
    expect(migrated.some(row => row.id?.startsWith('preset-'))).toBe(false)

    const personalPatch = '- id: product-analytics\n  disabled: true\n- id: preset-standard\n  config:\n    id: standard\n    plugins: []\n- id: system-prompt\n  config:\n    personaPrefix: Custom prefix\n- insert:\n    - id: ui-settings-enterprise-account\n      name: /old/runtime/enterprise-account.js\n    - id: personal-plugin\n      name: personal-plugin\n'
    await writeFile(join(paths.profile, 'cordis.patch.yml'), await readFile(join(paths.profile, 'cordis.patch.yml'), 'utf8') + personalPatch)
    await prepareEnterpriseProfile(paths, session, 'Atrix Harness')
    const customized = loadOverlayPatches('dsh', join(paths.profile, 'cordis.patch.yml'))
    expect(customized.find(row => row.id === 'product-analytics')?.disabled).toBe(true)
    expect(customized.find(row => row.id === 'preset-standard')?.config).toEqual({ id: 'standard', plugins: [] })
    expect(customized.find(row => row.id === 'system-prompt')?.config).toEqual({ personaPrefix: 'Custom prefix', includeHarnessIdentity: false })
    expect(customized.flatMap(row => row.insert ?? []).map(row => row.id)).toEqual(['personal-plugin'])
  })

  it('rejects malformed existing credentials without replacing their contents', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-enterprise-credential-'))
    roots.push(home)
    const invalid = 'version: 1\nrefs:\n  EXISTING_KEY: 42\n'
    await writeFile(join(home, '.credentials.yaml'), invalid)
    await expect(writeEnterpriseCredentials(home, {})).rejects.toThrow()
    expect(await readFile(join(home, '.credentials.yaml'), 'utf8')).toBe(invalid)
  })
})
