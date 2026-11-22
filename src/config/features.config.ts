import type {
  FeatureCategory,
  FeatureConfig,
  FeatureDefInput,
  FeatureManifest,
  FeatureRegistry,
} from '../types/features.ts';

export const IS_DEV = typeof process !== 'undefined' && Boolean(process.argv?.includes('dev'));

const CATS = new Set<FeatureCategory>(['reader', 'extra', 'dev']);
const REFS = new Set(['interactive', 'static']);

export function defineFeature<T extends FeatureConfig = FeatureConfig>(def: FeatureDefInput<T>): FeatureManifest<T> {
  const d = def || ({} as FeatureDefInput<T>);
  if (!d.id || typeof d.id !== 'string') throw new Error('[features] 缺少 string 类型的 id');
  if (!CATS.has(d.cat)) throw new Error(`[features] ${d.id} 的 cat 非法：${d.cat}（允许 reader/extra/dev）`);
  if (typeof d.enabled !== 'boolean') throw new Error(`[features] ${d.id} 缺少 boolean 类型的 enabled`);
  if (typeof d.devOnly !== 'boolean') throw new Error(`[features] ${d.id} 缺少 boolean 类型的 devOnly`);
  if (typeof d.ui !== 'boolean') throw new Error(`[features] ${d.id} 缺少 boolean 类型的 ui`);
  if (d.config?.refs && !REFS.has(d.config.refs)) {
    throw new Error(`[features] ${d.id} 的 refs 非法：${d.config.refs}（允许 interactive/static）`);
  }
  return {
    id: d.id,
    cat: d.cat,
    label: d.label || d.id,
    desc: d.desc || '',
    enabled: d.enabled,
    devOnly: d.devOnly,
    ui: d.ui,
    ...(d.requires ? { requires: d.requires } : {}),
    ...(d.config ? { config: d.config } : {}),
  };
}

const featureDefs: Record<string, FeatureManifest<any>> = {
  katex: defineFeature({
    id: 'katex',
    cat: 'reader',
    label: 'KaTeX 公式',
    desc: '公式排版与源码回填（data-latex）',
    enabled: true,
    devOnly: false,
    ui: false,
  }),

  mathPromote: defineFeature({
    id: 'mathPromote',
    cat: 'reader',
    label: '数学变量智能提升',
    desc: '构建期智能提升正文孤立单字母数学变量与简式为 KaTeX 公式',
    enabled: true,
    devOnly: false,
    ui: false,
    requires: ['katex'],
  }),

  cjkPunctuation: defineFeature({
    id: 'cjkPunctuation',
    cat: 'reader',
    label: '学术标点与间距',
    desc: '构建期智能规范化正文标点并补齐学术专著句间呼吸间距',
    enabled: true,
    devOnly: false,
    ui: false,
  }),

  formulaActions: defineFeature({
    id: 'formulaActions',
    cat: 'reader',
    label: '公式操作与导出',
    desc: '正文公式快捷复制 LaTeX 源码与一键导出高清 SVG/PNG 图片',
    enabled: true,
    devOnly: false,
    ui: true,
    requires: ['katex'],
  }),

  theme: defineFeature({
    id: 'theme',
    cat: 'reader',
    label: '主题切换',
    desc: '亮/暗模式切换与 Material You 动态主题调配',
    enabled: true,
    devOnly: false,
    ui: true,
  }),

  fonts: defineFeature({
    id: 'fonts',
    cat: 'reader',
    label: '字体系统',
    desc: '读者可选字体档位 + 自托管思源 webfont',
    enabled: true,
    devOnly: false,
    ui: true,
    requires: ['theme'],
  }),

  crossRef: defineFeature({
    id: 'crossRef',
    cat: 'reader',
    label: '引用联动',
    desc: '正文引用徽章（interactive 联动 | static 纯静态 chip）',
    enabled: true,
    devOnly: false,
    ui: true,
    config: { refs: 'interactive' },
  }),

  imageBlur: defineFeature({
    id: 'imageBlur',
    cat: 'reader',
    label: '图像模糊占位',
    desc: '正文图片构建期生成 LQIP 高斯模糊占位并平滑渐变加载',
    enabled: false,
    devOnly: false,
    ui: false,
  }),

  mermaid: defineFeature({
    id: 'mermaid',
    cat: 'extra',
    label: 'Mermaid 图表',
    desc: 'MDX 代码块及流程图渲染',
    enabled: true,
    devOnly: false,
    ui: true,
  }),

  chapterExport: defineFeature({
    id: 'chapterExport',
    cat: 'extra',
    label: '章节 LaTeX / PDF 导出',
    desc: '导出当前章节为大学教材级 LaTeX 源码、离线可编译 ZIP 包或本地/云端编译 PDF',
    enabled: true,
    devOnly: false,
    ui: true,
  }),

  loadingIndicator: defineFeature({
    id: 'loadingIndicator',
    cat: 'reader',
    label: 'M3 加载动画风格',
    desc: '在 M3 灵动形变指示器与官方原生圆环 (@material/web) 之间自由切换',
    enabled: true,
    devOnly: false,
    ui: true,
  }),

  aiAsk: defineFeature({
    id: 'aiAsk',
    cat: 'extra',
    label: 'AI 智能问答',
    desc: '基于当前书籍知识库的检索式提问（RAG，构建期索引 + 客户端 BYOK 生成）',
    enabled: true,
    devOnly: false,
    ui: true,
    config: {
      provider: 'openai',
      retrieval: 'keyword',
      topK: 8,
      maxContextChars: 6000,
      maxAnswerTokens: 4096,
      defaultProvider: 'gemini',
      defaultModel: 'gemini-3.8-flash',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',

    },
  }),

  translation: defineFeature({
    id: 'translation',
    cat: 'reader',
    label: '章节双语助读与翻译',
    desc: '为英文教材提供结构无损的专业学术翻译与段落级双语对照',
    enabled: true,
    devOnly: false,
    ui: true,
    config: {
      defaultProvider: 'google',
      defaultDisplayMode: 'sidebar',
    },
  }),

  bilingualComparison: defineFeature({
    id: 'bilingualComparison',
    cat: 'reader',
    label: '双语对照与跨书关联',
    desc: '端侧轻量向量推理与大参数嵌入模型驱动的目录/段落多向模糊匹配、双栏流式阅读与热力图',
    enabled: true,
    devOnly: false,
    ui: true,
    config: {
      similarityThreshold: 0.6,
      maxLinksPerParagraph: 3,
      defaultDisplayMode: 'split',
      defaultModel: 'minilm-l12',
      availableModels: [
        {
          id: 'minilm-l12',
          name: 'paraphrase-multilingual-MiniLM-L12-v2',
          label: 'MiniLM-L12 (轻量版 · CPU量化)',
          dim: 384,
          description: '极致轻量，纯 Node.js CPU/AVX2 推理，低配置设备首选',
          provider: 'onnx-node',
        },
        {
          id: 'qwen3-0.6b',
          name: 'Qwen/Qwen3-Embedding-0.6B',
          label: 'Qwen3-Embedding-0.6B (大参数增强版)',
          dim: 1024,
          description: '0.6B 参数大模型，因果自回归架构，消除各向异性锥状坍缩，跨语言语义区分度极高',
          provider: 'python-qwen',
        },
      ],
    },
  }),

  infoHighlight: defineFeature({
    id: 'infoHighlight',
    cat: 'reader',
    label: '信息高亮与关注点透镜',
    desc: '基于香农信息论与本地 Qwen 模型因果自回归惊异度推导，智能淡化语法虚词并突出学术关键实体',
    enabled: true,
    devOnly: false,
    ui: true,
    config: {
      defaultMode: 'fade',
      defaultThreshold: 35,
      defaultFadeMin: 30,
      model: 'Qwen3-0.6B-Base',
    },
  }),

  exercises: defineFeature({
    id: 'exercises',
    cat: 'reader',
    label: '章节习题与真题自测',
    desc: '章节课后习题与《大邮数学集》（CC协议）历年真题独立交互做题、整卷试卷刷题',
    enabled: true,
    devOnly: false,
    ui: true,
    config: {
      defaultMode: 'practice',
      communitySolutions: true,
    },
  }),
};

export const features: FeatureRegistry = featureDefs;
export const FEATURE_IDS: string[] = Object.keys(features);

export function isEffective(id: string): boolean {
  const f = features[id];
  if (!f) return false;
  return f.enabled && (!f.devOnly || IS_DEV);
}

export function crossRefRefs(): 'interactive' | 'static' {
  return features.crossRef?.config?.refs ?? 'interactive';
}
