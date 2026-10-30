---
kind: upgrade-guide
description: Enterprise macOS Desktop updates through a DMG, and an unsigned enterprise Windows installer updates without a publisher check.
---

# Desktop update distribution

English | [中文](guide.zh.md)

## Change

Enterprise Desktop does not check for, download, or install an in-place update on macOS. Its application menu carries no update command, startup and resume perform no feed request, and the account row shows no update entry. Administrators deploy the macOS DMG through MDM or an internal download page.

Enterprise Windows keeps the in-application updater, and an unsigned enterprise Windows package now seals the release feed when the selected settings name a destination. Because the packaged `app-update.yml` carries no `publisherName`, electron-updater skips signature verification of the downloaded installer, so updating needs no code-signing certificate. The release operator owns the integrity of that feed and of the artifacts it lists.

## Migration

1. Publish enterprise macOS releases as DMG images. Signed releases still need Developer ID signing and notarization; without them, use the local unsigned command and distribute the DMG yourself.
2. Keep the Windows release settings' update destination authoritative: `DSH_DESKTOP_ENTERPRISE_UPDATE_URL` for enterprise packaging, with an explicit enterprise release selection. The unconfigured upstream distribution retains its existing update policy.
3. Host each target directory (`win-x64`) with the installer, its `.exe.blockmap`, and the channel metadata (`nightly.yml` or `latest.yml`).
4. Verify one upgrade on a Windows pilot machine: the installed application shows the new version in the account row, downloads on selection, and restarts after the confirmation.
5. Expect no signature warning suppression: an unsigned installer still displays the operating system's unknown-publisher prompt during installation.
