---
description: "Requirements and delivery plan for server-hosted Better Auth and administration, remote Desktop provisioning, and local employee work data."
---

# Enterprise agent Desktop architecture and delivery plan

English | [中文](enterprise_agent_harness_proposal.zh.md)

## Summary

Employees sign in to DeepSeek Harness Desktop with company accounts, process local files, generate Office documents, and operate browsers using company-approved model APIs. The system uses a client/server deployment: the company server runs Better Auth, PostgreSQL, configuration APIs, and an independent administration website; each employee installs enterprise Desktop and connects over HTTPS for authentication, permissions, and model configuration. Accounts, permissions, and model assignments are centralized; conversations, projects, attachments, and personal settings stay on employee computers, without centralized conversation storage.

Basic mode distributes provider configuration and sends model calls directly from employee computers to providers. Optional managed mode routes calls through the enterprise backend and LiteLLM for budgets and usage. Local execution does not keep model inputs local: file content, screenshots, and tool results included in requests still reach the provider, and managed mode also sends them through the backend and LiteLLM.

Enterprise implementations live under [`enterprise/`](../../enterprise/README.md). A bundle layers enterprise Host and Client plugins over the standard DSH composition. The shared Desktop application uses a native adapter for authentication and account lifecycle, while retaining the common window, Host, and tool implementations.

## Table of Contents

- [1. Initial scope](#initial-scope)
- [2. Components and responsibilities](#components-and-responsibilities)
- [3. Deployment architecture](#overall-architecture)
- [4. Enterprise sign-in and Desktop integration](#enterprise-sign-in-and-desktop-integration)
- [5. Model provisioning and cost management](#model-provisioning-and-cost-management)
- [6. Local execution and data handling](#local-execution-and-data-handling)
- [7. Implementation, deployment, and acceptance](#implementation-deployment-and-acceptance)
- [8. Future extensions](#future-extensions)
- [Dev Note](#dev-note)

-----

<a id="initial-scope"></a>
## 1. Initial scope

Deliver the basic path first: deploy the server, create employees and model assignments in the administrator website, sign in from employee Desktop, and use local tools. Run a controlled pilot with one department, several dozen employees, and one desktop operating system. Managed accounting is optional and is not a basic-mode runtime dependency.

| Module | Initial requirements |
|---|---|
| Enterprise Desktop | Reuse shared `apps/desktop` with the `enterprise/desktop` native adapter and enterprise bundle; keep independent branding, `appId`, signing, notarization, and updates |
| Remote authentication | Run Better Auth only on the server; administrators sign in at `/admin` with email and password, while Desktop supports [OIDC sign-in and provisioning](#oidc-sign-in-and-account-provisioning) and optional email/password sign-in; Desktop requires no local authentication service or database |
| Independent administration | Administrators access server `/admin` from an ordinary browser without installing or starting Desktop; manage employees, roles, and model assignments |
| Local data | Give each company/employee account its own `DSH_HOME`; preserve projects and history across switching and reject cross-account reads |
| Model configuration | Supply a small approved model catalog, explicit capabilities, and a default model; employees do not enter provider credentials |
| Optional managed accounting | LiteLLM enforces employee model access and monthly budgets and meters usage; the backend configures and displays results |
| Company SOPs | Existing skills and Office templates ship with the installer and remain extensible through skills and plugins |

The initial scope excludes public self-registration, a bundled third-party IAM service, multiple tenants, wallets, payments, plans, complex departmental accounting, centralized conversation synchronization, and a generic MCP gateway.

-----

<a id="components-and-responsibilities"></a>
## 2. Components and responsibilities

| Component | Choice and responsibilities |
|---|---|
| Desktop | Shared Electron application and `dsh` profile, with enterprise plugins and a native adapter; reuse the existing main program and agent loop |
| Authentication | Server-side Better Auth with Admin, Bearer, and Generic OAuth plugins for administrator credentials, login limits, sessions, users, and roles; standard OIDC connects the company's identity provider (such as Casdoor, Keycloak, or Okta) for Desktop sign-in |
| Administration UI and business APIs | A lightweight application-owned UI and enterprise APIs; reuse Better Auth administrative APIs and own model assignments and optional budgets |
| Persistence | PostgreSQL stores authentication data and encrypted model configuration; LiteLLM uses a separate database when enabled |
| Model gateway | Optional pinned and qualified open-source LiteLLM with management APIs; provider credentials and employee virtual keys stay on the server |

### Enterprise package isolation

[`enterprise/`](../../enterprise/README.md) owns enterprise source, deployment settings, artwork, packaging helpers, and tests. The backend and Desktop share only `enterprise/protocol` validation and identity types. Desktop therefore imports no authentication server or database implementation.

`enterprise/bundle` selects enterprise behavior through the standard profile loader. `enterprise/account` contributes account Settings, branding slots, and the assistant identity. Approved model data and credential references enter the account profile and reuse the existing model, settings, and credential services. Future enterprise Host and Client features use plugins and bundles first.

`enterprise/desktop` is an Electron adapter library. It owns browser authorization, secure saved sessions, account-specific paths, profile preparation, native account operations, and enterprise release resources. Authentication and verified account preparation precede Host startup; revocation, hard expiry, and account switching control Host shutdown. These requirements cannot depend on an optional plugin that starts after the workspace is active.

Shared Desktop files retain narrow product operations and preload integration. Enterprise endpoints, policies, and branding stay in their enterprise owner. Add a generic interface only when the integration requires one, and validate its ordinary and enterprise consumers together. Reusing the main program and standard profile keeps upstream synchronization focused on these interfaces rather than duplicated application code.

### Better Auth and the administration UI

Better Auth implements authentication rather than the complete application administration website. Its [Admin plugin](https://better-auth.com/docs/plugins/admin) provides user, role, ban, password, and session APIs. DSH pages call enterprise APIs, whose server-side authorization layer invokes those APIs. Model provisioning, provider configuration, gateway associations, and budgets belong to DSH. Do not introduce a complete third-party authentication dashboard for the initial release; reuse UI components as useful, without implementing password hashing or session protocols.

### Release and gateway versions

The enterprise distribution owns its name, artwork, application identity, signing credentials, and update destinations, following the [official publishing workflow](../../apps/desktop/publishing/README.md) and [Windows signing requirements](../../apps/desktop/windows-signing/README.md). Official updates must not replace the enterprise client. The [enterprise application reference](../../enterprise/backend/README.md#enable-managed-mode) owns the LiteLLM version, configuration, and qualified APIs; commercial SSO, SCIM, and administrative auditing are not dependencies.

-----

<a id="overall-architecture"></a>
## 3. Deployment architecture

```mermaid
flowchart LR
    Admin["Administrator browser"] -->|HTTPS /admin| Backend
    subgraph PC ["Each employee computer"]
        Desktop["Enterprise Desktop"] --> Tools["Local files / Office / browser / commands"]
        Desktop --> Local[("Account-local conversations, projects, attachments, settings")]
    end
    subgraph Server ["Independent company server"]
        Backend["Administration UI and enterprise APIs"] --> Auth["Better Auth"]
        Auth --> DB[("PostgreSQL")]
        Backend --> DB
        Backend <-->|Managed mode| Gateway["Optional LiteLLM"]
        Gateway --> GatewayDB[("Gateway database")]
        Updates["Company update origin"]
    end
    Desktop <-->|HTTPS authentication and configuration| Backend
    Desktop <-->|Version policy and installers| Updates
    Desktop <-->|Basic mode direct calls| Provider["Approved model provider"]
    Gateway <-->|Managed model calls| Provider
```

Maintain server deployment settings separately from Desktop release settings. The server holds database access, `BETTER_AUTH_SECRET`, bootstrap administrator credentials, and gateway management credentials. Desktop seals only its public HTTPS origin, company identity, and update metadata; it does not distribute server configuration, a database, or the authentication service. Administration and authentication APIs may share an origin and backend process; independent browser access does not require a second authentication system.

The public server origin must be reachable from employee computers. Their `127.0.0.1` addresses refer to those computers, used for temporary sign-in callbacks and local Hosts. A loopback HTTP authentication origin is only for developing the server and Desktop on the same machine; packaged Desktop requires HTTPS.

-----

<a id="enterprise-sign-in-and-desktop-integration"></a>
## 4. Enterprise sign-in and Desktop integration

Employees use company accounts without official DeepSeek accounts, payments, or manually entered model keys. Welcome opens the server sign-in page in the system browser; server-side Better Auth verifies employee identity through the configured OIDC provider or optional employee password sign-in. Welcome requires sign-in, and the workspace Host starts only after authentication and account configuration preparation succeed. After sign-in, employees can configure personal providers in Settings alongside the enterprise route.

### Sign-in and configuration synchronization

1. Administrators manage employees and assign models at `/admin`, or enable automatic OIDC employee provisioning with platform default models. Public self-registration is disabled, and server-side checks authorize every administrative API.
2. Electron starts expiring browser authorization with random state, S256 PKCE, and a temporary loopback callback. The browser returns a one-use code, which the main process exchanges with the server for an independent Desktop session; URLs carry neither login tokens nor model credentials.
3. The main process fetches and validates company ID, stable employee ID, hard expiry, and complete model configuration. It initializes account-owned `DSH_HOME` and `profiles/desktop`, writes and verifies credentials and complete model settings, then starts the Host through its `dsh` profile. Failures stay in sign-in or recovery without using another account or default configuration.
4. The main process encrypts saved login tokens with operating-system secure storage. Model credentials live in the account credential file, outside ordinary settings, prompts, logs, and renderers. Basic-mode provider keys remain readable by the same operating-system user.
5. Synchronize employee status and configuration at startup, resume, and every 15 minutes by default. A `401`, `403`, or local hard expiry stops the Host and tasks, clears sessions and model credentials, and returns to sign-in. Network errors, timeouts, and server `5xx` responses allow cached configuration only until hard expiry, with persistent synchronization-unavailable feedback.
6. Live rotation writes a new endpoint-and-credential-derived reference before replacing complete provider settings and the default model. Retain old references until Host exit so prepared requests can finish. Partial or uncertain writes stop the Host without reporting success. The backend supplies explicit configuration fields rather than executable Cordis expressions or plugin code.

<a id="oidc-sign-in-and-account-provisioning"></a>
### OIDC sign-in and account-provisioning requirements

The Better Auth Generic OAuth plugin connects to the company's existing identity provider (IdP) or unified IAM (such as Casdoor, Keycloak, or Okta) through standard OpenID Connect (OIDC). Third-party login methods such as WeChat, WeCom, and Feishu are configured in the upstream OIDC IdP rather than hard-coded as provider-specific QR widgets or custom password-rebinding state machines in the backend. Public self-registration remains disabled; employee identity uses `(iss, sub)` from fully validated tokens, while verified email is contact information and never implicitly links accounts.

The Desktop browser authorization page (`/dsh/authorize`) uses company branding and presents the configured OIDC sign-in action. Employee email/password sign-in can be disabled when OIDC is enabled; when disabled, the server also rejects direct password-login requests from ordinary employees. OIDC permits only employees with `role = user` and cannot link or sign in administrator accounts; `/admin` continues to use administrator email/password sign-in only.

1. Deployment configures the OIDC issuer, discovery URL (`.well-known/openid-configuration`), `client_id`, `client_secret`, and provisioning policy. By default, only employees precreated by an administrator with an explicit `(issuer, sub)` binding may sign in. Before enabling automatic first-login provisioning, administrators must restrict application assignment in the IdP to employees authorized to use it, excluding guests, self-registered identities, and third-party identities without employee admission checks; keep automatic provisioning disabled when this cannot be guaranteed.
2. The employee starts browser authorization from Desktop and initiates OIDC sign-in on `/dsh/authorize`. The server requests `openid profile email` and redirects to the OIDC provider with S256 PKCE, a random `nonce`, and an expiring one-use `state` bound to the browser and original Desktop authorization request.
3. On the OIDC callback, the server exchanges the authorization code, verifies the `id_token` signature and allowed signing algorithm against the provider's JWKS, and checks that the discovery document's `issuer` and the token's `iss` exactly match the configured issuer, `aud` includes this application's `client_id`, applicable `azp` checks pass, `exp` has not elapsed, `nonce` matches, and `email_verified = true`. It then finds an existing employee only by `(issuer, sub)`; with automatic provisioning enabled, an unused identity and email create an employee account (`role = user`) that inherits platform default models. Matching email must not implicitly link an existing account; administrators explicitly bind identities to precreated employees.
4. After the server verifies that the resolved employee is active, the browser authorization page approves the pending Desktop authorization request and issues the one-use Desktop authorization code for the loopback PKCE exchange, preserving the stable employee ID, local history, department membership, and model assignments across repeated logins.

| State or failure | Required behavior and recovery |
|---|---|
| IdP identity is not authorized to access this application | The IdP rejects authorization; verify this restriction before enabling automatic provisioning |
| OIDC identity has no existing account and auto-provisioning is enabled | With IdP employee admission restrictions enforced and an unused email, create an employee account (`role = user`), inherit default models, and bind `(issuer, sub)` |
| OIDC identity has no binding and auto-provisioning is disabled | Direct the employee to an administrator to precreate or explicitly bind an employee account; create no user, login session, or model access |
| Bound company account is disabled | Reject sign-in and Desktop approval; automatic provisioning cannot reactivate it |
| OIDC identity matches an administrator, email is used by another account, or a binding conflicts | Reject sign-in, implicit linking, replacement, and merging; require administrator verification before resolving employee bindings |
| Authorization expires, is cancelled, has mismatched state, or the callback is replayed | Reject sign-in completion and direct the employee to restart sign-in from Desktop |
| OIDC discovery, token exchange, signature, or claim validation fails | Reject sign-in, show a retryable error, and retain optional email/password sign-in when enabled; create or change no binding or session |

OIDC associations use authentication records with `providerId = enterprise-oidc` and `accountId = JSON.stringify([issuer, sub])`, with a database uniqueness constraint on both fields permitting one employee per external subject. Changing the issuer never automatically reuses an old binding; an administrator must explicitly rebind it. Administrators manage employee bindings and recovery at `/admin` without deleting local history or spend records; promoting an employee to administrator sets an administrator password, clears the OIDC binding, and revokes all sessions. When employee password sign-in is disabled, administration omits password entry and resets for OIDC employees.

Server configuration explicitly enables OIDC integration (`DSH_ENTERPRISE_OIDC_ENABLED=1`) and supplies the issuer and discovery URLs, client credentials, display name, automatic-provisioning toggle (`DSH_ENTERPRISE_OIDC_AUTO_PROVISION`, disabled by default), and employee password-login toggle (`DSH_ENTERPRISE_PASSWORD_ENABLED`). Client secrets and upstream tokens remain on the server, outside Desktop installers, logs, and Desktop callback URLs. Disabled OIDC exposes company email/password sign-in; enabled OIDC with incomplete configuration rejects startup.

<a id="account-and-local-data-isolation"></a>
### Accounts and local data isolation

Only server-authenticated company and stable employee IDs select account directories, named by `SHA-256(UTF-8(JSON.stringify([enterpriseId, userId])))`. Name, email, token, and model-key changes do not change ownership. Equal employee IDs in different companies remain isolated, and recreated accounts do not reuse deleted identities.

Each account owns its profile, conversations, attachments, project index, credentials, personal settings, and extracted runtime dependencies. Switching first completes existing task confirmation, stops the old Host, terminals, and background work, awaits exit, closes storage, and clears renderer caches and embedded browser partitions. Only then initialize and start the new account Host. Old results must not reach the new account. Machine-level windows, shortcuts, crash logs, and encrypted login metadata remain in Electron `userData`.

Sign-out, switching, restart, and upgrades must preserve history. Returning accounts reuse their directories, retaining projects, complete conversations, attachments, personal settings, and conversation continuation. Enterprise Desktop does not import default `~/.dsh` automatically; migration requires an explicit target account. Third-party-plugin recovery backs up and resets the current account's profile; the next startup prepares its enterprise account configuration before starting the Host.

Directory separation covers application-managed data without relocating project source files or adding operating-system permissions or encryption. People sharing an operating-system user can still read other account directories through the filesystem. Use separate operating-system accounts when employees need filesystem access isolation.

<a id="sign-out-and-deactivation"></a>
### Sign-out and deactivation

Sign-out clears local enterprise sessions and model credentials. Deactivation rejects subsequent authentication, provisioning, and managed model calls. Basic mode requires separately revoking distributed provider keys; a shared key cannot revoke one employee independently. Managed mode also revokes the employee virtual key, retaining visible cleanup-required state and retry on failure. Distinguish account deactivation from provider-key revocation; already-issued upstream calls are not guaranteed to stop immediately.

For the initial release, administrators revoke an employee's IdP access and deactivate the DSH account at `/admin`, revoking all its sessions, without automatic directory synchronization or OIDC logout notifications. IdP deactivation alone does not revoke issued DSH sessions; if DSH deactivation is missed, existing sessions remain usable until hard expiry. After DSH deactivation, an online Desktop stops its Host no later than its next status synchronization; an offline Desktop stops at local hard expiry. Basic mode still requires separately revoking provider keys.

-----

<a id="model-provisioning-and-cost-management"></a>
## 5. Model provisioning and cost management

| Mode | Request path and management requirements |
|---|---|
| Basic, default | Desktop → provider; the backend stores and distributes settings without proxying calls, metering, budgets, or model rate limits; UI shows no enterprise usage |
| Managed, optional | Desktop → backend → LiteLLM → provider; the backend verifies sessions and approved models, while the gateway enforces permissions, budgets, rate limits, and accounting |

Administration provides employee creation, department and role changes, optional password resets, OIDC identity inspection and clearing, deactivation, and model assignments. Managed mode adds gateway model discovery, monthly employee budgets, and paginated usage filtered by employee, model, and UTC dates. Password resets and OIDC binding clears revoke sessions; administrators cannot demote or deactivate themselves. Ordinary employees may open the sign-in document but cannot use administrative APIs or read administrative data.

Basic-mode model lists are client configuration; provider credentials determine actual access, so use distributable and independently revocable keys. Managed mode checks model access on the server, rejects request overrides of upstream endpoints or credentials, and keeps provider, LiteLLM management, and employee virtual keys off Desktop. Model-call credentials are bound to live enterprise sessions.

Enable managed mode through server environment settings and verify gateway connectivity; missing configuration or outages must not fall back to direct calls. Budgets bind company and stable employee IDs; multiple devices, logins, and virtual-key changes do not reset monthly spend. Configure finer departmental, model, TPM, RPM, and concurrency policies through supported gateway capabilities without rebuilding the complete gateway console.

Before migrating from basic mode, administrators must revoke distributed provider keys and record confirmation, then assign backend endpoints and enterprise credentials to prevent direct-call bypass. Usage begins when managed mode is enabled, distinguishing monthly budget spend from filtered request history. State currency and gateway pricing explicitly and reconcile with provider bills, without payments or wallets.

Failures distinguish budget/rate limits, forbidden models, expired sessions or credentials, and unavailable services, with actions such as selecting an approved model, signing in again, or contacting an administrator. Failed usage reads show unknown or unavailable, never zero cost; failed writes do not report applied configuration.

-----

<a id="local-execution-and-data-handling"></a>
## 6. Local execution and data handling

Local files, Office, browser, and command tools retain official runtime, sandbox, and approval behavior; do not add separate Ask / Plan / Craft execution modes. [Plan mode](../../packages/plan/plan-mode/README.md) does not disable tools and cannot guarantee that execution waits for approval. Verify workspace writes, out-of-scope access, approvals, and tool availability on the target operating system.

- Product analytics, feedback telemetry, and anonymous identity reporting retain standard configuration and collection destinations.
- The plugin market, management service and UI, plugin-management tools in every preset, and runtime self-modification remain available. The shell supplies its bundled package manager, Desktop CLI installation, and third-party-plugin recovery.
- Search, fetching, and browser operations retain their existing configuration and credential requirements. Update checks, policies, and installers use explicitly configured HTTPS destinations without an enterprise-domain restriction.
- Enterprise sign-in adds no data-category or SOP/template approval requirement. External cloud drives and business systems remain accessible through supported plugins and MCP connections configured by the user.

-----

<a id="implementation-deployment-and-acceptance"></a>
## 7. Implementation, deployment, and acceptance

### Delivery sequence

| Stage | Deliverables and exit criteria |
|---|---|
| Server and independent administration | Deploy authentication, database, and administration on an independent server; an ordinary browser completes administrator login, employee management, and model assignment without Desktop processes; employee administration is rejected |
| OIDC sign-in and provisioning | Integrate the company's OIDC identity provider, automatic or precreated employee provisioning, returning OIDC sign-in, and binding recovery while keeping `/admin` on administrator email/password login; failures follow the [OIDC sign-in requirements](#oidc-sign-in-and-account-provisioning) |
| Desktop authentication and isolation | Desktop uses the remote origin; browser login, recovery, expiry, sign-out, and deactivation work; Host starts after complete preparation, and switching/restart preserve and separate history |
| Basic models and controlled tools | Direct provider calls support streaming, tools, and Office/browser tasks without backend model traffic; verify approvals, network policy, and credential revocation |
| Optional managed mode | Qualify pinned LiteLLM, stable employee associations, streaming, budgets, usage, deactivation, and cleanup retry; confirm old provider keys were revoked before migration |
| Enterprise release and pilot | Sign and notarize the target-platform build and upgrade through company updates, preserving accounts, settings, history, and gateway spend; one department completes real tasks and backup restoration |

With parallel frontend/backend work, ready signing credentials and OIDC identity-provider credentials, one operating system, and no complex legacy integration, target a 4–6 week pilot. Confirm scheduling after basic qualification; estimate dual-platform delivery and further integrations separately rather than promising a complete enterprise platform timeline.

### Deployment and resources

Start with local Docker deployment and verify administration and Desktop development against the loopback IP address; local company email/password testing requires no domain. When moving to a server, email/password-only deployments may use a reachable server IP or domain with an HTTPS certificate trusted by employee computers; loopback HTTP remains limited to development on the same machine. Real OIDC integration testing and production require registering the Better Auth Generic OAuth callback URL (`/api/auth/callback/enterprise-oidc`) on the company's OIDC identity provider and serving the enterprise origin over HTTPS.

Maintain the enterprise service in the top-level `enterprise/backend/` directory and deploy it only through Docker Compose. The backend container initializes its service profile and launches `dsh --profile enterprise` internally. Compose also provides PostgreSQL and the static update origin behind an existing company HTTPS proxy or optional Caddy. Managed mode adds LiteLLM and its own database. The [enterprise application reference](../../enterprise/backend/README.md) owns deployment commands, environment settings, Desktop release templates, and backup procedures; do not distribute server `.env` files to employees.

Run one backend container. Back up databases, unchanged encryption secrets, update artifacts, and managed-mode database/salt; verify identities, assignments, gateway associations, and accumulated spend after isolated restoration. No local large-model hosting or vectorization requires GPUs. Measure capacity from concurrency, request duration, database load, and retention rather than promising 200–1000 employees or adding replicas before the pilot.

### Required acceptance results

- Enterprise implementation and resources remain under `enterprise/`; the shared Desktop application contains only the required product interfaces and consumers. The standard profile and official release do not acquire enterprise behavior. Verify plugin activation, profile recovery, and upgrade compatibility together with the authentication and shutdown requirements below.
- The server runs independently without Desktop. An administrator uses another browser at `/admin` to sign in with email and password and configure the application; signed-out users and ordinary employees cannot read or change administrative data.
- Employee Desktop needs no Better Auth server, database, server secret, or server `.env`. Its remote HTTPS origin serves browser login, session verification, and provisioning; the loopback listener accepts only short-lived authorization codes.
- By default, only precreated employees with explicit bindings can sign in through OIDC. Before enabling automatic provisioning, verify that the IdP rejects identities without application assignment, guests, and third-party identities without employee admission checks; approved new employees receive `role = user` and default models. Matching emails never implicitly link accounts; administrator OIDC sign-in and direct employee password requests when password sign-in is disabled are rejected.
- Returning OIDC sign-in retains the stable employee ID, permissions, and local history. The same `sub` from a different issuer never matches the original binding; changing the issuer requires explicit rebinding. Clearing bindings or promoting an administrator revokes existing sessions, and promotion also clears the OIDC binding.
- Reject `id_token` payloads with invalid signatures or valid signatures but invalid `iss`, `aud`, applicable `azp`, `exp`, `nonce`, or verified-email claims, as well as disabled accounts, binding conflicts, callback replay, and expired or cancelled Desktop authorization. OIDC failures report a retryable error (and permit optional password sign-in only when enabled) without creating partial bindings or sessions.
- Basic streaming and tool calls go directly to providers; the backend has no model traffic, employee metering, budgets, or model rate limiting, and the UI shows no enterprise usage.
- Startup, resume, and periodic synchronization handle deactivation, `401`, `403`, temporary disconnection, timeouts, and `5xx`. Rehearse deactivation in both the IdP and DSH with session revocation, verifying when online and offline Desktops stop. Hard expiry stops tasks and clears credentials; transient failures retain valid caches with visible degradation. Rotation preserves prepared calls, while failed updates stop execution.
- After A creates projects, complete conversations, and attachments and signs out, B cannot read A through lists, search, known Session IDs, or attachment references, including after restart. After B creates data, returning to A and restarting preserves A history, settings, and conversation continuation. Also verify equal user IDs across companies, name/email changes, recreated accounts, and separation from default `~/.dsh`.
- Missing authentication, invalid identity, partial settings/credential writes, failed task shutdown, and failed Host restart prevent entering a new workspace. Old task output cannot reach a new account, and crash recovery targets only the current account's profile and restores enterprise configuration before Host startup.
- Independently verify provider-key revocation in basic mode. Managed qualification covers forbidden models, cross-device spend, unchanged budgets after login, exhausted budgets, stream interruption, retries, concurrency, cleanup failures, and recovery, without direct-call fallback, false success, or zero-cost displays on failure.
- Complete Word, Excel, PowerPoint, and browser tasks on the target platform and verify workspace/approval behavior. Verify telemetry configuration, plugin installation, self-modification, search, Desktop CLI installation, recovery, and configured update destinations. Pilot infrastructure must provide signing, notarization, update-upgrade, and backup-restoration evidence.

-----

<a id="future-extensions"></a>
## 8. Future extensions

| Need | Prerequisites |
|---|---|
| Directory and organizational sync | Add automated directory or SCIM synchronization when manual department maintenance and OIDC sign-in provisioning are no longer sufficient; retain DSH business authorization |
| Cloud drives and knowledge | Pilot one authorized directory, verify inherited access, revocation, synchronization, and failures, then assess retrieval engines |
| OA / ERP | Start with a few read-only MCP APIs and explicit employee authorization; separately design confirmations and duplicate-submission handling for writes |
| Independent SOP updates | Add versioned and recoverable distribution only when bundled delivery cannot meet requirements |

-----

<a id="dev-note"></a>
## Dev Note

This document defines requirements and acceptance; the [enterprise application reference](../../enterprise/backend/README.md) owns implementation and operation. Sources and automated checks prove only the behavior they cover. A reachable HTTPS IP address or domain, certificate trust, OIDC identity-provider configuration and real authorization callbacks, enterprise signing/notarization, update publication, approved models and Office tasks, capacity, and restoration drills require verification on target infrastructure; passing local tests does not replace deployment acceptance.
