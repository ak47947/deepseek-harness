/** Enterprise identity remains stable across deployment personas and is removed with its plugin. */
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { expect, it, onTestFinished } from 'vitest'
import * as Enterprise from '../src/index.ts'

it('introduces the configured enterprise agent before the deployment persona', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, personaPrefix: 'You can help with coding tasks.' })
  const identity = await ctx.plugin(Enterprise, { agentName: 'Atrix Harness' })
  await expect(`${renderPrompt(await ctx.systemPrompt.assemble())}\n`).toMatchFileSnapshot('./expected/identity.txt')
  await identity.dispose()
  expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('You can help with coding tasks.')
})

it('preserves literal enterprise names without interpreting prompt variables', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(Enterprise, { agentName: 'Atrix {{custom}}' })
  expect(renderPrompt(await ctx.systemPrompt.assemble()))
    .toBe('You are Atrix {{custom}}, the enterprise AI assistant. Your name is Atrix {{custom}}.')
})
