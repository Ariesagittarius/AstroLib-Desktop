/**
 * src/features/search-rec/services/storage.ts
 * 端侧向量资产加载与未打包书籍增量持久化服务 (IndexedDB / LocalStorage)
 */

import type { AcademicChunk } from '../types/candidate.ts';
import { quantizeToInt8, dequantizeFromInt8 } from '../core/vector/quantizer.ts';

const DB_NAME = 'astrolib_embeddings_db';
const DB_VERSION = 1;
const STORE_NAME = 'book_vectors';

export interface StoredBookVectors {
  bookId: string;
  dim: number;
  format: 'int8' | 'float32';
  count: number;
  // Int8 量化二进制
  scales: number[];
  int8Data: ArrayBuffer;
  chunks: AcademicChunk[];
  updatedAt: string;
}

/** 打开或初始化端侧 IndexedDB 数据库 */
function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'bookId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * 将增量向量化的切片持久化保存至端侧数据库
 */
export async function saveBookVectorsToLocal(record: StoredBookVectors): Promise<boolean> {
  const db = await openDatabase();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * 从端侧数据库读取某本书的增量向量
 */
export async function loadBookVectorsFromLocal(bookId: string): Promise<StoredBookVectors | null> {
  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(bookId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * 二进制格式解析：将 embeddings.bin 解析为内存在用的 Int8 与 Float32 向量数组
 */
export function parseEmbeddingsBinary(buffer: ArrayBuffer): {
  dim: number;
  format: 'int8' | 'float32';
  count: number;
  int8Vectors?: Array<{ scale: number; data: Int8Array }>;
  float32Vectors?: Float32Array[];
} {
  const dataView = new DataView(buffer);
  // 读取 Magic ABP1
  const m0 = String.fromCharCode(dataView.getUint8(0));
  const m1 = String.fromCharCode(dataView.getUint8(1));
  const m2 = String.fromCharCode(dataView.getUint8(2));
  const m3 = String.fromCharCode(dataView.getUint8(3));
  if (m0 !== 'A' || m1 !== 'B' || m2 !== 'P' || m3 !== '1') {
    throw new Error('无效的 ABP 向量文件魔数');
  }

  const formatCode = dataView.getUint8(4);
  const format: 'int8' | 'float32' = formatCode === 1 ? 'int8' : 'float32';
  const dim = dataView.getUint16(5, true);
  const count = dataView.getUint32(7, true);

  let offset = 11;

  if (format === 'int8') {
    const int8Vectors: Array<{ scale: number; data: Int8Array }> = [];
    for (let i = 0; i < count; i++) {
      const scale = dataView.getFloat32(offset, true);
      offset += 4;
      const data = new Int8Array(buffer, offset, dim);
      offset += dim;
      int8Vectors.push({ scale, data });
    }
    return { dim, format, count, int8Vectors };
  } else {
    const float32Vectors: Float32Array[] = [];
    for (let i = 0; i < count; i++) {
      const data = new Float32Array(buffer, offset, dim);
      offset += dim * 4;
      float32Vectors.push(data);
    }
    return { dim, format, count, float32Vectors };
  }
}

/**
 * 二进制格式序列化：将 Float32 向量批量压缩序列化为 embeddings.bin
 */
export function serializeEmbeddingsBinary(
  vectors: Float32Array[],
  format: 'int8' | 'float32' = 'int8',
): { buffer: Buffer | ArrayBuffer; dim: number; count: number } {
  const count = vectors.length;
  const dim = count > 0 ? vectors[0].length : 0;

  // Header 11 bytes: 4 magic + 1 format + 2 dim + 4 count
  const headerSize = 11;
  const bodySize = format === 'int8' ? count * (4 + dim) : count * (dim * 4);
  const totalSize = headerSize + bodySize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // Magic 'ABP1'
  view.setUint8(0, 'A'.charCodeAt(0));
  view.setUint8(1, 'B'.charCodeAt(0));
  view.setUint8(2, 'P'.charCodeAt(0));
  view.setUint8(3, '1'.charCodeAt(0));
  view.setUint8(4, format === 'int8' ? 1 : 4);
  view.setUint16(5, dim, true);
  view.setUint32(7, count, true);

  let offset = headerSize;

  if (format === 'int8') {
    for (const v of vectors) {
      const q = quantizeToInt8(v);
      view.setFloat32(offset, q.scale, true);
      offset += 4;
      const int8Slice = new Int8Array(buffer, offset, dim);
      int8Slice.set(q.data);
      offset += dim;
    }
  } else {
    for (const v of vectors) {
      const floatSlice = new Float32Array(buffer, offset, dim);
      floatSlice.set(v);
      offset += dim * 4;
    }
  }

  return { buffer, dim, count };
}
