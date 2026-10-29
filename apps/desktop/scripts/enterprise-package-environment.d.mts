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
  policy: { origin: string; allowedPageOrigins: string[]; authentication: 'anonymous' } | undefined
  update: { publicUrl: string; channel: 'nightly' | 'latest'; environment: 'enterprise' } | undefined
}

/** @param env - File-owned release settings. @param platform - Target operating system. @param arch - Target architecture. @returns Enterprise settings, or undefined for the official distribution. */
export function resolveEnterprisePackageEnvironment(
  env: NodeJS.ProcessEnv,
  platform: string,
  arch: string,
): EnterprisePackageEnvironment | undefined
