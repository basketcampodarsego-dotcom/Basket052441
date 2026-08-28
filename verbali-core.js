// ──────────────────────────────────────────────────────────
// FILE: verbali-core.js — ASD Basket Campodarsego
// VERSIONE: v0.1 · 28/08/2026 · BK
// v0.1: creazione — schema dati, numerazione progressiva separata per
//   organo, CRUD base (crea bozza, carica lista, leggi, salva bozza).
//   Step 1/5 del piano approvato da AR (DECISION-AR516-APPROVAZIONE-
//   MODULO-VERBALI-BK, 27/08/2026). Generazione PDF, upload firmato,
//   modalita' storica e collegamento Economia sono step 2-5, non qui.
// Dipende da: basket-core.js (nowStr(), _db, log(), toast()).
// Legge/scrive Firestore: basket052441/verbali/registro/{id}
//   (una collection dedicata, non un documento singolo come
//   economiaConfig — i verbali sono record singoli, non una tabella
//   di codici, quindi seguono il pattern a documenti multipli gia'
//   in uso per basket052441/economia/movimenti).
// Vincoli da AR-516 applicati qui:
//   - numerazione PROGRESSIVO SEPARATO per organo (Direttivo /
//     Assemblea Soci), non un unico contatore — libri sociali distinti.
//   - PDF/firma NON gestiti in questo file (step 2/3, storage sara'
//     Firebase Storage per decisione AR, mai Google Drive).
// ────────────────────────────────────────────────────────────

// ── Schema / costanti (§5 della specifica) ──
var VRB_TIPI = { GENERICO: 'GENERICO', BILANCIO: 'BILANCIO' };
var VRB_ORGANI = { DIRETTIVO: 'DIRETTIVO', ASSEMBLEA_SOCI: 'ASSEMBLEA_SOCI' };
var VRB_STATI = { BOZZA: 'BOZZA', GENERATO: 'GENERATO', FIRMATO: 'FIRMATO' };

var VRB_TIPO_LABEL = { GENERICO: 'Generico', BILANCIO: 'Approvazione Bilancio' };
var VRB_ORGANO_LABEL = { DIRETTIVO: 'Direttivo', ASSEMBLEA_SOCI: 'Assemblea Soci' };
var VRB_STATO_LABEL = { BOZZA: 'Bozza', GENERATO: 'Generato', FIRMATO: 'Firmato' };
var VRB_STATO_COLORI = { BOZZA: '#7a8fa8', GENERATO: '#c8a84b', FIRMATO: '#22a85a' };

// Ordine di avanzamento stato — mai indietro, mai salti (§5: "mai
// indietro, mai cancellazione fisica"). Usato per validare transizioni.
var VRB_STATO_ORDINE = { BOZZA: 0, GENERATO: 1, FIRMATO: 2 };

function vrbStatoAvanzabile(statoAttuale, statoNuovo) {
  if (!VRB_STATO_ORDINE.hasOwnProperty(statoAttuale) || !VRB_STATO_ORDINE.hasOwnProperty(statoNuovo)) {
    console.error('[verbali-core] vrbStatoAvanzabile: stato sconosciuto (' + statoAttuale + ' -> ' + statoNuovo + ')');
    if (typeof log === 'function') log('[verbali-core] transizione stato con valore sconosciuto: ' + statoAttuale + ' -> ' + statoNuovo, 'err');
    return false;
  }
  return VRB_STATO_ORDINE[statoNuovo] === VRB_STATO_ORDINE[statoAttuale] + 1;
}

// ── Numerazione progressiva, SEPARATA per organo (vincolo AR-516) ──
// id finale: VRB-<ORGANO_BREVE>-<ANNO>-<NNNN>, es. VRB-DIR-2026-0001,
// VRB-ASM-2026-0001 — due contatori indipendenti anche nello stesso anno.
var VRB_ORGANO_BREVE = { DIRETTIVO: 'DIR', ASSEMBLEA_SOCI: 'ASM' };

function vrbOrganoBreve(organo) {
  var b = VRB_ORGANO_BREVE[organo];
  if (!b) {
    console.error('[verbali-core] vrbOrganoBreve: organo sconosciuto: ' + organo);
    if (typeof log === 'function') log('[verbali-core] organo sconosciuto per numerazione: ' + organo, 'err');
    return 'XXX';
  }
  return b;
}

// Calcola il prossimo numero progressivo per organo+anno leggendo la
// lista gia' caricata (nessun contatore separato su Firestore: si
// deriva dal massimo esistente, stesso principio robusto-a-derive gia'
// visto altrove nel progetto — evita un secondo documento da tenere
// sincronizzato, a costo di una scansione lato client).
function vrbProssimoNumero(elencoVerbali, organo, anno) {
  var breve = vrbOrganoBreve(organo);
  var prefisso = 'VRB-' + breve + '-' + anno + '-';
  var max = 0;
  (elencoVerbali || []).forEach(function (v) {
    if (v.id && v.id.indexOf(prefisso) === 0) {
      var n = parseInt(v.id.slice(prefisso.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  return prefisso + String(max + 1).padStart(4, '0');
}

// ── CRUD ──
// Tutte le funzioni assumono window._db gia' inizializzato (stesso
// pattern di economia-*: nessuna scrittura silenziosa, ogni fallimento
// va a log()/console.error esplicitamente — R2/nessuna uscita silenziosa).

function vrbCollection() {
  if (!window._db) {
    var msg = '[verbali-core] _db non pronto — Firestore non inizializzato';
    console.error(msg);
    if (typeof log === 'function') log(msg, 'err');
    return null;
  }
  return window._db.collection('basket052441').doc('verbali').collection('registro');
}

// Carica l'intero registro (tutti gli organi/anni) — filtri applicati
// lato client dalla UI, stesso pattern di economia-movimenti-ui.js.
function vrbCaricaLista() {
  var col = vrbCollection();
  if (!col) return Promise.resolve([]);
  return col.get().then(function (snap) {
    var elenco = [];
    snap.forEach(function (doc) { elenco.push(doc.data()); });
    elenco.sort(function (a, b) {
      return (b.dataRedazione || '').localeCompare(a.dataRedazione || '');
    });
    if (typeof log === 'function') log('Verbali: caricati ' + elenco.length + ' record', 'ok');
    return elenco;
  }).catch(function (err) {
    var msg = '[verbali-core] errore caricamento registro: ' + (err && err.message || err);
    console.error(msg, err);
    if (typeof log === 'function') log(msg, 'err');
    throw err;
  });
}

function vrbLeggi(id) {
  var col = vrbCollection();
  if (!col) return Promise.resolve(null);
  return col.doc(id).get().then(function (doc) {
    if (!doc.exists) {
      console.error('[verbali-core] vrbLeggi: id non trovato: ' + id);
      if (typeof log === 'function') log('[verbali-core] verbale non trovato: ' + id, 'err');
      return null;
    }
    return doc.data();
  }).catch(function (err) {
    var msg = '[verbali-core] errore lettura verbale ' + id + ': ' + (err && err.message || err);
    console.error(msg, err);
    if (typeof log === 'function') log(msg, 'err');
    throw err;
  });
}

// Crea un nuovo verbale in stato BOZZA. `dati` deve contenere almeno
// tipo/organo/dataRiunione/luogo — dataRedazione e' SEMPRE oggi, mai
// passata come parametro (§5: "mai modificabile a posteriori", stesso
// principio anche alla creazione: non si finge una data di redazione).
function vrbCreaBozza(dati, elencoEsistente) {
  var col = vrbCollection();
  if (!col) return Promise.reject(new Error('Firestore non pronto'));
  if (!dati || !VRB_TIPI[dati.tipo] || !VRB_ORGANI[dati.organo]) {
    var msgVal = '[verbali-core] vrbCreaBozza: tipo/organo mancante o non valido';
    console.error(msgVal, dati);
    if (typeof log === 'function') log(msgVal, 'err');
    return Promise.reject(new Error('tipo/organo mancante o non valido'));
  }
  var anno = (dati.dataRiunione || new Date().toISOString().slice(0, 10)).slice(0, 4);
  var id = vrbProssimoNumero(elencoEsistente || [], dati.organo, anno);
  var record = {
    id: id,
    tipo: dati.tipo,
    organo: dati.organo,
    stato: VRB_STATI.BOZZA,
    dataRedazione: new Date().toISOString().slice(0, 10),
    dataRiunione: dati.dataRiunione || '',
    luogo: dati.luogo || '',
    oraInizio: dati.oraInizio || '',
    oraFine: '',
    retroattivo: !!dati.retroattivo,
    allegatoBilancioUrl: dati.allegatoBilancioUrl || '',
    dataProtocolloComune: dati.dataProtocolloComune || '',
    presenti: dati.presenti || [],
    assenti: dati.assenti || [],
    ordineDelGiorno: dati.ordineDelGiorno || [],
    annoEsercizioRif: dati.annoEsercizioRif || '',
    pdfGeneratoUrl: '',
    pdfFirmatoUrl: '',
    dataFirma: '',
    firmatari: [],
    tipoFirmaDichiarato: ''  // FEQ|FEA|autografa — campo dichiarativo richiesto da AR-516 punto 2, valorizzato all'upload (step 3)
  };
  return col.doc(id).set(record).then(function () {
    if (typeof log === 'function') log('Verbale ' + id + ' creato (BOZZA)', 'ok');
    return record;
  }).catch(function (err) {
    var msg = '[verbali-core] errore creazione verbale: ' + (err && err.message || err);
    console.error(msg, err);
    if (typeof log === 'function') log(msg, 'err');
    throw err;
  });
}

// Salva modifiche a un verbale ANCORA in BOZZA (§3.1: "modificabile
// liberamente finche' non e' generato il PDF definitivo"). Rifiuta
// esplicitamente se lo stato non e' BOZZA — mai un edit silenzioso su
// un verbale gia' generato/firmato (§3.2, stesso principio dei
// movimenti Economia gia' in vigore nel progetto).
function vrbSalvaBozza(id, campiAggiornati) {
  var col = vrbCollection();
  if (!col) return Promise.reject(new Error('Firestore non pronto'));
  return col.doc(id).get().then(function (doc) {
    if (!doc.exists) {
      var msgNf = '[verbali-core] vrbSalvaBozza: id non trovato: ' + id;
      console.error(msgNf);
      if (typeof log === 'function') log(msgNf, 'err');
      throw new Error('Verbale non trovato: ' + id);
    }
    var attuale = doc.data();
    if (attuale.stato !== VRB_STATI.BOZZA) {
      var msgBlk = '[verbali-core] vrbSalvaBozza RIFIUTATO: verbale ' + id + ' e\' in stato ' + attuale.stato + ', non piu\' modificabile';
      console.error(msgBlk);
      if (typeof log === 'function') log(msgBlk, 'err');
      throw new Error('Verbale non piu\' modificabile (stato ' + attuale.stato + ')');
    }
    // Campi immutabili anche in BOZZA: id, tipo, organo, dataRedazione,
    // stato (quest'ultimo cambia solo via una funzione di transizione
    // dedicata nello step 2, non da qui).
    var protetti = ['id', 'tipo', 'organo', 'dataRedazione', 'stato'];
    var patch = {};
    Object.keys(campiAggiornati || {}).forEach(function (k) {
      if (protetti.indexOf(k) === -1) patch[k] = campiAggiornati[k];
    });
    return col.doc(id).update(patch);
  }).then(function () {
    if (typeof log === 'function') log('Verbale ' + id + ' aggiornato', 'ok');
  }).catch(function (err) {
    console.error('[verbali-core] errore salvataggio bozza ' + id, err);
    if (typeof log === 'function' && !/non piu' modificabile|non trovato/.test(err.message || '')) {
      log('[verbali-core] errore salvataggio bozza ' + id + ': ' + (err && err.message || err), 'err');
    }
    throw err;
  });
}

window.addEventListener('error', function (e) {
  var msg = '[verbali-core] errore non gestito: ' + (e.error && e.error.message || e.message);
  console.error(msg);
  if (typeof log === 'function') log(msg, 'err');
});
window.addEventListener('unhandledrejection', function (e) {
  var msg = '[verbali-core] promise non gestita: ' + (e.reason && e.reason.message || e.reason);
  console.error(msg);
  if (typeof log === 'function') log(msg, 'err');
});
