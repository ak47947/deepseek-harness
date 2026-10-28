---
description: "企业桌面端的账号设置、原生退出和企业品牌展示；用于配置或排查由壳层管理的账号界面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-enterprise-account

[English](README.md) | 中文

## 概述

在企业桌面端展示当前员工和企业，并通过原生任务确认退出登录。缓存配置仍可使用时，账号设置会显示同步失败状态。认证和凭证保留在 Electron 主进程中。此插件要求企业壳层，不在官方 profile 中启用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

企业壳层将此插件插入各已认证账号的桌面 profile，在工作区展示配置的企业名称和员工身份。预加载脚本必须提供 `dshDesktop.enterpriseAccount`；在普通浏览器中挂载时明确报错。插件不需要配置字段。

账号设置页展示员工姓名、邮箱、运行模式和同步状态。退出登录会让原生壳层检查任务、停止 Host、移除本地凭证、清理渲染层存储，再重启进入登录页。取消任务确认时保留当前账号。读取或退出失败时持续显示重试提示。侧边栏展示配置的企业名称，不显示官方厂商标识。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

浏览器部分注册功能专属的设置、侧边栏账号和品牌插槽。账号入口与官方账号菜单共用 `AccountLauncher` 基础组件。壳层接口提供元数据、浏览器登录和退出操作，不提供密码、登录 token 或模型凭证。客户端注册逻辑为侧边栏与设置页维护同一个账号状态源，只订阅一次，并忽略过期或释放后的读取结果。组件通过框架 hook 读取状态；插件释放时移除壳层订阅、插槽和语言字典。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [企业服务](../../../backend/README.zh.md) — 员工管理、模型下发、部署和验证。
- [桌面壳层](../../../apps/desktop/README.zh.md) — Host 归属和原生生命周期。
- [客户端 UI 子系统](../../../docs/subsystems/web-client.zh.md) — 共用插槽语义。

-----

<a id="dev-note"></a>
## 开发备注

无。

-----

<a id="model-experience"></a>
## 模型体验

无，因为浏览器仅展示原生账号元数据、调用壳层账号操作，不提供模型上下文或工具。

#### KV Cache 影响

插件不改变模型请求或缓存前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 插件要求企业 Electron 预加载接口。
- 企业图标来自发布配置，本插件不创建标志。
- 切换账号会先停止 Host，再重启应用。
