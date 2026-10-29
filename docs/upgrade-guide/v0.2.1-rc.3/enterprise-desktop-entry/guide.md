---
kind: upgrade-guide
description: Desktop starts as the configured Atrix Harness enterprise application, and standalone Web launch commands are disabled.
---

# Enterprise desktop entry

English | [中文](guide.zh.md)

## Change

Desktop no longer starts the personal DSH application when enterprise settings are absent. The desktop configuration file supplies enterprise settings over defaults: enterprise name and product name `Atrix Harness`, application ID `com.atrix.desktop`, and service origin `http://127.0.0.1:3090`. The default startup opens enterprise sign-in before starting a workspace Host.

Standalone `dsh web` and `dsh --profile web` launches are disabled. The root `start:web`, `dev:web`, `make web`, and `make dev-web` commands are removed. Desktop retains its internal browser renderer and local Host transport.

## Migration

1. Edit `apps/desktop/config/desktop.json` before development startup. Its `enterprise` object accepts `enterpriseName`, `productName`, `appId`, and `origin`, plus synchronization and request deadlines. Omitted fields retain defaults.
2. Start with `pnpm run dev:desktop`, or use `pnpm run start:desktop` after building. Neither command needs enterprise environment variables for the default local setup.
3. Configure the backend's local published port as `3090`. Set `DSH_ENTERPRISE_LOCAL_PORT` only when a different host port is needed, and set the same origin in the desktop file.
4. For installed Desktop, edit `<appData>/com.atrix.desktop/desktop/config.json` and restart. `DSH_DESKTOP_CONFIG_FILE` selects another configuration file. Use HTTPS for a remote service; HTTP is limited to loopback development and the default local service.
5. Confirm the application displays the enterprise sign-in page and the configured product name. A workspace opens only after enterprise authentication succeeds.
