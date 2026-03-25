# 🎮 ¿Quién quiere detectar un millón de fugas?

Juego de concurso estilo "¿Quién quiere ser millonario?" para identificar sonidos de fugas de agua.

## Estructura del proyecto

```
millonario-fugas/
├── index.html          ← Página de inicio / configuración
├── player.html         ← Interfaz del jugador (móvil)
├── screen.html         ← Pantalla grande (TV / proyector)
├── admin.html          ← Panel de control del moderador
├── css/
│   └── styles.css      ← Estilos compartidos
├── js/
│   ├── config.js       ← URL del backend (editar aquí)
│   ├── api.js          ← Capa de comunicación
│   ├── player.js       ← Lógica del jugador
│   ├── screen.js       ← Lógica de la pantalla
│   └── admin.js        ← Lógica del admin
├── sounds/
│   ├── bg_music.mp3    ← Música de fondo
│   └── ...             ← Sonidos opcionales locales
└── Code.gs             ← Backend (Google Apps Script)
```

## Puesta en marcha

### 1. Backend (Google Apps Script)

1. Abre [script.google.com](https://script.google.com)
2. Crea un nuevo proyecto y pega el contenido de `Code.gs`
3. Cambia `SPREADSHEET_ID` por el ID de tu Google Sheet
4. **Despliega** → Implementar como aplicación web
   - Ejecutar como: **Tú**
   - Acceso: **Cualquiera** (sin iniciar sesión)
5. Copia la URL de despliegue

### 2. Frontend (GitHub Pages)

1. Haz fork o sube el repositorio a GitHub
2. En Settings → Pages → Source: **main branch / root**
3. Abre `index.html` y pega la URL del Apps Script en el campo del backend
   (se guarda en `localStorage`, cada dispositivo debe hacerlo una vez)

### 3. Google Sheet

La hoja debe tener estas pestañas:

| Pestaña | Columnas |
|---------|----------|
| **CONFIG** | estado_juego, pregunta_actual, tiempo_limite, musica_fondo_activa, comodin_50, comodin_publico, comodin_llamada, session_id, respuesta_revelar, timestamp_inicio, timestamp_llamada, comodin_publico_data |
| **PREGUNTAS** | id, pregunta, A, B, C, D, correcta, nivel, sonido_inicio, sonido_final |
| **JUGADORES** | id, nombre, org, puntos, fecha, session_id |
| **RESPUESTAS** | pregunta_id, participante_id, respuesta, tiempo_ms, correcta, puntos |

> Las columnas de CONFIG y JUGADORES se crean automáticamente si no existen.

### 4. Sonidos

**Opción A — Google Drive (recomendado)**
- Sube los MP3/WAV a Drive
- Comparte cada archivo como "Cualquiera con el enlace puede ver"
- Pega la URL de compartir en la columna `sonido_inicio` / `sonido_final` del Sheet
- El sistema los convierte automáticamente a URLs de descarga directa

**Opción B — Archivos locales (GitHub)**
- Sube los archivos a la carpeta `sounds/`
- Pon la ruta relativa en el Sheet: `sounds/mi_sonido.mp3`

**Música de fondo**
- Coloca tu archivo en `sounds/bg_music.mp3`
- O cambia la ruta en `screen.html` (etiqueta `<audio id="bg-audio">`)

## Flujo del juego

```
ESPERA → PREGUNTA → ACTIVA (timer) → CERRADA → REVELAR → RANKING → (siguiente pregunta)
```

| Estado | Qué ocurre |
|--------|-----------|
| ESPERA | Pantalla de bienvenida, los jugadores pueden registrarse |
| PREGUNTA | Se muestra la pregunta y opciones; timer en pausa |
| ACTIVA | Timer en marcha; jugadores pueden responder |
| CERRADA | Timer parado; no se aceptan más respuestas |
| REVELAR | Se marca correcta/incorrecta la respuesta seleccionada |
| RANKING | Top 10 en pantalla grande al estilo Kahoot |

## Comodines

| Comodín | Comportamiento |
|---------|---------------|
| **50%** | Elimina 2 opciones incorrectas (las primeras dos del array) |
| **Público** | Genera estadísticas simuladas (suma 100%) con el 75% de prob. de que la mayoría vote correcto |
| **Llamada** | Activa un contador regresivo de 30 segundos sincronizado con el servidor |

## Puntuación

`puntos = max(0, round(1000 × (1 − tiempo_ms / tiempo_limite)))`

- Respuesta en el momento 0: 1000 puntos
- Respuesta al final del tiempo: ~0 puntos
- Respuesta incorrecta: 0 puntos

## Solución de problemas

**El admin no recibe confirmación de sus acciones**
→ Verifica que el Apps Script esté desplegado como "Cualquiera sin iniciar sesión" y que la URL en `config.js` sea la correcta.

**Los sonidos de Drive no suenan**
→ Asegúrate de que los archivos están compartidos públicamente. Algunos navegadores bloquean audio sin interacción previa del usuario; usa el botón "ACTIVAR SONIDO" en la pantalla grande.

**El juego va lento / los cambios tardan en verse**
→ El cache del servidor es de 8 segundos. Las acciones del admin invalidan el cache inmediatamente. Si persiste, reduce `CACHE_TTL` en `Code.gs`.
