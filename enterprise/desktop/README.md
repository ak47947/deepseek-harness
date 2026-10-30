---
description: "Enterprise Desktop account authentication, account-specific storage, and distribution resources for the Electron application."
kind: "package-library"
---

# @deepseek-ai/dsh-enterprise-desktop-shell

English | [中文](README.zh.md)

## Summary

The Desktop application uses this library to authenticate company accounts before opening their local data or starting the workspace Host. The adapter prepares account-specific profiles, synchronizes approved models, and stops work when authorization ends. Enterprise configuration, artwork, and development and packaging helpers live beside the adapter. A Desktop launch without enterprise configuration keeps the upstream account flow and application identity.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The [Electron entry](../../apps/desktop/src/main.ts) calls `desktopProduct()` to select its distribution. Explicit enterprise configuration enables the account adapter; its absence keeps the upstream welcome flow, product name, resources, and update behavior. This library is a private application dependency, not a Cordis plugin or a profile bundle.

The enterprise development launcher selects [`config/desktop.json`](config/desktop.json) through `DSH_DESKTOP_CONFIG_FILE` before invoking the shared Desktop launcher. A caller can select another file. Installed enterprise releases carry their initial settings in application metadata and read their configuration under `<appData>/com.atrix.desktop/desktop/config.json`. Invalid documents stop startup. [Enterprise service configuration](../backend/README.md#connect-enterprise-desktop) owns the account service and release settings.

The adapter's [`createEnterpriseDesktop()` entry](src/adapter.ts) receives explicit window, Host preparation, shutdown, and error-reporting operations from the shell. Authentication selects a private Harness home derived from stable company and user identifiers. The shell keeps the Host stopped until authentication and account preparation finish. Each account has its own browser storage partition. Electron secure storage encrypts the saved login; unavailable secure storage rejects sign-in.

Sign-out and invalid authorization first stop the Host, then clear managed credentials and browser storage. Failed or unconfirmed shutdown prevents dependent cleanup and relaunch. Cleanup failures remain visible after work has stopped. A temporary synchronization failure can retain the current valid account in a reported degraded state; it does not extend the account's expiry.

### Distribution resources

[`resources/`](resources/) contains the enterprise icon master and native icon formats; [`installer/assets/`](installer/assets/) contains Windows installer artwork. The [account UI](../account/README.md) and browser sign-in pages receive derivatives from the same master. The welcome renderer keeps its generated image at the shared shell's required asset location.

Regenerate the existing dimensions and formats from the repository root:

```sh
pnpm run render:enterprise-brand-assets
```

The packaging helper supplies enterprise application identity, artwork locations, and explicitly configured update destinations to the shared build. Without enterprise selection, local unsigned packaging uses the upstream application identifier and update rules. Enterprise macOS releases use MDM and have no in-application updater; this policy applies only to enterprise distributions. Enterprise Windows releases use their sealed update feed, including unsigned builds when a feed is configured.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/adapter.ts`](src/adapter.ts) owns the native account lifecycle and publishes credential-free account information through the preload bridge. [`src/enterprise-profile.ts`](src/enterprise-profile.ts) activates the [enterprise bundle](../bundle/README.md), supplies approved model data and the configured assistant name, and preserves personal providers, a personal default model, and unrelated settings. Dynamic model rotation uses the Host's existing credential and settings APIs.

The adapter exchanges validated account and provisioning messages from the [enterprise protocol library](../protocol/README.md) with the [enterprise service](../backend/README.md). The service owns authentication and authorization; the native adapter owns local account data selection and stopping the Host. Profile initialization retains an existing bundle list, while account preparation adds the enterprise layer without replacing other installed bundles.

[`scripts/enterprise-package-environment.mjs`](scripts/enterprise-package-environment.mjs) owns enterprise build settings and resource locations. [`scripts/render-brand-assets.ts`](scripts/render-brand-assets.ts) generates the native, installer, account, welcome, and browser artwork. The shared build and launcher call these helpers without owning enterprise defaults.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Desktop](../../apps/desktop/README.md) — shared shell behavior and build operations.
- [Enterprise service](../backend/README.md) — authentication, administration, and approved models.
- [Enterprise protocol](../protocol/README.md) — validated account and provisioning messages.
- [Enterprise bundle](../bundle/README.md) — static profile composition.
- [Enterprise account UI](../account/README.md) — company identity and account controls.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the enterprise account plugin and model provider configured by account preparation.

#### KV Cache effect

The adapter adds no model request text; the configured identity and selected provider own their request-prefix effects.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Native account operations require Electron and the shell's lifecycle operations. This library cannot run as a Host-only plugin.
- Enterprise macOS updates require external distribution through MDM; the upstream Desktop updater remains available to upstream distributions.
- The enterprise bundle must be carried by the application runtime. Account credentials alone do not supply its UI or composition.

<a id="dev-note"></a>
### Dev Note

None.
