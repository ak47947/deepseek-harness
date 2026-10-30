/** Enterprise-only preload operations; account credentials remain in the main process. */
import { ipcRenderer } from 'electron'
import type { DesktopEnterpriseAccountBridge } from '@deepseek-ai/dsh-client-ui-settings-enterprise-account/types'
import { ENTERPRISE_IPC } from './enterprise-window.ts'

/**
 * Expose the account bridge only when the owning enterprise window explicitly requests it.
 * @returns Optional enterprise operations to merge into the origin-checked product API.
 */
export function enterpriseProductBridge(): { enterpriseAccount?: DesktopEnterpriseAccountBridge } {
  if (!process.argv.includes('--dsh-enterprise-desktop')) return {}
  return { enterpriseAccount: {
    organization: () => ipcRenderer.invoke(ENTERPRISE_IPC.organization),
    status: () => ipcRenderer.invoke(ENTERPRISE_IPC.account),
    startSignIn: async () => { await ipcRenderer.invoke(ENTERPRISE_IPC.start) },
    signOut: () => ipcRenderer.invoke(ENTERPRISE_IPC.signOut),
    subscribe: (listener) => {
      ipcRenderer.on('dsh-enterprise:changed', listener)
      return () => { ipcRenderer.off('dsh-enterprise:changed', listener) }
    },
  } }
}
