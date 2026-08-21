/**
 * Olivo & Liora · núcleo de sincronización
 * =========================================
 *
 * Este archivo define CÓMO se combinan los datos de dos dispositivos.
 * Lo usan los tres lados por igual:
 *
 *   - el navegador (index.html lo carga antes que app.js)
 *   - el servidor  (api/data.js lo requiere)
 *   - la app de iPhone (Sync/MergeEngine.swift replica exactamente esta lógica)
 *
 * Si cambias una regla aquí, cámbiala también en MergeEngine.swift.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA
 * ---------------------------------------------------------------------------
 * Cada registro (un ingrediente, una receta, una venta, un gasto) lleva:
 *
 *   id         identificador estable, nunca cambia
 *   updatedAt  milisegundos de la última vez que se tocó
 *   deleted    true si se borró (se conserva como "lápida", no se elimina)
 *
 * Para combinar dos versiones del mismo registro gana la de `updatedAt` mayor.
 * Nunca se pisa un documento completo: se combina registro por registro. Por
 * eso da igual el orden en que lleguen los cambios ni cuántos dispositivos
 * escriban a la vez — todos terminan viendo exactamente lo mismo.
 *
 * Las lápidas evitan el bug clásico: si borras un gasto en el teléfono y la
 * laptop todavía tiene su copia, sin lápida la laptop lo "resucitaría" en la
 * siguiente sincronización.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SyncCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DOC_VERSION = 2;
  var COLLECTIONS = ['ingredients', 'recipes', 'sales', 'expenses'];

  // Las lápidas se guardan 120 días. Suficiente para que un dispositivo que
  // estuvo mucho tiempo apagado se entere del borrado, sin que el documento
  // crezca para siempre.
  var TOMBSTONE_TTL_MS = 120 * 24 * 60 * 60 * 1000;

  function emptyDoc() {
    return { v: DOC_VERSION, ingredients: [], recipes: [], sales: [], expenses: [], updatedAt: 0 };
  }

  /** JSON con las claves ordenadas: sirve para comparar dos registros de forma estable. */
  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    var keys = Object.keys(value).sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      if (value[keys[i]] === undefined) continue;
      parts.push(JSON.stringify(keys[i]) + ':' + canonical(value[keys[i]]));
    }
    return '{' + parts.join(',') + '}';
  }

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  /**
   * Ordena por id. Suena cosmético y no lo es: sin esto, dos dispositivos con
   * exactamente los mismos datos producen documentos con las listas en distinto
   * orden, o sea bytes distintos. Ordenar deja el documento en forma canónica,
   * y así comparar dos versiones es comparar dos strings.
   * El orden que ve la usuaria (ventas por fecha, etc.) lo decide la interfaz.
   */
  function sortById(list) {
    return list.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  }

  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /**
   * Deja un registro en forma canónica. Los registros viejos (creados antes de
   * que existiera la sincronización) no tienen `updatedAt`; se les pone 1 para
   * que cualquier edición posterior, hecha en cualquier dispositivo, les gane.
   */
  function normalizeRecord(raw) {
    if (!isObject(raw)) return null;
    var rec = {};
    for (var k in raw) if (Object.prototype.hasOwnProperty.call(raw, k)) rec[k] = raw[k];
    if (!rec.id) rec.id = newId();
    rec.id = String(rec.id);
    var t = Number(rec.updatedAt);
    rec.updatedAt = isFinite(t) && t > 0 ? Math.floor(t) : 1;
    rec.deleted = rec.deleted === true;
    return rec;
  }

  function normalizeDoc(raw) {
    var doc = emptyDoc();
    if (!isObject(raw)) return doc;
    for (var c = 0; c < COLLECTIONS.length; c++) {
      var key = COLLECTIONS[c];
      var list = Array.isArray(raw[key]) ? raw[key] : [];
      var byId = Object.create(null);
      for (var i = 0; i < list.length; i++) {
        var rec = normalizeRecord(list[i]);
        if (!rec) continue;
        // Si el mismo id aparece dos veces en la misma lista, gana el mejor.
        var prev = byId[rec.id];
        byId[rec.id] = prev ? pickWinner(prev, rec) : rec;
      }
      doc[key] = sortById(Object.keys(byId).map(function (id) { return byId[id]; }));
    }
    var u = Number(raw.updatedAt);
    doc.updatedAt = isFinite(u) && u > 0 ? Math.floor(u) : 0;
    return doc;
  }

  /**
   * Elige entre dos versiones del MISMO registro.
   * 1. Gana `updatedAt` mayor.
   * 2. Si empatan (mismo milisegundo, rarísimo), gana el JSON canónico mayor.
   *    No es "más correcto", pero es determinista: los dos dispositivos eligen
   *    igual y por eso convergen en vez de pelearse para siempre.
   */
  function pickWinner(a, b) {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
    return canonical(a) >= canonical(b) ? a : b;
  }

  /** Combina dos documentos completos. Conmutativa, asociativa e idempotente. */
  function mergeDocs(localRaw, remoteRaw) {
    var local = normalizeDoc(localRaw);
    var remote = normalizeDoc(remoteRaw);
    var out = emptyDoc();

    for (var c = 0; c < COLLECTIONS.length; c++) {
      var key = COLLECTIONS[c];
      var byId = Object.create(null);
      var side, i, rec;
      for (side = 0; side < 2; side++) {
        var list = side === 0 ? local[key] : remote[key];
        for (i = 0; i < list.length; i++) {
          rec = list[i];
          byId[rec.id] = byId[rec.id] ? pickWinner(byId[rec.id], rec) : rec;
        }
      }
      out[key] = sortById(Object.keys(byId).map(function (id) { return byId[id]; }));
    }

    out.updatedAt = Math.max(local.updatedAt, remote.updatedAt);
    return out;
  }

  /** Quita lápidas antiguas para que el documento no crezca sin límite. */
  function purgeTombstones(doc, now) {
    var cutoff = (now || Date.now()) - TOMBSTONE_TTL_MS;
    for (var c = 0; c < COLLECTIONS.length; c++) {
      var key = COLLECTIONS[c];
      doc[key] = doc[key].filter(function (r) { return !(r.deleted && r.updatedAt < cutoff); });
    }
    return doc;
  }

  /** Los registros que la usuaria realmente ve (sin lápidas). */
  function live(doc, key) {
    var list = (doc && doc[key]) || [];
    return list.filter(function (r) { return !r.deleted; });
  }

  /** Marca un registro como tocado ahora. */
  function touch(rec, now) {
    rec.updatedAt = now || Date.now();
    return rec;
  }

  /** Convierte un registro en lápida, conservando su id. */
  function tombstone(id, now) {
    return { id: String(id), deleted: true, updatedAt: now || Date.now() };
  }

  /**
   * ¿El documento `haystack` ya contiene todo lo que hay en `needle`?
   * El cliente lo usa para confirmar que el servidor recibió sus cambios antes
   * de dar la sincronización por buena. Si no, reintenta.
   */
  function contains(haystack, needle) {
    var hay = normalizeDoc(haystack);
    var need = normalizeDoc(needle);
    for (var c = 0; c < COLLECTIONS.length; c++) {
      var key = COLLECTIONS[c];
      var index = Object.create(null);
      for (var i = 0; i < hay[key].length; i++) index[hay[key][i].id] = hay[key][i];
      for (var j = 0; j < need[key].length; j++) {
        var mine = need[key][j];
        var theirs = index[mine.id];
        if (!theirs) return false;
        if (theirs.updatedAt < mine.updatedAt) return false;
      }
    }
    return true;
  }

  return {
    DOC_VERSION: DOC_VERSION,
    COLLECTIONS: COLLECTIONS,
    TOMBSTONE_TTL_MS: TOMBSTONE_TTL_MS,
    emptyDoc: emptyDoc,
    normalizeDoc: normalizeDoc,
    normalizeRecord: normalizeRecord,
    mergeDocs: mergeDocs,
    purgeTombstones: purgeTombstones,
    pickWinner: pickWinner,
    canonical: canonical,
    live: live,
    touch: touch,
    tombstone: tombstone,
    contains: contains,
    newId: newId,
    sortById: sortById
  };
});
