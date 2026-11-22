import type { ParagraphUnit, TranslationProviderId, TranslationExportFormat, TranslationDisplayMode } from '../types';

export type TranslationStatus = 'idle' | 'translating' | 'error';

export interface TranslationProgress {
  total: number;
  completed: number;
  failed: number;
  percent: number;
}

export interface TranslationDockStateSnapshot {
  status: TranslationStatus;
  currentProvider: TranslationProviderId;
  displayMode: TranslationDisplayMode;
  isInlineActive: boolean;
  isSettingsOpen: boolean;
  isExportOpen: boolean;
  selectedExportFormat: TranslationExportFormat;
  selectedExportScope: 'all' | 'satisfied';
  currentChapterKey: string;
  errorMessage: string | null;
}

export class TranslationDockStateMachine {
  private status: TranslationStatus = 'idle';
  private currentProvider: TranslationProviderId = 'google';
  private displayMode: TranslationDisplayMode = 'sidebar';
  private isInlineActive: boolean = false;
  private isSettingsOpen: boolean = false;
  private isExportOpen: boolean = false;
  private selectedExportFormat: TranslationExportFormat = 'bilingual-markdown';
  private selectedExportScope: 'all' | 'satisfied' = 'all';
  private currentChapterKey: string = '';
  private paragraphs: ParagraphUnit[] = [];
  private errorMessage: string | null = null;

  constructor(initialSnapshot?: Partial<TranslationDockStateSnapshot>) {
    if (initialSnapshot) {
      this.hydrate(initialSnapshot);
    }
  }

  public getStatus(): TranslationStatus {
    return this.status;
  }

  public getProvider(): TranslationProviderId {
    return this.currentProvider;
  }

  public getDisplayMode(): TranslationDisplayMode {
    return this.displayMode;
  }

  public getIsInlineActive(): boolean {
    return this.isInlineActive;
  }

  public getIsSettingsOpen(): boolean {
    return this.isSettingsOpen;
  }

  public getIsExportOpen(): boolean {
    return this.isExportOpen;
  }

  public getSelectedExportFormat(): TranslationExportFormat {
    return this.selectedExportFormat;
  }

  public getSelectedExportScope(): 'all' | 'satisfied' {
    return this.selectedExportScope;
  }

  public getCurrentChapterKey(): string {
    return this.currentChapterKey;
  }

  public getParagraphs(): readonly ParagraphUnit[] {
    return [...this.paragraphs];
  }

  public getErrorMessage(): string | null {
    return this.errorMessage;
  }

  public startTranslation(): boolean {
    if (this.status === 'translating') {
      return false;
    }
    this.status = 'translating';
    this.errorMessage = null;
    return true;
  }

  public finishTranslation(): boolean {
    if (this.status !== 'translating') {
      return false;
    }
    this.status = 'idle';
    this.errorMessage = null;
    return true;
  }

  public abortTranslation(): boolean {
    if (this.status === 'idle') {
      return false;
    }
    this.status = 'idle';
    return true;
  }

  public setError(error: string): void {
    this.status = 'error';
    this.errorMessage = error || 'Translation failed';
  }

  public resetError(): boolean {
    if (this.status !== 'error') return false;
    this.status = 'idle';
    this.errorMessage = null;
    return true;
  }

  public setProvider(provider: TranslationProviderId): void {
    this.currentProvider = provider;
  }

  public setDisplayMode(mode: TranslationDisplayMode): void {
    this.displayMode = mode;
  }

  public setInlineActive(active: boolean): void {
    this.isInlineActive = Boolean(active);
  }

  public setSettingsOpen(open: boolean): void {
    this.isSettingsOpen = Boolean(open);
  }

  public setExportOpen(open: boolean): void {
    this.isExportOpen = Boolean(open);
  }

  public setExportFormat(format: TranslationExportFormat): void {
    this.selectedExportFormat = format;
  }

  public setExportScope(scope: 'all' | 'satisfied'): void {
    this.selectedExportScope = scope;
  }

  public setChapterKey(key: string): void {
    this.currentChapterKey = key || '';
  }

  public setParagraphs(units: ParagraphUnit[]): void {
    this.paragraphs = Array.isArray(units) ? [...units] : [];
  }

  public updateParagraph(id: string, updates: Partial<ParagraphUnit>): boolean {
    const idx = this.paragraphs.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    this.paragraphs[idx] = { ...this.paragraphs[idx], ...updates };
    return true;
  }

  public calculateProgress(): TranslationProgress {
    const total = this.paragraphs.length;
    if (total === 0) {
      return { total: 0, completed: 0, failed: 0, percent: 100 };
    }

    let completed = 0;
    let failed = 0;

    for (const p of this.paragraphs) {
      if (p.translatedText) {
        completed++;
      } else if (p.error) {
        failed++;
      }
    }

    const percent = Math.min(100, Math.round(((completed + failed) / total) * 100));
    return { total, completed, failed, percent };
  }

  public serialize(): TranslationDockStateSnapshot {
    return {
      status: this.status,
      currentProvider: this.currentProvider,
      displayMode: this.displayMode,
      isInlineActive: this.isInlineActive,
      isSettingsOpen: this.isSettingsOpen,
      isExportOpen: this.isExportOpen,
      selectedExportFormat: this.selectedExportFormat,
      selectedExportScope: this.selectedExportScope,
      currentChapterKey: this.currentChapterKey,
      errorMessage: this.errorMessage,
    };
  }

  public hydrate(snapshot: Partial<TranslationDockStateSnapshot>): void {
    if (snapshot.status) this.status = snapshot.status;
    if (snapshot.currentProvider) this.currentProvider = snapshot.currentProvider;
    if (snapshot.displayMode) this.displayMode = snapshot.displayMode;
    if (typeof snapshot.isInlineActive === 'boolean') this.isInlineActive = snapshot.isInlineActive;
    if (typeof snapshot.isSettingsOpen === 'boolean') this.isSettingsOpen = snapshot.isSettingsOpen;
    if (typeof snapshot.isExportOpen === 'boolean') this.isExportOpen = snapshot.isExportOpen;
    if (snapshot.selectedExportFormat) this.selectedExportFormat = snapshot.selectedExportFormat;
    if (snapshot.selectedExportScope) this.selectedExportScope = snapshot.selectedExportScope;
    if (typeof snapshot.currentChapterKey === 'string') this.currentChapterKey = snapshot.currentChapterKey;
    if (snapshot.errorMessage !== undefined) this.errorMessage = snapshot.errorMessage;
  }
}
