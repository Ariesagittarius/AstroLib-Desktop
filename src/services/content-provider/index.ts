/**
 * src/services/content-provider/index.ts
 * ============================================================================
 * AstroLib 内容提供者统一接入点与单例工厂 (Content Provider Factory)
 * ============================================================================
 */

import type { IContentProvider } from './types.ts';
import { WebContentProvider } from './web-provider.ts';
import { ElectronContentProvider } from './electron-provider.ts';

export * from './types.ts';
export { WebContentProvider } from './web-provider.ts';
export { ElectronContentProvider } from './electron-provider.ts';

let instance: IContentProvider | null = null;

/**
 * 获取当前运行环境适配的 ContentProvider 单例
 */
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
