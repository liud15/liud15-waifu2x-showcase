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
 *   { type: 'error', message }
 */

// Importar ONNX Runtime Web como módulo ES (compatible con GitHub Pages)
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.mjs';

// Configurar paths de WASM antes de crear cualquier sesión
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
ort.env.wasm.numThreads = 1;

// raw.githubusercontent.com sirve binarios directos con CORS habilitado (sin compresión)
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

// Caché en memoria de sesiones ONNX (en memoria del worker)
const sessionCache = {};

const DB_NAME  = 'waifu2x-model-cache-v5';
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

    // Usar fetch sin compresión para asegurar bytes raw del ONNX
    const response = await fetch(url, { headers: { 'Accept-Encoding': 'identity' } });
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

    console.log(`[Worker] Descargado: ${received} bytes, magic: 0x${modelBuffer[0].toString(16).padStart(2,'0')} 0x${modelBuffer[1].toString(16).padStart(2,'0')}`);

    // Guardar en caché
    await saveToDB(modelKey, modelBuffer);
    self.postMessage({ type: 'download-done' });
  } else {
    self.postMessage({ type: 'model-cached', modelKey });
    console.log(`[Worker] Desde caché: ${modelBuffer.byteLength || modelBuffer.length} bytes`);
  }

  // Crear sesión ONNX
  self.postMessage({ type: 'progress', percent: 0, stage: 'Cargando motor IA...' });

  // modelBuffer puede ser Uint8Array o ArrayBuffer — manejar ambos casos
  const buffer = modelBuffer instanceof Uint8Array ? modelBuffer.buffer : modelBuffer;
  const session = await ort.InferenceSession.create(buffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });

  console.log('[Worker] Session inputNames:', session.inputNames);
  console.log('[Worker] Session outputNames:', session.outputNames);

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

/* ── Procesamiento principal por tiles ── */
async function processImage(imageData, width, height, modelKey, targetScale) {
  const session = await loadModel(modelKey);

  // Determinar el ratio real del modelo con un test
  const testW = 8, testH = 8;
  const testInput = new ort.Tensor('float32', new Float32Array(3 * testH * testW), [1, 3, testH, testW]);
  const testFeeds = {};
  testFeeds[session.inputNames[0]] = testInput;
  const testResult = await session.run(testFeeds);
  const testOut = testResult[session.outputNames[0]];
  const modelScaleH = testOut.dims[2] / testH;
  const modelScaleW = testOut.dims[3] / testW;

  const TILE = 128; // tile input size (más grande = menos artefactos de borde)
  const PAD  = 8;   // padding en pixels

  const outW = Math.round(width  * modelScaleW);
  const outH = Math.round(height * modelScaleH);
  const outPixels = new Uint8ClampedArray(outW * outH * 4);
  // Inicializar alpha a 255
  for (let i = 3; i < outPixels.length; i += 4) outPixels[i] = 255;

  const tilesX = Math.ceil(width  / TILE);
  const tilesY = Math.ceil(height / TILE);
  const totalTiles = tilesX * tilesY;
  let doneTiles = 0;

  self.postMessage({ type: 'progress', percent: 5, stage: 'Procesando con IA...' });

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      // Borde útil del tile (sin padding)
      const tileX0 = tx * TILE;
      const tileY0 = ty * TILE;
      const tileX1 = Math.min(width,  (tx + 1) * TILE);
      const tileY1 = Math.min(height, (ty + 1) * TILE);

      // Con padding (clipeado a límites de imagen)
      const x0 = Math.max(0, tileX0 - PAD);
      const y0 = Math.max(0, tileY0 - PAD);
      const x1 = Math.min(width,  tileX1 + PAD);
      const y1 = Math.min(height, tileY1 + PAD);
      const tw = x1 - x0;
      const th = y1 - y0;

      // Padding real añadido (en píxeles de entrada)
      const padL = tileX0 - x0;
      const padT = tileY0 - y0;
      const padR = x1 - tileX1;
      const padB = y1 - tileY1;

      // Convertir tile a tensor
      const inputTensor = imageDataToTensor(imageData, x0, y0, tw, th, width, height);

      // Inferencia
      const feeds = {};
      feeds[session.inputNames[0]] = inputTensor;
      const results = await session.run(feeds);
      const outTensor = results[session.outputNames[0]];

      const outTH = outTensor.dims[2];
      const outTW = outTensor.dims[3];

      // Padding en el tensor de salida (en píxeles de salida)
      const outPadL = Math.round(padL * modelScaleW);
      const outPadT = Math.round(padT * modelScaleH);
      const outPadR = Math.round(padR * modelScaleW);
      const outPadB = Math.round(padB * modelScaleH);

      // Posición destino en la imagen de salida
      const dstX = Math.round(tileX0 * modelScaleW);
      const dstY = Math.round(tileY0 * modelScaleH);

      // Tamaño útil a copiar (excluir padding del tensor de salida)
      const copyW = outTW - outPadL - outPadR;
      const copyH = outTH - outPadT - outPadB;

      // Escribir directamente con índices correctos
      const tensorData = outTensor.data;
      for (let row = 0; row < copyH; row++) {
        for (let col = 0; col < copyW; col++) {
          const srcRow = row + outPadT;
          const srcCol = col + outPadL;
          const rVal = tensorData[0 * outTH * outTW + srcRow * outTW + srcCol];
          const gVal = tensorData[1 * outTH * outTW + srcRow * outTW + srcCol];
          const bVal = tensorData[2 * outTH * outTW + srcRow * outTW + srcCol];
          const dstRow = dstY + row;
          const dstCol = dstX + col;
          if (dstRow >= 0 && dstRow < outH && dstCol >= 0 && dstCol < outW) {
            const dstIdx = (dstRow * outW + dstCol) * 4;
            outPixels[dstIdx]     = Math.max(0, Math.min(255, Math.round(rVal * 255)));
            outPixels[dstIdx + 1] = Math.max(0, Math.min(255, Math.round(gVal * 255)));
            outPixels[dstIdx + 2] = Math.max(0, Math.min(255, Math.round(bVal * 255)));
            outPixels[dstIdx + 3] = 255;
          }
        }
      }

      doneTiles++;
      const pct = Math.round(5 + (doneTiles / totalTiles) * 85);
      self.postMessage({ type: 'progress', percent: pct, stage: `Tiles ${doneTiles}/${totalTiles}...` });

      // Yield al event loop cada 4 tiles para permitir que los mensajes de progreso
      // se procesen en el hilo principal y evitar que el worker bloquee indefinidamente
      if (doneTiles % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }
  }

  // Crear ImageData de salida
  const result2x = new ImageData(outPixels, outW, outH);

  // Si el modelo ya da el scale deseado, devolver
  if (targetScale === 2) return result2x;

  // Para 3x y 4x: escalar desde el resultado 2x con OffscreenCanvas
  const finalW = Math.round(width  * targetScale);
  const finalH = Math.round(height * targetScale);
  const offscreen = new OffscreenCanvas(finalW, finalH);
  const ctx = offscreen.getContext('2d');

  // Dibujar el resultado 2x en un canvas temporal
  const tmpCanvas = new OffscreenCanvas(outW, outH);
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