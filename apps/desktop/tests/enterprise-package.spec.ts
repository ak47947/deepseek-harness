/** Enterprise builds reject official identity, missing destinations, and invalid release metadata. */
import { describe, expect, it } from 'vitest'
import { resolveEnterprisePackageEnvironment } from '../scripts/enterprise-package-environment.mjs'
import { resolveEnterpriseDesktopConfig } from '../src/enterprise-config.ts'
import { enterpriseDesktopLocale } from '../src/enterprise-branding.ts'
import { resolveDesktopLocale } from '../src/locale.ts'

const metadata = {
  appId: 'com.example.enterprise',
  productName: 'Example enterprise',
  origin: 'https://enterprise.example.test',
}
const environment = {
  DSH_DESKTOP_ENTERPRISE_CONFIG: JSON.stringify(metadata),
  DSH_DESKTOP_APP_ID: metadata.appId,
  DSH_DESKTOP_ENTERPRISE_UPDATE_URL: 'https://updates.example.test/releases',
  DSH_DESKTOP_ENTERPRISE_POLICY_ORIGIN: 'https://policy.example.test',
  DSH_DESKTOP_UNSIGNED: '1',
}

describe('enterprise desktop release settings', () => {
  it.each(['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt'])(
    'uses the enterprise product name throughout native %s copy',
    (language) => {
      const original = resolveDesktopLocale(language)
      const branded = enterpriseDesktopLocale(original, '企业 $& Desktop')
      expect(branded.messages.aboutProduct).toBe('企业 $& Desktop')
      expect(branded.messages.quitApplication).toContain('企业 $& Desktop')
      expect(branded.messages.updateTitle).toContain('企业 $& Desktop')
      expect(original.messages.aboutProduct).toBe('DeepSeek Harness')
      expect(enterpriseDesktopLocale(original, undefined)).toBe(original)
    },
  )
  it('seals an independent account origin and update destination without official fallbacks', () => {
    const result = resolveEnterprisePackageEnvironment(environment, 'darwin', 'arm64')
    expect(result?.config).toEqual(metadata)
    expect(result?.update).toEqual({
      publicUrl: 'https://updates.example.test/releases/mac-arm64',
      channel: 'nightly',
      environment: 'enterprise',
    })
    expect(result?.policy.origin).toBe('https://policy.example.test')
    expect(resolveEnterprisePackageEnvironment({}, 'darwin', 'arm64')).toBeUndefined()
  })

  it('preserves the configured browser authorization deadline in packaged metadata', () => {
    const configured = { ...metadata, authorizationTimeoutMs: 60000 }
    const result = resolveEnterprisePackageEnvironment({
      ...environment, DSH_DESKTOP_ENTERPRISE_CONFIG: JSON.stringify(configured),
    }, 'darwin', 'arm64')
    expect(result?.config).toEqual(configured)
    expect(resolveEnterpriseDesktopConfig(result?.config, false)?.authorizationTimeoutMs).toBe(60000)
  })

  it.each([
    { DSH_DESKTOP_ENTERPRISE_UPDATE_URL: 'https://download.deepseek.com' },
    { DSH_DESKTOP_ENTERPRISE_UPDATE_URL: '' },
    { DSH_DESKTOP_ENTERPRISE_POLICY_ORIGIN: 'http://policy.example.test' },
    { DSH_DESKTOP_APP_ID: 'com.deepseek.harness' },
    { DSH_DESKTOP_ENTERPRISE_CONFIG: '{invalid' },
    { DSH_DESKTOP_ENTERPRISE_CONFIG: JSON.stringify({ ...metadata, syncIntervalMs: 1 }) },
    { DSH_DESKTOP_ENTERPRISE_CONFIG: JSON.stringify({ ...metadata, authorizationTimeoutMs: 59999 }) },
    { DSH_DESKTOP_ENTERPRISE_CONFIG: JSON.stringify({ ...metadata, authorizationTimeoutMs: 1800001 }) },
    { DSH_DESKTOP_ENTERPRISE_CONFIG: JSON.stringify({ ...metadata, plugin: 'unapproved' }) },
    { DSH_DESKTOP_UNSIGNED: '0' },
    { DSH_DESKTOP_ENTERPRISE_ICON: '/missing/company.ico' },
    { DSH_DESKTOP_UPDATE_CHANNEL: 'invalid' },
  ])('rejects incomplete or unsafe enterprise release settings: %j', (patch) => {
    expect(() => resolveEnterprisePackageEnvironment({ ...environment, ...patch }, 'darwin', 'arm64')).toThrow()
  })

  it('accepts loopback development only when unpackaged and never accepts executable configuration', () => {
    expect(resolveEnterpriseDesktopConfig({ ...metadata, origin: `${metadata.origin}/` }, false)?.origin).toBe(metadata.origin)
    expect(resolveEnterpriseDesktopConfig({ ...metadata, origin: 'http://127.0.0.1:3090' }, true)?.origin).toBe(
      'http://127.0.0.1:3090',
    )
    expect(() => resolveEnterpriseDesktopConfig({ ...metadata, origin: 'http://127.0.0.1:3090' }, false)).toThrow()
    expect(() =>
      resolveEnterpriseDesktopConfig({ ...metadata, origin: 'https://enterprise.example.test/path' }, true),
    ).toThrow()
    expect(() => resolveEnterpriseDesktopConfig({ ...metadata, expression: '!!js process.env' }, true)).toThrow()
  })
})
