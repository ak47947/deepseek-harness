/** Account-scoped profile preparation; the caller keeps the Host stopped until both documents verify. */
import { createHash } from 'node:crypto'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { dump, load } from 'js-yaml'
import { z } from 'zod'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { parseCredentialsDocument } from '@deepseek-ai/dsh-credentials-local'
import type { EnterpriseAccountKey, EnterpriseSession } from '@deepseek-ai/dsh-enterprise/protocol'

/** Stable account location independent of names, email addresses, tokens, and model credentials. */
export interface EnterpriseAccountPaths {
  readonly key: EnterpriseAccountKey
  readonly home: string
  readonly profile: string
}

/**
 * @param root - Enterprise application data root.
 * @param identity - Server-authenticated stable account IDs.
 * @returns Private account directory and profile.
 */
export function enterpriseAccountPaths(
  root: string,
  identity: Pick<EnterpriseSession, 'enterpriseId' | 'userId'>,
): EnterpriseAccountPaths {
  const key = createHash('sha256')
    .update(JSON.stringify([identity.enterpriseId, identity.userId]), 'utf8')
    .digest('hex') as EnterpriseAccountKey
  const home = join(root, 'accounts', key)
  return { key, home, profile: join(home, 'profiles', 'desktop') }
}

/** @param runtime - Installed desktop runtime. @returns Its absolute enterprise account entry for client metadata discovery. */
export function resolveEnterpriseClientEntry(runtime: string): string {
  return createRequire(join(runtime, 'package.json')).resolve('@deepseek-ai/dsh-client-ui-settings-enterprise-account')
}

/**
 * @param session - Complete approved endpoint and credential.
 * @returns Content-addressed reference safe for in-flight calls to retain after rotation.
 */
export function enterpriseCredentialRef(session: EnterpriseSession): string {
  return `DSH_ENT_KEY_${createHash('sha256')
    .update(JSON.stringify([session.provisioning.baseURL, session.provisioning.apiKey]))
    .digest('hex')
    .toUpperCase()}`
}

/**
 * @param session - Server configuration.
 * @returns The llm-pi-ai provider dictionary used both before startup and by live settings writes.
 */
export function enterpriseProviders(session: EnterpriseSession) {
  return {
    enterprise: {
      displayName: 'Enterprise',
      api: session.provisioning.api,
      baseURL: session.provisioning.baseURL,
      apiKeyEnv: enterpriseCredentialRef(session),
      models: session.provisioning.models,
    },
  }
}

const disabled = [
  'ui-settings-account',
  'llm-deepseek',
  'llm-deepseek-account',
  'ui-brand-official',
]

/** Complete disabled-row set written by the restricted enterprise profile. */
const legacyDisabled = [
  ...disabled,
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
]
const legacyPresets = ['preset-standard', 'preset-cordis', 'preset-ptc']

/**
 * Commit enterprise account configuration and credentials before the Host can restore work.
 * Each document is atomically replaced; partial publication never authorizes Host startup. Personal rows and data survive.
 * @param paths - Account-owned home and desktop profile.
 * @param session - Complete, authenticated server response for this account.
 * @param clientEntry - Absolute enterprise account plugin entry resolved by the installed runtime.
 * @param agentName - Enterprise product name shared by every agent.
 * @returns Completion after both documents have been read back and checked.
 */
export async function prepareEnterpriseProfile(
  paths: EnterpriseAccountPaths,
  session: EnterpriseSession,
  clientEntry: string,
  agentName: string,
): Promise<void> {
  await mkdir(paths.profile, { recursive: true, mode: 0o700 })
  const filename = join(paths.profile, 'cordis.patch.yml')
  await withFileLock(filename, async () => {
    let previous = loadOptionalPatches('dsh', filename) ?? []
    if (legacyDisabled.every(id => previous.some(row => row.id === id && row.disabled === true))
      && legacyPresets.every(id => previous.some(row => row.id === id && row.config !== undefined))) {
      const legacyOwned = new Set([...legacyDisabled.filter(id => !disabled.includes(id)), ...legacyPresets])
      previous = previous.filter(row => !legacyOwned.has(row.id ?? ''))
    }
    const localConfiguration = z.record(z.string(), z.unknown()).parse(previous.find(row => row.id === 'llm-pi-ai')?.config ?? {})
    const localProviders = z.record(z.string(), z.unknown()).parse(localConfiguration.providers ?? {})
    const providers = { ...localProviders, ...enterpriseProviders(session) }
    const localDefault = z.looseObject({ provider: z.string().optional() }).parse(previous.find(row => row.id === 'agent-default-model')?.config ?? {})
    const defaultModel = localDefault.provider !== undefined && localDefault.provider !== 'enterprise'
      ? localDefault : { ...localDefault, provider: 'enterprise', model: session.provisioning.defaultModel }
    const prompt = z.record(z.string(), z.unknown()).parse(previous.find(row => row.id === 'system-prompt')?.config ?? {})
    const owned = [
      { id: 'system-prompt', config: { ...prompt, includeHarnessIdentity: false } },
      ...disabled.map(id => ({ id, disabled: true })),
      { id: 'ui-settings-models', disabled: false },
      { id: 'llm-pi-ai', disabled: false, config: { ...localConfiguration, providers } },
      { id: 'agent-default-model', config: defaultModel },
    ]
    const ownedIds = new Set(owned.map(row => row.id))
    ownedIds.add('ui-settings-enterprise-account')
    const patch = previous.filter(row => !ownedIds.has(row.id ?? '')).map(row => row.insert === undefined ? row : {
      ...row, insert: row.insert.map((entry) => {
        if (entry.id !== 'ui-settings-enterprise-account') return entry
        return { ...entry, name: clientEntry, disabled: false, config: { agentName } }
      }),
    })
    const hasClientEntry = patch.some(row => row.insert?.some(entry => entry.id === 'ui-settings-enterprise-account'))
    if (!hasClientEntry) {
      patch.push({
        insert: [
          { id: 'ui-settings-enterprise-account', name: clientEntry, config: { agentName } },
        ],
      })
    }
    const text = dump([...patch, ...owned], { schema: entryListSchema, noRefs: true, lineWidth: -1 })
    const refs = { [enterpriseCredentialRef(session)]: session.provisioning.apiKey }
    await writeEnterpriseCredentials(paths.home, refs)
    await writeFileAtomic(filename, text, { mode: 0o600, dirMode: 0o700 })
    if ((await readFile(filename, 'utf8')) !== text)
      throw new Error('Enterprise desktop: model configuration verification failed')
    const credentials = await readCredentialDocument(paths.home)
    if (credentials.refs[enterpriseCredentialRef(session)] !== session.provisioning.apiKey)
      throw new Error('Enterprise desktop: model credential verification failed')
  })
}

interface CredentialDocument {
  version: number
  refs: Record<string, string>
  records?: Record<string, unknown>
}

/**
 * @param home - Account-owned Harness home.
 * @returns Validated local credential references; malformed documents reject without quoting secrets.
 */
export async function readCredentialDocument(home: string): Promise<CredentialDocument> {
  let text: string
  try {
    text = await readFile(join(home, '.credentials.yaml'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, refs: {} }
    throw error
  }
  let value: unknown
  parseCredentialsDocument(text, join(home, '.credentials.yaml'))
  try {
    value = load(text)
  } catch (_error) {
    throw new Error('Enterprise desktop: credential document is unreadable')
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    value.version !== 1 ||
    !('refs' in value) ||
    typeof value.refs !== 'object' ||
    value.refs === null ||
    Array.isArray(value.refs) ||
    Object.values(value.refs).some(secret => typeof secret !== 'string')
  )
    throw new Error('Enterprise desktop: credential document is invalid')
  return value as CredentialDocument
}

/**
 * Replace managed credential references after the Host has stopped; unrelated credentials and records survive.
 * @param home - Account-owned Harness home.
 * @param refs - Current managed references, or an empty dictionary for sign-out.
 */
export async function writeEnterpriseCredentials(home: string, refs: Record<string, string>): Promise<void> {
  const path = join(home, '.credentials.yaml')
  await withFileLock(path, async () => {
    const document = await readCredentialDocument(home)
    const retained = Object.fromEntries(
      Object.entries(document.refs).filter(([ref]) => !ref.startsWith('DSH_ENT_KEY_')),
    )
    await writeFileAtomic(
      path,
      dump({ ...document, refs: { ...retained, ...refs } }, { noRefs: true, lineWidth: -1 }),
      { mode: 0o600, dirMode: 0o700 },
    )
  })
}
