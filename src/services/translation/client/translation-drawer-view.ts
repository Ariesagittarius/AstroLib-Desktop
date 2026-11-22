import type { ParagraphUnit, TranslationProviderId, TranslationDisplayMode, TranslationExportFormat } from '../types';
import { TranslationExporter } from '../export/translation-exporter';
import { TranslationStorage } from '../storage/translation-storage';
import { getProviderApiKey, saveProviderApiKey } from '../../../ai/ai-config';

export interface TranslationDrawerViewContext {
  getProvider(): TranslationProviderId;
  getDisplayMode(): TranslationDisplayMode;
  getParagraphs(): ParagraphUnit[];
  getSelectedExportFormat(): TranslationExportFormat;
  getSelectedExportScope(): 'all' | 'satisfied';
  setSelectedExportFormat(fmt: TranslationExportFormat): void;
  setSelectedExportScope(scope: 'all' | 'satisfied'): void;
  syncDisplayModeChips(): void;
  updateCardBadges(card: HTMLElement, unit: ParagraphUnit): void;
  handleToggleSatisfied(unit: ParagraphUnit, card: HTMLElement): void;
  startTranslation(forceRefresh?: boolean): Promise<void>;
}

export class TranslationDrawerView {
  private isSettingsOpen = false;
  private isExportOpen = false;

  constructor(private ctx: TranslationDrawerViewContext) {}

  public isSettingsDrawerOpen(): boolean {
    return this.isSettingsOpen;
  }

  public isExportDrawerOpen(): boolean {
    return this.isExportOpen;
  }

  public toggleSettingsDrawer(open?: boolean): void {
    const drawer = document.getElementById('trans-settings-drawer');
    const toggleBtn = document.getElementById('trans-sidebar-settings');
    if (!drawer) return;

    this.isSettingsOpen = open !== undefined ? open : !this.isSettingsOpen;

    if (this.isSettingsOpen) {
      if (this.isExportOpen) {
        this.toggleExportDrawer(false);
      }
      drawer.style.display = 'block';
      drawer.setAttribute('aria-hidden', 'false');
      toggleBtn?.classList.add('is-active');
      this.ctx.syncDisplayModeChips();
      this.syncSettingsDrawerUI();
      const input = document.getElementById('trans-api-key-input') as HTMLInputElement | null;

      if (input && !input.disabled) {
        setTimeout(() => {
          input.focus();
          input.select();
        }, 50);
      }
    } else {
      drawer.style.display = 'none';
      drawer.setAttribute('aria-hidden', 'true');
      toggleBtn?.classList.remove('is-active');
    }
  }

  public toggleExportDrawer(open?: boolean): void {
    const drawer = document.getElementById('trans-export-drawer');
    const toggleBtn = document.getElementById('trans-sidebar-export');
    if (!drawer) return;

    this.isExportOpen = open !== undefined ? open : !this.isExportOpen;

    if (this.isExportOpen) {
      if (this.isSettingsOpen) {
        this.toggleSettingsDrawer(false);
      }
      drawer.style.display = 'block';
      drawer.setAttribute('aria-hidden', 'false');
      toggleBtn?.classList.add('is-active');
      this.syncExportDrawerUI();
    } else {
      drawer.style.display = 'none';
      drawer.setAttribute('aria-hidden', 'true');
      toggleBtn?.classList.remove('is-active');
    }
  }

  public syncExportDrawerUI(): void {
    const drawer = document.getElementById('trans-export-drawer');
    if (!drawer) return;

    drawer.querySelectorAll<HTMLButtonElement>('[data-export-fmt]').forEach((btn) => {
      const fmt = btn.getAttribute('data-export-fmt') as TranslationExportFormat;
      if (fmt === this.ctx.getSelectedExportFormat()) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    });

    drawer.querySelectorAll<HTMLButtonElement>('[data-export-scope]').forEach((btn) => {
      const scope = btn.getAttribute('data-export-scope');
      if (scope === this.ctx.getSelectedExportScope()) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    });

    this.updateSatisfiedCountBadge();
  }

  public updateSatisfiedCountBadge(): void {
    const paragraphs = this.ctx.getParagraphs();
    const satisfiedCount = paragraphs.filter((p) => Boolean(p.isSatisfied && p.translatedText && p.status === 'done')).length;

    const countBadge = document.getElementById('trans-satisfied-count');
    if (countBadge) {
      if (satisfiedCount > 0) {
        countBadge.style.display = 'inline-flex';
        countBadge.textContent = `${satisfiedCount} 采纳`;
      } else {
        countBadge.style.display = 'none';
      }
    }

    const exportNum = document.getElementById('trans-export-satisfied-num');
    if (exportNum) {
      exportNum.textContent = String(satisfiedCount);
    }
  }

  public handleExportDownload(): void {
    const downloadBtn = document.getElementById('trans-export-download');
    const chapterTitle = document.querySelector('h1')?.textContent?.trim() || document.title || 'AstroLib-Chapter';

    const result = TranslationExporter.generateExport(this.ctx.getParagraphs(), {
      format: this.ctx.getSelectedExportFormat(),
      onlySatisfied: this.ctx.getSelectedExportScope() === 'satisfied',
      chapterTitle,
    });

    TranslationExporter.downloadFile(result.filename, result.content, result.mimeType);

    if (downloadBtn) {
      const textSpan = downloadBtn.querySelector('.trans-btn-text');
      const iconSpan = downloadBtn.querySelector('.trans-btn-icon');
      const origText = textSpan?.textContent || '立即下载文件';
      const origIcon = iconSpan?.textContent || 'file_download';
      if (textSpan) textSpan.textContent = '已下载';
      if (iconSpan) iconSpan.textContent = 'check';

      setTimeout(() => {
        if (textSpan) textSpan.textContent = origText;
        if (iconSpan) iconSpan.textContent = origIcon;
      }, 1500);
    }
  }

  public handleMarkAllSatisfied(): void {
    const chapterKey = TranslationStorage.normalizeKey();
    const paragraphs = this.ctx.getParagraphs();
    TranslationStorage.markAllSatisfied(chapterKey, paragraphs);

    const dockContent = document.getElementById('trans-sidebar-content');
    if (dockContent) {
      for (const unit of paragraphs) {
        if (unit.translatedText && unit.status === 'done') {
          const card = dockContent.querySelector<HTMLElement>(`[data-trans-card-id="${unit.id}"]`);
          if (card) {
            card.classList.add('is-satisfied');
            const satisfyBtn = card.querySelector<HTMLButtonElement>('.trans-card-satisfy-btn');
            if (satisfyBtn) {
              satisfyBtn.classList.add('is-satisfied');
              satisfyBtn.title = '取消采纳';
              const icon = satisfyBtn.querySelector('md-icon');
              if (icon) icon.textContent = 'star';
            }
            this.ctx.updateCardBadges(card, unit);
          }
        }
      }
    }

    this.updateSatisfiedCountBadge();

    const btn = document.getElementById('trans-export-approve-all');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '已全部采纳';
      setTimeout(() => {
        btn.textContent = orig;
      }, 1500);
    }
  }

  public toggleKeyVisibility(): void {
    const input = document.getElementById('trans-api-key-input') as HTMLInputElement | null;
    const eyeBtn = document.getElementById('trans-key-toggle-eye');
    const eyeIcon = eyeBtn?.querySelector('md-icon');
    if (!input || !eyeIcon) return;

    if (input.type === 'password') {
      input.type = 'text';
      eyeIcon.textContent = 'visibility_off';
      eyeBtn?.setAttribute('title', '隐藏密钥');
    } else {
      input.type = 'password';
      eyeIcon.textContent = 'visibility';
      eyeBtn?.setAttribute('title', '显示密钥');
    }
  }

  public syncSettingsDrawerUI(): void {
    const drawer = document.getElementById('trans-settings-drawer');
    if (!drawer) return;

    const providerNameEl = document.getElementById('trans-settings-provider-name');
    const keyInput = document.getElementById('trans-api-key-input') as HTMLInputElement | null;
    const badgeEl = document.getElementById('trans-key-status-badge');
    const tipEl = document.getElementById('trans-settings-tip');
    const alertEl = document.getElementById('trans-settings-alert');
    const saveBtn = document.getElementById('trans-settings-save') as HTMLButtonElement | null;
    const clearBtn = document.getElementById('trans-settings-clear') as HTMLButtonElement | null;

    if (alertEl) {
      alertEl.style.display = 'none';
      alertEl.textContent = '';
      alertEl.className = 'trans-settings-alert';
    }

    const currentProvider = this.ctx.getProvider();

    if (currentProvider === 'google') {
      if (providerNameEl) providerNameEl.textContent = 'Google 翻译 (公共免密钥)';
      if (keyInput) {
        keyInput.value = '';
        keyInput.placeholder = 'Google 翻译无需配置 API Key';
        keyInput.disabled = true;
      }
      if (badgeEl) {
        badgeEl.textContent = '无需密钥';
        badgeEl.className = 'trans-key-status-badge';
      }
      if (tipEl) {
        tipEl.textContent = 'Google 翻译为公共免费接口，无需任何配置，即开即用。';
      }
      if (saveBtn) saveBtn.disabled = true;
      if (clearBtn) clearBtn.disabled = true;
      return;
    }

    if (saveBtn) saveBtn.disabled = false;
    if (clearBtn) clearBtn.disabled = false;
    if (keyInput) keyInput.disabled = false;

    if (currentProvider === 'bupt') {
      if (providerNameEl) providerNameEl.textContent = 'DeepSeek (北京邮电大学)';
      const currentKey = getProviderApiKey('bupt') || (typeof localStorage !== 'undefined' ? localStorage.getItem('astrolib_ai_provider_key_bupt') || '' : '');
      if (keyInput && document.activeElement !== keyInput) {
        keyInput.value = currentKey;
        keyInput.placeholder = 'sk-bupt-... 或 sk-...';
      }
      if (badgeEl) {
        const hasKey = Boolean(currentKey.trim());
        badgeEl.textContent = hasKey ? '已配置 (本地)' : '默认配置';
        badgeEl.className = `trans-key-status-badge ${hasKey ? 'is-configured' : ''}`;
      }
      if (tipEl) {
        tipEl.textContent = '北京邮电大学「人人有算力」校内模型服务网关。若留空，将自动使用服务端默认配置 (.env)。';
      }
      if (keyInput) {
        this.handleKeyInput(keyInput.value);
      }
    } else if (currentProvider === 'gemini') {
      if (providerNameEl) providerNameEl.textContent = 'Google Gemini (学术推理)';
      const currentKey = getProviderApiKey('gemini') || (typeof localStorage !== 'undefined' ? localStorage.getItem('astrolib_ai_provider_key_gemini') || '' : '');
      if (keyInput && document.activeElement !== keyInput) {
        keyInput.value = currentKey;
        keyInput.placeholder = 'AIzaSy... (留空使用默认)';
      }
      if (badgeEl) {
        const hasKey = Boolean(currentKey.trim());
        badgeEl.textContent = hasKey ? '已配置 (本地)' : '默认配置';
        badgeEl.className = `trans-key-status-badge ${hasKey ? 'is-configured' : ''}`;
      }
      if (tipEl) {
        tipEl.textContent = 'Google Gemini 官方学术与理科推理模型。若留空，将自动使用服务端默认配置 (.env)。';
      }
      if (keyInput) {
        this.handleKeyInput(keyInput.value);
      }
    } else if (currentProvider === 'zhipu') {
      if (providerNameEl) providerNameEl.textContent = '智谱开放平台 (GLM-4-Flash 免费)';
      const currentKey = getProviderApiKey('zhipu') || (typeof localStorage !== 'undefined' ? localStorage.getItem('astrolib_ai_provider_key_zhipu') || '' : '');
      if (keyInput && document.activeElement !== keyInput) {
        keyInput.value = currentKey;
        keyInput.placeholder = '请填写智谱 API Key (例如: xxxxxxxxx.yyyyyyyyy)';
      }
      if (badgeEl) {
        const hasKey = Boolean(currentKey.trim());
        badgeEl.textContent = hasKey ? '已配置 (本地)' : '未配置';
        badgeEl.className = `trans-key-status-badge ${hasKey ? 'is-configured' : ''}`;
      }
      if (tipEl) {
        tipEl.textContent = '智谱开放平台 GLM-4-Flash 为永久免费模型，请前往 open.bigmodel.cn 复制 API Key。若配置在服务端的 .env (ZHIPU_API_KEY)，此处可留空。';
      }
      if (keyInput) {
        this.handleKeyInput(keyInput.value);
      }
    }
  }

  public handleKeyInput(val: string): void {
    const alertEl = document.getElementById('trans-settings-alert');
    if (!alertEl) return;

    const trimmed = val.trim();
    if (!trimmed) {
      alertEl.style.display = 'none';
      alertEl.textContent = '';
      return;
    }

    const currentProvider = this.ctx.getProvider();

    if (currentProvider === 'bupt') {
      if (trimmed.startsWith('ghp_')) {
        alertEl.style.display = 'block';
        alertEl.className = 'trans-settings-alert';
        alertEl.textContent = '❌ 检测到 GitHub 访问令牌 (ghp_...)！北邮网关无法使用此密钥，请填写以 sk- 开头的密钥或点击「清空密钥」恢复默认。';
        return;
      }
      if (!trimmed.startsWith('sk-')) {
        alertEl.style.display = 'block';
        alertEl.className = 'trans-settings-alert is-warning';
        alertEl.textContent = '⚠️ 北邮 LiteLLM 网关密钥通常以 sk- 开头，请确认密钥格式正确。';
        return;
      }
    } else if (currentProvider === 'gemini') {
      if (!trimmed.startsWith('AIzaSy')) {
        alertEl.style.display = 'block';
        alertEl.className = 'trans-settings-alert is-warning';
        alertEl.textContent = '提示：Google Gemini 官方密钥通常以 AIzaSy 开头。';
        return;
      }
    } else if (currentProvider === 'zhipu') {
      if (trimmed.startsWith('ghp_')) {
        alertEl.style.display = 'block';
        alertEl.className = 'trans-settings-alert';
        alertEl.textContent = '❌ 检测到 GitHub 访问令牌 (ghp_...)！智谱开放平台无法使用此密钥，请前往 open.bigmodel.cn 获取 API Key。';
        return;
      }
    }

    alertEl.style.display = 'none';
    alertEl.textContent = '';
  }

  public handleSaveKey(): void {
    const currentProvider = this.ctx.getProvider();
    if (currentProvider === 'google') return;
    const input = document.getElementById('trans-api-key-input') as HTMLInputElement | null;
    const saveBtn = document.getElementById('trans-settings-save');
    const alertEl = document.getElementById('trans-settings-alert');
    if (!input) return;

    const key = input.value.trim();

    if ((currentProvider === 'bupt' || currentProvider === 'zhipu') && key && key.startsWith('ghp_')) {
      if (alertEl) {
        alertEl.style.display = 'block';
        alertEl.className = 'trans-settings-alert';
        alertEl.textContent = '❌ 无法保存：检测到 GitHub 令牌 (ghp_...)，请填写对应大模型服务商的有效 API Key。';
      }
      return;
    }

    saveProviderApiKey(currentProvider, key);

    if (saveBtn) {
      const textSpan = saveBtn.querySelector('.trans-btn-text');
      const iconSpan = saveBtn.querySelector('.trans-btn-icon');
      const origText = textSpan?.textContent || '保存并应用';
      const origIcon = iconSpan?.textContent || 'save';
      if (textSpan) textSpan.textContent = '已保存';
      if (iconSpan) iconSpan.textContent = 'check';

      setTimeout(() => {
        if (textSpan) textSpan.textContent = origText;
        if (iconSpan) iconSpan.textContent = origIcon;
      }, 1500);
    }

    this.syncSettingsDrawerUI();
    this.ctx.startTranslation(true);
  }

  public handleClearKey(): void {
    const currentProvider = this.ctx.getProvider();
    if (currentProvider === 'google') return;
    const input = document.getElementById('trans-api-key-input') as HTMLInputElement | null;
    if (input) input.value = '';

    saveProviderApiKey(currentProvider, '');
    this.syncSettingsDrawerUI();
    this.ctx.startTranslation(true);
  }

  public openFullAiSettings(): void {
    window.dispatchEvent(new CustomEvent('astrolib:open-settings', { detail: { tab: 'ai' } }));
  }

  public getEffectiveApiKey(): string | undefined {
    const currentProvider = this.ctx.getProvider();

    if (currentProvider === 'google') {
      const key = (getProviderApiKey('google' as any) || (typeof localStorage !== 'undefined' ? localStorage.getItem('astrolib_ai_provider_key_google') || '' : '')).trim();
      return key && key.startsWith('AIzaSy') ? key : undefined;
    }

    if (currentProvider === 'bupt') {
      const key = (getProviderApiKey('bupt') || (typeof localStorage !== 'undefined' ? localStorage.getItem('astrolib_ai_provider_key_bupt') || '' : '')).trim();
      if (key && key.startsWith('sk-') && !key.startsWith('sk-bupt-...')) {
        return key;
      }
      return undefined;
    }

    if (currentProvider === 'gemini') {
      const key = (getProviderApiKey('gemini') || (typeof localStorage !== 'undefined' ? localStorage.getItem('astrolib_ai_provider_key_gemini') || '' : '')).trim();
      if (key && !key.startsWith('AIzaSy...')) {
        return key;
      }
      return undefined;
    }

    if (currentProvider === 'zhipu') {
      const key = (getProviderApiKey('zhipu') || (typeof localStorage !== 'undefined' ? localStorage.getItem('astrolib_ai_provider_key_zhipu') || '' : '')).trim();
      if (key && !key.startsWith('ghp_')) {
        return key;
      }
      return undefined;
    }

    if (currentProvider === 'deepseek') {
      const key = (getProviderApiKey('deepseek') || (typeof localStorage !== 'undefined' ? localStorage.getItem('astrolib_ai_provider_key_deepseek') || '' : '')).trim();
      if (key && key.startsWith('sk-')) {
        return key;
      }
      return undefined;
    }

    return undefined;
  }
}
