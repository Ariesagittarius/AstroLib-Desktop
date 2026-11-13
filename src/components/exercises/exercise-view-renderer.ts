/**
 * src/components/exercises/exercise-view-renderer.ts
 * ============================================================================
 * HTML and Component View Renderer for Exercise Center Cards and Solution Boxes
 * ============================================================================
 */

import { renderAcademicSolutionMarkdown as renderSolutionMarkdown } from './exercise-markdown';
import { exerciseDb, type CommunityAiSolution } from '../../utils/exercise-db/exercise-db-client';
import { getActiveAiModel, getAiProvider, type AiProviderId } from '../../ai/ai-config';
import type { SlimQuestionItem } from '../../types/exercises';
import type { UserPracticeRecord } from './exercise-controller.state';

export function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface CardRenderOptions {
  q: SlimQuestionItem;
  idx: number;
  record: UserPracticeRecord;
  activeVer: string;
  communityList: CommunityAiSolution[];
  currentSolutionMd: string;
  hasLocalAiSolution: boolean;
}

export function getAiModelLabel(qid: string, activeVer: string, communityList: CommunityAiSolution[]): string {
  if (activeVer !== 'local') {
    const match = communityList.find((s) => s.id === activeVer);
    if (match) return match.model_name;
  }
  return getActiveAiModel().label;
}

export function renderInteractiveArea(q: SlimQuestionItem, record: UserPracticeRecord): string {
  const qid = q.id;
  const qType = q.type;

  if (qType === 'choice' && q.options && q.options.length > 0) {
    return `
      <div class="ex-options-grid" data-qid="${qid}">
        ${q.options
          .map((opt) => {
            const optKey = opt.key;
            const isSelected = record.userChoice === optKey;
            let stateClass = '';
            if (record.answered) {
              if (optKey === q.answer) {
                stateClass = 'is-correct';
              } else if (isSelected) {
                stateClass = 'is-wrong';
              }
            }
            return `
              <button type="button" class="ex-option-btn ${stateClass} ${isSelected ? 'is-selected' : ''}" data-action="select-option" data-qid="${qid}" data-key="${optKey}">
                <span class="ex-option-key">${optKey}</span>
                <span class="ex-option-text">${opt.text_html || opt.text_raw}</span>
              </button>
            `;
          })
          .join('')}
      </div>
    `;
  }

  if (qType === 'blank') {
    const userVal = record.userBlank || '';
    const isAnswered = record.answered;
    let stateClass = '';
    if (isAnswered) {
      stateClass = record.isCorrect ? 'is-correct' : 'is-wrong';
    }
    return `
      <div class="ex-blank-wrap ${stateClass}" data-qid="${qid}">
        <input type="text" class="ex-blank-input" placeholder="输入填空计算结果 (支持 LaTeX 公式)..." value="${esc(userVal)}" ${isAnswered ? 'readonly' : ''} />
        <button type="button" class="ex-blank-check-btn" data-action="check-blank" data-qid="${qid}">
          ${isAnswered ? (record.isCorrect ? '正确' : '重做') : '核对答案'}
        </button>
      </div>
    `;
  }

  return '';
}

export function renderAiVersionsBarHtml(qid: string, activeVer: string, communityList: CommunityAiSolution[]): string {
  let pillsHtml = `
    <button type="button" class="ex-ai-ver-tab ${activeVer === 'local' ? 'active' : ''}" data-action="switch-ai-ver" data-qid="${qid}" data-ver="local">
      <span>本地实时推导</span>
    </button>
  `;

  communityList.forEach((sol) => {
    const isActive = activeVer === sol.id;
    const isUpvoted = exerciseDb.isUpvoted(sol.id);
    pillsHtml += `
      <div class="ex-ai-ver-item ${isActive ? 'active' : ''}">
        <button type="button" class="ex-ai-ver-tab ${isActive ? 'active' : ''}" data-action="switch-ai-ver" data-qid="${qid}" data-ver="${sol.id}">
          <span>${esc(sol.model_name)}</span>
          <span class="ex-ver-author">by ${esc(sol.author_name)}</span>
        </button>
        <button type="button" class="ex-ai-upvote-btn ${isUpvoted ? 'upvoted' : ''}" data-action="upvote-sol" data-sol-id="${sol.id}" data-qid="${qid}" title="点赞支持此题解">
          <md-icon class="ex-upvote-mdicon">thumb_up</md-icon>
          <span class="ex-upvote-count">${sol.upvotes || 0}</span>
        </button>
      </div>
    `;
  });

  return pillsHtml;
}

export function renderAiKeyConfigCardHtml(qid: string): string {
  const activeProvider = getAiProvider();
  const providers: { id: AiProviderId; label: string }[] = [
    { id: 'deepseek', label: 'DeepSeek (推荐·免翻)' },
    { id: 'gemini', label: 'Google Gemini' },
    { id: 'bupt', label: '北邮校内算力' },
    { id: 'custom', label: '自定义/反代' },
  ];

  let placeholder = '输入 API Key (sk-...)';
  if (activeProvider.id === 'gemini') {
    placeholder = '输入 Gemini API Key (AIzaSy...)';
  } else if (activeProvider.id === 'bupt') {
    placeholder = '输入北邮校内 API Key (sk-...)';
  }

  const showGeminiNotice = activeProvider.id === 'gemini';

  return `
    <div class="ex-ai-key-config hidden" id="ai-key-config-${qid}">
      <div class="ex-ai-key-prompt-card">
        <div class="ex-ai-key-header">
          <div class="ex-ai-key-title">
            <md-icon class="ex-key-mdicon">vpn_key</md-icon>
            <span>未配置 API Key · 请选择服务商并填写密钥</span>
          </div>
          <button type="button" class="ex-ai-key-settings-shortcut" data-action="open-ai-settings" title="打开全局高级模型与代理设置">
            <md-icon class="ex-shortcut-mdicon">settings</md-icon>
            <span>高级设置</span>
          </button>
        </div>

        <div class="ex-provider-chips-row">
          <span class="ex-provider-label">服务商：</span>
          <div class="ex-provider-chips">
            ${providers
              .map(
                (p) => `
              <button type="button" class="ex-provider-chip ${activeProvider.id === p.id ? 'active' : ''}" data-action="switch-provider-quick" data-provider="${p.id}" data-qid="${qid}">
                <span>${p.label}</span>
              </button>
            `
              )
              .join('')}
          </div>
        </div>

        <div class="ex-ai-key-input-row">
          <input type="password" class="ex-ai-key-input" placeholder="${placeholder}" autocomplete="off" />
          <button type="button" class="ex-ai-key-save-btn" data-action="save-ai-key" data-qid="${qid}">
            <span>保存并开始推导</span>
          </button>
        </div>

        ${
          showGeminiNotice
            ? `<div class="ex-ai-net-notice">
                <md-icon class="ex-notice-mdicon">info</md-icon>
                <span>Google Gemini 官方端点在大陆网络直连可能因防火墙拦截导致超时。若无可用网络代理，建议上方快速切换为 <strong>DeepSeek</strong> 或 <strong>北邮算力</strong>。</span>
              </div>`
            : ''
        }

        <div class="ex-ai-key-footnote">
          <span>密钥仅保存在本机浏览器本地（localStorage），不会上传至任何第三方服务器。</span>
        </div>
      </div>
    </div>
  `;
}

export function generateHeuristicHint(q: SlimQuestionItem): string {
  const qType = q.type;
  let strategy = '';
  if (qType === 'calc') {
    strategy = '本题为计算求解题。求解核心在于厘清题设条件与运算目标，选用恰当的代数恒等变形、微积分求导/积分法则或矩阵变换方法，注意运算符号与边界约束。';
  } else if (qType === 'proof') {
    strategy = '本题为严格证明题。建议从已知条件与相关定理的充要关系切入，可采用直接推导、构造反例反证法、或构造辅助函数/向量空间进行严密论证。';
  } else if (qType === 'choice') {
    strategy = '本题为单项选择题。解题时除常规严谨推演外，可灵活运用代入特殊值法、排除极端条件、反例验证或量纲检验等技巧快速突破。';
  } else if (qType === 'blank') {
    strategy = '本题为精准填空题。计算时需格外注重符号、定义域、区间开闭以及分母不为零等细节，保证最终解析表达式或数值的最简形式。';
  } else {
    strategy = '本题重点考查基础概念的综合运用与逻辑分析能力。请回顾教材相关章节的核心定理定义与典型例题解法。';
  }

  const kpsStr = q.kps && q.kps.length > 0 ? `本题关联考点：<strong>${q.kps.map((k) => esc(k)).join('、')}</strong>。` : '';
  const secStr = q.sec_title || q.sec ? `建议对照复习章节 <em>${esc(q.sec_title || q.sec || '')}</em> 的核心定理与推论。` : '';

  return `<p>${strategy}</p>${kpsStr || secStr ? `<p class="ex-hint-sub">${kpsStr} ${secStr}</p>` : ''}`;
}

export function renderSolutionBoxContent(q: SlimQuestionItem, record: UserPracticeRecord): string {
  const qid = q.id;
  const qType = q.type;
  const knowledgePoints = q.kps || [];

  const hasSteps = Boolean(q.steps_html && q.steps_html.trim());
  const rawAnswer = (q.answer || '').trim();
  const hasMeaningfulAnswer = Boolean(
    (q.answer_html && q.answer_html.trim() && !q.answer_html.includes('详见解析') && !q.answer_html.includes('略')) ||
    (rawAnswer && rawAnswer !== '详见解析' && rawAnswer !== '略')
  );

  let bodyContent = '';
  if (!hasSteps && !hasMeaningfulAnswer) {
    bodyContent = `
      <div class="ex-solution-empty-prompt">
        <div class="ex-empty-prompt-text">
          <md-icon class="ex-empty-icon">menu_book</md-icon>
          <span>教材原书暂未收录官方纯文本逐行演算。您可直接点击下方「AI 规范推导」，由学术大模型提供完整分步推导！</span>
        </div>
        <button type="button" class="ex-action-btn ex-btn-inline-ai" data-action="ask-ai" data-qid="${qid}">
          <md-icon class="ex-btn-mdicon">auto_awesome</md-icon>
          <span>立即生成 AI 规范推导</span>
        </button>
      </div>
    `;
  } else {
    bodyContent = `
      ${hasSteps ? `<div class="ex-solution-steps">${q.steps_html}</div>` : ''}
      ${q.hints_html ? `<div class="ex-solution-steps"><strong>【思路提示】</strong>${q.hints_html}</div>` : ''}
    `;
  }

  return `
    <div class="ex-solution-title">
      <span>【参考答案】${q.answer_html || '详见下方步骤推导'}</span>
    </div>
    ${bodyContent}
    <div class="ex-solution-footer">
      <div class="ex-knowledge-tags">
        <span class="ex-k-label">考察考点：</span>
        ${knowledgePoints.map((kp) => `<span class="ex-k-tag">${esc(kp)}</span>`).join('')}
      </div>
      ${
        qType !== 'choice' && qType !== 'blank'
          ? `<div class="ex-mastery-btns">
              <button type="button" class="ex-action-btn ${record.mastered ? 'active' : ''}" data-action="master" data-qid="${qid}">
                <span>${record.mastered ? '已掌握' : '标为已掌握'}</span>
              </button>
            </div>`
          : ''
      }
    </div>
  `;
}

export function renderHintsBoxContent(q: SlimQuestionItem): string {
  const qid = q.id;
  const knowledgePoints = q.kps || [];
  const hasOfficialHint = Boolean(q.hints_html && q.hints_html.trim());

  return `
    <div class="ex-hints-header">
      <div class="ex-hints-title">
        <md-icon class="ex-hints-mdicon">lightbulb</md-icon>
        <span>思路导引与考点剖析</span>
      </div>
      ${
        knowledgePoints.length > 0
          ? `<div class="ex-knowledge-tags">
              <span class="ex-k-label">考察考点：</span>
              ${knowledgePoints.map((kp) => `<span class="ex-k-tag">${esc(kp)}</span>`).join('')}
            </div>`
          : ''
      }
    </div>
    <div class="ex-hints-body">
      ${
        hasOfficialHint
          ? `<div class="ex-hints-text">${q.hints_html}</div>`
          : `<div class="ex-hints-heuristic">${generateHeuristicHint(q)}</div>`
      }
    </div>
    <div class="ex-hints-action-row">
      <button type="button" class="ex-action-btn ex-btn-inline-ai" data-action="ask-ai" data-qid="${qid}">
        <md-icon class="ex-btn-mdicon">auto_awesome</md-icon>
        <span>需要更详尽演算？点击生成 AI 规范推导</span>
      </button>
    </div>
  `;
}

export function renderSingleCardHtml(opts: CardRenderOptions): string {
  const { q, idx, record, activeVer, communityList, currentSolutionMd, hasLocalAiSolution } = opts;
  const qid = q.id;
  const qType = q.type;
  const typeLabel = qType === 'choice' ? '单选' : qType === 'blank' ? '填空' : qType === 'proof' ? '证明' : '解答';
  const secSlug = q.sec_slug || '';
  const paperQNum = q.paper_q_num || (idx + 1);

  const hasAnySolution = Boolean(currentSolutionMd) || hasLocalAiSolution;
  const aiSolutionHtml = currentSolutionMd
    ? renderSolutionMarkdown(currentSolutionMd, false)
    : '<div class="ex-ai-placeholder">点击下方「问 AI 题解」获取本题规范推导与考点解析...</div>';

  return `
    <div class="ex-q-card" id="q-card-${qid}" data-qid="${qid}" data-type="${qType}" data-answer="${esc(q.answer)}">
      <div class="ex-q-header">
        <div class="ex-q-meta-left">
          <span class="ex-q-num">第 ${idx + 1} 题</span>
          <span class="ex-q-type-label">· ${typeLabel}</span>
          ${q.source_type === 'textbook'
            ? `<span class="ex-q-source-badge textbook">教材 · ${q.group || 'A'}组</span>`
            : `<span class="ex-q-source-badge exam" title="来源：《大邮数学集》（CC BY-NC-SA 4.0）">真题自测</span>`}
        </div>
        <div class="ex-q-meta-right">
          <button type="button" class="ex-text-link-btn" data-action="open-feedback" data-qid="${qid}" title="向开发团队报告题干/公式/答案错误">
            <md-icon class="ex-meta-mdicon">flag</md-icon>
            <span>报错</span>
          </button>
          <button type="button" class="ex-text-link-btn" data-action="open-source-editor" data-qid="${qid}" title="查看或直接修改题目 JSON/LaTeX 源码 (Dev-Only)">
            <md-icon class="ex-meta-mdicon">code</md-icon>
            <span>源码</span>
          </button>
        </div>
      </div>

      <div class="ex-q-stem">
        ${q.stem_html}
      </div>

      <div class="ex-interactive-wrap">
        ${renderInteractiveArea(q, record)}
      </div>

      <div class="ex-q-source-row">
        <button type="button" class="ex-source-link" data-action="jump-to-paper" data-paper-id="${q.paper_id}" data-qid="${qid}" title="点击秒切至该试卷【${esc(q.paper_title)}】查看整卷所有题目">
          <span>${esc(q.source || `${q.paper_title} · 原卷第 ${paperQNum} 题`)}</span>
        </button>
        ${secSlug ? `<span class="ex-source-sec">· ${secSlug}</span>` : ''}
      </div>

      <div class="ex-card-actions">
        <div class="ex-left-actions">
          ${
            qType !== 'choice' && qType !== 'blank'
              ? `<button type="button" class="ex-action-btn ex-toggle-steps-btn ${record.revealedSolution ? 'active' : ''}" data-action="toggle-steps" data-qid="${qid}">
                  <md-icon class="ex-btn-mdicon">${record.revealedSolution ? 'visibility_off' : 'visibility'}</md-icon>
                  <span>${record.revealedSolution ? '收起解析' : '查看解析'}</span>
                </button>`
              : ''
          }
          <button type="button" class="ex-action-btn ex-toggle-hints-btn" data-action="toggle-hints" data-qid="${qid}">
            <md-icon class="ex-btn-mdicon">lightbulb</md-icon>
            <span>思路与考点</span>
          </button>
        </div>
        <div class="ex-right-actions">
          <button type="button" class="ex-action-btn ex-ask-ai-btn" data-action="ask-ai" data-qid="${qid}" title="在此题下方生成或查看 AI 规范推导">
            <md-icon class="ex-btn-mdicon">auto_awesome</md-icon>
            <span>问 AI 题解</span>
          </button>
        </div>
      </div>

      <div class="ex-hints-box hidden" id="hints-${qid}"></div>

      <div class="ex-solution-box ${record.answered || record.revealedSolution ? '' : 'hidden'}" id="sol-${qid}">
        ${(record.answered || record.revealedSolution) ? renderSolutionBoxContent(q, record) : ''}
      </div>

      <div class="ex-ai-box ${hasAnySolution ? '' : 'hidden'}" id="ai-box-${qid}">
        <div class="ex-ai-header">
          <div class="ex-ai-title">
            <span>AI 规范推导</span>
            <span class="ex-ai-model-badge" id="ai-model-${qid}">${getAiModelLabel(qid, activeVer, communityList)}</span>
            <span class="ex-ai-status" id="ai-status-${qid}">${hasAnySolution ? '推导就绪' : ''}</span>
          </div>
          <div class="ex-ai-tools">
            <button type="button" class="ex-ai-tool-btn ex-ai-chat-btn" data-action="bridge-ai-chat" data-qid="${qid}" title="携带本题完整题干转入全局 AI 学术助手进行连续深度问答">
              <md-icon class="ex-ai-tool-icon">forum</md-icon>
              <span>转入对话</span>
            </button>
            <button type="button" class="ex-ai-tool-btn ex-ai-settings-btn" data-action="open-ai-settings" data-qid="${qid}" title="打开全局 AI 模型与网络设置面板">
              <md-icon class="ex-ai-tool-icon">settings</md-icon>
              <span>设置</span>
            </button>
            <button type="button" class="ex-ai-tool-btn ex-ai-copy-btn ${hasAnySolution ? '' : 'hidden'}" data-action="copy-ai" data-qid="${qid}" title="复制 LaTeX / Markdown 题解">
              <span>复制</span>
            </button>
            <button type="button" class="ex-ai-tool-btn ex-ai-upload-btn" data-action="open-ai-upload" data-qid="${qid}" title="将我自己生成的 AI 题解上传到统一数据库共享给全网读者">
              <span>分享</span>
            </button>
            <button type="button" class="ex-ai-tool-btn ex-ai-retry-btn ${hasAnySolution ? '' : 'hidden'}" data-action="retry-ai" data-qid="${qid}" title="重新生成规范推导">
              <span>重算</span>
            </button>
            <button type="button" class="ex-ai-tool-btn ex-ai-stop-btn hidden" data-action="stop-ai" data-qid="${qid}" title="停止生成">
              <span>停止</span>
            </button>
            <button type="button" class="ex-ai-tool-btn ex-ai-toggle-btn" data-action="toggle-ai-box" data-qid="${qid}" title="收起/展开">
              <md-icon class="ex-ai-chevron">expand_less</md-icon>
            </button>
          </div>
        </div>

        <div class="ex-ai-versions-bar" id="ai-versions-${qid}">
          ${renderAiVersionsBarHtml(qid, activeVer, communityList)}
        </div>

        <div class="ex-ai-content" id="ai-content-${qid}">
          ${aiSolutionHtml}
        </div>

        ${renderAiKeyConfigCardHtml(qid)}
      </div>
    </div>
  `;
}
