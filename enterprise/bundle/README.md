---
description: "Enterprise account, branding, and approved-model defaults layered over the Desktop Web composition."
kind: "package-bundle"
---

# @deepseek-ai/dsh-enterprise-desktop

English | [中文](README.zh.md)

## Summary

The package declares the DSH runtime version it supports in `engines.dsh`. Validate a new upstream runtime before updating that declaration; enterprise startup refuses an incompatible required bundle.

Enterprise Desktop uses this bundle to show its company account and branding while using the models approved for the signed-in user. Authenticated Desktop startup activates this layer after the standard Web bundles. Account preparation supplies the company name, model settings, and credential references separately. Personal providers, model choices, and unrelated profile settings remain available.

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

Enterprise Desktop carries this bundle in its application runtime and adds it to the authenticated account profile's `dsh.profile.bundles` list. The standard profile loader resolves its manifest-declared patch. Existing bundles retain their order, and repeated account preparation adds no duplicate enterprise entry. No separate user installation is required.

The layer replaces the official account and branding UI with the [enterprise account plugin](../account/README.md), disables the two official DeepSeek model adapters, enables model settings and the configurable model provider, and delegates the shared assistant identity to the enterprise account plugin. Desktop's account preparation supplies approved models and a default selection; an existing personal default stays selected.

The profile patch remains above this layer. Its managed entries contain account data and the configured assistant name, while unrelated settings and personal providers survive account preparation. Startup removes earlier enterprise-owned inline UI entries and static overrides before applying this bundle.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) contains the static enterprise choices and the enterprise account plugin insertion. [`src/index.ts`](src/index.ts) has no runtime API. The bundle uses the same profile layering and package resolution as other bundles; its code does not load Electron or authenticate users.

Account preparation selects the bundle after profile initialization. Initialization preserves an existing manifest, so subsequent Desktop release preparation keeps the enterprise layer and user-installed bundles. Recovery can remove optional bundles; authenticated startup restores the required enterprise layer before the Host starts. Credentials remain in the account-owned credential document and never enter this patch.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Desktop](../../apps/desktop/README.md) — application startup and account preparation.
- [Profile composition](../../packages/boot/app-boot/README.md#profiles) — bundle resolution and patch precedence.
- [Enterprise account](../account/README.md) — company identity and account UI.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the enterprise account plugin and the selected model provider, which own their model-facing behavior.

#### KV Cache effect

The bundle adds no request text itself; the enterprise account plugin owns the configured assistant identity and its cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The bundle requires the standard Web composition and authenticated Desktop account preparation. Adding it alone supplies neither a login nor approved model credentials.
- A profile patch replaces each targeted row's complete configuration. Account preparation preserves custom prompt fields while keeping the built-in Harness identity disabled.

<a id="dev-note"></a>
### Dev Note

None.
