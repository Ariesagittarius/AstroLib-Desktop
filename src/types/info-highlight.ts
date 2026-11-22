export interface TokenSurprisal {

  offset: [number, number];

  raw: string;

  prob: number;

  surprisalBits: number;

  ciRatio: number;

  level: number;
}

export interface InfoHighlightResult {

  tokens: TokenSurprisal[];

  inputTokens: number;

  inferenceTimeMs: number;

  modelName: string;

  device: string;

  vramAllocatedMB?: number;
}

export type HighlightMode = 'fade' | 'block' | 'underline';

export interface HighlightConfig {

  mode: HighlightMode;

  thresholdPct: number;

  fadeMinPct: number;

  intensity: number;
}

export interface InfoHighlightStatus {

  available: boolean;

  ready: boolean;

  modelPath: string | null;

  pythonPath: string | null;

  device: string;

  error?: string;
}
