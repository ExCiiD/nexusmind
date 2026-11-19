import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * R1 (CyberSecurity review of #2, 19/11/2026): a sign-out whose session file
 * could not be deleted must survive a restart, instead of signing the user
 * back in at the next launch.
 */

const userData = mkdtempSync(join(tmpdir(), 'nxm-auth-'))
const files = new Map<string, string>()
let locked = false

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('../../electron/main/keychain', () => ({
  getSecret: (s: string) => files.get(s) ?? null,
  saveSecret: (s: string, v: string) => { if (locked) throw new Error('EBUSY'); files.set(s, v) },
  deleteSecret: (s: string) => { if (locked) throw new Error('EPERM'); files.delete(s) },
}))

const KEY = 'sb-abc-auth-token'
const marker = join(userData, 'signout-pending.json')

async function freshModule() {
  vi.resetModules()
  return import('../../electron/main/cloud/supabase')
}

beforeEach(() => { files.clear(); locked = false })

describe('desktop session storage', () => {
  it('a sign-out on a locked file is remembered on disk and the old session stays hidden', async () => {
    const m = await freshModule()
    m.keychainStorageForTests.setItem(KEY, 'old-session')
    locked = true
    m.keychainStorageForTests.removeItem(KEY)
    expect(m.keychainStorageForTests.getItem(KEY)).toBeNull()
    expect(JSON.parse(readFileSync(marker, 'utf-8'))).toEqual([KEY])

    // "Next launch": new module, the file is still locked.
    const next = await freshModule()
    next.retryPendingSecretDeletes()
    expect(next.keychainStorageForTests.getItem(KEY)).toBeNull()
    expect(files.has(`supabase-${KEY}`)).toBe(true)

    // The lock is gone at quit: the file and the marker are deleted.
    locked = false
    next.retryPendingSecretDeletes()
    expect(files.has(`supabase-${KEY}`)).toBe(false)
    expect(existsSync(marker)).toBe(false)
  })

  it('a new sign-in clears the pending deletion, so the new session is not deleted later', async () => {
    const m = await freshModule()
    m.keychainStorageForTests.setItem(KEY, 'old-session')
    locked = true
    m.keychainStorageForTests.removeItem(KEY)
    locked = false
    m.keychainStorageForTests.setItem(KEY, 'new-session')
    expect(existsSync(marker)).toBe(false)

    const next = await freshModule()
    next.retryPendingSecretDeletes()
    expect(next.keychainStorageForTests.getItem(KEY)).toBe('new-session')
  })
})
