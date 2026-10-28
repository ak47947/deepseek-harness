---
description: "Run and administer the single-enterprise account and model-provisioning service, configure enterprise Desktop, and deploy optional LiteLLM management."
---

# Enterprise accounts and model provisioning

English | [中文](README.zh.md)

## Summary

Employees sign in with company-managed accounts and receive approved models in enterprise Desktop. Basic mode distributes provider credentials and sends model requests directly from the employee's computer. Managed mode keeps provider and LiteLLM keys on the server, authenticates model calls, and delegates budgets and usage to LiteLLM. The service uses Better Auth and PostgreSQL; each deployment serves one company and one backend process.

| Location | Responsibilities and data |
|---|---|
| Company server | Better Auth, PostgreSQL, employee accounts, roles, model assignments, and the browser administration page |
| Administrator's browser | Independent access to `https://dsh.example.com/admin`; no Desktop installation required |
| Each employee's computer | Desktop and its local execution Host; conversations, projects, attachments, and personal settings stay on that computer |

Desktop requests authentication and assigned configuration from the server over HTTPS. It does not launch Better Auth or PostgreSQL. Server settings and `BETTER_AUTH_SECRET` stay on the server; the Desktop release contains only its public service address and release metadata.

The top-level `backend/` directory owns authentication, administration, model configuration, account persistence, deployment files, and service tests. Desktop lives in `apps/desktop/` and runs a separate local Host for conversations, projects, and tools.

## Table of Contents

- [Run the service](#run-the-service)
- [Manage employees and models](#manage-employees-and-models)
- [Connect enterprise Desktop](#connect-enterprise-desktop)
- [Run locally with Docker](#run-locally-with-docker)
- [Deploy and back up](#deploy-and-back-up)
- [Enable managed mode](#enable-managed-mode)
- [Security and failure behavior](#security-and-failure-behavior)
- [Verification](#verification)
- [Dev Note](#dev-note)

-----

<a id="run-the-service"></a>
## Run the service

Deploy the enterprise backend with Docker Compose 2.24.4 or later. Start with [local Docker](#run-locally-with-docker), then use [server deployment](#deploy-and-back-up) for employee access. The image builds the runtime, initializes its service profile, and launches `dsh --profile enterprise` inside the container; the host needs Docker rather than a separate Node service.

Create a private deployment environment file from [the environment template](deploy/.env.example). Set `DSH_CLIENT_COMMIT_HASH` to the output of `git rev-parse HEAD` from the source checkout; the image excludes `.git` and needs this explicit source revision. Choose a permanent `DSH_ENTERPRISE_ID`, a cryptographically random `BETTER_AUTH_SECRET` of at least 32 characters, and a random hexadecimal `ENTERPRISE_POSTGRES_PASSWORD`. Compose supplies the container's PostgreSQL `DATABASE_URL`. Remote deployments require an HTTPS `DSH_ENTERPRISE_ORIGIN`; the local overlay supplies loopback HTTP for same-machine development.

Configure the first administrator's email and a password of at least 12 characters through `DSH_ENTERPRISE_BOOTSTRAP_EMAIL` and `DSH_ENTERPRISE_BOOTSTRAP_PASSWORD`; these create an administrator only while the user table is empty. After initialization, remove bootstrap credentials from the environment file and recreate the backend container with the same Compose configuration.

| Setting | Default | Purpose |
|---|---|---|
| `DSH_ENTERPRISE_HOST` / `DSH_ENTERPRISE_PORT` | `0.0.0.0` / `3090` | Container listener supplied by Compose |
| `DSH_ENTERPRISE_MODE` | `basic` | `basic` or `managed`; incomplete managed configuration rejects startup |
| `DSH_ENTERPRISE_SESSION_SECONDS` | `86400` | Login hard lifetime, from 60 to 2592000 seconds |
| `DSH_ENTERPRISE_AUTHORIZATION_SECONDS` | `300` | Browser authorization lifetime, from 60 to 1800 seconds |
| `DSH_ENTERPRISE_LITELLM_URL` / `DSH_ENTERPRISE_LITELLM_KEY` | unset | Private gateway URL and management credential; managed mode only |
| `DSH_ENTERPRISE_UPSTREAM_TIMEOUT_MS` | `300000` | Maximum managed model request duration |
| `DSH_ENTERPRISE_DIRECT_KEYS_REVOKED_AT` | unset | UTC confirmation of provider-key revocation when migrating existing basic assignments |

-----

<a id="manage-employees-and-models"></a>
## Manage employees and models

Open `/admin` at the server's public origin and sign in as an administrator; the origin root also opens this page. This application owns the management UI and model configuration; account mutations use Better Auth's Admin plugin. Ordinary employee accounts cannot read or change administrative data. Create an employee with a name, email, initial password, and role. Public registration is disabled. Configure Platform default models with a provider address, supported API protocol, credential, explicit model capabilities, and a default model. Employees without an individual assignment inherit this configuration, including existing and newly created accounts. An individual assignment takes priority; Use platform default clears that override. Default changes reach inheriting accounts at their next configuration sync. Without either a platform default or an individual assignment, an employee cannot start Desktop. Basic-mode administrators must use provider credentials whose distribution and independent revocation the company accepts; a hidden model option does not enforce provider-side access control.

The console adapts the theme and layout of [shadcn-admin](https://github.com/satnaing/shadcn-admin) under its [MIT license](SHADCN-ADMIN-LICENSE). Sidebar navigation opens Overview, Departments, Users, Model configuration, and managed-mode Budget and usage. The same-origin application supports English and Chinese, light and dark themes, and a mobile navigation drawer. User search, department/role/status filters, and ten-row pagination operate on the 1,000 most recently created accounts loaded by the directory; overview account counts use that same loaded directory.

Administrators maintain departments as a tree: create top-level or child departments, rename them, edit descriptions, and change their parent. Moving a department beneath itself or a descendant is rejected. The tree supports expand, collapse, and search with ancestor context; department selectors show full paths. Each employee belongs to one department or remains unassigned. Additive PostgreSQL migrations preserve existing departments as roots and retain membership. A department with accounts, including disabled accounts, or child departments cannot be deleted until they are moved or cleared. Departments organize accounts; model permissions and budgets remain employee-specific.

Administrators can reset passwords, change other employees' roles, and disable accounts. Password resets revoke login sessions. A disabled employee cannot obtain configuration or make new managed model requests. Basic mode reports that the administrator must revoke provider credentials separately. Managed mode saves gateway cleanup state independently; failed revocation remains visible with a retry action. Self-demotion and self-deactivation are refused. The backend serializes administrative mutations and rechecks the acting administrator after earlier changes settle.

Managed mode adds monthly budgets in USD and gateway usage filtered by employee, model, and UTC date range, with pagination. Usage read failures display an unavailable state. The monthly budget counter and filtered request history have different scopes; provider bills remain the spending authority.

-----

<a id="connect-enterprise-desktop"></a>
## Connect enterprise Desktop

From the repository root on a macOS development machine, point the existing Desktop application at the deployed enterprise server. Replace the example origin with the server's `DSH_ENTERPRISE_ORIGIN`. The shell reuses the desktop welcome page and opens enterprise browser authorization:

```sh
DSH_DESKTOP_ENTERPRISE_CONFIG='{"appId":"local.example.enterprise","productName":"Enterprise development","origin":"https://dsh.example.com"}' pnpm run dev:desktop
```

Loopback HTTP is reserved for developing the server and Desktop on the same machine; the local Docker deployment uses `http://127.0.0.1:3092`. On an employee's computer, that address refers to the employee's own machine. Packaged Desktop requires HTTPS.

Browser sign-in uses an expiring, one-use approval code bound to the desktop’s S256 PKCE verifier and a temporary `127.0.0.1` callback. Better Auth creates a separate desktop session after exchange; browser URLs carry no session tokens or model credentials. The completion page opens `dsh://open`. Cancelled or expired attempts cannot complete locally. Enterprise Welcome requires sign-in and provides no guest or manual API-key action. The Host starts only after the account and its configuration are prepared. The sidebar displays the employee name; its menu includes the email, Settings, and sign-out.

Each authenticated `[enterpriseId, userId]` pair selects `<userData>/enterprise/accounts/<sha256>/`. The shell initializes that account's `profiles/desktop`, atomically replaces and verifies the model configuration and credential documents, then supplies both `DSH_HOME` and the profile path to the Host. Account switching stops the Host and restarts the application. Repeated logins reuse the account directory and preserve projects, conversations, attachments, and personal settings. The official CLI's default `~/.dsh` is not imported. Directory hashing provides namespacing, not protection against another person using the same operating-system account.

Create an enterprise release settings file from [the Desktop template](deploy/desktop.env.example) and point `DSH_ENTERPRISE_PACKAGING_ENV` at its absolute path. Configure `DSH_DESKTOP_ENTERPRISE_CONFIG`, matching `DSH_DESKTOP_APP_ID`, `DSH_DESKTOP_ENTERPRISE_UPDATE_URL`, `DSH_DESKTOP_ENTERPRISE_POLICY_ORIGIN`, and an absolute PNG `DSH_DESKTOP_ENTERPRISE_ICON`, together with the existing [macOS signing and notarization settings](../apps/desktop/publishing/README.md). Signed releases require independent enterprise identity, HTTPS destinations, and supplied artwork. Packaged applications read sealed metadata; runtime environment variables cannot replace it. The update root contains `mac-arm64`, `mac-x64`, or `win-x64` directories holding the existing installer and channel metadata format.

```sh
DSH_ENTERPRISE_PACKAGING_ENV=/absolute/enterprise-release.env pnpm --filter @deepseek-ai/dsh-desktop run package:mac:arm64
```

Employees can open Settings → Models to add local custom providers, API addresses, credentials, and model IDs alongside the enterprise route. Local providers, credentials, and a local default model survive server synchronization, sign-out, and repeated sign-in to the same account. The enterprise route is refreshed from the backend; use a distinct route ID for personal providers. Personal provider calls go directly to that provider and are outside enterprise LiteLLM budgets and usage.

The enterprise profile disables official account and wallet UI, telemetry, plugin installation services and tools, runtime self-modification, and unapproved default search. The shell provides no package manager or Desktop CLI installation action. The destructive third-party-plugin recovery action is omitted. Existing Office skills and local execution retain the official sandbox and approval semantics; company-specific SOP content must be approved before packaging.

-----

<a id="run-locally-with-docker"></a>
## Run locally with Docker

The [local overlay](deploy/compose.local.yml) publishes the account service and `/admin` at `http://127.0.0.1:3092`, and the update policy at `http://127.0.0.1:3091/api/v0/check_client_update`. PostgreSQL and runtime data use named volumes in the `dsh-enterprise-local` project. No domain is required.

From the repository root, create a private `.artifacts/enterprise-local/.env` from [the environment template](deploy/.env.example), restrict it to its owner, and fill the required settings described under [Run the service](#run-the-service). The overlay supplies the loopback origin and container runtime directory. Select the private file explicitly:

```sh
export DSH_ENTERPRISE_ENV_FILE="$PWD/.artifacts/enterprise-local/.env"
docker compose --project-name dsh-enterprise-local --env-file "$DSH_ENTERPRISE_ENV_FILE" -f backend/deploy/compose.yml -f backend/deploy/compose.local.yml up --build --detach --wait
```

Open `/admin` and sign in with the configured administrator. To connect development Desktop, use `http://127.0.0.1:3092` in the [Desktop command](#connect-enterprise-desktop). Set `DSH_ENTERPRISE_LOCAL_PORT` in the private environment file to change the account-service port. After the image is built, use `up --detach --no-build --wait` with the same Compose arguments to start existing services, or `stop` to stop them while retaining data. Removing volumes deletes the deployment's data. The update endpoint serves a policy only until signed installers and channel metadata are supplied.

-----

<a id="deploy-and-back-up"></a>
## Deploy and back up

Run the [Compose deployment](deploy/compose.yml) on the company server. It provides the backend, PostgreSQL, and a static update origin. Create `deploy/.env` using the [required service settings](#run-the-service). Run from this directory:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml up --build -d
```

Terminate HTTPS at the company's existing reverse proxy. Forward the account service to loopback port 3090 and the update service to loopback port 3091; the update host also serves `/api/v0/check_client_update` from `deploy/updates/policy.json`. The supplied policy permits normal startup. Publish signed installers and matching channel metadata into the update directory, then validate an upgrade on the pilot machine before widening distribution.

Remote service origins can use a server IP with an HTTPS certificate trusted by employee computers; a domain is optional. If using a domain without an existing HTTPS proxy, the optional [server overlay](deploy/compose.server.yml) adds Caddy for the account service and `/admin`. Set `DSH_ENTERPRISE_ORIGIN` to the public HTTPS origin, point its DNS to the server, and make ports 80 and 443 reachable for certificate issuance. The update service still requires its own HTTPS destination. Certificate trust and employee-network access require verification on the deployment server.

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml -f deploy/compose.server.yml up --build -d
```

Run one backend container. Back up the account database, the unchanged deployment secret, release settings, and update artifacts. Model configurations and virtual keys are encrypted with a key derived from `BETTER_AUTH_SECRET`; changing or losing that secret invalidates authentication and prevents decryption of existing assignments. Managed deployments also back up the separate LiteLLM database and its salt. Restore into an isolated environment and verify employee identity, assignments, gateway users, accumulated spend, and Desktop sign-in before accepting the restore.

-----

<a id="enable-managed-mode"></a>
## Enable managed mode

The adapter targets LiteLLM [v1.106.4](https://github.com/BerriAI/litellm/releases/tag/v1.106.4). Configure a private gateway and management key, or use the [managed Compose overlay](deploy/compose.managed.yml) after replacing the approved model and provider placeholders in [litellm.yml](deploy/litellm.yml). No gateway port is published. Gateway HTTP is intended only for the private deployment network; use HTTPS for remote gateways.

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml -f deploy/compose.managed.yml up --build -d
```

Before migrating basic-mode employees, revoke every distributed provider credential at its provider and set `DSH_ENTERPRISE_DIRECT_KEYS_REVOKED_AT` to the verified UTC time. Existing basic assignments block managed startup without this acknowledgement. Reassign employees to managed routes; stale assignments reject provisioning rather than fall back to direct calls. Keep the confirmation in deployment records. The backend cannot independently verify revocation by an external provider.

Managed model credentials are bound to a live login session; sign-out, session revocation, and expiry reject subsequent calls. Gateway users derive from permanent company and employee IDs. The backend persists a randomly allocated virtual key before creation, queries its hash during retry, and retains its user association across logins and devices. Model changes and budget updates preserve user spend; key credentials never reach Desktop. Gateway connectivity and model discovery must succeed, and employee model IDs must exist in its catalog. Model requests reject upstream-address and credential overrides before forwarding.

-----

<a id="security-and-failure-behavior"></a>
## Security and failure behavior

The main process stores the login token through Electron `safeStorage`, separate from account data and model keys. Model keys use the account's owner-only `.credentials.yaml`; the same operating-system user can read them. Configuration polling runs at startup, on resume, and every 15 minutes by default. Explicit `401` or `403` responses and local hard expiry stop work, clear credentials, and return to sign-in. Temporary transport errors or server failures retain cached settings only until the saved hard expiry. Configuration or identity mismatches prevent further work and require sign-in recovery.

Live rotation first writes a new endpoint-and-key-derived credential reference, then updates only the enterprise provider through Host RPC. The default model follows backend changes while its provider is enterprise; a personal default is retained. Managed default changes reject calls using stale inherited permissions until configuration sync reconciles the employee’s gateway key; provisioning failures leave the account unavailable and retry on its next sync. Old references survive until Host exit so prepared requests can finish. Partial or uncertain writes stop the Host. Shutdown and credential-cleanup failures prevent account switching; history is preserved. Already issued upstream requests are not guaranteed to stop immediately after employee deactivation.

Local execution can send file content, screenshots, and tool results to the selected model provider; managed mode additionally sends them through the backend and LiteLLM. Approve data categories and outbound network policy for the pilot. The backend does not duplicate model accounting, expose prompt logs in usage responses, or provide wallets, payments, SSO, department billing, or multi-tenant administration.

-----

<a id="verification"></a>
## Verification

Run verification from the repository root. Focused tests cover real HTTP authentication over PostgreSQL protocol, role restrictions, direct provisioning, managed streaming, model denial, gateway cleanup, account paths, expiry races, and credential rotation. Browser tests use an isolated PGlite database and launch the service through the test harness; they exercise both HTTP and an HTTPS reverse proxy, including secure session cookies. Opt-in Docker checks verify build-context exclusions, explicit source revision and private environment-file requirements, local loopback port selection, and restoration of employee identity, roles, and encrypted assignments from PostgreSQL backup; the restore test requires a cached `postgres:17.6-bookworm` image. The opt-in gateway qualification starts the pinned LiteLLM image with PostgreSQL and a local provider fixture; it verifies employee key creation, accumulated spend, budget rejection, and deactivation. Supplier billing, enterprise signing, and update delivery require pilot infrastructure.

```sh
pnpm exec vitest run backend/tests/server.spec.ts apps/desktop/tests/enterprise-session.spec.ts
pnpm run test:e2e backend/tests/admin.e2e.ts apps/desktop/tests/enterprise-flow.e2e.ts
DSH_ENTERPRISE_LITELLM_E2E=1 pnpm run test:e2e backend/tests/litellm.e2e.ts
DSH_ENTERPRISE_DOCKER_E2E=1 pnpm run test:e2e backend/tests/deployment.e2e.ts backend/tests/persistence.e2e.ts
```

Pilot acceptance requires two real employee accounts, restart and account-switch history checks, an offline hard-expiry check, real streaming and Office/browser tasks, provider revocation, gateway concurrency and billing checks when enabled, backup restoration, and one signed update from the enterprise feed. Supply a reachable HTTPS IP address or domain, a trusted certificate, approved artwork, and model credentials before running these environment-dependent checks.

-----

<a id="dev-note"></a>
## Dev Note

Single-process administration is intentional for the pilot. Multiple backend replicas require database-coordinated administrative serialization and migration/bootstrap ownership before deployment.
