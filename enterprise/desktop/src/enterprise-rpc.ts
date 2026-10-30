/** Native model rotation through the authenticated Host RPC, preserving old references until Host exit. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { EnterpriseSession } from '@deepseek-ai/dsh-enterprise-protocol'
import { enterpriseCredentialRef, enterpriseProviders } from './enterprise-profile.ts'

/**
 * Write credentials before updating the enterprise route; personal providers and a personal default survive.
 * @param origin - Authenticated local Host origin.
 * @param send - Shell's authenticated HTTP transport.
 * @param session - New complete approved configuration.
 * @param authorized - Rechecked after writes so expiry cannot authorize another operation.
 * @returns Rotation completion, rejecting on any unknown or failed write outcome.
 */
export async function rotateEnterpriseModel(
  origin: string,
  send: typeof fetch,
  session: EnterpriseSession,
  authorized: () => boolean,
): Promise<void> {
  const invoke = async (method: string, args: object): Promise<unknown> => {
    if (!authorized()) throw new Error('Enterprise desktop: account expired during configuration synchronization')
    const rpcId = randomUUID()
    const response = await send(new URL(`/api/${method}`, origin), {
      method: 'POST',
      credentials: 'include',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error('Enterprise desktop: configuration synchronization failed')
    }
    const result = z
      .object({
        type: z.literal('server-response'),
        rpcId: z.literal(rpcId),
        result: z.object({ ok: z.literal(true), value: z.unknown().optional() }),
      })
      .safeParse(await response.json())
    if (!result.success) throw new Error('Enterprise desktop: configuration synchronization was rejected')
    return result.data.result.value
  }
  await invoke('credentials/set', { ref: enterpriseCredentialRef(session), value: session.provisioning.apiKey })
  await invoke('settings/mutate', {
    ns: 'llm-pi-ai',
    ops: [{ op: 'set', path: ['providers', 'enterprise'], value: enterpriseProviders(session).enterprise }],
  })
  const settings = z.object({ namespaces: z.array(z.object({
    ns: z.string(), revision: z.number(), value: z.unknown(),
  })) }).parse(await invoke('settings/describe', {}))
  const defaults = settings.namespaces.find(namespace => namespace.ns === 'agent-default-model')
  if (defaults === undefined) throw new Error('Enterprise desktop: default model settings are unavailable')
  const selection = z.object({ provider: z.string() }).parse(defaults.value)
  if (selection.provider === 'enterprise') await invoke('settings/update', {
    ns: 'agent-default-model', expectedRevision: defaults.revision,
    patch: { provider: 'enterprise', model: session.provisioning.defaultModel },
  })
}
