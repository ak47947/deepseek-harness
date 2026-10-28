/** Profile preparation preserves personal rows and credentials while publishing complete enterprise policy before startup. */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { enterpriseSessionSchema } from '@deepseek-ai/dsh-enterprise/protocol'
import {
  enterpriseAccountPaths,
  enterpriseCredentialRef,
  prepareEnterpriseProfile,
  readCredentialDocument,
  writeEnterpriseCredentials,
} from '../src/enterprise-profile.ts'

const clientEntry = fileURLToPath(new URL('../../../packages/client/ui-settings-enterprise-account/src/index.ts', import.meta.url))

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('enterprise profile preparation', () => {
  it('preserves account history and unrelated settings, and removes managed credentials only after the Host stops', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-profile-'))
    roots.push(root)
    const runtime = join(root, 'runtime')
    const presets = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets')
    await mkdir(presets, { recursive: true })
    await cp(fileURLToPath(new URL('../../../packages/bundle/web-app/presets', import.meta.url)), presets, {
      recursive: true,
    })
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
    await writeFile(join(paths.profile, 'cordis.patch.yml'), '- id: locale\n  config:\n    preference: zh\n')
    await writeFile(join(paths.home, '.credentials.yaml'), 'version: 1\nrefs:\n  PERSONAL_KEY: personal-test-key\n', {
      mode: 0o600,
    })
    await mkdir(join(paths.home, 'sessions'))
    await writeFile(join(paths.home, 'sessions', 'history.txt'), 'retained conversation')
    await prepareEnterpriseProfile(paths, runtime, session, clientEntry)
    const text = await readFile(join(paths.profile, 'cordis.patch.yml'), 'utf8')
    expect(text).not.toContain('test-employee-key')
    const patches = loadOverlayPatches('dsh', join(paths.profile, 'cordis.patch.yml'))
    expect(patches.flatMap(row => row.insert ?? []).find(row => row.id === 'ui-settings-enterprise-account')?.name)
      .toBe(pathToFileURL(clientEntry).href)
    expect(patches.find(row => row.id === 'locale')?.config).toEqual({ preference: 'zh' })
    const modelConfiguration: unknown = patches.find(row => row.id === 'llm-pi-ai')?.config
    expect(modelConfiguration).toMatchObject({
      providers: {
        enterprise: {
          baseURL: session.provisioning.baseURL,
          apiKeyEnv: enterpriseCredentialRef(session),
        },
      },
    })
    for (const id of [
      'deepseek-account',
      'llm-deepseek',
      'plugin-manager',
      'tool-plugin-manager',
      'product-analytics',
      'session-telemetry-otel',
    ]) {
      expect(patches.find(row => row.id === id)?.disabled).toBe(true)
    }
    for (const id of ['standard', 'ptc', 'cordis']) {
      const configuration: unknown = patches.find(row => row.id === `preset-${id}`)?.config
      const { plugins } = z.object({ plugins: z.array(z.object({ id: z.string() })) }).parse(configuration)
      expect(plugins.some(row => ['tool-plugin-manager', 'tool-cordis', 'extensions'].includes(row.id))).toBe(false)
      expect(plugins.some(row => row.id === 'tool-skill')).toBe(true)
    }
    await prepareEnterpriseProfile(paths, runtime, session, clientEntry)
    expect(
      loadOverlayPatches('dsh', join(paths.profile, 'cordis.patch.yml')).filter(row =>
        row.insert?.some(entry => entry.id === 'ui-settings-enterprise-account'),
      ),
    ).toHaveLength(1)
    await writeEnterpriseCredentials(paths.home, {})
    expect((await readCredentialDocument(paths.home)).refs).toEqual({ PERSONAL_KEY: 'personal-test-key' })
    expect(await readFile(join(paths.home, 'sessions', 'history.txt'), 'utf8')).toBe('retained conversation')
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
