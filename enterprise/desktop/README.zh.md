---
description: "为 Electron 应用提供企业 Desktop 账号认证、账号独立存储和发行资源。"
kind: "package-library"
---

# @deepseek-ai/dsh-enterprise-desktop-shell

[English](README.md) | 中文

## 概述

Desktop 应用通过此库在打开本地数据或启动工作区 Host 之前认证公司账号。适配器准备账号独立的 profile、同步批准模型，并在授权结束时停止工作。企业配置、图案以及开发和打包辅助脚本与适配器放在一起。不含企业配置的 Desktop 启动保留上游账号流程和应用身份。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

[Electron 入口](../../apps/desktop/src/main.ts)调用 `desktopProduct()` 选择发行配置。显式企业配置启用账号适配器；没有企业配置时保留上游欢迎流程、产品名、资源和更新行为。此库是应用的私有依赖，不是 Cordis 插件或 profile 组合包。

企业开发启动器在调用共享 Desktop 启动器之前，通过 `DSH_DESKTOP_CONFIG_FILE` 选择 [`config/desktop.json`](config/desktop.json)。调用者可以选择其他文件。已安装的企业发行版在应用元数据中携带初始设置，并读取 `<appData>/com.atrix.desktop/desktop/config.json` 下的配置。无效文档会阻止启动。[企业服务配置](../backend/README.zh.md#connect-enterprise-desktop)拥有账号服务与发行设置的说明。

适配器的 [`createEnterpriseDesktop()` 入口](src/adapter.ts)接收壳提供的显式窗口、Host 准备、停机和错误报告操作。认证根据稳定的公司和用户标识选择私有 Harness home。壳在认证和账号准备完成前保持 Host 停止。每个账号使用独立的浏览器存储分区。Electron 安全存储加密保存的登录信息；安全存储不可用时拒绝登录。

退出登录和授权失效先停止 Host，再清除托管凭据和浏览器存储。停机失败或结果未确认时，不执行依赖停机的清理和重新启动。工作停止后的清理失败仍会明确显示。临时同步失败可以保留当前有效账号并报告降级状态，但不会延长账号有效期。

### 发行资源

[`resources/`](resources/) 包含企业图标原图和原生图标格式；[`installer/assets/`](installer/assets/) 包含 Windows 安装器图案。[账号界面](../account/README.zh.md)和浏览器登录页使用同一原图的衍生资源。欢迎页渲染器的生成图片仍位于共享壳要求的资源位置。

从仓库根目录按现有尺寸和格式重新生成资源：

```sh
pnpm run render:enterprise-brand-assets
```

打包辅助脚本向共享构建提供企业应用身份、图案位置和显式配置的更新地址。没有选择企业配置时，本机未签名打包使用上游应用标识和更新规则。企业 macOS 发行版使用 MDM，没有应用内更新器；此策略仅适用于企业发行版。企业 Windows 发行版使用封入安装包的更新源，配置了更新源的未签名构建也包括在内。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

[`src/adapter.ts`](src/adapter.ts) 拥有原生账号生命周期，并通过 preload 桥发布不含凭据的账号信息。[`src/enterprise-profile.ts`](src/enterprise-profile.ts) 启用[企业组合包](../bundle/README.zh.md)，提供批准模型数据和配置的助手名称，同时保留个人提供者、个人默认模型和无关设置。动态模型轮换使用 Host 现有的凭据和设置 API。

适配器通过[企业协议库](../protocol/README.zh.md)定义的校验消息与[企业服务](../backend/README.zh.md)交换账号和模型配置。服务拥有认证和授权；原生适配器拥有本地账号数据选择和 Host 停机。Profile 初始化保留已有组合包列表，而账号准备加入企业层时不替换其他已安装组合包。

[`scripts/enterprise-package-environment.mjs`](scripts/enterprise-package-environment.mjs) 拥有企业构建设置和资源位置。[`scripts/render-brand-assets.ts`](scripts/render-brand-assets.ts) 生成原生、安装器、账号、欢迎页和浏览器图案。共享构建和启动器调用这些辅助脚本，不拥有企业默认值。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Desktop](../../apps/desktop/README.zh.md)——共享壳行为和构建操作。
- [企业服务](../backend/README.zh.md)——认证、管理和批准模型。
- [企业协议](../protocol/README.zh.md)——经过校验的账号和模型配置消息。
- [企业组合包](../bundle/README.zh.md)——静态 profile 组合。
- [企业账号界面](../account/README.zh.md)——公司身份和账号操作。

-----

<a id="model-experience"></a>
## 模型体验

通过账号准备配置的企业账号插件和模型提供者间接影响模型。

#### KV 缓存影响

适配器不增加模型请求文本；配置的身份和选中的提供者拥有各自的请求前缀影响。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 原生账号操作要求 Electron 和壳的生命周期操作。此库不能作为仅运行于 Host 的插件。
- 企业 macOS 更新要求通过 MDM 外部分发；上游 Desktop 更新器仍可供上游发行版使用。
- 应用运行时必须携带企业组合包。仅有账号凭据不会提供组合包的界面或组合配置。

<a id="dev-note"></a>
### 开发备注

无。
