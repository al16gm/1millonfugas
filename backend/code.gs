/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Quién quiere detectar UN MILLÓN de fugas - Backend
 * Google Apps Script para gestionar el juego
 */

const SPREADSHEET_ID = '1SfgkzuKd5vEg4epgvtgnscpzpoXTS4QD-ZeF3ubW5y0';

function doGet(e) {
  const action = e.parameter.action;
  const force = e.parameter.force === 'true';
  
  try {
    if (force) invalidateCache();
    
    if (action === 'game_state') {
      return jsonResponse(getGameState());
    }
    
    if (action === 'login') {
      return jsonResponse(loginPlayer(e.parameter.nombre, e.parameter.org));
    }

    if (action === 'admin_action') {
      const data = JSON.parse(e.parameter.data);
      return jsonResponse(handleAdminAction(data));
    }

    if (action === 'answer') {
      const data = JSON.parse(e.parameter.data);
      return jsonResponse(submitAnswer(data));
    }

    return HtmlService.createHtmlOutput("Servicio Activo. Usa ?action=game_state");
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function doPost(e) {
  try {
    const action = e.parameter.action;
    const data = JSON.parse(e.postData.contents);

    if (action === 'answer') {
      return jsonResponse(submitAnswer(data));
    }
    
    if (action === 'admin_action') {
      return jsonResponse(handleAdminAction(data));
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- DATABASE HELPERS ---

let ss_cache = null;
function getSs() {
  if (!ss_cache) {
    try {
      ss_cache = SpreadsheetApp.openById(SPREADSHEET_ID);
    } catch (e) {
      throw new Error("No se pudo abrir la hoja de cálculo. Verifica el ID y los permisos. Error: " + e.toString());
    }
  }
  return ss_cache;
}

function getSheet(name) {
  const ss = getSs();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function getGameState() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("game_state");
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  const state = fetchFreshGameState();
  if (state.success) {
    cache.put("game_state", JSON.stringify(state), 30);
  }
  return state;
}

function invalidateCache() {
  CacheService.getScriptCache().remove("game_state");
}

function fetchFreshGameState() {
  try {
    const configSheet = getSheet('CONFIG');
    let configData = configSheet.getDataRange().getValues();
    
    const expectedHeaders = [
      'estado_juego', 'pregunta_actual', 'tiempo_limite', 'sonido_actual', 
      'musica_fondo_activa', 'comodin_50', 'comodin_publico', 'comodin_llamada', 
      'session_id', 'respuesta_revelar', 'timestamp_inicio', 'timestamp_llamada', 
      'comodin_publico_data', 'timestamp_audio', 'scoring_done_for_q', 'timestamp_opciones'
    ];

    // Inicialización de CONFIG
    if (configData.length < 2) {
      configSheet.clear();
      configSheet.appendRow(expectedHeaders);
      configSheet.appendRow(['ESPERA', 1, 10000, '', true, false, false, false, 1, '', 0, 0, '', 0, false, 0]);
      configData = configSheet.getDataRange().getValues();
    } else {
      let headers = configData[0].map(h => String(h).trim());
      let modified = false;
      
      expectedHeaders.forEach((h) => {
        if (headers.indexOf(h) === -1) {
          const newCol = headers.length + 1;
          configSheet.getRange(1, newCol).setValue(h);
          let defaultVal = (h.startsWith('timestamp_') || h === 'session_id' || h === 'tiempo_limite') ? 0 : '';
          if (h === 'musica_fondo_activa') defaultVal = true;
          if (h === 'pregunta_actual') defaultVal = 1;
          if (h === 'scoring_done_for_q') defaultVal = false;
          
          configSheet.getRange(2, newCol).setValue(defaultVal);
          headers.push(h);
          modified = true;
        }
      });

      if (modified) {
        configData = configSheet.getDataRange().getValues();
      }
    }

    const headers = configData[0].map(h => String(h).trim());
    const config = {};
    
    expectedHeaders.forEach(h => {
      config[h] = (h.startsWith('timestamp_') || h === 'session_id' || h === 'tiempo_limite' || h === 'pregunta_actual') ? 0 : '';
      if (h === 'musica_fondo_activa') config[h] = true;
      if (h === 'scoring_done_for_q') config[h] = false;
    });

    headers.forEach((header, i) => {
      if (expectedHeaders.indexOf(header) === -1) return;
      let val = configData[1][i];
      
      if (val === 'true' || val === true) val = true;
      else if (val === 'false' || val === false) val = false;
      
      if (header.startsWith('timestamp_') || header === 'pregunta_actual' || header === 'tiempo_limite' || header === 'session_id') {
        val = Number(val || 0);
      }
      
      config[header] = val;
    });

    Logger.log("Millon Server: Config final: " + JSON.stringify(config));

    // Carga de Preguntas
    const questionsSheet = getSs().getSheetByName('PREGUNTAS');
    if (!questionsSheet) throw new Error("No se encuentra la pestaña 'PREGUNTAS'");
    
    const questionsData = questionsSheet.getDataRange().getValues();
    const qHeaders = questionsData[0].map(h => String(h).toLowerCase().trim());
    
    const getCol = (name) => qHeaders.indexOf(name.toLowerCase());
    
    const currentQuestionId = String(config.pregunta_actual || "1").trim();
    let questionData = null;
    const allQuestions = [];

    const colId = getCol('id');
    const colPreg = getCol('pregunta');
    const colA = getCol('A');
    const colB = getCol('B');
    const colC = getCol('C');
    const colD = getCol('D');
    const colCorr = getCol('correcta');

    for (let i = 1; i < questionsData.length; i++) {
      const row = questionsData[i];
      if (colId === -1 || !row[colId]) continue;
      
      const qId = String(row[colId]).trim();
      const q = {
        id: qId,
        pregunta: colPreg > -1 ? row[colPreg] : "Pregunta sin texto",
        A: colA > -1 ? row[colA] : "-",
        B: colB > -1 ? row[colB] : "-",
        C: colC > -1 ? row[colC] : "-",
        D: colD > -1 ? row[colD] : "-",
        correcta: colCorr > -1 ? String(row[colCorr]).toUpperCase().trim() : "A",
        nivel: getCol('nivel') > -1 ? row[getCol('nivel')] : 1,
        sonido_inicio: ''
      };

      if (!q.sonido_inicio) {
        const idNum = parseInt(qId);
        if (idNum >= 1 && idNum <= 8) {
          q.sonido_inicio = 'sounds/S' + idNum + '.mp3';
        }
      }

      allQuestions.push(q);
      if (qId == currentQuestionId) questionData = q;
    }

    if (!questionData && allQuestions.length > 0) questionData = allQuestions[0];

    const ranking = getRanking(config.session_id);
    const answersCount = countAnswers(currentQuestionId, config.session_id);

    return {
      success: true,
      config: config,
      question: questionData,
      allQuestions: allQuestions,
      ranking: ranking,
      answersCount: answersCount,
      serverTime: Date.now()
    };
  } catch (err) {
    return { success: false, error: "Error Crítico: " + err.toString() };
  }
}

function fixDriveUrl(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.includes('drive.google.com')) {
    const match = url.match(/\/d\/(.+?)\//) || url.match(/id=(.+?)(&|$)/);
    if (match && match[1]) {
      return 'https://drive.google.com/uc?export=download&id=' + match[1];
    }
  }
  return url;
}

function loginPlayer(nombre, org) {
  try {
    const sheet = getSheet('JUGADORES');
    const state = getGameState();
    const sessionId = state.config ? state.config.session_id : 1;
    
    let headers = [];
    if (sheet.getLastRow() > 0) {
      headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(h => String(h).toLowerCase().trim());
    }
    
    const required = ['id', 'nombre', 'org', 'puntos', 'fecha', 'session_id'];
    if (headers.indexOf('id') === -1) {
      sheet.clear();
      sheet.appendRow(required);
      headers = required;
    } else if (headers.indexOf('session_id') === -1) {
      sheet.getRange(1, headers.length + 1).setValue('session_id');
      headers.push('session_id');
    }
    
    const id = 'P' + Math.floor(Math.random() * 1000000);
    const rowData = new Array(headers.length).fill('');
    rowData[headers.indexOf('id')] = id;
    rowData[headers.indexOf('nombre')] = nombre;
    rowData[headers.indexOf('org')] = org || '';
    rowData[headers.indexOf('puntos')] = 0;
    rowData[headers.indexOf('fecha')] = new Date();
    rowData[headers.indexOf('session_id')] = sessionId;
    
    sheet.appendRow(rowData);
    invalidateCache();
    return { success: true, id: id };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function submitAnswer(data) {
  const { participante_id, pregunta_id, respuesta, tiempo_ms } = data;
  const state = getGameState();
  const config = state.config;
  
  if (config.estado_juego !== 'ACTIVA') return { success: false, message: 'Pregunta no activa' };

  const correctLetter = state.question.correcta;
  const isCorrect = respuesta === correctLetter;
  const sessionId = config.session_id || 1;
  
  const answersSheet = getSheet('RESPUESTAS');
  if (answersSheet.getLastRow() === 0) {
    answersSheet.appendRow(['pregunta_id', 'participante_id', 'respuesta', 'tiempo_ms', 'es_correcta', 'puntos', 'session_id']);
  }
  
  const answersData = answersSheet.getDataRange().getValues();
  const hA = answersData[0].map(h => String(h).toLowerCase().trim());
  const cP = hA.indexOf('pregunta_id');
  const cPart = hA.indexOf('participante_id');
  const cS = hA.indexOf('session_id');
  
  for (let i = 1; i < answersData.length; i++) {
    if (String(answersData[i][cP]) == String(pregunta_id) && 
        String(answersData[i][cPart]) == String(participante_id) && 
        String(answersData[i][cS]) == String(sessionId)) {
      return { success: false, message: 'Ya has respondido a esta pregunta' };
    }
  }

  answersSheet.appendRow([pregunta_id, participante_id, respuesta, tiempo_ms, isCorrect, 0, sessionId]);

  invalidateCache();
  return { success: true, correct: isCorrect, puntos: 0 };
}

function calculateAndApplyScores() {
  const state = getGameState();
  const config = state.config;
  const currentQuestionId = String(config.pregunta_actual || 1);
  const sessionId = config.session_id || 1;
  const correctLetter = state.question.correcta;

  const configSheet = getSheet('CONFIG');
  const configHeaders = configSheet.getDataRange().getValues()[0].map(h => String(h).trim());
  const configRow = configSheet.getDataRange().getValues()[1];
  const scoringDoneCol = configHeaders.indexOf('scoring_done_for_q');

  if (scoringDoneCol > -1 && (configRow[scoringDoneCol] === true || configRow[scoringDoneCol] === 'TRUE')) {
    Logger.log("Millon Server: Scoring already done for question " + currentQuestionId);
    return { success: false, message: 'Scoring already done for this question' };
  }

  const answersSheet = getSheet('RESPUESTAS');
  const answersData = answersSheet.getDataRange().getValues();
  const answersHeaders = answersData[0].map(h => String(h).toLowerCase().trim());

  const colPregId = answersHeaders.indexOf('pregunta_id');
  const colPartId = answersHeaders.indexOf('participante_id');
  const colRespuesta = answersHeaders.indexOf('respuesta');
  const colTiempoMs = answersHeaders.indexOf('tiempo_ms');
  const colEsCorrecta = answersHeaders.indexOf('es_correcta');
  const colPuntos = answersHeaders.indexOf('puntos');
  const colSessionId = answersHeaders.indexOf('session_id');

  const currentQuestionAnswers = [];
  for (let i = 1; i < answersData.length; i++) {
    const row = answersData[i];
    if (String(row[colPregId]) === currentQuestionId && String(row[colSessionId]) === String(sessionId)) {
      currentQuestionAnswers.push({
        rowIdx: i + 1,
        participanteId: row[colPartId],
        respuesta: row[colRespuesta],
        tiempoMs: Number(row[colTiempoMs]),
        esCorrecta: (row[colEsCorrecta] === true || row[colEsCorrecta] === 'TRUE'),
        currentPuntos: Number(row[colPuntos]) || 0
      });
    }
  }

  const correctAnswers = currentQuestionAnswers.filter(a => a.esCorrecta);

  if (correctAnswers.length === 0) {
    Logger.log("Millon Server: No correct answers for question " + currentQuestionId + ". No points awarded.");
    if (scoringDoneCol > -1) configSheet.getRange(2, scoringDoneCol + 1).setValue(true);
    invalidateCache();
    return { success: true, message: 'No correct answers, no points awarded.' };
  }

  correctAnswers.sort((a, b) => a.tiempoMs - b.tiempoMs);
  const fastestCorrectTime = correctAnswers[0].tiempoMs;

  const participantsSheet = getSheet('JUGADORES');
  const participantsData = participantsSheet.getDataRange().getValues();
  const participantsHeaders = participantsData[0].map(h => String(h).toLowerCase().trim());
  const pColId = participantsHeaders.indexOf('id');
  const pColPuntos = participantsHeaders.indexOf('puntos');
  const pColSessionId = participantsHeaders.indexOf('session_id');

  for (const answer of currentQuestionAnswers) {
    let awardedPoints = 0;
    if (answer.esCorrecta) {
      const delaySeconds = (answer.tiempoMs - fastestCorrectTime) / 1000;
      awardedPoints = Math.max(0, 5 - (delaySeconds * 0.2));
      awardedPoints = Math.round(awardedPoints * 10) / 10;
    }

    answersSheet.getRange(answer.rowIdx, colPuntos + 1).setValue(awardedPoints);

    for (let i = 1; i < participantsData.length; i++) {
      const participantRow = participantsData[i];
      if (String(participantRow[pColId]) === answer.participanteId && String(participantRow[pColSessionId]) === String(sessionId)) {
        const currentTotalScore = Number(participantRow[pColPuntos]) || 0;
        participantsSheet.getRange(i + 1, pColPuntos + 1).setValue(currentTotalScore + awardedPoints);
        break;
      }
    }
  }

  if (scoringDoneCol > -1) configSheet.getRange(2, scoringDoneCol + 1).setValue(true);

  invalidateCache();
  return { success: true, message: 'Scores calculated and applied for question ' + currentQuestionId };
}

function handleAdminAction(data) {
  Logger.log("Admin Action Received: " + JSON.stringify(data));
  try {
    const configSheet = getSheet('CONFIG');
    const configValues = configSheet.getRange(1, 1, 2, 30).getValues();
    const headers = configValues[0].map(h => String(h).trim()).filter(h => h !== "");
    Logger.log("Millon Admin: Headers encontrados: " + JSON.stringify(headers));
    const rowValues = configValues[1].slice(0, headers.length);
    const lastCol = headers.length;
    let questionChanged = false;
    let needsPoll = false;
    
    if (data.type === 'start_call_timer') {
      const colIndex = headers.indexOf('timestamp_llamada');
      const activeIndex = headers.indexOf('comodin_llamada');
      if (colIndex > -1) configSheet.getRange(2, colIndex + 1).setValue(Date.now());
      if (activeIndex > -1) configSheet.getRange(2, activeIndex + 1).setValue(true);
      invalidateCache();
      return { success: true };
    }

    if (data.type === 'update_config') {
      for (let key in data.updates) {
        const colIndex = headers.indexOf(key);
        if (colIndex > -1) {
          let val = data.updates[key];
          if (key.startsWith('timestamp_')) val = Number(val) || 0;
          rowValues[colIndex] = val;
          if (key === 'pregunta_actual') questionChanged = true;
          if (key === 'comodin_llamada' && (data.updates[key] === true || data.updates[key] === 'true')) {
            const callTsIndex = headers.indexOf('timestamp_llamada');
            if (callTsIndex > -1) rowValues[callTsIndex] = Date.now();
          }
          if (key === 'comodin_publico' && (data.updates[key] === true || data.updates[key] === 'true')) {
            needsPoll = true;
          }
        }
      }

      if (data.updates.estado_juego === 'ACTIVA') {
        const tsIndex = headers.indexOf('timestamp_inicio');
        if (tsIndex > -1) rowValues[tsIndex] = Date.now() + 3000;
      }

      if (questionChanged) {
        const pollDataIndex = headers.indexOf('comodin_publico_data');
        if (pollDataIndex > -1) rowValues[pollDataIndex] = '';
        const revealIndex = headers.indexOf('respuesta_revelar');
        if (revealIndex > -1) rowValues[revealIndex] = '';
        const scoringDoneCol = headers.indexOf('scoring_done_for_q');
        if (scoringDoneCol > -1) rowValues[scoringDoneCol] = false;
      }

      if (needsPoll) {
        const pollDataIndex = headers.indexOf('comodin_publico_data');
        if (pollDataIndex > -1 && (!rowValues[pollDataIndex] || rowValues[pollDataIndex] === '')) {
          const state = fetchFreshGameState();
          if (state.question) {
            let correct = String(state.question.correcta || 'A').toUpperCase().trim();
            const options = ['A', 'B', 'C', 'D'];
            let activeOptions = options;
            const is50Active = rowValues[headers.indexOf('comodin_50')] === true || rowValues[headers.indexOf('comodin_50')] === 'true';
            
            if (is50Active) {
              const wrongOptions = options.filter(o => o !== correct);
              activeOptions = [correct, wrongOptions[2]];
            }

            let results = { 'A': 0, 'B': 0, 'C': 0, 'D': 0 };
            let remainingTotal = 100;
            const isCorrectMajority = Math.random() < 0.8;
            
            if (isCorrectMajority) {
              const majorityVal = Math.floor(Math.random() * 21) + 55;
              results[correct] = majorityVal;
              remainingTotal -= majorityVal;
            } else {
              const wrongActive = activeOptions.filter(o => o !== correct);
              if (wrongActive.length > 0) {
                const randomWrong = wrongActive[Math.floor(Math.random() * wrongActive.length)];
                const majorityVal = Math.floor(Math.random() * 21) + 55;
                results[randomWrong] = majorityVal;
                remainingTotal -= majorityVal;
              } else {
                results[correct] = 100;
                remainingTotal = 0;
              }
            }
            
            const otherActive = activeOptions.filter(o => results[o] === 0);
            if (otherActive.length > 0) {
              otherActive.forEach((o, i) => {
                if (i === otherActive.length - 1) {
                  results[o] = remainingTotal;
                } else {
                  const val = Math.floor(Math.random() * (remainingTotal / 2)) + 5;
                  results[o] = Math.min(val, remainingTotal);
                  remainingTotal -= results[o];
                }
              });
            } else {
              const alreadyAssigned = activeOptions.filter(o => results[o] > 0);
              if (alreadyAssigned.length > 0) results[alreadyAssigned[0]] += remainingTotal;
            }
            
            let finalSum = results.A + results.B + results.C + results.D;
            if (finalSum !== 100) results[correct] += (100 - finalSum);
            
            rowValues[pollDataIndex] = JSON.stringify(results);
          }
        }
      }

      configSheet.getRange(2, 1, 1, lastCol).setValues([rowValues]);
      Logger.log("Millon: Escribiendo en CONFIG: " + JSON.stringify(rowValues));
      invalidateCache();
      return { success: true };
    }
    
    if (data.type === 'calculate_scores') {
      Logger.log("Millon Admin: Calculating and applying scores...");
      return calculateAndApplyScores();
    }

    if (data.type === 'reset_game') {
      const state = getGameState();
      const currentSession = state.config ? state.config.session_id : 1;
      const nextSession = Number(currentSession) + 1;
      
      const updates = {
        estado_juego: 'ESPERA',
        pregunta_actual: 1,
        session_id: nextSession,
        comodin_50: false,
        comodin_publico: false,
        comodin_llamada: false,
        respuesta_revelar: '',
        scoring_done_for_q: false
      };

      for (let key in updates) {
        const colIndex = headers.indexOf(key);
        if (colIndex > -1) configSheet.getRange(2, colIndex + 1).setValue(updates[key]);
      }
      invalidateCache();
    }

    if (data.type === 'delete_player') {
      const partSheet = getSheet('JUGADORES');
      const partData = partSheet.getDataRange().getValues();
      for (let i = 1; i < partData.length; i++) {
        if (partData[i][0] == data.playerId) {
          partSheet.deleteRow(i + 1);
          invalidateCache();
          break;
        }
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function getRanking(currentSessionId) {
  const cacheKey = "ranking_" + currentSessionId;
  const cached = CacheService.getScriptCache().get(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const sheet = getSs().getSheetByName('JUGADORES');
    if (!sheet || sheet.getLastRow() < 2) return [];
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).toLowerCase().trim());
    const colSession = headers.indexOf('session_id');
    const colId = headers.indexOf('id');
    const colNombre = headers.indexOf('nombre');
    const colOrg = headers.indexOf('org');
    const colPuntos = headers.indexOf('puntos');
    
    const players = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      let playerSession = colSession > -1 ? row[colSession] : 1;
      if (playerSession === "" || playerSession === null) playerSession = 1;
      
      if (String(playerSession) == String(currentSessionId)) {
        players.push({ 
          id: colId > -1 ? row[colId] : '',
          nombre: colNombre > -1 ? row[colNombre] : 'Anónimo', 
          org: colOrg > -1 ? row[colOrg] : '', 
          score: colPuntos > -1 ? (Number(row[colPuntos]) || 0) : 0 
        });
      }
    }
    const sorted = players.sort((a, b) => b.score - a.score);
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(sorted), 3);
    return sorted;
  } catch (e) {
    return [];
  }
}

function countAnswers(preguntaId, sessionId) {
  const cacheKey = "count_" + preguntaId + "_" + sessionId;
  const cached = CacheService.getScriptCache().get(cacheKey);
  if (cached) return Number(cached);

  try {
    const sheet = getSs().getSheetByName('RESPUESTAS');
    if (!sheet || sheet.getLastRow() < 2) return 0;
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).toLowerCase().trim());
    const colPreg = headers.indexOf('pregunta_id');
    const colSess = headers.indexOf('session_id');
    
    let count = 0;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const pId = colPreg > -1 ? String(row[colPreg]) : '';
      const sId = colSess > -1 ? String(row[colSess]) : '1';
      if (pId == String(preguntaId) && sId == String(sessionId)) {
        count++;
      }
    }
    CacheService.getScriptCache().put(cacheKey, String(count), 3);
    return count;
  } catch (e) {
    return 0;
  }
}
