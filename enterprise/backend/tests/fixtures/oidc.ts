/** Local OIDC protocol provider with signed tokens; only its HTTPS transport is mapped to an owned loopback listener. */
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose'
import { onTestFinished, vi } from 'vitest'

/**
 * Allocate an isolated OIDC issuer, code store, signing key and exact-origin Fetch interceptor.
 * @param issuer - Logical HTTPS issuer; omitted creates a unique origin for exact-origin interception.
 * @returns Provider controls and URLs used by HTTP and browser integration tests.
 */
export async function oidcProvider(issuer = `https://idp-${randomUUID()}.example.test`) {
  const key = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(key.publicKey), kid: 'fixture-key', alg: 'RS256', use: 'sig' }
  const controls = { claims: {} as JWTPayload, discoveryIssuer: issuer, subject: 'alice-subject', email: 'alice@example.test', badSignature: false, unavailable: false, exchanges: 0, authentication: '' }
  const codes = new Map<string, { nonce: string; challenge: string }>()
  const authorize = (url: URL) => {
    const code = randomUUID()
    codes.set(code, { nonce: url.searchParams.get('nonce') ?? '', challenge: url.searchParams.get('code_challenge') ?? '' })
    const callback = new URL(url.searchParams.get('redirect_uri') ?? '')
    callback.searchParams.set('code', code)
    callback.searchParams.set('state', url.searchParams.get('state') ?? '')
    return callback
  }
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', issuer)
      if (controls.unavailable) { response.writeHead(503).end(); return }
      if (url.pathname === '/authorize') {
        const callback = authorize(url)
        response.writeHead(200, { 'content-type': 'text/html' }).end(`<p>Local OIDC test provider</p><a href="${callback.href.replaceAll('&', '&amp;')}">Sign in as Alice</a>`)
        return
      }
      let result: unknown
      if (url.pathname === '/.well-known/openid-configuration') {
        result = { issuer: controls.discoveryIssuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'] }
      } else if (url.pathname === '/jwks') result = { keys: [jwk] }
      else if (url.pathname === '/token') {
        controls.exchanges++
        const parts: Buffer[] = []
        for await (const chunk of request) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        const form = new URLSearchParams(Buffer.concat(parts).toString())
        const code = form.get('code') ?? ''
        const pending = codes.get(code)
        codes.delete(code)
        const basic = request.headers.authorization === `Basic ${Buffer.from('enterprise-test-client:test-only-client-secret').toString('base64')}`
        const post = form.get('client_id') === 'enterprise-test-client' && form.get('client_secret') === 'test-only-client-secret'
        controls.authentication = basic ? 'client_secret_basic' : 'client_secret_post'
        if (!pending || (!basic && !post) ||
          createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== pending.challenge) {
          response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_grant' })); return
        }
        const claims: JWTPayload = { iss: issuer, sub: controls.subject, email: controls.email, email_verified: true,
          aud: 'enterprise-test-client', nonce: pending.nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, name: 'Alice', ...controls.claims }
        const signingKey = controls.badSignature ? (await generateKeyPair('RS256')).privateKey : key.privateKey
        const token = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(signingKey)
        result = { access_token: 'test-only-upstream-access', token_type: 'Bearer', expires_in: 300, id_token: token }
      } else { response.writeHead(404).end(); return }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
    })().catch(() => { response.writeHead(500).end() })
  })
  onTestFinished(() => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('OIDC fixture listener did not bind')
  const origin = `http://127.0.0.1:${String(address.port)}`
  const originalFetch = globalThis.fetch
  // Vitest isolates files; this file's tests are sequential and intercept only this fixture's unguessable issuer.
  const interception = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return url.origin === issuer ? originalFetch(new URL(url.pathname + url.search, origin), init) : originalFetch(input, init)
  })
  onTestFinished(() => { interception.mockRestore() })
  return { issuer, origin, controls, authorize, environment: {
    DSH_ENTERPRISE_ORIGIN: 'https://enterprise.example.test',
    DSH_ENTERPRISE_OIDC_ENABLED: '1', DSH_ENTERPRISE_OIDC_ISSUER: issuer,
    DSH_ENTERPRISE_OIDC_DISCOVERY_URL: `${issuer}/.well-known/openid-configuration`,
    DSH_ENTERPRISE_OIDC_CLIENT_ID: 'enterprise-test-client', DSH_ENTERPRISE_OIDC_CLIENT_SECRET: 'test-only-client-secret',
  } }
}
