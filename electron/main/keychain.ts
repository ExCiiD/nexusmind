import { safeStorage } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

const KEYCHAIN_DIR = 'keychain'

function getKeychainPath(service: string): string {
  const dir = join(app.getPath('userData'), KEYCHAIN_DIR)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return join(dir, `${service}.enc`)
}

export function saveSecret(service: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system')
  }
  const encrypted = safeStorage.encryptString(value)
  writeFileSync(getKeychainPath(service), encrypted)
}

export function getSecret(service: string): string | null {
  const path = getKeychainPath(service)
  if (!existsSync(path)) return null

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system')
  }

  const encrypted = readFileSync(path)
  return safeStorage.decryptString(encrypted)
}

export function hasSecret(service: string): boolean {
  return existsSync(getKeychainPath(service))
}
