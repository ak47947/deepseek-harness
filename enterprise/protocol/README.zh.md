---
description: "校验 Desktop 与企业服务共享的企业账号身份及模型下发配置。"
kind: "package-library"
---

# @deepseek-ai/dsh-enterprise-protocol

[English](README.md) | 中文

## 概述

Desktop 与企业服务使用此库校验交换的账号及模型配置。调用方可导入校验器和带品牌标记的身份类型，无需加载认证服务器、数据库或 Electron。解析只校验响应字段；调用方仍负责认证响应并执行账号过期检查。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

企业服务或 Desktop 代码从根入口导入。此库没有 profile 条目或应用启动器。

```ts
import { endpointSchema } from '@deepseek-ai/dsh-enterprise-protocol'

const endpoint = endpointSchema.parse('https://models.example.test/v1')
```

`endpointSchema` 接受 HTTPS 与回环 HTTP 地址，拒绝内嵌凭证、查询参数或片段。`enterpriseSessionSchema` 校验已认证的账号响应及其模型下发字段；无效输入会使解析失败。`EnterpriseRequestError` 只报告 HTTP 状态，不保留上游响应正文或凭证。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[`src/index.ts`](src/index.ts) 定义 Zod 校验器、带品牌标记的 ID、推导的响应类型及状态错误。运行时依赖 Zod，编译时依赖无状态的身份品牌声明。认证与持久化由企业服务负责；Desktop 导入相同校验器，无需依赖服务实现。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [企业服务](../backend/README.zh.md)——认证、模型下发及部署。
- [品牌类型](../../packages/util/brand/README.zh.md)——不透明身份声明。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 解析不验证响应签发方，也不授予账号访问权限。调用方负责已认证的传输、授权及过期处理。
- 模型下发必须提供明确的模型能力，模型列表必须唯一且包含默认模型。解析器不接受可执行配置。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
