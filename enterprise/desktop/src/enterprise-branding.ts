/** Enterprise product names applied to the shell's existing localized messages. */

/**
 * @param locale - Shipped shell dictionary, which remains unchanged.
 * @param productName - Enterprise release name; undefined retains the official dictionary.
 * @returns Localized copy with the selected product name in menus, dialogs, and notifications.
 */
export function enterpriseDesktopLocale<L extends { readonly messages: Record<string, string> }>(locale: L, productName: string | undefined): L {
  if (productName === undefined) return locale
  const messages = Object.fromEntries(Object.entries(locale.messages).map(([key, value]) =>
    [key, value.replaceAll('DeepSeek Harness', () => productName)])) as L['messages']
  return { ...locale, messages }
}
