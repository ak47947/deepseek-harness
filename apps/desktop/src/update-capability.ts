/** Whether this installation can check, download, and install a release in place. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Feed file electron-builder seals into a packaged application the updater may use. */
const FEED_FILENAME = 'app-update.yml'

/**
 * macOS releases are DMG images distributed by MDM, so only Windows offers an in-application
 * updater. The sealed feed decides the rest: an unsigned Windows package carries none.
 * @param platform - Installed platform; every other platform updates through its installer.
 * @param packaged - Whether the running process is an installed application.
 * @param resourcesPath - Electron resources directory that holds the sealed feed.
 * @returns True when this process owns a usable updater feed.
 */
export function desktopUpdateSupported(
  platform: NodeJS.Platform,
  packaged: boolean,
  resourcesPath: string,
): boolean {
  return platform === 'win32' && packaged && existsSync(join(resourcesPath, FEED_FILENAME))
}
