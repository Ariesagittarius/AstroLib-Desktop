import type { IContentProvider } from './types.ts';
import { WebContentProvider } from './web-provider.ts';
import { ElectronContentProvider } from './electron-provider.ts';

export * from './types.ts';
export { WebContentProvider } from './web-provider.ts';
export { ElectronContentProvider } from './electron-provider.ts';

let instance: IContentProvider | null = null;

export function getContentProvider(): IContentProvider {
  if (typeof window !== 'undefined' && (window as any).astrolib?.isElectron) {
    if (!instance || !(instance instanceof ElectronContentProvider)) {
      instance = new ElectronContentProvider();
    }
    return instance;
  }

  if (!instance) {
    instance = new WebContentProvider();
  }

  return instance;
}
