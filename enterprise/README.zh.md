---
description: "企业账号、模型下发、Desktop 接入和部署包。"
kind: "package-group"
---

# enterprise/ — 企业账号与 Desktop 接入

[English](README.md) | 中文

## 概述

将企业账号和获批模型配置接入共用的 DSH Desktop 应用。认证和管理服务部署在企业服务器，员工在自己的电脑上保留会话和项目数据。企业 bundle 添加账号界面、品牌和模型默认配置，原生适配器在 Host 启停前后处理认证和账号切换。企业实现、部署文件、图标和测试集中在本目录。

## 目录

- [包列表](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包列表

按需要修改的服务或接入能力选择所属包。

| 包 | 职责 |
|---|---|
| [`backend`](backend/README.zh.md) | 服务端认证、管理后台、模型下发和 Docker 部署 |
| [`protocol`](protocol/README.zh.md) | 不依赖服务端或 Electron 的共用校验与身份类型 |
| [`account`](account/README.zh.md) | 企业账号设置、企业品牌和智能体身份插件 |
| [`bundle`](bundle/README.zh.md) | 叠加在标准 DSH Web 组合上的企业 profile 层 |
| [`desktop`](desktop/README.zh.md) | Electron 认证与账号生命周期适配器、发布配置、图标和打包辅助脚本 |

企业 Host 和 Client 行为通过插件和 bundle 接入。共用桌面应用通过范围有限的产品操作调用原生适配器，不复制企业实现。

-----

<a id="related-documentation"></a>
## 相关文档

- [企业架构与验收](../docs/ent-agent/enterprise_agent_harness_proposal.zh.md) — 部署、数据隔离和发布验收。
- [DSH 架构](../docs/architecture.zh.md) — 共用应用启动与插件组合。
- [企业代码贡献说明](AGENTS.md) — 本目录的代码归属和接入规则。

<a id="dev-note"></a>
## 开发备注

无。
