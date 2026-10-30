/** Whether this installation can check, download, and install a release in place. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Feed file electron-builder seals into a packaged application the updater may use. */
const FEED_FILENAME = 'app-update.yml'

/**
 * Enterprise macOS releases use MDM; the upstream distribution retains its native updater.
 * Every in-application updater requires a sealed feed.
 * @param platform - Installed platform; every other platform updates through its installer.
 * @param packaged - Whether the running process is an installed application.
 * @param resourcesPath - Electron resources directory that holds the sealed feed.
 * @param enterprise - Whether this distribution uses enterprise MDM on macOS.
 * @returns True when this process owns a usable updater feed.
 */
export function desktopUpdateSupported(
  platform: NodeJS.Platform,
  packaged: boolean,
  resourcesPath: string,
  enterprise: boolean,
): boolean {
  return (platform === 'win32' || (!enterprise && platform === 'darwin')) && packaged && existsSync(join(resourcesPath, FEED_FILENAME))
}
