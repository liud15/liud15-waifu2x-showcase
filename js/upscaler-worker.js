/**
 * upscaler-worker.js — Web Worker para upscaling con ONNX Runtime Web
 * Usa modelos reales de waifu2x (swin_unet) vía deepghs/waifu2x_onnx en HuggingFace
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
 *   { type: 'error', message }
 */

'use strict';

// Importar ONNX Runtime Web desde CDN
importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.js');

// Configurar paths de WASM antes de crear cualquier sesión
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
ort.env.wasm.numThreads = 1; // Más estable en workers

const HF_BASE = 'https://huggingface.co/deepghs/waifu2x_onnx/resolve/main/20250502/onnx_models/swin_unet';

const MODEL_URLS = {
  'art-noise0':   `${HF_BASE}/art/noise0_scale2x.onnx`,
  'art-noise1':   `${HF_BASE}/art/noise1_scale2x.onnx`,
  'art-noise2':   `${HF_BASE}/art/noise2_scale2x.onnx`,
  'art-noise3':   `${HF_BASE}/art/noise3_scale2x.onnx`,
  'photo-noise0': `${HF_BASE}/photo/noise0_scale2x.onnx`,
  'photo-noise1': `${HF_BASE}/photo/noise1_scale2x.onnx`,
  'photo-noise2': `${HF_BASE}/photo/noise2_scale2x.onnx`,
  'photo-noise3': `${HF_BASE}/photo/noise3_scale2x.onnx`,
};

// Caché en memoria de sesiones ONNX (en memoria del worker)
const sessionCache = {};

const DB_NAME  = 'waifu2x-model-cache-v1';
const DB_STORE = 'models';

/* ── IndexedDB helpers ── */
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
  } catch { return null; }
}

async function saveToDB(key, data) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(data, key);
      tx.oncomplete = resolve;
      tx.onerror = resolve; // No critical
    });
  } catch {}
}

/* ── Cargar modelo ONNX ── */
async function loadModel(modelKey) {
  if (sessionCache[modelKey]) return sessionCache[modelKey];

  const url = MODEL_URLS[modelKey];
  if (!url) throw new Error(`Modelo desconocido: ${modelKey}`);

  self.postMessage({ type: 'model-loading', modelKey });

  // Intentar desde IndexedDB
  let modelBuffer = await getFromDB(modelKey);

  if (!modelBuffer) {
    // Descargar con progreso
    self.postMessage({ type: 'download-start', modelKey });

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} al descargar modelo`);

    const contentLength = response.headers.get('Content-Length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    // Leer con progreso
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

    // Concatenar chunks
    modelBuffer = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      modelBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Guardar en caché
    await saveToDB(modelKey, modelBuffer);
    self.postMessage({ type: 'download-done' });
  } else {
    self.postMessage({ type: 'model-cached', modelKey });
  }

  // Crear sesión ONNX
  self.postMessage({ type: 'progress', percent: 0, stage: 'Cargando motor IA...' });

  // modelBuffer puede ser Uint8Array o ArrayBuffer — manejar ambos casos
  const buffer = modelBuffer instanceof Uint8Array ? modelBuffer.buffer : modelBuffer;
  const session = await ort.InferenceSession.create(buffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });

  sessionCache[modelKey] = session;
  return session;
}

/* ── Conversión ImageData → Tensor CHW Float32 ── */
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
      tensor[rOff + dstIdx] = pixels[srcIdx]     / 255.0;
      tensor[gOff + dstIdx] = pixels[srcIdx + 1] / 255.0;
      tensor[bOff + dstIdx] = pixels[srcIdx + 2] / 255.0;
    }
  }
  return new ort.Tensor('float32', tensor, [1, 3, h, w]);
}

/* ── Escribir tensor CHW → buffer de salida RGBA ── */
function tensorToImageData(tensor, outData, dstX, dstY, outW, outH, padLeft, padTop, padRight, padBottom) {
  const data = tensor.data;
  const tH = tensor.dims[2];
  const tW = tensor.dims[3];
  const writeH = tH - padTop - padBottom;
  const writeW = tW - padLeft - padRight;

  for (let row = 0; row < writeH; row++) {
    for (let col = 0; col < writeW; col++) {
      const srcRow = row + padTop;
      const srcCol = col + padLeft;
      const rVal = data[0 * tH * tW + srcRow * tW + srcCol];
      const gVal = data[1 * tH * tW + srcRow * tW + srcCol];
      const bVal = data[2 * tH * tW + srcRow * tW + srcCol];
      const dstIdx = ((dstY + row) * outW + (dstX + col)) * 4;
      outData[dstIdx]     = Math.max(0, Math.min(255, Math.round(rVal * 255)));
      outData[dstIdx + 1] = Math.max(0, Math.min(255, Math.round(gVal * 255)));
      outData[dstIdx + 2] = Math.max(0, Math.min(255, Math.round(bVal * 255)));
      outData[dstIdx + 3] = 255;
    }
  }
}

/* ── Procesamiento principal por tiles ── */
async function processImage(imageData, width, height, modelKey, targetScale) {
  const session = await loadModel(modelKey);

  // El modelo hace 2x — para otros scales aplicamos post-procesado
  const TILE = 64; // tile input size
  const PAD  = 4;  // padding en pixels

  const outW2x = width  * 2;
  const outH2x = height * 2;
  const outPixels = new Uint8ClampedArray(outW2x * outH2x * 4);

  const tilesX = Math.ceil(width  / TILE);
  const tilesY = Math.ceil(height / TILE);
  const totalTiles = tilesX * tilesY;
  let doneTiles = 0;

  self.postMessage({ type: 'progress', percent: 5, stage: 'Procesando con IA...' });

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      // Coordenadas del tile (con padding)
      const x0 = Math.max(0, tx * TILE - PAD);
      const y0 = Math.max(0, ty * TILE - PAD);
      const x1 = Math.min(width,  (tx + 1) * TILE + PAD);
      const y1 = Math.min(height, (ty + 1) * TILE + PAD);
      const tw = x1 - x0;
      const th = y1 - y0;

      // Padding real (puede ser menor en bordes)
      const padL = tx * TILE - x0;
      const padT = ty * TILE - y0;
      const padR = x1 - Math.min(width,  (tx + 1) * TILE);
      const padB = y1 - Math.min(height, (ty + 1) * TILE);

      // Tensor de entrada
      const inputTensor = imageDataToTensor(imageData, x0, y0, tw, th, width, height);

      // Inferencia
      const feeds = {};
      feeds[session.inputNames[0]] = inputTensor;
      const results = await session.run(feeds);
      const outTensor = results[session.outputNames[0]];

      // Escribir en el buffer de salida 2x
      const dstX = tx * TILE * 2;
      const dstY = ty * TILE * 2;
      tensorToImageData(
        outTensor, outPixels,
        dstX, dstY, outW2x, outH2x,
        padL * 2, padT * 2, padR * 2, padB * 2
      );

      doneTiles++;
      const pct = Math.round(5 + (doneTiles / totalTiles) * 85);
      self.postMessage({ type: 'progress', percent: pct, stage: `Tiles ${doneTiles}/${totalTiles}...` });

      // Yield al event loop cada 4 tiles para permitir que los mensajes de progreso
      // se procesen en el hilo principal y evitar que el worker bloquee indefinidamente
      if (doneTiles % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }
  }

  // Crear ImageData 2x
  const result2x = new ImageData(outPixels, outW2x, outH2x);

  // Si se pide escala 2x, devolver directamente
  if (targetScale === 2) {
    return result2x;
  }

  // Para 3x y 4x: escalar desde el resultado 2x con OffscreenCanvas
  const finalW = width  * targetScale;
  const finalH = height * targetScale;
  const offscreen = new OffscreenCanvas(finalW, finalH);
  const ctx = offscreen.getContext('2d');

  // Dibujar el resultado 2x en un canvas temporal
  const tmpCanvas = new OffscreenCanvas(outW2x, outH2x);
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.putImageData(result2x, 0, 0);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmpCanvas, 0, 0, finalW, finalH);

  return ctx.getImageData(0, 0, finalW, finalH);
}

/* ── Handler principal ── */
self.onmessage = async (e) => {
  const { type, imageData, width, height, modelKey, scale } = e.data;

  if (type !== 'process') return;

  try {
    const result = await processImage(imageData, width, height, modelKey, scale || 2);
    self.postMessage({ type: 'result', imageData: result }, [result.data.buffer]);
  } catch (err) {
    console.error('[Worker] Error:', err);
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
