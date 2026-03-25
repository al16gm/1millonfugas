/**
 * screen.js — Pantalla grande (TV / proyector)
 */

var gameState      = null;
var audioEnabled   = false;
var callInterval   = null;
var lastCallTs     = 0;
var mainTimerInterval = null;

var audioEl   = document.getElementById('audio-player');
var bgAudioEl = document.getElementById('bg-audio');
var BG_MUSIC  = 'sounds/bg_music.mp3'; // reemplaza con tu archivo o URL Drive

// ── Arranque ──────────────────────────────────────────────────────────────────
startPolling(onStateUpdate, 1200);

function enableAudio() {
  audioEnabled = true;
  document.getElementById('audio-gate').classList.add('hidden');
  // Unblock AudioContext con un silent play
  audioEl.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  audioEl.play().catch(function(){});
}

// ── Callback polling ──────────────────────────────────────────────────────────
function onStateUpdate(data) {
  if (!data || !data.success) return;

  var prev   = gameState;
  var config = data.config;
  var estado = config.estado_juego;

  // Contador de jugadores (siempre)
  var cnt = document.getElementById('player-count');
  if (cnt) cnt.textContent = (data.ranking || []).length;
  renderWaitingPlayers(data.ranking || []);

  // Música de fondo
  if (audioEnabled) {
    var musicOn = config.musica_fondo_activa === true || config.musica_fondo_activa === 'true';
    if (musicOn && bgAudioEl.paused) bgAudioEl.play().catch(function(){});
    if (!musicOn && !bgAudioEl.paused) bgAudioEl.pause();
  }

  // Solo actualizar UI completa si el estado o datos cambiaron
  if (JSON.stringify(data.config) === JSON.stringify((gameState || {}).config) &&
      JSON.stringify(data.question) === JSON.stringify((gameState || {}).question)) {
    gameState = data;
    return;
  }

  gameState = data;

  // ── Pantallas ─────────────────────────────────────────────────────────────
  showScreen(
    estado === 'ESPERA'   ? 'waiting-screen' :
    estado === 'RANKING'  ? 'ranking-screen' :
    'question-screen'
  );

  if (estado === 'RANKING') {
    renderRanking(data.ranking || []);
    stopMainTimer();
    return;
  }

  if (['PREGUNTA','ACTIVA','CERRADA','REVELAR'].includes(estado)) {
    renderQuestionScreen(data, prev ? prev.config.estado_juego : null);
  }
}

// ── Pantalla pregunta ─────────────────────────────────────────────────────────
function renderQuestionScreen(data, prevState) {
  var config = data.config;
  var q      = data.question;
  var estado = config.estado_juego;

  document.getElementById('q-label').textContent = 'PREGUNTA ' + (q ? q.id : '--');

  if (q) {
    document.getElementById('main-question').textContent = q.pregunta;
    var is50   = config.comodin_50 === true || config.comodin_50 === 'true';
    var wrong  = ['A','B','C','D'].filter(function(o){ return o !== q.correcta; });
    var reveal = config.respuesta_revelar || '';
    var isReveal = estado === 'REVELAR';

    ['A','B','C','D'].forEach(function(o) {
      var btn = document.getElementById('opt-' + o);
      if (!btn) return;
      btn.querySelector('.label').textContent = q[o] || '---';
      btn.className = 'option-btn big';

      // 50%
      if (is50 && (o === wrong[0] || o === wrong[1])) {
        btn.classList.add('eliminated');
        return;
      }

      // Revelar
      if (isReveal) {
        if (o === q.correcta)  btn.classList.add('correct');
        else if (o === reveal) btn.classList.add('incorrect');
      } else if (o === reveal) {
        btn.classList.add('selected');
      }
    });

    // Sound wave indicator
    var waveEl = document.getElementById('sound-wave');
    if (waveEl) {
      if (estado === 'ACTIVA') waveEl.classList.remove('hidden');
      else waveEl.classList.add('hidden');
    }

    // Sonidos
    if (audioEnabled) {
      if (estado === 'ACTIVA' && prevState !== 'ACTIVA') playAudio(fixDriveUrl(q.sonido_inicio));
      if (estado === 'REVELAR' && prevState !== 'REVELAR') playAudio(fixDriveUrl(q.sonido_final));
    }
  }

  // Timer
  if (estado === 'ACTIVA' && prevState !== 'ACTIVA') {
    var serverStart = config.timestamp_inicio || Date.now();
    var elapsed     = (Date.now() - serverStart) / 1000;
    var limit       = (config.tiempo_limite || 10000) / 1000;
    startMainTimer(Math.max(0, limit - elapsed));
  }
  if (estado !== 'ACTIVA') stopMainTimer();

  // Comodines visibles
  ['50','publico','llamada'].forEach(function(t) {
    var active = config['comodin_' + t] === true || config['comodin_' + t] === 'true';
    var el = document.getElementById('joker-badge-' + t);
    if (el) el.classList.toggle('hidden', !active);
  });

  // Poll
  var pollOn   = config.comodin_publico === true || config.comodin_publico === 'true';
  var pollData = config.comodin_publico_data;
  var pollEl   = document.getElementById('poll-box');
  if (pollOn && pollData && pollData !== '{}') {
    pollEl.classList.remove('hidden');
    renderPoll(pollData);
  } else {
    pollEl.classList.add('hidden');
  }

  // Call timer
  var callOn = config.comodin_llamada === true || config.comodin_llamada === 'true';
  var callTs = Number(config.timestamp_llamada) || 0;
  var callEl = document.getElementById('call-box');
  if (callOn) {
    callEl.classList.remove('hidden');
    if (callTs !== lastCallTs) {
      lastCallTs = callTs;
      startCallTimer(callTs, data.serverTime || Date.now());
    }
  } else {
    callEl.classList.add('hidden');
    stopCallTimer();
    lastCallTs = 0;
  }
}

// ── Timers ────────────────────────────────────────────────────────────────────
function startMainTimer(seconds) {
  stopMainTimer();
  var text  = document.getElementById('main-timer-text');
  var prog  = document.getElementById('main-timer-progress');
  var dash  = 339.29;
  var total = seconds;
  var rem   = seconds;

  mainTimerInterval = setInterval(function() {
    rem -= 0.1;
    if (rem <= 0) { rem = 0; stopMainTimer(); }
    if (text) text.textContent = Math.ceil(rem);
    if (prog) prog.style.strokeDashoffset = dash - (rem / total) * dash;
  }, 100);
}

function stopMainTimer() {
  if (mainTimerInterval) { clearInterval(mainTimerInterval); mainTimerInterval = null; }
  var text = document.getElementById('main-timer-text');
  var prog = document.getElementById('main-timer-progress');
  if (text) text.textContent = '';
  if (prog) prog.style.strokeDashoffset = 0;
}

function startCallTimer(startTs, serverNow) {
  stopCallTimer();
  var text     = document.getElementById('call-timer-text');
  var fill     = document.getElementById('call-timer-fill');
  var offset   = serverNow - Date.now();
  var duration = 30000;

  callInterval = setInterval(function() {
    var elapsed   = (Date.now() + offset) - startTs;
    var remaining = Math.max(0, (duration - elapsed) / 1000);
    if (text) text.textContent = Math.ceil(remaining);
    if (fill) fill.style.width = (remaining / 30 * 100) + '%';
    if (remaining <= 0) stopCallTimer();
  }, 100);
}

function stopCallTimer() {
  if (callInterval) { clearInterval(callInterval); callInterval = null; }
}

// ── Poll ──────────────────────────────────────────────────────────────────────
function renderPoll(pollData) {
  try {
    var results = typeof pollData === 'string' ? JSON.parse(pollData) : pollData;
    ['A','B','C','D'].forEach(function(o) {
      var val  = results[o] || 0;
      var fill = document.getElementById('screen-poll-fill-' + o);
      var lbl  = document.getElementById('screen-poll-lbl-' + o);
      if (fill) fill.style.height = val + '%';
      if (lbl)  lbl.textContent   = val + '%';
    });
  } catch(e) {}
}

// ── Ranking ───────────────────────────────────────────────────────────────────
function renderRanking(ranking) {
  var container = document.getElementById('ranking-list');
  container.innerHTML = ranking.slice(0,10).map(function(p, i) {
    return '<div class="ranking-row anim-fade ' + (i===0?'top-1':'') + '" style="animation-delay:' + (i*0.08) + 's">' +
      '<span style="font-size:1.4rem;font-weight:900;opacity:0.35">#' + (i+1) + '</span>' +
      '<div style="display:flex;flex-direction:column"><span style="font-size:1.1rem;font-weight:700">' + p.nombre + '</span>' +
      '<span style="font-size:0.7rem;opacity:0.45;text-transform:uppercase">' + (p.org || '') + '</span></div>' +
      '<span style="font-size:1.3rem;font-weight:900;color:var(--cyan)">' + p.score + '<small style="font-size:0.6rem;opacity:0.5"> PTS</small></span>' +
      '</div>';
  }).join('');
}

function renderWaitingPlayers(ranking) {
  var el = document.getElementById('waiting-players');
  if (!el) return;
  el.innerHTML = ranking.map(function(p) {
    return '<span style="padding:4px 12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:100px;font-size:11px;font-weight:700;color:var(--gold)">' + p.nombre + '</span>';
  }).join('');
}

// ── Audio ─────────────────────────────────────────────────────────────────────
function playAudio(url) {
  if (!url || !audioEnabled) return;
  audioEl.pause();
  audioEl.src = url;
  audioEl.play().catch(function(){});
}

// ── Screens ───────────────────────────────────────────────────────────────────
function showScreen(id) {
  ['waiting-screen','question-screen','ranking-screen'].forEach(function(s) {
    var el = document.getElementById(s);
    if (el) {
      el.style.display = s === id ? 'flex' : 'none';
    }
  });
}
