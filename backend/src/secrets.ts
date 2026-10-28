/** Authenticated encryption for model credentials stored in the enterprise database. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/** Owns database encryption under a deployment secret separate from stored ciphertext. */
export class EnterpriseSecrets {
  private readonly key: Buffer
  /** @param secret - Deployment authentication secret; rotation requires re-encrypting existing records. */
  constructor(secret: string) {
    this.key = createHash('sha256').update(`dsh-enterprise-storage\0${secret}`).digest()
  }
  /** @param plaintext - Credential to store. @returns Versioned authenticated ciphertext. */
  seal(plaintext: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.')
  }
  /** @param ciphertext - Stored versioned value. @returns Decrypted credential; corruption rejects the operation. */
  open(ciphertext: string): string {
    const [version, iv, tag, encrypted, extra] = ciphertext.split('.')
    if (version !== 'v1' || !iv || !tag || !encrypted || extra !== undefined)
      throw new Error('Enterprise credential storage is invalid')
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')
  }
}
