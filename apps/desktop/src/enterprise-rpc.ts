/** Native model rotation through the authenticated Host RPC, preserving old references until Host exit. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { EnterpriseSession } from '@deepseek-ai/dsh-enterprise/protocol'
import { enterpriseCredentialRef, enterpriseProviders } from './enterprise-profile.ts'

/**
 * Write credentials before switching the complete provider settings dictionary.
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
  const invoke = async (method: string, args: object): Promise<void> => {
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
        result: z.object({ ok: z.literal(true) }),
      })
      .safeParse(await response.json())
    if (!result.success) throw new Error('Enterprise desktop: configuration synchronization was rejected')
  }
  await invoke('credentials/set', { ref: enterpriseCredentialRef(session), value: session.provisioning.apiKey })
  await invoke('settings/replace', { ns: 'llm-pi-ai', section: { providers: enterpriseProviders(session) } })
  await invoke('settings/update', {
    ns: 'agent-default-model',
    patch: { provider: 'enterprise', model: session.provisioning.defaultModel },
  })
}
