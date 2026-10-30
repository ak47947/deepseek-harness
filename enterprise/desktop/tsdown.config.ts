import { defineConfig } from 'tsdown'

export default defineConfig({ entry: ['lib/types/index.js', 'lib/types/preload.js', 'lib/types/enterprise-branding.js'], deps: { neverBundle: ['electron'] } })
