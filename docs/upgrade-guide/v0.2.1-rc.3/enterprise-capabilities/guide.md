---
kind: upgrade-guide
description: "Enterprise profiles retain standard capabilities and migrate the disabled rows written by earlier enterprise startup."
---

# Enterprise profiles retain standard capabilities

English | [中文](guide.zh.md)

## Change

Enterprise sign-in no longer disables product analytics, feedback telemetry, anonymous identity reporting, plugin management and its market, runtime self-modification, or search. These capabilities follow standard configuration and credential requirements, including collection destinations. Desktop also supplies its bundled package manager, command installation, and third-party-plugin recovery. Release destinations accept any explicitly configured HTTPS host.

Account preparation recognizes the complete restricted enterprise configuration and removes its generated disabled rows and preset overrides. Enterprise authentication, model provisioning, account directories, and history remain in place. Later personal plugin and preset choices survive repeated sign-in.

## Migration

1. Fully quit Desktop, install the updated enterprise application, and sign in with the same account. Account preparation migrates the old restrictions before starting the Host.
2. Confirm that **Plugins** appears in the sidebar and opens its management page. Check the application menu for **Manage dsh Command…** on macOS, or the corresponding Windows menu action.
3. To retain a personal opt-out, set the relevant row to `disabled: true` in the account's `profiles/desktop/cordis.patch.yml` after migration. For example, `product-analytics` controls product analytics. Restart and confirm that the choice remains. Review telemetry destinations using the [collection policy](../../../../packages/client/product-analytics/README.md).
