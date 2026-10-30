/** Enterprise identity sealed into release metadata. */
export interface EnterprisePackageConfig {
  appId: string
  productName: string
  origin: string
  enterpriseName?: string
  syncIntervalMs?: number
  requestTimeoutMs?: number
  authorizationTimeoutMs?: number
}

/** Validated enterprise release destinations and native artwork. */
export interface EnterprisePackageEnvironment {
  config: EnterprisePackageConfig
  icon: string | undefined
  artwork: { windows: string; mac: string; tray: string }
  installerAssets: string
  policy: { origin: string; allowedPageOrigins: string[]; authentication: 'anonymous' } | undefined
  update: { publicUrl: string; channel: 'nightly' | 'latest'; environment: 'enterprise' } | undefined
}

/** @param env - File-owned release settings. @param platform - Target operating system. @param arch - Target architecture. @returns Enterprise settings, or undefined for the official distribution. */
export function resolveEnterprisePackageEnvironment(
  env: NodeJS.ProcessEnv,
  platform: string,
  arch: string,
): EnterprisePackageEnvironment | undefined

/** @param environment - Explicit enterprise file or JSON selection. @returns Enterprise local build settings, or undefined for the upstream distribution. */
export function localEnterprisePackageEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv | undefined

/** @param environment - Parent release-file selection. @param readSettings - Validated dotenv reader. @param accepts - Ordinary release setting admission. @returns File-owned settings, or undefined without enterprise selection. */
export function enterpriseReleaseSettings(
  environment: NodeJS.ProcessEnv,
  readSettings: (path: string, accepts: (name: string) => boolean) => NodeJS.ProcessEnv,
  accepts: (name: string) => boolean,
): NodeJS.ProcessEnv | undefined

/** @param serialized - Validated enterprise desktop configuration. @returns Enterprise development presentation, or undefined for the upstream application. */
export function enterpriseDevelopmentBranding(serialized: string | undefined): {
  appId: string; productName: string; bundleName: string; executableName: string; iconName: string; icon: string
} | undefined
