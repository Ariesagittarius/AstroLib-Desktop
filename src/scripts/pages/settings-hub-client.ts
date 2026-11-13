/**
 * src/scripts/pages/settings-hub-client.ts
 * ============================================================================
 * Client runtime for Settings Hub: tabs, diagnostics hydration, model downloads
 * ============================================================================
 */
import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/progress/linear-progress.js';
import '@material/web/chips/chip-set.js';
import '@material/web/chips/filter-chip.js';
import '@material/web/chips/assist-chip.js';
import '@material/web/slider/slider.js';
import '@material/web/switch/switch.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/icon/icon.js';
import '@material/web/ripple/ripple.js';
import { initColorEngine } from '../../themes/material-you/color-engine';
import { initFeatureToggles } from '../feature-toggles';

export function initHubRuntime(): void {
  if (typeof window === 'undefined') return;
  if ((window as any).__astrolibHubRuntimeInitialized) return;
  (window as any).__astrolibHubRuntimeInitialized = true;

  initColorEngine();
  initFeatureToggles();

  // 1. 选项卡切换逻辑
  const navItems = document.querySelectorAll<HTMLElement>('.hub-nav-item');
  const panels = document.querySelectorAll<HTMLElement>('.hub-panel');
  const sectionHeading = document.getElementById('hub-modal-section-heading');

  const activatePanel = (targetId: string) => {
    navItems.forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-target') === targetId);
    });
    panels.forEach((p) => {
      const isActive = p.id === targetId;
      p.classList.toggle('active', isActive);
      if (isActive && sectionHeading) {
        sectionHeading.textContent = p.getAttribute('data-panel-title') || '';
      }
    });
    const ws = document.getElementById('hub-workspace');
    if (ws) ws.scrollTop = 0;
  };

  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      if (targetId) activatePanel(targetId);
    });
  });

  window.addEventListener('astrolib:hub-select-panel', ((e: CustomEvent<{ panel?: string; section?: string }>) => {
    const targetPanel = e?.detail?.panel;
    if (targetPanel) activatePanel(targetPanel);
    if (e?.detail?.section === 'ai') {
      const aiSec = document.querySelector('#panel-reading .ft-section:has(.ft-ai-block)') as HTMLElement | null;
      if (aiSec) {
        setTimeout(() => {
          aiSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
          const adv = aiSec.querySelector<HTMLDetailsElement>('[data-ai-advanced-details]');
          if (adv) adv.open = true;
        }, 80);
      }
    }
  }) as EventListener);

  // 2. 桌面环境探测与模型状态水合
  const isElectron = Boolean((window as any).astrolib?.isElectron);
  const envBadge = document.getElementById('env-badge');
  const envText = document.getElementById('env-text');
  const webBanner = document.getElementById('web-banner');

  if (!isElectron) {
    if (envBadge) envBadge.classList.add('hub-env-pill--warn');
    if (envText) envText.textContent = 'Web 预览模式 (功能受限)';
    if (webBanner) webBanner.classList.add('active');
  } else {
    if (envBadge) envBadge.classList.add('hub-env-pill--ok');
    if (envText) envText.textContent = 'AstroLib 桌面运行时';
  }

  // 3. 模态框关闭按键逻辑
  document.getElementById('hub-overlay-close-btn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('astrolib:close-settings-hub'));
  });

  // 4. 端侧诊断数据刷新
  const refreshDiagnostics = async () => {
    if (!isElectron) return;
    try {
      const d = await (window as any).astrolib?.getDiagnostics?.();
      if (!d) return;

      const setVal = (id: string, text: string) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };

      setVal('diag-os', `${d.osType || ''} ${d.osRelease || ''} (${d.arch || ''})`);
      setVal('diag-electron', d.electronVersion ? `v${d.electronVersion}` : '—');
      setVal('diag-node', d.nodeVersion ? `v${d.nodeVersion}` : '—');
      setVal('diag-chrome', d.chromeVersion ? `v${d.chromeVersion}` : '—');
      setVal('diag-cpu', d.cpuModel ? `${d.cpuModel} (${d.cpuCores} 核)` : '—');
      setVal('diag-mem', d.totalMemoryGB ? `${d.freeMemoryGB} GB 可用 / 共 ${d.totalMemoryGB} GB` : '—');
      setVal('diag-appdir', d.userDataPath || '—');

      const gpuEl = document.getElementById('diag-gpu');
      const cudaEl = document.getElementById('diag-cuda');
      const dmlEl = document.getElementById('diag-dml');
      const torchEl = document.getElementById('diag-torch');

      if (gpuEl) {
        if (d.hasNvidiaGpu) {
          const vramText = d.gpuVramMB ? ` · ${Math.round(d.gpuVramMB / 1024)}GB VRAM` : '';
          gpuEl.textContent = `${d.gpuName}${vramText}`;
        } else {
          gpuEl.textContent = '未检出 NVIDIA 独立显卡';
        }
      }

      if (cudaEl) {
        cudaEl.textContent = d.hasCuda ? `就绪 (${d.cudaDeviceName || 'CUDA 硬件加速就绪'})` : '未检测到 CUDA / 无独立显卡';
      }
      if (dmlEl) {
        dmlEl.textContent = d.hasDirectML ? '支持 (DirectX 12 DirectML)' : '不支持';
      }
      if (torchEl) {
        torchEl.textContent = d.hasTorch ? `PyTorch 就绪${d.hasHfTransformers ? ' + Transformers' : ''}` : '未安装 PyTorch';
      }
    } catch (e) {
      console.warn('[SettingsHub] 获取诊断信息失败:', e);
    }
  };

  refreshDiagnostics();

  // 5. 模型状态轮询
  const refreshModels = async () => {
    if (!isElectron) return;
    try {
      const models = await (window as any).astrolib?.getLocalModels?.();
      if (!models) return;

      const updateCard = (prefix: string, m: any) => {
        const badge = document.getElementById(`${prefix}-badge`);
        const pathEl = document.getElementById(`${prefix}-path`);
        const dlBtn = document.getElementById(`btn-download-${prefix}`);
        const cancelBtn = document.getElementById(`btn-cancel-${prefix}`);
        const prog = document.getElementById(`${prefix}-progress`) as any;

        if (m.installed) {
          if (badge) {
            badge.textContent = '已就绪 (本地模型)';
            badge.className = 'model-status-badge model-status-badge--installed';
          }
          if (pathEl) pathEl.textContent = m.path || 'userData/models';
          if (dlBtn) dlBtn.style.display = 'none';
          if (cancelBtn) cancelBtn.style.display = 'none';
          if (prog) prog.style.display = 'none';
        } else if (m.downloading) {
          if (badge) {
            badge.textContent = `下载中 ${m.progress || 0}%`;
            badge.className = 'model-status-badge model-status-badge--downloading';
          }
          if (dlBtn) dlBtn.style.display = 'none';
          if (cancelBtn) cancelBtn.style.display = 'inline-block';
          if (prog) {
            prog.style.display = 'block';
            prog.value = (m.progress || 0) / 100;
          }
        } else {
          if (badge) {
            badge.textContent = '未下载';
            badge.className = 'model-status-badge model-status-badge--missing';
          }
          if (pathEl) pathEl.textContent = '未安装到本地缓存';
          if (dlBtn) dlBtn.style.display = 'inline-block';
          if (cancelBtn) cancelBtn.style.display = 'none';
          if (prog) prog.style.display = 'none';
        }
      };

      if (models['minilm-l12']) updateCard('minilm', models['minilm-l12']);
      if (models['qwen3-embedding']) updateCard('qwen', models['qwen3-embedding']);
    } catch (e) {
      console.warn('[SettingsHub] 获取模型状态失败:', e);
    }
  };

  refreshModels();

  window.addEventListener('astrolib:model-download-progress', ((e: CustomEvent<any>) => {
    const { modelId, progress } = e.detail || {};
    const prefix = modelId === 'minilm-l12' ? 'minilm' : modelId === 'qwen3-embedding' ? 'qwen' : null;
    if (!prefix) return;

    const badge = document.getElementById(`${prefix}-badge`);
    const prog = document.getElementById(`${prefix}-progress`) as any;
    if (badge) {
      badge.textContent = `下载中 ${progress}%`;
      badge.className = 'model-status-badge model-status-badge--downloading';
    }
    if (prog) {
      prog.style.display = 'block';
      prog.value = progress / 100;
    }
  }) as EventListener);

  window.addEventListener('astrolib:model-download-finished', ((e: CustomEvent<any>) => {
    refreshModels();
  }) as EventListener);

  document.getElementById('btn-download-minilm')?.addEventListener('click', async () => {
    await (window as any).astrolib?.startModelDownload?.('minilm-l12');
  });
  document.getElementById('btn-cancel-minilm')?.addEventListener('click', async () => {
    await (window as any).astrolib?.cancelModelDownload?.('minilm-l12');
  });
  document.getElementById('btn-recheck-minilm')?.addEventListener('click', () => refreshModels());

  document.getElementById('btn-download-qwen')?.addEventListener('click', async () => {
    await (window as any).astrolib?.startModelDownload?.('qwen3-embedding');
  });
  document.getElementById('btn-cancel-qwen')?.addEventListener('click', async () => {
    await (window as any).astrolib?.cancelModelDownload?.('qwen3-embedding');
  });
  document.getElementById('btn-recheck-qwen')?.addEventListener('click', () => refreshModels());
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHubRuntime);
  } else {
    initHubRuntime();
  }
}
