/** File-owned enterprise desktop identity and service configuration. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { resolveEnterpriseDesktopConfig, type EnterpriseDesktopConfig } from './enterprise-config.ts'

const fields = z.object({
  appId: z.string().optional(), enterpriseName: z.string().optional(), productName: z.string().optional(),
  origin: z.string().optional(), syncIntervalMs: z.number().optional(), requestTimeoutMs: z.number().optional(),
  authorizationTimeoutMs: z.number().optional(),
}).strict()
const document = z.object({ enterprise: fields.optional() }).strict()

/** Locations and release defaults used before the shell opens any account data. */
export interface DesktopConfigurationOptions {
  readonly appRoot: string
  readonly development: boolean
  readonly dataRoot?: string
  readonly packaged?: unknown
  readonly environment?: NodeJS.ProcessEnv
}

/**
 * Enable enterprise behavior only through an explicit document or release setting; invalid documents stop startup.
 * @param options - Application, configuration-file, and sealed release locations.
 * @returns Enterprise configuration, or undefined when the distribution has no enterprise settings.
 */
export function readDesktopConfiguration(options: DesktopConfigurationOptions): EnterpriseDesktopConfig | undefined {
  const environment = options.environment ?? process.env
  if (!options.development && options.packaged === undefined && environment.DSH_DESKTOP_CONFIG_FILE === undefined) return undefined
  const path = environment.DSH_DESKTOP_CONFIG_FILE === undefined
    ? options.development ? join(options.appRoot, 'config', 'desktop.json')
      : join(options.dataRoot ?? options.appRoot, 'desktop', 'config.json')
    : resolve(environment.DSH_DESKTOP_CONFIG_FILE)
  const defaults = { appId: 'com.atrix.desktop', enterpriseName: 'Atrix Harness', productName: 'Atrix Harness', origin: 'http://127.0.0.1:3090' }
  const release = options.packaged === undefined ? {} : fields.parse(options.packaged)
  let file: z.infer<typeof document>
  try {
    file = document.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw new Error(`Enterprise desktop: cannot read ${path}; correct the desktop configuration and restart`, { cause: error })
    }
    if (environment.DSH_DESKTOP_CONFIG_FILE !== undefined) {
      throw new Error(`Enterprise desktop: configured file ${path} is missing; restore the file before starting`, { cause: error })
    }
    file = options.packaged === undefined ? {} : { enterprise: { ...defaults, ...release } }
    if (!options.development && file.enterprise !== undefined) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      try { writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { flag: 'wx', mode: 0o600 }) } catch (writeError) {
        if (!(writeError instanceof Error && 'code' in writeError && writeError.code === 'EEXIST')) throw writeError
        file = document.parse(JSON.parse(readFileSync(path, 'utf8')))
      }
    }
  }
  const explicit = !options.development || environment.DSH_DESKTOP_ENTERPRISE_CONFIG === undefined ? {}
    : fields.parse(JSON.parse(environment.DSH_DESKTOP_ENTERPRISE_CONFIG))
  if (file.enterprise === undefined && options.packaged === undefined && environment.DSH_DESKTOP_ENTERPRISE_CONFIG === undefined) return undefined
  const config = resolveEnterpriseDesktopConfig({ ...defaults, ...release, ...file.enterprise, ...explicit }, options.development)
  if (config === undefined) throw new Error('Enterprise desktop: configuration could not be resolved')
  return config
}
