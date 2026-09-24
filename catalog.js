'use strict';
// Catálogo de exercícios (somente leitura no navegador) + migração não destrutiva.
// A migração SÓ acrescenta `exerciseId` nos exercícios existentes: nome, id local, pesos,
// bestWeight, logs e calendário não são tocados (e isso é verificado antes de salvar).

const CATALOG_SNAPSHOT_KEY = 'training-app:v1:pre-catalog';

const Catalog = {
  byId: {},
  map: {},
  ready: false,

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

  get(id) { return this.byId[id] || null; },

  // Nome exibido: name_pt do catálogo quando vinculado; senão o nome salvo (fallback).
  name(ex) {
    const c = ex.exerciseId && this.byId[ex.exerciseId];
    return c ? c.name_pt : ex.name;
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
