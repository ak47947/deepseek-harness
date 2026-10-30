/** Import the factory without evaluating an ordinary release configuration. */
export { createElectronBuilderConfig } from '../electron-builder.config.mjs'

/** Update feed sealed into one package: a public generic provider and its channel. */
export interface DesktopPackageUpdateFeed {
  readonly publicUrl: string
  readonly channel: 'nightly' | 'latest'
  readonly environment?: string
}

/**
 * Resolve the feed sealed into one package.
 * Unsigned upstream packages carry no feed; enterprise unsigned Windows keeps its configured feed.
 * @param env - Packaging environment.
 * @param platform - Target platform.
 * @param arch - Target architecture.
 * @param enterprise - Enterprise release settings, when configured.
 * @param unsigned - Whether this build omits release signing.
 * @returns Sealed update feed, or undefined when this build has none.
 */
export function resolveUpdateFeed(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  arch: string,
  enterprise: { readonly update?: DesktopPackageUpdateFeed } | undefined,
  unsigned: boolean,
): DesktopPackageUpdateFeed | undefined
