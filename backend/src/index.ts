/** Enterprise application plugin, launched exclusively by a named dsh profile. */
import type { Context } from '@deepseek-ai/cordis'
import pg from 'pg'
import { resolveEnterpriseConfig } from './config.ts'
import { EnterpriseServer } from './server.ts'

/** Loader identity for the enterprise application. */
export const name = 'enterprise'

/**
 * Bind the configured enterprise listener and release its database after requests settle.
 * @param ctx - Profile-owned plugin lifecycle.
 * @returns Completion of startup; failures prevent the profile from reaching ready.
 */
export async function apply(ctx: Context): Promise<void> {
  const config = resolveEnterpriseConfig(process.env)
  const server = new EnterpriseServer(new pg.Pool({ connectionString: config.DATABASE_URL }), config)
  await ctx.effect(async () => {
    try {
      const port = await server.start()
      ctx.logger.info(
        'Enterprise service listening on %s:%d (%s)',
        config.DSH_ENTERPRISE_HOST,
        port,
        config.DSH_ENTERPRISE_MODE,
      )
    } catch (error) {
      await server.stop()
      throw error
    }
    return () => server.stop()
  })
}
