/** Optional distribution adapter; an unconfigured Desktop retains the upstream account flow. */
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { app } from 'electron'
import { createEnterpriseDesktop, type EnterpriseDesktopOperations } from './adapter.ts'
import { readDesktopConfiguration } from './desktop-configuration.ts'
import { desktopUpdateSupported } from './update-capability.ts'
import { enterpriseDesktopLocale } from './enterprise-branding.ts'

function packagedConfiguration(): unknown {
  if (!app.isPackaged) return undefined
  const manifest: unknown = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'))
  return typeof manifest === 'object' && manifest !== null && 'dshEnterprise' in manifest ? manifest.dshEnterprise : undefined
}

/**
 * Select an explicit enterprise distribution without changing unconfigured Desktop defaults.
 * @returns Product presentation and the optional pre-Host account adapter.
 */
export function desktopProduct() {
  const config = readDesktopConfiguration({ appRoot: app.getAppPath(), development: !app.isPackaged,
    dataRoot: join(app.getPath('appData'), 'com.atrix.desktop'), packaged: packagedConfiguration() })
  if (config !== undefined) {
    app.setName(config.productName)
    app.setPath('userData', (!app.isPackaged ? process.env.DSH_DESKTOP_USER_DATA_DIR : undefined)
      ?? join(app.getPath('appData'), config.appId))
  }
  return {
    productName: config?.productName ?? 'DeepSeek Harness',
    resourceRoot: app.isPackaged ? process.resourcesPath : config === undefined
      ? join(app.getAppPath(), 'resources') : join(app.getAppPath(), '..', '..', 'enterprise', 'desktop', 'resources'),
    supportsUpdates: (platform: NodeJS.Platform, packaged: boolean, resourcesPath: string) =>
      desktopUpdateSupported(platform, packaged, resourcesPath, config !== undefined),
    rendererArguments: config === undefined ? [] : ['--dsh-enterprise-desktop'],
    createAdapter: (operations: EnterpriseDesktopOperations) => config === undefined ? undefined : createEnterpriseDesktop(config, operations),
    localize<L extends { readonly messages: Record<string, string> }>(locale: L): L {
      return enterpriseDesktopLocale(locale, config?.productName)
    },
  }
}
