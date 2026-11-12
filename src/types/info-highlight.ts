/**
 * src/types/info-highlight.ts
 * ============================================================================
 * AstroLib 信息高亮与关注点透镜 (InfoLens / Shannon Surprisal Highlight) 类型定义
 * ============================================================================
 * 遵循 Rule 1 (UI is not a domain model)：领域模型与表现层解耦
 */

export interface TokenSurprisal {
  /** 字符级起止偏移 [start, end] */
  offset: [number, number];
  /** 原始 Token 字符串 */
  raw: string;
  /** 真实预测条件概率 P(w_t | w_<t) */
  prob: number;
  /** 惊异度 / 信息量 S(w_t) = -log2(P)，单位 bit */
  surprisalBits: number;
  /** 条件信息量比率 CI = clamp(S / 18, 0, 1) */
  ciRatio: number;
  /** 视觉档位 (0 - 15) */
  level: number;
}

export interface InfoHighlightResult {
  /** 分词与惊异度打分结果 */
  tokens: TokenSurprisal[];
  /** 输入的总 Token 数 */
  inputTokens: number;
  /** 推理耗时 (毫秒) */
  inferenceTimeMs: number;
  /** 模型名称 (如 Qwen3-0.6B-Base) */
  modelName: string;
  /** 运行设备 (如 CUDA / RTX 5060, CPU) */
  device: string;
  /** 显存已分配 (MB) */
  vramAllocatedMB?: number;
}

export type HighlightMode = 'fade' | 'block' | 'underline';

export interface HighlightConfig {
  /** 视觉渲染模式：fade(智能淡化/跳读), block(微色块), underline(学术下划线) */
  mode: HighlightMode;
  /** 过滤阈值百分比 (0 - 100)，低于该阈值的被视为低信息冗余 */
  thresholdPct: number;
  /** 最低不透明度下限 (0 - 50%，仅在 fade 模式生效，默认 30%) */
  fadeMinPct: number;
  /** 高亮强度百分比 (5 - 100%) */
  intensity: number;
}

export interface InfoHighlightStatus {
  /** 服务与模型是否整体可用 */
  available: boolean;
  /** 常驻守护进程是否已加载模型就绪 */
  ready: boolean;
  /** 模型本地权重路径 */
  modelPath: string | null;
  /** Python 解释器路径 */
  pythonPath: string | null;
  /** 硬件计算设备 (如 NVIDIA GeForce RTX 5060 Laptop GPU / CUDA) */
  device: string;
  /** 错误信息 */
  error?: string;
}
