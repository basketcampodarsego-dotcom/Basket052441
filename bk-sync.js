// ════════════════════════════════════════════════════════
// FILE: bk-sync.js — ASD Basket Campodarsego
// VERSIONE: v0.1 · 20/11/2026 10:00 · BK
// v0.1: PROTEZIONE DEI SALVATAGGI (richiesta Alberto 20/11/2026: il dittafono
//   deve poter aggiornare il gestionale). Prima: saveDB riscriveva le 6 sezioni
//   (atleti, pagamenti, ...) con la copia in memoria -> una modifica fatta da
//   un'altra pagina nel frattempo veniva cancellata in silenzio.
//   Ora ogni pagina ricorda la versione letta ("base") di ogni sezione e salva
//   in TRANSAZIONE solo le sezioni cambiate:
//   - se nel database c'e' ancora la base -> scrive la sua versione;
//   - se qualcun altro ha scritto nel frattempo -> UNISCE elemento per
//     elemento (atleta per atleta, pagamenti per atleta, ...): tiene le
//     modifiche di tutti e due; se lo STESSO elemento e' stato cambiato da
//     entrambi, tiene quello del database e lo segnala (mai in silenzio).
// Usato da: basket-core.js (saveDB), basket052441-admin.html (salvaSezione),
//   dittafono.js (bkModificaSezione). Nessuna dipendenza.
// ════════════════════════════════════════════════════════

var BK_SYNC_VERSIONE = 'v0.1 · 20/11/2026 10:00';
var BK_BASI = {}; // sezione -> stringa JSON letta/scritta per ultima da questa pagina
// Chiave degli elementi per sezione (per unire elemento per elemento).
var BK_CHIAVI = {
  atleti: 'id', allenamenti: 'id', ricevute: 'numero',
  presenze: function (x) { return x && x.aid + '|' + x.atid; }
};

function bkRegistraBase(sez, stringaJson) { BK_BASI[sez] = stringaJson; }

// La chiave vale solo se presente e UNICA dentro ciascuna delle versioni (base, locale, remota).
function _bkChiaveFn(sez, versioni) {
  var k = BK_CHIAVI[sez];
  var fn = typeof k === 'function' ? k : (k ? function (x) { return x && x[k]; } : null);
  if (fn) {
    var ok = versioni.every(function (arr) {
      var visti = {};
      return arr.every(function (x) { var c = fn(x); if (c === undefined || c === null || visti['k' + c]) return false; visti['k' + c] = 1; return true; });
    });
    if (ok) return function (x) { return 'k' + fn(x); };
  }
  return function (x) { return 's' + JSON.stringify(x); }; // senza chiave: l'elemento stesso
}

// Unione a tre vie. Ritorna { valore, conflitti: [descrizioni] }.
function bkUnisci3(sez, base, locale, remoto) {
  var S = function (x) { return x === undefined ? '∅' : JSON.stringify(x); };
  if (S(locale) === S(remoto)) return { valore: remoto, conflitti: [] };
  if (S(locale) === S(base)) return { valore: remoto, conflitti: [] };
  if (S(remoto) === S(base)) return { valore: locale, conflitti: [] };
  var conflitti = [];
  var scegli = function (b, l, r, nome) {
    if (S(l) === S(r) || S(l) === S(b)) return r;
    if (S(r) === S(b)) return l;
    conflitti.push(nome); return r;
  };
  if (Array.isArray(base || []) && Array.isArray(locale) && Array.isArray(remoto)) {
    var b = base || [];
    var key = _bkChiaveFn(sez, [b, locale, remoto]);
    var mappa = function (a) { var m = {}; a.forEach(function (x) { m[key(x)] = x; }); return m; };
    var mb = mappa(b), ml = mappa(locale), mr = mappa(remoto);
    var ordine = remoto.map(key);
    locale.forEach(function (x) { var k = key(x); if (ordine.indexOf(k) < 0) ordine.push(k); });
    var out = [];
    ordine.forEach(function (k) {
      var v = scegli(mb[k], ml[k], mr[k], _bkNomeElemento(ml[k] || mr[k] || mb[k], k));
      if (v !== undefined) out.push(v);
    });
    return { valore: out, conflitti: conflitti };
  }
  var isObj = function (x) { return x && typeof x === 'object' && !Array.isArray(x); };
  if (isObj(locale) && isObj(remoto) && (base === undefined || isObj(base))) {
    var bo = base || {}, res = {};
    var chiavi = Object.keys(remoto).concat(Object.keys(locale).filter(function (k) { return !(k in remoto); }));
    chiavi.forEach(function (k) { var v = scegli(bo[k], locale[k], remoto[k], sez + ' ' + k); if (v !== undefined) res[k] = v; });
    return { valore: res, conflitti: conflitti };
  }
  return { valore: remoto, conflitti: [sez + ' (intera sezione)'] };
}
function _bkNomeElemento(x, k) {
  if (x && x.cog) return (x.cog + ' ' + (x.nom || '')).trim();
  if (x && x.numero) return 'n. ' + x.numero;
  return k.slice(0, 40);
}

// Salva in transazione le sezioni indicate ({sez: valoreLocale}).
// Ritorna Promise<{ scritte:[sez], valori:{sez:valoreFinale}, conflitti:{sez:[..]}, unite:[sez] }>.
function bkSalvaSezioni(db, sezioni, autore) {
  var col = db.collection('basket052441');
  var nomi = Object.keys(sezioni);
  var esito = { scritte: [], valori: {}, conflitti: {}, unite: [] };
  return db.runTransaction(function (tx) {
    esito.scritte = []; esito.valori = {}; esito.conflitti = {}; esito.unite = [];
    return Promise.all(nomi.map(function (s) { return tx.get(col.doc(s)); })).then(function (docs) {
      docs.forEach(function (d, i) {
        var sez = nomi[i], loc = sezioni[sez], locStr = JSON.stringify(loc);
        var remStr = d.exists && d.data() && d.data().v != null ? d.data().v : undefined;
        var base = BK_BASI[sez], finale = loc;
        if (remStr !== undefined && base !== undefined && remStr !== base) {
          var rem = JSON.parse(remStr), bas = JSON.parse(base);
          var u = bkUnisci3(sez, bas, loc, rem);
          finale = u.valore; esito.unite.push(sez);
          if (u.conflitti.length) esito.conflitti[sez] = u.conflitti;
        } else if (remStr !== undefined && base === undefined && remStr !== locStr && typeof console !== 'undefined') {
          console.warn('[bk-sync] ' + sez + ': versione letta sconosciuta, salvo la copia locale');
        }
        var finStr = JSON.stringify(finale);
        esito.valori[sez] = finale;
        if (finStr !== remStr) { tx.set(col.doc(sez), { v: finStr, ts: new Date().toISOString(), da: autore || '' }); esito.scritte.push(sez); }
      });
    });
  }).then(function () {
    Object.keys(esito.valori).forEach(function (s) { BK_BASI[s] = JSON.stringify(esito.valori[s]); });
    return esito;
  });
}

// Legge una sezione, la modifica con fn(valore) -> nuovo valore, la riscrive. Una sola transazione.
// Se il database cambia nel frattempo, Firestore ripete fn sui dati nuovi: fn deve essere ripetibile.
function bkModificaSezione(db, sez, fn, autore) {
  var ref = db.collection('basket052441').doc(sez), nuovo;
  return db.runTransaction(function (tx) {
    return tx.get(ref).then(function (d) {
      var cur = d.exists && d.data() && d.data().v != null ? JSON.parse(d.data().v) : undefined;
      nuovo = fn(cur);
      if (nuovo === undefined) throw new Error('modifica di ' + sez + ' non applicabile');
      tx.set(ref, { v: JSON.stringify(nuovo), ts: new Date().toISOString(), da: autore || '' });
    });
  }).then(function () { return nuovo; });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { bkUnisci3: bkUnisci3, bkSalvaSezioni: bkSalvaSezioni, bkModificaSezione: bkModificaSezione, bkRegistraBase: bkRegistraBase, BK_BASI: BK_BASI };
