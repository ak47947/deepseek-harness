/** Enterprise account IPC and localized authorization-failure notices. */

/** Credential-free operations restricted to the owned application frame. */
export const ENTERPRISE_IPC = {
  organization: 'dsh-enterprise:organization',
  account: 'dsh-enterprise:account',
  signOut: 'dsh-enterprise:sign-out',
  start: 'dsh-enterprise:start',
  state: 'dsh-enterprise:state',
  cancel: 'dsh-enterprise:cancel',
} as const

/**
 * @param language - Shell language.
 * @param reason - Authentication or model synchronization failure.
 * @returns Actionable explanation after work has stopped.
 */
export function enterpriseSignInNotice(language: string, reason: 'expired' | 'configuration'): string {
  if (language.startsWith('zh'))
    return reason === 'expired'
      ? '企业登录已失效，任务已停止。请重新登录；账号被停用时请联系管理员。'
      : '企业模型配置同步未能完成，任务已停止。请联系管理员检查配置后重新登录。'
  return reason === 'expired'
    ? 'Your enterprise sign-in expired and tasks have stopped. Sign in again; contact your administrator if the account is disabled.'
    : 'Enterprise model synchronization could not be completed and tasks have stopped. Ask your administrator to check the configuration, then sign in again.'
}
