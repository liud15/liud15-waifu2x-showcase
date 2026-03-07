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
