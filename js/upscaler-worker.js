/**
 * upscaler-worker.js — Web Worker para upscaling con ONNX Runtime Web
 * Usa modelos swin_unet de waifu2x desde liud15/waifu2x-models vía raw.githubusercontent.com (CORS)
 *
 * Mensajes recibidos:
 *   { type: 'process', imageData, width, height, modelKey, scale }
 *
 * Mensajes enviados:
 *   { type: 'model-loading', modelKey }
 *   { type: 'model-cached', modelKey }
 *   { type: 'download-start', modelKey }
 *   { type: 'download-progress', percent }
 *   { type: 'download-done' }
 *   { type: 'progress', percent, stage }
 *   { type: 'result', imageData }
 *   { type: 'error', message, details }
 */

import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.mjs';

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
ort.env.wasm.numThreads = 1;

const MODELS_BASE = 'https://raw.githubusercontent.com/liud15/waifu2x-models/main/swin_unet';

const MODEL_URLS = {
  'art-noise0': `${MODELS_BASE}/art/noise0_scale2x.onnx`,
  'art-noise1': `${MODELS_BASE}/art/noise1_scale2x.onnx`,
  'art-noise2': `${MODELS_BASE}/art/noise2_scale2x.onnx`,
  'art-noise3': `${MODELS_BASE}/art/noise3_scale2x.onnx`,
  'photo-noise0': `${MODELS_BASE}/photo/noise0_scale2x.onnx`,
  'photo-noise1': `${MODELS_BASE}/photo/noise1_scale2x.onnx`,
  'photo-noise2': `${MODELS_BASE}/photo/noise2_scale2x.onnx`,
  'photo-noise3': `${MODELS_BASE}/photo/noise3_scale2x.onnx`
};

const sessionCache = {};

const DB_NAME = 'waifu2x-model-cache-v5';
const DB_STORE = 'models';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function getFromDB(key) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function saveToDB(key, data) {
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(data, key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch {
    // no-op (cache is best effort)
  }
}

function toTightUint8Array(value) {
  if (value instanceof Uint8Array) {
    const start = value.byteOffset;
    const end = start + value.byteLength;
    return value.buffer.byteLength === value.byteLength ? value : new Uint8Array(value.buffer.slice(start, end));
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (value?.buffer instanceof ArrayBuffer && typeof value.byteOffset === 'number' && typeof value.byteLength === 'number') {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }

  throw new Error(`Formato de buffer no soportado: ${Object.prototype.toString.call(value)}`);
}

function serializeError(err, context = {}) {
  const fallbackMessage = err && err.message ? err.message : String(err);
  return {
    message: fallbackMessage,
    details: {
      context,
      name: err?.name || null,
      message: err?.message || String(err),
      stack: err?.stack || null,
      code: err?.code ?? null,
      errno: err?.errno ?? null,
      status: err?.status ?? null,
      cause: err?.cause ? String(err.cause) : null,
    },
  };
}

async function downloadModelWithProgress(url, modelKey) {
  self.postMessage({ type: 'download-start', modelKey });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} al descargar modelo`);
  }

  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    self.postMessage({ type: 'download-progress', percent: 100 });
    self.postMessage({ type: 'download-done' });
    return new Uint8Array(arrayBuffer);
  }

  const contentLength = response.headers.get('Content-Length');
  const total = contentLength ? Number.parseInt(contentLength, 10) : 0;

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;

    if (total > 0) {
      const pct = Math.round((received / total) * 100);
      self.postMessage({ type: 'download-progress', percent: pct });
    }
  }

  const modelBuffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    modelBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  self.postMessage({ type: 'download-done' });
  return modelBuffer;
}

async function loadModel(modelKey) {
  if (sessionCache[modelKey]) return sessionCache[modelKey];

  const url = MODEL_URLS[modelKey];
  if (!url) throw new Error(`Modelo desconocido: ${modelKey}`);

  self.postMessage({ type: 'model-loading', modelKey });

  let rawBuffer = await getFromDB(modelKey);

  if (!rawBuffer) {
    rawBuffer = await downloadModelWithProgress(url, modelKey);
    await saveToDB(modelKey, rawBuffer);
  } else {
    self.postMessage({ type: 'model-cached', modelKey });
  }

    const modelBytes = toTightUint8Array(rawBuffer);

  console.log(
    `[Worker] Modelo ${modelKey}: ${modelBytes.byteLength} bytes (offset=${modelBytes.byteOffset}, backing=${modelBytes.buffer.byteLength})`,
  );

  self.postMessage({ type: 'progress', percent: 0, stage: 'Cargando motor IA...' });

  try {
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    console.log('[Worker] Session inputNames:', session.inputNames);
    console.log('[Worker] Session outputNames:', session.outputNames);

    sessionCache[modelKey] = session;
    return session;
  } catch (err) {
    const serialized = serializeError(err, {
      phase: 'ort.InferenceSession.create',
      modelKey,
      modelBytesLength: modelBytes.byteLength,
      modelBytesOffset: modelBytes.byteOffset,
      modelBackingBufferLength: modelBytes.buffer.byteLength,
    });

    console.error('[Worker] Error creando sesión ONNX:', serialized.details);
    throw Object.assign(new Error(serialized.message), { details: serialized.details });
  }
}

function imageDataToTensor(imageData, x, y, w, h, srcWidth, srcHeight) {
  const pixels = imageData.data;
  const tensor = new Float32Array(3 * h * w);
  const rOff = 0;
  const gOff = h * w;
  const bOff = 2 * h * w;

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const srcX = Math.min(x + col, srcWidth - 1);
      const srcY = Math.min(y + row, srcHeight - 1);
      const srcIdx = (srcY * srcWidth + srcX) * 4;
      const dstIdx = row * w + col;
      tensor[rOff + dstIdx] = pixels[srcIdx] / 255.0;
      tensor[gOff + dstIdx] = pixels[srcIdx + 1] / 255.0;
      tensor[bOff + dstIdx] = pixels[srcIdx + 2] / 255.0;
    }
  }
  return new ort.Tensor('float32', tensor, [1, 3, h, w]);
}

async function processImage(imageData, width, height, modelKey, targetScale) {
  const session = await loadModel(modelKey);

  const testW = 8;
  const testH = 8;
  const testInput = new ort.Tensor('float32', new Float32Array(3 * testH * testW), [1, 3, testH, testW]);
  const testFeeds = {};
  testFeeds[session.inputNames[0]] = testInput;
  const testResult = await session.run(testFeeds);
  const testOut = testResult[session.outputNames[0]];
  const modelScaleH = testOut.dims[2] / testH;
  const modelScaleW = testOut.dims[3] / testW;

  const TILE = 128;
  const PAD = 8;

  const outW = Math.round(width * modelScaleW);
  const outH = Math.round(height * modelScaleH);
  const outPixels = new Uint8ClampedArray(outW * outH * 4);
  for (let i = 3; i < outPixels.length; i += 4) outPixels[i] = 255;

  const tilesX = Math.ceil(width / TILE);
  const tilesY = Math.ceil(height / TILE);
  const totalTiles = tilesX * tilesY;
  let doneTiles = 0;

  self.postMessage({ type: 'progress', percent: 5, stage: 'Procesando con IA...' });

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tileX0 = tx * TILE;
      const tileY0 = ty * TILE;
      const tileX1 = Math.min(width, (tx + 1) * TILE);
      const tileY1 = Math.min(height, (ty + 1) * TILE);

      const x0 = Math.max(0, tileX0 - PAD);
      const y0 = Math.max(0, tileY0 - PAD);
      const x1 = Math.min(width, tileX1 + PAD);
      const y1 = Math.min(height, tileY1 + PAD);
      const tw = x1 - x0;
      const th = y1 - y0;

      const padL = tileX0 - x0;
      const padT = tileY0 - y0;
      const padR = x1 - tileX1;
      const padB = y1 - tileY1;

      const inputTensor = imageDataToTensor(imageData, x0, y0, tw, th, width, height);

      const feeds = {};
      feeds[session.inputNames[0]] = inputTensor;
      const results = await session.run(feeds);
      const outTensor = results[session.outputNames[0]];

      const outTH = outTensor.dims[2];
      const outTW = outTensor.dims[3];

      const outPadL = Math.round(padL * modelScaleW);
      const outPadT = Math.round(padT * modelScaleH);
      const outPadR = Math.round(padR * modelScaleW);
      const outPadB = Math.round(padB * modelScaleH);

      const dstX = Math.round(tileX0 * modelScaleW);
      const dstY = Math.round(tileY0 * modelScaleH);

      const copyW = outTW - outPadL - outPadR;
      const copyH = outTH - outPadT - outPadB;

      const tensorData = outTensor.data;
      for (let row = 0; row < copyH; row++) {
        for (let col = 0; col < copyW; col++) {
          const srcRow = row + outPadT;
          const srcCol = col + outPadL;
          const rVal = tensorData[srcRow * outTW + srcCol];
          const gVal = tensorData[outTH * outTW + srcRow * outTW + srcCol];
          const bVal = tensorData[2 * outTH * outTW + srcRow * outTW + srcCol];
          const dstRow = dstY + row;
          const dstCol = dstX + col;
          
          if (dstRow >= 0 && dstRow < outH && dstCol >= 0 && dstCol < outW) {
            const dstIdx = (dstRow * outW + dstCol) * 4;
            outPixels[dstIdx] = Math.max(0, Math.min(255, Math.round(rVal * 255)));
            outPixels[dstIdx + 1] = Math.max(0, Math.min(255, Math.round(gVal * 255)));
            outPixels[dstIdx + 2] = Math.max(0, Math.min(255, Math.round(bVal * 255)));
            outPixels[dstIdx + 3] = 255;
          }
        }
      }

      doneTiles++;
      const pct = Math.round(5 + (doneTiles / totalTiles) * 85);
      self.postMessage({ type: 'progress', percent: pct, stage: `Tiles ${doneTiles}/${totalTiles}...` });

      if (doneTiles % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const result2x = new ImageData(outPixels, outW, outH);
  if (targetScale === 2) return result2x;

  const finalW = Math.round(width * targetScale);
  const finalH = Math.round(height * targetScale);
  const offscreen = new OffscreenCanvas(finalW, finalH);
  const ctx = offscreen.getContext('2d');

  const tmpCanvas = new OffscreenCanvas(outW, outH);
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.putImageData(result2x, 0, 0);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmpCanvas, 0, 0, finalW, finalH);

  return ctx.getImageData(0, 0, finalW, finalH);
}

self.onmessage = async (e) => {
  const { type, imageData, width, height, modelKey, scale } = e.data;
  if (type !== 'process') return;

  try {
    const result = await processImage(imageData, width, height, modelKey, scale || 2);
    self.postMessage({ type: 'result', imageData: result }, [result.data.buffer]);
  } catch (err) {
      const serialized = serializeError(err, {
      phase: 'worker.onmessage/process',
      modelKey,
      width,
      height,
      scale: scale || 2,
    });

    console.error('[Worker] Error:', serialized.details);
    self.postMessage({
      type: 'error',
      message: serialized.message,
      details: serialized.details,
    });
  }
};
