/**
 * Waifu2x Extension GUI — Showcase
 * js/main.js
 *
 * Funcionalidades:
 * - Navbar sticky con glassmorphism al hacer scroll
 * - Menú hamburguesa para móvil
 * - Slider de comparación antes/después (mouse y touch)
 * - Accordion FAQ
 * - Animaciones con IntersectionObserver
 * - Smooth scroll para enlaces internos
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
   COMPARADOR ANTES/DESPUÉS — Slider interactivo
   ================================================================ */

(function initComparisonSlider() {
  const container    = document.getElementById('comparisonContainer');
  const slider       = document.getElementById('comparisonSlider');
  const beforePanel  = container.querySelector('.comparison-before');

  if (!container || !slider || !beforePanel) return;

  let isDragging = false;

  /**
   * Calcula la posición del slider como porcentaje del contenedor.
   * @param {number} clientX - Posición X del puntero/toque.
   * @returns {number} Porcentaje entre 0 y 100.
   */
  function getSliderPosition(clientX) {
    const rect = container.getBoundingClientRect();
    const x    = clientX - rect.left;
    const pct  = Math.max(0, Math.min(100, (x / rect.width) * 100));
    return pct;
  }

  /**
   * Actualiza la posición del slider y el clip-path del panel "antes".
   * @param {number} pct - Porcentaje de posición (0-100).
   */
  function updateSlider(pct) {
    slider.style.left = `${pct}%`;
    beforePanel.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    slider.setAttribute('aria-valuenow', Math.round(pct));
  }

  // Inicializar en el 50%
  updateSlider(50);

  /* ─── Eventos de mouse ─── */
  slider.addEventListener('mousedown', (e) => {
    isDragging = true;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    updateSlider(getSliderPosition(e.clientX));
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });

  /* ─── Eventos de touch ─── */
  slider.addEventListener('touchstart', (e) => {
    isDragging = true;
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    updateSlider(getSliderPosition(e.touches[0].clientX));
  }, { passive: true });

  document.addEventListener('touchend', () => {
    isDragging = false;
  });

  /* ─── Clic directo en el contenedor ─── */
  container.addEventListener('click', (e) => {
    if (e.target === slider || slider.contains(e.target)) return;
    updateSlider(getSliderPosition(e.clientX));
  });

  /* ─── Control por teclado (accesibilidad) ─── */
  slider.addEventListener('keydown', (e) => {
    const currentPct = parseFloat(slider.style.left) || 50;
    const step = e.shiftKey ? 10 : 2;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        updateSlider(Math.max(0, currentPct - step));
        break;
      case 'ArrowRight':
        e.preventDefault();
        updateSlider(Math.min(100, currentPct + step));
        break;
      case 'Home':
        e.preventDefault();
        updateSlider(0);
        break;
      case 'End':
        e.preventDefault();
        updateSlider(100);
        break;
    }
  });
})();

/* ================================================================
   FAQ ACCORDION — Abrir/cerrar preguntas
   ================================================================ */

(function initFAQAccordion() {
  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach((item) => {
    const question = item.querySelector('.faq-question');
    const answer   = item.querySelector('.faq-answer');

    if (!question || !answer) return;

    // Inicializar: ocultar respuestas (usando max-height en lugar de hidden)
    // Mantenemos el atributo hidden para semántica, pero lo gestionamos con CSS
    answer.removeAttribute('hidden');
    answer.style.maxHeight = '0';
    answer.style.padding   = '0 1.5rem';
    answer.style.overflow  = 'hidden';

    question.addEventListener('click', () => {
      const isExpanded = question.getAttribute('aria-expanded') === 'true';

      // Cerrar todos los demás items
      faqItems.forEach((otherItem) => {
        const otherQuestion = otherItem.querySelector('.faq-question');
        const otherAnswer   = otherItem.querySelector('.faq-answer');
        if (otherItem !== item && otherAnswer && otherQuestion) {
          otherQuestion.setAttribute('aria-expanded', 'false');
          otherAnswer.style.maxHeight = '0';
          otherAnswer.style.padding   = '0 1.5rem';
        }
      });

      // Alternar el item actual
      if (isExpanded) {
        question.setAttribute('aria-expanded', 'false');
        answer.style.maxHeight = '0';
        answer.style.padding   = '0 1.5rem';
      } else {
        question.setAttribute('aria-expanded', 'true');
        answer.style.maxHeight = answer.scrollHeight + 48 + 'px';
        answer.style.padding   = '0 1.5rem 1.25rem';
      }
    });
  });
})();

/* ================================================================
   INDICADOR DE SECCIÓN ACTIVA EN NAVBAR
   ================================================================ */

(function initActiveNavLink() {
  const sections = document.querySelectorAll('section[id]');
  const navLinksAll = document.querySelectorAll('.nav-link');

  if (!sections.length || !navLinksAll.length) return;

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          navLinksAll.forEach((link) => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${entry.target.id}`) {
              link.classList.add('active');
            }
          });
        }
      });
    },
    {
      rootMargin: '-40% 0px -55% 0px',
    }
  );

  sections.forEach((section) => sectionObserver.observe(section));
})();

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
  const uploadZone      = document.getElementById('uploadZone');
  const imageInput      = document.getElementById('imageInput');
  const previewSection  = document.getElementById('upscalerPreview');
  const previewImg      = document.getElementById('previewImg');
  const previewInfo     = document.getElementById('previewInfo');
  const paramsSection   = document.getElementById('upscalerParams');
  const processBtn      = document.getElementById('processBtn');
  const progressSection = document.getElementById('upscalerProgress');
  const progressFill    = document.getElementById('progressFill');
  const progressPct     = document.getElementById('progressPct');
  const progressLabel   = document.getElementById('progressLabel');
  const resultPlaceholder = document.getElementById('resultPlaceholder');
  const resultContent   = document.getElementById('resultContent');
  const beforeCanvas    = document.getElementById('beforeCanvas');
  const afterCanvas     = document.getElementById('afterCanvas');
  const resultStats     = document.getElementById('resultStats');
  const downloadBtn     = document.getElementById('downloadBtn');
  const resetBtn        = document.getElementById('resetBtn');

  if (!uploadZone) return; // Salir si la sección no existe en el DOM

  /* ── Constantes de configuración ── */
  const MAX_FILE_SIZE_MB  = 20;         // Tamaño máximo permitido en MB
  const TILE_WIDTH        = 256;        // Ancho de tile para procesamiento por bloques
  const MAX_PREVIEW_WIDTH = 400;        // Ancho máximo del panel de vista previa

  /* ── Estado del upscaler ── */
  let selectedFile = null;
  let sourceImage  = null;
  let outputCanvas = null;
  let currentScale   = 2;
  let currentDenoise = 0;

  /* ────────────────────────────────────────────────
     SELECCIÓN DE PARÁMETROS (escala y denoise)
  ──────────────────────────────────────────────── */

  /**
   * Inicializa los botones de opciones interactivas.
   * Gestiona el estado activo (param-option--active) y aria-pressed.
   */
  function initParamButtons() {
    const allButtons = document.querySelectorAll('.upscaler-option');

    allButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const param = btn.dataset.param;
        const value = Number(btn.dataset.value);

        // Actualizar el estado del parámetro correspondiente
        if (param === 'scale')   currentScale   = value;
        if (param === 'denoise') currentDenoise = value;

        // Actualizar clases visuales y aria-pressed dentro del mismo grupo
        document.querySelectorAll(`.upscaler-option[data-param="${param}"]`).forEach((sibling) => {
          const isActive = sibling === btn;
          sibling.classList.toggle('param-option--active', isActive);
          sibling.setAttribute('aria-pressed', String(isActive));
        });
      });
    });
  }

  initParamButtons();

  /* ────────────────────────────────────────────────
     CARGA DE IMAGEN — drag & drop y clic
  ──────────────────────────────────────────────── */

  /**
   * Muestra la vista previa de la imagen seleccionada.
   * @param {File} file - Objeto File de la imagen seleccionada.
   */
  function loadImage(file) {
    if (!file) return;

    // Validar tipo de archivo
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      alert('Por favor selecciona una imagen en formato JPG, PNG o WebP.');
      return;
    }

    // Validar tamaño (20 MB)
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

        // Mostrar la vista previa
        previewImg.src = e.target.result;
        previewInfo.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${(file.size / 1024).toFixed(0)} KB`;

        // Actualizar UI: mostrar vista previa y controles, ocultar resultado anterior
        uploadZone.classList.add('has-image');
        previewSection.hidden = false;
        paramsSection.hidden  = false;
        progressSection.hidden = true;
        resultPlaceholder.hidden = false;
        resultContent.hidden = true;
        outputCanvas = null;
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // Clic en la zona de carga (delegar al input)
  uploadZone.addEventListener('click', (e) => {
    if (e.target !== imageInput) imageInput.click();
  });

  // Tecla Enter/Espacio en la zona de carga (accesibilidad)
  uploadZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      imageInput.click();
    }
  });

  // Cambio en el input de archivo
  imageInput.addEventListener('change', () => {
    if (imageInput.files && imageInput.files[0]) {
      loadImage(imageInput.files[0]);
    }
  });

  // Eventos de drag & drop
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
     CONVOLUCIÓN EN CANVAS — filtros de imagen
  ──────────────────────────────────────────────── */

  /**
   * Aplica una convolución 3×3 sobre los datos de imagen usando el kernel dado.
   * Opera directamente sobre un objeto ImageData.
   *
   * @param {ImageData} imageData - Datos de píxeles del canvas.
   * @param {number[]} kernel     - Array de 9 valores (matriz 3×3).
   * @param {number}   divisor    - Divisor del kernel para normalizar.
   * @param {number}   bias       - Sesgo añadido al resultado de cada canal.
   * @returns {ImageData} Nuevos datos de imagen filtrados.
   */
  function applyConvolution(imageData, kernel, divisor, bias) {
    const src  = imageData.data;
    const w    = imageData.width;
    const h    = imageData.height;
    const dst  = new Uint8ClampedArray(src.length);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;

        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const px = Math.max(0, Math.min(w - 1, x + kx));
            const py = Math.max(0, Math.min(h - 1, y + ky));
            const idx = (py * w + px) * 4;
            const k   = kernel[(ky + 1) * 3 + (kx + 1)];

            r += src[idx]     * k;
            g += src[idx + 1] * k;
            b += src[idx + 2] * k;
          }
        }

        const i = (y * w + x) * 4;
        dst[i]     = Math.max(0, Math.min(255, r / divisor + bias));
        dst[i + 1] = Math.max(0, Math.min(255, g / divisor + bias));
        dst[i + 2] = Math.max(0, Math.min(255, b / divisor + bias));
        dst[i + 3] = src[i + 3]; // Canal alfa sin modificar
      }
    }

    return new ImageData(dst, w, h);
  }

  /**
   * Aplica un filtro de sharpening (realce de bordes) sobre un canvas.
   * Intensidad controlada por el parámetro strength (0–1).
   *
   * @param {CanvasRenderingContext2D} ctx  - Contexto 2D del canvas de salida.
   * @param {number} strength               - Intensidad del sharpening (0 = sin efecto, 1 = máximo).
   */
  function applySharpen(ctx, strength) {
    if (strength <= 0) return;

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);

    // Kernel de sharpening: suma de la diferencia entre el píxel central y sus vecinos
    // strength controla la intensidad; el centro se amplifica más cuanto mayor sea
    const center = 1 + 4 * strength;
    const edge   = -strength;
    const kernel = [
      0,    edge, 0,
      edge, center, edge,
      0,    edge, 0,
    ];

    const filtered = applyConvolution(imageData, kernel, 1, 0);
    ctx.putImageData(filtered, 0, 0);
  }

  /**
   * Aplica un filtro de reducción de ruido (blur gaussiano) sobre un canvas.
   * El nivel determina cuántos pases se aplican.
   *
   * @param {CanvasRenderingContext2D} ctx - Contexto 2D del canvas de salida.
   * @param {number} level                 - Nivel de denoise (0–3).
   */
  function applyDenoise(ctx, level) {
    if (level <= 0) return;

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    // Kernel gaussiano 3×3
    const gaussKernel = [
      1, 2, 1,
      2, 4, 2,
      1, 2, 1,
    ];

    // Aplicar el kernel gaussiano tantas veces como el nivel indique
    const passes = level; // 1, 2 o 3 pases
    for (let p = 0; p < passes; p++) {
      const imageData = ctx.getImageData(0, 0, w, h);
      const filtered  = applyConvolution(imageData, gaussKernel, 16, 0);
      ctx.putImageData(filtered, 0, 0);
    }
  }

  /* ────────────────────────────────────────────────
     PROCESAMIENTO POR TILES — no bloquea el hilo principal
  ──────────────────────────────────────────────── */

  /**
   * Actualiza la barra de progreso y el texto de porcentaje.
   * @param {number} pct - Porcentaje de avance (0–100).
   */
  function updateProgress(pct) {
    const rounded = Math.round(pct);
    progressFill.style.width = `${rounded}%`;
    progressFill.setAttribute('aria-valuenow', rounded);
    progressPct.textContent = `${rounded}%`;
  }

  /**
   * Espera un frame de animación para permitir que el navegador actualice la UI.
   * @returns {Promise<void>}
   */
  function yieldFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  /**
   * Realiza el upscaling de la imagen fuente en el canvas de salida.
   * Procesa en columnas de tiles verticales para no bloquear el hilo principal.
   *
   * @param {HTMLImageElement} img     - Imagen fuente.
   * @param {HTMLCanvasElement} canvas - Canvas de destino (ya dimensionado).
   * @param {number} scale             - Factor de escala.
   * @param {number} denoise           - Nivel de denoise.
   * @returns {Promise<void>}
   */
  async function upscaleImage(img, canvas, scale, denoise) {
    const dstW = canvas.width;
    const dstH = canvas.height;
    const ctx  = canvas.getContext('2d');

    // Paso 1: escalar la imagen completa al tamaño destino con alta calidad
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, dstW, dstH);

    // Paso 2: procesar en tiles verticales para actualizar el progreso
    const TILE_W = Math.min(TILE_WIDTH, dstW);
    const cols   = Math.ceil(dstW / TILE_W);

    for (let col = 0; col < cols; col++) {
      const x  = col * TILE_W;
      const tw = Math.min(TILE_W, dstW - x);

      // Aplicar denoise en el tile actual
      if (denoise > 0) {
        const tileData = ctx.getImageData(x, 0, tw, dstH);
        const gaussKernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
        let filtered = { data: tileData.data, width: tw, height: dstH };

        for (let p = 0; p < denoise; p++) {
          const id = new ImageData(new Uint8ClampedArray(filtered.data), tw, dstH);
          filtered = applyConvolution(id, gaussKernel, 16, 0);
        }

        ctx.putImageData(filtered, x, 0);
      }

      // Actualizar progreso: denoise representa el 60% del trabajo
      updateProgress(((col + 1) / cols) * 60);
      await yieldFrame();
    }

    // Paso 3: sharpening global (intensidad según el scale)
    progressLabel.textContent = 'Aplicando sharpening…';
    const sharpenStrength = Math.min(0.8, 0.2 + (scale - 1) * 0.2);
    applySharpen(ctx, sharpenStrength);
    updateProgress(90);
    await yieldFrame();

    // Paso 4: denoise suave post-sharpen (nivel ≥ 2)
    if (denoise >= 2) {
      progressLabel.textContent = 'Suavizando artefactos…';
      applyDenoise(ctx, 1);
    }

    updateProgress(100);
  }

  /* ────────────────────────────────────────────────
     BOTÓN "PROCESAR IMAGEN"
  ──────────────────────────────────────────────── */

  processBtn.addEventListener('click', async () => {
    if (!sourceImage) return;

    const startTime = performance.now();

    // Preparar UI: mostrar barra de progreso, ocultar controles y resultado
    processBtn.disabled  = true;
    paramsSection.hidden = true;
    progressSection.hidden = false;
    progressFill.classList.add('animating');
    progressLabel.textContent = 'Escalando imagen…';
    updateProgress(0);
    resultPlaceholder.hidden = true;
    resultContent.hidden = true;

    // Dimensiones de salida
    const srcW  = sourceImage.naturalWidth;
    const srcH  = sourceImage.naturalHeight;
    const dstW  = srcW * currentScale;
    const dstH  = srcH * currentScale;

    // Dibujar "antes" en beforeCanvas (tamaño visual reducido para la comparativa)
    const previewW = Math.min(srcW, MAX_PREVIEW_WIDTH);
    const previewH = Math.round(srcH * (previewW / srcW));

    beforeCanvas.width  = previewW;
    beforeCanvas.height = previewH;
    const bCtx = beforeCanvas.getContext('2d');
    bCtx.imageSmoothingEnabled = true;
    bCtx.imageSmoothingQuality = 'high';
    bCtx.drawImage(sourceImage, 0, 0, previewW, previewH);

    // Crear canvas de salida en resolución real
    const realCanvas = document.createElement('canvas');
    realCanvas.width  = dstW;
    realCanvas.height = dstH;

    try {
      await upscaleImage(sourceImage, realCanvas, currentScale, currentDenoise);
    } catch (err) {
      console.error('Error durante el upscaling:', err);
      alert('Ocurrió un error al procesar la imagen. Por favor intenta con una imagen más pequeña.');
      processBtn.disabled = false;
      paramsSection.hidden = false;
      progressSection.hidden = true;
      progressFill.classList.remove('animating');
      return;
    }

    // Guardar referencia al canvas de salida real (para descarga)
    outputCanvas = realCanvas;

    // Dibujar "después" en afterCanvas (versión reducida para la comparativa)
    const afterPreviewW = Math.min(dstW, MAX_PREVIEW_WIDTH * currentScale);
    const afterPreviewH = Math.round(dstH * (afterPreviewW / dstW));
    afterCanvas.width  = afterPreviewW;
    afterCanvas.height = afterPreviewH;
    const aCtx = afterCanvas.getContext('2d');
    aCtx.imageSmoothingEnabled = true;
    aCtx.imageSmoothingQuality = 'high';
    aCtx.drawImage(realCanvas, 0, 0, afterPreviewW, afterPreviewH);

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

    // Mostrar estadísticas del resultado
    resultStats.innerHTML = `
      <span class="result-stat">📐 <strong>${srcW}×${srcH}</strong> → <strong>${dstW}×${dstH} px</strong></span>
      <span class="result-stat">⚡ Tiempo: <strong>${elapsed} s</strong></span>
      <span class="result-stat">🔍 Escala: <strong>${currentScale}x</strong></span>
      <span class="result-stat">🔇 Denoise: <strong>${currentDenoise}</strong></span>
    `;

    // Actualizar UI: ocultar progreso, mostrar resultado
    progressFill.classList.remove('animating');
    progressSection.hidden = true;
    paramsSection.hidden   = false;
    processBtn.disabled    = false;
    resultContent.hidden   = false;
  });

  /* ────────────────────────────────────────────────
     DESCARGA DEL RESULTADO
  ──────────────────────────────────────────────── */

  downloadBtn.addEventListener('click', () => {
    if (!outputCanvas) return;

    outputCanvas.toBlob((blob) => {
      if (!blob) return;
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href     = url;
      const origName = selectedFile ? selectedFile.name.replace(/\.[^.]+$/, '') : 'image';
      link.download = `${origName}_upscaled_${currentScale}x.png`;
      link.click();
      // Liberar el objeto URL tras la descarga
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  });

  /* ────────────────────────────────────────────────
     RESET — limpiar y empezar de nuevo
  ──────────────────────────────────────────────── */

  resetBtn.addEventListener('click', () => {
    selectedFile  = null;
    sourceImage   = null;
    outputCanvas  = null;

    // Limpiar el input de archivo para permitir seleccionar el mismo archivo
    imageInput.value = '';

    // Restaurar estado inicial de la UI
    uploadZone.classList.remove('has-image');
    previewSection.hidden  = true;
    paramsSection.hidden   = true;
    progressSection.hidden = true;
    resultPlaceholder.hidden = false;
    resultContent.hidden   = true;

    previewImg.src = '';
    previewInfo.textContent = '';
    resultStats.innerHTML = '';

    // Limpiar los canvas de comparativa
    const bCtx = beforeCanvas.getContext('2d');
    bCtx.clearRect(0, 0, beforeCanvas.width, beforeCanvas.height);
    const aCtx = afterCanvas.getContext('2d');
    aCtx.clearRect(0, 0, afterCanvas.width, afterCanvas.height);

    updateProgress(0);
    progressLabel.textContent = 'Procesando…';
    processBtn.disabled = false;
  });

})();
