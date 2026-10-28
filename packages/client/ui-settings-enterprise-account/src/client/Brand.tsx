/** Enterprise display name supplied by the native shell, without a default vendor mark. */
import { useEffect, useState } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopEnterpriseAccountBridge } from '../types.ts'

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

/** @returns An unoccupied mark; enterprises supply signed application artwork through release configuration. */
export function EnterpriseBrandMark() {
  return null
}
