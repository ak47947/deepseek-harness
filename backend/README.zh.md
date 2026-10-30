---
description: "运行和管理单企业账号与模型下发服务，配置企业桌面端，并部署可选的 LiteLLM 精细化管理。"
---

# 企业账号与模型下发

[English](README.md) | 中文

## 概述

员工使用企业管理的账号登录，在企业桌面端获取获批模型。基础模式下发供应商凭证，模型请求由员工电脑直达供应商。精细化模式将供应商和 LiteLLM 凭证保留在服务端，认证模型调用，并由 LiteLLM 执行额度和用量管理。服务使用 Better Auth 和 PostgreSQL，每套部署服务于一个企业，运行一个后台进程。

| 位置 | 职责与数据 |
|---|---|
| 企业服务器 | Better Auth、PostgreSQL、员工账号、角色、模型分配和网页管理后台 |
| 管理员浏览器 | 独立访问 `https://dsh.example.com/admin`，无需安装桌面端 |
| 每位员工的电脑 | 桌面端及本地执行 Host；会话、项目、附件和个人设置保存在该电脑 |

桌面端通过 HTTPS 向服务器请求认证和已分配配置，不启动 Better Auth 或 PostgreSQL。服务端配置和 `BETTER_AUTH_SECRET` 保留在服务器；桌面发布配置只包含公开服务地址和发布元数据。

顶层 `backend/` 目录统一维护认证、管理后台、模型配置、账号持久化、部署文件和服务测试。桌面端位于 `apps/desktop/`，运行独立的本地 Host，负责会话、项目和工具执行。

## 目录

- [运行服务](#run-the-service)
- [管理员工和模型](#manage-employees-and-models)
- [启用 OIDC 登录](#enable-oidc-sign-in)
- [连接企业桌面端](#connect-enterprise-desktop)
- [在本机使用 Docker](#run-locally-with-docker)
- [部署与备份](#deploy-and-back-up)
- [启用精细化模式](#enable-managed-mode)
- [安全与失败行为](#security-and-failure-behavior)
- [验证](#verification)
- [开发备注](#dev-note)

-----

<a id="run-the-service"></a>
## 运行服务

使用 Docker Compose 2.24.4 或更高版本部署企业后台。先进行[本机 Docker 部署](#run-locally-with-docker)，再使用[服务器部署](#deploy-and-back-up)供员工访问。镜像构建运行时、初始化服务 profile，并在容器内通过 `dsh --profile enterprise` 启动；宿主机只需 Docker，无需另行运行 Node 服务。

从[环境变量模板](deploy/.env.example)创建私有部署环境文件。将 `DSH_CLIENT_COMMIT_HASH` 设为源码检出目录中 `git rev-parse HEAD` 的输出；镜像不包含 `.git`，需要显式提供源码版本标识。选择长期不变的 `DSH_ENTERPRISE_ID`、至少 32 个字符的密码学随机 `BETTER_AUTH_SECRET`，以及随机十六进制的 `ENTERPRISE_POSTGRES_PASSWORD`。Compose 提供容器内 PostgreSQL 的 `DATABASE_URL`。远程部署要求 HTTPS `DSH_ENTERPRISE_ORIGIN`；本机叠加配置提供回环 HTTP，仅用于同机开发。

通过 `DSH_ENTERPRISE_BOOTSTRAP_EMAIL` 和 `DSH_ENTERPRISE_BOOTSTRAP_PASSWORD` 配置首个管理员的邮箱和至少 12 位的密码；仅用户表为空时创建管理员。初始化后，从环境文件移除引导凭证，再使用相同 Compose 配置重建后台容器。

| 设置 | 默认值 | 用途 |
|---|---|---|
| `DSH_ENTERPRISE_HOST` / `DSH_ENTERPRISE_PORT` | `0.0.0.0` / `3090` | Compose 提供的容器监听地址 |
| `DSH_ENTERPRISE_PRODUCT_NAME` | `Atrix Harness` | 浏览器登录与完成页的产品名；与 Desktop 的 `productName` 保持一致 |
| `DSH_ENTERPRISE_MODE` | `basic` | `basic` 或 `managed`；精细化配置不完整时拒绝启动 |
| `DSH_ENTERPRISE_SESSION_SECONDS` | `86400` | 登录硬有效期，范围为 60 至 2592000 秒 |
| `DSH_ENTERPRISE_AUTHORIZATION_SECONDS` | `300` | 浏览器授权有效期，范围为 60 至 1800 秒 |
| `DSH_ENTERPRISE_OIDC_ENABLED` | `0` | 设为 `1` 启用企业 OIDC 登录；要求 HTTPS 企业服务地址 |
| `DSH_ENTERPRISE_OIDC_ISSUER` / `DSH_ENTERPRISE_OIDC_DISCOVERY_URL` | 未设置 | 精确的 HTTPS Issuer 及其发现文档地址 |
| `DSH_ENTERPRISE_OIDC_CLIENT_ID` / `DSH_ENTERPRISE_OIDC_CLIENT_SECRET` | 未设置 | OIDC 应用凭证；启用 OIDC 时必须配置 |
| `DSH_ENTERPRISE_OIDC_TOKEN_AUTH_METHOD` | `client_secret_basic` | Token 端点客户端认证方式；应用登记为表单认证时选择 `client_secret_post` |
| `DSH_ENTERPRISE_OIDC_DISPLAY_NAME` | `Company SSO` | 桌面浏览器登录按钮显示的身份中心名称 |
| `DSH_ENTERPRISE_OIDC_AUTO_PROVISION` | `0` | 首次登录自动创建普通员工；仅在 IdP 已将应用限定分配给获准员工后启用 |
| `DSH_ENTERPRISE_PASSWORD_ENABLED` | `1` | 启用 OIDC 后可设为 `0`，隐藏员工密码字段并拒绝员工密码登录；管理员密码登录保留 |
| `DSH_ENTERPRISE_LITELLM_URL` / `DSH_ENTERPRISE_LITELLM_KEY` | 未设置 | 私有网关地址和管理凭证，仅精细化模式使用 |
| `DSH_ENTERPRISE_UPSTREAM_TIMEOUT_MS` | `300000` | 精细化模式模型请求的最长持续时间 |
| `DSH_ENTERPRISE_DIRECT_KEYS_REVOKED_AT` | 未设置 | 迁移已有基础模式配置时，确认供应商凭证已撤销的 UTC 时间 |

-----

<a id="manage-employees-and-models"></a>
## 管理员工和模型

打开服务器公开地址下的 `/admin`，以管理员身份登录；服务根地址也打开此页面。本应用维护管理界面和模型配置，账号变更使用 Better Auth 的 Admin 插件。普通员工账号不能读取或修改管理数据。创建员工时填写姓名、邮箱、初始密码和角色，不提供公开注册。先在“平台默认模型”中配置供应商地址、受支持的 API 协议、凭证、明确的模型能力及默认模型。未单独配置的成员自动继承平台配置，包括已有成员和新建账号。用户单独配置优先；点击“使用平台默认配置”可清除单独配置。平台默认配置的修改在成员下次配置同步时生效。既无平台默认配置也无单独配置的成员不能启动桌面端。基础模式管理员必须使用企业接受分发且能够单独撤销的供应商凭证；隐藏模型选项不能强制限制供应商侧权限。

管理后台依据 [shadcn-admin](https://github.com/satnaing/shadcn-admin) 的 [MIT 许可证](SHADCN-ADMIN-LICENSE)适配其主题与布局。侧边导航提供工作台概览、部门管理、用户管理、模型配置，以及精细化模式下的额度与用量。同源应用支持中英文、明暗主题与移动端抽屉导航。用户搜索、部门／角色／状态筛选和每页十条的分页在目录加载的最近 1,000 个账号内执行；概览中的账号统计也基于这一加载范围。

管理员以树状结构维护部门：创建顶级或子部门、修改名称与说明、调整上级部门。系统拒绝将部门移动到自身或后代部门下。部门树支持展开、收起及保留祖先路径的搜索；部门选择框显示完整路径。每位成员可归入一个部门或设为未分配。PostgreSQL 增量迁移将已有部门保留为顶级部门，并保留成员归属。部门包含账号（包括已停用账号）或子部门时禁止删除，必须先迁移或清除其归属。部门用于组织账号，模型权限与额度仍按成员单独配置。

管理员可以重置密码、修改其他员工的角色和停用账号。重置密码会撤销登录会话。停用后，员工不能获取配置或发起新的精细化模型请求。基础模式会提示管理员需要单独撤销供应商凭证。精细化模式独立保存网关清理状态；撤销失败时持续展示并提供重试操作。系统拒绝管理员自行降权或停用自己。后台串行执行管理写入，在前序变更结束后重新检查操作人的管理员权限。

精细化模式增加以美元计价的月额度，以及按员工、模型和 UTC 日期范围筛选、分页展示的网关用量。用量读取失败时展示暂不可用状态。月额度计数与筛选后的请求历史统计范围不同，实际支出以供应商账单为准。

-----

<a id="enable-oidc-sign-in"></a>
## 启用 OIDC 登录

在企业现有 IdP 注册 OIDC 应用，将 `<DSH_ENTERPRISE_ORIGIN>/api/auth/callback/enterprise-oidc` 登记为回调地址。在服务器私有环境文件中设置 `DSH_ENTERPRISE_OIDC_ENABLED=1`，并按上表配置 Issuer、发现地址、客户端 ID 和密钥，再使用相同 Compose 配置重建后台容器。启用 OIDC 要求完整配置及 HTTPS 企业服务地址；发现文档的 Issuer 与配置不一致时拒绝启动。微信、企业微信、飞书登录在上游 IdP 配置；后台使用 Better Auth Generic OAuth，不内嵌特定渠道登录组件。

默认先在 `/admin` 创建员工，再打开成员操作菜单并选择“统一登录身份”。从 IdP 复制准确的 `sub`，核对显示的 Issuer 后保存。邮箱不会隐式关联账号。仅普通员工可使用 OIDC，管理员继续使用邮箱密码登录。关闭员工密码时，创建及密码重置操作省去员工密码；将无密码员工提升为管理员需要设置管理员密码，并清除其 OIDC 绑定和会话。

启用首次登录自动开通前，先将 IdP 应用限定分配给获准员工，排除访客、公开自助注册及未经员工准入筛选的第三方身份，并验证未分配的身份被拒绝。随后设置 `DSH_ENTERPRISE_OIDC_AUTO_PROVISION=1`。新员工使用普通用户角色并继承平台默认模型；邮箱已被其他账号占用时拒绝登录，不合并账号。无法通过应用分配保证员工准入时，保持自动开通关闭，使用明确的员工绑定。

OIDC 使用绑定浏览器的一次性状态、S256 PKCE、nonce 绑定、JWKS 验签及 Issuer、受众、有效期、授权方和已验证邮箱检查。身份记录同时编码 Issuer 与主体；更换 Issuer 不自动复用旧身份。后续登录保留稳定员工 ID、本地历史、部门和模型。保存或清除统一登录身份会撤销浏览器及桌面会话和未交换的桌面授权码，不删除员工数据；清除后需要管理员明确重新绑定。

客户端密钥仅保留在服务器，上游访问令牌和 ID 令牌不持久化，也不下发桌面。OIDC 故障时，仅在启用员工密码登录的情况下保留密码入口。管理员必须在撤销 IdP 访问权限时另行停用 DSH 员工并撤销其会话；仅在 IdP 停用不会使既有 DSH 会话失效。联网桌面在下一次状态同步时停止，离线桌面在硬过期时停止；基础模式的供应商 Key 仍需单独撤销。HTTP 和浏览器测试使用本地签名的 OIDC 提供方；上线前需针对企业真实 IdP 验证 Issuer 配置、应用分配、可信 HTTPS 及实际回调。

-----

<a id="connect-enterprise-desktop"></a>
## 连接企业桌面端

开发时 Desktop 读取 `apps/desktop/config/desktop.json`。缺少企业字段时，企业名与产品名默认为 `Atrix Harness`，应用 ID 为 `com.atrix.desktop`，服务地址为 `http://127.0.0.1:3090`。连接其他部署时编辑此文件，再从仓库根目录运行：

```sh
pnpm run dev:desktop
```

本机 Docker 部署与默认 Desktop 均使用 `http://127.0.0.1:3090`。本机服务支持回环 HTTP，远程服务必须使用 HTTPS。即使没有设置企业环境变量，Desktop 也会打开企业登录页。

浏览器登录使用有时限且只能消费一次的授权码，绑定桌面端的 S256 PKCE 校验值和临时 `127.0.0.1` 回调。交换完成后，Better Auth 创建独立的桌面会话；浏览器 URL 不携带会话 token 或模型凭证。登录与完成页在中英文及明暗主题下均使用企业绶带图标和后台的 `DSH_ENTERPRISE_PRODUCT_NAME`。完成页通过 `dsh://open` 打开应用。已取消或过期的请求不能在本地完成登录。企业欢迎页要求登录，不提供访客或手工填写 API Key 入口。账号及配置准备完成后才启动 Host。侧边栏显示员工姓名，菜单提供邮箱、设置和退出登录。

每组已认证的 `[enterpriseId, userId]` 对应 `<userData>/enterprise/accounts/<sha256>/`。壳层初始化该账号的 `profiles/desktop`，原子替换并校验模型配置和凭证文件，再将 `DSH_HOME` 和 profile 路径一并传给 Host。切换账号会停止 Host 并重启应用。同一账号重复登录会复用目录，保留项目、对话、附件和个人设置，不导入官方 CLI 默认的 `~/.dsh`。目录哈希用于区分账号，不能防止共用同一操作系统账号的人读取文件。

从[桌面端模板](deploy/desktop.env.example)创建企业发布配置文件，将 `DSH_ENTERPRISE_PACKAGING_ENV` 指向其绝对路径。配置 `DSH_DESKTOP_ENTERPRISE_CONFIG`、与之匹配的 `DSH_DESKTOP_APP_ID`、`DSH_DESKTOP_ENTERPRISE_UPDATE_URL`、`DSH_DESKTOP_ENTERPRISE_POLICY_ORIGIN`、可选的 PNG 图标绝对路径 `DSH_DESKTOP_ENTERPRISE_ICON`，以及既有的 [macOS 签名与公证设置](../apps/desktop/publishing/README.zh.md)。签名发布要求独立企业标识和 HTTPS 发布地址。默认随包提供企业图案。安装版在固化元数据上读取桌面配置文件，运行时环境变量不能替换这些设置。更新根目录下按 `mac-arm64`、`mac-x64` 或 `win-x64` 存放既有格式的安装包和通道元数据。

```sh
DSH_ENTERPRISE_PACKAGING_ENV=/absolute/enterprise-release.env pnpm --filter @deepseek-ai/dsh-desktop run package:mac:arm64
```

成员可在“设置 → 模型”中添加本地自定义供应商、API 地址、凭证和模型 ID，与企业下发模型同时使用。本地供应商、凭证及本地默认模型在服务端同步、退出登录及同一账号重新登录后保留。企业模型条目由后台刷新；个人供应商请使用不同的标识。本地供应商请求直达相应服务，不计入企业 LiteLLM 额度与用量。

企业登录保留遥测、插件市场及管理界面、预设中的插件管理工具、运行时自修改和搜索，并沿用标准配置及凭证要求。壳层提供包管理器、桌面 CLI 安装及当前账号的第三方插件恢复入口。恢复操作备份 profile 补丁，下次启动会在启动 Host 前准备企业配置。官方账号和钱包界面由企业账号界面替代。既有 Office 技能和本地执行沿用官方沙箱与审批语义。企业登录不增加 SOP、模板或外部集成审核要求；受支持的插件与 MCP 连接保持可用。发布地址接受任意显式配置的 HTTPS 主机。

-----

<a id="run-locally-with-docker"></a>
## 在本机使用 Docker

[本机叠加配置](deploy/compose.local.yml)通过 `http://127.0.0.1:3090` 提供账号服务和 `/admin`，通过 `http://127.0.0.1:3091/api/v0/check_client_update` 提供更新策略。PostgreSQL 和运行时数据使用 `dsh-enterprise-local` 项目的命名卷。无需域名。

从仓库根目录操作，按[环境变量模板](deploy/.env.example)创建私有的 `.artifacts/enterprise-local/.env`，限制为仅所有者可读，并填写[运行服务](#run-the-service)中的必填配置。叠加配置提供回环地址和容器运行目录。显式选择私有文件：

```sh
export DSH_ENTERPRISE_ENV_FILE="$PWD/.artifacts/enterprise-local/.env"
docker compose --project-name dsh-enterprise-local --env-file "$DSH_ENTERPRISE_ENV_FILE" -f backend/deploy/compose.yml -f backend/deploy/compose.local.yml up --build --detach --wait
```

打开 `/admin`，使用配置的管理员登录。在[桌面开发命令](#connect-enterprise-desktop)中使用 `http://127.0.0.1:3090` 即可连接开发版桌面端。在私有环境文件设置 `DSH_ENTERPRISE_LOCAL_PORT` 可修改账号服务端口。镜像构建后，使用相同 Compose 参数和 `up --detach --no-build --wait` 启动已有服务，或使用 `stop` 停止并保留数据。删除数据卷会删除此部署的数据。提供签名安装包和通道元数据前，更新入口仅提供策略。

-----

<a id="deploy-and-back-up"></a>
## 部署与备份

在企业服务器上运行 [Compose 部署](deploy/compose.yml)，其中包含后台、PostgreSQL 和静态更新源。按[服务必填配置](#run-the-service)创建 `deploy/.env`。在本目录执行：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml up --build -d
```

在企业既有反向代理终结 HTTPS。账号服务转发到回环端口 3090，更新服务转发到回环端口 3091；更新主机还通过 `deploy/updates/policy.json` 提供 `/api/v0/check_client_update`。随附策略允许正常启动。将签名安装包和匹配的通道元数据发布到更新目录，先在试点机器验证升级，再扩大分发。

远程服务地址可使用服务器 IP，并配置员工电脑信任的 HTTPS 证书；域名不是必需项。使用域名且没有既有 HTTPS 代理时，可选的[服务器叠加配置](deploy/compose.server.yml)通过 Caddy 为账号服务和 `/admin` 提供入口。将 `DSH_ENTERPRISE_ORIGIN` 设为公开 HTTPS 地址，将其 DNS 指向服务器，并开放 80 和 443 端口以签发证书。更新服务仍需独立的 HTTPS 地址。证书信任及员工网络访问需要在部署服务器上验证。

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml -f deploy/compose.server.yml up --build -d
```

运行一个后台容器。备份账号数据库、保持不变的部署密钥、发布设置和更新产物。模型配置和虚拟 Key 使用从 `BETTER_AUTH_SECRET` 派生的密钥加密；变更或丢失该密钥会使认证失效，并导致已有配置无法解密。精细化部署还需备份独立的 LiteLLM 数据库及其 salt。恢复到隔离环境后，验证员工身份、模型配置、网关用户、累计费用和桌面登录，再确认恢复可用。

-----

<a id="enable-managed-mode"></a>
## 启用精细化模式

适配器面向 LiteLLM [v1.106.4](https://github.com/BerriAI/litellm/releases/tag/v1.106.4)。配置私有网关和管理凭证，或者使用[精细化 Compose 叠加配置](deploy/compose.managed.yml)，使用前先在 [litellm.yml](deploy/litellm.yml) 中替换获批模型和供应商占位值。网关不发布端口。网关 HTTP 仅用于私有部署网络；远程网关使用 HTTPS。

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml -f deploy/compose.managed.yml up --build -d
```

迁移基础模式员工前，在供应商侧撤销所有已分发凭证，并将 `DSH_ENTERPRISE_DIRECT_KEYS_REVOKED_AT` 设置为确认后的 UTC 时间。已有基础模式配置时，未提供该确认会阻止精细化启动。随后将员工重新分配到精细化路由；旧配置会拒绝下发，不回退为直连。将确认保留在部署记录中。后台不能自行验证外部供应商是否已经撤销凭证。

精细化模型凭证绑定有效的登录会话，退出、会话撤销或过期后拒绝后续调用。网关用户标识由长期不变的企业和员工 ID 生成。后台先保存随机分配的虚拟 Key，再执行创建；重试时查询其哈希，并在重新登录和更换设备后保留用户关联。模型变更和额度更新保留用户累计费用，虚拟 Key 不下发到桌面端。必须能够连接网关并获取模型清单，员工模型 ID 必须在网关清单中。转发前拒绝模型请求中的上游地址和凭证覆盖字段。

-----

<a id="security-and-failure-behavior"></a>
## 安全与失败行为

主进程通过 Electron `safeStorage` 保存登录 token，与账号数据和模型 Key 分开。模型 Key 使用账号专属、仅文件所有者可读的 `.credentials.yaml`；同一操作系统用户仍可读取。配置同步在启动、休眠唤醒和默认每 15 分钟执行。明确的 `401`、`403` 或本地硬过期会停止任务、清理凭证并退回登录。临时网络错误或服务端失败仅在已保存的硬有效期内继续使用缓存。配置或身份不匹配时阻止后续工作，要求重新登录恢复。

运行中轮换先写入由地址和 Key 派生的新凭证引用，再通过 Host RPC 仅更新企业供应商条目。默认模型的供应商为 enterprise 时跟随后台更新，个人默认模型保持不变。精细化模式的平台默认配置变更后，旧的继承权限会拒绝调用，直到配置同步完成员工网关密钥的更新；下发失败时账号保持不可用，并在下次同步时重试。旧引用保留到 Host 退出，使已准备的请求能够完成。部分成功或结果不确定的写入会停止 Host。停止或凭证清理失败时阻止切换账号，历史数据保留。员工停用后，不保证已经发出的上游请求立即终止。

本地执行可能将文件内容、截图和工具结果发送给选定的模型供应商；精细化模式还会经过后台和 LiteLLM。后台不重复计量，不在用量响应中暴露提示词日志，不提供钱包、支付、SSO、部门分摊或多租户管理。

-----

<a id="verification"></a>
## 验证

在仓库根目录执行验证。专项测试覆盖 PostgreSQL 协议上的真实 HTTP 认证、角色限制、直连配置下发、网关流式转发、模型拒绝、网关清理、账号目录、过期竞争和凭证轮换。浏览器测试使用隔离的 PGlite 数据库，通过测试夹具启动服务，覆盖 HTTP 和 HTTPS 反向代理，包括安全会话 Cookie。可选 Docker 检查验证构建上下文排除规则、源码版本和私有环境文件必填要求、本机回环端口选择，以及从 PostgreSQL 备份恢复员工身份、角色和加密模型配置；恢复测试要求本机已缓存 `postgres:17.6-bookworm` 镜像。可选网关验收启动固定版本的 LiteLLM、PostgreSQL 和本地供应商替身，验证员工密钥创建、费用累计、超额拒绝及停用。供应商账单、企业签名和更新分发仍需在试点基础设施验证。

```sh
pnpm exec vitest run backend/tests/server.spec.ts apps/desktop/tests/enterprise-session.spec.ts
pnpm run test:e2e backend/tests/admin.e2e.ts apps/desktop/tests/enterprise-flow.e2e.ts
DSH_ENTERPRISE_LITELLM_E2E=1 pnpm run test:e2e backend/tests/litellm.e2e.ts
DSH_ENTERPRISE_DOCKER_E2E=1 pnpm run test:e2e backend/tests/deployment.e2e.ts backend/tests/persistence.e2e.ts
```

试点验收需要两个真实员工账号、重启和账号切换后的历史数据检查、离线硬过期检查、真实流式对话及 Office/浏览器任务、供应商凭证撤销、启用网关后的并发与费用检查、备份恢复，以及一次来自企业源的签名更新。提供可访问的 HTTPS IP 地址或域名、受信任证书、获批图标和模型凭证后，再执行这些依赖环境的检查。

-----

<a id="dev-note"></a>
## 开发备注

试点有意只运行一个后台进程。部署多个副本之前，需要通过数据库协调管理操作的串行执行，以及迁移和初始管理员创建的归属。
