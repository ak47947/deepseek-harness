/** Test-only browser carrier using the same application-owned profile runner as Desktop Host. */
import { createRequire } from 'node:module'
import { INSTALL_ANCHOR, prepareProfile, runProfile } from '../../../cli/lib/profile-boot.js'

const require = createRequire(new URL('../../../cli/package.json', import.meta.url))
const { Command } = require('commander')
const argv = process.argv.slice(2)
if (argv.some(arg => ['--dump-config', '--dump-default-config', '--dump-config-schema'].includes(arg))) {
  await import('../../../cli/lib/bin.js')
} else {
  const { loadLayeredEnv } = await import(require.resolve('@deepseek-ai/dsh-app-boot'))
  const program = new Command().helpOption(false).allowUnknownOption().passThroughOptions()
    .option('--profile <name>')
    .option('--from-default-profile <name>')
    .option('--patch <path>', '', (value, previous = []) => [...previous, value])
    .argument('[args...]')
  const expanded = argv[0] !== undefined && !argv[0].startsWith('-') ? ['--profile', ...argv] : argv
  program.parse(expanded, { from: 'user' })
  const options = program.opts()
  const profile = prepareProfile(options.profile, true, options.fromDefaultProfile)
  await runProfile({
    environment: loadLayeredEnv('dsh'), profile: options.profile,
    resolvedProfile: { profile, installAnchor: INSTALL_ANCHOR },
    patchFiles: options.patch ?? [], args: program.args,
  })
}
