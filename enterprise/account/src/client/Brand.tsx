/** Enterprise display name supplied by the native shell, without a default vendor mark. */
import { useEffect, useState } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopEnterpriseAccountBridge } from '../types.ts'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './Brand.module.css'

/** @param props - Native organization metadata source. @returns Enterprise display name before and after sign-in. */
export function EnterpriseBrand({ bridge }: InjectFace<{ bridge: DesktopEnterpriseAccountBridge }>) {
  const [name, setName] = useState('')
  useEffect(() => {
    let disposed = false
    void bridge
      .organization()
      .then((value) => {
        if (!disposed) setName(value)
      })
      .catch((_error: unknown) => {
        // The account Settings page owns the actionable read failure; the brand stays empty.
      })
    return () => {
      disposed = true
    }
  }, [bridge])
  return <span>{name}</span>
}

/** @param props - Host-owned icon dimensions and placement. @returns The transparent enterprise ribbon mark. */
export function EnterpriseBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <svg width={size} height={size} className={[css.mark, className].filter(Boolean).join(' ')} aria-hidden="true" />
}
