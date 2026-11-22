/**
 * src/features/doc-ingestion/paper-typography.ts
 * ============================================================================
 * 学术文献排版、物理版面开关与跨窗口实时同步控制器
 * ============================================================================
 */

import {
  isIngestSettingStorageKey,
  readIngestSettings,
  type IngestSettingsSnapshot,
} from './ingest-settings';

export class PaperTypographyManager {
  private current: IngestSettingsSnapshot;
  private onUpdate?: (snapshot: IngestSettingsSnapshot) => void;

  constructor(onUpdate?: (snapshot: IngestSettingsSnapshot) => void) {
    this.onUpdate = onUpdate;
    this.current = readIngestSettings();
    this.apply(this.current);
    this.bindSyncListeners();
  }

  public getSnapshot(): IngestSettingsSnapshot {
    return this.current;
  }

  public apply(snapshot: IngestSettingsSnapshot): void {
    this.current = snapshot;
    document.body.setAttribute('data-reading-font', snapshot.readingFont);
    document.body.setAttribute('data-heading-font', snapshot.headingFont);
    document.body.setAttribute('data-reading-lh', snapshot.readingLh);
    document.body.setAttribute('data-reading-size', snapshot.readingSize);
    document.body.classList.toggle('hide-page-dividers', !snapshot.showPageDividers);
    document.body.classList.toggle('hide-page-meta', !snapshot.showPageMeta);
  }

  private bindSyncListeners(): void {
    window.addEventListener('storage', (e) => {
      if (isIngestSettingStorageKey(e.key)) {
        const next = readIngestSettings();
        this.apply(next);
        this.onUpdate?.(next);
      }
    });

    window.addEventListener('astrolib:ingest-settings-changed', ((e: CustomEvent<IngestSettingsSnapshot>) => {
      const next = e.detail || readIngestSettings();
      this.apply(next);
      this.onUpdate?.(next);
    }) as EventListener);

    window.addEventListener('message', (e) => {
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'M3_THEME_COLOR_CHANGED' || data.type === 'ASTROLIB_INGEST_SETTINGS_CHANGED') {
        if (data.ingestSettings && typeof data.ingestSettings === 'object') {
          const next = { ...readIngestSettings(), ...data.ingestSettings } as IngestSettingsSnapshot;
          this.apply(next);
          this.onUpdate?.(next);
        } else if (data.transProvider) {
          const next = { ...this.current, transProvider: String(data.transProvider) };
          this.apply(next);
          this.onUpdate?.(next);
        }
      }
    });
  }
}
