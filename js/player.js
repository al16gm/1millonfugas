/**
 * player.js — Lógica de la pantalla del jugador (móvil)
 * Versión: 2.0 — Con nuevo sistema de puntuación diferido
 */

// ── Estado local ──────────────────────────────────────────────────────────────
var playerId        = sessionStorage.getItem('millon_player_id');
var playerName      = sessionStorage.getItem('millon_player_name');
var gameState       = null;
var hasAnswered     = false;
var selectedLetter  = null;
var timerInterval   = null;
var timerRemaining  = 0;
var startTimestamp  = 0;
var timerGraceInterval = null;
var timerGraceTimeout  = null;
var lastAudioTrigger   = 0;
var isFirstPoll        = true;
var serverOffset       = 0;
var audioEnabled       = localStorage.getItem('millon_audio') !== 'false';
var isChangingSource   = false;

var audioEl   = document.getElementById('audio-player');
var bgAudioEl = document.getElementById('bg-audio');

// ── Arranque ──────────────────────────────────────────────────────────────────
(function init() {
  // Limpiar localStorage antiguo
  if (localStorage.getItem('millon_player_id')) {
    localStorage.removeItem('millon_player_id');
    localStorage.removeItem('millon_player_name');
  }
  updateMuteBtn();
  if (playerId && playerName) {
    showScreen('game-screen');
    startPolling(onStateUpdate, 800);
  } else {
    showScreen('login-screen');
  }
})();

// ── Eventos Audio ─────────────────────────────────────────────────────────────
if (audioEl) {
  audioEl.addEventListener('play', function() {
    if (bgAudioEl && !bgAudioEl.paused) bgAudioEl.pause();
  });
  audioEl.addEventListener('ended', function() {
    setTimeout(resumeBackgroundMusic, 100);
  });
  audioEl.addEventListener('pause', function() {
    if (isChangingSource) return;
    if (!audioEl.ended) setTimeout(resumeBackgroundMusic, 100);
  });
}

function resumeBackgroundMusic() { updateBackgroundMusicState(); }

function updateBackgroundMusicState() {
  if (!bgAudioEl || !gameState || !gameState.config) return;
  var config    = gameState.config;
  var musicOn   = config.musica_fondo_activa === true || config.musica_fondo_activa === 'true';
  var estado    = config.estado_juego;
  var targetSrc = (estado === 'ESPERA') ? 'sounds/Intro.mp3' : 'sounds/Fondo.mp3';

  if (bgAudioEl.getAttribute('src') !== targetSrc) {
    bgAudioEl.pause();
    bgAudioEl.src  = targetSrc;
    bgAudioEl.loop = true;
    bgAudioEl.load();
  }
  bgAudioEl.volume = (estado === 'ESPERA') ? 0.5 : 0.25;

  if (audioEnabled && musicOn) {
    var effectPlaying = !audioEl.paused && !audioEl.ended && audioEl.currentTime > 0.1;
    if (!effectPlaying && bgAudioEl.paused) bgAudioEl.play().catch(function(){});
    else if (effectPlaying && !bgAudioEl.paused) bgAudioEl.pause();
  } else {
    if (!bgAudioEl.paused) bgAudioEl.pause();
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function login() {
  var nombre = document.getElementById('player-name').value.trim();
  var org    = document.getElementById('player-org').value.trim();
  var btn    = document.getElementById('login-btn');
  var err    = document.getElementById('login-error');

  if (!nombre) { showError(err, 'Introduce tu nombre'); return; }
  btn.disabled    = true;
  btn.textContent = 'CONECTANDO...';
  err.classList.add('hidden');

  try {
    var res = await apiLogin(nombre, org);
    if (!res.success) throw new Error(res.error || 'Error del servidor');
    playerId   = res.id;
    playerName = nombre;
    sessionStorage.setItem('millon_player_id',   playerId);
    sessionStorage.setItem('millon_player_name', playerName);
    btn.textContent = '¡CONECTADO!';
    setTimeout(function() {
      showScreen('game-screen');
      startPolling(onStateUpdate, 800);
    }, 700);
  } catch(e) {
    showError(err, 'Error: ' + (e.message || 'Sin conexión'));
    btn.disabled    = false;
    btn.textContent = 'ENTRAR AL JUEGO';
  }
}

function logout() {
  sessionStorage.removeItem('millon_player_id');
  sessionStorage.removeItem('millon_player_name');
  location.reload();
}

// ── Actualización de UI ───────────────────────────────────────────────────────
function onStateUpdate(data) {
  if (!data || !data.success) return;

  if (data.serverTime) serverOffset = data.serverTime - Date.now();

  var prev   = gameState;
  var config = data.config;
  var q      = data.question;
  var estado = config.estado_juego;

  var questionChanged = prev && prev.config.pregunta_actual !== config.pregunta_actual;
  var stateReversed   = prev && prev.config.estado_juego === 'ACTIVA' && estado === 'PREGUNTA';
  if (questionChanged || stateReversed) resetAnswerState();

  gameState = data;
  processAudio(data, prev);

  // Puntuación
  var me = (data.ranking || []).find(function(p){ return p.nombre === playerName; });
  if (me) {
    var scoreEl = document.getElementById('player-score');
    if (scoreEl) scoreEl.textContent = me.score + ' PTS';
  }

  var statusEl = document.getElementById('game-status');
  var cardEl   = document.querySelector('#game-screen .glass-card');
  if (cardEl) cardEl.classList.toggle('active-q', estado === 'ACTIVA');

  if (estado === 'ESPERA') {
    if (statusEl) statusEl.textContent = 'ESPERANDO INICIO...';
    hideOptions(); hideJokers();

  } else if (estado === 'PREGUNTA') {
    if (statusEl) { statusEl.textContent = 'PREPÁRATE...'; statusEl.style.color = 'var(--cyan)'; }
    renderQuestion(q, config); hideJokers(); stopTimer();

  } else if (estado === 'OPCIONES') {
    if (statusEl) { statusEl.textContent = '¡OBSERVA LAS OPCIONES!'; statusEl.style.color = 'var(--cyan)'; }
    renderQuestion(q, config); hideJokers(); stopTimer(); enableOptions(false);

  } else if (estado === 'ACTIVA') {
    if (statusEl) { statusEl.textContent = '¡SELECCIONA TU RESPUESTA!'; statusEl.style.color = 'var(--gold)'; }
    renderQuestion(q, config); renderJokers(config);

    var wasActive = prev && prev.config.estado_juego === 'ACTIVA';
    if (!wasActive && !hasAnswered) {
      var serverNow   = data.serverTime || Date.now();
      var offset      = serverNow - Date.now();
      var serverStart = config.timestamp_inicio || serverNow;
      var elapsed     = (Date.now() + offset - serverStart) / 1000;
      var limit       = (config.tiempo_limite || 10000) / 1000;
      if (elapsed > 3) elapsed = 0;

      if (timerGraceTimeout)  clearTimeout(timerGraceTimeout);
      if (timerGraceInterval) clearInterval(timerGraceInterval);

      if (elapsed < 0) {
        if (statusEl) { statusEl.textContent = 'PREPARANDO... ' + Math.ceil(Math.abs(elapsed)) + 's'; statusEl.style.color = 'var(--cyan)'; }
        timerRemaining = limit;
        updateTimerDisplay(limit, limit);
        timerGraceInterval = setInterval(function() {
          var ne = (Date.now() + offset - serverStart) / 1000;
          if (ne >= 0) {
            clearInterval(timerGraceInterval); timerGraceInterval = null;
            if (statusEl) { statusEl.textContent = '¡SELECCIONA TU RESPUESTA!'; statusEl.style.color = 'var(--gold)'; }
          } else {
            if (statusEl) statusEl.textContent = 'PREPARANDO... ' + Math.ceil(Math.abs(ne)) + 's';
          }
        }, 500);
        timerGraceTimeout = setTimeout(function() { startTimer(limit); }, Math.abs(elapsed) * 1000);
      } else {
        startTimestamp = Date.now() - (elapsed * 1000);
        startTimer(Math.max(0, limit - elapsed));
      }
    }
    if (!hasAnswered && timerRemaining > 0) enableOptions(true);

  } else if (estado === 'CERRADA') {
    if (statusEl) statusEl.textContent = 'TIEMPO AGOTADO';
    stopTimer(); enableOptions(false);

  } else if (estado === 'REVELAR') {
    var wasReveal = prev && prev.config.estado_juego === 'REVELAR';
    if (!wasReveal && q) {
      var isCorrect = (selectedLetter === q.correcta);
      playAudio(isCorrect ? 'sounds/acierto.mp3' : 'sounds/fallo.mp3', true);
    }
    if (statusEl) statusEl.textContent = '';
    renderQuestion(q, config); stopTimer(); enableOptions(false);
    if (q) highlightAnswer(q.correcta);

  } else if (estado === 'RANKING') {
    if (statusEl) statusEl.textContent = '🏆 ¡VER RANKING EN PANTALLA!';
    hideOptions(); hideJokers(); stopTimer();
  }

  // Poll público
  var pollData = config.comodin_publico_data;
  var pollOn   = (config.comodin_publico === true || config.comodin_publico === 'true');
  var pollEl   = document.getElementById('poll-container');
  if (pollEl) {
    if (pollOn && pollData && pollData !== '{}') {
      pollEl.classList.remove('hidden'); renderPoll(pollData);
    } else {
      pollEl.classList.add('hidden');
    }
  }
}

function processAudio(data, prev) {
  var config = data.config;
  if (!config) return;

  if (isFirstPoll) {
    lastAudioTrigger = config.timestamp_audio || 0;
    isFirstPoll = false;
    updateBackgroundMusicState();
    return;
  }

  var currentTrigger = Number(config.timestamp_audio) || 0;
  if (audioEnabled && currentTrigger && currentTrigger > lastAudioTrigger) {
    lastAudioTrigger = currentTrigger;
    var q = data.question;

    if (config.sonido_actual === 'inicio') {
      var urlToPlay = q ? q.sonido_inicio : '';
      if (!urlToPlay && q) {
        var qId = parseInt(q.id) || 1;
        if (qId >= 1 && qId <= 8) urlToPlay = 'sounds/S' + qId + '.mp3';
      }
      if (urlToPlay) playAudio(encodeURI(fixDriveUrl(urlToPlay)));

    } else if (config.sonido_actual === 'final' || config.sonido_actual === 'stop') {
      audioEl.pause(); audioEl.currentTime = 0;
      resumeBackgroundMusic();

    } else if (config.sonido_actual && config.sonido_actual.startsWith('manual_')) {
      var num = config.sonido_actual.split('_')[1];
      var url = encodeURI('sounds/S' + num + '.mp3');
      if (audioEl.dataset.currentUrl === url && !audioEl.paused) {
        audioEl.pause(); resumeBackgroundMusic();
      } else {
        audioEl.dataset.currentUrl = url;
        playAudio(url);
      }
    }
  }
  updateBackgroundMusicState();
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderQuestion(q, config) {
  if (!q) return;
  var qtEl = document.getElementById('question-text');
  if (qtEl) qtEl.textContent = q.pregunta;

  var is50  = config.comodin_50 === true || config.comodin_50 === 'true';
  var wrong = ['A','B','C','D'].filter(function(o){ return o !== q.correcta; });
  var optCont = document.getElementById('options-container');

  if (optCont) {
    if (config.estado_juego === 'PREGUNTA') {
      optCont.classList.add('hidden');
    } else {
      optCont.classList.remove('hidden');
      if (config.estado_juego === 'OPCIONES') {
        optCont.classList.add('reveal-staggered');
        var nowP     = Date.now() + (serverOffset || 0);
        var startOpP = config.timestamp_opciones || nowP;
        var elOpP    = (nowP - startOpP) / 1000;
        ['A','B','C','D'].forEach(function(o, i) {
          var btn = document.getElementById('btn-' + o);
          if (btn) btn.style.animationDelay = Math.max(0, i * 0.5 - elOpP) + 's';
        });
      } else {
        optCont.classList.remove('reveal-staggered');
        ['A','B','C','D'].forEach(function(o) {
          var btn = document.getElementById('btn-' + o);
          if (btn) btn.style.animationDelay = '';
        });
      }
    }
  }

  ['A','B','C','D'].forEach(function(o) {
    var btn = document.getElementById('btn-' + o);
    if (!btn) return;
    var lbl = btn.querySelector('.label');
    if (lbl) lbl.textContent = q[o] || '---';
    if (is50 && (o === wrong[0] || o === wrong[1])) btn.classList.add('eliminated');
    else btn.classList.remove('eliminated');
    if (selectedLetter === o) btn.classList.add('selected');
    else btn.classList.remove('selected');
  });
}

function renderJokers(config) {
  var el = document.getElementById('jokers-row');
  if (!el) return;
  el.innerHTML = '';
  [
    { key: 'comodin_50',      label: '50%',    icon: '✂️' },
    { key: 'comodin_publico', label: 'Público', icon: '👥' },
    { key: 'comodin_llamada', label: 'Llamada', icon: '📞' }
  ].forEach(function(t) {
    if (!(config[t.key] === true || config[t.key] === 'true')) return;
    var badge = document.createElement('span');
    badge.className   = 'joker-badge anim-zoom';
    badge.textContent = t.icon + ' ' + t.label;
    el.appendChild(badge);
  });
}

function hideJokers() {
  var el = document.getElementById('jokers-row');
  if (el) el.innerHTML = '';
}

function hideOptions() {
  var el = document.getElementById('options-container');
  if (el) el.classList.add('hidden');
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
    if (btn) btn.classList.toggle('selected', o === letter);
  });
  var submitRow = document.getElementById('submit-row');
  if (submitRow) submitRow.classList.remove('hidden');
}

async function confirmAnswer() {
  if (hasAnswered || !selectedLetter || timerRemaining <= 0) return;
  hasAnswered = true;
  stopTimer();
  enableOptions(false);
  var submitRow = document.getElementById('submit-row');
  if (submitRow) submitRow.classList.add('hidden');

  var timeTaken = Date.now() - startTimestamp;
  var feedback  = document.getElementById('feedback-msg');
  if (feedback) {
    feedback.className   = 'feedback-sent';
    feedback.textContent = '✅ RESPUESTA ENVIADA — ESPERANDO RESULTADOS...';
    feedback.classList.remove('hidden');
  }
  await apiAnswer(playerId, gameState.config.pregunta_actual, selectedLetter, timeTaken);
}

function highlightAnswer(correctLetter) {
  ['A','B','C','D'].forEach(function(o) {
    var btn = document.getElementById('btn-' + o);
    if (!btn) return;
    if (o === correctLetter)      btn.classList.add('correct');
    else if (o === selectedLetter) btn.classList.add('incorrect');
  });
  var feedback = document.getElementById('feedback-msg');
  if (feedback && feedback.classList.contains('hidden') && hasAnswered) {
    var correct = selectedLetter === correctLetter;
    feedback.className   = correct ? 'feedback-sent' : 'feedback-timeout';
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
  var feedback  = document.getElementById('feedback-msg');
  var submitRow = document.getElementById('submit-row');
  if (feedback)  feedback.classList.add('hidden');
  if (submitRow) submitRow.classList.add('hidden');
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function updateTimerDisplay(rem, total) {
  var text     = document.getElementById('timer-text');
  var progress = document.getElementById('timer-progress');
  var dash     = 282;
  if (text)     text.textContent = Math.ceil(rem);
  if (progress) progress.style.strokeDashoffset = dash - (rem / total) * dash;
}

function startTimer(seconds) {
  stopTimer();
  if (!startTimestamp) startTimestamp = Date.now();
  var total = seconds;
  var dash  = 282;
  var text     = document.getElementById('timer-text');
  var progress = document.getElementById('timer-progress');
  timerRemaining = seconds;

  timerInterval = setInterval(function() {
    timerRemaining -= 0.1;
    var ring = document.querySelector('.timer-ring');
    if (ring) ring.classList.toggle('low-time', timerRemaining > 0 && timerRemaining <= 3);

    if (timerRemaining <= 0) {
      timerRemaining = 0;
      stopTimer();
      if (!hasAnswered) {
        enableOptions(false);
        var submitRow = document.getElementById('submit-row');
        if (submitRow) submitRow.classList.add('hidden');
        var feedback = document.getElementById('feedback-msg');
        if (feedback) {
          feedback.className   = 'feedback-timeout';
          feedback.textContent = '⏰ TIEMPO AGOTADO';
          feedback.classList.remove('hidden');
        }
      }
    }
    if (text)     text.textContent = Math.ceil(timerRemaining);
    if (progress) progress.style.strokeDashoffset = dash - (timerRemaining / total) * dash;
  }, 100);
}

function stopTimer() {
  if (timerInterval)     { clearInterval(timerInterval);     timerInterval     = null; }
  if (timerGraceTimeout) { clearTimeout(timerGraceTimeout);  timerGraceTimeout = null; }
  if (timerGraceInterval){ clearInterval(timerGraceInterval);timerGraceInterval= null; }
  timerRemaining = 0;
  var text = document.getElementById('timer-text');
  var prog = document.getElementById('timer-progress');
  if (text) text.textContent = '';
  if (prog) prog.style.strokeDashoffset = 0;
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
function playAudio(url, keepBackgroundMusic) {
  if (!url || !audioEnabled) return;
  if (!keepBackgroundMusic && bgAudioEl && !bgAudioEl.paused) bgAudioEl.pause();
  isChangingSource = true;
  audioEl.pause();
  audioEl.volume = 1.0;
  audioEl.src    = url;
  audioEl.load();
  isChangingSource = false;
  audioEl.play().catch(function(e){
    console.warn('Player audio error:', e);
    if (!keepBackgroundMusic) updateBackgroundMusicState();
  });
}

function toggleMute() {
  audioEnabled = !audioEnabled;
  localStorage.setItem('millon_audio', audioEnabled);
  updateMuteBtn();
  if (audioEnabled) {
    // Desbloquear AudioContext con silencio
    audioEl.src = 'data:audio/wav;base64,UklGRigAAABXQVZFRm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    audioEl.play().catch(function(){});
    setTimeout(function() { audioEl.pause(); }, 100);
    updateBackgroundMusicState();
  } else {
    audioEl.pause();
    if (bgAudioEl) bgAudioEl.pause();
  }
}

function updateMuteBtn() {
  var btn = document.getElementById('mute-btn');
  if (btn) {
    btn.textContent  = audioEnabled ? '🔊' : '🔇';
    btn.style.opacity = audioEnabled ? '1' : '0.5';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showScreen(id) {
  ['login-screen','game-screen'].forEach(function(s) {
    var el = document.getElementById(s);
    if (el) el.classList.toggle('hidden', s !== id);
  });
}

function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', function() {
  var nameInput = document.getElementById('player-name');
  if (nameInput) nameInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') login();
  });
});
