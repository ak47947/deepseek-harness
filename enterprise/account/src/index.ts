/** Enterprise account UI and shared model-facing enterprise identity. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name. */
export const name = 'ui-settings-enterprise-account'
/** Prompt registry shared by enterprise sessions and their subagents. */
export const inject = ['systemPrompt']

/** Enterprise identity resolved from desktop file configuration. */
export interface Config {
  /** Name every enterprise agent uses when identifying itself. */
  agentName: string
}

/** Required enterprise identity; the desktop shell supplies the resolved product name. */
export const Config: z<Config> = z.object({ agentName: z.string().required() })

/** @param ctx - Lifecycle owning the shared identity. @param config - Configured enterprise agent name. */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'harness:identity',
    order: ctx.systemPrompt.getSectionOrder('HARNESS_IDENTITY'),
    text: `You are ${config.agentName}, the enterprise AI assistant. Your name is ${config.agentName}.`,
    interpolate: false,
  }), 'enterprise identity')
}
