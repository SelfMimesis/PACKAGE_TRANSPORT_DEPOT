# Package Transport Depot

Web estatica creada con HTML, CSS y JavaScript vanilla. No usa frameworks,
librerias externas ni dependencias.

## Archivos principales

- `index.html`: estructura de la home y pantalla de video.
- `styles.css`: estetica oscura, responsive, paneles tecnicos y ratios de video.
- `script.js`: mapa de experiencias, precarga, fullscreen y cambio idle/active.
- `videos/`: clips normalizados para que sea facil reemplazarlos.

## Mapa de videos

Cada boton de la home apunta a dos clips:

| Boton | Idle | Active |
| --- | --- | --- |
| T08 1 | `videos/t08-1-idle.mp4` | `videos/t08-1-active.mp4` |
| T08 2 | `videos/t08-2-idle.mp4` | `videos/t08-2-active.mp4` |
| T08 3 | `videos/t08-3-idle.mp4` | `videos/t08-3-active.mp4` |
| T08 4 | `videos/t08-4-idle.mp4` | `videos/t08-4-active.mp4` |
| T13 1 | `videos/t13-1-idle.mp4` | `videos/t13-1-active.mp4` |
| T13 2 | `videos/t13-2-idle.mp4` | `videos/t13-2-active.mp4` |
| T13 3 | `videos/t13-3-idle.mp4` | `videos/t13-3-active.mp4` |

El ZIP traia clips `Loop` y `Action` claros para T08 1-3 y T13 1-2. Para
T08 4 y T13 3 solo habia un clip principal, asi que el archivo `active` se ha
creado como hardlink al mismo video para que el prototipo mantenga la misma
estructura y no duplique peso en disco.

Los clips extra del ZIP que no estaban asignados a una interaccion de la home
se dejaron en `videos/_extras/` por si quieres intercambiarlos despues.

## Comportamiento

- La home muestra `Package Transport Depot`, con secciones `T08` y `T13`.
- Al pulsar un boton se abre su experiencia de video.
- El video `idle` empieza visible y en loop.
- Al tocar el video, se muestra `active`; este se reinicia desde `0` en cada
  accion.
- Al volver a tocar, regresa a `idle` e intenta sincronizarlo con el tiempo de
  `active`.
- Los dos elementos `<video>` permanecen superpuestos. El video actual no se
  apaga durante la transicion: el siguiente se coloca encima y entra con un
  fundido de `0.2s`, evitando pantallas negras entre estados.

## Control de brillo

- La home incluye un selector de video y una barra de brillo.
- `100%` deja el video sin oscurecer.
- Al bajar la barra, aumenta la opacidad de una capa negra pura sobre la
  experiencia seleccionada.
- El valor se guarda por video en `localStorage` para mantener el ajuste tras
  recargar la pagina.
- La capa se aplica en `script.js` con la funcion `applyBrightnessOverlay`.
- Cuando conectemos el backend de Render, ese mismo estado podra sincronizarse
  desde el servidor sin cambiar la estructura visual.

## Ratios

- T08 usa proporcion base `1200 / 2000`.
- T13 usa proporcion base `2160 / 1440`.
- El contenido se ajusta al viewport con `object-fit: contain`, sin deformar el
  video.

## Zonas invisibles

- Esquina superior izquierda: boton invisible de `80px x 80px` para pantalla
  completa.
- Esquina superior derecha: boton invisible de `80px x 80px` para volver a la
  home.
- Tecla `Escape`: vuelve a la home cuando no estas en pantalla completa. En
  pantalla completa, el navegador normalmente usa `Escape` primero para salir
  de ese modo.

## Cambiar videos

Puedes reemplazar cualquier archivo dentro de `videos/` manteniendo el mismo
nombre. Si prefieres cambiar rutas o anadir pantallas, edita el objeto
`EXPERIENCES` al inicio de `script.js`.
