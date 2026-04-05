/**
 * screen.js — Pantalla grande (TV / proyector)
 * Versión: 2.0
 */

var gameState           = null;
var audioEnabled        = localStorage.getItem('millon_screen_audio') !== 'false';
var callInterval        = null;
var lastCallTs          = 0;
var lastAudioTrigger    = 0;
var isFirstPoll         = true;
var mainTimerInterval   = null;
var serverOffset        = 0;
var mainTimerGraceTimeout  = null;
var mainTimerGraceInterval = null;
var isChangingSource    = false;

var audioEl   = document.getElementById('audio-player');
var bgAudioEl = document.getElementById('bg-audio');

// ── Eventos Audio ─────────────────────────────────────────────────────────────
if (audioEl) {
  audioEl.addEventListener('play',  function() { if (bgAudioEl && !bgAudioEl.paused) bgAudioEl.pause(); });
  audioEl.addEventListener('ended', function() { setTimeout(resumeBackgroundMusic, 100); });
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
    if (!effectPlaying) {
      if (bgAudioEl.paused) bgAudioEl.play().then(updateMuteButton).catch(function(){ updateMuteButton(); });
    } else {
      if (!bgAudioEl.paused) bgAudioEl.pause();
    }
  } else {
    if (!bgAudioEl.paused) bgAudioEl.pause();
  }
}

// ── Arranque ──────────────────────────────────────────────────────────────────
startPolling(onStateUpdate, 800);

document.addEventListener('DOMContentLoaded', updateMuteButton);

function toggleMute() {
  audioEnabled = !audioEnabled;
  localStorage.setItem('millon_screen_audio', audioEnabled);
  updateMuteButton();
  if (audioEnabled) {
    audioEl.src = 'data:audio/wav;base64,UklGRigAAABXQVZFRm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    audioEl.play().catch(function(){});
    setTimeout(function() { audioEl.pause(); }, 100);
    updateBackgroundMusicState();
  } else {
    if (audioEl)   audioEl.pause();
    if (bgAudioEl) bgAudioEl.pause();
  }
}

function updateMuteButton() {
  var btn  = document.getElementById('mute-btn');
  var hint = document.getElementById('audio-hint');
  if (!btn) return;
  if (audioEnabled) {
    btn.innerHTML        = '🔊';
    btn.style.opacity    = '1';
    btn.style.borderColor = 'var(--gold)';
    if (hint) hint.style.display = bgAudioEl && bgAudioEl.paused ? 'block' : 'none';
  } else {
    btn.innerHTML        = '🔇';
    btn.style.opacity    = '0.6';
    btn.style.borderColor = 'rgba(255,255,255,0.2)';
    if (hint) { hint.style.display = 'block'; hint.textContent = 'Sonido desactivado'; }
  }
}

// ── Callback polling ──────────────────────────────────────────────────────────
function onStateUpdate(data) {
  if (!data || !data.success) return;
  if (data.serverTime) serverOffset = data.serverTime - Date.now();

  var prev   = gameState;
  var config = data.config;
  var estado = config.estado_juego;

  var cnt = document.getElementById('player-count');
  if (cnt) cnt.textContent = (data.ranking || []).length;
  renderWaitingPlayers(data.ranking || []);

  var configChanged   = !prev || JSON.stringify(data.config)   !== JSON.stringify(prev.config);
  var questionChanged = !prev || JSON.stringify(data.question) !== JSON.stringify(prev.question);

  if (!configChanged && !questionChanged) {
    gameState = data;
    processAudio(data, prev);
    return;
  }

  gameState = data;

  showScreen(
    estado === 'ESPERA'  ? 'waiting-screen'  :
    estado === 'RANKING' ? 'ranking-screen'  :
    'question-screen'
  );

  if (estado === 'RANKING') {
    renderRanking(data.ranking || []);
    stopMainTimer();
    processAudio(data, prev);
    return;
  }

  if (['PREGUNTA','OPCIONES','ACTIVA','CERRADA','REVELAR'].indexOf(estado) > -1) {
    renderQuestionScreen(data, prev ? prev.config.estado_juego : null);
  }

  processAudio(data, prev);
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

// ── Pantalla pregunta ─────────────────────────────────────────────────────────
function renderQuestionScreen(data, prevState) {
  var config   = data.config;
  var q        = data.question;
  var estado   = config.estado_juego;

  var qBox = document.querySelector('.q-box');
  if (qBox) qBox.classList.toggle('active-q', estado === 'ACTIVA');

  var optionsGrid = document.querySelector('.options-grid');
  if (optionsGrid) optionsGrid.style.display = (estado === 'PREGUNTA') ? 'none' : 'grid';

  var qLabel = document.getElementById('q-label');
  if (qLabel) qLabel.textContent = 'PREGUNTA ' + (q ? q.id : '--');

  if (q) {
    var mqEl = document.getElementById('main-question');
    if (mqEl) mqEl.textContent = q.pregunta;

    var is50   = config.comodin_50 === true || config.comodin_50 === 'true';
    var wrong  = ['A','B','C','D'].filter(function(o){ return o !== q.correcta; });
    var reveal = config.respuesta_revelar || '';
    var isReveal = estado === 'REVELAR';

    var grid = document.querySelector('.options-grid');
    if (grid) {
      if (estado === 'OPCIONES') {
        grid.classList.add('reveal-staggered');
        var nowS    = Date.now() + (serverOffset || 0);
        var startOp = config.timestamp_opciones || nowS;
        var elOp    = (nowS - startOp) / 1000;
        ['A','B','C','D'].forEach(function(o, i) {
          var btn = document.getElementById('opt-' + o);
          if (btn) btn.style.animationDelay = Math.max(0, i * 0.5 - elOp) + 's';
        });
      } else {
        grid.classList.remove('reveal-staggered');
        ['A','B','C','D'].forEach(function(o) {
          var btn = document.getElementById('opt-' + o);
          if (btn) btn.style.animationDelay = '';
        });
      }
    }

    ['A','B','C','D'].forEach(function(o) {
      var btn = document.getElementById('opt-' + o);
      if (!btn) return;
      var lbl = btn.querySelector('.label');
      if (lbl) lbl.textContent = q[o] || '---';
      btn.className = 'option-btn big';
      if (is50 && (o === wrong[0] || o === wrong[1])) { btn.classList.add('eliminated'); return; }
      if (isReveal) {
        if (o === q.correcta)  btn.classList.add('correct');
        else if (o === reveal) btn.classList.add('incorrect');
      } else if (o === reveal) {
        btn.classList.add('selected');
      }
    });

    var waveEl = document.getElementById('sound-wave');
    if (waveEl) waveEl.classList.toggle('hidden', estado !== 'ACTIVA');

    if (estado === 'REVELAR' && prevState !== 'REVELAR') {
      var isCorrect = (config.respuesta_revelar === q.correcta);
      playAudio(isCorrect ? 'sounds/acierto.mp3' : 'sounds/fallo.mp3', true);
    }
  }

  // Timer
  if (estado === 'ACTIVA' && prevState !== 'ACTIVA') {
    var serverStart = config.timestamp_inicio || (Date.now() + serverOffset);
    var nowSrv      = Date.now() + serverOffset;
    var elapsed     = (nowSrv - serverStart) / 1000;
    var limit       = (config.tiempo_limite || 10000) / 1000;
    if (elapsed > 3) elapsed = 0;

    if (mainTimerGraceTimeout)  clearTimeout(mainTimerGraceTimeout);
    if (mainTimerGraceInterval) clearInterval(mainTimerGraceInterval);

    if (elapsed < 0) {
      var tText = document.getElementById('main-timer-text');
      var tProg = document.getElementById('main-timer-progress');
      if (tText) tText.innerText = 'PREP';
      if (tProg) tProg.style.strokeDashoffset = 339.29;

      mainTimerGraceInterval = setInterval(function() {
        var ne = (Date.now() + serverOffset - serverStart) / 1000;
        if (ne >= 0) {
          clearInterval(mainTimerGraceInterval); mainTimerGraceInterval = null;
          if (tText) tText.innerText = Math.ceil(limit);
        } else {
          if (tText) tText.innerText = 'P' + Math.ceil(Math.abs(ne));
        }
      }, 500);
      mainTimerGraceTimeout = setTimeout(function() { startMainTimer(limit); }, Math.abs(elapsed) * 1000);
    } else {
      startMainTimer(Math.max(0, limit - elapsed));
    }
  }

  if (estado !== 'ACTIVA') {
    stopMainTimer();
    if (mainTimerGraceTimeout)  { clearTimeout(mainTimerGraceTimeout);  mainTimerGraceTimeout  = null; }
    if (mainTimerGraceInterval) { clearInterval(mainTimerGraceInterval); mainTimerGraceInterval = null; }
  }

  // Comodines
  ['50','publico','llamada'].forEach(function(t) {
    var active = config['comodin_' + t] === true || config['comodin_' + t] === 'true';
    var el = document.getElementById('joker-badge-' + t);
    if (el) el.classList.toggle('hidden', !active);
  });

  // Poll
  var pollOn   = config.comodin_publico === true || config.comodin_publico === 'true';
  var pollData = config.comodin_publico_data;
  var pollEl   = document.getElementById('poll-box');
  if (pollEl) {
    if (pollOn && pollData && pollData !== '{}') { pollEl.classList.remove('hidden'); renderPoll(pollData); }
    else pollEl.classList.add('hidden');
  }

  // Call timer
  var callOn = config.comodin_llamada === true || config.comodin_llamada === 'true';
  var callTs = Number(config.timestamp_llamada) || 0;
  var callEl = document.getElementById('call-box');
  if (callEl) {
    if (callOn) {
      callEl.classList.remove('hidden');
      if (callTs !== lastCallTs) { lastCallTs = callTs; startCallTimer(callTs, data.serverTime || Date.now()); }
    } else {
      callEl.classList.add('hidden'); stopCallTimer(); lastCallTs = 0;
    }
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
    var ring = document.querySelector('.timer-ring.big');
    if (ring) ring.classList.toggle('low-time', rem > 0 && rem <= 3);
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
  if (!container) return;
  container.innerHTML = ranking.slice(0, 10).map(function(p, i) {
    var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i+1);
    return '<div class="ranking-row anim-fade ' + (i===0?'top-1':'') + '" style="animation-delay:' + (i*0.08) + 's">' +
      '<span style="font-size:1.4rem;font-weight:900;opacity:0.35">' + medal + '</span>' +
      '<div style="display:flex;flex-direction:column">' +
        '<span style="font-size:1.1rem;font-weight:700">' + p.nombre + '</span>' +
        '<span style="font-size:0.7rem;opacity:0.45;text-transform:uppercase">' + (p.org||'') + '</span>' +
      '</div>' +
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
    console.warn('Screen audio error:', e);
    if (!keepBackgroundMusic) updateBackgroundMusicState();
  });
}

// ── Screens ───────────────────────────────────────────────────────────────────
function showScreen(id) {
  ['waiting-screen','question-screen','ranking-screen'].forEach(function(s) {
    var el = document.getElementById(s);
    if (el) el.style.display = (s === id) ? 'flex' : 'none';
  });
}
