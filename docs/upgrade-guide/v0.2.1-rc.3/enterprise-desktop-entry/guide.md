---
kind: upgrade-guide
description: Enterprise development and deployment files move into the independent enterprise directory.
---

# Enterprise desktop entry

English | [中文](guide.zh.md)

## Change

Enterprise customizations are maintained under `enterprise/`: the backend, account protocol, account UI plugin, Desktop bundle, and Electron adapter. Desktop uses explicit enterprise settings; an unconfigured shell retains the standard account flow. Standalone Web launches remain available.

The enterprise account profile loads its required bundle before starting the Host. Existing account directory IDs, encrypted login data, conversation history, and personal model settings remain unchanged.

## Migration

1. Use `enterprise/backend/deploy/` for Compose files and deployment templates. Preserve the existing Compose project name, environment file, and named volumes.
2. Edit `enterprise/desktop/config/desktop.json` for development, then use `pnpm run dev:desktop` or `pnpm run start:desktop`. Use their `:upstream` counterparts to launch the unconfigured shell.
3. Keep installed enterprise settings in `<appData>/com.atrix.desktop/desktop/config.json`, or retain an existing `DSH_DESKTOP_CONFIG_FILE` selection. Use the same enterprise application ID and service origin.
4. Install the matching enterprise runtime, including its composition bundle. Account preparation adds the bundle to the existing account profile and retains personal configuration. A missing bundle prevents Host startup.
5. Sign in with the same account and confirm that existing projects and conversations remain available, enterprise models load, and sign-out stops the Host.
