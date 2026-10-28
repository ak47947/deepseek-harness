/** Loader function-plugin exports remain intact when the Host registers the browser contribution. */
import { expect, it } from 'vitest'
import * as host from '../src/index.ts'

it('exports the function-plugin namespace without a default export', () => {
  expect('default' in host).toBe(false)
  expect(host.name).toBe('ui-settings-enterprise-account')
  host.apply()
})
