/** Opt-in Docker qualification for deployment inputs and the source files accepted by its build context. */
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it, onTestFinished } from 'vitest'
import { repositoryClientBuildEnvironment } from '../../scripts/client-build-environment.ts'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const revision = '0123456789abcdef0123456789abcdef01234567'

it.skipIf(process.env.DSH_ENTERPRISE_DOCKER_E2E !== '1')(
  'excludes deployment secrets and local artifacts while retaining explicit build metadata without Git',
  { retry: 0 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-context-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const context = join(root, 'context')
    const output = join(root, 'output')
    await mkdir(context)
    await writeFile(join(context, 'Dockerfile'), 'FROM scratch\nCOPY . /workspace\n')
    await cp(join(repository, 'backend/deploy/Dockerfile.dockerignore'), join(context, 'Dockerfile.dockerignore'))
    const excluded = [
      '.git/config', '.env', 'deploy/company.env', '.credentials.yaml',
      '.playwright-mcp/capture.png', '.dsh-build/client-build-environment.json',
      '.dsh-report/output.json', '.artifacts/release.zip', '.cache/data', '.pnpm-store/v11/index.db',
      '.sessions/history.jsonl', '.storages/data.json',
      'node_modules/fixture/index.js', 'apps/desktop/lib/main.js', 'deploy/company.key',
    ]
    for (const path of excluded) {
      await mkdir(dirname(join(context, path)), { recursive: true })
      await writeFile(join(context, path), 'test-only-excluded-content\n')
    }
    await writeFile(join(context, 'package.json'), '{"version":"1.2.3"}\n')
    await mkdir(join(context, 'backend/src'), { recursive: true })
    await writeFile(join(context, 'backend/src/index.ts'), 'export const name = "enterprise"\n')
    const bootstrap = 'backend/deploy/init-profile.ts'
    await mkdir(dirname(join(context, bootstrap)), { recursive: true })
    await cp(join(repository, bootstrap), join(context, bootstrap))
    await execa('docker', [
      'build', '--file', join(context, 'Dockerfile'), '--output', `type=local,dest=${output}`, context,
    ], { timeout: 90000 })
    const exported = join(output, 'workspace')
    for (const path of excluded) await expect(access(join(exported, path))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(exported, 'backend/src/index.ts'), 'utf8')).toContain('enterprise')
    expect(await readFile(join(exported, bootstrap), 'utf8')).toBe(await readFile(join(repository, bootstrap), 'utf8'))
    expect(repositoryClientBuildEnvironment(exported, { DSH_CLIENT_COMMIT_HASH: revision })).toEqual({
      DSH_CLIENT_COMMIT_HASH: revision.slice(0, 7), DSH_CLIENT_VERSION: '1.2.3',
    })
  },
)

it.skipIf(process.env.DSH_ENTERPRISE_DOCKER_E2E !== '1')(
  'accepts the complete deployment and rejects a missing source revision before building',
  { retry: 0 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-compose-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const environment = join(root, 'empty.env')
    await writeFile(environment, '')
    const args = ['compose', '--env-file', environment,
      ...['compose.yml', 'compose.server.yml', 'compose.managed.yml']
        .flatMap(file => ['-f', join(repository, 'backend/deploy', file)]),
      'config', '--no-env-resolution', '--quiet']
    const env = {
      DSH_CLIENT_COMMIT_HASH: revision, DSH_ENTERPRISE_ORIGIN: 'https://dsh.example.test',
      ENTERPRISE_POSTGRES_PASSWORD: 'test-only-password', DSH_ENTERPRISE_LITELLM_KEY: 'test-only-key',
      LITELLM_POSTGRES_PASSWORD: 'test-only-password', LITELLM_SALT_KEY: 'test-only-salt',
      ENTERPRISE_PROVIDER_KEY: 'test-only-provider-key',
    }
    await execa('docker', args, { env, timeout: 30000 })
    const missing = await execa('docker', args, { env: { ...env, DSH_CLIENT_COMMIT_HASH: '' }, timeout: 30000, reject: false })
    expect(missing.timedOut).toBe(false)
    expect(missing.signal).toBeUndefined()
    expect(missing.exitCode).not.toBe(0)
    expect(missing.stderr).toContain('Configure the source revision')
  },
)

it.skipIf(process.env.DSH_ENTERPRISE_DOCKER_E2E !== '1')(
  'selects a private local environment file and publishes only the configured loopback port',
  { retry: 0 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-local-compose-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const environment = join(root, 'empty.env')
    const privateEnvironment = join(root, 'private.env')
    await writeFile(environment, '')
    await writeFile(privateEnvironment, 'DSH_ENTERPRISE_ID=test-only-local\n', { mode: 0o600 })
    const args = ['compose', '--env-file', environment,
      ...['compose.yml', 'compose.local.yml']
        .flatMap(file => ['-f', join(repository, 'backend/deploy', file)]),
      'config', '--format', 'json']
    const env = {
      DSH_CLIENT_COMMIT_HASH: revision,
      ENTERPRISE_POSTGRES_PASSWORD: 'test-only-password',
      DSH_ENTERPRISE_ENV_FILE: privateEnvironment,
      DSH_ENTERPRISE_LOCAL_PORT: '',
    }
    const result = await execa('docker', args, { env, timeout: 30000 })
    expect(JSON.parse(result.stdout)).toMatchObject({ services: { backend: {
      image: 'dsh-enterprise:local',
      pull_policy: 'never',
      environment: {
        DSH_ENTERPRISE_ID: 'test-only-local',
        DSH_ENTERPRISE_ORIGIN: 'http://127.0.0.1:3090',
        DSH_HOME: '/data/harness',
      },
      ports: [{ host_ip: '127.0.0.1', published: '3090', target: 3090 }],
    } } })
    const custom = await execa('docker', args, { env: { ...env, DSH_ENTERPRISE_LOCAL_PORT: '4092' }, timeout: 30000 })
    expect(JSON.parse(custom.stdout)).toMatchObject({ services: { backend: {
      environment: { DSH_ENTERPRISE_ORIGIN: 'http://127.0.0.1:4092' },
      ports: [{ host_ip: '127.0.0.1', published: '4092', target: 3090 }],
    } } })
    const missing = await execa('docker', args, { env: { ...env, DSH_ENTERPRISE_ENV_FILE: '' }, timeout: 30000, reject: false })
    expect(missing.timedOut).toBe(false)
    expect(missing.signal).toBeUndefined()
    expect(missing.exitCode).not.toBe(0)
    expect(missing.stderr).toContain('Configure the absolute path to the private local environment file')
  },
)
