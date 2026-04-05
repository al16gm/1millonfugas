/**
 * admin.js — Panel de control del moderador
 * Versión: 2.0 — Con nuevo sistema de puntuación
 */

var gameState = null;
var isBusy    = false;
var adminTimerInterval = null;
var serverOffset = 0;
var lastAudioTrigger = 0;

// ── Arranque ──────────────────────────────────────────────────────────────────
startPolling(onStateUpdate, 800);

// ── Callback polling ──────────────────────────────────────────────────────────
function onStateUpdate(data) {
  if (!data || !data.success) {
    setStatus('ERROR', true);
    var msg = (data && data.error) ? data.error : 'Error desconocido';
    log('✗ ' + msg, true);
    return;
  }

  if (data.serverTime) {
    serverOffset = data.serverTime - Date.now();
  }

  gameState = data;
  var config = data.config;

  var debugEl = document.getElementById('debug-json');
  if (debugEl) {
    debugEl.textContent = 'JSON: ' + JSON.stringify(config).substring(0, 150) + '...';
  }

  var statusText = config.estado_juego || 'ESPERA';
  if (config.estado_juego === 'ACTIVA' || config.estado_juego === 'CERRADA') {
    statusText += ' (' + (data.answersCount || 0) + ' RESPUESTAS)';
  }
  setStatus(statusText, false);
  document.getElementById('current-q-label').textContent = 'Pregunta #' + (config.pregunta_actual || 1);

  // Botones de flujo
  ['ESPERA','PREGUNTA','OPCIONES','ACTIVA','CERRADA','REVELAR','RANKING'].forEach(function(s) {
    var btn = document.getElementById('flow-' + s);
    if (btn) btn.classList.toggle('active', config.estado_juego === s);
  });

  // Timer admin
  var timerEl = document.getElementById('admin-timer');
  if (config.estado_juego === 'ACTIVA') {
    var nowServer = Date.now() + serverOffset;
    var serverStart = config.timestamp_inicio || nowServer;
    var elapsed = (nowServer - serverStart) / 1000;
    var limit = (config.tiempo_limite || 10000) / 1000;

    if (elapsed < 0) {
      if (timerEl) timerEl.textContent = 'PREP... ' + Math.ceil(Math.abs(elapsed)) + 's';
    } else {
      var rem = Math.max(0, limit - elapsed);
      if (timerEl) timerEl.textContent = Math.ceil(rem) + 's';
    }

    if (!adminTimerInterval) {
      adminTimerInterval = setInterval(function() {
        var ns = Date.now() + serverOffset;
        var e  = (ns - serverStart) / 1000;
        if (e < 0) {
          if (timerEl) timerEl.textContent = 'PREP... ' + Math.ceil(Math.abs(e)) + 's';
        } else {
          var r = Math.max(0, limit - e);
          if (timerEl) timerEl.textContent = Math.ceil(r) + 's';
          if (r <= 0) { clearInterval(adminTimerInterval); adminTimerInterval = null; }
        }
      }, 500);
    }
  } else {
    if (adminTimerInterval) { clearInterval(adminTimerInterval); adminTimerInterval = null; }
    if (timerEl) timerEl.textContent = '';
  }

  // Comodines
  ['50','publico','llamada'].forEach(function(t) {
    var active = config['comodin_' + t] === true || config['comodin_' + t] === 'true';
    var btn = document.getElementById('joker-' + t);
    if (btn) btn.classList.toggle('active', active);
  });

  // Música
  var musicOn = config.musica_fondo_activa === true || config.musica_fondo_activa === 'true';
  var btnMusicOn  = document.getElementById('music-on');
  var btnMusicOff = document.getElementById('music-off');
  if (btnMusicOn)  btnMusicOn.classList.toggle('active', musicOn);
  if (btnMusicOff) btnMusicOff.classList.toggle('active', !musicOn);

  // Inputs
  var qInput = document.getElementById('q-id-input');
  if (qInput && document.activeElement !== qInput) qInput.value = config.pregunta_actual || 1;
  var tInput = document.getElementById('time-input');
  if (tInput && document.activeElement !== tInput) tInput.value = config.tiempo_limite || 10000;

  // Botón calcular puntos
  var btnCalc = document.getElementById('btn-calculate-scores');
  if (btnCalc) {
    var scoringDone = config.scoring_done_for_q === true || config.scoring_done_for_q === 'true';
    btnCalc.disabled = scoringDone;
    btnCalc.style.opacity = scoringDone ? '0.4' : '1';
    btnCalc.textContent = scoringDone ? '✅ PUNTOS YA CALCULADOS' : '🏆 CALCULAR PUNTOS';
  }

  renderQuestionPreview(data);
  renderQuestionList(data.allQuestions || [], config.pregunta_actual);
  renderParticipants(data.ranking || []);
}

// ── Flujo de juego ────────────────────────────────────────────────────────────
async function goTo(estado) {
  if (isBusy) return;
  var updates = { estado_juego: estado };
  if (estado === 'ACTIVA') {
    updates.tiempo_limite = Number(document.getElementById('time-input').value) || 10000;
  }
  await send({ type: 'update_config', updates: updates });
}

async function continueFlow() {
  if (!gameState) { log('⚠ No hay estado del juego aún', true); return; }
  if (isBusy)     { log('⚠ Sistema ocupado...', true); return; }

  var estado = gameState.config.estado_juego;
  var config = gameState.config;
  var q      = gameState.question;
  var now    = Date.now() + (serverOffset || 0);

  log('→ Continuar desde: ' + estado);

  if (estado === 'ESPERA') {
    var qId = parseInt(config.pregunta_actual || 1);
    var tl  = Number(document.getElementById('time-input').value) || 10000;
    await send({ type: 'update_config', updates: {
      pregunta_actual: qId, tiempo_limite: tl, estado_juego: 'PREGUNTA',
      comodin_50: false, comodin_publico: false, comodin_llamada: false,
      comodin_publico_data: '', respuesta_revelar: '', timestamp_llamada: 0
    }});

  } else if (estado === 'PREGUNTA') {
    await send({ type: 'update_config', updates: {
      estado_juego: 'OPCIONES', timestamp_opciones: now
    }});

  } else if (estado === 'OPCIONES') {
    var tl2 = Number(document.getElementById('time-input').value) || 10000;
    await send({ type: 'update_config', updates: {
      estado_juego: 'ACTIVA', tiempo_limite: tl2, timestamp_inicio: now
    }});

  } else if (estado === 'ACTIVA' || estado === 'CERRADA') {
    var correct = q ? q.correcta : '';
    await send({ type: 'update_config', updates: {
      estado_juego: 'REVELAR', respuesta_revelar: correct
    }});

  } else if (estado === 'REVELAR') {
    await send({ type: 'update_config', updates: { estado_juego: 'RANKING' }});

  } else if (estado === 'RANKING') {
    var nextId = parseInt(config.pregunta_actual || 1) + 1;
    var tl3 = Number(document.getElementById('time-input').value) || 10000;
    await send({ type: 'update_config', updates: {
      pregunta_actual: nextId, tiempo_limite: tl3, estado_juego: 'PREGUNTA',
      comodin_50: false, comodin_publico: false, comodin_llamada: false,
      comodin_publico_data: '', respuesta_revelar: '', timestamp_llamada: 0
    }});
  }
}

async function backFlow() {
  if (!gameState || isBusy) return;
  var estado = gameState.config.estado_juego;
  if (estado === 'PREGUNTA') {
    var cur = parseInt(gameState.config.pregunta_actual || 1);
    if (cur > 1) {
      await send({ type: 'update_config', updates: { pregunta_actual: cur - 1, estado_juego: 'RANKING' }});
    } else { await goTo('ESPERA'); }
  } else if (estado === 'OPCIONES')  { await goTo('PREGUNTA'); }
  else if (estado === 'ACTIVA')      { await goTo('OPCIONES'); }
  else if (estado === 'CERRADA')     { await goTo('ACTIVA'); }
  else if (estado === 'REVELAR')     { await goTo('ACTIVA'); }
  else if (estado === 'RANKING')     { await goTo('REVELAR'); }
}

async function changeQuestion() {
  var qId = document.getElementById('q-id-input').value;
  var tl  = Number(document.getElementById('time-input').value) || 10000;
  await send({ type: 'update_config', updates: {
    pregunta_actual: qId, tiempo_limite: tl, estado_juego: 'PREGUNTA',
    comodin_50: false, comodin_publico: false, comodin_llamada: false,
    comodin_publico_data: '', respuesta_revelar: '', timestamp_llamada: 0,
    timestamp_audio: Date.now()
  }});
}

async function jumpTo(id) {
  document.getElementById('q-id-input').value = id;
  await changeQuestion();
}

// ── Revelar respuesta ─────────────────────────────────────────────────────────
var selectedReveal = null;

function selectReveal(letter) {
  selectedReveal = letter;
  ['A','B','C','D'].forEach(function(l) {
    var btn = document.getElementById('rev-' + l);
    if (!btn) return;
    if (l === letter) {
      btn.style.background   = 'rgba(212,175,55,0.25)';
      btn.style.borderColor  = 'var(--gold)';
      btn.style.color        = 'var(--gold)';
    } else {
      btn.style.background   = '';
      btn.style.borderColor  = '';
      btn.style.color        = '';
    }
  });
  document.getElementById('btn-reveal-confirm').disabled = false;
  send({ type: 'update_config', updates: { respuesta_revelar: letter } });
}

async function confirmReveal() {
  if (!selectedReveal) return;
  await send({ type: 'update_config', updates: {
    respuesta_revelar: selectedReveal,
    estado_juego: 'REVELAR',
    sonido_actual: 'final',
    timestamp_audio: Date.now()
  }});
}

// ── Comodines ─────────────────────────────────────────────────────────────────
async function toggleJoker(type) {
  if (!gameState) return;
  var key = 'comodin_' + type;
  var cur = gameState.config[key] === true || gameState.config[key] === 'true';
  var updates = {};
  updates[key] = !cur;
  if (type === 'llamada' && !cur) updates.timestamp_llamada = Date.now();
  await send({ type: 'update_config', updates: updates });
}

// ── Música y Sonido ───────────────────────────────────────────────────────────
async function setMusic(active) {
  await send({ type: 'update_config', updates: { musica_fondo_activa: active }});
}

async function triggerSound(type) {
  await send({ type: 'update_config', updates: {
    sonido_actual: type, timestamp_audio: Date.now()
  }});
}

async function playManualSound(num) {
  await send({ type: 'update_config', updates: {
    sonido_actual: 'manual_' + num, timestamp_audio: Date.now()
  }});
}

async function stopManualSound() {
  await send({ type: 'update_config', updates: {
    sonido_actual: 'stop', timestamp_audio: Date.now()
  }});
}

// ── NUEVO: Calcular Puntos ────────────────────────────────────────────────────
async function calculateScores() {
  if (isBusy) return;
  if (!confirm('¿Calcular y aplicar puntos para la pregunta actual?\n\n• 5 pts al más rápido\n• -0.2 pts por segundo de retraso\n• 0 pts si falla\n\nEsto no se puede deshacer.')) return;
  log('→ Calculando puntos...');
  const res = await send({ type: 'calculate_scores' });
  if (res && res.success) {
    log('✓ Puntos calculados correctamente');
  }
}

// ── Eliminar jugador ──────────────────────────────────────────────────────────
async function deletePlayer(id) {
  if (!confirm('¿Eliminar este participante?')) return;
  await send({ type: 'delete_player', playerId: id });
}

// ── Reset ─────────────────────────────────────────────────────────────────────
async function resetGame() {
  if (!confirm('¿RESET COMPLETO? Se inicia nueva sesión (el histórico permanece en el Sheet).')) return;
  await send({ type: 'reset_game' });
}

async function forceRefresh() {
  if (isBusy) return;
  isBusy = true;
  log('⚡ Limpiando caché...');
  try {
    const url = SCRIPT_URL + '?action=game_state&force=true&_t=' + Date.now();
    const r = await fetch(url);
    if (r.ok) {
      const data = await r.json();
      onStateUpdate(data);
      log('✓ Caché limpia');
    }
  } catch(e) {
    log('✗ Error: ' + e.message, true);
  } finally {
    isBusy = false;
  }
}

// ── Render helpers ────────────────────────────────────────────────────────────
function renderQuestionPreview(data) {
  var el = document.getElementById('q-preview');
  var q  = data.question;
  var config = data.config;
  if (!el) return;
  if (!q) { el.innerHTML = '<p style="opacity:0.4;font-style:italic;font-size:12px">Pregunta no encontrada</p>'; return; }

  var hasPoll = config.comodin_publico_data && config.comodin_publico_data !== '{}';
  var pollHtml = '';
  if (hasPoll) {
    try {
      var pd = JSON.parse(config.comodin_publico_data);
      pollHtml = '<div style="margin-top:10px;padding:8px;background:rgba(14,165,233,0.07);border-radius:10px;border:1px solid rgba(14,165,233,0.2)">' +
        '<p style="font-size:9px;font-weight:800;color:var(--cyan);text-transform:uppercase;margin-bottom:6px">Encuesta Público</p>' +
        '<div style="display:flex;gap:8px">' +
        ['A','B','C','D'].map(function(o){
          return '<div style="flex:1;text-align:center"><div style="font-size:10px;font-weight:700">' + o + '</div>' +
                 '<div style="font-size:9px;opacity:0.6">' + (pd[o]||0) + '%</div></div>';
        }).join('') + '</div></div>';
    } catch(e) {}
  }

  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<span style="font-size:9px;opacity:0.4;text-transform:uppercase;font-weight:800">Nivel ' + (q.nivel||1) + '</span>' +
      '<span style="font-size:10px;font-weight:700;color:var(--green)">✓ ' + q.correcta + '</span>' +
    '</div>' +
    '<p style="font-size:13px;font-weight:700;margin-bottom:10px">' + q.pregunta + '</p>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
    ['A','B','C','D'].map(function(o) {
      var hi = q.correcta === o ? 'border-color:var(--green);background:rgba(16,185,129,0.08)' : '';
      return '<div style="padding:7px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);font-size:10px;' + hi + '"><strong>' + o + ':</strong> ' + (q[o]||'') + '</div>';
    }).join('') + '</div>' + pollHtml;
}

function renderQuestionList(questions, currentId) {
  var el = document.getElementById('questions-list');
  if (!el) return;
  if (!questions.length) { el.innerHTML = '<p style="opacity:0.3;font-size:10px;text-align:center;padding:12px">Sin preguntas</p>'; return; }
  el.innerHTML = questions.map(function(q) {
    var active = String(q.id) === String(currentId);
    return '<div onclick="jumpTo(\'' + q.id + '\')" style="padding:8px 10px;border-radius:10px;cursor:pointer;display:flex;gap:8px;align-items:center;transition:all 0.2s;border:1px solid ' +
      (active ? 'var(--gold)' : 'rgba(255,255,255,0.08)') + ';background:' +
      (active ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.03)') + '">' +
      '<span style="font-size:9px;font-weight:900;color:var(--gold);min-width:20px">#' + q.id + '</span>' +
      '<span style="font-size:9px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.75">' + q.pregunta + '</span>' +
      '</div>';
  }).join('');
}

function renderParticipants(ranking) {
  var el  = document.getElementById('participants-list');
  var cnt = document.getElementById('participant-count');
  if (cnt) cnt.textContent = ranking.length;
  if (!el) return;
  if (!ranking.length) { el.innerHTML = '<p style="opacity:0.3;font-size:10px;text-align:center;padding:12px">Sin participantes</p>'; return; }
  el.innerHTML = ranking.map(function(p, i) {
    var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i+1) + '.';
    return '<div style="padding:7px 10px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);display:flex;justify-content:space-between;align-items:center">' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<span style="font-size:11px;min-width:24px">' + medal + '</span>' +
        '<div>' +
          '<p style="font-size:11px;font-weight:700">' + p.nombre + '</p>' +
          '<p style="font-size:9px;opacity:0.4;text-transform:uppercase">' + (p.org||'—') + '</p>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<span style="font-size:11px;font-weight:800;color:var(--green)">' + p.score + ' pts</span>' +
        '<button onclick="deletePlayer(\'' + p.id + '\')" style="padding:3px 7px;border-radius:6px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:var(--red);font-size:9px;cursor:pointer">✕</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ── Status ────────────────────────────────────────────────────────────────────
function setStatus(text, isError) {
  var el  = document.getElementById('status-label');
  var dot = document.getElementById('status-dot');
  if (el)  el.textContent = text;
  if (dot) dot.className  = 'status-dot' + (isError ? ' error' : '');
}

function log(msg, isError) {
  var el = document.getElementById('admin-log');
  if (!el) return;
  var p = document.createElement('p');
  p.style.color = isError ? 'var(--red)' : 'rgba(14,165,233,0.6)';
  p.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  el.prepend(p);
  while (el.children.length > 40) el.removeChild(el.lastChild);
}

// ── Send wrapper ──────────────────────────────────────────────────────────────
async function send(data) {
  if (isBusy) return;
  isBusy = true;
  const btnCont = document.getElementById('btn-continue');
  if (btnCont) btnCont.style.opacity = '0.5';
  log('→ ' + data.type);
  try {
    await apiAdmin(data);
    log('✓ OK');
    // Forzar un poll inmediato para ver el cambio rápido
    setTimeout(async () => {
      const state = await apiGetState();
      if (state) onStateUpdate(state);
    }, 100);
  } catch(e) {
    log('✗ ' + e.message, true);
  } finally {
    isBusy = false;
    if (btnCont) btnCont.style.opacity = '1';
  }
}
