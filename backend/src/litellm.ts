/** Bounded LiteLLM management and streaming calls; virtual keys never leave the server. */
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { EnterpriseConfig } from './config.ts'
import { EnterpriseRequestError } from './protocol.ts'

/** Fixed-version LiteLLM API adapter. Authentication and budgets attach to the stable employee identity. */
export class LiteLlmGateway {
  /** @param config - Managed deployment settings. @param send - Fetch implementation owned by this application. */
  constructor(
    private readonly config: EnterpriseConfig,
    private readonly send: typeof fetch = fetch,
  ) {}

  /** @param userId - Stable authentication ID. @returns Gateway identity stable across devices and key rotation. */
  identity(userId: string): string {
    return `dsh_${createHash('sha256')
      .update(JSON.stringify([this.config.DSH_ENTERPRISE_ID, userId]))
      .digest('hex')}`
  }

  /** @returns Completion of gateway connectivity and management-credential validation. */
  async check(): Promise<void> {
    await this.models()
  }

  /** @returns Model IDs exposed by the configured gateway; provider credentials in its response are excluded. */
  async models(): Promise<string[]> {
    const result = z
      .object({ data: z.array(z.object({ model_name: z.string() })) })
      .parse(await this.manage('/model/info', 'GET'))
    return [...new Set(result.data.map(model => model.model_name))]
  }

  /** @returns A virtual key to persist before making a management call, so an interrupted creation can be reconciled or revoked. */
  allocateKey(): string {
    return `sk-${randomBytes(32).toString('hex')}`
  }

  /**
   * Create an employee gateway identity and a model-scoped key. Repeated calls retain the user budget's accumulated spend.
   * @param userId - Stable authentication ID.
   * @param models - Approved gateway model IDs.
   * @param key - Virtual key already saved by the caller, whether creation has completed or remains uncertain.
   * @returns Confirmed provisioning completion; retry queries the saved key before creating it.
   */
  async provision(userId: string, models: string[], key: string): Promise<void> {
    const id = this.identity(userId)
    const info = await this.manage(`/user/info?user_id=${encodeURIComponent(id)}`, 'GET', undefined, [404])
    if (info === null)
      await this.manage('/user/new', 'POST', { user_id: id, auto_create_key: false, models, budget_duration: '1mo' })
    else await this.manage('/user/update', 'POST', { user_id: id, models })
    const keyHash = createHash('sha256').update(key).digest('hex')
    const existing = await this.manage(`/key/info?key=${keyHash}`, 'GET', undefined, [404])
    if (existing !== null) {
      await this.manage('/key/update', 'POST', { key, models })
      return
    }
    const result = await this.manage('/key/generate', 'POST', { user_id: id, models, key_alias: id, key })
    if (z.object({ key: z.string().min(1) }).parse(result).key !== key)
      throw new Error('LiteLLM did not retain the preallocated employee key')
  }

  /** @param key - Employee virtual key. @returns Confirmed gateway deletion; failures remain retryable and visible. */
  async revoke(key: string): Promise<void> {
    await this.manage('/key/delete', 'POST', { keys: [key] })
  }

  /** @param userId - Employee identity. @param maxBudget - Monthly cap in LiteLLM's configured currency. */
  async budget(userId: string, maxBudget: number): Promise<void> {
    await this.manage('/user/update', 'POST', { user_id: this.identity(userId), max_budget: maxBudget })
  }

  /**
   * @param userId - Employee identity.
   * @param query - Validated UTC range, model filter, and page.
   * @returns Gateway-owned budget and a page of usage records, excluding all credentials and prompt data.
   */
  async usage(userId: string, query: { start: string; end: string; model?: string | undefined; page: number }) {
    const id = this.identity(userId)
    const info = z
      .object({
        user_info: z.object({
          spend: z.number().nonnegative(),
          max_budget: z.number().nonnegative().nullable(),
          budget_reset_at: z.string().nullable().optional(),
        }),
      })
      .parse(await this.manage(`/user/info?user_id=${encodeURIComponent(id)}`, 'GET'))
    const parameters = new URLSearchParams({
      user_id: id,
      start_date: `${query.start} 00:00:00`,
      end_date: `${query.end} 23:59:59`,
      page: String(query.page),
      page_size: '100',
    })
    if (query.model) parameters.set('model', query.model)
    const history = z
      .object({
        data: z.array(
          z.object({
            model: z.string(),
            startTime: z.string(),
            spend: z.number().nonnegative(),
            prompt_tokens: z.number().int().nonnegative(),
            completion_tokens: z.number().int().nonnegative(),
          }),
        ),
        total: z.number().int().nonnegative(),
        total_pages: z.number().int().nonnegative(),
        page: z.number().int().positive(),
      })
      .parse(await this.manage(`/spend/logs/v2?${parameters.toString()}`, 'GET'))
    return { currency: 'USD', budget: info.user_info, history }
  }

  /**
   * @param key - Employee virtual key.
   * @param path - Approved protocol endpoint.
   * @param body - Validated employee request.
   * @param signal - Client disconnect cancellation.
   * @returns Upstream streaming response.
   */
  forward(key: string, path: string, body: string, signal: AbortSignal): Promise<Response> {
    return this.send(this.url(path), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.DSH_ENTERPRISE_UPSTREAM_TIMEOUT_MS)]),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        ...(path === '/v1/messages' ? { 'anthropic-version': '2023-06-01' } : {}),
      },
      body,
    })
  }

  private url(path: string): string {
    const base = this.config.DSH_ENTERPRISE_LITELLM_URL
    if (base === undefined) throw new Error('LiteLLM is not configured')
    return `${base.replace(/\/$/u, '')}${path}`
  }

  private async manage(path: string, method: string, body?: object, absent: number[] = []): Promise<unknown> {
    const response = await this.send(this.url(path), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.DSH_ENTERPRISE_LITELLM_KEY ?? ''}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (absent.includes(response.status)) {
      await response.body?.cancel()
      return null
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new EnterpriseRequestError(response.status)
    }
    return response.json()
  }
}
