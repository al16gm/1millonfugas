/**
 * config.js — Fuente única de verdad para la URL del backend.
 * Cambia SCRIPT_URL aquí cuando redespliegues Apps Script.
 */

const SCRIPT_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbx7ZpZp7BBMgU2iOHjK5PPDzcook-xtaXttK3TwJovn5z__Da53tu04iymol1YyruuJ/exec';

// Permite sobrescribir via localStorage (útil para desarrollo / múltiples entornos)
const SCRIPT_URL = localStorage.getItem('millon_script_url') || SCRIPT_URL_DEFAULT;

// Normaliza cualquier URL de Drive a enlace directo de descarga/stream
function fixDriveUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const m = url.match(/\/d\/([^/?]+)/) || url.match(/id=([^&]+)/);
  if (m && m[1]) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return url;
}
