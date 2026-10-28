/** Enterprise release identity and update destinations; no official deployment fallback is accepted. */
import { extname, isAbsolute } from 'node:path'
import { existsSync } from 'node:fs'

function https(value, name, originOnly = false) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`enterprise package: ${name} must be an HTTPS URL`)
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (originOnly && url.pathname !== '/')
  )
    throw new Error(`enterprise package: ${name} must be an HTTPS URL without credentials, query, or fragment`)
  if (['deepseek.com', 'download.deepseek.com', 'platform.deepseek.com'].includes(url.hostname))
    throw new Error(`enterprise package: ${name} must use the enterprise deployment`)
  return originOnly ? url.origin : url.href.replace(/\/$/u, '')
}

/**
 * Validate explicit enterprise metadata and release destinations.
 * @param {NodeJS.ProcessEnv} env - File-owned release settings.
 * @param {string} platform - Target platform.
 * @param {string} arch - Target architecture.
 * @returns {object | undefined} Enterprise release settings, or undefined for the official distribution.
 */
export function resolveEnterprisePackageEnvironment(env, platform, arch) {
  if (env.DSH_DESKTOP_ENTERPRISE_CONFIG === undefined) return undefined
  let config
  try {
    config = JSON.parse(env.DSH_DESKTOP_ENTERPRISE_CONFIG)
  } catch {
    throw new Error('enterprise package: DSH_DESKTOP_ENTERPRISE_CONFIG must be valid JSON')
  }
  if (
    typeof config !== 'object' ||
    config === null ||
    Array.isArray(config) ||
    typeof config.appId !== 'string' ||
    !/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/u.test(config.appId) ||
    config.appId.startsWith('com.deepseek.') ||
    config.appId !== env.DSH_DESKTOP_APP_ID ||
    typeof config.productName !== 'string' ||
    !config.productName.trim() ||
    config.productName === 'DeepSeek Harness'
  ) {
    throw new Error(
      'enterprise package: configure a distinct appId and productName; appId must match DSH_DESKTOP_APP_ID',
    )
  }
  const allowed = ['appId', 'productName', 'origin', 'syncIntervalMs', 'requestTimeoutMs', 'authorizationTimeoutMs']
  if (Object.keys(config).some(key => !allowed.includes(key)))
    throw new Error('enterprise package: unsupported desktop configuration field')
  for (const [name, max] of [
    ['syncIntervalMs', 2147483647],
    ['requestTimeoutMs', 60000],
    ['authorizationTimeoutMs', 1800000],
  ]) {
    if (
      config[name] !== undefined &&
      (!Number.isSafeInteger(config[name]) || config[name] < (name === 'authorizationTimeoutMs' ? 60000 : 1000) || config[name] > max)
    )
      throw new Error(`enterprise package: invalid ${name}`)
  }
  config.origin = https(config.origin, 'origin', true)
  const policyOrigin = https(env.DSH_DESKTOP_ENTERPRISE_POLICY_ORIGIN, 'DSH_DESKTOP_ENTERPRISE_POLICY_ORIGIN', true)
  const updateRoot = https(env.DSH_DESKTOP_ENTERPRISE_UPDATE_URL, 'DSH_DESKTOP_ENTERPRISE_UPDATE_URL')
  const target = `${platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform}-${arch}`
  if (!['mac-arm64', 'mac-x64', 'win-x64'].includes(target))
    throw new Error('enterprise package: unsupported desktop target')
  const icon = env.DSH_DESKTOP_ENTERPRISE_ICON
  if (icon !== undefined && (!isAbsolute(icon) || extname(icon).toLowerCase() !== '.png' || !existsSync(icon)))
    throw new Error('enterprise package: DSH_DESKTOP_ENTERPRISE_ICON must be an existing absolute PNG path')
  if (env.DSH_DESKTOP_UNSIGNED !== '1' && (icon === undefined || !isAbsolute(icon) || !existsSync(icon)))
    throw new Error(
      'enterprise package: configure an existing absolute DSH_DESKTOP_ENTERPRISE_ICON for signed releases',
    )
  const channel = env.DSH_DESKTOP_UPDATE_CHANNEL ?? 'nightly'
  if (channel !== 'latest' && channel !== 'nightly') throw new Error('enterprise package: invalid update channel')
  return {
    config,
    icon,
    policy: { origin: policyOrigin, allowedPageOrigins: [policyOrigin], authentication: 'anonymous' },
    update: { publicUrl: `${updateRoot}/${target}`, channel, environment: 'enterprise' },
  }
}
