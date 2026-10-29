---
kind: upgrade-guide
description: Desktop 作为配置的 Atrix Harness 企业应用启动，独立 Web 启动命令停用。
---

# 企业桌面入口

[English](guide.md) | 中文

## 变更

缺少企业设置时，Desktop 不再启动个人版 DSH 应用。桌面配置文件在默认值上提供企业设置：企业名与产品名为 `Atrix Harness`，应用 ID 为 `com.atrix.desktop`，服务地址为 `http://127.0.0.1:3090`。默认启动先打开企业登录页，再启动工作区 Host。

独立的 `dsh web` 与 `dsh --profile web` 启动方式停用。根目录的 `start:web`、`dev:web`、`make web` 和 `make dev-web` 命令移除。Desktop 保留内部浏览器渲染器与本地 Host 传输。

## 迁移

1. 在开发启动前编辑 `apps/desktop/config/desktop.json`。其中 `enterprise` 对象支持 `enterpriseName`、`productName`、`appId`、`origin`，以及同步和请求时限。省略字段使用默认值。
2. 使用 `pnpm run dev:desktop` 启动，或构建后使用 `pnpm run start:desktop`。默认本机配置不需要企业环境变量。
3. 将后端本机发布端口配置为 `3090`。仅在需要其他主机端口时设置 `DSH_ENTERPRISE_LOCAL_PORT`，并在桌面文件中填写相同地址。
4. 对已安装 Desktop，编辑 `<appData>/com.atrix.desktop/desktop/config.json` 后重启。`DSH_DESKTOP_CONFIG_FILE` 可指定其他配置文件。远程服务使用 HTTPS；HTTP 仅用于回环开发地址与默认本机服务。
5. 确认应用显示企业登录页和配置的产品名称。只有企业认证成功后才会打开工作区。
