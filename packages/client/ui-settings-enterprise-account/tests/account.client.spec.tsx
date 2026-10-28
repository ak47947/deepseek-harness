// @vitest-environment jsdom
/** Account views share registrant-owned identity while keeping local action feedback. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { allowAllAccess } from '@deepseek-ai/dsh-client-test-runtime'
import { EnterpriseAccountSection } from '../src/client/AccountSection.tsx'
import { EnterpriseBrand, EnterpriseBrandMark } from '../src/client/Brand.tsx'
import { EnterpriseAccountMenu, type EnterpriseLauncherSnapshot } from '../src/client/AccountMenu.tsx'
import { en } from '../src/client/locales.ts'
import type { DesktopEnterpriseAccountBridge, EnterpriseAccountView } from '../src/types.ts'

afterEach(cleanup)
const account: EnterpriseAccountView = {
  organization: 'Example organization',
  name: 'Alice',
  email: 'alice@example.test',
  mode: 'basic',
  expiresAt: '2026-10-28T00:00:00.000Z',
  degraded: false,
}
const unusedHook = (() => {
  throw new Error('This account component consumes no global resource hooks')
}) as never
const kit = {
  close: () => {},
  ...allowAllAccess,
  useSessions: unusedHook,
  useSessionStatus: unusedHook,
  usePanelInfo: unusedHook,
  useSessionRetainInfo: unusedHook,
  useResource: unusedHook,
  useWorkspaces: unusedHook,
}
const t: Parameters<typeof EnterpriseAccountSection>[0]['t'] = key => (en as Record<string, string>)[key] ?? key

describe('enterprise sidebar identity', () => {
  it('opens browser sign-in when the shell reports no account', async () => {
    const startSignIn = vi.fn(async () => {})
    const snapshot: EnterpriseLauncherSnapshot = { account: null, failed: false }
    render(<EnterpriseAccountMenu {...kit} wide settingsOpen={false} openSettings={() => {}} openOnboarding={() => {}}
      useAccount={selector => selector(snapshot)} startSignIn={startSignIn} signOut={async () => {}} refresh={async () => {}} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => { expect(startSignIn).toHaveBeenCalledOnce() })
  })

  it('shows the employee name and reveals the email, settings, and sign-out actions', async () => {
    const signOut = vi.fn(async () => {})
    const snapshot: EnterpriseLauncherSnapshot = { account, failed: false }
    render(<EnterpriseAccountMenu {...kit} wide settingsOpen={false} openSettings={() => {}} openOnboarding={() => {}}
      useAccount={selector => selector(snapshot)} startSignIn={async () => {}} signOut={signOut} refresh={async () => {}} t={t} />)
    expect(screen.getByText('Alice')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByText('alice@example.test')).toBeDefined()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out and switch account' }))
    await waitFor(() => { expect(signOut).toHaveBeenCalledOnce() })
  })
})

function bridge() {
  let changed = () => {}
  const off = vi.fn()
  const source: DesktopEnterpriseAccountBridge = {
    organization: vi.fn(async () => account.organization),
    status: vi.fn(async () => account),
    startSignIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    subscribe: vi.fn((listener: () => void) => {
      changed = listener
      return off
    }),
  }
  return {
    source,
    off,
    changed: () => {
      changed()
    },
  }
}

describe('enterprise account settings', () => {
  it('renders shared account updates and retains identity after failed sign-out', async () => {
    let snapshot: EnterpriseLauncherSnapshot = { account: undefined, failed: false }
    const signOut = vi.fn(async () => {})
    const props: Parameters<typeof EnterpriseAccountSection>[0] = {
      ...kit, useAccount: select => select(snapshot), refresh: async () => {}, signOut, t,
    }
    const view = render(<EnterpriseAccountSection {...props} />)
    expect(view.container.querySelector('[data-state=ongoing]')).not.toBeNull()
    snapshot = { account, failed: false }
    view.rerender(<EnterpriseAccountSection {...props} />)
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText(en.basic)).toBeTruthy()
    snapshot = { account: { ...account, mode: 'managed', degraded: true }, failed: false }
    view.rerender(<EnterpriseAccountSection {...props} />)
    expect(screen.getByText(en.degraded)).toBeTruthy()
    expect(screen.getByText(en.managed)).toBeTruthy()
    signOut.mockRejectedValueOnce(new Error('cleanup failed'))
    fireEvent.click(screen.getByRole('button', { name: en.signOut }))
    expect(await screen.findByText(en.failed)).toBeTruthy()
    expect(screen.getByText('Alice')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.signOut }))
    await waitFor(() => { expect(screen.queryByText(en.failed)).toBeNull() })
  })

  it('keeps a failed shared read visible beside retained identity and retries through its owner', async () => {
    let snapshot: EnterpriseLauncherSnapshot = { account, failed: true }
    const refresh = vi.fn(async () => {})
    const props: Parameters<typeof EnterpriseAccountSection>[0] = {
      ...kit, useAccount: select => select(snapshot), refresh, signOut: async () => {}, t,
    }
    const view = render(<EnterpriseAccountSection {...props} />)
    expect(screen.getByText(en.unavailable)).toBeTruthy()
    expect(screen.getByText('Alice')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(refresh).toHaveBeenCalledOnce()
    snapshot = { account, failed: false }
    view.rerender(<EnterpriseAccountSection {...props} />)
    expect(screen.queryByText(en.unavailable)).toBeNull()
    snapshot = { account: null, failed: false }
    view.rerender(<EnterpriseAccountSection {...props} />)
    expect(screen.getByText(en.unavailable)).toBeTruthy()
    expect(screen.queryByText('Alice')).toBeNull()
  })

  it('uses the shell organization name without a vendor mark and contains failed brand reads', async () => {
    const { source } = bridge()
    const view = render(<EnterpriseBrand bridge={source} />)
    await screen.findByText(account.organization)
    view.unmount()
    vi.mocked(source.organization).mockRejectedValueOnce(new Error('unavailable'))
    const failed = render(<EnterpriseBrand bridge={source} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(failed.container.textContent).toBe('')
    failed.unmount()
    expect(EnterpriseBrandMark()).toBeNull()
  })

  it('shows the organization before sign-in and ignores a late brand read after unmount', async () => {
    const { source } = bridge()
    vi.mocked(source.status).mockResolvedValueOnce(null)
    const absent = render(<EnterpriseBrand bridge={source} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(absent.container.textContent).toBe(account.organization)
    absent.unmount()
    let complete: (value: string) => void = () => {}
    vi.mocked(source.organization).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const view = render(<EnterpriseBrand bridge={source} />)
    view.unmount()
    await act(async () => {
      complete(account.organization)
      await Promise.resolve()
    })
  })
})
