/**
 * electron/services/updater.ts
 * ============================================================================
 * AstroLib 桌面端自动更新检测服务 (GitHub Releases Update Checker)
 * ============================================================================
 */

import https from 'node:https';
import type { AppUpdateInfo } from '../types.ts';

export class AppUpdater {
  private static readonly GITHUB_REPO = 'Ariesagittarius/AstroLib';

  /**
   * 检查 GitHub Releases 是否有新版本
   */
  static async checkForUpdates(currentVersion: string): Promise<AppUpdateInfo> {
    return new Promise((resolve) => {
      const options: https.RequestOptions = {
        hostname: 'api.github.com',
        path: `/repos/${this.GITHUB_REPO}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': 'AstroLib-Desktop-App',
          Accept: 'application/vnd.github.v3+json',
        },
        timeout: 8000,
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              return resolve({ hasUpdate: false, currentVersion });
            }
            const data = JSON.parse(body);
            const rawTag = data.tag_name || '';
            const latestVer = rawTag.replace(/^v/, '');
            const hasUpdate = this.compareSemver(latestVer, currentVersion) > 0;

            // 查找 Windows 安装包下载链接
            let downloadUrl: string | undefined;
            if (Array.isArray(data.assets)) {
              const exeAsset = data.assets.find(
                (a: any) => typeof a.name === 'string' && a.name.endsWith('.exe')
              );
              if (exeAsset) {
                downloadUrl = exeAsset.browser_download_url;
              }
            }

            resolve({
              hasUpdate,
              currentVersion,
              latestVersion: latestVer,
              releaseName: data.name,
              releaseNotes: data.body,
              publishedAt: data.published_at,
              downloadUrl: downloadUrl || data.html_url,
              htmlUrl: data.html_url,
            });
          } catch {
            resolve({ hasUpdate: false, currentVersion });
          }
        });
      });

      req.on('error', () => {
        resolve({ hasUpdate: false, currentVersion });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ hasUpdate: false, currentVersion });
      });

      req.end();
    });
  }

  /**
   * 语义化版本号对比 (v1 > v2 返回 1, v1 < v2 返回 -1, 相等返回 0)
   */
  private static compareSemver(v1: string, v2: string): number {
    const p1 = v1.split('.').map(Number);
    const p2 = v2.split('.').map(Number);
    const len = Math.max(p1.length, p2.length);

    for (let i = 0; i < len; i++) {
      const num1 = p1[i] || 0;
      const num2 = p2[i] || 0;
      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }
    return 0;
  }
}
