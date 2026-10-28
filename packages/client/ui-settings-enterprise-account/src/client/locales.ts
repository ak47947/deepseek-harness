/** Feature-owned account settings copy. */
export const zh = {
  title: '企业账号',
  signIn: '登录',
  menu: '账号菜单',
  settings: '设置',
  actionFailed: '账号操作未能完成，请重试',
  signOut: '退出登录并切换账号',
  basic: '基础模式',
  managed: '精细化模式',
  degraded: '暂时无法同步企业配置，将在登录有效期内继续使用缓存配置',
  unavailable: '无法读取企业账号，请重试或重启应用',
  retry: '重试',
  failed: '退出未能完成，请重试或重启应用',
}
/** English account settings copy. */
export const en: Record<keyof typeof zh, string> = {
  title: 'Enterprise account',
  signIn: 'Sign in',
  menu: 'Account menu',
  settings: 'Settings',
  actionFailed: 'The account action could not be completed. Please retry.',
  signOut: 'Sign out and switch account',
  basic: 'Basic mode',
  managed: 'Managed mode',
  degraded: 'Enterprise synchronization is unavailable. Cached configuration remains usable until sign-in expires.',
  unavailable: 'Your enterprise account could not be read. Retry or restart the application.',
  retry: 'Retry',
  failed: 'Sign-out could not be completed. Retry or restart the application.',
}
/** Locale keys owned by this feature. */
export type EnterpriseAccountKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.enterprise': EnterpriseAccountKey
  }
}
