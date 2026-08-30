// ────────────────────────────────────────────────────────────
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
    pdfFirmatoBase64: '',  // valorizzato solo all'upload del firmato (step 3) — il PDF generato non si salva, si rigenera al volo
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

// ────────────────────────────────────────────────────────────
// v0.2 · 28/08/2026 · BK — step 2/5: contenuto verbale, generazione PDF,
// upload Firebase Storage, transizione di stato autorizzata, collegamento
// Economia per il modello BILANCIO (§3.4/§4 della specifica).
// Richiede in basket052441-admin.html, oltre a quanto già presente:
//   <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-storage-compat.js"></script>
// caricato DOPO firebase-app-compat.js, PRIMA di questo file.
// ────────────────────────────────────────────────────────────

var VRB_NUMERO_CONVOCAZIONE = { PRIMA: 'PRIMA', SECONDA: 'SECONDA' };
var VRB_ESITO_VOTO = { UNANIMITA: 'UNANIMITA', MAGGIORANZA: 'MAGGIORANZA' };

// Testo standard di constatazione quorum (§4.1) — parametrico sul fatto
// che il quorum sia raggiunto o meno, mai un unico testo che nasconde
// il caso "sotto quorum".
// ── Modalità storica / retroattiva (§3.5) ──
// Genera il testo SUGGERITO (non fisso: resta sempre modificabile
// nell'editor) per la delibera di un verbale retroattivo di tipo
// BILANCIO — formula esplicita e onesta ("verbale redatto oggi a
// ricostruzione di una decisione informale passata"), mai una finzione
// di data. Basata sul caso reale che ha motivato questa sezione: bilanci
// veri e depositati dal 2009, mai formalmente verbalizzati.
function vrbTestoRicostruzioneStorica(anno, dataProtocolloComune, presenti) {
  var elencoSoci = (presenti || []).length ? (presenti || []).join(', ') : '[nomi dei soci presenti]';
  var riferimentoProtocollo = dataProtocolloComune
    ? ' al Comune di Campodarsego in data ' + dataProtocolloComune
    : ' al Comune di Campodarsego';
  return 'Verbale redatto in data odierna, a ricostruzione della decisione assunta dai soci in forma ' +
    'informale, antecedente alla presentazione del bilancio dell\'esercizio ' + anno +
    riferimentoProtocollo + '. Erano presenti i soci: ' + elencoSoci +
    '. I soci hanno esaminato e approvato all\'unanimità il bilancio consuntivo dell\'esercizio ' +
    anno + ', di cui si allega copia.';
}

function vrbTestoQuorum(numPresenti, numTotaleAventiDiritto, quorumRaggiunto) {
  if (quorumRaggiunto) {
    return 'Constatata la presenza di ' + numPresenti + ' su ' + numTotaleAventiDiritto +
      ' aventi diritto, il Presidente dichiara valida la riunione.';
  }
  return 'ATTENZIONE: presenti ' + numPresenti + ' su ' + numTotaleAventiDiritto +
    ' aventi diritto — quorum NON raggiunto. Nota da valutare prima della generazione del PDF definitivo.';
}

// ── Collegamento Economia (§3.4, solo tipo BILANCIO) ──
// Riusa ESATTAMENTE ecoRepCalcola() di economia-report-ui.js (stessa
// funzione pura già usata dal Report Bilancio a schermo) — mai un
// ricalcolo separato, come richiesto esplicitamente dalla specifica.
// Le uniche letture Firestore qui sono le stesse che fa ecoRepGenera()
// per popolare quella funzione pura, non un percorso dati alternativo.
function vrbBilancioTotali(anno) {
  if (typeof ecoRepCalcola !== 'function') {
    var msgFn = '[verbali-core] vrbBilancioTotali: ecoRepCalcola non disponibile (economia-report-ui.js mancante/non ancora caricato) — impossibile collegare i totali senza ricalcolarli separatamente, cosa vietata dalla specifica';
    console.error(msgFn);
    if (typeof log === 'function') log(msgFn, 'err');
    return Promise.reject(new Error('Modulo Economia non disponibile: impossibile recuperare i totali'));
  }
  if (!window._db) {
    var msgDb = '[verbali-core] vrbBilancioTotali: _db non pronto';
    console.error(msgDb);
    if (typeof log === 'function') log(msgDb, 'err');
    return Promise.reject(new Error('Firestore non pronto'));
  }
  var col = window._db.collection('basket052441');
  return Promise.all([
    col.doc('economiaConfig').get(),
    col.doc('economia').collection('movimenti').get()
  ]).then(function (res) {
    var config = { categorie: [], sottocategorie: [], centriCosto: [] };
    if (res[0].exists && res[0].data().v) {
      try {
        var parsed = JSON.parse(res[0].data().v);
        if (parsed && typeof parsed === 'object') config = parsed;
      } catch (ex) {
        var msgParse = '[verbali-core] vrbBilancioTotali: errore parsing economiaConfig: ' + ex.message;
        console.error(msgParse, ex);
        if (typeof log === 'function') log(msgParse, 'err');
        // Non blocco: ecoRepCalcola gestisce config vuoto restituendo comunque
        // i totali corretti (categorie/nomi non risolti, ma cifre giuste).
      }
    }
    var tutti = [];
    res[1].forEach(function (doc) { tutti.push(doc.data()); });
    var movimenti = tutti.filter(function (m) { return parseInt(m.annoEsercizio, 10) === parseInt(anno, 10); });
    if (!movimenti.length) {
      var msgVuoto = '[verbali-core] vrbBilancioTotali: nessun movimento trovato per l\'esercizio ' + anno + ' — Bilancio non ancora generato/consultato per questo anno';
      console.error(msgVuoto);
      if (typeof log === 'function') log(msgVuoto, 'err');
      return Promise.reject(new Error('Nessun movimento registrato per l\'esercizio ' + anno + ' — genera prima il Bilancio in Economia'));
    }
    var dati = ecoRepCalcola(movimenti, config);
    if (typeof log === 'function') log('Verbali: totali Bilancio ' + anno + ' recuperati da Economia (' + movimenti.length + ' movimenti)', 'ok');
    return { totEntrate: dati.totEntrate, totUscite: dati.totUscite, saldoEsercizio: dati.saldoEsercizio };
  }).catch(function (err) {
    if (!/Nessun movimento|non disponibile|non pronto/.test(err.message || '')) {
      var msg = '[verbali-core] errore recupero totali Bilancio: ' + (err && err.message || err);
      console.error(msg, err);
      if (typeof log === 'function') log(msg, 'err');
    }
    throw err;
  });
}

// ── Transizione di stato autorizzata (bypassa il blocco BOZZA-only di
// vrbSalvaBozza, che è per modifiche di contenuto normali) ──
// Unico punto che può cambiare `stato` dopo la creazione — valida sempre
// con vrbStatoAvanzabile prima di scrivere (mai indietro, mai salti, §5).
function vrbTransizionaStato(id, nuovoStato, patchExtra) {
  var col = vrbCollection();
  if (!col) return Promise.reject(new Error('Firestore non pronto'));
  return col.doc(id).get().then(function (doc) {
    if (!doc.exists) {
      var msgNf = '[verbali-core] vrbTransizionaStato: id non trovato: ' + id;
      console.error(msgNf);
      if (typeof log === 'function') log(msgNf, 'err');
      throw new Error('Verbale non trovato: ' + id);
    }
    var attuale = doc.data();
    if (!vrbStatoAvanzabile(attuale.stato, nuovoStato)) {
      var msgBlk = '[verbali-core] vrbTransizionaStato RIFIUTATA: ' + id + ' da ' + attuale.stato + ' a ' + nuovoStato + ' non è una transizione valida';
      console.error(msgBlk);
      if (typeof log === 'function') log(msgBlk, 'err');
      throw new Error('Transizione di stato non valida: ' + attuale.stato + ' → ' + nuovoStato);
    }
    var patch = Object.assign({}, patchExtra || {}, { stato: nuovoStato });
    return col.doc(id).update(patch);
  }).then(function () {
    if (typeof log === 'function') log('Verbale ' + id + ': transizione a ' + nuovoStato + ' completata', 'ok');
  }).catch(function (err) {
    console.error('[verbali-core] errore transizione stato ' + id, err);
    if (typeof log === 'function' && !/non trovato|non valida/.test(err.message || '')) {
      log('[verbali-core] errore transizione stato ' + id + ': ' + (err && err.message || err), 'err');
    }
    throw err;
  });
}

// ── Firebase Storage ──
// ────────────────────────────────────────────────────────────
// v0.3 · 29/08/2026 · BK — rimossa dipendenza da Firebase Storage
// (richiede piano Blaze anche a costo zero da ottobre 2024, dal
// 02/02/2026 blocca l'accesso del tutto senza Blaze — riscontrato in
// produzione: storage/retry-limit-exceeded). Segnalato ad AR
// (260829_COM_BK_AR_VerbaliStorageSenzaBlaze.yaml), resta dentro
// Firebase quindi non tocca il vincolo "mai Google Drive" di AR-516.
//
// PDF GENERATO (step2): non più salvato da nessuna parte. Si rigenera
// al volo dai dati del verbale (già bloccati in Firestore non appena
// esce da BOZZA) ogni volta che serve — stesso principio già in uso
// per il Bilancio di Economia (funzione pura + dati, mai un artefatto
// persistito separatamente che potrebbe disallinearsi dai dati).
//
// PDF FIRMATO (step3): NON rigenerabile (la firma digitale è legata ai
// byte esatti del file prodotto dallo strumento di firma esterno).
// Salvato come base64 in un campo del documento Firestore del verbale
// stesso — stessa collection, stesse regole di sicurezza già in vigore,
// nessun bucket esterno. Limite Firestore: 1MB per documento. Soglia di
// sicurezza esplicita più sotto (VRB_MAX_BASE64_FIRMATO): oltre quella
// il caricamento è RIFIUTATO con errore chiaro, mai un troncamento
// silenzioso o un salvataggio parziale.
// ────────────────────────────────────────────────────────────

// ── Generazione PDF (§3.2) — costruisce, non salva: il PDF generato
// (a differenza del firmato) si rigenera sempre dai dati, non serve
// persisterlo. ──
function vrbGeneraPdfBlob(record) {
  if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF !== 'function') {
    var msg = '[verbali-core] vrbGeneraPdfBlob: libreria jsPDF non disponibile';
    console.error(msg);
    if (typeof log === 'function') log(msg, 'err');
    throw new Error('Libreria PDF non disponibile');
  }
  var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  var y = 20;
  var margine = 20;
  var largh = 210 - margine * 2;

  function riga(testo, opts) {
    opts = opts || {};
    var size = opts.size || 11;
    var stile = opts.stile || 'normal';
    doc.setFont('helvetica', stile);
    doc.setFontSize(size);
    var linee = doc.splitTextToSize(testo, largh);
    linee.forEach(function (l) {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.text(l, margine, y);
      y += size * 0.5;
    });
    y += 2;
  }

  riga('A.S.D. Basket Campodarsego', { size: 15, stile: 'bold' });
  riga((VRB_ORGANO_LABEL[record.organo] || record.organo) + ' — Verbale n. ' + record.id, { size: 12, stile: 'bold' });
  y += 2;

  if (record.retroattivo) {
    riga('VERBALE STORICO / RETROATTIVO', { size: 10, stile: 'bold' });
    if (record.dataProtocolloComune) riga('Bilancio depositato al Comune in data: ' + record.dataProtocolloComune, { size: 10 });
    if (record.allegatoBilancioUrl) riga('Allegato: copia del bilancio consuntivo storico (' + record.allegatoBilancioUrl + ')', { size: 10 });
  }

  riga('Data redazione: ' + record.dataRedazione + '    Data riunione: ' + (record.dataRiunione || '—'));
  riga('Luogo: ' + (record.luogo || '—') + '    Convocazione: ' + (VRB_NUMERO_CONVOCAZIONE[record.numeroConvocazione] ? record.numeroConvocazione.toLowerCase() : '—'));
  riga('Ora inizio: ' + (record.oraInizio || '—') + '    Ora chiusura: ' + (record.oraFine || '—'));
  y += 2;

  riga('Presenti: ' + ((record.presenti || []).join(', ') || '—'));
  riga('Assenti: ' + ((record.assenti || []).join(', ') || '—'));
  y += 2;

  if (record.quorumNota) riga(record.quorumNota, { size: 10 });
  y += 3;

  riga('Ordine del giorno e delibere', { size: 12, stile: 'bold' });
  (record.ordineDelGiorno || []).forEach(function (p, i) {
    riga((i + 1) + '. ' + (p.testo || ''), { stile: 'bold' });
    if (p.discussione) riga('Discussione: ' + vrbStripHtml(p.discussione), { size: 10 });
    if (p.delibera) riga('Delibera: ' + vrbStripHtml(p.delibera), { size: 10 });
    if (p.esitoVoto) {
      var ev = p.esitoVoto;
      var testoVoto = ev.tipo === 'UNANIMITA' ? 'Approvato all\'unanimità.' :
        'Esito voto: favorevoli ' + (ev.favorevoli || 0) + ', contrari ' + (ev.contrari || 0) + ', astenuti ' + (ev.astenuti || 0) + '.';
      riga(testoVoto, { size: 10 });
    }
    y += 2;
  });

  if (record.tipo === 'BILANCIO') {
    riga('Riepilogo cifre — esercizio ' + (record.annoEsercizioRif || '—'), { size: 11, stile: 'bold' });
    if (record.totaliBilancioTesto) {
      riga(record.totaliBilancioTesto, { size: 10 });
    } else {
      riga('ATTENZIONE: totali non recuperati da Economia al momento della generazione.', { size: 10, stile: 'bold' });
    }
    if (record.confrontoAnnoPrecedenteTesto) riga(record.confrontoAnnoPrecedenteTesto, { size: 10 });
    y += 2;
    if (record.relazioneTesoriere) { riga('Relazione del tesoriere', { size: 11, stile: 'bold' }); riga(vrbStripHtml(record.relazioneTesoriere), { size: 10 }); }
    if (record.osservazioniSoci) { riga('Osservazioni dei soci', { size: 11, stile: 'bold' }); riga(vrbStripHtml(record.osservazioniSoci), { size: 10 }); }
    if (record.destinazioneAvanzo) { riga('Destinazione avanzo di gestione', { size: 11, stile: 'bold' }); riga(vrbStripHtml(record.destinazioneAvanzo), { size: 10 }); }
  }

  y += 8;
  riga('Il Presidente: ' + (record.presidente || '_______________________'));
  y += 6;
  riga('Il Segretario verbalizzante: ' + (record.segretario || '_______________________'));

  return doc.output('blob');
}

function vrbStripHtml(html) {
  var tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return tmp.textContent || tmp.innerText || '';
}

// Apre il PDF generato al volo in una nuova scheda/finestra — nessun
// salvataggio, il blob esiste solo per la durata di questa chiamata.
// Se il popup viene bloccato dal browser, l'errore va segnalato
// esplicitamente (mai un click che "non fa nulla" senza spiegazione).
function vrbVisualizzaPdfGenerato(record) {
  var blob;
  try {
    blob = vrbGeneraPdfBlob(record);
  } catch (e) {
    if (typeof log === 'function') log('[verbali-core] errore generazione PDF per visualizzazione: ' + (e && e.message || e), 'err');
    throw e;
  }
  var url = URL.createObjectURL(blob);
  var win = window.open(url, '_blank');
  if (!win) {
    var msg = '[verbali-core] vrbVisualizzaPdfGenerato: popup bloccato dal browser';
    console.error(msg);
    if (typeof log === 'function') log(msg, 'err');
    throw new Error('Il browser ha bloccato l\'apertura del PDF (popup). Consenti i popup per questo sito e riprova.');
  }
  // Non revoco l'URL subito: la finestra aperta deve poter ancora
  // caricare il blob. Il browser lo libera comunque alla chiusura tab.
}

// Transizione BOZZA -> GENERATO. Genera il PDF una volta solo per
// VALIDARE che i dati producano un documento senza errori (mai
// bloccare il contenuto se poi il PDF non si può nemmeno costruire),
// ma non lo salva da nessuna parte — si rigenera sempre al bisogno.
function vrbAvanzaAGenerato(id, record) {
  try {
    vrbGeneraPdfBlob(record); // solo validazione, risultato scartato di proposito
  } catch (e) {
    return Promise.reject(e);
  }
  return vrbTransizionaStato(id, VRB_STATI.GENERATO, {});
}

// ── Caricamento PDF firmato (§3.3, step 3) ──
// Verifica SOLO strutturale (magic bytes %PDF + presenza indicatore di
// firma incorporata) — MAI una verifica crittografica completa, che la
// specifica demanda esplicitamente a strumenti esterni dedicati.
function vrbVerificaStrutturaPdfFirmato(arrayBuffer) {
  var bytes = new Uint8Array(arrayBuffer.slice(0, 5));
  var header = String.fromCharCode.apply(null, bytes);
  if (header !== '%PDF-') {
    return { valido: false, motivo: 'Il file non inizia con l\'intestazione %PDF — non è un PDF valido.' };
  }
  // Ricerca euristica di indicatori di firma digitale incorporata
  // (PAdES/ByteRange) nell'intero file — falsi negativi possibili su
  // file molto grandi con firma in una posizione non scansionata, ma
  // sufficiente come controllo di primo livello dichiarato in spec.
  var testo = '';
  var view = new Uint8Array(arrayBuffer);
  var chunk = 65536;
  for (var i = 0; i < view.length; i += chunk) {
    testo += String.fromCharCode.apply(null, view.subarray(i, Math.min(i + chunk, view.length)));
  }
  var haFirma = testo.indexOf('/ByteRange') > -1 && testo.indexOf('/Sig') > -1;
  if (!haFirma) {
    return { valido: false, motivo: 'Il PDF non sembra contenere una firma digitale incorporata (nessun /ByteRange e /Sig trovati). Verifica di aver caricato il file dopo la firma, non l\'originale non firmato.' };
  }
  return { valido: true, motivo: '' };
}

// Soglia di sicurezza per il base64 del PDF firmato dentro il documento
// Firestore (limite reale del documento: 1MB, ~1'048'576 byte). Tenuta
// volutamente sotto meta' del limite per lasciare margine agli altri
// campi del verbale (testi ordine del giorno, ecc.) — non è un limite
// arbitrario stretto, è per evitare di sforare il limite reale di
// Firestore in modo silenzioso in casi limite.
var VRB_MAX_BASE64_FIRMATO = 700000; // ~525KB di file PDF originale

function vrbCaricaFirmato(id, file, metadati) {
  return file.arrayBuffer().then(function (buf) {
    var check = vrbVerificaStrutturaPdfFirmato(buf);
    if (!check.valido) {
      var msg = '[verbali-core] vrbCaricaFirmato: verifica strutturale fallita per ' + id + ': ' + check.motivo;
      console.error(msg);
      if (typeof log === 'function') log(msg, 'err');
      return Promise.reject(new Error(check.motivo));
    }
    var base64 = vrbArrayBufferToBase64(buf);
    if (base64.length > VRB_MAX_BASE64_FIRMATO) {
      var msgSize = '[verbali-core] vrbCaricaFirmato: PDF firmato troppo grande per ' + id +
        ' (' + Math.round(buf.byteLength / 1024) + 'KB, limite ~' + Math.round(VRB_MAX_BASE64_FIRMATO * 0.75 / 1024) + 'KB) — Firestore ha un limite di 1MB per documento';
      console.error(msgSize);
      if (typeof log === 'function') log(msgSize, 'err');
      return Promise.reject(new Error('Il PDF firmato è troppo grande (' + Math.round(buf.byteLength / 1024) +
        'KB) per essere salvato in questo modo — limite pratico ~' + Math.round(VRB_MAX_BASE64_FIRMATO * 0.75 / 1024) +
        'KB. Contatta BK per una soluzione di storage alternativa per questo caso.'));
    }
    return base64;
  }).then(function (base64) {
    var patch = {
      pdfFirmatoBase64: base64,
      dataFirma: new Date().toISOString().slice(0, 10),
      firmatari: (metadati && metadati.firmatari) || [],
      tipoFirmaDichiarato: (metadati && metadati.tipoFirmaDichiarato) || ''
    };
    return vrbTransizionaStato(id, VRB_STATI.FIRMATO, patch);
  });
}

function vrbArrayBufferToBase64(buf) {
  var bytes = new Uint8Array(buf);
  var chunk = 32768; // evita stack overflow su String.fromCharCode.apply con file grandi
  var binario = '';
  for (var i = 0; i < bytes.length; i += chunk) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binario);
}

// Apre il PDF firmato (decodificato dal base64 salvato in Firestore)
// in una nuova scheda — stesso pattern di vrbVisualizzaPdfGenerato.
function vrbVisualizzaPdfFirmato(base64) {
  if (!base64) {
    var msg = '[verbali-core] vrbVisualizzaPdfFirmato: nessun base64 fornito';
    console.error(msg);
    if (typeof log === 'function') log(msg, 'err');
    throw new Error('Nessun PDF firmato salvato per questo verbale.');
  }
  var binario = atob(base64);
  var bytes = new Uint8Array(binario.length);
  for (var i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  var blob = new Blob([bytes], { type: 'application/pdf' });
  var url = URL.createObjectURL(blob);
  var win = window.open(url, '_blank');
  if (!win) {
    var msgPopup = '[verbali-core] vrbVisualizzaPdfFirmato: popup bloccato dal browser';
    console.error(msgPopup);
    if (typeof log === 'function') log(msgPopup, 'err');
    throw new Error('Il browser ha bloccato l\'apertura del PDF (popup). Consenti i popup per questo sito e riprova.');
  }
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

