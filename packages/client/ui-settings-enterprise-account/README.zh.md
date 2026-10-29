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

企业壳层将此插件插入各已认证账号的桌面 profile，在工作区展示配置的企业名称和员工身份。预加载脚本必须提供 `dshDesktop.enterpriseAccount`；在普通浏览器中挂载时明确报错。`agentName` 为必填字段，由桌面产品名提供，默认是 `Atrix Harness`。壳层关闭内置 Harness 身份；此插件为所有 Agent 预设和子 Agent 注册共享的企业身份。

账号设置页展示员工姓名、邮箱、运行模式和同步状态。退出登录会让原生壳层检查任务、停止 Host、移除本地凭证、清理渲染层存储，再重启进入登录页。取消任务确认时保留当前账号。读取或退出失败时持续显示重试提示。侧边栏展示配置的企业名称，不显示官方厂商标识。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

浏览器端注册功能所有的 Settings、侧栏账号、侧栏品牌、会话首屏标志和运行标志 slot。企业标志使用透明包资源，强制颜色模式显示其 alpha 轮廓。账号入口复用官方账号菜单的 `AccountLauncher` 基础组件。外壳 bridge 暴露元数据、浏览器登录和退出登录操作，不暴露密码、令牌或模型凭证。客户端注册持有供侧栏和 Settings 共用的账号来源，只订阅一次，并忽略过时或已销毁的读取。组件消费框架 hook，插件销毁时移除外壳订阅、slot 与字典。

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

### 企业 Agent 身份

#### 模型看到什么

桌面产品名使用默认值时，系统提示词以 `You are Atrix Harness, the enterprise AI assistant. Your name is Atrix Harness.` 开头。配置的名称作为字面文本，不随模型和 Agent 预设改变。浏览器不提供工具或账号凭证。

#### Token 影响

每次请求包含一小段身份说明。配置的名称不变时，该段 token 成本固定。

#### KV Cache 影响

配置的 Agent 名称位于稳定的系统提示词前缀中。修改名称会改变后续请求的该前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 插件要求企业 Electron 预加载接口。
- 企业图案由桌面企业原图生成，替换后需要重新构建客户端产物。
- 切换账号会先停止 Host，再重启应用。
