/** File-based enterprise startup defaults and invalid-document retention. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readDesktopConfiguration } from '../src/desktop-configuration.ts'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'atrix-desktop-config-'))
  directories.push(root)
  return { root, file: join(root, 'desktop.json') }
}

describe('enterprise desktop configuration', () => {
  it.each([undefined, {}, { enterprise: {} }])('opens Atrix Harness against port 3090 when enterprise fields are absent: %j', (value) => {
    const { root, file } = fixture()
    if (value !== undefined) writeFileSync(file, JSON.stringify(value))
    const result = readDesktopConfiguration({ appRoot: root, development: true, environment: { DSH_DESKTOP_CONFIG_FILE: file } })
    expect(result).toMatchObject({ appId: 'com.atrix.desktop', enterpriseName: 'Atrix Harness', productName: 'Atrix Harness', origin: 'http://127.0.0.1:3090' })
  })
  it('uses edited file fields after restart while retaining omitted defaults', () => {
    const { root, file } = fixture()
    writeFileSync(file, JSON.stringify({ enterprise: { productName: 'Company desktop', origin: 'https://company.example.test' } }))
    expect(readDesktopConfiguration({ appRoot: root, development: true, environment: { DSH_DESKTOP_CONFIG_FILE: file } }))
      .toMatchObject({ enterpriseName: 'Atrix Harness', productName: 'Company desktop', origin: 'https://company.example.test' })
  })
  it('creates an editable installed configuration and accepts the default loopback service', () => {
    const { root } = fixture()
    const result = readDesktopConfiguration({ appRoot: root, dataRoot: root, development: false, environment: {} })
    expect(result.origin).toBe('http://127.0.0.1:3090')
    expect(readFileSync(join(root, 'desktop/config.json'), 'utf8')).toContain('"productName": "Atrix Harness"')
  })
  it.each(['{invalid', '{"enterprise":{"origin":"http://remote.example.test"}}', '{"enterprise":{"plugin":"untrusted"}}'])('retains invalid configuration without opening a personal application: %s', (text) => {
    const { root, file } = fixture()
    writeFileSync(file, text)
    expect(() => readDesktopConfiguration({ appRoot: root, development: false, environment: { DSH_DESKTOP_CONFIG_FILE: file } })).toThrow()
    expect(readFileSync(file, 'utf8')).toBe(text)
  })
})
