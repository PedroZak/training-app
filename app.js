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
  Catalog.setCustom(state.customExercises);

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
  wireMigration();
  wireMediaFallback();
  wirePicker();
  renderAll();
  setInterval(tickTimerDisplay, 1000);
  initCatalog();

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
    return `<button class="wk-btn ${active ? 'active' : ''}" style="--wk-color:${w.color}" data-pick="${id}">
      ${id}<span class="wk-last">${daysAgoLabel(w.lastPerformedAt)}</span>
    </button>`;
  }).join('');

  const mesoColor = info.isDeload ? DELOAD_COLOR : MESO_COLORS[info.mesoKey];

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
    <div class="card meso-banner" style="--meso-color:${mesoColor}">
      <div>
        <div class="meso-title">${escapeHtml(info.meso.label)}</div>
        <div class="meso-detail">Semana ${info.weekNum}/12 · ${info.meso.series} · ${info.meso.pct}</div>
      </div>
      <span class="pill" style="background:${mesoColor}29;color:${mesoColor}">${info.isDeload ? 'Deload · -40%' : info.mesoKey}</span>
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

  const rows = workout.exercises.map((e) => renderExerciseRow(e, mesoKey, interactive)).join('');

  const finishBtn = interactive
    ? `<div class="finish-bar"><button class="btn-primary" id="finish-btn" ${doneCount === 0 ? 'disabled' : ''}>Concluir treino (${doneCount}/${total})</button></div>`
    : '';

  let seriesRing = '';
  if (interactive) {
    const seriesDone = workout.exercises.filter((e) => state.today.checked.includes(e.id)).reduce((sum, e) => sum + (Number(e.sets) || 0), 0);
    const { seriesMin, seriesMax } = MESO_INFO[mesoKey];
    const pct = Math.max(0, Math.min(1, seriesDone / seriesMax));
    const circumference = 138.2;
    const offset = circumference * (1 - pct);
    const ringColor = seriesDone >= seriesMin ? 'var(--success)' : 'var(--wk-color)';
    seriesRing = `
      <div class="series-ring-row">
        <svg class="series-ring" viewBox="0 0 56 56">
          <circle class="series-ring-track" cx="28" cy="28" r="22"></circle>
          <circle class="series-ring-fill" cx="28" cy="28" r="22" style="stroke:${ringColor};stroke-dashoffset:${offset}"></circle>
        </svg>
        <div class="series-ring-info">
          <div class="value tnum">${seriesDone} séries</div>
          <div class="target">meta do ${mesoKey}: ${seriesMin}-${seriesMax}/grupo</div>
        </div>
      </div>`;
  }

  return `
    <div class="card" style="--wk-color:${workout.color}">
      <div class="workout-title-row">
        <span class="workout-dot" style="background:${workout.color}"></span>
        <div><h2>${escapeHtml(workout.name)}</h2><div class="sub">${escapeHtml(workout.subtitle)}</div></div>
      </div>
      <div class="workout-last">Último: ${daysAgoLabel(workout.lastPerformedAt)}${workout.lastPerformedAt ? ' · ' + formatDatePt(workout.lastPerformedAt) : ''}</div>
      ${seriesRing}
      ${workout.warmup ? `<div class="warmup-note">Aquecimento: ${escapeHtml(workout.warmup)}</div>` : ''}
      <div class="exercise-list" data-workout="${workout.id}">${rows}</div>
    </div>
    ${finishBtn}
  `;
}

function renderExerciseRow(e, mesoKey, interactive) {
  const done = interactive && state.today.checked.includes(e.id);
  const target = e.reps[mesoKey];
  const numericWeight = parseFloat(String(e.weight).replace(',', '.'));
  const isPR = interactive && e.bestWeight != null && Number.isFinite(numericWeight) && numericWeight === e.bestWeight && e.bestWeight > 0;
  const cat = interactive && e.exerciseId ? Catalog.get(e.exerciseId) : null;
  const mediaOpen = !!cat && expandedMedia.has(e.id);
  return `
    <div class="exercise-row ${done ? 'done' : ''}" data-ex="${e.id}">
      ${interactive ? `<button class="ex-check" data-check="${e.id}">${done ? '✓' : ''}</button>` : '<span style="width:28px"></span>'}
      <div class="ex-body">
        <div class="ex-head">
          <div class="ex-name">${escapeHtml(Catalog.name(e))}${e.isNew ? '<span class="ex-new-badge">NOVO</span>' : ''}${isPR ? '<span class="pr-badge">🏆 PR</span>' : ''}</div>
          ${cat ? `<button type="button" class="ex-chevron" data-media-toggle="${e.id}" aria-expanded="${mediaOpen}" aria-controls="media-${e.id}" aria-label="Ver execução de ${escapeHtml(cat.name_pt)}"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ''}
        </div>
        ${mediaOpen ? mediaPanelHTML(e.id, cat) : ''}
        <div class="ex-meta">${escapeHtml(e.grip)} · ${e.sets}x</div>
        <div class="ex-target tnum">${escapeHtml(target)} reps <span class="rest-tag">· descanso ${escapeHtml(e.rest)}</span></div>
        ${e.notes ? `<div class="ex-notes">${escapeHtml(e.notes)}</div>` : ''}
        ${interactive ? `
        <div class="ex-controls">
          <div class="weight-field">
            <button type="button" data-weight-step="-2.5" data-weight="${e.id}">−</button>
            <input type="number" inputmode="decimal" step="0.5" placeholder="0" value="${e.weight || ''}" class="tnum" data-weight-input="${e.id}">
            <span>kg</span>
            <button type="button" data-weight-step="2.5" data-weight="${e.id}">+</button>
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
  root.querySelectorAll('[data-media-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => toggleMedia(btn));
  });
  root.querySelectorAll('[data-weight-input]').forEach((inp) => {
    inp.addEventListener('change', () => saveWeight(inp.dataset.weightInput, inp.value));
  });
  root.querySelectorAll('[data-weight-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ex = findExerciseById(btn.dataset.weight);
      const current = parseFloat(String(ex.weight).replace(',', '.')) || 0;
      const next = Math.max(0, current + parseFloat(btn.dataset.weightStep));
      saveWeight(ex.id, String(next));
    });
  });
  root.querySelectorAll('[data-rest]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const exId = btn.dataset.rest;
      const ex = findExerciseById(exId);
      startTimer(ex.restSec, Catalog.name(ex));
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
    if (ex && ex.restSec) startTimer(ex.restSec, Catalog.name(ex));
  }
}

function saveWeight(exId, value) {
  const ex = findExerciseById(exId);
  if (!ex) return;
  ex.weight = value;
  ex.weightUpdatedAt = todayISO();
  const numeric = parseFloat(String(value).replace(',', '.'));
  if (Number.isFinite(numeric) && numeric > 0) {
    if (ex.bestWeight == null) {
      ex.bestWeight = numeric;
    } else if (numeric > ex.bestWeight) {
      ex.bestWeight = numeric;
      showToast(`🏆 Novo recorde em ${Catalog.name(ex)}: ${numeric}kg!`);
    }
  }
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

const TIMER_RING_CIRCUMFERENCE = 175.93;

function renderTimer() {
  const overlay = document.getElementById('timer-overlay');
  if (overlay.hidden) return;
  const m = Math.floor(Timer.remaining / 60);
  const s = Timer.remaining % 60;
  overlay.querySelector('.timer-time').textContent = `${m}:${String(s).padStart(2, '0')}`;
  overlay.querySelector('.timer-label').textContent = 'Descanso · ' + Timer.label;
  const pct = Timer.total > 0 ? Timer.remaining / Timer.total : 0;
  document.getElementById('timer-ring-fill').style.strokeDashoffset = TIMER_RING_CIRCUMFERENCE * (1 - pct);
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
  if (!editorWorkoutId) editorWorkoutId = 'A';
  const tabs = WORKOUT_IDS.map((id) => `<button class="tab-btn ${editorWorkoutId === id ? 'active' : ''}" style="--tab-color:${state.workouts[id].color}" data-tab="${id}">${id}</button>`).join('');

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
      <div class="field-row"><label>Nome${e.exerciseId ? (String(e.exerciseId).startsWith('custom-') ? ' (personalizado)' : ' (do catálogo · ' + escapeHtml(e.exerciseId) + ')') : ''}</label><input type="text" data-f="name" value="${escapeHtml(Catalog.name(e))}" ${e.exerciseId && Catalog.get(e.exerciseId) && !Catalog.get(e.exerciseId).custom ? 'disabled' : ''}></div>
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
        else if (field === 'name' && String(ex.exerciseId || '').startsWith('custom-') && Catalog.get(ex.exerciseId)) {
          Catalog.get(ex.exerciseId).name_pt = input.value.trim() || ex.name;
          Catalog.setCustom(state.customExercises);
          ex.name = Catalog.get(ex.exerciseId).name_pt;
        }
        else ex[field] = input.value;
        Store.save();
        renderAll();
      });
    });

    card.querySelector('[data-del]').addEventListener('click', () => {
      if (!confirm(`Remover "${Catalog.name(ex)}" do treino?`)) return;
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

  document.getElementById('add-ex-btn').addEventListener('click', () => openPicker(w.id));
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
      return ex ? `<div class="ex-mini">✓ ${escapeHtml(Catalog.name(ex))}</div>` : '';
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
  renderCatalogStatus();
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
    Catalog.setCustom(state.customExercises);
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
  const rows = [['Treino', 'Exercicio', 'Peso (kg)', 'Atualizado em', 'ID do catalogo']];
  for (const id of WORKOUT_IDS) {
    const w = state.workouts[id];
    for (const e of w.exercises) {
      rows.push([w.name, Catalog.name(e), e.weight || '', e.weightUpdatedAt ? formatDatePt(e.weightUpdatedAt) : '', e.exerciseId || '']);
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
      Catalog.setCustom(state.customExercises);
      editorWorkoutId = 'A';
      renderAll();
      showToast('Backup importado!');
      maybeOfferMigration();
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

// ---------------------------------------------------------------------------
// GUIA DE EXECUÇÃO: seta na célula do exercício (mídia só é criada/baixada ao abrir)
// ---------------------------------------------------------------------------
const expandedMedia = new Set(); // ids de exercício com o painel aberto (só na sessão)
const MEDIA_STEP_S = 0.8;        // tempo de cada foto no loop
const MEDIA_FALLBACK = (msg) => `<div class="media-fallback">${msg}</div>`;

function mediaPanelHTML(exId, cat) {
  const media = [...(cat.media || [])].sort((a, b) => a.sort_order - b.sort_order);
  const video = media.find((m) => m.type === 'video');
  const gif = media.find((m) => m.type === 'gif');
  const imgs = media.filter((m) => m.type === 'image').slice(0, 4);
  const alt = escapeHtml(cat.name_pt);
  let body;
  if (video) {
    body = `<div class="media-frame"><video controls playsinline preload="metadata" src="${escapeHtml(video.url)}" aria-label="${alt}"></video></div>`;
  } else if (gif) {
    body = `<div class="media-frame"><img src="${escapeHtml(gif.url)}" alt="${alt}" decoding="async"></div>`;
  } else if (imgs.length === 1) {
    body = `<div class="media-frame"><img src="${escapeHtml(imgs[0].url)}" alt="${alt}" decoding="async"></div>`;
  } else if (imgs.length > 1) {
    const n = imgs.length;
    body = `<div class="media-frame media-loop" style="--kf:mediaLoop${n};--dur:${(n * MEDIA_STEP_S).toFixed(1)}s">` +
      imgs.map((m, i) => `<img src="${escapeHtml(m.url)}" alt="${alt} — posição ${i + 1} de ${n}" decoding="async" style="--i:${i}">`).join('') + '</div>';
  } else {
    body = MEDIA_FALLBACK('Ainda não há foto ou vídeo para este exercício.');
  }
  const first = media[0];
  const cap = [cat.muscle_primary, cat.equipment].filter(Boolean).map(escapeHtml).join(' · ') +
    (first ? ` · fonte: ${escapeHtml(first.source.split(' · ')[0])}, ${escapeHtml(first.license)}` : '');
  return `<div class="ex-media" id="media-${exId}">${body}<div class="media-cap">${cap}</div></div>`;
}

function toggleMedia(btn) {
  const exId = btn.dataset.mediaToggle;
  const ex = findExerciseById(exId);
  const cat = ex && ex.exerciseId ? Catalog.get(ex.exerciseId) : null;
  if (!cat) return;
  const open = !expandedMedia.has(exId);
  if (open) expandedMedia.add(exId); else expandedMedia.delete(exId);
  btn.setAttribute('aria-expanded', String(open));
  const row = btn.closest('.exercise-row');
  row.querySelector('.ex-media')?.remove();
  if (open) row.querySelector('.ex-head').insertAdjacentHTML('afterend', mediaPanelHTML(exId, cat));
}

function wireMediaFallback() {
  // 'error' não borbulha: escuta na captura. Sem rede e sem cache -> mensagem em vez de imagem quebrada.
  document.getElementById('home-view').addEventListener('error', (ev) => {
    const frame = ev.target.closest && ev.target.closest('.media-frame');
    if (frame) frame.outerHTML = MEDIA_FALLBACK('Não foi possível carregar a mídia agora. Depois de aberta uma vez com internet, ela fica disponível offline.');
  }, true);
}

// ---------------------------------------------------------------------------
// SELETOR DE EXERCÍCIOS (tela de treinos > adicionar exercício)
// ---------------------------------------------------------------------------
let pickerWid = null;
let pickerTimer = null;

// Quanto cada exercício do catálogo já foi usado: aparece em treinos + em registros do calendário.
function usageCounts() {
  const all = Object.values(state.workouts).flatMap((w) => w.exercises);
  const u = {};
  for (const e of all) if (e.exerciseId) u[e.exerciseId] = (u[e.exerciseId] || 0) + 1;
  const local = Object.fromEntries(all.map((e) => [e.id, e]));
  for (const l of state.logs) {
    for (const id of l.exerciseIds) {
      const e = local[id];
      if (e && e.exerciseId) u[e.exerciseId] = (u[e.exerciseId] || 0) + 1;
    }
  }
  return u;
}

function fillSelect(sel, values, allLabel) {
  sel.innerHTML = (allLabel ? `<option value="">${allLabel}</option>` : '') +
    values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
}

function openPicker(wid) {
  pickerWid = wid;
  fillSelect(document.getElementById('picker-muscle'), Catalog.muscles(), 'Todos os músculos');
  fillSelect(document.getElementById('picker-equip'), Catalog.equipments(), 'Todo equipamento');
  document.getElementById('picker-q').value = '';
  document.getElementById('picker-list-view').hidden = false;
  document.getElementById('picker-form-view').hidden = true;
  document.getElementById('picker').hidden = false;
  renderPickerList();
  document.getElementById('picker-q').focus();
}

function closePicker() {
  document.getElementById('picker').hidden = true;
  pickerWid = null;
  document.getElementById('add-ex-btn')?.focus();
}

function renderPickerList() {
  const q = document.getElementById('picker-q').value;
  const muscle = document.getElementById('picker-muscle').value;
  const equipment = document.getElementById('picker-equip').value;
  const list = document.getElementById('picker-list');
  const count = document.getElementById('picker-count');
  if (!Catalog.ready && Catalog.all().length === 0) {
    count.textContent = '';
    list.innerHTML = '<div class="picker-empty">Catálogo indisponível agora (sem conexão). Você ainda pode criar um exercício personalizado abaixo.</div>';
    return;
  }
  const results = Catalog.search({ q, muscle, equipment, usage: usageCounts() });
  const inWorkout = new Set(state.workouts[pickerWid].exercises.map((e) => e.exerciseId).filter(Boolean));
  const filtered = q.trim() || muscle || equipment;
  count.textContent = `${results.length} exercício${results.length === 1 ? '' : 's'}${filtered ? '' : ' · os que você mais usa vêm primeiro'}`;
  if (results.length === 0) {
    list.innerHTML = `<div class="picker-empty">Nada encontrado${q.trim() ? ' para “' + escapeHtml(q.trim()) + '”' : ''}.` +
      `<br><button type="button" class="btn-secondary" data-create-from-query>＋ Criar “${escapeHtml(q.trim() || 'novo exercício')}”</button></div>`;
    return;
  }
  list.innerHTML = results.map((ex) => `
    <button type="button" class="picker-item" data-pick-ex="${escapeHtml(ex.id)}">
      ${ex.thumb ? `<img class="picker-thumb" src="${escapeHtml(ex.thumb)}" alt="" loading="lazy" decoding="async">` : '<span class="picker-thumb" aria-hidden="true">🏋️</span>'}
      <span class="picker-body">
        <span class="picker-name">${escapeHtml(ex.name_pt)}${inWorkout.has(ex.id) ? '<span class="picker-tag in">no treino</span>' : ''}${ex.custom ? '<span class="picker-tag cus">personalizado</span>' : ''}</span>
        <span class="picker-meta" style="display:block">${escapeHtml(ex.muscle_primary || '')} · ${escapeHtml(ex.equipment || '')}</span>
      </span>
    </button>`).join('');
}

function pickExercise(catalogId) {
  const cat = Catalog.get(catalogId);
  const w = state.workouts[pickerWid];
  if (!cat || !w) return;
  w.exercises.push({
    id: uid('ex'), exerciseId: cat.id, name: cat.name_pt, grip: '—', sets: 3,
    reps: { M1: '10-12', M2: '8-10', M3: '6-8' }, rest: '60-90s', restSec: 75,
    notes: '', isNew: true, weight: '', weightUpdatedAt: null, bestWeight: null,
  });
  Store.save();
  closePicker();
  renderWorkoutsTab();
  renderHome();
  showToast(`“${cat.name_pt}” adicionado ao ${w.name}.`);
  const cards = document.querySelectorAll('#editor-exercises .editor-ex-card');
  if (cards.length) cards[cards.length - 1].scrollIntoView({ block: 'center' });
}

function showCustomForm(prefill) {
  fillSelect(document.getElementById('custom-muscle'), [...new Set([...Catalog.muscles(), 'outro'])]);
  fillSelect(document.getElementById('custom-equip'), [...new Set([...Catalog.equipments(), 'outro'])]);
  document.getElementById('custom-name').value = prefill || '';
  document.getElementById('picker-list-view').hidden = true;
  document.getElementById('picker-form-view').hidden = false;
  document.getElementById('custom-name').focus();
}

function saveCustomExercise() {
  const name = document.getElementById('custom-name').value.trim();
  if (!name) { document.getElementById('custom-name').focus(); return; }
  const dup = Catalog.findByName(name);
  if (dup && confirm(`Já existe “${dup.name_pt}” no catálogo. Usar o existente?`)) {
    pickExercise(dup.id);
    return;
  }
  const c = Catalog.makeCustom({
    name_pt: name,
    muscle_primary: document.getElementById('custom-muscle').value,
    equipment: document.getElementById('custom-equip').value,
  });
  state.customExercises.push(c);
  Catalog.setCustom(state.customExercises);
  Store.save();
  pickExercise(c.id);
}

function wirePicker() {
  const $ = (id) => document.getElementById(id);
  $('picker-close').addEventListener('click', closePicker);
  $('picker-form-close').addEventListener('click', closePicker);
  $('picker').addEventListener('click', (ev) => { if (ev.target.id === 'picker') closePicker(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('picker').hidden) closePicker(); });
  $('picker-q').addEventListener('input', () => { clearTimeout(pickerTimer); pickerTimer = setTimeout(renderPickerList, 80); });
  $('picker-muscle').addEventListener('change', renderPickerList);
  $('picker-equip').addEventListener('change', renderPickerList);
  $('picker-list').addEventListener('click', (ev) => {
    const item = ev.target.closest('[data-pick-ex]');
    if (item) return pickExercise(item.dataset.pickEx);
    if (ev.target.closest('[data-create-from-query]')) showCustomForm($('picker-q').value.trim());
  });
  $('picker-custom').addEventListener('click', () => showCustomForm($('picker-q').value.trim()));
  $('custom-back').addEventListener('click', () => {
    $('picker-form-view').hidden = true;
    $('picker-list-view').hidden = false;
    $('picker-q').focus();
  });
  $('custom-save').addEventListener('click', saveCustomExercise);
  $('custom-name').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') saveCustomExercise(); });
}

// ---------------------------------------------------------------------------
// CATÁLOGO: carregamento, migração (com backup obrigatório) e armazenamento persistente
// ---------------------------------------------------------------------------
let storagePersisted = null;

async function initCatalog() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      storagePersisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    }
  } catch (e) { storagePersisted = null; }
  await Catalog.load();
  renderAll();
  maybeOfferMigration();
}

function linkedCount() {
  return Object.values(state.workouts).flatMap((w) => w.exercises).filter((e) => e.exerciseId).length;
}

function renderCatalogStatus() {
  const total = Object.values(state.workouts).flatMap((w) => w.exercises).length;
  document.getElementById('catalog-status').textContent = Catalog.ready
    ? `${linkedCount()} de ${total} exercícios vinculados ao catálogo (${Object.keys(Catalog.byId).length} disponíveis` +
      `${state.customExercises.length ? ', ' + state.customExercises.length + ' personalizados' : ''}).`
    : 'Catálogo indisponível agora (sem conexão); usando os nomes salvos.';
  document.getElementById('persist-status').textContent = storagePersisted === null
    ? 'Armazenamento protegido: não suportado neste navegador.'
    : `Armazenamento protegido contra limpeza automática: ${storagePersisted ? 'sim' : 'não'}.`;
  document.getElementById('undo-migration-btn').hidden = linkedCount() === 0;
}

function maybeOfferMigration() {
  if (!Catalog.ready || state.settings.catalogOptOut) return;
  const { pending } = Catalog.plan(state);
  if (pending.length === 0) return;
  document.getElementById('migrate-count').textContent = pending.length;
  document.getElementById('migrate-modal').hidden = false;
}

function runMigration() {
  // 1) cópia de segurança no próprio navegador (falhou? não migra)
  try {
    localStorage.setItem(CATALOG_SNAPSHOT_KEY, localStorage.getItem(STORAGE_KEY) || '');
  } catch (e) {
    alert('Não foi possível criar a cópia de segurança; nada foi alterado.');
    return;
  }
  // 2) backup em arquivo, antes de qualquer alteração
  exportBackupJSON();
  // 3) vínculo por id (aborta sozinho se qualquer outro dado mudar)
  try {
    const rep = Catalog.apply(state);
    Store.save();
    showToast(`${rep.linked} exercícios vinculados ao catálogo.`);
  } catch (e) {
    alert('Migração cancelada: ' + e.message);
  }
  document.getElementById('migrate-modal').hidden = true;
  renderAll();
}

function wireMigration() {
  document.getElementById('migrate-go').addEventListener('click', runMigration);
  document.getElementById('migrate-later').addEventListener('click', () => {
    document.getElementById('migrate-modal').hidden = true;
  });
  document.getElementById('undo-migration-btn').addEventListener('click', () => {
    if (!confirm('Remover só o vínculo com o catálogo? Nomes antigos, pesos e histórico continuam como estão.')) return;
    const n = Catalog.revert(state);
    state.settings.catalogOptOut = true;
    Store.save();
    renderAll();
    showToast(`Vínculo removido de ${n} exercícios.`);
  });
}

document.addEventListener('DOMContentLoaded', boot);
