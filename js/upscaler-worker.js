/**
 * Waifu2x Extension GUI — Showcase
 * js/upscaler-worker.js
 *
 * Web Worker dedicado para procesamiento de imágenes con ONNX Runtime Web.
 * Usa los modelos waifu2x cunet de nagadomi/nunif disponibles en HuggingFace.
 *
 * Mensajes recibidos:
 *   { type: 'process', imageData, width, height, modelKey, scale }
 *
 * Mensajes enviados:
 *   { type: 'model-loading', modelKey }
 *   { type: 'model-cached', modelKey }
 *   { type: 'download-progress', percent }
 *   { type: 'progress', percent, stage }
 *   { type: 'result', imageData }
 *   { type: 'error', message }
 */

'use strict';

/* ── Importar ONNX Runtime Web ── */
importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.js');

/* ── Configurar rutas WASM ── */
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';

/* ── URLs de modelos waifu2x cunet (HuggingFace) ── */
const MODEL_URLS = {
  'art-noise0':   'https://huggingface.co/nunif/waifu2x/resolve/main/art/noise0_scale2x_model.onnx',
  'art-noise1':   'https://huggingface.co/nunif/waifu2x/resolve/main/art/noise1_scale2x_model.onnx',
  'art-noise2':   'https://huggingface.co/nunif/waifu2x/resolve/main/art/noise2_scale2x_model.onnx',
  'art-noise3':   'https://huggingface.co/nunif/waifu2x/resolve/main/art/noise3_scale2x_model.onnx',
  'photo-noise0': 'https://huggingface.co/nunif/waifu2x/resolve/main/photo/noise0_scale2x_model.onnx',
  'photo-noise1': 'https://huggingface.co/nunif/waifu2x/resolve/main/photo/noise1_scale2x_model.onnx',
  'photo-noise2': 'https://huggingface.co/nunif/waifu2x/resolve/main/photo/noise2_scale2x_model.onnx',
  'photo-noise3': 'https://huggingface.co/nunif/waifu2x/resolve/main/photo/noise3_scale2x_model.onnx',
};

/* ── Constantes de procesamiento ── */
const TILE_SIZE    = 128; // píxeles por tile (sin padding)
const TILE_PADDING = 4;   // padding en píxeles para evitar artefactos en bordes

/* ── Caché en memoria de sesiones ONNX ya cargadas ── */
const sessionCache = {};

/* ════════════════════════════════════════════════════════════
   INDEXEDDB — caché de modelos en el navegador
   ════════════════════════════════════════════════════════════ */

const DB_NAME    = 'waifu2x-models-cache';
const DB_VERSION = 1;

/** Abre (o crea) la base de datos IndexedDB. */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('models')) {
        db.createObjectStore('models');
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Recupera un modelo guardado en IndexedDB. Retorna ArrayBuffer o null. */
async function getCachedModel(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('models', 'readonly');
      const req = tx.objectStore('models').get(key);
      req.onsuccess = (e) => resolve(e.target.result || null);
      req.onerror   = (e) => reject(e.target.error);
    });
  } catch {
    return null; // IndexedDB no disponible — continuar sin caché
  }
}

/** Guarda un ArrayBuffer de modelo en IndexedDB. */
async function cacheModel(key, data) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('models', 'readwrite');
      const req = tx.objectStore('models').put(data, key);
      req.onsuccess = () => resolve();
      req.onerror   = (e) => reject(e.target.error);
    });
  } catch {
    // Si IndexedDB falla, continuar sin persistir
  }
}

/* ════════════════════════════════════════════════════════════
   CARGA DE MODELO — con descarga progresiva y caché
   ════════════════════════════════════════════════════════════ */

/**
 * Carga el modelo ONNX para un modelKey dado.
 * Usa caché en memoria > IndexedDB > descarga desde HuggingFace.
 *
 * @param {string} modelKey - Clave del modelo (p. ej. 'art-noise2').
 * @returns {Promise<ort.InferenceSession>}
 */
async function loadModel(modelKey) {
  // 1. Caché en memoria (sesión ya creada)
  if (sessionCache[modelKey]) {
    return sessionCache[modelKey];
  }

  self.postMessage({ type: 'model-loading', modelKey });

  let modelBuffer = null;

  // 2. Intentar recuperar de IndexedDB
  modelBuffer = await getCachedModel(modelKey);

  if (modelBuffer) {
    self.postMessage({ type: 'model-cached', modelKey });
  } else {
    // 3. Descargar desde HuggingFace con progreso
    const url = MODEL_URLS[modelKey];
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Error descargando modelo: ${response.status} ${response.statusText}`);
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;

      if (contentLength > 0) {
        self.postMessage({
          type:    'download-progress',
          percent: Math.round((received / contentLength) * 100),
        });
      }
    }

    // Combinar chunks en un único ArrayBuffer
    const data = new Uint8Array(received);
    let pos = 0;
    for (const chunk of chunks) {
      data.set(chunk, pos);
      pos += chunk.length;
    }
    modelBuffer = data.buffer;

    // Persistir en IndexedDB para futuros usos
    await cacheModel(modelKey, modelBuffer);
  }

  // 4. Crear sesión de inferencia ONNX
  const session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders:      ['wasm'],
    graphOptimizationLevel:  'all',
  });

  sessionCache[modelKey] = session;
  return session;
}

/* ════════════════════════════════════════════════════════════
   CONVERSIÓN DE PÍXELES — RGBA uint8 ↔ CHW Float32
   ════════════════════════════════════════════════════════════ */

/**
 * Convierte datos RGBA (Uint8ClampedArray) a tensor CHW Float32 normalizado [0, 1].
 *
 * @param {Uint8ClampedArray} rgba - Datos RGBA lineales (4 bytes por píxel).
 * @param {number} w - Ancho de la imagen.
 * @param {number} h - Alto de la imagen.
 * @returns {Float32Array} Tensor CHW: [R canal][G canal][B canal], cada canal de tamaño w*h.
 */
function rgbaToChw(rgba, w, h) {
  const pixels = w * h;
  const chw    = new Float32Array(3 * pixels);

  for (let i = 0; i < pixels; i++) {
    chw[i]               = rgba[i * 4]     / 255; // R
    chw[pixels + i]      = rgba[i * 4 + 1] / 255; // G
    chw[pixels * 2 + i]  = rgba[i * 4 + 2] / 255; // B
  }

  return chw;
}

/**
 * Convierte un tensor CHW Float32 normalizado [0, 1] a RGBA Uint8ClampedArray.
 *
 * @param {Float32Array} chw - Tensor CHW de salida del modelo.
 * @param {number} w - Ancho de la imagen de salida.
 * @param {number} h - Alto de la imagen de salida.
 * @returns {Uint8ClampedArray} Datos RGBA.
 */
function chwToRgba(chw, w, h) {
  const pixels = w * h;
  const rgba   = new Uint8ClampedArray(pixels * 4);

  for (let i = 0; i < pixels; i++) {
    rgba[i * 4]     = Math.max(0, Math.min(255, Math.round(chw[i]               * 255))); // R
    rgba[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(chw[pixels + i]      * 255))); // G
    rgba[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(chw[pixels * 2 + i]  * 255))); // B
    rgba[i * 4 + 3] = 255; // A totalmente opaco
  }

  return rgba;
}

/* ════════════════════════════════════════════════════════════
   EXTRACCIÓN DE TILES — desde ImageData plano (RGBA)
   ════════════════════════════════════════════════════════════ */

/**
 * Extrae un tile (región rectangular) de un array RGBA plano.
 *
 * @param {Uint8ClampedArray} srcData - Array RGBA de la imagen fuente.
 * @param {number} srcW - Ancho de la imagen fuente.
 * @param {number} srcH - Alto de la imagen fuente.
 * @param {number} x - Columna inicial del tile.
 * @param {number} y - Fila inicial del tile.
 * @param {number} tw - Ancho del tile.
 * @param {number} th - Alto del tile.
 * @returns {Uint8ClampedArray} Datos RGBA del tile.
 */
function extractTile(srcData, srcW, srcH, x, y, tw, th) {
  const tileData = new Uint8ClampedArray(tw * th * 4);

  for (let row = 0; row < th; row++) {
    const srcRow = Math.max(0, Math.min(srcH - 1, y + row));

    for (let col = 0; col < tw; col++) {
      const sc = Math.max(0, Math.min(srcW - 1, x + col));
      const si = (srcRow * srcW + sc) * 4;
      const di = (row * tw + col) * 4;
      tileData[di]     = srcData[si];
      tileData[di + 1] = srcData[si + 1];
      tileData[di + 2] = srcData[si + 2];
      tileData[di + 3] = srcData[si + 3];
    }
  }

  return tileData;
}

/**
 * Copia píxeles de un tile de salida al array RGBA de destino.
 *
 * @param {Uint8ClampedArray} dstData    - Array RGBA destino.
 * @param {number} dstStride             - Ancho (stride) de la imagen destino en píxeles.
 * @param {Uint8ClampedArray} tileData   - Array RGBA del tile de salida.
 * @param {number} tileW  - Ancho del tile de salida.
 * @param {number} tileH  - Alto del tile de salida.
 * @param {number} dstX   - Columna inicial en destino.
 * @param {number} dstY   - Fila inicial en destino.
 * @param {number} dstClampW - Ancho máximo permitido del destino (para clamp de bordes).
 * @param {number} dstClampH - Alto máximo permitido del destino (para clamp de bordes).
 */
function pasteTile(dstData, dstStride, tileData, tileW, tileH, dstX, dstY, dstClampW, dstClampH) {
  for (let row = 0; row < tileH; row++) {
    const dy = dstY + row;
    if (dy < 0 || dy >= dstClampH) continue;

    for (let col = 0; col < tileW; col++) {
      const dx = dstX + col;
      if (dx < 0 || dx >= dstClampW) continue;

      const si = (row * tileW + col) * 4;
      const di = (dy * dstStride + dx) * 4;

      dstData[di]     = tileData[si];
      dstData[di + 1] = tileData[si + 1];
      dstData[di + 2] = tileData[si + 2];
      dstData[di + 3] = tileData[si + 3];
    }
  }
}

/* ════════════════════════════════════════════════════════════
   INFERENCIA POR TILES — upscale 2x con un modelo ONNX
   ════════════════════════════════════════════════════════════ */

/**
 * Aplica el modelo waifu2x 2x sobre una imagen entera procesando por tiles.
 *
 * @param {ort.InferenceSession} session   - Sesión ONNX activa.
 * @param {Uint8ClampedArray}    srcData   - Datos RGBA de la imagen fuente.
 * @param {number}               srcW      - Ancho fuente.
 * @param {number}               srcH      - Alto fuente.
 * @param {Function}             onProgress- Callback (completedTiles, totalTiles).
 * @returns {Promise<{data: Uint8ClampedArray, width: number, height: number}>}
 */
async function runUpscale2x(session, srcData, srcW, srcH, onProgress) {
  const dstW    = srcW * 2;
  const dstH    = srcH * 2;
  const dstData = new Uint8ClampedArray(dstW * dstH * 4);

  const cols  = Math.ceil(srcW / TILE_SIZE);
  const rows  = Math.ceil(srcH / TILE_SIZE);
  const total = cols * rows;
  let   done  = 0;

  const inputName  = session.inputNames[0];
  const outputName = session.outputNames[0];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tileX = col * TILE_SIZE;
      const tileY = row * TILE_SIZE;
      const tileW = Math.min(TILE_SIZE, srcW - tileX);
      const tileH = Math.min(TILE_SIZE, srcH - tileY);

      // Región con padding (clamped a bordes de la imagen)
      const padX  = Math.max(0, tileX - TILE_PADDING);
      const padY  = Math.max(0, tileY - TILE_PADDING);
      const padX2 = Math.min(srcW, tileX + tileW + TILE_PADDING);
      const padY2 = Math.min(srcH, tileY + tileH + TILE_PADDING);
      const padW  = padX2 - padX;
      const padH  = padY2 - padY;

      // Cuánto padding real se añadió a cada borde
      const leftPad = tileX - padX;
      const topPad  = tileY - padY;

      // Extraer tile (con padding) de la imagen fuente
      const tileRgba = extractTile(srcData, srcW, srcH, padX, padY, padW, padH);

      // Convertir a tensor CHW Float32
      const chw    = rgbaToChw(tileRgba, padW, padH);
      const tensor = new ort.Tensor('float32', chw, [1, 3, padH, padW]);

      // Inferencia
      const feeds   = { [inputName]: tensor };
      const results = await session.run(feeds);
      const output  = results[outputName];

      // Tensor de salida: [1, 3, padH*2, padW*2]
      const outH = padH * 2;
      const outW = padW * 2;

      // Convertir salida CHW Float32 → RGBA
      const outRgba = chwToRgba(output.data, outW, outH);

      // Recortar el padding de la salida y pegar en destino
      const cropX = leftPad * 2;
      const cropY = topPad  * 2;
      const cropW = tileW   * 2;
      const cropH = tileH   * 2;

      // Extraer región útil del tile de salida
      const croppedRgba = extractTile(outRgba, outW, outH, cropX, cropY, cropW, cropH);

      // Pegar en imagen destino
      pasteTile(dstData, dstW, croppedRgba, cropW, cropH, tileX * 2, tileY * 2, dstW, dstH);

      done++;
      onProgress(done, total);
    }
  }

  return { data: dstData, width: dstW, height: dstH };
}

/* ════════════════════════════════════════════════════════════
   ESCALADO CON OFFSCREENCANVAS — para escala 3x
   ════════════════════════════════════════════════════════════ */

/**
 * Escala una imagen (representada como RGBA plano) a nuevas dimensiones
 * usando OffscreenCanvas (disponible en Workers modernos).
 *
 * @param {Uint8ClampedArray} srcData - Datos RGBA.
 * @param {number} srcW - Ancho fuente.
 * @param {number} srcH - Alto fuente.
 * @param {number} dstW - Ancho destino.
 * @param {number} dstH - Alto destino.
 * @returns {Uint8ClampedArray} Datos RGBA escalados.
 */
function canvasScale(srcData, srcW, srcH, dstW, dstH) {
  // Canvas fuente
  const srcCanvas = new OffscreenCanvas(srcW, srcH);
  const srcCtx    = srcCanvas.getContext('2d');
  const srcImg    = new ImageData(srcData, srcW, srcH);
  srcCtx.putImageData(srcImg, 0, 0);

  // Canvas destino
  const dstCanvas = new OffscreenCanvas(dstW, dstH);
  const dstCtx    = dstCanvas.getContext('2d');
  dstCtx.imageSmoothingEnabled = true;
  dstCtx.imageSmoothingQuality = 'high';
  dstCtx.drawImage(srcCanvas, 0, 0, dstW, dstH);

  return dstCtx.getImageData(0, 0, dstW, dstH).data;
}

/* ════════════════════════════════════════════════════════════
   PROCESAMIENTO PRINCIPAL — upscale completo según escala
   ════════════════════════════════════════════════════════════ */

/**
 * Realiza el upscaling completo de una imagen para la escala solicitada.
 *
 * @param {ort.InferenceSession} session  - Sesión ONNX.
 * @param {Uint8ClampedArray}    srcData  - Datos RGBA de la imagen original.
 * @param {number}               srcW     - Ancho original.
 * @param {number}               srcH     - Alto original.
 * @param {number}               scale    - Factor de escala (2, 3 o 4).
 * @returns {Promise<ImageData>}
 */
async function processImage(session, srcData, srcW, srcH, scale) {
  const dstW = srcW * scale;
  const dstH = srcH * scale;

  if (scale === 2) {
    // — Escala 2x: un único paso con el modelo —
    const result = await runUpscale2x(session, srcData, srcW, srcH, (done, total) => {
      self.postMessage({
        type:    'progress',
        percent: Math.round(10 + (done / total) * 85),
        stage:   'Aplicando IA waifu2x…',
      });
    });

    return new ImageData(result.data, result.width, result.height);

  } else if (scale === 4) {
    // — Escala 4x: dos pasos de 2x consecutivos —

    // Paso 1: 1x → 2x
    const step1 = await runUpscale2x(session, srcData, srcW, srcH, (done, total) => {
      self.postMessage({
        type:    'progress',
        percent: Math.round(10 + (done / total) * 40),
        stage:   'Aplicando IA (paso 1/2)…',
      });
    });

    self.postMessage({ type: 'progress', percent: 50, stage: 'Aplicando IA (paso 2/2)…' });

    // Paso 2: 2x → 4x
    const step2 = await runUpscale2x(session, step1.data, step1.width, step1.height, (done, total) => {
      self.postMessage({
        type:    'progress',
        percent: Math.round(50 + (done / total) * 45),
        stage:   'Aplicando IA (paso 2/2)…',
      });
    });

    return new ImageData(step2.data, step2.width, step2.height);

  } else {
    // — Escala 3x: modelo 2x + escalado Canvas hasta 3x —

    const step1 = await runUpscale2x(session, srcData, srcW, srcH, (done, total) => {
      self.postMessage({
        type:    'progress',
        percent: Math.round(10 + (done / total) * 80),
        stage:   'Aplicando IA waifu2x…',
      });
    });

    self.postMessage({ type: 'progress', percent: 92, stage: 'Ajustando a escala 3x…' });

    // Escalar de 2x a 3x con Canvas (el 50% restante de ampliación es pequeño)
    const scaledData = canvasScale(step1.data, step1.width, step1.height, dstW, dstH);
    return new ImageData(scaledData, dstW, dstH);
  }
}

/* ════════════════════════════════════════════════════════════
   MANEJADOR DE MENSAJES
   ════════════════════════════════════════════════════════════ */

self.onmessage = async (e) => {
  const { type, imageData, width, height, modelKey, scale } = e.data;

  if (type !== 'process') return;

  try {
    self.postMessage({ type: 'progress', percent: 5, stage: 'Cargando modelo IA…' });

    // Cargar (o recuperar de caché) el modelo
    const session = await loadModel(modelKey);

    self.postMessage({ type: 'progress', percent: 10, stage: 'Modelo listo. Procesando…' });

    // Procesar la imagen
    const srcData  = imageData.data;
    const resultId = await processImage(session, srcData, width, height, scale);

    self.postMessage({ type: 'progress', percent: 100, stage: '¡Listo!' });

    // Transferir ImageData al hilo principal
    self.postMessage({ type: 'result', imageData: resultId });

  } catch (err) {
    self.postMessage({
      type:    'error',
      message: err && err.message ? err.message : String(err),
    });
  }
};
