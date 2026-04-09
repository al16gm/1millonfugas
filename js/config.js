/**
 * config.js — Configuración de la URL del backend
 */

const SCRIPT_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbx_cW73cmLvHr-gRgIxQY1jtZ2XohGEtZXRi3z-BBwsuPEPCBS71ulDspNKGc0AiYdR/exec';

const SCRIPT_URL = localStorage.getItem('millon_script_url') || SCRIPT_URL_DEFAULT;

function fixDriveUrl(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.includes('drive.google.com')) {
    const m = url.match(/\/d\/([^/?]+)/) || 
              url.match(/id=([^&]+)/) || 
              url.match(/\/file\/d\/([^/]+)/);
    
    if (m && m[1]) {
      return `https://docs.google.com/uc?export=download&id=${m[1]}`;
    }
  }
  return url;
}
