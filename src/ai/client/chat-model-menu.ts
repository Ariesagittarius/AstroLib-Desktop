import {
  getActiveAiModelId,
  saveAiActiveModel,
  getAiExtendedThinking,
  saveAiExtendedThinking,
  getAiCollapseToolsSummary,
  saveAiCollapseToolsSummary,
  getShortModelLabel,
} from '../ai-config';

export interface ModelMenuElements {
  modelMenu: HTMLElement | null;
  modelPillBtn: HTMLButtonElement | null;
  modelPillName: HTMLElement | null;
  thinkingSwitch: HTMLInputElement | null;
  collapseToolsSwitch: HTMLInputElement | null;
  modelExtraItem: HTMLElement | null;
  modelExtraHeadline: HTMLElement | null;
  modelExtraSupport: HTMLElement | null;
}

export class ChatModelMenu {
  private els: ModelMenuElements;
  private onModelSelected?: (modelId: string) => void;

  constructor(els: ModelMenuElements, onModelSelected?: (modelId: string) => void) {
    this.els = els;
    this.onModelSelected = onModelSelected;
    this.init();
  }

  private init(): void {
    if (!this.els.modelMenu) return;

    this.els.modelMenu.querySelectorAll<HTMLButtonElement>('.ask-model-menu-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const modelId = btn.getAttribute('data-model-id');
        if (modelId) {
          saveAiActiveModel(modelId);
          this.updateModelPill();
          this.close();
          if (this.onModelSelected) {
            this.onModelSelected(modelId);
          }
        }
      });
    });

    if (this.els.thinkingSwitch) {
      this.els.thinkingSwitch.checked = getAiExtendedThinking();
      this.els.thinkingSwitch.addEventListener('change', () => {
        saveAiExtendedThinking(this.els.thinkingSwitch!.checked);
      });
    }

    if (this.els.collapseToolsSwitch) {
      this.els.collapseToolsSwitch.checked = getAiCollapseToolsSummary();
      this.els.collapseToolsSwitch.addEventListener('change', () => {
        saveAiCollapseToolsSummary(this.els.collapseToolsSwitch!.checked);
      });
    }
  }

  public open(): void {
    if (!this.els.modelMenu) return;
    this.els.modelMenu.style.display = 'block';
    if (this.els.modelPillBtn) {
      this.els.modelPillBtn.setAttribute('aria-expanded', 'true');
    }

    const activeId = getActiveAiModelId();
    let matchedPreset = false;

    this.els.modelMenu.querySelectorAll<HTMLButtonElement>('.ask-model-menu-item:not(.ask-model-extra-item)').forEach((btn) => {
      const mid = btn.getAttribute('data-model-id');
      const isActive = mid === activeId;
      btn.classList.toggle('is-active', isActive);
      if (isActive) matchedPreset = true;
    });

    if (this.els.modelExtraItem) {
      if (!matchedPreset && activeId) {
        this.els.modelExtraItem.style.display = 'flex';
        this.els.modelExtraItem.classList.add('is-active');
        this.els.modelExtraItem.setAttribute('data-model-id', activeId);
        if (this.els.modelExtraHeadline) this.els.modelExtraHeadline.textContent = getShortModelLabel(activeId);
        if (this.els.modelExtraSupport) this.els.modelExtraSupport.textContent = '当前激活模型';
      } else {
        this.els.modelExtraItem.style.display = 'none';
        this.els.modelExtraItem.classList.remove('is-active');
      }
    }

    if (this.els.thinkingSwitch) {
      this.els.thinkingSwitch.checked = getAiExtendedThinking();
    }
    if (this.els.collapseToolsSwitch) {
      this.els.collapseToolsSwitch.checked = getAiCollapseToolsSummary();
    }
  }

  public close(): void {
    if (!this.els.modelMenu) return;
    this.els.modelMenu.style.display = 'none';
    if (this.els.modelPillBtn) {
      this.els.modelPillBtn.setAttribute('aria-expanded', 'false');
    }
  }

  public updateModelPill(): void {
    if (this.els.modelPillName) {
      this.els.modelPillName.textContent = getShortModelLabel();
    }
  }
}
