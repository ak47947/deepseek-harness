/** Enterprise HTTP application: authenticated administration, provisioning, and optional streaming proxy. */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Pool } from 'pg'
import { getMigrations } from 'better-auth/db/migration'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import { z } from 'zod'
import { createEnterpriseAuth, type EnterpriseAuth, type AuthenticatedEmployee } from './auth.ts'
import type { EnterpriseConfig } from './config.ts'
import { EnterpriseSecrets } from './secrets.ts'
import { EnterpriseStore, type AssignmentRow } from './store.ts'
import { LiteLlmGateway } from './litellm.ts'
import { enterpriseSessionSchema, provisioningSchema, EnterpriseRequestError } from './protocol.ts'
import { adminDocument, adminScript, adminStyles } from './web.ts'
import { EnterpriseDepartments, DepartmentRequestError, departmentIdSchema, departmentInputSchema } from './departments.ts'
import type { EnterpriseUserId, Provisioning } from './protocol.ts'
import {
  authorizationDocument,
  authorizationScript,
  authorizationStyles,
} from './authorization-web.ts'
import { authorizationBrandPng } from './authorization-brand.ts'

const employeeInput = z
  .object({
    email: z.email(),
    name: z.string().min(1).max(256),
    password: z.string().min(12).max(128),
    role: z.enum(['admin', 'user']),
  })
  .strict()
const publicAuthPaths = new Set([
  '/api/auth/sign-in/email',
  '/api/auth/sign-out',
  '/api/auth/get-session',
  '/api/auth/change-password',
  '/api/auth/enterprise/desktop/authorize',
  '/api/auth/enterprise/desktop/approve',
  '/api/auth/enterprise/desktop/token',
])
const modelPaths = new Set(['/v1/chat/completions', '/v1/responses', '/v1/messages'])
// Provider override fields accepted by LiteLLM are deliberately absent: an employee cannot select another upstream or credential.
const modelFields = new Set([
  'model',
  'messages',
  'input',
  'instructions',
  'stream',
  'stream_options',
  'temperature',
  'top_p',
  'top_k',
  'max_tokens',
  'max_completion_tokens',
  'max_output_tokens',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'reasoning_effort',
  'reasoning',
  'thinking',
  'stop',
  'stop_sequences',
  'seed',
  'response_format',
  'presence_penalty',
  'frequency_penalty',
  'logprobs',
  'top_logprobs',
  'store',
  'service_tier',
  'previous_response_id',
  'include',
  'text',
  'truncation',
  'system',
  'cache_control',
  'context_management',
])
const usageQuery = z
  .object({
    start: z.iso.date(),
    end: z.iso.date(),
    model: z.string().max(256).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .refine(
    value => value.start <= value.end && Date.parse(value.end) - Date.parse(value.start) <= 31 * 86400000,
    'Select a range of at most 32 UTC days',
  )

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

async function body(request: IncomingMessage, limit = 1024 * 1024): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const received of request) {
    const chunk: unknown = received
    if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) throw new EnterpriseRequestError(400)
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk)
    bytes += buffer.length
    if (bytes > limit) throw new EnterpriseRequestError(413)
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (_error) {
    throw new EnterpriseRequestError(400)
  }
}

/** Owns one listener and all authenticated application operations until quiescent shutdown. */
export class EnterpriseServer {
  private readonly auth: EnterpriseAuth
  readonly store: EnterpriseStore
  private readonly departments: EnterpriseDepartments
  private readonly gateway: LiteLlmGateway | undefined
  private readonly server: Server
  private readonly requests = new Set<Promise<void>>()
  private readonly aborts = new Set<AbortController>()
  private administration: Promise<void> = Promise.resolve()

  /**
   * @param database - Owned deployment PostgreSQL pool.
   * @param config - Validated deployment settings.
   * @param send - Gateway transport; production uses Fetch.
   */
  constructor(
    private readonly database: Pool,
    readonly config: EnterpriseConfig,
    send: typeof fetch = fetch,
  ) {
    this.auth = createEnterpriseAuth(database, config)
    this.store = new EnterpriseStore(database, new EnterpriseSecrets(config.BETTER_AUTH_SECRET))
    this.departments = new EnterpriseDepartments(database)
    this.gateway = config.DSH_ENTERPRISE_MODE === 'managed' ? new LiteLlmGateway(config, send) : undefined
    this.server = createServer((request, response) => {
      const pending = this.handle(request, response)
        .catch((error: unknown) => {
          if (response.headersSent) {
            response.destroy()
            return
          }
          const status =
            error instanceof EnterpriseRequestError ? error.status : error instanceof z.ZodError ? 400 : 503
          json(response, status, { error: { code: error instanceof DepartmentRequestError ? error.code : status === 503 ? 'service_unavailable' : 'request_rejected' } })
        })
        .finally(() => {
          this.requests.delete(pending)
        })
      this.requests.add(pending)
    })
    this.server.requestTimeout = 30000
    this.server.headersTimeout = 15000
  }

  /**
   * Migrate owned tables, create the first administrator when configured, verify LiteLLM, then listen.
   * @returns Assigned HTTP port, including the OS-assigned port when configured as zero.
   */
  async start(): Promise<number> {
    const migrations = await getMigrations(this.auth.options)
    await migrations.runMigrations()
    await this.store.migrate()
    await this.departments.migrate()
    if (
      this.gateway !== undefined &&
      (await this.store.hasBasicAssignments()) &&
      this.config.DSH_ENTERPRISE_DIRECT_KEYS_REVOKED_AT === undefined
    ) {
      throw new Error(
        'Enterprise startup: revoke distributed provider credentials, then record DSH_ENTERPRISE_DIRECT_KEYS_REVOKED_AT before enabling managed mode',
      )
    }
    const count = await this.database.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM "user"')
    if (count.rows[0]?.count === '0') {
      const email = this.config.DSH_ENTERPRISE_BOOTSTRAP_EMAIL
      const password = this.config.DSH_ENTERPRISE_BOOTSTRAP_PASSWORD
      if (email === undefined || password === undefined)
        throw new Error('Enterprise startup: configure the first administrator email and password')
      await this.auth.api.createUser({ body: { email, password, name: 'Administrator', role: 'admin' } })
    }
    await this.gateway?.check()
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.config.DSH_ENTERPRISE_PORT, this.config.DSH_ENTERPRISE_HOST, () => {
        this.server.off('error', reject)
        resolve()
      })
    })
    const address = this.server.address()
    if (address === null || typeof address === 'string') throw new Error('Enterprise listener did not supply a port')
    return address.port
  }

  /** @returns Listener shutdown, upstream cancellation, request settlement, and pool closure. */
  async stop(): Promise<void> {
    for (const controller of this.aborts) controller.abort()
    const closed = new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error && (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING')) reject(error)
        else resolve()
      })
    })
    this.server.closeAllConnections()
    await Promise.all([closed, Promise.allSettled(this.requests)])
    await this.database.end()
  }

  private async employee(request: IncomingMessage, administrator = false): Promise<AuthenticatedEmployee> {
    const employee = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
      query: { disableCookieCache: true },
    })
    if (employee === null || employee.session.expiresAt.getTime() <= Date.now()) throw new EnterpriseRequestError(401)
    if (employee.user.banned || (administrator && employee.user.role !== 'admin')) throw new EnterpriseRequestError(403)
    return employee
  }

  private modelToken(userId: string, sessionId: string): string {
    const mac = createHmac('sha256', this.config.BETTER_AUTH_SECRET)
      .update(JSON.stringify(['model', this.config.DSH_ENTERPRISE_ID, userId, sessionId]))
      .digest('base64url')
    return `entm_${Buffer.from(userId).toString('base64url')}.${Buffer.from(sessionId).toString('base64url')}.${mac}`
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if ((request.method === 'POST' && request.url?.startsWith('/v1/admin/')) ||
      (request.method === 'GET' && request.url?.split('?')[0] === '/v1/session')) {
      const operation = this.administration.then(() => this.route(request, response))
      // Each following operation re-reads authoritative account and assignment state after the predecessor settles.
      this.administration = operation.catch((_error: unknown) => {})
      await operation
    } else await this.route(request, response)
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const authorizationUrl = new URL(request.url ?? '/', this.config.DSH_ENTERPRISE_ORIGIN)
    if (request.method === 'GET' && ['/dsh/authorize', '/dsh/authorized', '/dsh/auth.js', '/dsh/auth.css', '/dsh/brand.png'].includes(authorizationUrl.pathname)) {
      const path = authorizationUrl.pathname
      const content = path === '/dsh/auth.js' ? authorizationScript : path === '/dsh/auth.css' ? authorizationStyles
        : path === '/dsh/brand.png' ? authorizationBrandPng : authorizationDocument(this.config.DSH_ENTERPRISE_PRODUCT_NAME)
      response.writeHead(200, { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        'content-type': path.endsWith('.js') ? 'text/javascript; charset=utf-8' : path.endsWith('.css') ? 'text/css; charset=utf-8'
          : path.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8' })
      response.end(content)
      return
    }
    const url = new URL(request.url ?? '/', this.config.DSH_ENTERPRISE_ORIGIN)
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('referrer-policy', 'no-referrer')
    response.setHeader('cache-control', 'no-store')
    const adminPage = ['/', '/admin', '/admin/'].includes(url.pathname)
    if (request.method === 'GET' && (adminPage || ['/admin/app.js', '/admin/app.css', '/app.js', '/app.css'].includes(url.pathname))) {
      response.setHeader(
        'content-security-policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      )
      response.setHeader(
        'content-type',
        adminPage
          ? 'text/html; charset=utf-8'
          : url.pathname.endsWith('.js')
            ? 'text/javascript'
            : 'text/css',
      )
      response.end(adminPage ? adminDocument : url.pathname.endsWith('.js') ? adminScript : adminStyles)
      return
    }
    if (url.pathname === '/health' && request.method === 'GET') {
      json(response, 200, { status: 'ok', mode: this.config.DSH_ENTERPRISE_MODE })
      return
    }
    if (publicAuthPaths.has(url.pathname)) {
      await toNodeHandler(this.auth)(request, response)
      return
    }
    if (modelPaths.has(url.pathname) && request.method === 'POST') {
      await this.model(request, response, url.pathname)
      return
    }
    if (request.method !== 'GET') {
      const origin = request.headers.origin
      if (origin !== undefined && origin !== this.config.DSH_ENTERPRISE_ORIGIN) throw new EnterpriseRequestError(403)
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new EnterpriseRequestError(403)
    }
    const employee = await this.employee(request, url.pathname.startsWith('/v1/admin/'))
    if (url.pathname === '/v1/admin/platform-default') {
      if (request.method === 'GET') {
        const configuration = await this.store.platformDefault()
        json(response, 200, { configuration: configuration === null ? null : { ...configuration, apiKey: undefined } })
      } else if (request.method === 'POST') {
        const configuration = await this.approvedConfiguration(provisioningSchema.parse(await body(request)))
        await this.store.setPlatformDefault(configuration)
        json(response, 200, { ok: true })
      } else throw new EnterpriseRequestError(405)
      return
    }
    if (url.pathname === '/v1/admin/departments') {
      if (request.method === 'GET') json(response, 200, { departments: await this.departments.list() })
      else if (request.method === 'POST') json(response, 201, { department: await this.departments.create(departmentInputSchema.parse(await body(request))) })
      else throw new EnterpriseRequestError(405)
      return
    }
    const departmentMatch = /^\/v1\/admin\/departments\/([^/]+)(\/delete)?$/u.exec(url.pathname)
    if (departmentMatch !== null) {
      if (request.method !== 'POST') throw new EnterpriseRequestError(405)
      const id = departmentIdSchema.parse(decodeURIComponent(departmentMatch[1] ?? ''))
      if (departmentMatch[2] === '/delete') {
        z.object({}).strict().parse(await body(request))
        await this.departments.remove(id)
      } else await this.departments.update(id, departmentInputSchema.parse(await body(request)))
      json(response, 200, { ok: true })
      return
    }
    if (url.pathname === '/v1/admin/models' && request.method === 'GET') {
      if (this.gateway === undefined) throw new EnterpriseRequestError(404)
      json(response, 200, { models: await this.gateway.models() })
      return
    }
    if (url.pathname === '/v1/session' && request.method === 'GET') {
      const assigned = await this.resolveAssignment(employee.user.id)
      if (assigned === null || assigned.configuration.mode !== this.config.DSH_ENTERPRISE_MODE)
        throw new EnterpriseRequestError(409)
      if (this.gateway !== undefined && (assigned.gateway_state !== 'ready' || assigned.gateway_key === null))
        throw new EnterpriseRequestError(409)
      const provisioning =
        this.gateway === undefined
          ? assigned.configuration
          : {
            ...assigned.configuration,
            baseURL: `${this.config.DSH_ENTERPRISE_ORIGIN}/v1`,
            apiKey: this.modelToken(employee.user.id, employee.session.id),
          }
      json(
        response,
        200,
        enterpriseSessionSchema.parse({
          enterpriseId: this.config.DSH_ENTERPRISE_ID,
          userId: employee.user.id,
          name: employee.user.name,
          email: employee.user.email,
          role: employee.user.role,
          expiresAt: employee.session.expiresAt.toISOString(),
          provisioning,
        }),
      )
      return
    }
    if (url.pathname === '/v1/admin/employees' && request.method === 'GET') {
      const platformDefault = await this.store.platformDefault()
      const users = await this.database.query(
        'SELECT u.id, u.name, u.email, u.role, u.banned, m.department_id AS "departmentId" FROM "user" u LEFT JOIN enterprise_department_member m ON m.user_id = u.id ORDER BY u."createdAt" DESC LIMIT 1000',
      )
      const rows = await Promise.all(
        users.rows.map(async (user: { id: string }) => {
          const assigned = await this.store.assignment(user.id)
          const inherited = assigned === null || assigned.uses_platform_default
          const configuration = inherited ? platformDefault : assigned.configuration
          return {
            ...user,
            assignment: configuration === null ? null : { ...configuration, apiKey: undefined },
            assignmentSource: inherited ? 'platform' : 'user',
            gatewayState: assigned?.gateway_state ?? 'unconfigured',
            managedSince: assigned?.managed_since?.toISOString() ?? null,
          }
        }),
      )
      json(response, 200, { mode: this.config.DSH_ENTERPRISE_MODE, employees: rows, viewerId: employee.user.id })
      return
    }
    if (url.pathname === '/v1/admin/employees' && request.method === 'POST') {
      const input = employeeInput.parse(await body(request))
      const result = await this.auth.api.createUser({ headers: fromNodeHeaders(request.headers), body: input })
      json(response, 201, { user: result.user })
      return
    }
    const match =
      /^\/v1\/admin\/employees\/([^/]+)\/(assignment|password|disable|retry-cleanup|role|budget|usage|department)$/u.exec(
        url.pathname,
      )
    if (match === null) throw new EnterpriseRequestError(404)
    const userId = decodeURIComponent(match[1] ?? '')
    const action = match[2]
    const headers = fromNodeHeaders(request.headers)
    if (action === 'usage' && request.method === 'GET') {
      if (this.gateway === undefined) throw new EnterpriseRequestError(404)
      const range = usageQuery.parse(Object.fromEntries(url.searchParams))
      const assigned = await this.store.assignment(userId)
      json(response, 200, {
        ...(await this.gateway.usage(userId, range)),
        managedSince: assigned?.managed_since?.toISOString() ?? null,
      })
      return
    }
    if (request.method !== 'POST') throw new EnterpriseRequestError(405)
    if (action === 'department') {
      const input = z.object({ departmentId: departmentIdSchema.nullable() }).strict().parse(await body(request))
      await this.departments.assign(userId as EnterpriseUserId, input.departmentId)
    } else if (action === 'assignment') {
      const input = await body(request)
      const inherit = z.object({ usePlatformDefault: z.literal(true) }).strict().safeParse(input).success
      const configuration = inherit ? await this.store.platformDefault() : provisioningSchema.parse(input)
      if (configuration === null) throw new EnterpriseRequestError(409)
      await this.assignConfiguration(userId, await this.approvedConfiguration(configuration), inherit)
    } else if (action === 'password') {
      const input = z
        .object({ password: z.string().min(12).max(128) })
        .strict()
        .parse(await body(request))
      await this.auth.api.setUserPassword({ headers, body: { userId, newPassword: input.password } })
      await this.auth.api.revokeUserSessions({ headers, body: { userId } })
    } else if (action === 'disable' || action === 'retry-cleanup') {
      if (userId === employee.user.id) throw new EnterpriseRequestError(409)
      await this.auth.api.banUser({ headers, body: { userId, banReason: 'Enterprise account disabled' } })
      const assigned = await this.store.assignment(userId)
      if (this.gateway !== undefined && assigned?.gateway_key != null) {
        await this.store.gateway(userId, assigned.gateway_key, 'cleanup-required')
        await this.gateway.revoke(assigned.gateway_key)
        await this.store.gateway(userId, null, 'unconfigured')
      }
      json(response, 200, {
        disabled: true,
        upstreamRevocation: this.gateway === undefined ? 'provider-action-required' : 'complete',
      })
      return
    } else if (action === 'role') {
      const input = z
        .object({ role: z.enum(['admin', 'user']) })
        .strict()
        .parse(await body(request))
      if (userId === employee.user.id) throw new EnterpriseRequestError(409)
      await this.auth.api.setRole({ headers, body: { userId, role: input.role } })
    } else if (action === 'budget') {
      if (this.gateway === undefined) throw new EnterpriseRequestError(404)
      const input = z
        .object({ maxBudget: z.number().nonnegative() })
        .strict()
        .parse(await body(request))
      await this.gateway.budget(userId, input.maxBudget)
    } else throw new EnterpriseRequestError(404)
    json(response, 200, { ok: true })
  }

  private async approvedConfiguration(configuration: Provisioning): Promise<Provisioning> {
    if (configuration.mode !== this.config.DSH_ENTERPRISE_MODE) throw new EnterpriseRequestError(409)
    if (this.gateway === undefined) return configuration
    const available = await this.gateway.models()
    if (configuration.models.some(model => !available.includes(model.id))) throw new EnterpriseRequestError(403)
    return { ...configuration, apiKey: 'server-managed', baseURL: `${this.config.DSH_ENTERPRISE_ORIGIN}/v1` }
  }

  private async assignConfiguration(userId: string, configuration: Provisioning, inherited: boolean): Promise<void> {
    const previous = await this.store.assignment(userId)
    // A failed gateway update leaves this account unavailable until its next explicit retry or inherited refresh.
    await this.store.assign(userId, configuration, inherited)
    if (this.gateway === undefined) return
    const key = previous?.gateway_key ?? this.gateway.allocateKey()
    await this.store.gateway(userId, key, 'unconfigured')
    await this.gateway.provision(userId, configuration.models.map(model => model.id), key)
    await this.store.gateway(userId, key, 'ready')
  }

  private async resolveAssignment(userId: string): Promise<AssignmentRow | null> {
    const assigned = await this.store.assignment(userId)
    if (assigned !== null && !assigned.uses_platform_default) return assigned
    const configuration = await this.store.platformDefault()
    if (configuration === null || configuration.mode !== this.config.DSH_ENTERPRISE_MODE) return null
    if (assigned === null || JSON.stringify(assigned.configuration) !== JSON.stringify(configuration) ||
      (this.gateway !== undefined && (assigned.gateway_state !== 'ready' || assigned.gateway_key === null))) {
      await this.assignConfiguration(userId, await this.approvedConfiguration(configuration), true)
      return this.store.assignment(userId)
    }
    return assigned
  }

  private async model(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
    if (this.gateway === undefined) throw new EnterpriseRequestError(404)
    const bearer = request.headers.authorization?.replace(/^Bearer /iu, '')
    const apiKey = request.headers['x-api-key']
    if (bearer !== undefined && apiKey !== undefined && bearer !== apiKey) throw new EnterpriseRequestError(401)
    const token = bearer ?? (typeof apiKey === 'string' ? apiKey : '')
    const identity = /^entm_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/u.exec(token)
    if (identity === null) throw new EnterpriseRequestError(401)
    const userId = Buffer.from(identity[1] ?? '', 'base64url').toString('utf8')
    const sessionId = Buffer.from(identity[2] ?? '', 'base64url').toString('utf8')
    const expected = this.modelToken(userId, sessionId)
    if (token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected)))
      throw new EnterpriseRequestError(401)
    const users = await this.database.query<{ banned: boolean; expiresAt: Date }>(
      'SELECT u.banned, s."expiresAt" FROM "user" u JOIN "session" s ON s."userId" = u.id WHERE u.id = $1 AND s.id = $2',
      [userId, sessionId],
    )
    if (users.rows[0] === undefined || users.rows[0].banned) throw new EnterpriseRequestError(403)
    if (users.rows[0].expiresAt.getTime() <= Date.now()) throw new EnterpriseRequestError(401)
    const assigned = await this.store.assignment(userId)
    if (
      assigned === null ||
      assigned.configuration.mode !== 'managed' ||
      assigned.gateway_key === null ||
      assigned.gateway_state !== 'ready'
    )
      throw new EnterpriseRequestError(403)
    if (assigned.uses_platform_default &&
      JSON.stringify(assigned.configuration) !== JSON.stringify(await this.store.platformDefault()))
      throw new EnterpriseRequestError(403)
    const input = z.looseObject({ model: z.string() }).parse(await body(request, 32 * 1024 * 1024))
    if (Object.keys(input).some(key => !modelFields.has(key))) throw new EnterpriseRequestError(400)
    if (!assigned.configuration.models.some(model => model.id === input.model)) throw new EnterpriseRequestError(403)
    const abort = new AbortController()
    this.aborts.add(abort)
    const disconnected = (): void => {
      if (!response.writableFinished) abort.abort()
    }
    response.once('close', disconnected)
    try {
      const upstream = await this.gateway.forward(
        assigned.gateway_key,
        path === '/v1/messages' ? path : path.slice(3),
        JSON.stringify(input),
        abort.signal,
      )
      if (!upstream.ok) {
        let status = upstream.status
        if (status === 422) {
          let detail: unknown
          try {
            detail = await upstream.json()
          } catch (_error) {
            /* Invalid upstream error JSON retains its HTTP status and receives sanitized copy. */
          }
          if (z.object({ error: z.object({ type: z.literal('budget_exceeded') }) }).safeParse(detail).success)
            status = 429
        } else await upstream.body?.cancel()
        const code =
          status === 429 ? 'budget_or_rate_limit' : status === 403 ? 'model_forbidden' : 'upstream_unavailable'
        const message =
          code === 'budget_or_rate_limit'
            ? 'The model budget or rate limit was reached. Choose another approved model or contact your administrator.'
            : code === 'model_forbidden'
              ? 'This model is unavailable to your account. Choose an approved model or contact your administrator.'
              : 'The model service is unavailable. Retry or contact your administrator.'
        json(response, status, { error: { code, message, type: code } })
        return
      }
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      })
      if (upstream.body === null) response.end()
      else await pipeline(Readable.from(upstream.body), response, { signal: abort.signal })
    } finally {
      response.off('close', disconnected)
      this.aborts.delete(abort)
    }
  }
}
