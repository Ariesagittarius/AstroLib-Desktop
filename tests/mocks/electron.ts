import os from 'node:os';
import path from 'node:path';

const baseTmp = path.join(os.tmpdir(), 'astrolib-vitest-electron');

export const app = {
  isPackaged: false,
  name: 'AstroLib',
  getPath(name: string): string {
    return path.join(baseTmp, name);
  },
  getAppPath(): string {
    return process.cwd();
  },
};

export const safeStorage = {
  isEncryptionAvailable(): boolean {
    return true;
  },
  encryptString(plainText: string): Buffer {
    return Buffer.from(`mock-enc:${plainText}`, 'utf8');
  },
  decryptString(encrypted: Buffer): string {
    const raw = encrypted.toString('utf8');
    if (raw.startsWith('mock-enc:')) {
      return raw.slice('mock-enc:'.length);
    }
    return raw;
  },
};

export default { app, safeStorage };
