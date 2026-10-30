import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectClientDomainViolations, resolveClientImport } from './verify-client-domain-graph.ts'

describe('client domain import resolution', () => {
  it('preserves imports that leave src/client from a top-level file', () => {
    expect(resolveClientImport('styles.ts', '../styles/base.css?inline'))
      .toBe('../styles/base.css?inline')
  })

  it('normalizes imports between domains inside src/client', () => {
    expect(resolveClientImport('input/hub.ts', '../queue/store.ts'))
      .toBe('queue/store.ts')
  })

  it('rejects enterprise Client imports between sibling domains', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-enterprise-client-domains-'))
    try {
      const directory = join(root, 'enterprise/account/src/client/view')
      mkdirSync(directory, { recursive: true })
      const file = join(directory, 'View.tsx')
      writeFileSync(file, "import { state } from '../contract/state.ts'\n")
      expect(collectClientDomainViolations(root)).toEqual([])
      writeFileSync(file, "import { state } from '../other/state.ts'\n")
      expect(collectClientDomainViolations(root)).toEqual([{
        file: 'enterprise/account/src/client/view/View.tsx',
        imported: '../other/state.ts',
        reason: 'domain "view" imports sibling domain "other" (route shared API through contract/)',
      }])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
