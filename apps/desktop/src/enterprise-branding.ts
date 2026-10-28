/** Enterprise product names applied to the shell's existing localized messages. */
import type { DesktopLocale } from './locale.ts'

/**
 * @param locale - Shipped shell dictionary, which remains unchanged.
 * @param productName - Enterprise release name; undefined retains the official dictionary.
 * @returns Localized copy with the selected product name in menus, dialogs, and notifications.
 */
export function enterpriseDesktopLocale(locale: DesktopLocale, productName: string | undefined): DesktopLocale {
  if (productName === undefined) return locale
  const messages = { ...locale.messages }
  for (const key of Object.keys(messages) as Array<keyof typeof messages>) {
    messages[key] = messages[key].replaceAll('DeepSeek Harness', () => productName)
  }
  return { ...locale, messages }
}
