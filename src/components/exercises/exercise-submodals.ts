/**
 * src/components/exercises/exercise-submodals.ts
 * ============================================================================
 * Submodals controller for Exercise Center (Feedback, Source Editor, AI Upload)
 * ============================================================================
 */

import { exerciseDb, type CommunityAiSolution, type ExerciseFeedbackPayload } from '../../utils/exercise-db/exercise-db-client';
import type { SlimQuestionItem } from '../../types/exercises';

export interface SubmodalsContext {
  getQuestion(qid: string): SlimQuestionItem | undefined;
  showToast(msg: string): void;
  getAiSolution(qid: string): string;
  onSourceSaved(activeEditorQuestion: SlimQuestionItem, parsedData: any): void;
  onAiSolutionUploaded(qid: string, data: CommunityAiSolution): void;
  sanitizeLatexValue(val: any): any;
}

export class ExerciseSubmodalsManager {
  private feedbackModal: HTMLElement | null = null;
  private sourceEditorModal: HTMLElement | null = null;
  private aiUploadModal: HTMLElement | null = null;

  private activeFeedbackQuestion: SlimQuestionItem | null = null;
  private activeEditorQuestion: SlimQuestionItem | null = null;
  private activeUploadQuestionId: string | null = null;

  constructor(private ctx: SubmodalsContext) {}

  public initElements(root: HTMLElement): void {
    this.feedbackModal = root.querySelector('#ex-feedback-modal');
    this.sourceEditorModal = root.querySelector('#ex-source-editor-modal');
    this.aiUploadModal = root.querySelector('#ex-ai-upload-modal');
    this.bindEvents();
  }

  private bindEvents(): void {
    if (this.feedbackModal) {
      const closeBtns = this.feedbackModal.querySelectorAll('#ex-fb-close-btn, [data-action="close-feedback-modal"]');
      const submitBtn = this.feedbackModal.querySelector('#ex-fb-submit-btn');
      closeBtns.forEach((btn) => btn.addEventListener('click', () => this.feedbackModal?.classList.add('hidden')));
      submitBtn?.addEventListener('click', () => this.submitFeedback());
    }

    if (this.sourceEditorModal) {
      const closeBtns = this.sourceEditorModal.querySelectorAll('#ex-src-close-btn, [data-action="close-source-modal"]');
      const saveBtn = this.sourceEditorModal.querySelector('#ex-src-save-btn');
      const copyBtn = this.sourceEditorModal.querySelector('#ex-src-copy-btn');
      closeBtns.forEach((btn) => btn.addEventListener('click', () => this.sourceEditorModal?.classList.add('hidden')));
      saveBtn?.addEventListener('click', () => this.saveSourceChanges());
      copyBtn?.addEventListener('click', () => {
        const textarea = this.sourceEditorModal?.querySelector('#ex-src-editor-textarea') as HTMLTextAreaElement;
        if (textarea && textarea.value) {
          navigator.clipboard.writeText(textarea.value).then(() => {
            this.ctx.showToast('题目完整 JSON 源码已复制');
          });
        }
      });
    }

    if (this.aiUploadModal) {
      const closeBtns = this.aiUploadModal.querySelectorAll('#ex-ai-upload-close-btn, [data-action="close-upload-modal"]');
      const submitBtn = this.aiUploadModal.querySelector('#ex-ai-upload-submit-btn');
      closeBtns.forEach((btn) => btn.addEventListener('click', () => this.aiUploadModal?.classList.add('hidden')));
      submitBtn?.addEventListener('click', () => this.submitAiSolutionUpload());
    }
  }

  public isSubmodalOpen(): boolean {
    return Boolean(
      (this.feedbackModal && !this.feedbackModal.classList.contains('hidden')) ||
      (this.sourceEditorModal && !this.sourceEditorModal.classList.contains('hidden')) ||
      (this.aiUploadModal && !this.aiUploadModal.classList.contains('hidden'))
    );
  }

  public closeAllSubmodals(): void {
    this.feedbackModal?.classList.add('hidden');
    this.sourceEditorModal?.classList.add('hidden');
    this.aiUploadModal?.classList.add('hidden');
  }

  public openFeedbackModal(qid: string): void {
    const q = this.ctx.getQuestion(qid);
    if (!q || !this.feedbackModal) return;
    this.activeFeedbackQuestion = q;

    const qidBadge = this.feedbackModal.querySelector('#ex-fb-qid-badge');
    const sourceHint = this.feedbackModal.querySelector('#ex-fb-source-hint');
    if (qidBadge) qidBadge.textContent = q.id;
    if (sourceHint) sourceHint.textContent = `${q.paper_title} · 原卷第 ${q.paper_q_num} 题 (${q.type})`;

    const descInput = this.feedbackModal.querySelector('#ex-fb-desc-input') as HTMLTextAreaElement;
    const suggInput = this.feedbackModal.querySelector('#ex-fb-sugg-input') as HTMLTextAreaElement;
    if (descInput) descInput.value = '';
    if (suggInput) suggInput.value = '';

    this.feedbackModal.classList.remove('hidden');
  }

  public async submitFeedback(): Promise<void> {
    if (!this.activeFeedbackQuestion || !this.feedbackModal) return;

    const descInput = this.feedbackModal.querySelector('#ex-fb-desc-input') as HTMLTextAreaElement;
    const suggInput = this.feedbackModal.querySelector('#ex-fb-sugg-input') as HTMLTextAreaElement;
    const reporterInput = this.feedbackModal.querySelector('#ex-fb-reporter-input') as HTMLInputElement;

    const desc = descInput?.value.trim();
    if (!desc) {
      this.ctx.showToast('请填写问题详情描述');
      return;
    }

    const checkboxes = this.feedbackModal.querySelectorAll('input[name="fb-err"]:checked');
    const errorTypes: string[] = [];
    checkboxes.forEach((cb: any) => errorTypes.push(cb.value));

    const payload: ExerciseFeedbackPayload = {
      question_id: this.activeFeedbackQuestion.id,
      paper_title: this.activeFeedbackQuestion.paper_title,
      order_in_paper: this.activeFeedbackQuestion.paper_q_num,
      chapter: this.activeFeedbackQuestion.chapter,
      section: this.activeFeedbackQuestion.sec,
      question_type: this.activeFeedbackQuestion.type,
      error_types: errorTypes,
      description: desc,
      suggestion: suggInput?.value.trim() || '',
      reporter_name: reporterInput?.value.trim() || '热心读者',
    };

    const submitBtn = this.feedbackModal.querySelector('#ex-fb-submit-btn') as HTMLButtonElement;
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await exerciseDb.submitFeedback(payload);
      if (submitBtn) submitBtn.disabled = false;
      this.feedbackModal.classList.add('hidden');
      this.ctx.showToast(res.message || '勘误反馈已成功提交，感谢您的支持！');
    } catch (err: any) {
      if (submitBtn) submitBtn.disabled = false;
      this.ctx.showToast(`提交反馈失败: ${err.message || '未知错误'}`);
    }
  }

  public openSourceEditorModal(qid: string): void {
    const q = this.ctx.getQuestion(qid);
    if (!q || !this.sourceEditorModal) return;
    this.activeEditorQuestion = q;

    const textarea = this.sourceEditorModal.querySelector('#ex-src-editor-textarea') as HTMLTextAreaElement;
    const statusMsg = this.sourceEditorModal.querySelector('#ex-src-status-msg');
    if (statusMsg) statusMsg.textContent = '';

    const editorPayload = {
      id: q.id,
      meta: {
        type: q.type,
        score: q.score,
        order_in_paper: q.order_in_paper,
        section_type: q.section_type,
      },
      content: {
        stem: q.stem_raw,
        options: q.options ? q.options.map((o) => ({ key: o.key, text: o.text_raw })) : [],
      },
      solution: {
        answer: q.answer,
        hints: '',
        steps: '',
      },
      source: {
        paper_id: q.paper_id,
        raw_title: q.paper_raw_title || q.paper_title,
        academic_year: q.academic_year,
        category: q.paper_category,
      },
      mapping: {
        engineering_analysis: {
          chapter: q.chapter,
          chapter_title: q.chapter_title,
          section: q.sec,
          section_title: q.sec_title,
          section_slug: q.sec_slug,
          knowledge_points: q.kps,
        },
      },
    };

    if (textarea) {
      textarea.value = JSON.stringify(editorPayload, null, 2);
    }

    this.sourceEditorModal.classList.remove('hidden');
  }

  public async saveSourceChanges(): Promise<void> {
    if (!this.activeEditorQuestion || !this.sourceEditorModal) return;
    const textarea = this.sourceEditorModal.querySelector('#ex-src-editor-textarea') as HTMLTextAreaElement;
    const statusMsg = this.sourceEditorModal.querySelector('#ex-src-status-msg');
    const saveBtn = this.sourceEditorModal.querySelector('#ex-src-save-btn') as HTMLButtonElement;

    let parsedData: any = null;
    try {
      parsedData = this.ctx.sanitizeLatexValue(JSON.parse(textarea.value));
    } catch (e: any) {
      if (statusMsg) statusMsg.textContent = `JSON 语法错误: ${e.message}`;
      return;
    }

    if (saveBtn) saveBtn.disabled = true;
    if (statusMsg) statusMsg.textContent = '正在向本地 Dev Server 写入并重载...';

    const res = await exerciseDb.saveQuestionSource({
      question_id: this.activeEditorQuestion.id,
      chapter: this.activeEditorQuestion.chapter,
      question_data: parsedData,
    });

    if (saveBtn) saveBtn.disabled = false;

    if (res.success) {
      this.sourceEditorModal.classList.add('hidden');
      this.ctx.showToast(res.message || '源码修改已成功保存并完成热重载！');
      this.ctx.onSourceSaved(this.activeEditorQuestion, parsedData);
    } else {
      if (statusMsg) statusMsg.textContent = res.message || '保存失败';
    }
  }

  public openAiUploadModal(qid: string): void {
    if (!this.aiUploadModal) return;
    this.activeUploadQuestionId = qid;

    const qidEl = this.aiUploadModal.querySelector('#ex-ai-upload-qid');
    if (qidEl) qidEl.textContent = qid;

    const solTextarea = this.aiUploadModal.querySelector('#ex-ai-solution-textarea') as HTMLTextAreaElement;
    const existingMd = this.ctx.getAiSolution(qid) || '';
    if (solTextarea) solTextarea.value = existingMd;

    this.aiUploadModal.classList.remove('hidden');
  }

  public async submitAiSolutionUpload(): Promise<void> {
    if (!this.activeUploadQuestionId || !this.aiUploadModal) return;

    const modelInput = this.aiUploadModal.querySelector('#ex-ai-model-input') as HTMLInputElement;
    const authorInput = this.aiUploadModal.querySelector('#ex-ai-author-input') as HTMLInputElement;
    const solTextarea = this.aiUploadModal.querySelector('#ex-ai-solution-textarea') as HTMLTextAreaElement;
    const remarksInput = this.aiUploadModal.querySelector('#ex-ai-remarks-input') as HTMLInputElement;

    const solutionMd = solTextarea?.value.trim();
    if (!solutionMd) {
      this.ctx.showToast('请填入 AI 题解推导 Markdown 内容');
      return;
    }

    const modelName = modelInput?.value.trim() || 'AI 推导模型';
    const authorName = authorInput?.value.trim() || '热心读者';
    const remarks = remarksInput?.value.trim() || '';

    const submitBtn = this.aiUploadModal.querySelector('#ex-ai-upload-submit-btn') as HTMLButtonElement;
    if (submitBtn) submitBtn.disabled = true;

    const res = await exerciseDb.uploadCommunitySolution({
      question_id: this.activeUploadQuestionId,
      model_name: modelName,
      author_name: authorName,
      solution_md: solutionMd,
      remarks,
    });

    if (submitBtn) submitBtn.disabled = false;

    if (res.success && res.data) {
      this.aiUploadModal.classList.add('hidden');
      this.ctx.showToast('AI 题解已成功上传至统一题解库！');
      this.ctx.onAiSolutionUploaded(this.activeUploadQuestionId, res.data);
    } else {
      this.ctx.showToast('上传失败，请重试');
    }
  }
}
