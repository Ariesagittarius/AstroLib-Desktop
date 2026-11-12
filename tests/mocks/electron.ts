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

export default { app };
