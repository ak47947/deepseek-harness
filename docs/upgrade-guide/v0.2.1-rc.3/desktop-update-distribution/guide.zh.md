---
kind: upgrade-guide
description: 企业 macOS Desktop 仅通过 DMG 更新；未签名的企业 Windows 安装包更新时不校验发布者。
---

# 桌面更新分发方式

[English](guide.md) | 中文

## 变更

企业 Desktop 在 macOS 上不检查、下载或安装原地更新：应用菜单不提供更新命令，启动与系统恢复不请求更新清单，账号区也不显示更新入口。管理员通过 MDM 或内部下载页分发企业 macOS 的 DMG。

企业 Windows 保留应用内更新能力，且未签名的企业 Windows 包在所选配置指定更新目的地时会内嵌该更新源。由于包内 `app-update.yml` 不含 `publisherName`，electron-updater 跳过对下载安装包的签名校验，因此更新不需要代码签名证书。该更新源及其列出的产物完整性由发布方负责。

## 迁移

1. 企业 macOS 以 DMG 形式发布。签名发布仍需 Developer ID 签名与公证；没有证书时使用本地未签名命令打包，并自行分发 DMG。
2. Windows 发布配置中的更新目的地即为其更新地址：企业打包显式选择企业发行配置，并使用 `DSH_DESKTOP_ENTERPRISE_UPDATE_URL`。未配置企业设置的上游发行版保留既有更新策略。
3. 按目标目录（`win-x64`）放置安装包、对应的 `.exe.blockmap` 以及渠道元数据（`nightly.yml` 或 `latest.yml`）。
4. 在一台 Windows 试点机验证一次升级：账号区显示新版本，选中后开始下载，确认后重启完成安装。
5. 未签名安装包仍会触发操作系统的未知发布者提示，更新过程不会消除该提示。
