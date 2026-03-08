/**
 * upscaler-worker.js — Web Worker para upscaling con ONNX Runtime Web
 * Usa modelos swin_unet de waifu2x desde liud15/waifu2x-models
 */

import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.mjs';

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
ort.env.wasm.numThreads = 1;

const MODELS_BASE = 'https://raw.githubusercontent.com/liud15/waifu2x-models/main/swin_unet';

const MODEL_URLS = {
  'art-noise0':   `${MODELS_BASE}/art/noise0_scale2x.onnx`,
  'art-noise1':   `${MODELS_BASE}/art/noise1_scale2x.onnx`,
  'art-noise2':   `${MODELS_BASE}/art/noise2_scale2x.onnx`,
  'art-noise3':   `${MODELS_BASE}/art/noise3_scale2x.onnx`,
  'photo-noise0': `${MODELS_BASE}/photo/noise0_scale2x.onnx`,
  'photo-noise1': `${MODELS_BASE}/photo/noise1_scale2x.onnx`,
  'photo-noise2': `${MODELS_BASE}/photo/noise2_scale2x.onnx`,
  'photo-noise3': `${MODELS_BASE}/photo/noise3_scale2x.onnx`,
};

const sessionCache = {};

const DB_NAME  = 'waifu2x-model-cache-v6';
const DB_STORE = 'models';


/* ───────── IndexedDB ───────── */

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

    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');

      tx.objectStore(DB_STORE).put(data, key);

      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch {}
}


/* ───────── Cargar modelo ONNX ───────── */

async function loadModel(modelKey) {

  if (sessionCache[modelKey]) return sessionCache[modelKey];

  const url = MODEL_URLS[modelKey];
  if (!url) throw new Error(`Modelo desconocido: ${modelKey}`);

  self.postMessage({ type: 'model-loading', modelKey });

  let modelBuffer = await getFromDB(modelKey);

  if (!modelBuffer) {

    self.postMessage({ type: 'download-start', modelKey });

    const response = await fetch(url);

    if (!response.ok)
      throw new Error(`HTTP ${response.status} al descargar modelo`);

    const contentLength = response.headers.get('Content-Length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;

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

    const buffer = new Uint8Array(received);

    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }

    modelBuffer = buffer;

    await saveToDB(modelKey, buffer.buffer);

    self.postMessage({ type: 'download-done' });

  } else {

    self.postMessage({ type: 'model-cached', modelKey });

    if (!(modelBuffer instanceof Uint8Array))
      modelBuffer = new Uint8Array(modelBuffer);
  }


  self.postMessage({ type: 'progress', percent: 0, stage: 'Cargando motor IA...' });


  // SOLUCIÓN AL ERROR
  // Usar solo los bytes reales del modelo

  let modelData;
  if (modelBuffer instanceof Uint8Array) {
    modelData = modelBuffer;
  } else if (modelBuffer instanceof ArrayBuffer) {
    modelData = new Uint8Array(modelBuffer);
  } else {
    throw new Error("Formato de modelo inválido");
  }

const session = await ort.InferenceSession.create(modelData, {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'all'
});

  const session = await ort.InferenceSession.create(cleanBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });

  sessionCache[modelKey] = session;

  return session;
}


/* ───────── ImageData → Tensor ───────── */

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

      tensor[rOff + dstIdx] = pixels[srcIdx] / 255;
      tensor[gOff + dstIdx] = pixels[srcIdx + 1] / 255;
      tensor[bOff + dstIdx] = pixels[srcIdx + 2] / 255;
    }
  }

  return new ort.Tensor('float32', tensor, [1, 3, h, w]);
}


/* ───────── Procesamiento ───────── */

async function processImage(imageData, width, height, modelKey, scale) {

  const session = await loadModel(modelKey);

  const tensor = imageDataToTensor(imageData, 0, 0, width, height, width, height);

  const feeds = {};
  feeds[session.inputNames[0]] = tensor;

  const results = await session.run(feeds);

  const outTensor = results[session.outputNames[0]];

  const outW = outTensor.dims[3];
  const outH = outTensor.dims[2];

  const pixels = new Uint8ClampedArray(outW * outH * 4);

  const data = outTensor.data;

  const plane = outW * outH;

  for (let i = 0; i < plane; i++) {

    const r = data[i] * 255;
    const g = data[i + plane] * 255;
    const b = data[i + plane * 2] * 255;

    const p = i * 4;

    pixels[p] = r;
    pixels[p + 1] = g;
    pixels[p + 2] = b;
    pixels[p + 3] = 255;
  }

  return new ImageData(pixels, outW, outH);
}


/* ───────── Worker ───────── */

self.onmessage = async (e) => {

  const { type, imageData, width, height, modelKey, scale } = e.data;

  if (type !== 'process') return;

  try {

    const result = await processImage(
      imageData,
      width,
      height,
      modelKey,
      scale || 2
    );

    self.postMessage(
      { type: 'result', imageData: result },
      [result.data.buffer]
    );

  } catch (err) {

    console.error(err);

    self.postMessage({
      type: 'error',
      message: err.message || String(err),
    });
  }
};
