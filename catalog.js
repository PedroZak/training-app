'use strict';
// Catálogo de exercícios (somente leitura no navegador) + migração não destrutiva.
// A migração SÓ acrescenta `exerciseId` nos exercícios existentes: nome, id local, pesos,
// bestWeight, logs e calendário não são tocados (e isso é verificado antes de salvar).

const CATALOG_SNAPSHOT_KEY = 'training-app:v1:pre-catalog';

const Catalog = {
  byId: {},
  customById: {},
  map: {},
  ready: false,
  _index: null,

  async load() {
    try {
      const [c, m] = await Promise.all([
        fetch('exercises.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
        fetch('exercise-map.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      ]);
      this.byId = Object.fromEntries(c.exercises.map((e) => [e.id, e]));
      this.map = m.map;
      this.ready = true;
    } catch (e) {
      this.ready = false; // offline sem cache: o app segue usando os nomes salvos
    }
    return this.ready;
  },

  // Exercícios personalizados vivem no estado do app (localStorage) e são mesclados aqui.
  setCustom(list) {
    this.customById = Object.fromEntries((list || []).map((e) => [e.id, e]));
    this._index = null;
  },

  get(id) { return this.byId[id] || this.customById[id] || null; },

  all() { return [...Object.values(this.byId), ...Object.values(this.customById)]; },

  // Nome exibido: name_pt do catálogo quando vinculado; senão o nome salvo (fallback).
  name(ex) {
    const c = ex.exerciseId && this.get(ex.exerciseId);
    return c ? c.name_pt : ex.name;
  },

  // sem acento, minúsculas, espaços normalizados
  norm(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  },

  _buildIndex() {
    this._index = this.all().map((ex) => {
      const fields = [ex.name_pt, ex.name_en, ...(ex.aliases || [])].map((t) => this.norm(t)).filter(Boolean);
      return { ex, fields, hay: fields.join(' | ') };
    });
  },

  // Busca por name_pt, name_en e aliases (todas as palavras da busca precisam aparecer).
  // Ordem: qualidade do casamento -> uso (usage[id]) -> nome. Sem busca: uso -> nome.
  search({ q = '', muscle = '', equipment = '', usage = {} } = {}) {
    if (!this._index) this._buildIndex();
    const nq = this.norm(q);
    const tokens = nq ? nq.split(' ') : [];
    const out = [];
    for (const it of this._index) {
      const ex = it.ex;
      if (muscle && this.muscleGroup(ex.muscle_primary) !== muscle) continue;
      if (equipment && ex.equipment !== equipment) continue;
      let tier = 4;
      if (tokens.length) {
        if (!tokens.every((t) => it.hay.includes(t))) continue;
        if (it.fields.some((f) => f === nq)) tier = 0;
        else if (it.fields.some((f) => f.startsWith(nq))) tier = 1;
        else if (it.fields.some((f) => f.split(' ').some((w) => w.startsWith(tokens[0])))) tier = 2;
        else tier = 3;
      }
      out.push({ ex, tier });
    }
    out.sort((a, b) => a.tier - b.tier
      || (usage[b.ex.id] || 0) - (usage[a.ex.id] || 0)
      || a.ex.name_pt.localeCompare(b.ex.name_pt, 'pt'));
    return out.map((r) => r.ex);
  },

  // 'costas (dorsal)' e 'costas (espessura)' entram no grupo 'costas' nos filtros
  muscleGroup(m) { return String(m || '').split(' (')[0]; },
  muscles() { return [...new Set(this.all().map((e) => this.muscleGroup(e.muscle_primary)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt')); },
  equipments() { return [...new Set(this.all().map((e) => e.equipment).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt')); },

  // Cria um exercício personalizado (id 'custom-…'). Quem chama guarda em state.customExercises.
  makeCustom({ name_pt, muscle_primary, equipment }) {
    const slug = this.norm(name_pt).replace(/ /g, '-').slice(0, 40) || 'exercicio';
    let id;
    do { id = `custom-${slug}-${Math.random().toString(36).slice(2, 6)}`; } while (this.get(id));
    return {
      id, name_pt: name_pt.trim(), name_pt_status: 'custom', name_en: '', aliases: [],
      muscle_primary: muscle_primary || 'outro', muscle_secondary: [], equipment: equipment || 'outro',
      category: 'força', thumb: null, media: [], custom: true, source_id: null,
    };
  },

  // Já existe algo com exatamente esse nome/alias? (evita duplicar sem querer)
  findByName(name) {
    const n = this.norm(name);
    if (!n) return null;
    return this.all().find((e) => [e.name_pt, e.name_en, ...(e.aliases || [])].some((t) => this.norm(t) === n)) || null;
  },

  _exercises(data) {
    return Object.values(data.workouts).flatMap((w) => w.exercises);
  },

  plan(data) {
    const pending = [], unmapped = [];
    for (const ex of this._exercises(data)) {
      if (ex.exerciseId) continue;
      const id = this.map[ex.name];
      (id && this.byId[id] ? pending : unmapped).push({ ex, id });
    }
    return { pending, unmapped };
  },

  // Vincula por id. Aborta (sem alterar nada) se qualquer outro dado mudar.
  apply(data) {
    const strip = () => JSON.stringify(data, (k, v) => (k === 'exerciseId' ? undefined : v));
    const before = strip();
    const { pending, unmapped } = this.plan(data);
    for (const p of pending) p.ex.exerciseId = p.id;
    if (strip() !== before) {
      for (const p of pending) delete p.ex.exerciseId;
      throw new Error('a migração alteraria outros dados — cancelada, nada foi salvo');
    }
    return { linked: pending.length, unmapped: unmapped.map((u) => u.ex.name) };
  },

  // Inverso exato da migração: remove só o vínculo; o nome antigo nunca foi apagado.
  revert(data) {
    let n = 0;
    for (const ex of this._exercises(data)) if (ex.exerciseId) { delete ex.exerciseId; n++; }
    return n;
  },
};
