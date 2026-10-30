---
description: "在 Desktop Web 组合之上叠加企业账号、品牌与批准模型默认配置。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-enterprise-desktop

[English](README.md) | 中文

## 概述

包通过 `engines.dsh` 声明支持的 DSH 运行时版本。更新该声明前先验证新的上游运行时；企业启动流程拒绝不兼容的必需组合包。

企业 Desktop 通过此组合包显示公司账号与品牌，并使用为已登录用户批准的模型。认证后的 Desktop 启动流程在标准 Web 组合包之后启用本层。账号准备另行提供公司名称、模型设置和凭据引用。个人提供者、模型选择和无关的 profile 设置仍然可用。

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

企业 Desktop 在应用运行时中携带此组合包，并将其加入已认证账号 profile 的 `dsh.profile.bundles` 列表。标准 profile 加载器解析其清单声明的 patch。已有组合包保留原有顺序，重复准备账号时不增加重复的企业条目。用户无需单独安装。

本层用[企业账号插件](../account/README.zh.md)替换官方账号与品牌界面，禁用两个官方 DeepSeek 模型适配器，启用模型设置和可配置的模型提供者，并将共享助手身份交给企业账号插件。Desktop 的账号准备提供批准模型和默认选择；已有个人默认模型保持选中。

Profile patch 仍位于本层之上。其托管条目包含账号数据和配置的助手名称，而无关设置和个人提供者在账号准备时保留。启动会先移除早期企业版本内联插入的界面条目和静态覆盖，再应用此组合包。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 包含企业静态选项和企业账号插件插入项。[`src/index.ts`](src/index.ts) 没有运行时 API。此组合包与其他组合包使用相同的 profile 分层和包解析方式；其代码不加载 Electron，也不认证用户。

账号准备在 profile 初始化后选中此组合包。初始化保留已有清单，因此后续 Desktop 发行准备会保留企业层及用户安装的组合包。恢复可以移除可选组合包；认证后的启动流程会在 Host 启动前恢复必需的企业层。凭据仍存放在账号所属的凭据文档中，不进入本 patch。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Desktop](../../apps/desktop/README.zh.md)——应用启动和账号准备。
- [Profile 组合](../../packages/boot/app-boot/README.zh.md#profiles)——组合包解析和 patch 优先级。
- [企业账号](../account/README.zh.md)——公司身份和账号界面。

-----

<a id="model-experience"></a>
## 模型体验

通过企业账号插件和选中的模型提供者间接影响模型；这些包拥有各自面向模型的行为。

#### KV 缓存影响

此组合包自身不增加请求文本；企业账号插件拥有配置的助手身份及其缓存影响。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 此组合包要求标准 Web 组合和已认证的 Desktop 账号准备。单独添加它不提供登录或批准模型的凭据。
- Profile patch 替换目标行的完整配置。账号准备在保留自定义提示词字段的同时保持内置 Harness 身份禁用。

<a id="dev-note"></a>
### 开发备注

无。
