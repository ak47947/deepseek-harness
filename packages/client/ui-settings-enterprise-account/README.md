---
description: "Enterprise desktop account settings, native sign-out, and organization branding; use when configuring or debugging the shell-owned account UI."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-enterprise-account

English | [中文](README.zh.md)

## Summary

Show the current employee and organization in enterprise Desktop, and sign out through the native task confirmation. Account settings display synchronization failures while cached configuration remains usable. Authentication and credentials stay in the Electron main process. This plugin requires the enterprise shell and is absent from the official profile.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The enterprise shell inserts this plugin into each authenticated account's desktop profile. The configured organization name and employee identity appear in that workspace. Its preload must expose `dshDesktop.enterpriseAccount`; mounting the plugin in an ordinary browser fails explicitly. `agentName` is required and supplied from the desktop product name, defaulting to `Atrix Harness`. The shell disables the built-in harness identity; this plugin registers the shared enterprise identity for all agent presets and subagents.

The account Settings section shows the employee name, email, operating mode, and synchronization state. Sign-out asks the native shell to inspect tasks, stops the Host, removes local credentials, clears renderer storage, and restarts at sign-in. Cancelling the task confirmation preserves the account. Read and sign-out failures remain visible with retry guidance. The sidebar displays the configured organization name without the official vendor mark.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

The browser half registers feature-owned Settings, sidebar account, sidebar brand, conversation hero mark, and running mark slots. The enterprise mark uses a transparent package asset; forced colors display its alpha silhouette. The account launcher shares the official account menu’s `AccountLauncher` primitive. The shell bridge exposes metadata, browser sign-in, and sign-out operations, never passwords, tokens, or model credentials. The client registration owns one account source for the sidebar and Settings, subscribes once, and ignores obsolete or disposed reads. Components consume framework hooks; plugin disposal removes the shell subscription, slots, and dictionaries.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Enterprise service](../../../backend/README.md) — account administration, provisioning, deployment, and verification.
- [Desktop shell](../../../apps/desktop/README.md) — Host ownership and native lifecycle.
- [Client UI subsystem](../../../docs/subsystems/web-client.md) — shared slot semantics.

-----

<a id="dev-note"></a>
## Dev Note

None.

-----

<a id="model-experience"></a>
## Model Experience

### Enterprise agent identity

#### What the model sees

The system prompt begins with `You are Atrix Harness, the enterprise AI assistant. Your name is Atrix Harness.` when the desktop product name uses its default. The configured name is literal text, independent of the selected model and agent preset. The browser contributes no tools or account credentials.

#### Token effect

Each request includes one short identity section. Its token cost is fixed while the configured name stays unchanged.

#### KV Cache effect

The configured agent name occupies the stable system-prompt prefix. Changing it changes that prefix for subsequent requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The plugin requires the enterprise Electron preload.
- Enterprise artwork is generated from the desktop enterprise master; replacing it requires rebuilding client artifacts.
- Account switching restarts the application after the Host has stopped.
