// ---------------------------------------------------------------------------
// Dados fixos do ciclo (macrociclo, cardio, agenda semanal) + seed dos treinos.
// Tudo que o usuário edita depois (pesos, exercícios, histórico) mora no
// localStorage, gerenciado pelo objeto Store no final deste arquivo.
// ---------------------------------------------------------------------------

const MESO_INFO = {
  M1: { label: 'Mesociclo 1 — Base', weeks: '1-4', series: '16-20 séries/grupo', pct: '65-75% 1RM', seriesMin: 16, seriesMax: 20 },
  M2: { label: 'Mesociclo 2 — Força-Hipertrofia', weeks: '5-8', series: '12-16 séries/grupo', pct: '75-85% 1RM', seriesMin: 12, seriesMax: 16 },
  M3: { label: 'Mesociclo 3 — Força Máxima', weeks: '9-12', series: '10-14 séries/grupo', pct: '85-95% 1RM', seriesMin: 10, seriesMax: 14 },
};

// Cor fixa por fase do ciclo (linguagem de cor consistente, tipo zonas do Garmin/Oura)
const MESO_COLORS = { M1: '#2DD4BF', M2: '#FB923C', M3: '#F43F5E' };
const DELOAD_COLOR = '#F5B83D';

const CARDIO_INFO = {
  M1: '25-30min · Zona 3 (130-145bpm)',
  M2: '20-25min · Zona 3 (140-155bpm)',
  M3: '20min · Zona 2 (120-135bpm)',
};

// 0=Domingo .. 6=Sábado (Date.getDay())
const WEEK_SCHEDULE = {
  0: { type: 'rest', label: 'Descanso' },
  1: { type: 'workout', id: 'A' },
  2: { type: 'workout', id: 'B' },
  3: { type: 'cardio', label: 'Cardio' },
  4: { type: 'workout', id: 'C' },
  5: { type: 'workout', id: 'D' },
  6: { type: 'cardio', label: 'Cardio' },
};

const WORKOUT_META = {
  A: { name: 'Treino A', subtitle: 'Costas (largura) + Bíceps', color: '#3b82f6', warmup: '2x15 Face Pull leve' },
  B: { name: 'Treino B', subtitle: 'Peito (miolo) + Tríceps', color: '#ef4444', warmup: '' },
  C: { name: 'Treino C', subtitle: 'Pernas', color: '#f97316', warmup: '' },
  D: { name: 'Treino D', subtitle: 'Ombros + Trapézio + Core', color: '#eab308', warmup: '' },
};

function ex(name, grip, sets, m1, m2, m3, rest, notes, isNew) {
  return { name, grip, sets, reps: { M1: m1, M2: m2, M3: m3 }, rest, notes, isNew: !!isNew, weight: '', weightUpdatedAt: null, bestWeight: null };
}

// id é gerado na primeira carga (seedIfEmpty) para garantir estabilidade.
const SEED_EXERCISES = {
  A: [
    ex('Barra Fixa (Pull-up)', 'Pronada aberta', 4, '8-10', '6-8', '4-6', '90-150s', 'Âncora de largura. Cinto de peso a partir do M2', true),
    ex('Puxada Alta Barra', 'Pronada aberta', 3, '10-12', '8-10', '6-8', '75-120s', 'Peitoral superior'),
    ex('Remada Curvada Barra', 'Pronada', 4, '10-12', '8-10', '5-6', '75-120s', 'Espessura, puxa p/ umbigo'),
    ex('Pulldown Corda', 'Neutra', 3, '12-15', '12-15', '10-12', '60s', 'Dorsal inferior'),
    ex('Rosca Direta Barra W', 'Supinada', 3, '10-12', '8-10', '6-8', '60-90s', 'Cotovelos fixos'),
    ex('Rosca Inclinada 45°', 'Supinada', 3, '10-12', '10-12', '8-10', '45-60s', 'Excêntrico lento'),
    ex('Rosca Martelo', 'Neutra', 3, '12-15', '10-12', '8-10', '45-60s', 'Braquial/antebraço', true),
  ],
  B: [
    ex('Supino Reto Barra', 'Pronada', 4, '10-12', '8-10', '5-6', '90-120s', 'Escápulas retraídas'),
    ex('Supino Inclinado Halteres', 'Neutra', 3, '10-12', '10-12', '8-10', '75-90s', 'Peitoral superior'),
    ex('Crossover Polia', 'Cabo cruzado', 3, '12-15', '12-15', '10-12', '45-60s', 'Convergente, pausa 1-2s no centro', true),
    ex('Peck Deck Convergente', 'Convergente', 3, '12-15', '12-15', '10-12', '45-60s', 'Isola porção esternal', true),
    ex('Paralelas / Mergulho', 'Neutra', 3, 'Falha', 'Falha', 'Falha', '60-75s', 'Tronco à frente'),
    ex('Tríceps Polia', 'Pronada', 4, '12-15', '10-12', '10-12', '60s', 'Cotovelos fixos'),
    ex('Tríceps Francês Halter', 'Neutra', 3, '10-12', '10-12', '8-10', '60-75s', 'Cabeça longa'),
  ],
  C: [
    ex('Agachamento Livre / Smith', 'Pronada', 4, '10-12', '8-10', '5-6', '90-120s', 'Abaixo do paralelo'),
    ex('Leg Press 45°', '—', 4, '12-15', '10-12', '8-10', '75-90s', 'Amplitude total'),
    ex('Cadeira Extensora', '—', 3, '12-15', '12-15', '10-12', '60s', '5 reps lentas no final'),
    ex('Stiff / RDL Barra', 'Pronada', 3, '10-12', '10-12', '8-10', '75s', 'Quadril p/ trás'),
    ex('Mesa Flexora', '—', 3, '12', '10-12', '10', '60s', 'Sem compensar quadril'),
    ex('Panturrilha em Pé', '—', 4, '15-20', '15-20', '15-20', '45s', 'Amplitude total'),
    ex('Panturrilha Sentado', '—', 3, '15-20', '15-20', '15-20', '45s', 'Sóleo'),
  ],
  D: [
    ex('Desenv. Halteres Sentado', 'Pronada/Neutra', 4, '10-12', '8-10', '6-8', '75-90s', 'Cotovelos 90° na descida'),
    ex('Elevação Lateral Halteres', 'Neutra', 4, '12-15', '12-15', '10-12', '60s', 'Ombro deprimido'),
    ex('Face Pull Corda', 'Neutra', 3, '15', '15', '12-15', '60s', 'Cotovelos acima dos ombros'),
    ex('Crucifixo Invertido', 'Neutra/Pronada', 3, '15', '12-15', '12', '45-60s', 'Único local do ciclo'),
    ex('Elevação Frontal Alt.', 'Neutra', 2, '12-15', '12', '10-12', '45s', 'Sem balanço'),
    ex('Encolhimento Halteres', 'Neutra', 4, '8-12', '6-10', '6-8', '60-75s', '100% vertical'),
    ex('Abdominal Supra Polia', 'Neutra', 3, '15', '15', '15', '45s', 'Enrola o tronco'),
    ex('Crunch Máquina', '—', 3, '12-15', '10-12', '10-12', '45-60s', 'Sobrecarga progressiva', true),
    ex('Rotação Tronco Polia', 'Cabo alto/baixo', 3, '12-15/lado', '12-15/lado', '10-12/lado', '45-60s', 'Obliquos com carga', true),
  ],
};

function parseRestSeconds(restLabel) {
  const nums = (restLabel.match(/\d+/g) || []).map(Number);
  if (nums.length === 0) return 90;
  if (nums.length === 1) return nums[0];
  return Math.round((nums[0] + nums[1]) / 2 / 5) * 5;
}

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function todayISO(d) {
  d = d || new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Store: única fonte de verdade, persistida em localStorage.
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'training-app:v1';

const Store = {
  data: null,

  load() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { /* private mode etc */ }
    if (raw) {
      try { this.data = JSON.parse(raw); } catch (e) { this.data = null; }
    }
    if (!this.data) this.data = this._seed();
    this._migrate();
    return this.data;
  },

  _seed() {
    const workouts = {};
    for (const id of ['A', 'B', 'C', 'D']) {
      workouts[id] = {
        id,
        ...WORKOUT_META[id],
        lastPerformedAt: null,
        exercises: SEED_EXERCISES[id].map((e) => ({ id: uid('ex'), ...e, restSec: parseRestSeconds(e.rest) })),
      };
    }
    return {
      version: 1,
      settings: {
        cycleStartDate: todayISO(),
        mesoOverride: null, // null = auto pela data; ou 'M1'|'M2'|'M3'
      },
      workouts,
      today: { date: todayISO(), workoutId: null, checked: [] },
      logs: [], // { id, workoutId, dateISO, completedAt, exerciseIds: [] }
      customExercises: [], // exercícios criados no seletor (id 'custom-…'); ficam no estado => entram no backup/restore
    };
  },

  _migrate() {
    if (!this.data.settings) this.data.settings = { cycleStartDate: todayISO(), mesoOverride: null };
    if (!this.data.today) this.data.today = { date: todayISO(), workoutId: null, checked: [] };
    if (!this.data.logs) this.data.logs = [];
    if (!Array.isArray(this.data.customExercises)) this.data.customExercises = [];
    for (const id of ['A', 'B', 'C', 'D']) {
      const w = this.data.workouts[id];
      if (!w) continue;
      for (const e of w.exercises) {
        if (e.bestWeight === undefined) {
          const n = parseFloat(String(e.weight).replace(',', '.'));
          e.bestWeight = Number.isFinite(n) ? n : null;
        }
      }
    }
  },

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch (e) { console.error('Falha ao salvar', e); }
  },

  reset() {
    this.data = this._seed();
    this.save();
  },

  replaceAll(newData) {
    this.data = newData;
    this._migrate();
    this.save();
  },
};

// ---------------------------------------------------------------------------
// Helpers de ciclo (semana / mesociclo atual)
// ---------------------------------------------------------------------------
function currentWeekInfo(settings) {
  const start = new Date(settings.cycleStartDate + 'T00:00:00');
  const now = new Date(todayISO() + 'T00:00:00');
  const diffDays = Math.floor((now - start) / 86400000);
  let weekNum = (Math.floor(diffDays / 7) % 12 + 12) % 12 + 1; // 1..12, cíclico
  let mesoKey, isDeload;
  if (weekNum <= 4) { mesoKey = 'M1'; isDeload = weekNum === 4; }
  else if (weekNum <= 8) { mesoKey = 'M2'; isDeload = weekNum === 8; }
  else { mesoKey = 'M3'; isDeload = weekNum === 12; }
  if (settings.mesoOverride) mesoKey = settings.mesoOverride;
  return { weekNum, mesoKey, isDeload, meso: MESO_INFO[mesoKey] };
}

function todaySchedule() {
  return WEEK_SCHEDULE[new Date().getDay()];
}
