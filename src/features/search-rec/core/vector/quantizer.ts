export interface QuantizedInt8Vector {
  data: Int8Array;
  scale: number;
}

export function quantizeToInt8(floatVec: Float32Array | number[]): QuantizedInt8Vector {
  let maxAbs = 0;
  const len = floatVec.length;
  for (let i = 0; i < len; i++) {
    const abs = Math.abs(floatVec[i]);
    if (abs > maxAbs) maxAbs = abs;
  }
  const scale = maxAbs === 0 ? 1 : maxAbs / 127;
  const int8Arr = new Int8Array(len);
  for (let i = 0; i < len; i++) {
    const val = Math.round(floatVec[i] / scale);
    int8Arr[i] = Math.max(-128, Math.min(127, val));
  }
  return { data: int8Arr, scale };
}

export function dequantizeFromInt8(int8Arr: Int8Array, scale: number): Float32Array {
  const len = int8Arr.length;
  const floatArr = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    floatArr[i] = int8Arr[i] * scale;
  }
  return floatArr;
}

export function dotProductFloatAndInt8(floatQuery: Float32Array | number[], int8Doc: Int8Array, docScale: number): number {
  let sum = 0;
  const len = int8Doc.length;
  for (let i = 0; i < len; i++) {
    sum += floatQuery[i] * int8Doc[i];
  }
  return sum * docScale;
}

export function dotProductFloat32(a: Float32Array | number[], b: Float32Array | number[]): number {
  let sum = 0;
  const len = a.length;
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}
