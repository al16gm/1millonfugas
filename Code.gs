/**
 * Code.gs — Backend Apps Script para "¿Quién quiere detectar un millón de fugas?"
 * Versión optimizada: cache corto, CORS habilitado, acciones admin confiables.
 */

const SPREADSHEET_ID = '1SfgkzuKd5vEg4epgvtgnscpzpoXTS4QD-ZeF3ubW5y0';
const CACHE_TTL = 8; // segundos — balance entre rendimiento y reactividad

// ── Entry points ──────────────────────────────────────────────────────────────

function doGet(e) {
  // Habilitar CORS para que el admin pueda leer la respuesta
  const output = _route(e);
  return output;
}

function doPost(e) {
  return _route(e);
}

function _route(e) {
  try {
    const action = (e.parameter && e.parameter.action) || '';

    if (action === 'game_state')   return jsonResponse(getGameState());
    if (action === 'login')        return jsonResponse(loginPlayer(e.parameter.nombre, e.parameter.org));
    if (action === 'answer')       return jsonResponse(submitAnswer(JSON.parse(e.parameter.data)));
    if (action === 'admin_action') return jsonResponse(handleAdminAction(JSON.parse(e.parameter.data)));

    return HtmlService.createHtmlOutput('Servicio activo. Usa ?action=game_state');
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Spreadsheet helpers ───────────────────────────────────────────────────────

function getSs() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet(name) {
  const ss = getSs();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function invalidateCache() {
  CacheService.getScriptCache().remove('gs_cache');
}

// ── game_state ────────────────────────────────────────────────────────────────

function getGameState() {
  const cache = CacheService.getScriptCache();
  const hit   = cache.get('gs_cache');
  if (hit) {
    try { return JSON.parse(hit); } catch(e) {}
  }
  const fresh = fetchFreshGameState();
  if (fresh.success) {
    try { cache.put('gs_cache', JSON.stringify(fresh), CACHE_TTL); } catch(e) {}
  }
  return fresh;
}

function fetchFreshGameState() {
  try {
    // ── CONFIG ──
    const configSheet = getSheet('CONFIG');
    let configData = configSheet.getDataRange().getValues();

    const requiredHeaders = ['estado_juego','pregunta_actual','tiempo_limite','musica_fondo_activa',
      'comodin_50','comodin_publico','comodin_llamada','session_id','respuesta_revelar',
      'timestamp_inicio','timestamp_llamada','comodin_publico_data'];

    if (configData.length < 2) {
      configSheet.clear();
      configSheet.appendRow(requiredHeaders);
      configSheet.appendRow(['ESPERA',1,10000,false,false,false,false,1,'',0,0,'']);
      SpreadsheetApp.flush();
      configData = configSheet.getDataRange().getValues();
    } else {
      const existing = configData[0].map(function(h){ return String(h).trim(); });
      let modified = false;
      requiredHeaders.forEach(function(h) {
        if (existing.indexOf(h) === -1) {
          const col = existing.length + 1;
          configSheet.getRange(1, col).setValue(h);
          configSheet.getRange(2, col).setValue(['timestamp_inicio','timestamp_llamada'].indexOf(h) > -1 ? 0 : '');
          existing.push(h);
          modified = true;
        }
      });
      if (modified) {
        SpreadsheetApp.flush();
        configData = configSheet.getDataRange().getValues();
      }
    }

    const headers = configData[0].map(function(h){ return String(h).trim(); });
    const config  = {};
    headers.forEach(function(h, i) {
      let v = configData[1][i];
      if (v === 'true'  || v === true)  v = true;
      if (v === 'false' || v === false) v = false;
      config[h] = v;
    });

    // ── PREGUNTAS ──
    const qSheet = getSs().getSheetByName('PREGUNTAS');
    if (!qSheet) throw new Error("Pestaña 'PREGUNTAS' no encontrada");

    const qData    = qSheet.getDataRange().getValues();
    const qHeaders = qData[0].map(function(h){ return String(h).toLowerCase().trim(); });
    const gc = function(name){ return qHeaders.indexOf(name.toLowerCase()); };

    const currentId = String(config.pregunta_actual || '1').trim();
    let   currentQ  = null;
    const allQ      = [];

    for (let i = 1; i < qData.length; i++) {
      const row = qData[i];
      const qId = gc('id') > -1 ? String(row[gc('id')]).trim() : '';
      if (!qId) continue;

      const q = {
        id:          qId,
        pregunta:    gc('pregunta') > -1    ? row[gc('pregunta')]    : 'Sin texto',
        A:           gc('a') > -1           ? row[gc('a')]           : '-',
        B:           gc('b') > -1           ? row[gc('b')]           : '-',
        C:           gc('c') > -1           ? row[gc('c')]           : '-',
        D:           gc('d') > -1           ? row[gc('d')]           : '-',
        correcta:    gc('correcta') > -1    ? String(row[gc('correcta')]).toUpperCase().trim() : 'A',
        nivel:       gc('nivel') > -1       ? row[gc('nivel')]       : 1,
        sonido_inicio: gc('sonido_inicio') > -1 ? fixDriveUrl(row[gc('sonido_inicio')]) : '',
        sonido_final:  gc('sonido_final') > -1  ? fixDriveUrl(row[gc('sonido_final')])  : ''
      };
      allQ.push(q);
      if (qId === currentId) currentQ = q;
    }
    if (!currentQ && allQ.length > 0) currentQ = allQ[0];

    return {
      success:      true,
      config:       config,
      question:     currentQ,
      allQuestions: allQ,
      ranking:      getRanking(config.session_id),
      serverTime:   Date.now()
    };
  } catch (err) {
    return { success: false, error: 'Error crítico: ' + err.toString() };
  }
}

function fixDriveUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const m = url.match(/\/d\/([^/?]+)/) || url.match(/id=([^&]+)/);
  if (m && m[1]) return 'https://drive.google.com/uc?export=download&id=' + m[1];
  return url;
}

// ── login ─────────────────────────────────────────────────────────────────────

function loginPlayer(nombre, org) {
  try {
    const sheet = getSheet('JUGADORES');
    const state = getGameState();
    const sessionId = state.config ? state.config.session_id : 1;

    // Asegurar cabeceras
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['id','nombre','org','puntos','fecha','session_id']);
    }
    const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0]
                         .map(function(h){ return String(h).toLowerCase().trim(); });
    if (headers.indexOf('session_id') === -1) {
      sheet.getRange(1, headers.length + 1).setValue('session_id');
      headers.push('session_id');
    }

    const id  = 'P' + Math.floor(Math.random() * 9000000 + 1000000);
    const row = new Array(headers.length).fill('');
    row[headers.indexOf('id')]         = id;
    row[headers.indexOf('nombre')]     = nombre;
    row[headers.indexOf('org')]        = org || '';
    row[headers.indexOf('puntos')]     = 0;
    row[headers.indexOf('fecha')]      = new Date();
    row[headers.indexOf('session_id')] = sessionId;
    sheet.appendRow(row);
    invalidateCache();
    return { success: true, id: id };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ── answer ────────────────────────────────────────────────────────────────────

function submitAnswer(data) {
  const state = getGameState();
  if (!state.success || state.config.estado_juego !== 'ACTIVA') {
    return { success: false, message: 'Pregunta no activa' };
  }

  const correcta  = state.question.correcta;
  const isCorrect = data.respuesta === correcta;
  const limit     = state.config.tiempo_limite || 10000;
  const puntos    = isCorrect ? Math.max(0, Math.round(1000 * (1 - data.tiempo_ms / limit))) : 0;

  // Guardar respuesta
  const answersSheet = getSheet('RESPUESTAS');
  if (answersSheet.getLastRow() === 0) {
    answersSheet.appendRow(['pregunta_id','participante_id','respuesta','tiempo_ms','correcta','puntos']);
  }
  answersSheet.appendRow([data.pregunta_id, data.participante_id, data.respuesta, data.tiempo_ms, isCorrect, puntos]);

  // Actualizar puntos del jugador
  if (puntos > 0) {
    const pSheet = getSheet('JUGADORES');
    const pData  = pSheet.getDataRange().getValues();
    const pHeaders = pData[0].map(function(h){ return String(h).toLowerCase().trim(); });
    const colId  = pHeaders.indexOf('id');
    const colPts = pHeaders.indexOf('puntos');
    for (let i = 1; i < pData.length; i++) {
      if (String(pData[i][colId]) === String(data.participante_id)) {
        pSheet.getRange(i + 1, colPts + 1).setValue((Number(pData[i][colPts]) || 0) + puntos);
        break;
      }
    }
  }

  invalidateCache();
  return { success: true, correct: isCorrect, puntos: puntos };
}

// ── admin_action ──────────────────────────────────────────────────────────────

function handleAdminAction(data) {
  try {
    const configSheet = getSheet('CONFIG');
    const lastCol     = Math.max(configSheet.getLastColumn(), 1);
    const vals        = configSheet.getRange(1, 1, 2, lastCol).getValues();
    const headers     = vals[0].map(function(h){ return String(h).trim(); });
    const row         = vals[1];

    const setCol = function(key, value) {
      const idx = headers.indexOf(key);
      if (idx > -1) { row[idx] = value; return true; }
      return false;
    };
    const getCol = function(key) {
      const idx = headers.indexOf(key);
      return idx > -1 ? row[idx] : undefined;
    };

    // ── update_config ──
    if (data.type === 'update_config') {
      for (const key in data.updates) {
        let value = data.updates[key];
        setCol(key, value);

        // Si activamos el juego, guardamos el timestamp de inicio
        if (key === 'estado_juego' && (value === 'ACTIVA')) {
          if (!data.updates.timestamp_inicio) {
            setCol('timestamp_inicio', Date.now());
          }
        }

        // Cambio de pregunta → limpiar datos de comodín y revelación
        if (key === 'pregunta_actual') {
          setCol('comodin_publico_data', '');
          setCol('respuesta_revelar', '');
          setCol('timestamp_llamada', 0);
        }
      }

      // Generar datos del comodín público si se activa y no los hay
      const pubIdx = headers.indexOf('comodin_publico');
      if (pubIdx > -1 && (row[pubIdx] === true || row[pubIdx] === 'true')) {
        const dataIdx = headers.indexOf('comodin_publico_data');
        if (dataIdx > -1 && (!row[dataIdx] || row[dataIdx] === '')) {
          row[dataIdx] = generatePollData(getCol, row, headers);
        }
      }

      configSheet.getRange(2, 1, 1, lastCol).setValues([row]);
      SpreadsheetApp.flush();
      invalidateCache();
      return { success: true };
    }

    // ── reset_game ──
    if (data.type === 'reset_game') {
      const nextSession = (Number(getCol('session_id')) || 1) + 1;
      const resets = { estado_juego:'ESPERA', pregunta_actual:1, session_id:nextSession,
        comodin_50:false, comodin_publico:false, comodin_llamada:false,
        respuesta_revelar:'', comodin_publico_data:'', timestamp_inicio:0, timestamp_llamada:0 };
      for (const k in resets) setCol(k, resets[k]);
      configSheet.getRange(2, 1, 1, lastCol).setValues([row]);
      SpreadsheetApp.flush();
      invalidateCache();
      return { success: true };
    }

    // ── delete_player ──
    if (data.type === 'delete_player') {
      const pSheet = getSheet('JUGADORES');
      const pData  = pSheet.getDataRange().getValues();
      const colId  = pData[0].map(function(h){ return String(h).toLowerCase(); }).indexOf('id');
      for (let i = 1; i < pData.length; i++) {
        if (String(pData[i][colId]) === String(data.playerId)) {
          pSheet.deleteRow(i + 1);
          invalidateCache();
          break;
        }
      }
      return { success: true };
    }

    return { success: false, error: 'Acción desconocida: ' + data.type };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// Genera datos simulados de encuesta al público (suma 100%)
function generatePollData(getCol, row, headers) {
  try {
    const state   = fetchFreshGameState();
    if (!state.question) return '{}';

    const correct = state.question.correcta;
    const opts    = ['A','B','C','D'];
    const is50    = (row[headers.indexOf('comodin_50')] === true || row[headers.indexOf('comodin_50')] === 'true');
    const active  = is50
      ? [correct, opts.filter(function(o){ return o !== correct; })[2] || 'B']
      : opts;

    const result  = { A:0, B:0, C:0, D:0 };
    const correct_majority = Math.random() < 0.75;
    const winner  = correct_majority ? correct : (function() {
      const w = active.filter(function(o){ return o !== correct; });
      return w[Math.floor(Math.random() * w.length)] || correct;
    })();

    let remaining = 100;
    const majorVal = 50 + Math.floor(Math.random() * 30); // 50–79%
    result[winner] = majorVal;
    remaining -= majorVal;

    const others = active.filter(function(o){ return o !== winner; });
    others.forEach(function(o, i) {
      if (i === others.length - 1) {
        result[o] = remaining;
      } else {
        const v = Math.max(1, Math.floor(Math.random() * (remaining - (others.length - i - 1))));
        result[o] = v;
        remaining -= v;
      }
    });

    // Verificar que sume 100
    const total = result.A + result.B + result.C + result.D;
    if (total !== 100) result[correct] += (100 - total);

    return JSON.stringify(result);
  } catch(e) {
    return '{}';
  }
}

// ── Ranking ───────────────────────────────────────────────────────────────────

function getRanking(sessionId) {
  try {
    const sheet = getSs().getSheetByName('JUGADORES');
    if (!sheet || sheet.getLastRow() < 2) return [];

    const data    = sheet.getDataRange().getValues();
    const headers = data[0].map(function(h){ return String(h).toLowerCase().trim(); });
    const ci = { id: headers.indexOf('id'), nombre: headers.indexOf('nombre'), org: headers.indexOf('org'), puntos: headers.indexOf('puntos'), session: headers.indexOf('session_id') };

    const players = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const ps  = ci.session > -1 ? String(row[ci.session] || 1) : '1';
      if (ps !== String(sessionId)) continue;
      players.push({
        id:     ci.id     > -1 ? row[ci.id]     : '',
        nombre: ci.nombre > -1 ? row[ci.nombre] : 'Anónimo',
        org:    ci.org    > -1 ? row[ci.org]    : '',
        score:  ci.puntos > -1 ? (Number(row[ci.puntos]) || 0) : 0
      });
    }
    return players.sort(function(a,b){ return b.score - a.score; });
  } catch(e) {
    return [];
  }
}
