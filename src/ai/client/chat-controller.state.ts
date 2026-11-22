export type ChatExecutionStatus = 'idle' | 'busy' | 'streaming' | 'error';

export interface ReferencedChapter {
  title: string;
  url: string;
  text?: string;
  isCurrent?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  sources?: any[];
  toolCalls?: any[];
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ChatControllerSnapshot {
  status: ChatExecutionStatus;
  activeModelId: string;
  extendedThinking: boolean;
  collapseToolsSummary: boolean;
  isDocked: boolean;
  isPrecedingCollapsed: boolean;
  referencedChapters: ReferencedChapter[];
  activeThreadId: string | null;
  errorMessage: string | null;
}

export class ChatControllerStateMachine {
  private status: ChatExecutionStatus = 'idle';
  private activeModelId: string = 'gemini-1.5-flash';
  private extendedThinking: boolean = false;
  private collapseToolsSummary: boolean = true;
  private isDocked: boolean = false;
  private isPrecedingCollapsed: boolean = true;
  private referencedChapters: ReferencedChapter[] = [];
  private activeThreadId: string | null = null;
  private errorMessage: string | null = null;

  constructor(initialSnapshot?: Partial<ChatControllerSnapshot>) {
    if (initialSnapshot) {
      this.hydrate(initialSnapshot);
    }
  }

  public getStatus(): ChatExecutionStatus {
    return this.status;
  }

  public getActiveModelId(): string {
    return this.activeModelId;
  }

  public isExtendedThinkingEnabled(): boolean {
    return this.extendedThinking;
  }

  public isCollapseToolsSummaryEnabled(): boolean {
    return this.collapseToolsSummary;
  }

  public getIsDocked(): boolean {
    return this.isDocked;
  }

  public getIsPrecedingCollapsed(): boolean {
    return this.isPrecedingCollapsed;
  }

  public getReferencedChapters(): readonly ReferencedChapter[] {
    return [...this.referencedChapters];
  }

  public getActiveThreadId(): string | null {
    return this.activeThreadId;
  }

  public getErrorMessage(): string | null {
    return this.errorMessage;
  }

  public startGenerating(): boolean {
    if (this.status === 'busy' || this.status === 'streaming') {
      return false;
    }
    this.status = 'busy';
    this.errorMessage = null;
    return true;
  }

  public enterStreaming(): boolean {
    if (this.status !== 'busy' && this.status !== 'streaming') {
      return false;
    }
    this.status = 'streaming';
    return true;
  }

  public finishGenerating(): boolean {
    if (this.status !== 'busy' && this.status !== 'streaming') {
      return false;
    }
    this.status = 'idle';
    this.errorMessage = null;
    return true;
  }

  public abortGenerating(): boolean {
    if (this.status === 'idle') {
      return false;
    }
    this.status = 'idle';
    return true;
  }

  public setError(message: string): void {
    this.status = 'error';
    this.errorMessage = message || 'Unknown error occurred';
  }

  public resetError(): boolean {
    if (this.status !== 'error') return false;
    this.status = 'idle';
    this.errorMessage = null;
    return true;
  }

  public setActiveModelId(modelId: string): void {
    if (!modelId || !modelId.trim()) return;
    this.activeModelId = modelId.trim();
  }

  public setExtendedThinking(enabled: boolean): void {
    this.extendedThinking = Boolean(enabled);
  }

  public setCollapseToolsSummary(enabled: boolean): void {
    this.collapseToolsSummary = Boolean(enabled);
  }

  public setIsDocked(docked: boolean): void {
    this.isDocked = Boolean(docked);
  }

  public setIsPrecedingCollapsed(collapsed: boolean): void {
    this.isPrecedingCollapsed = Boolean(collapsed);
  }

  public setActiveThreadId(threadId: string | null): void {
    this.activeThreadId = threadId;
  }

  public addReferencedChapter(chapter: ReferencedChapter): boolean {
    if (!chapter.url) return false;
    const exists = this.referencedChapters.some((c) => c.url === chapter.url);
    if (exists) return false;
    this.referencedChapters.push({ ...chapter });
    return true;
  }

  public removeReferencedChapter(url: string): boolean {
    const initialLen = this.referencedChapters.length;
    this.referencedChapters = this.referencedChapters.filter((c) => c.url !== url);
    return this.referencedChapters.length !== initialLen;
  }

  public clearReferencedChapters(): void {
    this.referencedChapters = [];
  }

  public serialize(): ChatControllerSnapshot {
    return {
      status: this.status,
      activeModelId: this.activeModelId,
      extendedThinking: this.extendedThinking,
      collapseToolsSummary: this.collapseToolsSummary,
      isDocked: this.isDocked,
      isPrecedingCollapsed: this.isPrecedingCollapsed,
      referencedChapters: [...this.referencedChapters],
      activeThreadId: this.activeThreadId,
      errorMessage: this.errorMessage,
    };
  }

  public hydrate(snapshot: Partial<ChatControllerSnapshot>): void {
    if (snapshot.status) this.status = snapshot.status;
    if (typeof snapshot.activeModelId === 'string') this.activeModelId = snapshot.activeModelId;
    if (typeof snapshot.extendedThinking === 'boolean') this.extendedThinking = snapshot.extendedThinking;
    if (typeof snapshot.collapseToolsSummary === 'boolean') this.collapseToolsSummary = snapshot.collapseToolsSummary;
    if (typeof snapshot.isDocked === 'boolean') this.isDocked = snapshot.isDocked;
    if (typeof snapshot.isPrecedingCollapsed === 'boolean') this.isPrecedingCollapsed = snapshot.isPrecedingCollapsed;
    if (Array.isArray(snapshot.referencedChapters)) {
      this.referencedChapters = snapshot.referencedChapters.map((c) => ({ ...c }));
    }
    if (snapshot.activeThreadId !== undefined) this.activeThreadId = snapshot.activeThreadId;
    if (snapshot.errorMessage !== undefined) this.errorMessage = snapshot.errorMessage;
  }
}
