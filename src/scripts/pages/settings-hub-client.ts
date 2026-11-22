/**
 * src/scripts/pages/settings-hub-client.ts
 * ============================================================================
 * Client runtime for Settings Hub: tabs, diagnostics hydration, model downloads
 * ============================================================================
 */
import '@material/web/button/filled-button.js';
import '@material/web/button/filled-tonal-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
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
import '@m3e/web/segmented-button';
import { initColorEngine } from '../../themes/material-you/color-engine';
import { initFeatureToggles } from '../feature-toggles';
import { focusMineruTokenSection, initIngestSettingsPanel } from './settings-ingest-client';
import { initAgentSettingsPanel } from './settings-agent-client';
import {
  normalizeClosePolicy,
  SPLIT_CLOSE_POLICY_STORAGE_KEY,
  type SplitClosePolicy,
} from '../../features/reader-host/workspace-state';
import {
  loadFormatDefaults,
  resetFormatDefaults,
  saveDefaultReadingLayout,
  saveFormatDefaults,
  type FormatDefaultKey,
} from '../../features/reader-layout/prefs';
import type { CjkFont, LatinFont } from '../font-presets';
import type { PunctStyle } from '../settings/typography-prefs';
import type { ReadingLayoutMode, ReadingProfile } from '../../types/content-package';

function notifySnackbar(message: string, durationMs = 3000): void {
  window.dispatchEvent(new CustomEvent('astrolib:show-snackbar', { detail: { message, durationMs } }));
}

export function initHubRuntime(): void {
  if (typeof window === 'undefined') return;
  if ((window as any).__astrolibHubRuntimeInitialized) return;
  (window as any).__astrolibHubRuntimeInitialized = true;

  initColorEngine();
  initFeatureToggles();

  let diagnosticsLoaded = false;
  let modelsLoaded = false;

  // 1. 选项卡切换逻辑
  const navItems = document.querySelectorAll<HTMLElement>('.hub-nav-item');
  const panels = document.querySelectorAll<HTMLElement>('.hub-panel');
  const sectionHeading = document.getElementById('hub-modal-section-heading');

  const triggerLazyPanelRefresh = (targetId: string, force = false) => {
    if (targetId === 'panel-diagnostics' && (!diagnosticsLoaded || force)) {
      void refreshDiagnostics();
    } else if (targetId === 'panel-models') {
      if (!modelsLoaded || force) {
        void refreshModels();
      }
      void refreshRuntimeModels();
    }
  };

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
    triggerLazyPanelRefresh(targetId);
  };

  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      if (targetId) activatePanel(targetId);
    });
  });

  // 初始化「Agent 与工具」设置面板
  const agentPanelCtrl = initAgentSettingsPanel();

  window.addEventListener('astrolib:hub-select-panel', ((e: CustomEvent<{ panel?: string; section?: string }>) => {
    const targetPanel = e?.detail?.panel;
    if (targetPanel) activatePanel(targetPanel);
    if (targetPanel === 'panel-agent') {
      const sec = e?.detail?.section;
      if (sec === 'tools' || sec === 'models' || sec === 'presets') {
        agentPanelCtrl.switchSubtab(sec);
      }
      return;
    }
    if (e?.detail?.section === 'ai') {
      const aiSec = document.querySelector('#panel-reading .ft-section:has(.ft-ai-block)') as HTMLElement | null;
      if (aiSec) {
        setTimeout(() => {
          aiSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
          const adv = aiSec.querySelector<HTMLDetailsElement>('[data-ai-advanced-details]');
          if (adv) adv.open = true;
        }, 80);
      }
    } else if (e?.detail?.section === 'token') {
      activatePanel('panel-ingest');
      focusMineruTokenSection();
    }
  }) as EventListener);

  // 初始化「文献解析与研读」设置面板
  initIngestSettingsPanel((panelId, scrollSelector) => {
    activatePanel(panelId);
    if (scrollSelector) {
      setTimeout(() => {
        document.querySelector(scrollSelector)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    }
  });

  // 初始化「多窗口与分屏关闭行为」单选 Chips
  const splitPolicySet = document.getElementById('hub-split-close-policy-chips');
  if (splitPolicySet) {
    const getPolicy = (): SplitClosePolicy => {
      try {
        return normalizeClosePolicy(localStorage.getItem(SPLIT_CLOSE_POLICY_STORAGE_KEY));
      } catch {
        return 'backfill';
      }
    };
    const syncSplitPolicyChips = () => {
      const curr = getPolicy();
      splitPolicySet.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
        chip.selected = chip.getAttribute('data-split-policy') === curr;
      });
    };
    syncSplitPolicyChips();
    splitPolicySet.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
      chip.addEventListener('click', (ev: Event) => {
        const val = chip.getAttribute('data-split-policy') as SplitClosePolicy | null;
        if (!val) return;
        if (val === getPolicy()) {
          ev.preventDefault();
          syncSplitPolicyChips();
          return;
        }
        ev.stopPropagation();
        try {
          localStorage.setItem(SPLIT_CLOSE_POLICY_STORAGE_KEY, val);
        } catch {}
        syncSplitPolicyChips();
        window.dispatchEvent(new CustomEvent('astrolib:settings-changed'));
      });
    });
    if (typeof customElements !== 'undefined' && customElements.whenDefined) {
      customElements.whenDefined('md-filter-chip').then(syncSplitPolicyChips).catch(() => {});
    }
  }

  // 初始化「按格式默认排版配置」面板（ABP 学术教材 / EPUB 电子书各自独立默认值）
  const formatTabs = document.getElementById('hub-format-defaults-tabs');
  if (formatTabs) {
    let activeFormat: FormatDefaultKey = 'abp';

    const sizeSlider = document.getElementById('hub-format-font-size-slider') as any;
    const sizeChip = document.getElementById('hub-format-font-size-val') as any;
    const latinSet = document.getElementById('hub-format-latin-chips');
    const cjkSet = document.getElementById('hub-format-cjk-chips');
    const indentSwitch = document.getElementById('hub-format-indent-switch') as any;
    const profileSet = document.getElementById('hub-format-profile-chips');
    const punctSet = document.getElementById('hub-format-punct-chips');
    const layoutSet = document.getElementById('hub-format-layout-chips');
    const resetBtn = document.getElementById('hub-format-defaults-reset');

    const emitFormatChanged = () => {
      window.dispatchEvent(
        new CustomEvent('astrolib:format-defaults-changed', { detail: { format: activeFormat } })
      );
      window.dispatchEvent(new CustomEvent('astrolib:settings-changed'));
    };

    const syncFormatUi = () => {
      const def = loadFormatDefaults(activeFormat);
      formatTabs.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
        chip.selected = chip.getAttribute('data-format-tab') === activeFormat;
      });
      const ptText = `${def.fontSize}px (${parseFloat((def.fontSize * 0.75).toFixed(2))} pt)`;
      if (sizeSlider) {
        sizeSlider.value = def.fontSize;
        sizeSlider.valueLabel = ptText;
      }
      if (sizeChip) {
        sizeChip.label = ptText;
        sizeChip.setAttribute('label', ptText);
      }
      latinSet?.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
        chip.selected = chip.getAttribute('data-format-latin') === def.latin;
      });
      cjkSet?.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
        chip.selected = chip.getAttribute('data-format-cjk') === def.cjk;
      });
      if (indentSwitch) {
        indentSwitch.selected = def.paragraphIndent;
      }
      profileSet?.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
        chip.selected = chip.getAttribute('data-format-profile') === def.readingProfile;
      });
      punctSet?.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
        chip.selected = chip.getAttribute('data-format-punct') === def.punctStyle;
      });
      layoutSet?.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
        chip.selected = chip.getAttribute('data-format-layout') === def.layoutMode;
      });
    };

    syncFormatUi();

    formatTabs.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
      chip.addEventListener('click', (ev: Event) => {
        const val = chip.getAttribute('data-format-tab') as FormatDefaultKey | null;
        if (!val) return;
        if (val === activeFormat) {
          ev.preventDefault();
          syncFormatUi();
          return;
        }
        ev.stopPropagation();
        activeFormat = val;
        syncFormatUi();
      });
    });

    sizeSlider?.addEventListener('input', () => {
      const nextSize = Number(sizeSlider.value);
      if (!Number.isFinite(nextSize)) return;
      const saved = saveFormatDefaults(activeFormat, { fontSize: nextSize });
      const ptText = `${saved.fontSize}px (${parseFloat((saved.fontSize * 0.75).toFixed(2))} pt)`;
      if (sizeChip) {
        sizeChip.label = ptText;
        sizeChip.setAttribute('label', ptText);
      }
      emitFormatChanged();
    });

    latinSet?.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
      chip.addEventListener('click', (ev: Event) => {
        const val = chip.getAttribute('data-format-latin') as LatinFont | null;
        if (!val) return;
        if (val === loadFormatDefaults(activeFormat).latin) {
          ev.preventDefault();
          syncFormatUi();
          return;
        }
        ev.stopPropagation();
        saveFormatDefaults(activeFormat, { latin: val });
        syncFormatUi();
        emitFormatChanged();
      });
    });

    cjkSet?.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
      chip.addEventListener('click', (ev: Event) => {
        const val = chip.getAttribute('data-format-cjk') as CjkFont | null;
        if (!val) return;
        if (val === loadFormatDefaults(activeFormat).cjk) {
          ev.preventDefault();
          syncFormatUi();
          return;
        }
        ev.stopPropagation();
        saveFormatDefaults(activeFormat, { cjk: val });
        syncFormatUi();
        emitFormatChanged();
      });
    });

    indentSwitch?.addEventListener('change', () => {
      saveFormatDefaults(activeFormat, { paragraphIndent: Boolean(indentSwitch.selected) });
      emitFormatChanged();
    });

    profileSet?.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
      chip.addEventListener('click', (ev: Event) => {
        const val = chip.getAttribute('data-format-profile') as ReadingProfile | null;
        if (!val) return;
        if (val === loadFormatDefaults(activeFormat).readingProfile) {
          ev.preventDefault();
          syncFormatUi();
          return;
        }
        ev.stopPropagation();
        saveFormatDefaults(activeFormat, { readingProfile: val });
        syncFormatUi();
        emitFormatChanged();
      });
    });

    punctSet?.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
      chip.addEventListener('click', (ev: Event) => {
        const val = chip.getAttribute('data-format-punct') as PunctStyle | null;
        if (!val) return;
        if (val === loadFormatDefaults(activeFormat).punctStyle) {
          ev.preventDefault();
          syncFormatUi();
          return;
        }
        ev.stopPropagation();
        saveFormatDefaults(activeFormat, { punctStyle: val });
        syncFormatUi();
        emitFormatChanged();
      });
    });

    layoutSet?.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
      chip.addEventListener('click', (ev: Event) => {
        const val = chip.getAttribute('data-format-layout') as ReadingLayoutMode | null;
        if (!val) return;
        if (val === loadFormatDefaults(activeFormat).layoutMode) {
          ev.preventDefault();
          syncFormatUi();
          return;
        }
        ev.stopPropagation();
        saveFormatDefaults(activeFormat, { layoutMode: val });
        if (activeFormat === 'abp') {
          saveDefaultReadingLayout(val);
        }
        syncFormatUi();
        emitFormatChanged();
      });
    });

    resetBtn?.addEventListener('click', () => {
      resetFormatDefaults(activeFormat);
      syncFormatUi();
      emitFormatChanged();
      notifySnackbar(`已恢复 ${activeFormat === 'epub' ? 'EPUB 电子书' : 'ABP 学术教材'} 格式默认配置`);
    });

    if (typeof customElements !== 'undefined' && customElements.whenDefined) {
      customElements.whenDefined('md-filter-chip').then(syncFormatUi).catch(() => {});
    }
  }

  window.addEventListener('astrolib:settings-hub-opened', ((e: CustomEvent<{ panelId?: string }>) => {
    const activePanel = e?.detail?.panelId || document.querySelector<HTMLElement>('.hub-panel.active')?.id;
    if (activePanel) {
      triggerLazyPanelRefresh(activePanel);
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

  const renderDiagnosticsPayload = (d: any) => {
    if (!d) return;
    const setVal = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    const freeGB = d.freeMemMB ? (d.freeMemMB / 1024).toFixed(1) : '—';
    const totalGB = d.totalMemMB ? (d.totalMemMB / 1024).toFixed(1) : '—';

    setVal('diag-os', `${d.platform || ''} ${d.osRelease || ''} (${d.arch || ''})`.trim());
    setVal('diag-cpu', d.cpuModel ? `${d.cpuModel} (${d.cpuCores} 核)` : '—');
    setVal('diag-ram', d.totalMemMB ? `${freeGB} GB 可用 / 共 ${totalGB} GB` : '—');
    setVal('diag-disk', typeof d.diskFreeGB === 'number' ? `${d.diskFreeGB} GB 可用` : '—');
    setVal('diag-python', d.pythonPath ? `${d.pythonPath}${d.pythonVersion ? ` (${d.pythonVersion})` : ''}` : '未配置 Python 解释器');
    setVal('diag-hf', d.huggingFaceCacheDir || d.modelsDir || '—');

    const gpuEl = document.getElementById('diag-gpu');
    const cudaEl = document.getElementById('diag-cuda');
    const dmlEl = document.getElementById('diag-dml');
    const torchEl = document.getElementById('diag-torch');

    if (gpuEl) {
      if (d.gpuName) {
        const vramText = d.gpuVramMB ? ` · ${Math.round((d.gpuVramMB / 1024) * 10) / 10} GB VRAM` : '';
        gpuEl.textContent = `${d.gpuName}${vramText}`;
      } else {
        gpuEl.textContent = d.gpuRenderer || '未检出独立显卡';
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
  };

  // 4. 端侧诊断数据延迟刷新（仅打开面板或主动重新检测时触发）
  const refreshDiagnostics = async () => {
    if (!isElectron) return;
    diagnosticsLoaded = true;
    try {
      const bridge = (window as any).astrolib;
      const d = await (bridge?.getEnvDiagnostics?.() || bridge?.getDiagnostics?.());
      renderDiagnosticsPayload(d);
    } catch (e) {
      diagnosticsLoaded = false;
      console.warn('[SettingsHub] 获取诊断信息失败:', e);
    }
  };

  document.getElementById('btn-recheck-env')?.addEventListener('click', () => {
    void refreshDiagnostics();
  });

  document.getElementById('btn-select-python')?.addEventListener('click', async () => {
    const bridge = (window as any).astrolib;
    if (!bridge?.selectPythonPath || !bridge?.setCustomPythonPath) return;
    try {
      const customPath = await bridge.selectPythonPath();
      if (!customPath) return;
      const diag = await bridge.setCustomPythonPath(customPath);
      diagnosticsLoaded = true;
      renderDiagnosticsPayload(diag);
      notifySnackbar('已更新自定义 Python 解释器路径');
    } catch (e) {
      console.warn('[SettingsHub] 设置自定义 Python 路径失败:', e);
    }
  });

  document.getElementById('btn-check-updates')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('diag-update-status');
    const bridge = (window as any).astrolib;
    if (!bridge?.checkForUpdates) {
      if (statusEl) statusEl.textContent = 'Web 预览模式不支持自动更新检测';
      return;
    }
    if (statusEl) statusEl.textContent = '正在检查 GitHub Releases 更新...';
    try {
      const info = await bridge.checkForUpdates();
      if (info?.hasUpdate && info.latestVersion) {
        if (statusEl) statusEl.textContent = `发现新版本 v${info.latestVersion} (当前 v${info.currentVersion})`;
        notifySnackbar(`发现新版本 v${info.latestVersion}，可在官方 Releases 下载更新`);
      } else {
        if (statusEl) statusEl.textContent = `已是最新版本 (v${info?.currentVersion || '0.0.4'})`;
      }
    } catch {
      if (statusEl) statusEl.textContent = '检查更新失败（请确认网络连接）';
    }
  });

  // 5. 本地模型安装态与显存驻留生命周期控制
  const updateModelCard = (prefix: string, m: any) => {
    const badge = document.getElementById(`badge-${prefix}`);
    const statusText = badge?.querySelector<HTMLElement>('.status-text');
    const dlBtn = document.getElementById(`btn-download-${prefix}`);
    const cancelBtn = document.getElementById(`btn-cancel-${prefix}`);
    const progBox = document.getElementById(`progress-box-${prefix}`);
    const progBar = document.getElementById(`progress-bar-${prefix}`) as any;

    if (!m) return;
    if (m.status === 'ready') {
      if (badge) badge.className = 'status-indicator ready';
      if (statusText) statusText.textContent = '已就绪 (本地缓存)';
      if (dlBtn) dlBtn.style.display = 'none';
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (progBox) progBox.style.display = 'none';
    } else if (m.status === 'downloading') {
      if (badge) badge.className = 'status-indicator warning';
      if (statusText) statusText.textContent = '下载中...';
      if (dlBtn) dlBtn.style.display = 'none';
      if (cancelBtn) cancelBtn.style.display = 'inline-flex';
      if (progBox) progBox.style.display = 'block';
    } else if (m.status === 'needs_python') {
      if (badge) badge.className = 'status-indicator warning';
      if (statusText) statusText.textContent = '缺少 Python/PyTorch';
      if (dlBtn) dlBtn.style.display = 'inline-flex';
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (progBox) progBox.style.display = 'none';
    } else {
      if (badge) badge.className = 'status-indicator';
      if (statusText) statusText.textContent = '未下载';
      if (dlBtn) dlBtn.style.display = 'inline-flex';
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (progBox) progBox.style.display = 'none';
      if (progBar) progBar.value = 0;
    }
  };

  const refreshModels = async () => {
    if (!isElectron) return;
    modelsLoaded = true;
    try {
      const bridge = (window as any).astrolib;
      const list = await (bridge?.getAvailableModels?.() || bridge?.getLocalModels?.());
      if (!list) return;
      const items = Array.isArray(list) ? list : Object.values(list);
      const minilm = items.find((m: any) => m.id === 'minilm-l12') || (list as any)['minilm-l12'];
      const qwen = items.find((m: any) => m.id === 'qwen3-embedding') || (list as any)['qwen3-embedding'];
      const qwenBase = items.find((m: any) => m.id === 'qwen3-base') || (list as any)['qwen3-base'];
      if (minilm) updateModelCard('minilm', minilm);
      if (qwen) updateModelCard('qwen', qwen);
      if (qwenBase) updateModelCard('qwen-base', qwenBase);
    } catch (e) {
      modelsLoaded = false;
      console.warn('[SettingsHub] 获取模型状态失败:', e);
    }
  };

  const syncTtlChipsSelection = (ttlMs: number) => {
    const chips = document.querySelectorAll<any>('#model-idle-ttl-chips md-filter-chip');
    chips.forEach((chip) => {
      const val = Number(chip.getAttribute('data-ttl-ms'));
      chip.selected = val === ttlMs;
    });
  };

  const refreshRuntimeModels = async () => {
    const summaryEl = document.getElementById('model-runtime-status-summary');
    const unloadBtn = document.getElementById('btn-unload-local-models') as HTMLButtonElement | null;
    try {
      let idleTimeoutMs = 300000;
      let runtimeModels: any[] = [];

      const bridge = (window as any).astrolib;
      if (bridge?.getRuntimeModelStatus) {
        const res = await bridge.getRuntimeModelStatus();
        if (res) {
          idleTimeoutMs = typeof res.idleTimeoutMs === 'number' ? res.idleTimeoutMs : 300000;
          runtimeModels = Array.isArray(res.models) ? res.models : [];
        }
      } else {
        const [hlRes, biRes] = await Promise.all([
          fetch('/__info_highlight__/status').then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch('/__bilingual__/health').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        if (hlRes?.runtime) runtimeModels.push(hlRes.runtime);
        if (Array.isArray(biRes?.runtime)) runtimeModels.push(...biRes.runtime);
        if (runtimeModels[0] && typeof runtimeModels[0].idleTimeoutMs === 'number') {
          idleTimeoutMs = runtimeModels[0].idleTimeoutMs;
        }
      }

      syncTtlChipsSelection(idleTimeoutMs);
      const loadedModels = runtimeModels.filter((m) => m && (m.loaded || m.initializing));
      if (summaryEl) {
        if (loadedModels.length === 0) {
          summaryEl.textContent = '当前显存/内存驻留：全部未加载（0 MB）';
        } else {
          const totalVram = loadedModels.reduce((sum, m) => sum + (Number(m.vramMB) || 0), 0);
          const desc = loadedModels
            .map((m) => `${m.name} (${m.initializing ? '载入中' : m.device}${m.vramMB ? ` · ${m.vramMB} MB` : ''})`)
            .join('；');
          summaryEl.textContent = `当前驻留：${desc}${totalVram > 0 ? `（合计约 ${totalVram} MB 显存）` : ''}`;
        }
      }
      if (unloadBtn) {
        unloadBtn.disabled = loadedModels.length === 0;
      }
    } catch (e) {
      console.warn('[SettingsHub] 获取运行中模型状态失败:', e);
    }
  };

  document.getElementById('model-idle-ttl-chips')?.addEventListener('click', async (e) => {
    const chip = (e.target as HTMLElement | null)?.closest('md-filter-chip') as any;
    if (!chip) return;
    const ttlMs = Number(chip.getAttribute('data-ttl-ms'));
    if (!Number.isFinite(ttlMs) || ttlMs < 0) return;

    syncTtlChipsSelection(ttlMs);
    const bridge = (window as any).astrolib;
    if (bridge?.setModelIdleTimeout) {
      await bridge.setModelIdleTimeout(ttlMs);
    } else if (bridge?.saveSetting) {
      await bridge.saveSetting('astrolib_local_model_idle_ttl_ms', String(ttlMs));
    } else {
      try { localStorage.setItem('astrolib_local_model_idle_ttl_ms', String(ttlMs)); } catch {}
    }
    notifySnackbar(ttlMs === 0 ? '已设为模型常驻至退出' : `已设置闲置 ${Math.round(ttlMs / 60000)} 分钟后自动释放显存`);
  });

  document.getElementById('btn-unload-local-models')?.addEventListener('click', async () => {
    const bridge = (window as any).astrolib;
    try {
      if (bridge?.unloadLocalModels) {
        await bridge.unloadLocalModels('all');
      } else {
        await Promise.all([
          fetch('/__info_highlight__/unload', { method: 'POST' }).catch(() => {}),
          fetch('/__bilingual__/unload', { method: 'POST' }).catch(() => {}),
        ]);
      }
      await refreshRuntimeModels();
      notifySnackbar('已释放全部驻留中的本地模型显存与内存');
    } catch (err) {
      console.warn('[SettingsHub] 释放本地模型失败:', err);
    }
  });

  document.getElementById('btn-refresh-model-runtime')?.addEventListener('click', () => {
    void refreshRuntimeModels();
  });

  (window as any).astrolib?.onModelProgress?.((data: any) => {
    const { modelId, percentage, receivedBytes, totalBytes, speedBytesPerSec, status } = data || {};
    const prefix =
      modelId === 'minilm-l12'
        ? 'minilm'
        : modelId === 'qwen3-embedding'
          ? 'qwen'
          : modelId === 'qwen3-base'
            ? 'qwen-base'
            : null;
    if (!prefix) return;

    const badge = document.getElementById(`badge-${prefix}`);
    const statusText = badge?.querySelector<HTMLElement>('.status-text');
    const progBox = document.getElementById(`progress-box-${prefix}`);
    const progBar = document.getElementById(`progress-bar-${prefix}`) as any;
    const progText = document.getElementById(`progress-text-${prefix}`);
    const progMeta = document.getElementById(`progress-meta-${prefix}`);

    if (status === 'completed' || status === 'cancelled' || status === 'error') {
      void refreshModels();
      return;
    }

    if (badge) badge.className = 'status-indicator warning';
    if (statusText) statusText.textContent = `下载中 ${Math.round(percentage || 0)}%`;
    if (progBox) progBox.style.display = 'block';
    if (progBar) progBar.value = Math.max(0, Math.min(1, (percentage || 0) / 100));
    if (progText) progText.textContent = status === 'verifying' ? '正在校验模型权重...' : '正在高速下载权重文件...';
    if (progMeta) {
      const mbDone = receivedBytes ? (receivedBytes / 1048576).toFixed(1) : '0.0';
      const mbTotal = totalBytes ? (totalBytes / 1048576).toFixed(1) : '?';
      const speedKb = speedBytesPerSec ? Math.round(speedBytesPerSec / 1024) : 0;
      progMeta.textContent = `${Math.round(percentage || 0)}% · ${mbDone}/${mbTotal} MB · ${speedKb} KB/s`;
    }
  });

  document.getElementById('btn-download-minilm')?.addEventListener('click', async () => {
    await (window as any).astrolib?.startModelDownload?.('minilm-l12');
  });
  document.getElementById('btn-cancel-minilm')?.addEventListener('click', async () => {
    await (window as any).astrolib?.cancelModelDownload?.('minilm-l12');
    void refreshModels();
  });
  document.getElementById('btn-recheck-minilm')?.addEventListener('click', () => {
    void refreshModels();
    void refreshRuntimeModels();
  });

  document.getElementById('btn-download-qwen')?.addEventListener('click', async () => {
    await (window as any).astrolib?.startModelDownload?.('qwen3-embedding');
  });
  document.getElementById('btn-cancel-qwen')?.addEventListener('click', async () => {
    await (window as any).astrolib?.cancelModelDownload?.('qwen3-embedding');
    void refreshModels();
  });
  document.getElementById('btn-recheck-qwen')?.addEventListener('click', () => {
    void refreshModels();
    void refreshRuntimeModels();
  });

  document.getElementById('btn-download-qwen-base')?.addEventListener('click', async () => {
    await (window as any).astrolib?.startModelDownload?.('qwen3-base');
  });
  document.getElementById('btn-cancel-qwen-base')?.addEventListener('click', async () => {
    await (window as any).astrolib?.cancelModelDownload?.('qwen3-base');
    void refreshModels();
  });
  document.getElementById('btn-recheck-qwen-base')?.addEventListener('click', () => {
    void refreshModels();
    void refreshRuntimeModels();
  });

  // 独立 /hub/ 页面若默认打开诊断或模型面板，仅在该面板本身已激活时触发加载；桌面主窗口覆盖层保持启动零探测
  const initialActivePanel = document.querySelector<HTMLElement>('.hub-panel.active')?.id;
  if (initialActivePanel) {
    triggerLazyPanelRefresh(initialActivePanel);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHubRuntime);
  } else {
    initHubRuntime();
  }
}
