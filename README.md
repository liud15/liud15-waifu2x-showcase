# Waifu2x Extension GUI — Showcase

> Página web moderna y completamente funcional que presenta todas las funcionalidades de **Waifu2x-Extension-GUI**, el upscaler de imágenes y vídeos con IA más completo para Windows.

---

## 🖥️ Vista previa

La página incluye:

- **Hero** con degradado oscuro morado/azul, estadísticas y CTAs de descarga
- **6 motores de IA** (Waifu2x, Real-ESRGAN, Real-CUGAN, SRMD, RealSR, Anime4K) con cards interactivas
- **Tipos de archivos soportados** (imágenes, GIFs animados y vídeos)
- **Parámetros configurables** (escala, denoise, formato, GPU, hilos)
- **Comparador antes/después** interactivo con slider arrastrable (mouse y touch)
- **Lista de características** destacadas con iconos
- **Pasos de instalación** numerados
- **FAQ** en formato acordeón animado
- **Footer** con créditos y enlaces al repositorio oficial

---

## 🚀 Cómo ejecutar localmente

No requiere servidor ni instalación de dependencias:

```bash
# Clona el repositorio
git clone https://github.com/liud15/liud15-waifu2x-showcase.git

# Entra al directorio
cd liud15-waifu2x-showcase

# Abre el archivo en tu navegador
# En Linux/macOS:
open index.html
# En Windows:
start index.html
```

O simplemente abre `index.html` directamente desde tu explorador de archivos.

---

## 🗂️ Estructura de archivos

```
liud15-waifu2x-showcase/
├── index.html          # Página principal (9 secciones)
├── css/
│   └── style.css       # Estilos (tema oscuro, responsive, animaciones)
├── js/
│   └── main.js         # JavaScript vanilla (slider, FAQ, navbar, observers)
├── assets/             # Carpeta para recursos adicionales
└── README.md           # Este archivo
```

---

## 🛠️ Tecnologías utilizadas

| Tecnología        | Uso                                         |
|-------------------|---------------------------------------------|
| **HTML5**         | Semántica, accesibilidad (ARIA)             |
| **CSS3 Vanilla**  | Variables CSS, Grid, Flexbox, animaciones   |
| **JavaScript ES6+** | Sin frameworks, vanilla puro              |
| **Google Fonts**  | Inter + Poppins via CDN                     |
| **SVG inline**    | Iconos y decoraciones sin librerías externas|

### Características técnicas del código

- **Navbar sticky** con glassmorphism (`backdrop-filter`) al hacer scroll
- **IntersectionObserver API** para animaciones de entrada al viewport
- **Slider de comparación** con soporte completo para mouse, touch y teclado
- **FAQ accordion** animado con `max-height` para transición suave
- **Diseño responsive** mobile-first con breakpoints en 480px, 768px y 900px
- **Accesibilidad**: roles ARIA, `aria-expanded`, `aria-label`, navegación por teclado
- **`prefers-reduced-motion`**: respeta las preferencias de accesibilidad del sistema

---

## 🎨 Paleta de colores

| Variable          | Color     | Uso                        |
|-------------------|-----------|----------------------------|
| `--bg-primary`    | `#0f0c1d` | Fondo principal            |
| `--bg-secondary`  | `#1a1a2e` | Secciones alternadas       |
| `--purple`        | `#7c3aed` | Color de acento primario   |
| `--blue`          | `#3b82f6` | Color de acento secundario |
| `--text-primary`  | `#f1f5f9` | Texto principal            |
| `--text-secondary`| `#94a3b8` | Texto secundario           |

---

## 🤖 Acerca de Waifu2x-Extension-GUI

**Waifu2x-Extension-GUI** es una herramienta de upscaling de imágenes, GIFs y vídeos basada en IA para Windows. Incluye múltiples motores de inteligencia artificial y soporte para aceleración por GPU.

- 🔗 **Repositorio oficial**: [github.com/AaronFeng753/Waifu2x-Extension-GUI](https://github.com/AaronFeng753/Waifu2x-Extension-GUI)
- 👨‍💻 **Autor**: [Aaron Feng](https://github.com/AaronFeng753)
- 📄 **Licencia**: Consultar el repositorio oficial

---

## 📝 Créditos

- **Herramienta original**: Waifu2x-Extension-GUI por [Aaron Feng](https://github.com/AaronFeng753)
- **Showcase**: Desarrollado por **liud15**
- **Año**: 2026