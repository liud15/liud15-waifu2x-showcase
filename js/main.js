/**
 * Waifu2x Online — Upscaler de imágenes anime con IA
 * js/main.js
 *
 * Funcionalidades:
 * - Navbar sticky con glassmorphism al hacer scroll
 * - Menú hamburguesa para móvil
 * - Animaciones con IntersectionObserver
 * - Smooth scroll para enlaces internos
 * - Upscaler online con ONNX Runtime Web (Web Worker)
 */

'use strict';

/* ================================================================
   NAVBAR — glassmorphism al scroll + menú hamburguesa
   ================================================================ */

const navbar    = document.getElementById('navbar');
const navToggle = document.getElementById('navToggle');
const navMenu   = document.getElementById('navMenu');
const navLinks  = document.querySelectorAll('.nav-link, .nav-cta');

/**
 * Agrega/elimina la clase 'scrolled' al navbar
 * para activar el efecto glassmorphism.
 */
function handleNavbarScroll() {
  if (window.scrollY > 40) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
}

window.addEventListener('scroll', handleNavbarScroll, { passive: true });
handleNavbarScroll(); // Estado inicial

/**
 * Alterna la visibilidad del menú móvil.
 */
function toggleMobileMenu() {
  const isOpen = navMenu.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
  navToggle.setAttribute('aria-label', isOpen ? 'Cerrar menú' : 'Abrir menú');

  // Bloquear el scroll del body cuando el menú está abierto
  document.body.style.overflow = isOpen ? 'hidden' : '';
}

navToggle.addEventListener('click', toggleMobileMenu);

/**
 * Cierra el menú móvil al hacer clic en un enlace de navegación.
 */
navLinks.forEach((link) => {
  link.addEventListener('click', () => {
    navMenu.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Abrir menú');
    document.body.style.overflow = '';
  });
});

/**
 * Cierra el menú móvil al hacer clic fuera de él.
 */
document.addEventListener('click', (e) => {
  if (
    navMenu.classList.contains('open') &&
    !navMenu.contains(e.target) &&
    !navToggle.contains(e.target)
  ) {
    navMenu.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Abrir menú');
    document.body.style.overflow = '';
  }
});

/* ================================================================
   SMOOTH SCROLL — enlaces internos
   ================================================================ */

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', (e) => {
    const targetId = anchor.getAttribute('href');
    if (targetId === '#') return;

    const target = document.querySelector(targetId);
    if (!target) return;

    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

/* ================================================================
   INTERSECTION OBSERVER — animaciones de entrada
   ================================================================ */

const observerOptions = {
  threshold: 0.12,
  rootMargin: '0px 0px -50px 0px',
};

const animObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      // Efecto escalonado dentro de grupos de cards
      const delay = entry.target.dataset.delay || 0;
      setTimeout(() => {
        entry.target.classList.add('visible');
      }, delay);
      animObserver.unobserve(entry.target);
    }
  });
}, observerOptions);

/**
 * Observa todos los elementos con la clase 'animate-on-scroll'
 * y aplica un pequeño retraso escalonado dentro de cada sección.
 */
function initScrollAnimations() {
  const sections = document.querySelectorAll('.section, .section--alt, .section--gradient');

  sections.forEach((section) => {
    const animatableEls = section.querySelectorAll('.animate-on-scroll');
    animatableEls.forEach((el, i) => {
      // Escalonar elementos dentro de la misma sección
      el.dataset.delay = i * 80;
      animObserver.observe(el);
    });
  });

  // También observar section-headers fuera de secciones (por si acaso)
  document.querySelectorAll('.animate-on-scroll').forEach((el) => {
    if (!el.dataset.delay) {
      animObserver.observe(el);
    }
  });
}

initScrollAnimations();

/* ================================================================
   UTILIDAD — Reducir animaciones si el usuario lo prefiere
   ================================================================ */

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

if (prefersReducedMotion.matches) {
  // Mostrar inmediatamente todos los elementos animados
  document.querySelectorAll('.animate-on-scroll').forEach((el) => {
    el.classList.add('visible');
  });
}

/* ================================================================
   UPSCALER ONLINE — Procesamiento de imágenes en el navegador
   ================================================================ */

(function initOnlineUpscaler() {
  /* ── Referencias al DOM ── */
  const uploadZone           = document.getElementById('uploadZone');
  const imageInput           = document.getElementById('imageInput');
  const previewSection       = document.getElementById('upscalerPreview');
  const previewImg           = document.getElementById('previewImg');
  const previewInfo          = document.getElementById('previewInfo');
  const paramsSection        = document.getElementById('upscalerParams');
  const processBtn           = document.getElementById('processBtn');
  const progressSection      = document.getElementById('upscalerProgress');
  const progressFill         = document.getElementById('progressFill');
  const progressPct          = document.getElementById('progressPct');
  const progressLabel        = document.getElementById('progressLabel');
  const modelStatus          = document.getElementById('modelStatus');
  const modelDownloadProgress= document.getElementById('modelDownloadProgress');
  const modelDownloadBar     = document.getElementById('modelDownloadBar');
  const modelDownloadPct     = document.getElementById('modelDownloadPct');
  const errorSection         = document.getElementById('upscalerError');
  const errorMsg             = document.getElementById('upscalerErrorMsg');
  const retryBtn             = document.getElementById('retryBtn');
  const resultPlaceholder    = document.getElementById('resultPlaceholder');
  const resultContent        = document.getElementById('resultContent');
  const beforeCanvas         = document.getElementById('beforeCanvas');
  const afterCanvas          = document.getElementById('afterCanvas');
  const resultStats          = document.getElementById('resultStats');
  const downloadBtn          = document.getElementById('downloadBtn');
  const resetBtn             = document.getElementById('resetBtn');

  if (!uploadZone) return; // Salir si la sección no existe en el DOM

  /* ── Constantes de configuración ── */
  const MAX_FILE_SIZE_MB  = 20;  // Tamaño máximo permitido en MB
  const MAX_PREVIEW_WIDTH = 400; // Ancho máximo del panel de vista previa

  /* ── Estado del upscaler ── */
  let selectedFile    = null;
  let sourceImage     = null;
  let outputCanvas    = null;
  let currentScale    = 2;
  let currentDenoise  = 0;
  let currentModelType = 'art';
  let startTime       = 0;
  let worker          = null;
  let workerAvailable = false;

  /* ────────────────────────────────────────────────
     WEB WORKER — inicializar al cargar la página
  ──────────────────────────────────────────────── */

  try {
    worker = new Worker('js/upscaler-worker.js');
    workerAvailable = true;

    worker.onerror = (err) => {
      console.warn('Error en el Worker de upscaling — usando modo fallback Canvas.', err);
      workerAvailable = false;
      worker = null;
    };
  } catch (e) {
    console.warn('No se pudo crear el Worker — usando modo fallback Canvas.', e);
  }

  /* ────────────────────────────────────────────────
     SELECCIÓN DE PARÁMETROS (tipo, escala, denoise)
  ──────────────────────────────────────────────── */

  /**
   * Inicializa los botones de opciones interactivas.
   * Gestiona el estado activo (param-option--active) y aria-pressed.
   */
  function initParamButtons() {
    document.querySelectorAll('.upscaler-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        const param = btn.dataset.param;
        const value = btn.dataset.value;

        if (param === 'scale')      currentScale     = Number(value);
        if (param === 'denoise')    currentDenoise   = Number(value);
        if (param === 'modelType')  currentModelType = value;

        document.querySelectorAll(`.upscaler-option[data-param="${param}"]`).forEach((sibling) => {
          const isActive = sibling === btn;
          sibling.classList.toggle('param-option--active', isActive);
          sibling.setAttribute('aria-pressed', String(isActive));
        });

        // Actualizar el badge de estado del modelo cuando cambia tipo o denoise
        if (param === 'modelType' || param === 'denoise') {
          updateModelStatusBadge();
        }
      });
    });
  }

  /**
   * Actualiza el badge de estado del modelo IA con el modelo actual.
   */
  function updateModelStatusBadge() {
    if (!modelStatus) return;
    const modelKey = `${currentModelType}-noise${currentDenoise}`;
    const titleEl  = modelStatus.querySelector('.model-status-title');
    const subEl    = modelStatus.querySelector('.model-status-sub');
    if (titleEl) titleEl.textContent = 'Motor IA listo';
    if (subEl)   subEl.textContent   = `Modelo: waifu2x/${modelKey} · Se descargará al procesar`;
  }

  initParamButtons();
  updateModelStatusBadge();

  /* ────────────────────────────────────────────────
     CARGA DE IMAGEN — drag & drop y clic
  ──────────────────────────────────────────────── */

  /**
   * Muestra la vista previa de la imagen seleccionada.
   * @param {File} file - Objeto File de la imagen seleccionada.
   */
  function loadImage(file) {
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      alert('Por favor selecciona una imagen en formato JPG, PNG o WebP.');
      return;
    }

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      alert(`La imagen supera el límite de ${MAX_FILE_SIZE_MB} MB. Por favor elige una imagen más pequeña.`);
      return;
    }

    selectedFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        sourceImage = img;

        previewImg.src = e.target.result;
        previewInfo.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${(file.size / 1024).toFixed(0)} KB`;

        uploadZone.classList.add('has-image');
        previewSection.hidden  = false;
        paramsSection.hidden   = false;
        progressSection.hidden = true;
        errorSection.hidden    = true;
        resultPlaceholder.hidden = false;
        resultContent.hidden   = true;
        outputCanvas = null;
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  uploadZone.addEventListener('click', (e) => {
    if (e.target !== imageInput) imageInput.click();
  });

  uploadZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      imageInput.click();
    }
  });

  imageInput.addEventListener('change', () => {
    if (imageInput.files && imageInput.files[0]) {
      loadImage(imageInput.files[0]);
    }
  });

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', (e) => {
    if (!uploadZone.contains(e.relatedTarget)) {
      uploadZone.classList.remove('drag-over');
    }
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) loadImage(file);
  });

  /* ────────────────────────────────────────────────
     HELPERS DE PROGRESO
  ──────────────────────────────────────────────── */

  function updateProgress(pct, label) {
    const rounded = Math.round(pct);
    progressFill.style.width = `${rounded}%`;
    progressFill.setAttribute('aria-valuenow', rounded);
    progressPct.textContent = `${rounded}%`;
    if (label) progressLabel.textContent = label;
  }

  function showDownloadProgress(pct) {
    if (!modelDownloadProgress) return;
    modelDownloadProgress.hidden = false;
    modelDownloadBar.style.width = `${pct}%`;
    modelDownloadBar.setAttribute('aria-valuenow', pct);
    modelDownloadPct.textContent = `${pct}%`;
  }

  function hideDownloadProgress() {
    if (!modelDownloadProgress) return;
    modelDownloadProgress.hidden = true;
  }

  /* ────────────────────────────────────────────────
     MOSTRAR RESULTADO DESDE IMAGEDATA
  ──────────────────────────────────────────────── */

  /**
   * Dibuja el resultado en los canvas de comparativa y muestra las estadísticas.
   * @param {ImageData} resultImageData - ImageData del resultado del worker.
   */
  function showResult(resultImageData) {
    const srcW = sourceImage.naturalWidth;
    const srcH = sourceImage.naturalHeight;
    const dstW = resultImageData.width;
    const dstH = resultImageData.height;

    // Canvas "antes" (imagen original a escala de preview)
    const previewW = Math.min(srcW, MAX_PREVIEW_WIDTH);
    const previewH = Math.round(srcH * (previewW / srcW));

    beforeCanvas.width  = previewW;
    beforeCanvas.height = previewH;
    const bCtx = beforeCanvas.getContext('2d');
    bCtx.imageSmoothingEnabled = true;
    bCtx.imageSmoothingQuality = 'high';
    bCtx.drawImage(sourceImage, 0, 0, previewW, previewH);

    // Crear canvas real con el resultado completo (para descarga)
    const realCanvas = document.createElement('canvas');
    realCanvas.width  = dstW;
    realCanvas.height = dstH;
    realCanvas.getContext('2d').putImageData(resultImageData, 0, 0);
    outputCanvas = realCanvas;

    // Canvas "después" (resultado a escala de preview)
    const afterPreviewW = Math.min(dstW, MAX_PREVIEW_WIDTH * currentScale);
    const afterPreviewH = Math.round(dstH * (afterPreviewW / dstW));
    afterCanvas.width  = afterPreviewW;
    afterCanvas.height = afterPreviewH;
    const aCtx = afterCanvas.getContext('2d');
    aCtx.imageSmoothingEnabled = true;
    aCtx.imageSmoothingQuality = 'high';
    aCtx.drawImage(realCanvas, 0, 0, afterPreviewW, afterPreviewH);

    const elapsed  = ((performance.now() - startTime) / 1000).toFixed(2);
    const modelKey = `${currentModelType}-noise${currentDenoise}`;
    const modeTag  = workerAvailable ? `🤖 waifu2x/${modelKey}` : '🖼️ Canvas mejorado';

    resultStats.innerHTML = `
      <span class="result-stat">📐 <strong>${srcW}×${srcH}</strong> → <strong>${dstW}×${dstH} px</strong></span>
      <span class="result-stat">⚡ Tiempo: <strong>${elapsed} s</strong></span>
      <span class="result-stat">🔍 Escala: <strong>${currentScale}x</strong></span>
      <span class="result-stat">🔇 Denoise: <strong>${currentDenoise}</strong></span>
      <span class="result-stat">${modeTag}</span>
    `;

    // Actualizar UI: ocultar progreso, mostrar resultado
    progressFill.classList.remove('animating');
    progressSection.hidden = true;
    paramsSection.hidden   = false;
    processBtn.disabled    = false;
    hideDownloadProgress();
    resultContent.hidden   = false;
  }

  /* ────────────────────────────────────────────────
     FALLBACK CANVAS — si ONNX falla
  ──────────────────────────────────────────────── */

  function applyConvolution(imageData, kernel, divisor, bias) {
    const src = imageData.data;
    const w   = imageData.width;
    const h   = imageData.height;
    const dst = new Uint8ClampedArray(src.length);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;

        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const px  = Math.max(0, Math.min(w - 1, x + kx));
            const py  = Math.max(0, Math.min(h - 1, y + ky));
            const idx = (py * w + px) * 4;
            const k   = kernel[(ky + 1) * 3 + (kx + 1)];
            r += src[idx]     * k;
            g += src[idx + 1] * k;
            b += src[idx + 2] * k;
          }
        }

        const i    = (y * w + x) * 4;
        dst[i]     = Math.max(0, Math.min(255, r / divisor + bias));
        dst[i + 1] = Math.max(0, Math.min(255, g / divisor + bias));
        dst[i + 2] = Math.max(0, Math.min(255, b / divisor + bias));
        dst[i + 3] = src[i + 3];
      }
    }

    return new ImageData(dst, w, h);
  }

  function applySharpen(ctx, strength) {
    if (strength <= 0) return;
    const w   = ctx.canvas.width;
    const h   = ctx.canvas.height;
    const id  = ctx.getImageData(0, 0, w, h);
    const c   = 1 + 4 * strength;
    const e   = -strength;
    const filtered = applyConvolution(id, [0, e, 0, e, c, e, 0, e, 0], 1, 0);
    ctx.putImageData(filtered, 0, 0);
  }

  function applyDenoise(ctx, level) {
    if (level <= 0) return;
    const w  = ctx.canvas.width;
    const h  = ctx.canvas.height;
    const gk = [1, 2, 1, 2, 4, 2, 1, 2, 1];
    for (let p = 0; p < level; p++) {
      ctx.putImageData(applyConvolution(ctx.getImageData(0, 0, w, h), gk, 16, 0), 0, 0);
    }
  }

  async function canvasFallbackUpscale(img, scale, denoise) {
    const dstW = img.naturalWidth  * scale;
    const dstH = img.naturalHeight * scale;

    const canvas = document.createElement('canvas');
    canvas.width  = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('2d');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, dstW, dstH);

    updateProgress(30, 'Aplicando denoise…');
    if (denoise > 0) applyDenoise(ctx, denoise);

    updateProgress(70, 'Aplicando sharpening…');
    applySharpen(ctx, Math.min(0.8, 0.2 + (scale - 1) * 0.2));

    if (denoise >= 2) applyDenoise(ctx, 1);

    updateProgress(100, '¡Listo!');
    return ctx.getImageData(0, 0, dstW, dstH);
  }

  /* ────────────────────────────────────────────────
     BOTÓN "PROCESAR CON IA"
  ──────────────────────────────────────────────── */

  async function startProcessing() {
    if (!sourceImage) return;

    startTime = performance.now();
    const modelKey = `${currentModelType}-noise${currentDenoise}`;

    // Preparar UI
    processBtn.disabled    = true;
    paramsSection.hidden   = true;
    progressSection.hidden = false;
    errorSection.hidden    = true;
    progressFill.classList.add('animating');
    updateProgress(0, 'Iniciando…');
    resultPlaceholder.hidden = true;
    resultContent.hidden   = true;
    hideDownloadProgress();

    if (workerAvailable && worker) {
      // — Modo IA real con ONNX Worker —

      // Obtener ImageData de la imagen fuente
      const srcW = sourceImage.naturalWidth;
      const srcH = sourceImage.naturalHeight;
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width  = srcW;
      tmpCanvas.height = srcH;
      const tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.drawImage(sourceImage, 0, 0);
      const imageData = tmpCtx.getImageData(0, 0, srcW, srcH);

      worker.onmessage = (e) => {
        const msg = e.data;

        if (msg.type === 'model-loading') {
          updateProgress(5, 'Cargando modelo IA…');
        }

        if (msg.type === 'model-cached') {
          updateProgress(8, 'Modelo en caché ✅');
          hideDownloadProgress();
          // Mostrar brevemente el badge de caché
          if (modelStatus) {
            const subEl = modelStatus.querySelector('.model-status-sub');
            if (subEl) subEl.textContent = '✅ Modelo en caché · Listo al instante';
          }
        }

        if (msg.type === 'download-start') {
          showDownloadProgress(0);
          updateProgress(5, 'Descargando modelo IA… 0%');
        }

        if (msg.type === 'download-progress') {
          showDownloadProgress(msg.percent);
          updateProgress(5 + msg.percent * 0.04, `Descargando modelo IA… ${msg.percent}%`);
        }

        if (msg.type === 'download-done') {
          hideDownloadProgress();
        }

        if (msg.type === 'progress') {
          hideDownloadProgress();
          updateProgress(msg.percent, msg.stage);
        }

        if (msg.type === 'result') {
          showResult(msg.imageData);
        }

        if (msg.type === 'error') {
          console.warn('Error ONNX, ejecutando fallback Canvas:', msg.message);
          // Mostrar aviso y caer en fallback
          workerAvailable = false;
          const notice = document.createElement('div');
          notice.className = 'model-cache-badge';
          notice.textContent = '⚠️ IA no disponible — usando modo mejorado';
          if (modelStatus && modelStatus.parentNode) {
            modelStatus.parentNode.insertBefore(notice, modelStatus);
          }
          canvasFallbackUpscale(sourceImage, currentScale, currentDenoise)
            .then(showResult)
            .catch((err) => {
              console.error('Error en fallback Canvas:', err);
              showError('Error al procesar la imagen. Por favor intenta con una imagen más pequeña.');
            });
        }
      };

      worker.postMessage({
        type:      'process',
        imageData,
        width:     srcW,
        height:    srcH,
        modelKey,
        scale:     currentScale,
      });

    } else {
      // — Modo fallback Canvas (sin Worker / sin ONNX) —
      updateProgress(5, 'Modo mejorado activo…');
      try {
        const resultId = await canvasFallbackUpscale(sourceImage, currentScale, currentDenoise);
        showResult(resultId);
      } catch (err) {
        console.error('Error en fallback Canvas:', err);
        showError('Error al procesar la imagen. Por favor intenta con una imagen más pequeña.');
      }
    }
  }

  function showError(message) {
    progressFill.classList.remove('animating');
    progressSection.hidden = true;
    paramsSection.hidden   = false;
    processBtn.disabled    = false;
    hideDownloadProgress();
    errorMsg.textContent   = message;
    errorSection.hidden    = false;
  }

  processBtn.addEventListener('click', startProcessing);

  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      errorSection.hidden = true;
      startProcessing();
    });
  }

  /* ────────────────────────────────────────────────
     DESCARGA DEL RESULTADO
  ──────────────────────────────────────────────── */

  downloadBtn.addEventListener('click', () => {
    if (!outputCanvas) return;

    outputCanvas.toBlob((blob) => {
      if (!blob) return;
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href  = url;
      const origName = selectedFile ? selectedFile.name.replace(/\.[^.]+$/, '') : 'image';
      const modelKey = `${currentModelType}_${currentScale}x_noise${currentDenoise}`;
      link.download  = `${origName}_waifu2x_${modelKey}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  });

  /* ────────────────────────────────────────────────
     RESET — limpiar y empezar de nuevo
  ──────────────────────────────────────────────── */

  resetBtn.addEventListener('click', () => {
    selectedFile = null;
    sourceImage  = null;
    outputCanvas = null;

    imageInput.value = '';

    uploadZone.classList.remove('has-image');
    previewSection.hidden    = true;
    paramsSection.hidden     = true;
    progressSection.hidden   = true;
    errorSection.hidden      = true;
    resultPlaceholder.hidden = false;
    resultContent.hidden     = true;

    previewImg.src = '';
    previewInfo.textContent = '';
    resultStats.innerHTML   = '';

    beforeCanvas.getContext('2d').clearRect(0, 0, beforeCanvas.width, beforeCanvas.height);
    afterCanvas.getContext('2d').clearRect(0, 0, afterCanvas.width, afterCanvas.height);

    updateProgress(0, 'Procesando…');
    processBtn.disabled = false;
    hideDownloadProgress();
    updateModelStatusBadge();
  });

})();
