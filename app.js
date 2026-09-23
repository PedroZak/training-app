'use strict';

let state; // atalho para Store.data
const WEEKDAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const WEEKDAY_SHORT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const WORKOUT_IDS = ['A', 'B', 'C', 'D'];

let editorWorkoutId = null; // qual treino está aberto no editor (Treinos tab)
let calCursor = new Date(); // mês visível no calendário
let calSelectedDate = null;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function boot() {
  Store.load();
  state = Store.data;

  // vira o dia: se a data salva em "today" é de ontem, reseta o checklist
  if (state.today.date !== todayISO()) {
    const sched = todaySchedule();
    state.today = {
      date: todayISO(),
      workoutId: sched.type === 'workout' ? sched.id : state.today.workoutId,
      checked: [],
    };
    Store.save();
  }

  wireNav();
  wireSettingsView();
  wireExportView();
  renderAll();
  setInterval(tickTimerDisplay, 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function renderAll() {
  renderHome();
  renderWorkoutsTab();
  renderCalendar();
  renderSettings();
}

// ---------------------------------------------------------------------------
// Navegação (bottom nav + views)
// ---------------------------------------------------------------------------
function wireNav() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

function switchView(name) {
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.dataset.view !== name));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDatePt(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function daysAgoLabel(iso) {
  if (!iso) return 'nunca feito';
  const diff = Math.round((new Date(todayISO() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'ontem';
  if (diff > 1) return `há ${diff} dias`;
  return formatDatePt(iso);
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------------------------------------------------------------------------
// HOME ("Hoje")
// ---------------------------------------------------------------------------
function renderHome() {
  const wrap = document.getElementById('home-view');
  const info = currentWeekInfo(state.settings);
  const sched = todaySchedule();
  const dow = new Date().getDay();

  const wkButtons = WORKOUT_IDS.map((id) => {
    const w = state.workouts[id];
    const active = state.today.workoutId === id;
    return `<button class="wk-btn ${active ? 'active' : ''}" data-pick="${id}">
      ${id}<span class="wk-last">${daysAgoLabel(w.lastPerformedAt)}</span>
    </button>`;
  }).join('');

  let cardioNote = '';
  if (sched.type === 'cardio') {
    const done = isCardioDoneToday();
    cardioNote = `
      <div class="card">
        <b>🏃 Dia de cardio</b>
        <div class="ex-meta" style="margin-top:4px">${escapeHtml(CARDIO_INFO[info.mesoKey])}</div>
        <button class="btn-primary" id="cardio-toggle-btn" style="margin-top:10px;${done ? 'opacity:0.6' : ''}">
          ${done ? '✓ Cardio feito hoje' : 'Marcar cardio como feito'}
        </button>
      </div>`;
  }

  const header = `
    <div class="card meso-banner">
      <div>
        <div class="meso-title">${escapeHtml(info.meso.label)}</div>
        <div class="meso-detail">Semana ${info.weekNum}/12 · ${info.meso.series} · ${info.meso.pct}</div>
      </div>
      ${info.isDeload ? '<span class="pill deload">Deload · -40% volume</span>' : `<span class="pill">${info.mesoKey}</span>`}
    </div>
    <div class="card">
      <div class="ex-meta">${WEEKDAY_NAMES[dow]} · agenda: ${sched.type === 'workout' ? 'Treino ' + sched.id : sched.label}</div>
      <div class="today-pick">${wkButtons}</div>
    </div>
    ${cardioNote}
  `;

  const wid = state.today.workoutId;
  let body = '';
  if (wid && state.workouts[wid]) {
    body = renderWorkoutCard(state.workouts[wid], info.mesoKey, true);
  } else {
    body = '<div class="card empty-state">Escolha um treino acima para começar.</div>';
  }

  wrap.innerHTML = header + body;
  wireWorkoutCardEvents(wrap, true);

  const cardioBtn = wrap.querySelector('#cardio-toggle-btn');
  if (cardioBtn) cardioBtn.addEventListener('click', toggleCardioDone);

  wrap.querySelectorAll('[data-pick]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.pick;
      if (state.today.workoutId !== id) {
        state.today.workoutId = id;
        state.today.checked = [];
        Store.save();
      }
      renderHome();
    });
  });
}

function renderWorkoutCard(workout, mesoKey, interactive) {
  const total = workout.exercises.length;
  const doneCount = interactive ? workout.exercises.filter((e) => state.today.checked.includes(e.id)).length : 0;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  const rows = workout.exercises.map((e) => renderExerciseRow(e, mesoKey, interactive)).join('');

  const finishBtn = interactive
    ? `<div class="finish-bar"><button class="btn-primary" id="finish-btn" ${doneCount === 0 ? 'disabled' : ''}>Concluir treino (${doneCount}/${total})</button></div>`
    : '';

  return `
    <div class="card">
      <div class="workout-title-row">
        <span class="workout-dot" style="background:${workout.color}"></span>
        <div><h2>${escapeHtml(workout.name)}</h2><div class="sub">${escapeHtml(workout.subtitle)}</div></div>
      </div>
      <div class="workout-last">Último: ${daysAgoLabel(workout.lastPerformedAt)}${workout.lastPerformedAt ? ' · ' + formatDatePt(workout.lastPerformedAt) : ''}</div>
      ${interactive ? `<div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%"></div></div>` : ''}
      ${workout.warmup ? `<div class="warmup-note">Aquecimento: ${escapeHtml(workout.warmup)}</div>` : ''}
      <div class="exercise-list" data-workout="${workout.id}">${rows}</div>
    </div>
    ${finishBtn}
  `;
}

function renderExerciseRow(e, mesoKey, interactive) {
  const done = interactive && state.today.checked.includes(e.id);
  const target = e.reps[mesoKey];
  return `
    <div class="exercise-row ${done ? 'done' : ''}" data-ex="${e.id}">
      ${interactive ? `<button class="ex-check" data-check="${e.id}">${done ? '✓' : ''}</button>` : '<span style="width:28px"></span>'}
      <div class="ex-body">
        <div class="ex-name">${escapeHtml(e.name)}${e.isNew ? '<span class="ex-new-badge">NOVO</span>' : ''}</div>
        <div class="ex-meta">${escapeHtml(e.grip)} · ${e.sets}x</div>
        <div class="ex-target">${escapeHtml(target)} reps <span class="rest-tag">· descanso ${escapeHtml(e.rest)}</span></div>
        ${e.notes ? `<div class="ex-notes">${escapeHtml(e.notes)}</div>` : ''}
        ${interactive ? `
        <div class="ex-controls">
          <div class="weight-field">
            <input type="number" inputmode="decimal" step="0.5" placeholder="0" value="${e.weight || ''}" data-weight="${e.id}">
            <span>kg</span>
          </div>
          ${e.weightUpdatedAt ? `<span class="weight-updated">atualizado ${daysAgoLabel(e.weightUpdatedAt)}</span>` : ''}
          <button class="rest-btn" data-rest="${e.id}">⏱ ${e.restSec}s</button>
        </div>` : ''}
      </div>
    </div>
  `;
}

function wireWorkoutCardEvents(root, interactive) {
  if (!interactive) return;
  root.querySelectorAll('[data-check]').forEach((btn) => {
    btn.addEventListener('click', () => toggleCheck(btn.dataset.check));
  });
  root.querySelectorAll('[data-weight]').forEach((inp) => {
    inp.addEventListener('change', () => saveWeight(inp.dataset.weight, inp.value));
  });
  root.querySelectorAll('[data-rest]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const exId = btn.dataset.rest;
      const ex = findExerciseById(exId);
      startTimer(ex.restSec, ex.name);
    });
  });
  const finishBtn = root.querySelector('#finish-btn');
  if (finishBtn) finishBtn.addEventListener('click', finishWorkout);
}

function findExerciseById(exId) {
  for (const id of WORKOUT_IDS) {
    const found = state.workouts[id].exercises.find((e) => e.id === exId);
    if (found) return found;
  }
  return null;
}

function toggleCheck(exId) {
  const idx = state.today.checked.indexOf(exId);
  const willCheck = idx === -1;
  if (willCheck) state.today.checked.push(exId);
  else state.today.checked.splice(idx, 1);
  Store.save();
  renderHome();
  if (willCheck) {
    const ex = findExerciseById(exId);
    if (ex && ex.restSec) startTimer(ex.restSec, ex.name);
  }
}

function saveWeight(exId, value) {
  const ex = findExerciseById(exId);
  if (!ex) return;
  ex.weight = value;
  ex.weightUpdatedAt = todayISO();
  Store.save();
  renderHome();
}

function finishWorkout() {
  const wid = state.today.workoutId;
  if (!wid || state.today.checked.length === 0) return;
  const log = {
    id: uid('log'),
    workoutId: wid,
    dateISO: state.today.date,
    completedAt: new Date().toISOString(),
    exerciseIds: [...state.today.checked],
  };
  state.logs.push(log);
  state.workouts[wid].lastPerformedAt = state.today.date;
  state.today.checked = [];
  Store.save();
  showToast(`${state.workouts[wid].name} registrado! 💪`);
  renderAll();
}

function isCardioDoneToday() {
  return state.logs.some((l) => l.workoutId === 'CARDIO' && l.dateISO === state.today.date);
}

function toggleCardioDone() {
  const existing = state.logs.find((l) => l.workoutId === 'CARDIO' && l.dateISO === state.today.date);
  if (existing) {
    state.logs = state.logs.filter((l) => l.id !== existing.id);
    showToast('Cardio desmarcado.');
  } else {
    state.logs.push({
      id: uid('log'),
      workoutId: 'CARDIO',
      dateISO: state.today.date,
      completedAt: new Date().toISOString(),
      exerciseIds: [],
    });
    showToast('Cardio registrado! 🏃');
  }
  Store.save();
  renderAll();
}

// ---------------------------------------------------------------------------
// Cronômetro de descanso
// ---------------------------------------------------------------------------
const Timer = { remaining: 0, total: 0, label: '', running: false, tickHandle: null };

function startTimer(seconds, label) {
  Timer.remaining = seconds;
  Timer.total = seconds;
  Timer.label = label;
  Timer.running = true;
  document.getElementById('timer-overlay').hidden = false;
  renderTimer();
}

function tickTimerDisplay() {
  if (!Timer.running) return;
  Timer.remaining -= 1;
  if (Timer.remaining <= 0) {
    Timer.remaining = 0;
    Timer.running = false;
    beep();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
  renderTimer();
}

function renderTimer() {
  const overlay = document.getElementById('timer-overlay');
  if (overlay.hidden) return;
  const m = Math.floor(Timer.remaining / 60);
  const s = Timer.remaining % 60;
  overlay.querySelector('.timer-time').textContent = `${m}:${String(s).padStart(2, '0')}`;
  overlay.querySelector('.timer-label').textContent = 'Descanso · ' + Timer.label;
}

function wireTimerControls() {
  document.getElementById('timer-minus').addEventListener('click', () => { Timer.remaining = Math.max(0, Timer.remaining - 15); renderTimer(); });
  document.getElementById('timer-plus').addEventListener('click', () => { Timer.remaining += 15; renderTimer(); });
  document.getElementById('timer-pause').addEventListener('click', (e) => {
    Timer.running = !Timer.running;
    e.target.textContent = Timer.running ? 'Pausar' : 'Retomar';
  });
  document.getElementById('timer-close').addEventListener('click', () => {
    Timer.running = false;
    document.getElementById('timer-overlay').hidden = true;
  });
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.start();
    o.stop(ctx.currentTime + 0.6);
  } catch (e) { /* sem áudio disponível */ }
}

// ---------------------------------------------------------------------------
// TREINOS (visualizar/editar estrutura)
// ---------------------------------------------------------------------------
function renderWorkoutsTab() {
  const wrap = document.getElementById('workouts-view');
  const tabs = WORKOUT_IDS.map((id) => `<button class="tab-btn ${editorWorkoutId === id ? 'active' : ''}" data-tab="${id}">${id}</button>`).join('');

  if (!editorWorkoutId) editorWorkoutId = 'A';
  const w = state.workouts[editorWorkoutId];
  const info = currentWeekInfo(state.settings);

  const exCards = w.exercises.map((e, i) => renderEditorExercise(e, i, w.exercises.length)).join('');

  wrap.innerHTML = `
    <div class="tabs">${tabs}</div>
    <div class="card">
      <div class="field-row">
        <label>Nome do treino</label>
        <input type="text" id="w-name" value="${escapeHtml(w.name)}">
      </div>
      <div class="field-row">
        <label>Subtítulo (grupos musculares)</label>
        <input type="text" id="w-subtitle" value="${escapeHtml(w.subtitle)}">
      </div>
      <div class="field-row">
        <label>Aquecimento (opcional)</label>
        <input type="text" id="w-warmup" value="${escapeHtml(w.warmup || '')}">
      </div>
    </div>
    <div id="editor-exercises">${exCards}</div>
    <button class="add-ex-btn" id="add-ex-btn">+ adicionar exercício</button>
    <div style="height:16px"></div>
    <div class="ex-meta" style="text-align:center">Mesociclo atual em destaque: ${info.mesoKey}</div>
  `;

  wrap.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { editorWorkoutId = b.dataset.tab; renderWorkoutsTab(); }));

  document.getElementById('w-name').addEventListener('change', (e) => { w.name = e.target.value; Store.save(); renderAll(); });
  document.getElementById('w-subtitle').addEventListener('change', (e) => { w.subtitle = e.target.value; Store.save(); renderAll(); });
  document.getElementById('w-warmup').addEventListener('change', (e) => { w.warmup = e.target.value; Store.save(); renderAll(); });

  wireEditorEvents(w);
}

function renderEditorExercise(e, index, total) {
  return `
    <div class="editor-ex-card" data-ex-edit="${e.id}">
      <div class="editor-ex-head">
        <b>#${index + 1}</b>
        <div style="display:flex;gap:6px">
          <button class="icon-btn" data-move="up" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn" data-move="down" ${index === total - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-btn btn-danger" data-del>✕</button>
        </div>
      </div>
      <div class="field-row"><label>Nome</label><input type="text" data-f="name" value="${escapeHtml(e.name)}"></div>
      <div class="field-grid">
        <div class="field-row"><label>Pegada</label><input type="text" data-f="grip" value="${escapeHtml(e.grip)}"></div>
        <div class="field-row"><label>Séries</label><input type="number" data-f="sets" value="${e.sets}"></div>
        <div class="field-row"><label>Descanso</label><input type="text" data-f="rest" value="${escapeHtml(e.rest)}"></div>
      </div>
      <div class="field-grid">
        <div class="field-row"><label>Reps M1</label><input type="text" data-f="repsM1" value="${escapeHtml(e.reps.M1)}"></div>
        <div class="field-row"><label>Reps M2</label><input type="text" data-f="repsM2" value="${escapeHtml(e.reps.M2)}"></div>
        <div class="field-row"><label>Reps M3</label><input type="text" data-f="repsM3" value="${escapeHtml(e.reps.M3)}"></div>
      </div>
      <div class="field-row"><label>Observações</label><input type="text" data-f="notes" value="${escapeHtml(e.notes || '')}"></div>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--text-dim)">
        <input type="checkbox" data-f="isNew" ${e.isNew ? 'checked' : ''}> marcar como novo neste ciclo
      </label>
    </div>
  `;
}

function wireEditorEvents(w) {
  const wrap = document.getElementById('editor-exercises');

  wrap.querySelectorAll('.editor-ex-card').forEach((card) => {
    const exId = card.dataset.exEdit;
    const ex = w.exercises.find((x) => x.id === exId);

    card.querySelectorAll('[data-f]').forEach((input) => {
      const field = input.dataset.f;
      const evt = input.type === 'checkbox' ? 'change' : 'change';
      input.addEventListener(evt, () => {
        if (field === 'isNew') ex.isNew = input.checked;
        else if (field === 'sets') ex.sets = Number(input.value) || 1;
        else if (field === 'rest') { ex.rest = input.value; ex.restSec = parseRestSeconds(input.value); }
        else if (field.startsWith('reps')) ex.reps[field.replace('reps', '')] = input.value;
        else ex[field] = input.value;
        Store.save();
        renderAll();
      });
    });

    card.querySelector('[data-del]').addEventListener('click', () => {
      if (!confirm(`Remover "${ex.name}" do treino?`)) return;
      w.exercises = w.exercises.filter((x) => x.id !== exId);
      Store.save();
      renderWorkoutsTab();
      renderHome();
    });

    card.querySelectorAll('[data-move]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = w.exercises.findIndex((x) => x.id === exId);
        const dir = btn.dataset.move === 'up' ? -1 : 1;
        const swapIdx = idx + dir;
        if (swapIdx < 0 || swapIdx >= w.exercises.length) return;
        [w.exercises[idx], w.exercises[swapIdx]] = [w.exercises[swapIdx], w.exercises[idx]];
        Store.save();
        renderWorkoutsTab();
        renderHome();
      });
    });
  });

  document.getElementById('add-ex-btn').addEventListener('click', () => {
    w.exercises.push({
      id: uid('ex'), name: 'Novo exercício', grip: '—', sets: 3,
      reps: { M1: '10-12', M2: '10-12', M3: '8-10' }, rest: '60s', restSec: 60,
      notes: '', isNew: true, weight: '', weightUpdatedAt: null,
    });
    Store.save();
    renderWorkoutsTab();
    renderHome();
  });
}

// ---------------------------------------------------------------------------
// CALENDÁRIO
// ---------------------------------------------------------------------------
const CAL_COLORS = { A: '#3b82f6', B: '#ef4444', C: '#f97316', D: '#eab308', CARDIO: '#22c55e' };
const CAL_LABELS = { A: 'Treino A', B: 'Treino B', C: 'Treino C', D: 'Treino D', CARDIO: 'Cardio' };

function logsByDate() {
  const map = {};
  for (const log of state.logs) {
    if (!map[log.dateISO]) map[log.dateISO] = [];
    map[log.dateISO].push(log);
  }
  return map;
}

function renderCalendar() {
  const wrap = document.getElementById('calendar-view');
  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const byDate = logsByDate();
  const todayStr = todayISO();

  const monthName = calCursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  let cells = '';
  for (let i = 0; i < startDow; i++) cells += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayLogs = byDate[iso] || [];
    const dots = dayLogs.map((l) => `<span class="dot" style="background:${CAL_COLORS[l.workoutId] || '#999'}"></span>`).join('');
    cells += `<div class="cal-day ${iso === todayStr ? 'today' : ''}" data-day="${iso}">${d}<div class="dots">${dots}</div></div>`;
  }

  const legend = Object.keys(CAL_LABELS).map((k) => `<div class="item"><span class="dot" style="background:${CAL_COLORS[k]}"></span>${CAL_LABELS[k]}</div>`).join('');

  wrap.innerHTML = `
    <div class="card">
      <div class="cal-header">
        <button class="cal-nav-btn" id="cal-prev">‹</button>
        <h2>${monthName.charAt(0).toUpperCase() + monthName.slice(1)}</h2>
        <button class="cal-nav-btn" id="cal-next">›</button>
      </div>
      <div class="cal-grid">
        ${WEEKDAY_SHORT.map((d) => `<div class="cal-dow">${d}</div>`).join('')}
        ${cells}
      </div>
      <div class="legend">${legend}</div>
      <div class="day-detail" id="day-detail"></div>
    </div>
  `;

  document.getElementById('cal-prev').addEventListener('click', () => { calCursor = new Date(year, month - 1, 1); renderCalendar(); });
  document.getElementById('cal-next').addEventListener('click', () => { calCursor = new Date(year, month + 1, 1); renderCalendar(); });
  wrap.querySelectorAll('[data-day]').forEach((el) => el.addEventListener('click', () => showDayDetail(el.dataset.day)));

  if (calSelectedDate) showDayDetail(calSelectedDate);
}

function showDayDetail(iso) {
  calSelectedDate = iso;
  const el = document.getElementById('day-detail');
  const dayLogs = (logsByDate()[iso] || []);
  if (dayLogs.length === 0) {
    el.innerHTML = `<div class="ex-meta">${formatDatePt(iso)}: nenhum registro.</div>`;
    return;
  }
  el.innerHTML = dayLogs.map((log) => {
    const w = state.workouts[log.workoutId];
    const names = w ? log.exerciseIds.map((id) => {
      const ex = w.exercises.find((x) => x.id === id);
      return ex ? `<div class="ex-mini">✓ ${escapeHtml(ex.name)}</div>` : '';
    }).join('') : '';
    const label = w ? w.name : (CAL_LABELS[log.workoutId] || log.workoutId);
    return `<div style="margin-top:8px"><b>${escapeHtml(label)}</b>${names}</div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// AJUSTES
// ---------------------------------------------------------------------------
function renderSettings() {
  const info = currentWeekInfo(state.settings);
  document.getElementById('settings-summary').textContent =
    `Semana ${info.weekNum}/12 · ${info.mesoKey}${info.isDeload ? ' (deload)' : ''}`;
  document.getElementById('cycle-start-input').value = state.settings.cycleStartDate;
  document.getElementById('meso-override-select').value = state.settings.mesoOverride || 'auto';
}

function wireSettingsView() {
  document.getElementById('cycle-start-input').addEventListener('change', (e) => {
    state.settings.cycleStartDate = e.target.value || todayISO();
    Store.save();
    renderAll();
  });
  document.getElementById('meso-override-select').addEventListener('change', (e) => {
    state.settings.mesoOverride = e.target.value === 'auto' ? null : e.target.value;
    Store.save();
    renderAll();
  });
  document.getElementById('reset-data-btn').addEventListener('click', () => {
    if (!confirm('Isso vai apagar todos os pesos, histórico e edições e voltar ao padrão. Tem certeza?')) return;
    Store.reset();
    state = Store.data;
    editorWorkoutId = 'A';
    renderAll();
    showToast('Dados resetados.');
  });
  wireTimerControls();
}

// ---------------------------------------------------------------------------
// EXPORTAR / IMPORTAR
// ---------------------------------------------------------------------------
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportWeightsCSV() {
  const rows = [['Treino', 'Exercicio', 'Peso (kg)', 'Atualizado em']];
  for (const id of WORKOUT_IDS) {
    const w = state.workouts[id];
    for (const e of w.exercises) {
      rows.push([w.name, e.name, e.weight || '', e.weightUpdatedAt ? formatDatePt(e.weightUpdatedAt) : '']);
    }
  }
  const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  downloadFile(`pesos-treino-${todayISO()}.csv`, csv, 'text/csv;charset=utf-8');
  showToast('CSV exportado.');
}

function exportBackupJSON() {
  downloadFile(`backup-treino-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
  showToast('Backup exportado.');
}

function importBackupJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.workouts) throw new Error('formato inválido');
      Store.replaceAll(parsed);
      state = Store.data;
      editorWorkoutId = 'A';
      renderAll();
      showToast('Backup importado!');
    } catch (e) {
      alert('Não foi possível importar esse arquivo: ' + e.message);
    }
  };
  reader.readAsText(file);
}

function wireExportView() {
  document.getElementById('export-csv-btn').addEventListener('click', exportWeightsCSV);
  document.getElementById('export-json-btn').addEventListener('click', exportBackupJSON);
  document.getElementById('import-json-input').addEventListener('change', (e) => {
    if (e.target.files[0]) importBackupJSON(e.target.files[0]);
    e.target.value = '';
  });
}

document.addEventListener('DOMContentLoaded', boot);
