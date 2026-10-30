/** Required enterprise bundles reject startup before account work is restored. */
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import { initProfile } from '@deepseek-ai/dsh-app-boot'
import { assertEnterpriseProfile, enterpriseAccountPaths } from '../src/enterprise-profile.ts'
import { enterpriseSessionSchema } from '@deepseek-ai/dsh-enterprise-protocol'

const nativeModule = createRequire(import.meta.url)('node:module') as { _initPaths(): void }
const originalNodePath = process.env.NODE_PATH

// pnpm's launcher adds workspace packages to NODE_PATH; fixtures supply their own runtime copies.
beforeAll(() => {
  delete process.env.NODE_PATH
  nativeModule._initPaths()
})

afterAll(() => {
  if (originalNodePath === undefined) delete process.env.NODE_PATH
  else process.env.NODE_PATH = originalNodePath
  nativeModule._initPaths()
})

async function fixture(bundle: boolean, supportedVersion?: string) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-bundle-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const runtime = join(root, 'runtime')
  const install = join(runtime, 'node_modules', '@deepseek-ai', 'dsh')
  await mkdir(install, { recursive: true })
  await writeFile(join(install, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.3' }))
  const paths = enterpriseAccountPaths(root, z.object({ enterpriseId: enterpriseSessionSchema.shape.enterpriseId, userId: enterpriseSessionSchema.shape.userId }).parse({ enterpriseId: 'company', userId: 'employee' }))
  initProfile(paths.profile, ['@deepseek-ai/dsh-enterprise-desktop'])
  if (bundle) {
    const directory = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-enterprise-desktop')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-enterprise-desktop', version: '0.2.1-rc.3', ...(supportedVersion === undefined ? {} : { engines: { dsh: supportedVersion } }), dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    await writeFile(join(directory, 'cordis.patch.yml'), '[]\n')
  }
  return { paths, runtime }
}

it('refuses to start when the enterprise runtime does not carry its required bundle', async () => {
  const { paths, runtime } = await fixture(false)
  expect(() => assertEnterpriseProfile(paths, runtime)).toThrow('required enterprise bundle is unavailable')
})

it('accepts the installed enterprise bundle through normal profile resolution', async () => {
  const { paths, runtime } = await fixture(true)
  expect(() => assertEnterpriseProfile(paths, runtime)).not.toThrow()
})

it('refuses a required bundle whose declared DSH version does not match the runtime', async () => {
  const { paths, runtime } = await fixture(true, '0.0.0')
  expect(() => assertEnterpriseProfile(paths, runtime)).toThrow('required enterprise bundle is unavailable')
})
