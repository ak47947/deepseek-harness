---
kind: upgrade-guide
description: 企业开发和部署文件迁入独立的 enterprise 目录。
---

# 企业桌面入口

[English](guide.md) | 中文

## 变更

企业定制集中维护在 `enterprise/`：包含后台、账号协议、账号 UI 插件、Desktop 组合包和 Electron 适配库。Desktop 使用显式企业设置；未配置企业服务的壳保留标准账号流程。独立 Web 启动保持可用。

企业账号 profile 在启动 Host 前加载必需的组合包。既有账号目录标识、加密登录数据、对话历史和个人模型设置保持不变。

## 迁移

1. 使用 `enterprise/backend/deploy/` 中的 Compose 文件和部署模板。保留既有 Compose 项目名、环境文件及命名卷。
2. 编辑 `enterprise/desktop/config/desktop.json` 开发配置，再使用 `pnpm run dev:desktop` 或 `pnpm run start:desktop`。对应的 `:upstream` 命令启动未配置企业服务的桌面壳。
3. 安装版企业设置继续保存在 `<appData>/com.atrix.desktop/desktop/config.json`，或保留既有 `DSH_DESKTOP_CONFIG_FILE` 选择。使用相同的企业应用 ID 和服务地址。
4. 安装包含企业组合包的匹配运行时。账号准备会向既有账号 profile 添加组合包并保留个人配置。组合包缺失会阻止 Host 启动。
5. 使用相同账号登录，确认既有项目和对话仍可访问、企业模型加载成功，以及退出登录会停止 Host。
