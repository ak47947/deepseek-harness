import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { desktopUpdateSupported } from '../src/update-capability.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function resources(feed: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-update-capability-'))
  roots.push(root)
  if (feed) await writeFile(join(root, 'app-update.yml'), 'provider: generic\n')
  return root
}

describe('Desktop update capability', () => {
  it('uses the sealed feed of an installed Windows application', async () => {
    expect(desktopUpdateSupported('win32', true, await resources(true))).toBe(true)
  })

  it('leaves macOS to its DMG installer even when a feed is present', async () => {
    expect(desktopUpdateSupported('darwin', true, await resources(true))).toBe(false)
  })

  it('requires both an installed application and its sealed feed', async () => {
    expect(desktopUpdateSupported('win32', false, await resources(true))).toBe(false)
    expect(desktopUpdateSupported('win32', true, await resources(false))).toBe(false)
  })
})
