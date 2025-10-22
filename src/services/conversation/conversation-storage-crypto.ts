import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import * as vscode from 'vscode';

const SECRET_KEY_NAME = 'voicepilot.conversation.key';
const KEY_LENGTH = 32; // 256-bit AES key
const IV_LENGTH = 12; // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16;

let cachedKey: Buffer | undefined;
let inflightKeyPromise: Promise<Buffer> | undefined;

export interface EncryptionComponents {
  cipherText: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export async function loadOrCreateWorkspaceKey(
  context: vscode.ExtensionContext,
): Promise<Buffer> {
  if (cachedKey) {
    return cachedKey;
  }
  if (inflightKeyPromise) {
    return inflightKeyPromise;
  }

  inflightKeyPromise = (async () => {
    const existing = await context.secrets.get(SECRET_KEY_NAME);
    if (existing) {
      cachedKey = Buffer.from(existing, 'base64');
      return cachedKey;
    }

    const key = randomBytes(KEY_LENGTH);
    await context.secrets.store(SECRET_KEY_NAME, key.toString('base64'));
    cachedKey = key;
    return key;
  })();

  try {
    return await inflightKeyPromise;
  } finally {
    inflightKeyPromise = undefined;
  }
}

export function encryptPayload(
  key: Buffer,
  payload: Buffer | string,
): EncryptionComponents {
  const plaintext = Buffer.isBuffer(payload)
    ? Buffer.from(payload)
    : Buffer.from(payload, 'utf8');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const cipherText = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { cipherText, iv, authTag };
}

export function decryptPayload(
  key: Buffer,
  components: EncryptionComponents,
): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, components.iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(components.authTag);
  return Buffer.concat([decipher.update(components.cipherText), decipher.final()]);
}
