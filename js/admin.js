/**
 * admin.js — Panel de control del moderador
 */

var gameState = null;
var isBusy    = false;

// ── Arranque ──────────────────────────────────────────────────────────────────
startPolling(onStateUpdate, 1500);

// ── Callback polling ──────────────────────────────────────────────────────────
function onStateUpdate(data) {
  if (!data || !data.success) {
    setStatus('ERROR', true);
    return;
  }
  gameState = data;
  var config = data.config;

  setStatus(config.estado_juego || 'ESPERA', false);
  document.getElementById('current-q-label').textContent = 'Pregunta #' + (config.pregunta_actual || 1);

  // Botones de flujo — resaltar el activo
  ['ESPERA','PREGUNTA','ACTIVA','CERRADA','REVELAR','RANKING'].forEach(function(s) {
    var btn = document.getElementById('flow-' + s);
    if (btn) btn.classList.toggle('active', config.estado_juego === s);
  });

  // Timer
  var btnTimer = document.getElementById('flow-ACTIVA');
  if (btnTimer) {
    if (config.estado_juego === 'ACTIVA') {
      btnTimer.textContent = '⏹ PARAR';
      btnTimer.classList.add('active');
    } else {
      btnTimer.textContent = '▶ ACTIVAR';
      btnTimer.classList.remove('active');
    }
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

  // Preview pregunta
  renderQuestionPreview(data);

  // Lista de preguntas
  renderQuestionList(data.allQuestions || [], config.pregunta_actual);

  // Participantes
  renderParticipants(data.ranking || []);
}

// ── Flujo de juego ────────────────────────────────────────────────────────────
async function goTo(estado) {
  if (isBusy) return;
  var updates = { estado_juego: estado };
  if (estado === 'ACTIVA') {
    updates.timestamp_inicio = Date.now();
    updates.tiempo_limite = Number(document.getElementById('time-input').value) || 10000;
  }
  await send({ type: 'update_config', updates: updates });
}

async function continueFlow() {
  if (!gameState || isBusy) return;
  var estado = gameState.config.estado_juego;

  if (estado === 'ESPERA' || estado === 'RANKING') {
    // Avanzar pregunta
    var nextId = parseInt(gameState.config.pregunta_actual || 1);
    if (estado === 'RANKING') nextId++;
    var tl = Number(document.getElementById('time-input').value) || 10000;
    await send({ type: 'update_config', updates: {
      pregunta_actual: nextId, tiempo_limite: tl,
      estado_juego: 'PREGUNTA',
      comodin_50: false, comodin_publico: false, comodin_llamada: false,
      comodin_publico_data: '', respuesta_revelar: '', timestamp_llamada: 0
    }});

  } else if (estado === 'PREGUNTA') {
    // Activar tiempo
    var tl2 = Number(document.getElementById('time-input').value) || 10000;
    await send({ type: 'update_config', updates: {
      estado_juego: 'ACTIVA',
      timestamp_inicio: Date.now(),
      tiempo_limite: tl2
    }});

  } else if (estado === 'ACTIVA') {
    await goTo('CERRADA');

  } else if (estado === 'CERRADA') {
    await goTo('REVELAR');

  } else if (estado === 'REVELAR') {
    await goTo('RANKING');
  }
}

async function toggleTimer() {
  if (!gameState) return;
  var running = gameState.config.estado_juego === 'ACTIVA';
  if (running) {
    await goTo('CERRADA');
  } else {
    var tl = Number(document.getElementById('time-input').value) || 10000;
    await send({ type: 'update_config', updates: {
      estado_juego: 'ACTIVA',
      timestamp_inicio: Date.now(),
      tiempo_limite: tl
    }});
  }
}

async function changeQuestion() {
  var qId = document.getElementById('q-id-input').value;
  var tl  = Number(document.getElementById('time-input').value) || 10000;
  await send({ type: 'update_config', updates: {
    pregunta_actual: qId, tiempo_limite: tl,
    estado_juego: 'PREGUNTA',
    comodin_50: false, comodin_publico: false, comodin_llamada: false,
    comodin_publico_data: '', respuesta_revelar: '', timestamp_llamada: 0
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
      btn.style.background = 'rgba(212,175,55,0.25)';
      btn.style.borderColor = 'var(--gold)';
      btn.style.color = 'var(--gold)';
    } else {
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color = '';
    }
  });
  document.getElementById('btn-reveal-confirm').disabled = false;
}

async function confirmReveal() {
  if (!selectedReveal) return;
  await send({ type: 'update_config', updates: {
    respuesta_revelar: selectedReveal,
    estado_juego: 'REVELAR'
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

// ── Música ────────────────────────────────────────────────────────────────────
async function setMusic(active) {
  await send({ type: 'update_config', updates: { musica_fondo_activa: active }});
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

// ── Render helpers ────────────────────────────────────────────────────────────
function renderQuestionPreview(data) {
  var el = document.getElementById('q-preview');
  var q  = data.question;
  var config = data.config;
  if (!q) { el.innerHTML = '<p style="opacity:0.4;font-style:italic;font-size:12px">Pregunta no encontrada</p>'; return; }

  var hasPoll = config.comodin_publico_data && config.comodin_publico_data !== '{}';
  var pollHtml = '';
  if (hasPoll) {
    try {
      var pd = JSON.parse(config.comodin_publico_data);
      pollHtml = '<div style="margin-top:10px;padding:8px;background:rgba(14,165,233,0.07);border-radius:10px;border:1px solid rgba(14,165,233,0.2)">' +
        '<p style="font-size:9px;font-weight:800;color:var(--cyan);text-transform:uppercase;margin-bottom:6px">Encuesta Público</p>' +
        '<div style="display:flex;gap:8px">' +
        ['A','B','C','D'].map(function(o){ return '<div style="flex:1;text-align:center"><div style="font-size:10px;font-weight:700">' + o + '</div><div style="font-size:9px;opacity:0.6">' + (pd[o]||0) + '%</div></div>'; }).join('') +
        '</div></div>';
    } catch(e) {}
  }

  el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
    '<span style="font-size:9px;opacity:0.4;text-transform:uppercase;font-weight:800">Nivel ' + (q.nivel||1) + '</span>' +
    '<span style="font-size:10px;font-weight:700;color:var(--green)">✓ ' + q.correcta + '</span>' +
    '</div>' +
    '<p style="font-size:13px;font-weight:700;margin-bottom:10px">' + q.pregunta + '</p>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
    ['A','B','C','D'].map(function(o) {
      var hi = q.correcta === o ? 'border-color:var(--green);background:rgba(16,185,129,0.08)' : '';
      return '<div style="padding:7px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);font-size:10px;' + hi + '"><strong>' + o + ':</strong> ' + (q[o]||'') + '</div>';
    }).join('') +
    '</div>' +
    (q.sonido_inicio ? '<p style="margin-top:8px;font-size:9px;opacity:0.5">🎵 Sonido inicio: enlace configurado</p>' : '') +
    pollHtml;
}

function renderQuestionList(questions, currentId) {
  var el = document.getElementById('questions-list');
  if (!questions.length) { el.innerHTML = '<p style="opacity:0.3;font-size:10px;text-align:center;padding:12px">Sin preguntas</p>'; return; }
  el.innerHTML = questions.map(function(q) {
    var active = String(q.id) === String(currentId);
    return '<div onclick="jumpTo(\'' + q.id + '\')" style="padding:8px 10px;border-radius:10px;border:1px solid ' + (active?'var(--gold)':'rgba(255,255,255,0.08)') + ';background:' + (active?'rgba(212,175,55,0.12)':'rgba(255,255,255,0.03)') + ';cursor:pointer;display:flex;gap:8px;align-items:center;transition:all 0.2s">' +
      '<span style="font-size:9px;font-weight:900;color:var(--gold);min-width:20px">#' + q.id + '</span>' +
      '<span style="font-size:9px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.75">' + q.pregunta + '</span>' +
      '</div>';
  }).join('');
}

function renderParticipants(ranking) {
  var el  = document.getElementById('participants-list');
  var cnt = document.getElementById('participant-count');
  if (cnt) cnt.textContent = ranking.length;
  if (!ranking.length) { el.innerHTML = '<p style="opacity:0.3;font-size:10px;text-align:center;padding:12px">Sin participantes</p>'; return; }
  el.innerHTML = ranking.map(function(p) {
    return '<div style="padding:7px 10px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);display:flex;justify-content:space-between;align-items:center">' +
      '<div>' +
        '<p style="font-size:11px;font-weight:700">' + p.nombre + '</p>' +
        '<p style="font-size:9px;opacity:0.4;text-transform:uppercase">' + (p.org||'—') + '</p>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<span style="font-size:11px;font-weight:800;color:var(--green)">' + p.score + '</span>' +
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
  if (dot) dot.className = 'status-dot' + (isError ? ' error' : '');
}

function log(msg, isError) {
  var el = document.getElementById('admin-log');
  if (!el) return;
  var p = document.createElement('p');
  p.style.color = isError ? 'var(--red)' : 'rgba(14,165,233,0.6)';
  p.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  el.prepend(p);
  // Limpiar si crece mucho
  while (el.children.length > 40) el.removeChild(el.lastChild);
}

// ── Send wrapper ──────────────────────────────────────────────────────────────
async function send(data) {
  if (isBusy) return;
  isBusy = true;
  log('→ ' + data.type);
  try {
    await apiAdmin(data);
    log('✓ OK');
  } catch(e) {
    log('✗ ' + e.message, true);
  } finally {
    isBusy = false;
  }
}
