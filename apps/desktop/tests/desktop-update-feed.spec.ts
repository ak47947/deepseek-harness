import { describe, expect, it } from 'vitest'
import { resolveUpdateFeed, type DesktopPackageUpdateFeed } from '../scripts/electron-builder-config.mjs'

const TEST_FEED = { DSH_DESKTOP_AUTO_UPDATE_ENV: 'test', DOWNLOAD_TEST_ORIGIN: 'https://updates.example.com',
  DOWNLOAD_TEST_RELEASE_ID: '0123456789abcdef0123456789abcdef' }
const ENTERPRISE = { update: { publicUrl: 'https://updates.example.com/releases/win-x64', channel: 'nightly', environment: 'enterprise' } } satisfies { update: DesktopPackageUpdateFeed }

describe('Desktop sealed update feed', () => {
  it('keeps the enterprise feed of an unsigned Windows installer', () => {
    expect(resolveUpdateFeed({}, 'win32', 'x64', ENTERPRISE, true)).toBe(ENTERPRISE.update)
  })

  it('seals no feed for an unsigned macOS DMG', () => {
    expect(resolveUpdateFeed({}, 'darwin', 'arm64', ENTERPRISE, true)).toBeUndefined()
    expect(resolveUpdateFeed(TEST_FEED, 'darwin', 'arm64', undefined, true)).toBeUndefined()
  })

  it('seals the release feed of an unsigned Windows installer when settings name one', () => {
    expect(resolveUpdateFeed(TEST_FEED, 'win32', 'x64', undefined, true)?.publicUrl)
      .toBe('https://updates.example.com/dsh-desk/0123456789abcdef0123456789abcdef/feeds/win-x64/')
  })

  it('leaves an unsigned Windows installer without release settings free of a feed', () => {
    expect(resolveUpdateFeed({ DSH_DESKTOP_AUTO_UPDATE_ENV: 'test', DOWNLOAD_TEST_ORIGIN: '' }, 'win32', 'x64', undefined, true))
      .toBeUndefined()
  })

  it('resolves the signed feed exactly as before', () => {
    expect(resolveUpdateFeed({}, 'win32', 'x64', ENTERPRISE, false)).toBe(ENTERPRISE.update)
    expect(resolveUpdateFeed(TEST_FEED, 'win32', 'x64', undefined, false)?.publicUrl)
      .toBe('https://updates.example.com/dsh-desk/0123456789abcdef0123456789abcdef/feeds/win-x64/')
  })
})
