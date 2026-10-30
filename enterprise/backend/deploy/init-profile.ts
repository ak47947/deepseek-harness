/** Initialize the enterprise profile before the container launches dsh. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { initProfile } from '@deepseek-ai/dsh-app-boot'

const root = resolve(
  process.env.DSH_HOME ??
    (() => {
      throw new Error('Enterprise setup: set a dedicated DSH_HOME')
    })(),
)
const profile = join(root, 'profiles', 'enterprise')
const entry = fileURLToPath(new URL('../lib/index.js', import.meta.url))
const consoleLogger = createRequire(import.meta.url).resolve('@deepseek-ai/cordis-plugin-logger-console')
readFileSync(entry)
mkdirSync(profile, { recursive: true, mode: 0o700 })
initProfile(profile, [])
writeFileSync(
  join(profile, 'cordis.patch.yml'),
  JSON.stringify(
    [
      {
        insert: [
          { id: 'logger-console', name: consoleLogger },
          { id: 'enterprise', name: entry },
        ],
      },
    ],
    null,
    2,
  ) + '\n',
  { mode: 0o600 },
)
process.stdout.write('Enterprise container profile initialized.\n')
