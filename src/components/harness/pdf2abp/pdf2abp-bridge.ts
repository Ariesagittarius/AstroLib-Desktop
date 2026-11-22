/**
 * src/components/harness/pdf2abp/pdf2abp-bridge.ts
 * ============================================================================
 * HarnessController / PluginEnvironment 与 PDF2ABP & ArtifactHub 的桥梁
 * ============================================================================
 */

import type { PluginEnvironment } from '../../../plugins/harness/plugin-environment.ts';
import { getPdf2AbpStore, type Pdf2AbpStore } from './pdf2abp-store.ts';
import { ArtifactStore } from '../../../features/harness/artifact-store.ts';
import { renderPdf2AbpInlineCardPlaceholder } from './pdf2abp-inline-card.ts';

export interface Pdf2AbpBridgeHandle {
  getStore: () => Pdf2AbpStore;
  openJobInArtifacts: (jobId: string) => void;
  refreshJobsIntoArtifacts: () => Promise<void>;
}

export function attachPdf2AbpBridge(options: {
  pluginEnv: PluginEnvironment;
  artifactStore: ArtifactStore;
  switchToArtifacts: () => void;
  onCatalogRefresh: () => void | Promise<void>;
  onTriggerInlinePdf2Abp?: () => void;
}): Pdf2AbpBridgeHandle {
  const store = getPdf2AbpStore();

  const syncJobs = () => {
    const jobs = store.getState().jobs || [];
    for (const job of jobs) {
      options.artifactStore.syncPdf2AbpJob(job, false);
    }
  };

  store.subscribe(() => {
    syncJobs();
  });

  const openJobInArtifacts = (jobId: string) => {
    const job = store.getState().jobs.find((j) => j.jobId === jobId);
    if (job) {
      options.artifactStore.syncPdf2AbpJob(job, true);
    } else {
      options.artifactStore.upsertArtifact(
        {
          id: `pdf2abp:${jobId}`,
          kind: 'pdf2abp',
          title: `PDF2ABP 任务 ${jobId}`,
          badge: '查看详情',
          pdf2abpJobId: jobId,
          sourceCommand: '/pdf2abp',
        },
        { activate: true }
      );
    }
    void store.selectJob(jobId);
    options.switchToArtifacts();
  };

  void options.pluginEnv.registerPlugin({
    id: 'astrolib.pdf2abp',
    name: 'PDF2ABP Builder',
    version: '2.1.0',
    description: '将本地 PDF 教材或学术讲义通过 MinerU 与多智能体编译为 ABP 包。',
    sourceFile: 'src/components/harness/pdf2abp/pdf2abp-bridge.ts',
    activate(ctx) {
      ctx.registerCommand({
        command: '/pdf2abp',
        aliases: ['/convert-pdf'],
        displayName: 'PDF 教材转 ABP 编译工坊',
        description: '在对话区创建独立的 PDF2ABP 参数配置与构建进度卡片，不依赖对话上下文。',
        usage: '[pdf_path]',
        icon: { type: 'mdicon', value: 'menu_book' },
        execute: async (args) => {
          const trimmed = (args || '').trim();
          return {
            toolName: 'pdf2abp_launcher',
            command: trimmed ? `/pdf2abp ${trimmed}` : '/pdf2abp',
            success: true,
            summary: '已在对话区创建 PDF2ABP 独立配置卡片',
            cardHtml: renderPdf2AbpInlineCardPlaceholder(trimmed),
            contextText: '',
            inlineWidget: {
              type: 'pdf2abp_launcher',
              prefillPdfPath: trimmed || undefined,
            },
          };
        },
      });
    },
  });

  const attachBtn = document.getElementById('harness-btn-attach-context');
  if (attachBtn && attachBtn.dataset.boundPdf2abp !== 'true') {
    attachBtn.dataset.boundPdf2abp = 'true';
    attachBtn.addEventListener('click', () => {
      options.onTriggerInlinePdf2Abp?.();
    });
  }

  store.onJobCompleted(() => {
    void options.onCatalogRefresh();
  });

  const desktopBridge = window.astrolibDesktop || window.astrolib;
  desktopBridge?.onLibraryUpdated?.(() => {
    void options.onCatalogRefresh();
  });

  const refreshJobsIntoArtifacts = async () => {
    await store.refreshJobs();
    syncJobs();
  };

  void refreshJobsIntoArtifacts();

  return {
    getStore: () => store,
    openJobInArtifacts,
    refreshJobsIntoArtifacts,
  };
}
