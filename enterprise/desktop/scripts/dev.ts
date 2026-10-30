/** Select enterprise development configuration before the shared Desktop launcher starts. */
import { fileURLToPath } from 'node:url'

process.env.DSH_DESKTOP_CONFIG_FILE ??= fileURLToPath(new URL('../config/desktop.json', import.meta.url))
await import('../../../apps/desktop/scripts/dev.ts')
