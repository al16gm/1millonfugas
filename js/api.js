/**
 * api.js — Capa de comunicación con el backend Apps Script
 */

let _pollTimer   = null;
let _isFetching  = false;

function startPolling(onUpdate, interval) {
  interval = interval || 800;
  stopPolling();
  var tick = async function() {
    if (_isFetching) { _pollTimer = setTimeout(tick, interval); return; }
    _isFetching = true;
    try {
      var state = await apiGetState();
      if (state) onUpdate(state);
    } finally {
      _isFetching = false;
      _pollTimer  = setTimeout(tick, interval);
    }
  };
  tick();
}

function stopPolling() {
  if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
}

async function apiGetState() {
  try {
    var r = await fetch(SCRIPT_URL + '?action=game_state&_t=' + Date.now());
    if (!r.ok) return { success: false, error: 'HTTP ' + r.status };
    return await r.json();
  } catch(e) {
    return { success: false, error: e.message };
  }
}

async function apiLogin(nombre, org) {
  var url = SCRIPT_URL + '?action=login&nombre=' + encodeURIComponent(nombre) + '&org=' + encodeURIComponent(org || '');
  var r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function apiAnswer(participanteId, preguntaId, respuesta, tiempoMs) {
  var retries = 3;
  var data = JSON.stringify({
    participante_id: participanteId,
    pregunta_id:     preguntaId,
    respuesta:       respuesta,
    tiempo_ms:       tiempoMs
  });
  var url = SCRIPT_URL + '?action=answer&data=' + encodeURIComponent(data) + '&_t=' + Date.now();

  for (var i = 0; i < retries; i++) {
    try {
      await fetch(url, { mode: 'no-cors', cache: 'no-store' });
      return;
    } catch(e) {
      if (i === retries - 1) throw e;
      await new Promise(function(res){ setTimeout(res, 500); });
    }
  }
}

async function apiAdmin(data) {
  var retries = 3;
  var url = SCRIPT_URL + '?action=admin_action&data=' + encodeURIComponent(JSON.stringify(data)) + '&_t=' + Date.now();
  var lastError = null;

  for (var i = 0; i < retries; i++) {
    try {
      var r = await fetch(url, { cache: 'no-store' });
      if (r.ok) return await r.json();
      if (r.status === 404) throw new Error('Script URL no encontrada (404)');
      lastError = new Error('HTTP ' + r.status);
    } catch(e) {
      lastError = e;
    }
    await new Promise(function(res){ setTimeout(res, 400); });
  }
  throw lastError || new Error('Admin action failed after retries');
}
