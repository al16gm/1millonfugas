/**
 * player.js — Lógica de la pantalla del jugador (móvil)
 */

// ── Estado local ──────────────────────────────────────────────────────────────
let playerId   = localStorage.getItem('millon_player_id');
let playerName = localStorage.getItem('millon_player_name');
let gameState  = null;
let hasAnswered   = false;
let selectedLetter = null;
let timerInterval  = null;
let timerRemaining = 0;
let startTimestamp = 0;
let audioEnabled   = localStorage.getItem('millon_audio') !== 'false';
const audioEl = document.getElementById('audio-player');

// ── Arranque ──────────────────────────────────────────────────────────────────
(function init() {
  updateMuteBtn();
  if (playerId && playerName) {
    showScreen('game-screen');
    startPolling(onStateUpdate);
  } else {
    showScreen('login-screen');
  }
})();

// ── Login ─────────────────────────────────────────────────────────────────────
async function login() {
  const nombre = document.getElementById('player-name').value.trim();
  const org    = document.getElementById('player-org').value.trim();
  const btn    = document.getElementById('login-btn');
  const err    = document.getElementById('login-error');

  if (!nombre) { showError(err, 'Introduce tu nombre'); return; }

  btn.disabled = true;
  btn.textContent = 'CONECTANDO...';
  err.classList.add('hidden');

  try {
    const res = await apiLogin(nombre, org);
    if (!res.success) throw new Error(res.error || 'Error del servidor');
    playerId   = res.id;
    playerName = nombre;
    localStorage.setItem('millon_player_id',   playerId);
    localStorage.setItem('millon_player_name', playerName);
    btn.textContent = '¡CONECTADO!';
    setTimeout(function() {
      showScreen('game-screen');
      startPolling(onStateUpdate);
    }, 700);
  } catch(e) {
    showError(err, 'Error: ' + (e.message || 'Sin conexión'));
    btn.disabled = false;
    btn.textContent = 'ENTRAR AL JUEGO';
  }
}

function logout() {
  stopPolling();
  localStorage.removeItem('millon_player_id');
  localStorage.removeItem('millon_player_name');
  playerId = null; playerName = null;
  hasAnswered = false; selectedLetter = null;
  showScreen('login-screen');
}

// ── Actualización de UI ───────────────────────────────────────────────────────
function onStateUpdate(data) {
  if (!data || !data.success) return;
  const prev   = gameState;
  const config = data.config;
  const q      = data.question;
  const estado = config.estado_juego;

  // Detectar cambio de pregunta → reset
  if (prev && prev.config.pregunta_actual !== config.pregunta_actual) {
    resetAnswerState();
  }

  gameState = data;

  // Puntuación del jugador
  const me = (data.ranking || []).find(function(p){ return p.nombre === playerName; });
  if (me) document.getElementById('player-score').textContent = me.score + ' PTS';

  // Estado principal
  const statusEl = document.getElementById('game-status');

  if (estado === 'ESPERA') {
    statusEl.textContent = 'ESPERANDO INICIO...';
    hideOptions();
    hideJokers();

  } else if (estado === 'PREGUNTA') {
    statusEl.textContent = 'PREPÁRATE...';
    renderQuestion(q, config);
    hideJokers();
    stopTimer();

  } else if (estado === 'ACTIVA') {
    statusEl.textContent = '';
    renderQuestion(q, config);
    renderJokers(config);

    // Arrancar timer solo si acabamos de cambiar a ACTIVA
    const wasActive = prev && prev.config.estado_juego === 'ACTIVA';
    if (!wasActive && !hasAnswered) {
      const serverStart = config.timestamp_inicio || Date.now();
      const elapsed = (Date.now() - serverStart) / 1000;
      const limit   = (config.tiempo_limite || 10000) / 1000;
      startTimestamp = serverStart;
      startTimer(Math.max(0, limit - elapsed));
    }
    if (!hasAnswered && timerRemaining > 0) enableOptions(true);

    // Sonido
    if (!wasActive && audioEnabled && q && q.sonido_inicio) {
      playAudio(fixDriveUrl(q.sonido_inicio));
    }

  } else if (estado === 'CERRADA') {
    statusEl.textContent = 'TIEMPO AGOTADO';
    stopTimer();
    enableOptions(false);

  } else if (estado === 'REVELAR') {
    statusEl.textContent = '';
    renderQuestion(q, config);
    stopTimer();
    enableOptions(false);
    if (q) highlightAnswer(q.correcta);
    if (audioEnabled && q && q.sonido_final && (!prev || prev.config.estado_juego !== 'REVELAR')) {
      playAudio(fixDriveUrl(q.sonido_final));
    }

  } else if (estado === 'RANKING') {
    statusEl.textContent = '¡VER RANKING EN PANTALLA!';
    hideOptions();
    hideJokers();
    stopTimer();
  }

  // Comodín público
  const pollData = config.comodin_publico_data;
  const pollOn   = (config.comodin_publico === true || config.comodin_publico === 'true');
  const pollEl   = document.getElementById('poll-container');
  if (pollOn && pollData && pollData !== '{}') {
    pollEl.classList.remove('hidden');
    renderPoll(pollData);
  } else {
    pollEl.classList.add('hidden');
  }
}

function renderQuestion(q, config) {
  if (!q) return;
  document.getElementById('question-text').textContent = q.pregunta;
  const is50 = config.comodin_50 === true || config.comodin_50 === 'true';
  const wrong = ['A','B','C','D'].filter(function(o){ return o !== q.correcta; });

  document.getElementById('options-container').classList.remove('hidden');
  ['A','B','C','D'].forEach(function(o) {
    const btn = document.getElementById('btn-' + o);
    if (!btn) return;
    btn.querySelector('.label').textContent = q[o] || '---';

    // 50% elimina las 2 primeras opciones incorrectas
    if (is50 && (o === wrong[0] || o === wrong[1])) {
      btn.classList.add('eliminated');
    } else {
      btn.classList.remove('eliminated');
    }
    // Restaurar selección visual
    if (selectedLetter === o) btn.classList.add('selected');
    else btn.classList.remove('selected');
  });
}

function renderJokers(config) {
  var jokersEl = document.getElementById('jokers-row');
  jokersEl.innerHTML = '';

  var types = [
    { key: 'comodin_50',      label: '50%',     icon: '✂️' },
    { key: 'comodin_publico', label: 'Público',  icon: '👥' },
    { key: 'comodin_llamada', label: 'Llamada',  icon: '📞' }
  ];
  types.forEach(function(t) {
    var active = config[t.key] === true || config[t.key] === 'true';
    if (!active) return;
    var badge = document.createElement('span');
    badge.className = 'joker-badge anim-zoom';
    badge.textContent = t.icon + ' ' + t.label;
    jokersEl.appendChild(badge);
  });
}

function hideJokers() {
  document.getElementById('jokers-row').innerHTML = '';
}

function hideOptions() {
  document.getElementById('options-container').classList.add('hidden');
}

function enableOptions(on) {
  ['A','B','C','D'].forEach(function(o) {
    var btn = document.getElementById('btn-' + o);
    if (btn) btn.disabled = !on || hasAnswered || btn.classList.contains('eliminated');
  });
}

// ── Selección y envío ─────────────────────────────────────────────────────────
function selectOption(letter) {
  if (hasAnswered || !gameState || gameState.config.estado_juego !== 'ACTIVA' || timerRemaining <= 0) return;
  selectedLetter = letter;
  ['A','B','C','D'].forEach(function(o) {
    var btn = document.getElementById('btn-' + o);
    if (!btn) return;
    if (o === letter) btn.classList.add('selected');
    else btn.classList.remove('selected');
  });
  document.getElementById('submit-row').classList.remove('hidden');
}

async function confirmAnswer() {
  if (hasAnswered || !selectedLetter || timerRemaining <= 0) return;
  hasAnswered = true;
  stopTimer();
  enableOptions(false);
  document.getElementById('submit-row').classList.add('hidden');

  var timeTaken = Date.now() - startTimestamp;
  var feedback  = document.getElementById('feedback-msg');
  feedback.className = 'feedback-sent';
  feedback.textContent = '✅ RESPUESTA ENVIADA — ESPERANDO RESULTADOS...';
  feedback.classList.remove('hidden');

  await apiAnswer(playerId, gameState.config.pregunta_actual, selectedLetter, timeTaken);
}

function highlightAnswer(correctLetter) {
  ['A','B','C','D'].forEach(function(o) {
    var btn = document.getElementById('btn-' + o);
    if (!btn) return;
    if (o === correctLetter) {
      btn.classList.add('correct');
    } else if (o === selectedLetter) {
      btn.classList.add('incorrect');
    }
  });
  var feedback = document.getElementById('feedback-msg');
  if (feedback.classList.contains('hidden') && hasAnswered) {
    var correct = selectedLetter === correctLetter;
    feedback.className = correct ? 'feedback-sent' : 'feedback-timeout';
    feedback.textContent = correct ? '🎉 ¡CORRECTO!' : '❌ Incorrecto';
    feedback.classList.remove('hidden');
  }
}

function resetAnswerState() {
  hasAnswered = false; selectedLetter = null; timerRemaining = 0;
  stopTimer();
  ['A','B','C','D'].forEach(function(o) {
    var btn = document.getElementById('btn-' + o);
    if (btn) btn.classList.remove('selected','correct','incorrect','eliminated');
  });
  var feedback = document.getElementById('feedback-msg');
  if (feedback) feedback.classList.add('hidden');
  var submitRow = document.getElementById('submit-row');
  if (submitRow) submitRow.classList.add('hidden');
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function startTimer(seconds) {
  stopTimer();
  var text     = document.getElementById('timer-text');
  var progress = document.getElementById('timer-progress');
  var total    = seconds;
  var dash     = 282; // 2π × 45

  timerRemaining = seconds;
  timerInterval = setInterval(function() {
    timerRemaining -= 0.1;
    if (timerRemaining <= 0) {
      timerRemaining = 0;
      stopTimer();
      if (!hasAnswered) {
        enableOptions(false);
        document.getElementById('submit-row').classList.add('hidden');
        var feedback = document.getElementById('feedback-msg');
        feedback.className = 'feedback-timeout';
        feedback.textContent = '⏰ TIEMPO AGOTADO';
        feedback.classList.remove('hidden');
      }
    }
    if (text)     text.textContent = Math.ceil(timerRemaining);
    if (progress) progress.style.strokeDashoffset = dash - (timerRemaining / total) * dash;
  }, 100);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// ── Poll ──────────────────────────────────────────────────────────────────────
function renderPoll(pollData) {
  try {
    var results = typeof pollData === 'string' ? JSON.parse(pollData) : pollData;
    ['A','B','C','D'].forEach(function(o) {
      var val  = results[o] || 0;
      var fill = document.getElementById('poll-fill-' + o);
      var lbl  = document.getElementById('poll-lbl-' + o);
      if (fill) fill.style.height = val + '%';
      if (lbl)  lbl.textContent   = val + '%';
    });
  } catch(e) { console.error('Poll parse error', e); }
}

// ── Audio ─────────────────────────────────────────────────────────────────────
function playAudio(url) {
  if (!url || !audioEnabled) return;
  audioEl.pause();
  audioEl.src = url;
  audioEl.play().catch(function(){});
}

function toggleMute() {
  audioEnabled = !audioEnabled;
  localStorage.setItem('millon_audio', audioEnabled);
  if (!audioEnabled) { audioEl.pause(); audioEl.src = ''; }
  updateMuteBtn();
}

function updateMuteBtn() {
  var btn = document.getElementById('mute-btn');
  if (btn) btn.textContent = audioEnabled ? '🔊' : '🔇';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showScreen(id) {
  ['login-screen','game-screen'].forEach(function(s) {
    var el = document.getElementById(s);
    if (el) el.classList.toggle('hidden', s !== id);
  });
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

// Enter en login
document.addEventListener('DOMContentLoaded', function() {
  var nameInput = document.getElementById('player-name');
  if (nameInput) nameInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') login();
  });
});
