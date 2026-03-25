/**
 * api.js — Capa de comunicación con el backend Apps Script.
 */

let _pollTimer = null;
let _isFetching = false;

function startPolling(onUpdate, interval = 1500) {
  stopPolling();
  const tick = async () => {
    if (_isFetching) { _pollTimer = setTimeout(tick, interval); return; }
    _isFetching = true;
    try {
      const state = await apiGetState();
      if (state) onUpdate(state);
    } finally {
      _isFetching = false;
      _pollTimer = setTimeout(tick, interval);
    }
  };
  tick();
}

function stopPolling() {
  if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
}

async function apiGetState() {
  try {
    const r = await fetch(SCRIPT_URL + '?action=game_state&_t=' + Date.now());
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function apiLogin(nombre, org) {
  const url = SCRIPT_URL + '?action=login&nombre=' + encodeURIComponent(nombre) + '&org=' + encodeURIComponent(org);
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function apiAnswer(participanteId, preguntaId, respuesta, tiempoMs) {
  const data = JSON.stringify({ participante_id: participanteId, pregunta_id: preguntaId, respuesta: respuesta, tiempo_ms: tiempoMs });
  const url = SCRIPT_URL + '?action=answer&data=' + encodeURIComponent(data) + '&_t=' + Date.now();
  await fetch(url, { mode: 'no-cors', cache: 'no-store' });
}

async function apiAdmin(data, retries) {
  retries = retries || 3;
  const url = SCRIPT_URL + '?action=admin_action&data=' + encodeURIComponent(JSON.stringify(data)) + '&_t=' + Date.now();
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) return await r.json();
    } catch(e) { /* reintento */ }
    await new Promise(function(res){ setTimeout(res, 600); });
  }
  throw new Error('Admin action failed after retries');
}
