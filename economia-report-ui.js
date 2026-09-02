// ════════════════════════════════════════════════════════
// FILE: economia-report-ui.js — ASD Basket Campodarsego
// VERSIONE: v1.3 · 02/09/2026 · BK
// v1.3: aggiunta sezione "Liquidità conti" al Bilancio (ecoRepCalcolaLiquidita
//   + blockLiquidita in ecoRepBuildHtml) — richiesta Alberto: "un bilancio
//   che si rispetti ti dice quanti soldi hai all'inizio, quanto sono
//   entrate/uscite, quanto ti resta alla fine". Saldo di apertura per conto
//   = c.saldoInizialeEsercizio[anno] se dichiarato esplicitamente, altrimenti
//   calcolato sommando lo storico di tutti gli anni precedenti (nessun
//   inserimento manuale necessario per gli anni storici importati).
// v1.2: aggiunta ecoMovEsportaCSV() + bottone "Esporta CSV" nel Registro
//   Movimenti (richiesta Alberto: liste costi/ricavi per centro di costo
//   utilizzabili fuori dall'app, es. offerte amministrative). Esporta
//   sempre gli stessi risultati filtrati già mostrati a schermo
//   (window._ecoMovRisultati), mai un ricalcolo separato.
// v1.1 · 23/08/2026: aggiunta ecoRepSoloAttivi()/ecoCodiciAttivi() in
//   ecoMovPopolaFiltriCodici() — le select filtro Movimenti mostrano solo
//   codici attivi (i disattivati restavano in lista, "fastidio").
// v1.0 · 22/08/2026: creazione — Report Bilancio (eco-04): saldi per
//   centro di costo, per categoria, dettaglio per sottocategoria. Vista a
//   schermo + stampabile con logo.
// Dipende da: economia-core-DRAFT.js (nessuna funzione pura specifica qui,
// calcolo self-contained) e da funzioni già in basket-core.js: nowStr(),
// _apriStampa(), _LOGO_B64.
// Legge Firestore direttamente (sola lettura): basket052441/economiaConfig
// e basket052441/economia/movimenti — stessa struttura dati di
// economia-movimenti-ui.js, nessuna scrittura da qui.
// ════════════════════════════════════════════════════════

var ecoRepAnno = new Date().getFullYear();

// ── Dispatcher tab Economia: aggiunge "Bilancio" come 4a sezione senza
// toccare ecoMostraTab/ecoRenderTab di economia-admin-ui.js (che gestiscono
// solo le 3 tabelle di codici) — zero rischio di regressione su quelle. ──
function ecoMostraSezione(sezione) {
  var isBilancio = (sezione === 'bilancio');
  var isMovimenti = (sezione === 'movimenti');
  var isReport = isBilancio || isMovimenti;
  var elTabContent = document.getElementById('eco-tab-content');
  var elSeedBar = document.getElementById('eco-seed-bar');
  var elBilancioWrap = document.getElementById('eco-bilancio-wrap');
  var elMovimentiWrap = document.getElementById('eco-movimenti-wrap');
  if (elTabContent) elTabContent.style.display = isReport ? 'none' : '';
  if (elSeedBar) elSeedBar.style.display = isReport ? 'none' : '';
  if (elBilancioWrap) elBilancioWrap.style.display = isBilancio ? '' : 'none';
  if (elMovimentiWrap) elMovimentiWrap.style.display = isMovimenti ? '' : 'none';
  ['categorie', 'sottocategorie', 'centriCosto', 'bilancio', 'movimenti'].forEach(function (t) {
    var btn = document.getElementById('eco-tab-btn-' + t);
    if (btn) btn.style.fontWeight = (t === sezione) ? 'bold' : 'normal';
  });
  if (isBilancio) {
    ecoRepPopolaAnni();
  } else if (isMovimenti) {
    ecoMovPopolaAnni();
    ecoMovPopolaFiltriCodici();
  } else if (typeof ecoMostraTab === 'function') {
    ecoMostraTab(sezione);
  }
}

function ecoRepPopolaAnni() {
  var sel = document.getElementById('eco-rep-anno');
  if (!sel) { console.error('[economia-report] #eco-rep-anno non trovato nel DOM — HTML disallineato dal JS?'); return; }
  var oggi = new Date().getFullYear();
  var cur = sel.value;
  sel.innerHTML = '';
  for (var y = oggi + 1; y >= oggi - 5; y--) {
    sel.innerHTML += '<option value="' + y + '"' + (y === ecoRepAnno ? ' selected' : '') + '>' + y + '</option>';
  }
  sel.value = cur || String(ecoRepAnno);
}

// ── Caricamento dati (sola lettura) ──
function ecoRepGenera() {
  var selAnno = document.getElementById('eco-rep-anno');
  ecoRepAnno = selAnno ? (parseInt(selAnno.value, 10) || new Date().getFullYear()) : new Date().getFullYear();
  var out = document.getElementById('eco-rep-output');
  var btnStampa = document.getElementById('eco-rep-btn-stampa');
  if (!window._db) {
    var msgNoDb = '[economia-report] _db non pronto — Firestore non inizializzato';
    console.error(msgNoDb);
    if (typeof log === 'function') log(msgNoDb, 'err');
    alert('Firestore non pronto: attendi il login e riprova.');
    return;
  }
  if (out) out.innerHTML = '<p style="color:#888">Caricamento...</p>';
  if (btnStampa) btnStampa.style.display = 'none';
  var col = window._db.collection('basket052441');
  Promise.all([
    col.doc('economiaConfig').get(),
    // NIENTE where('annoEsercizio','==',...) qui: Firestore confronta anche
    // il TIPO, non solo il valore — un solo movimento con annoEsercizio
    // salvato come stringa "2026" invece di numero 2026 sparirebbe dai
    // risultati senza errori. Si carica tutto e si filtra lato client con
    // confronto tollerante al tipo (23/08/2026, bug reale riscontrato).
    col.doc('economia').collection('movimenti').get(),
    // v1.3: serve anche economiaConti per la sezione Liquidità — letto qui
    // anche se ecoRepCalcola() non lo usa, per non duplicare la query.
    col.doc('economiaConti').get()
  ]).then(function (res) {
    var config = { categorie: [], sottocategorie: [], centriCosto: [] };
    if (res[0].exists && res[0].data().v) {
      try {
        var parsed = JSON.parse(res[0].data().v);
        if (parsed && typeof parsed === 'object') config = parsed;
      } catch (ex) {
        console.error('[economia-report] errore parsing economiaConfig', ex);
        if (typeof log === 'function') log('[economia-report] errore parsing economiaConfig: ' + ex.message, 'err');
        alert('ATTENZIONE: economiaConfig non leggibile (' + ex.message + '). Categorie/sottocategorie/centri di costo NON risolti nel Bilancio — i nomi mostreranno i codici grezzi.');
      }
    }
    if (!config.categorie) config.categorie = [];
    if (!config.sottocategorie) config.sottocategorie = [];
    if (!config.centriCosto) config.centriCosto = [];
    var tuttiMovimenti = [];
    res[1].forEach(function (doc) { tuttiMovimenti.push(doc.data()); });
    var movimenti = tuttiMovimenti.filter(function (m) {
      return parseInt(m.annoEsercizio, 10) === ecoRepAnno;
    });
    var dati = ecoRepCalcola(movimenti, config);

    // v1.3: Liquidità conti — usa tuttiMovimenti (non filtrati per anno,
    // servono anche gli anni precedenti per calcolare il saldo di apertura)
    // + economiaConti, appena letto sopra.
    var conti = [];
    if (res[2] && res[2].exists && res[2].data().v) {
      try {
        var parsedConti = JSON.parse(res[2].data().v);
        if (Array.isArray(parsedConti)) conti = parsedConti;
      } catch (exC) {
        console.error('[economia-report] errore parsing economiaConti', exC);
        if (typeof log === 'function') log('[economia-report] errore parsing economiaConti: ' + exC.message, 'err');
        alert('ATTENZIONE: economiaConti non leggibile (' + exC.message + '). Sezione Liquidità conti NON mostrata nel Bilancio.');
      }
    }
    dati.liquidita = ecoRepCalcolaLiquidita(tuttiMovimenti, conti, ecoRepAnno);
    if (!conti.length && typeof log === 'function') {
      log('Bilancio ' + ecoRepAnno + ': nessun conto configurato in economiaConti — sezione Liquidità conti vuota', 'err');
    }

    ecoRepRender(dati, ecoRepAnno);
    if (typeof log === 'function') log('Bilancio ' + ecoRepAnno + ': ' + movimenti.length + '/' + tuttiMovimenti.length + ' movimenti (esercizio/totale)', 'ok');
  }).catch(function (err) {
    var msgErr = '[economia-report] errore caricamento dati bilancio: ' + (err && err.message || err);
    console.error(msgErr, err);
    if (typeof log === 'function') log(msgErr, 'err');
    if (out) out.innerHTML = '<p style="color:#c00;">Errore caricamento: ' + (err && err.message || err) + '</p>';
    alert('Errore caricamento dati bilancio: ' + (err && err.message || err));
  });
}

// ── Calcolo puro (nessun accesso DOM/Firestore) — testabile in isolamento.
// Cash-basis: conta solo movimenti PAGATO/PARZIALE, come ecoSaldoTeoricoConto
// già in economia-core-DRAFT.js (stessa convenzione, non reinventata qui).
// ANNULLATO e DA_PAGARE non entrano nel consuntivo.
//
// Struttura di output (v2, 22/08/2026 — su richiesta Alberto):
// raggruppamento primario per CENTRO DI COSTO (ogni centro riceve lo stesso
// trattamento, nessuna semplificazione per nessuno). Dentro ogni centro,
// USCITE ed ENTRATE sono sezioni separate (mai in colonne affiancate sulla
// stessa riga — errore della v1). Dentro ciascuna sezione: categoria con
// subtotale, sottocategorie annidate con i loro valori. ──
// ── Normalizzazione codici per confronto/raggruppamento: trim+uppercase.
// ecoNuovoCodice() in economia-core-DRAFT.js impedisce già la creazione di
// codici duplicati per case (es. non si può creare "Sport" se "SPORT" esiste
// già), ma movimenti storici/importati prima di quel controllo, o inseriti
// fuori da quel percorso, possono portare un centroCostoCodice/categoriaCodice
// con case diverso da quello ufficiale in tabella. Senza normalizzare qui,
// finiscono in due gruppi separati invece di unirsi (bug osservato 22/08:
// due righe "Sport" nel Bilancio). ──
function ecoRepNorm(s) {
  return (s || '').toString().trim().toUpperCase();
}

// ── Risoluzione nomi da codice — condivisa tra Bilancio e Movimenti ──
function ecoRepNomeCategoria(config, codice) {
  var c = config.categorie.find(function (x) { return ecoRepNorm(x.codice) === ecoRepNorm(codice); });
  return c ? c.descrizione : (!codice ? 'Senza categoria' : codice);
}
function ecoRepNomeSottocategoria(config, codice) {
  var s = config.sottocategorie.find(function (x) { return ecoRepNorm(x.codice) === ecoRepNorm(codice); });
  return s ? s.descrizione : codice;
}
function ecoRepNomeCentroCosto(config, codice) {
  var c = config.centriCosto.find(function (x) { return ecoRepNorm(x.codice) === ecoRepNorm(codice); });
  return c ? c.descrizione : (!codice ? 'Senza centro di costo' : codice);
}
function ecoRepNomeConto(conti, id) {
  var c = (conti || []).find(function (x) { return x.id === id; });
  return c ? c.nome : (!id ? '—' : id);
}

function ecoRepCalcola(movimenti, config) {
  config = config || { categorie: [], sottocategorie: [], centriCosto: [] };
  var attivi = (movimenti || []).filter(function (m) {
    return m.stato === 'PAGATO' || m.stato === 'PARZIALE';
  });

  function nomeCategoria(codice) { return codice ? ecoRepNomeCategoria(config, codice) : 'Senza categoria'; }
  function nomeSottocategoria(codice) { return ecoRepNomeSottocategoria(config, codice); }
  function nomeCentroCosto(codice) { return codice ? ecoRepNomeCentroCosto(config, codice) : 'Senza centro di costo'; }

  // Raggruppa un elenco di movimenti (già filtrati per centro+tipo) in
  // categorie con sottocategorie annidate. Ritorna { totale, categorie:[...] }.
  function raggruppaPerCategoria(elenco) {
    var catMap = {};
    elenco.forEach(function (m) {
      var key = ecoRepNorm(m.categoriaCodice) || '(nessuna)';
      if (!catMap[key]) catMap[key] = { totale: 0, sotto: {}, codiceOriginale: m.categoriaCodice };
      var imp = Number(m.importoEur) || 0;
      catMap[key].totale += imp;
      var subKey = ecoRepNorm(m.sottocategoriaCodice) || null;
      if (subKey) {
        if (!catMap[key].sotto[subKey]) catMap[key].sotto[subKey] = { totale: 0, codiceOriginale: m.sottocategoriaCodice };
        catMap[key].sotto[subKey].totale += imp;
      }
    });
    var categorie = Object.keys(catMap).map(function (key) {
      var entry = catMap[key];
      var codice = entry.codiceOriginale || null;
      var sottocategorie = Object.keys(entry.sotto).map(function (subKey) {
        var subEntry = entry.sotto[subKey];
        var subCod = subEntry.codiceOriginale || subKey;
        return { codice: subCod, descrizione: nomeSottocategoria(subCod), totale: subEntry.totale };
      }).sort(function (a, b) { return b.totale - a.totale; });
      return { codice: codice, descrizione: nomeCategoria(codice), totale: entry.totale, sottocategorie: sottocategorie };
    }).sort(function (a, b) { return b.totale - a.totale; });
    var totale = categorie.reduce(function (s, c) { return s + c.totale; }, 0);
    return { totale: totale, categorie: categorie };
  }

  // Raggruppa TUTTI i movimenti attivi per centro di costo (chiave
  // normalizzata: unisce varianti di case dello stesso codice — vedi
  // ecoRepNorm sopra).
  var ccGroups = {};
  attivi.forEach(function (m) {
    var key = ecoRepNorm(m.centroCostoCodice) || '(nessuno)';
    if (!ccGroups[key]) ccGroups[key] = { mov: [], codiceOriginale: m.centroCostoCodice };
    ccGroups[key].mov.push(m);
  });

  var perCentroCosto = Object.keys(ccGroups).map(function (key) {
    var codiceCc = ccGroups[key].codiceOriginale || null;
    var movCc = ccGroups[key].mov;
    var movUscite = movCc.filter(function (m) { return m.tipoMovimento === 'USCITA'; });
    var movEntrate = movCc.filter(function (m) { return m.tipoMovimento === 'ENTRATA'; });
    var uscite = raggruppaPerCategoria(movUscite);
    var entrate = raggruppaPerCategoria(movEntrate);
    return {
      codice: codiceCc,
      descrizione: nomeCentroCosto(codiceCc),
      uscite: uscite,
      entrate: entrate,
      saldo: entrate.totale - uscite.totale
    };
  }).sort(function (a, b) { return (b.entrate.totale + b.uscite.totale) - (a.entrate.totale + a.uscite.totale); });

  var totEntrate = attivi.filter(function (m) { return m.tipoMovimento === 'ENTRATA'; })
    .reduce(function (s, m) { return s + (Number(m.importoEur) || 0); }, 0);
  var totUscite = attivi.filter(function (m) { return m.tipoMovimento === 'USCITA'; })
    .reduce(function (s, m) { return s + (Number(m.importoEur) || 0); }, 0);

  return {
    perCentroCosto: perCentroCosto,
    totEntrate: totEntrate,
    totUscite: totUscite,
    saldoEsercizio: totEntrate - totUscite
  };
}

// ── LIQUIDITÀ CONTI (v1.3 · 02/09/2026, BK) ──
// Domanda di Alberto: "un bilancio che si rispetti ti dice quanti soldi
// hai all'inizio, quanto sono entrate/uscite, quanto ti resta alla fine".
// Mancava del tutto: ecoRepCalcola sopra calcola solo flussi (entrate-uscite),
// mai la liquidità reale per conto (banca/cassa/tasca).
//
// Saldo inizio anno per conto:
//   - se Alberto ha dichiarato esplicitamente c.saldoInizialeEsercizio[anno]
//     per quell'anno specifico, vince quello (è una dichiarazione esplicita).
//   - altrimenti si calcola in autonomia sommando TUTTI i movimenti
//     PAGATO/PARZIALE di quel conto negli anni PRECEDENTI a quello selezionato
//     (robusto anche senza che Alberto debba inserire a mano un saldo
//     iniziale per ognuno degli anni storici appena importati dal foglio Cassa).
// Mai una scelta silenziosa: ogni riga dichiara la sua fonte ("dichiarato"
// vs "calcolato dallo storico").
function ecoRepCalcolaLiquidita(tuttiMovimenti, conti, anno) {
  tuttiMovimenti = tuttiMovimenti || [];
  conti = conti || [];
  if (!conti.length) return [];

  function flussoNetto(movimentiFiltrati) {
    var s = 0;
    movimentiFiltrati.forEach(function (m) {
      if (m.stato !== 'PAGATO' && m.stato !== 'PARZIALE') return;
      var segno = m.tipoMovimento === 'ENTRATA' ? 1 : -1;
      s += segno * (Number(m.importoEur) || 0);
    });
    return Math.round(s * 100) / 100;
  }

  return conti.map(function (c) {
    var movConto = tuttiMovimenti.filter(function (m) { return m.contoFinanziarioId === c.id; });

    var saldoDichiarato = (c.saldoInizialeEsercizio && c.saldoInizialeEsercizio[anno] != null)
      ? c.saldoInizialeEsercizio[anno] : null;

    var movPrecedenti = movConto.filter(function (m) { return parseInt(m.annoEsercizio, 10) < anno; });
    var saldoCalcolato = flussoNetto(movPrecedenti);

    var saldoInizio = saldoDichiarato != null ? saldoDichiarato : saldoCalcolato;
    var fonte = saldoDichiarato != null ? 'dichiarato' : 'calcolato dallo storico';

    var movAnno = movConto.filter(function (m) { return parseInt(m.annoEsercizio, 10) === anno; });
    var entrateAnno = flussoNetto(movAnno.filter(function (m) { return m.tipoMovimento === 'ENTRATA'; }));
    var usciteAnno = -flussoNetto(movAnno.filter(function (m) { return m.tipoMovimento === 'USCITA'; }));
    var saldoFine = Math.round((saldoInizio + entrateAnno - usciteAnno) * 100) / 100;

    return {
      id: c.id,
      nome: c.nome,
      tipo: c.tipo,
      saldoInizio: saldoInizio,
      fonte: fonte,
      entrateAnno: entrateAnno,
      usciteAnno: usciteAnno,
      saldoFine: saldoFine
    };
  });
}

// ── Render vista a schermo (stessa struttura HTML usata per la stampa) ──
function ecoRepRender(dati, anno) {
  var html = ecoRepBuildHtml(dati, anno);
  window._ecoRepHTML = html;
  var out = document.getElementById('eco-rep-output');
  if (out) out.innerHTML = html;
  var btnStampa = document.getElementById('eco-rep-btn-stampa');
  if (btnStampa) btnStampa.style.display = '';
}

// ── Stile professionale (palette oro/navy già in uso nel gestionale:
// #c8a84b, #1a2a4a), sfondo bianco esplicito — corregge il bug 22/08 di
// testo scuro su sfondo scuro nella vista a schermo (la stampa non era
// affetta, ma ora vista e stampa sono visivamente identiche). ──
function ecoRepEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function ecoRepEuro(n) {
  return '&euro; ' + (Number(n) || 0).toFixed(2);
}

function ecoRepBuildHtml(dati, anno) {
  var CSS = '<style>' +
    '.rpt{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#1a1a1a;' +
      'max-width:900px;background:#fff;padding:20px;margin:0 auto;}' +
    '.rpt h1{font-family:Georgia,"Times New Roman",serif;font-size:19px;font-weight:bold;' +
      'margin:0 0 2px;color:#1a2a4a;text-align:center;}' +
    '.rpt .sub{font-family:Georgia,"Times New Roman",serif;font-size:13px;font-weight:normal;' +
      'color:#444;text-align:center;margin-bottom:6px;}' +
    '.rpt .meta{font-size:10px;color:#888;margin-bottom:18px;text-align:center;}' +
    '.rpt .logo-wrap{text-align:center;margin-bottom:6px;}' +
    '.rpt hr.masthead{border:none;border-top:2px solid #1a2a4a;margin:0 0 16px;}' +
    // Riepilogo generale (box in cima, sguardo rapido)
    '.rpt .riepilogo{border:1px solid #1a2a4a;border-radius:2px;margin-bottom:24px;overflow:hidden;}' +
    '.rpt .riepilogo table{width:100%;border-collapse:collapse;}' +
    '.rpt .riepilogo td{padding:7px 14px;font-size:12.5px;}' +
    '.rpt .riepilogo td.lbl{color:#333;}' +
    '.rpt .riepilogo td.val{text-align:right;font-variant-numeric:tabular-nums;}' +
    '.rpt .riepilogo tr.saldo{background:#1a2a4a;}' +
    '.rpt .riepilogo tr.saldo td{color:#fff;font-weight:bold;font-size:13.5px;}' +
    // Liquidità conti (v1.3)
    '.rpt .liquidita{border:1px solid #1a2a4a;border-radius:2px;margin-bottom:24px;overflow:hidden;}' +
    '.rpt .liquidita-head{background:#1a2a4a;color:#fff;padding:8px 14px;' +
      'font-family:Georgia,"Times New Roman",serif;font-size:14.5px;font-weight:bold;}' +
    '.rpt table.liquidita-tab{width:100%;border-collapse:collapse;}' +
    '.rpt table.liquidita-tab th{background:#f4f4f4;padding:6px 10px;font-size:11px;text-align:left;border-bottom:1px solid #ccc;}' +
    '.rpt table.liquidita-tab th.num{text-align:right;}' +
    '.rpt table.liquidita-tab td{padding:7px 10px;font-size:12.5px;border-bottom:1px solid #eee;}' +
    '.rpt table.liquidita-tab td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}' +
    '.rpt table.liquidita-tab td.fonte{font-size:9px;color:#999;}' +
    '.rpt table.liquidita-tab tr.tot-liquidita td{font-weight:bold;border-top:2px solid #1a2a4a;border-bottom:none;background:#f4f4f4;}' +
    // Blocco Centro di Costo
    '.rpt .centro{margin-bottom:26px;page-break-inside:avoid;}' +
    '.rpt .centro-head{background:#1a2a4a;color:#fff;padding:8px 14px;' +
      'font-family:Georgia,"Times New Roman",serif;font-size:14.5px;font-weight:bold;' +
      'display:flex;justify-content:space-between;align-items:baseline;}' +
    '.rpt .centro-head .saldo-tag{font-family:Arial,sans-serif;font-size:12px;font-weight:bold;' +
      'font-variant-numeric:tabular-nums;}' +
    '.rpt .centro-head .saldo-tag.neg{color:#ff9a9a;}' +
    '.rpt .centro-head .saldo-tag.pos{color:#a8d8b0;}' +
    // Sezione Uscite / Entrate dentro un centro
    '.rpt .flusso{border-left:4px solid #1a2a4a;padding:8px 0 8px 12px;margin-top:0;}' +
    '.rpt .flusso.entrate{border-left-color:#c8a84b;}' +
    '.rpt .flusso-titolo{font-family:Georgia,"Times New Roman",serif;font-weight:bold;' +
      'font-size:12.5px;color:#1a2a4a;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;}' +
    '.rpt .flusso.entrate .flusso-titolo{color:#8a6d1f;}' +
    '.rpt table.dettaglio{width:100%;border-collapse:collapse;margin-bottom:6px;}' +
    '.rpt table.dettaglio td{padding:3px 8px 3px 0;font-size:11.5px;border-bottom:1px solid #eee;}' +
    '.rpt table.dettaglio td.val{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}' +
    '.rpt tr.riga-categoria td{font-weight:bold;color:#1a1a1a;border-top:1px solid #ccc;border-bottom:none;padding-top:6px;}' +
    '.rpt table.dettaglio tr.riga-sotto td{color:#555;padding-left:20px;font-weight:normal;border-bottom:none;font-size:11px;}' +
    '.rpt tr.riga-tot-flusso td{font-weight:bold;border-top:1px solid #999;border-bottom:none;padding-top:5px;}' +
    '.rpt .vuoto{color:#999;font-style:italic;font-size:11px;padding:4px 0 8px;}' +
    '.rpt .centro-saldo-riga{background:#f4f4f4;padding:6px 14px;display:flex;justify-content:space-between;' +
      'font-size:12px;font-weight:bold;}' +
    '.rpt .centro-saldo-riga .neg{color:#a02020;}' +
    '.rpt .centro-saldo-riga .pos{color:#1a2a4a;}' +
    // Totale finale
    '.rpt .finale{border:2px solid #1a2a4a;border-radius:2px;margin-top:20px;overflow:hidden;}' +
    '.rpt .finale table{width:100%;border-collapse:collapse;}' +
    '.rpt .finale td{padding:8px 16px;font-size:13px;}' +
    '.rpt .finale td.val{text-align:right;font-variant-numeric:tabular-nums;font-weight:bold;}' +
    '.rpt .finale tr.saldo-finale{background:#1a2a4a;}' +
    '.rpt .finale tr.saldo-finale td{color:#fff;font-size:15px;font-weight:bold;}' +
    '@media print{.rpt{padding:0;}}' +
    '</style>';

  function rigaCategoria(cat) {
    var h = '<tr class="riga-categoria"><td>' + ecoRepEsc(cat.descrizione) + '</td><td class="val">' + ecoRepEuro(cat.totale) + '</td></tr>';
    cat.sottocategorie.forEach(function (sub) {
      h += '<tr class="riga-sotto"><td>' + ecoRepEsc(sub.descrizione) + '</td><td class="val">' + ecoRepEuro(sub.totale) + '</td></tr>';
    });
    return h;
  }

  function blockFlusso(flusso, tipo) {
    var titolo = tipo === 'uscite' ? 'Uscite' : 'Entrate';
    var cls = tipo === 'uscite' ? 'flusso' : 'flusso entrate';
    var html = '<div class="' + cls + '"><div class="flusso-titolo">' + titolo + '</div>';
    if (!flusso.categorie.length) {
      html += '<div class="vuoto">Nessun movimento.</div>';
    } else {
      html += '<table class="dettaglio"><tbody>';
      flusso.categorie.forEach(function (cat) { html += rigaCategoria(cat); });
      html += '<tr class="riga-tot-flusso"><td>Totale ' + titolo + '</td><td class="val">' + ecoRepEuro(flusso.totale) + '</td></tr>';
      html += '</tbody></table>';
    }
    html += '</div>';
    return html;
  }

  function blockLiquidita() {
    var liq = dati.liquidita;
    if (!liq || !liq.length) return '';
    var h = '<div class="liquidita">';
    h += '<div class="liquidita-head">Liquidità conti</div>';
    h += '<table class="liquidita-tab"><thead><tr>' +
      '<th>Conto</th><th class="num">Saldo inizio ' + anno + '</th>' +
      '<th class="num">Entrate</th><th class="num">Uscite</th>' +
      '<th class="num">Saldo fine ' + anno + '</th></tr></thead><tbody>';
    var totInizio = 0, totEntrate = 0, totUscite = 0, totFine = 0;
    liq.forEach(function (c) {
      totInizio += c.saldoInizio; totEntrate += c.entrateAnno; totUscite += c.usciteAnno; totFine += c.saldoFine;
      h += '<tr><td>' + ecoRepEsc(c.nome) + ' <span class="fonte">(' + c.fonte + ')</span></td>' +
        '<td class="num">' + ecoRepEuro(c.saldoInizio) + '</td>' +
        '<td class="num">' + ecoRepEuro(c.entrateAnno) + '</td>' +
        '<td class="num">' + ecoRepEuro(c.usciteAnno) + '</td>' +
        '<td class="num"><b>' + ecoRepEuro(c.saldoFine) + '</b></td></tr>';
    });
    h += '<tr class="tot-liquidita"><td>TOTALE LIQUIDITÀ</td>' +
      '<td class="num">' + ecoRepEuro(totInizio) + '</td>' +
      '<td class="num">' + ecoRepEuro(totEntrate) + '</td>' +
      '<td class="num">' + ecoRepEuro(totUscite) + '</td>' +
      '<td class="num">' + ecoRepEuro(totFine) + '</td></tr>';
    h += '</tbody></table>';
    h += '<div style="font-size:9px;color:#999;padding:6px 14px;">' +
      '"dichiarato" = inserito manualmente in Economia \u2192 Conti per questo esercizio. ' +
      '"calcolato dallo storico" = somma di tutti i movimenti degli anni precedenti registrati in Economia.</div>';
    h += '</div>';
    return h;
  }

  var html = CSS + '<div class="rpt">';
  html += '<div class="logo-wrap">';
  if (typeof _LOGO_B64 !== 'undefined' && _LOGO_B64) {
    html += '<img src="data:image/jpeg;base64,' + _LOGO_B64 + '" style="height:56px;" alt="Logo">';
  }
  html += '</div>';
  html += '<h1>A.S.D. Basket Campodarsego</h1>';
  html += '<div class="sub">Bilancio consuntivo esercizio ' + anno + '</div>';
  html += '<div class="meta">Data generazione: ' + (typeof nowStr === 'function' ? nowStr() : new Date().toLocaleDateString('it-IT')) + '</div>';
  html += '<hr class="masthead">';

  // Riepilogo generale
  html += '<div class="riepilogo"><table><tbody>';
  html += '<tr><td class="lbl">Totale Entrate</td><td class="val">' + ecoRepEuro(dati.totEntrate) + '</td></tr>';
  html += '<tr><td class="lbl">Totale Uscite</td><td class="val">' + ecoRepEuro(dati.totUscite) + '</td></tr>';
  html += '<tr class="saldo"><td>Saldo esercizio</td><td class="val">' + ecoRepEuro(dati.saldoEsercizio) + '</td></tr>';
  html += '</tbody></table></div>';

  // Liquidità conti (v1.3) -- subito dopo il riepilogo generale, prima del
  // dettaglio per centro di costo: risponde alla domanda "oggi quanto ho
  // realmente in cassa/banca", prima di scendere nel dettaglio per attività.
  html += blockLiquidita();

  // Dettaglio per centro di costo — stesso trattamento per ognuno, nessuna semplificazione
  if (!dati.perCentroCosto.length) {
    html += '<p style="color:#888">Nessun movimento registrato per questo esercizio.</p>';
  } else {
    dati.perCentroCosto.forEach(function (cc) {
      var saldoCls = cc.saldo < 0 ? 'neg' : 'pos';
      html += '<div class="centro">';
      html += '<div class="centro-head"><span>' + ecoRepEsc(cc.descrizione) + '</span>' +
        '<span class="saldo-tag ' + saldoCls + '">Saldo ' + ecoRepEuro(cc.saldo) + '</span></div>';
      html += blockFlusso(cc.uscite, 'uscite');
      html += blockFlusso(cc.entrate, 'entrate');
      html += '</div>';
    });
  }

  // Riepilogo finale
  html += '<div class="finale"><table><tbody>';
  html += '<tr><td>Totale Entrate complessivo</td><td class="val">' + ecoRepEuro(dati.totEntrate) + '</td></tr>';
  html += '<tr><td>Totale Uscite complessivo</td><td class="val">' + ecoRepEuro(dati.totUscite) + '</td></tr>';
  html += '<tr class="saldo-finale"><td>Saldo esercizio</td><td class="val">' + ecoRepEuro(dati.saldoEsercizio) + '</td></tr>';
  html += '</tbody></table></div>';

  html += '</div>';
  return html;
}

// ── Stampa: stesso pattern collaudato di stampaReportSoci() / _apriStampa()
// già in basket052441-admin.html — nessuna nuova logica di stampa. ──
function ecoRepStampa() {
  if (!window._ecoRepHTML) {
    alert('Genera prima il bilancio.');
    return;
  }
  var titolo = 'Bilancio ' + ecoRepAnno;
  var fullHtml = '<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>' + titolo + '</title>' +
    '<style>@media print{body{margin:0}}</style></head><body>' + window._ecoRepHTML + '</body></html>';
  try {
    if (typeof _apriStampa === 'function') {
      _apriStampa(fullHtml, titolo);
    } else {
      console.error('[economia-report] _apriStampa non disponibile');
      alert('Funzione di stampa non disponibile.');
    }
  } catch (e) {
    console.error('[economia-report] errore stampa', e);
    if (typeof log === 'function') log('[economia-report] errore stampa: ' + (e && e.message || e), 'err');
    alert('Errore stampa: ' + (e && e.message || e));
  }
}

// ════════════════════════════════════════════════════════
// REPORT MOVIMENTI (prima nota) — elenco cronologico filtrabile.
// Legge economiaConti + economiaConfig + movimenti dell'esercizio
// selezionato (stesso pattern di caricamento di economia-movimenti-ui.js:
// where('annoEsercizio','==',anno) sulla stessa collection). Tutti gli
// altri filtri (date, categoria, centro, conto, stato, tipo, testo) sono
// applicati lato client dopo il caricamento — coerente con l'unico altro
// consumatore esistente di questa collection. ──
var ecoMovAnno = new Date().getFullYear();
var ecoMovDati = [];      // movimenti grezzi dell'esercizio caricato
var ecoMovConfigCache = { categorie: [], sottocategorie: [], centriCosto: [] };
var ecoMovContiCache = [];
var ecoMovOrdineAsc = false; // false = più recenti in cima (default)

function ecoMovPopolaAnni() {
  var sel = document.getElementById('mov-filtro-anno');
  if (!sel) { console.error('[economia-report] #mov-filtro-anno non trovato nel DOM — HTML disallineato dal JS?'); return; }
  var oggi = new Date().getFullYear();
  var cur = sel.value;
  sel.innerHTML = '';
  for (var y = oggi + 1; y >= oggi - 5; y--) {
    sel.innerHTML += '<option value="' + y + '"' + (y === ecoMovAnno ? ' selected' : '') + '>' + y + '</option>';
  }
  sel.value = cur || String(ecoMovAnno);
}

// ── Solo codici ATTIVI nelle select di scelta filtro (23/08/2026, richiesta
// Alberto: i disattivati restano ingombro/fastidio nelle liste). Usa
// ecoCodiciAttivi() di economia-core-DRAFT.js se disponibile — stessa
// funzione già usata in economia-admin-ui.js, non reinventata qui. Fallback
// esplicito con log se manca (deploy parziale), mai un filtro silenzioso
// diverso da quello reale. NOTA: questo NON tocca la risoluzione
// nome->codice nei tabulati (ecoRepNome*), che deve continuare a leggere
// l'intera tabella inclusi i disattivati — un movimento storico con un
// codice ormai disattivato deve restare leggibile con la sua descrizione,
// non sparire o mostrare il codice grezzo. ──
function ecoRepSoloAttivi(righe) {
  if (typeof ecoCodiciAttivi === 'function') return ecoCodiciAttivi(righe);
  console.error('[economia-report] ecoCodiciAttivi non disponibile (economia-core-DRAFT.js mancante/vecchio) — filtro attivo/disattivo NON applicato, mostro tutti i codici');
  if (typeof log === 'function') log('[economia-report] ecoCodiciAttivi mancante: filtri codici mostrano anche i disattivati', 'err');
  return righe || [];
}

function ecoMovPopolaFiltriCodici() {
  var cfg = ecoMovConfigCache;
  function fill(id, righe, conEmpty) {
    var sel = document.getElementById(id);
    if (!sel) { console.error('[economia-report] #' + id + ' non trovato nel DOM — HTML disallineato dal JS?'); return; }
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + conEmpty + '</option>';
    ecoRepSoloAttivi(righe).forEach(function (r) {
      sel.innerHTML += '<option value="' + r.codice + '">' + ecoRepEsc(r.descrizione) + '</option>';
    });
    sel.value = cur;
  }
  fill('mov-filtro-categoria', cfg.categorie, 'Tutte le categorie');
  fill('mov-filtro-sottocategoria', cfg.sottocategorie, 'Tutte le sottocategorie');
  fill('mov-filtro-centro', cfg.centriCosto, 'Tutti i centri di costo');
  var selConto = document.getElementById('mov-filtro-conto');
  if (selConto) {
    var curC = selConto.value;
    selConto.innerHTML = '<option value="">Tutti i conti</option>';
    ecoMovContiCache.forEach(function (c) {
      selConto.innerHTML += '<option value="' + c.id + '">' + ecoRepEsc(c.nome) + '</option>';
    });
    selConto.value = curC;
  }
}

function ecoMovCarica() {
  var selAnno = document.getElementById('mov-filtro-anno');
  ecoMovAnno = selAnno ? (parseInt(selAnno.value, 10) || new Date().getFullYear()) : new Date().getFullYear();
  var out = document.getElementById('mov-output');
  if (!window._db) {
    var msgNoDb = '[economia-report] _db non pronto — Firestore non inizializzato';
    console.error(msgNoDb);
    if (typeof log === 'function') log(msgNoDb, 'err');
    alert('Firestore non pronto: attendi il login e riprova.');
    return;
  }
  if (out) out.innerHTML = '<p style="color:#888">Caricamento...</p>';
  var col = window._db.collection('basket052441');
  Promise.all([
    col.doc('economiaConfig').get(),
    col.doc('economiaConti').get(),
    // NIENTE where('annoEsercizio','==',...): vedi nota in ecoRepGenera —
    // un mismatch di tipo (stringa vs numero) sul campo fa sparire
    // silenziosamente i documenti dalla query. Si carica tutto, si filtra
    // qui sotto con parseInt tollerante.
    col.doc('economia').collection('movimenti').get()
  ]).then(function (res) {
    var config = { categorie: [], sottocategorie: [], centriCosto: [] };
    if (res[0].exists && res[0].data().v) {
      try {
        var parsed = JSON.parse(res[0].data().v);
        if (parsed && typeof parsed === 'object') config = parsed;
      } catch (ex) {
        console.error('[economia-report] errore parsing economiaConfig', ex);
        if (typeof log === 'function') log('[economia-report] errore parsing economiaConfig: ' + ex.message, 'err');
        alert('ATTENZIONE: economiaConfig non leggibile (' + ex.message + '). Categorie/sottocategorie/centri di costo NON risolti — i nomi mostreranno i codici grezzi.');
      }
    }
    if (!config.categorie) config.categorie = [];
    if (!config.sottocategorie) config.sottocategorie = [];
    if (!config.centriCosto) config.centriCosto = [];
    ecoMovConfigCache = config;

    var conti = [];
    if (res[1].exists && res[1].data().v) {
      try {
        var parsedC = JSON.parse(res[1].data().v);
        if (Array.isArray(parsedC)) conti = parsedC;
      } catch (ex) {
        console.error('[economia-report] errore parsing economiaConti', ex);
        if (typeof log === 'function') log('[economia-report] errore parsing economiaConti: ' + ex.message, 'err');
        alert('ATTENZIONE: economiaConti non leggibile (' + ex.message + '). Il filtro Conto non funzionerà correttamente.');
      }
    }
    ecoMovContiCache = conti;

    var tuttiMovimenti = [];
    res[2].forEach(function (doc) { tuttiMovimenti.push(doc.data()); });
    var movimenti = tuttiMovimenti.filter(function (m) {
      return parseInt(m.annoEsercizio, 10) === ecoMovAnno;
    });
    ecoMovDati = movimenti;

    ecoMovPopolaFiltriCodici();
    ecoMovApplicaFiltri();
    var msgConteggio = 'Movimenti esercizio ' + ecoMovAnno + ': ' + movimenti.length + ' su ' + tuttiMovimenti.length + ' totali nel database';
    if (typeof log === 'function') log(msgConteggio, 'ok');
    var contatoreEl = document.getElementById('mov-contatore-diag');
    if (contatoreEl) contatoreEl.textContent = msgConteggio;
  }).catch(function (err) {
    var msgErr = '[economia-report] errore caricamento movimenti: ' + (err && err.message || err);
    console.error(msgErr, err);
    if (typeof log === 'function') log(msgErr, 'err');
    if (out) out.innerHTML = '<p style="color:#c00;">Errore caricamento: ' + (err && err.message || err) + '</p>';
  });
}

function ecoMovToggleOrdine() {
  ecoMovOrdineAsc = !ecoMovOrdineAsc;
  var btn = document.getElementById('mov-btn-ordine');
  if (btn) btn.textContent = ecoMovOrdineAsc ? '↑ Data (più vecchi in cima)' : '↓ Data (più recenti in cima)';
  ecoMovApplicaFiltri();
}

// Filtro + ordinamento client-side, sempre a partire da ecoMovDati
// (i movimenti dell'esercizio già caricato — cambiare esercizio richiede
// ecoMovCarica(), tutti gli altri filtri no). ──
// ── Filtro con traccia diagnostica passo-passo. Ogni filtro viene applicato
// separatamente e si conta quanti movimenti sopravvivono DOPO ciascuno —
// così si vede esattamente quale filtro sta scartando più del previsto,
// invece di un'anica catena opaca. Richiesta esplicita di Alberto 23/08:
// "ad ogni errore/filtraggio venga fuori un messaggio", coerente con R2
// (nessuna uscita silenziosa). ──
function ecoMovApplicaFiltri() {
  var dataDa = document.getElementById('mov-filtro-data-da').value || null;
  var dataA = document.getElementById('mov-filtro-data-a').value || null;
  var catF = document.getElementById('mov-filtro-categoria').value || null;
  var subF = document.getElementById('mov-filtro-sottocategoria').value || null;
  var centroF = document.getElementById('mov-filtro-centro').value || null;
  var contoF = document.getElementById('mov-filtro-conto').value || null;
  var statoF = document.getElementById('mov-filtro-stato').value || null;
  var tipoF = document.getElementById('mov-filtro-tipo').value || null;
  var testoF = (document.getElementById('mov-filtro-testo').value || '').trim().toLowerCase();

  var traccia = [];
  var attuali = ecoMovDati.slice();
  traccia.push({ passo: 'Movimenti caricati (esercizio ' + ecoMovAnno + ')', rimasti: attuali.length });

  if (dataDa) {
    attuali = attuali.filter(function (m) {
      var dataRif = m.dataDocumento || m.dataRegistrazione || '';
      return !dataRif || dataRif >= dataDa;
    });
    traccia.push({ passo: 'Data da ' + dataDa, rimasti: attuali.length });
  }
  if (dataA) {
    attuali = attuali.filter(function (m) {
      var dataRif = m.dataDocumento || m.dataRegistrazione || '';
      return !dataRif || dataRif <= dataA;
    });
    traccia.push({ passo: 'Data a ' + dataA, rimasti: attuali.length });
  }
  if (catF) {
    attuali = attuali.filter(function (m) { return ecoRepNorm(m.categoriaCodice) === ecoRepNorm(catF); });
    traccia.push({ passo: 'Categoria = ' + catF, rimasti: attuali.length });
  }
  if (subF) {
    attuali = attuali.filter(function (m) { return ecoRepNorm(m.sottocategoriaCodice) === ecoRepNorm(subF); });
    traccia.push({ passo: 'Sottocategoria = ' + subF, rimasti: attuali.length });
  }
  if (centroF) {
    attuali = attuali.filter(function (m) { return ecoRepNorm(m.centroCostoCodice) === ecoRepNorm(centroF); });
    traccia.push({ passo: 'Centro di costo = ' + centroF, rimasti: attuali.length });
  }
  if (contoF) {
    attuali = attuali.filter(function (m) { return m.contoFinanziarioId === contoF; });
    traccia.push({ passo: 'Conto = ' + contoF, rimasti: attuali.length });
  }
  if (statoF) {
    attuali = attuali.filter(function (m) { return m.stato === statoF; });
    traccia.push({ passo: 'Stato = ' + statoF, rimasti: attuali.length });
  }
  if (tipoF) {
    attuali = attuali.filter(function (m) { return m.tipoMovimento === tipoF; });
    traccia.push({ passo: 'Tipo = ' + tipoF, rimasti: attuali.length });
  }
  if (testoF) {
    attuali = attuali.filter(function (m) {
      return (m.note || '').toLowerCase().indexOf(testoF) > -1 ||
        (m.numeroDocumento || '').toLowerCase().indexOf(testoF) > -1;
    });
    traccia.push({ passo: 'Testo contiene "' + testoF + '"', rimasti: attuali.length });
  }

  var risultati = attuali.sort(function (a, b) {
    var da = a.dataDocumento || a.dataRegistrazione || '';
    var db = b.dataDocumento || b.dataRegistrazione || '';
    return ecoMovOrdineAsc ? da.localeCompare(db) : db.localeCompare(da);
  });

  ecoMovRenderTraccia(traccia);
  ecoMovRender(risultati);
}

// ── Esporta CSV (v1, 23/08/2026) — richiesta Alberto: liste costi/ricavi
// per centro di costo per uso esterno (offerte amministrative, commercialista,
// ecc.). Esporta ESATTAMENTE window._ecoMovRisultati, cioè la stessa lista
// filtrata già mostrata a schermo da ecoMovApplicaFiltri()/ecoMovRender() —
// mai un ricalcolo separato, altrimenti CSV e vista a schermo potrebbero
// divergere silenziosamente in futuro se uno dei due punti viene toccato
// senza toccare l'altro. Nomi di categoria/centro di costo risolti tramite
// ecoRepNome*() (stessa risoluzione usata nel tabulato stampato), non i
// codici grezzi — più leggibile per chi riceve il file fuori dall'app. ──
function ecoMovEsportaCSV() {
  var risultati = window._ecoMovRisultati || [];
  if (!risultati.length) { console.error('[economia-report] ecoMovEsportaCSV: nessun risultato da esportare'); alert('Nessun movimento da esportare con i filtri correnti.'); return; }
  var config = ecoMovConfigCache || { categorie: [], sottocategorie: [], centriCosto: [] };
  var conti = ecoMovContiCache || [];

  function csvCella(v) {
    v = (v == null) ? '' : String(v);
    if (v.indexOf('"') > -1 || v.indexOf(';') > -1 || v.indexOf('\n') > -1) {
      v = '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  }

  var intestazione = ['Data', 'Numero movimento', 'Tipo', 'Categoria', 'Sottocategoria', 'Centro di costo', 'Conto', 'Importo EUR', 'Stato', 'Note'];
  var righe = [intestazione.join(';')];
  risultati.forEach(function (m) {
    var riga = [
      m.dataDocumento || m.dataRegistrazione || '',
      m.numeroMovimento || '',
      m.tipoMovimento === 'ENTRATA' ? 'Entrata' : 'Uscita',
      ecoRepNomeCategoria(config, m.categoriaCodice),
      ecoRepNomeSottocategoria(config, m.sottocategoriaCodice),
      ecoRepNomeCentroCosto(config, m.centroCostoCodice),
      ecoRepNomeConto(conti, m.contoFinanziarioId),
      Number(m.importoEur || 0).toFixed(2).replace('.', ','),
      m.stato || '',
      m.note || ''
    ];
    righe.push(riga.map(csvCella).join(';'));
  });

  // BOM UTF-8 iniziale: senza, Excel su Windows interpreta male gli accenti.
  var contenuto = '\uFEFF' + righe.join('\r\n');
  var blob = new Blob([contenuto], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  var oggi = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = 'movimenti_' + oggi + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if (typeof log === 'function') log('Economia: esportati ' + risultati.length + ' movimenti in CSV', 'ok');
}

function ecoMovRenderTraccia(traccia) {
  var el = document.getElementById('mov-traccia-diag');
  if (!el) { console.error('[economia-report] #mov-traccia-diag non trovato nel DOM — HTML disallineato dal JS?'); return; }
  if (traccia.length <= 1) { el.innerHTML = ''; return; }
  var html = '<div style="font-size:.78em;color:#8a9aaa;background:#0d1a2a;border-radius:4px;padding:6px 10px;margin-bottom:8px;">';
  html += '<strong>Traccia filtri:</strong> ';
  html += traccia.map(function (t) { return t.passo + ' → ' + t.rimasti; }).join(' &nbsp;|&nbsp; ');
  html += '</div>';
  el.innerHTML = html;
}

function ecoMovRender(risultati) {
  var html = ecoMovBuildHtml(risultati);
  window._ecoMovHTML = html;
  window._ecoMovRisultati = risultati; // usato da ecoMovEsportaCSV — stessa lista, stessi filtri
  var out = document.getElementById('mov-output');
  if (out) out.innerHTML = html;
  var btnStampa = document.getElementById('mov-btn-stampa');
  if (btnStampa) btnStampa.style.display = risultati.length ? '' : 'none';
  var btnCsv = document.getElementById('mov-btn-csv');
  if (btnCsv) btnCsv.style.display = risultati.length ? '' : 'none';
}

var ECO_MOV_STATO_COLORI = {
  DA_PAGARE: '#c8a84b', PAGATO: '#1a7a3a', PARZIALE: '#1a5aaa', SCADUTO: '#c02020', ANNULLATO: '#888'
};
var ECO_MOV_STATO_LABEL = {
  DA_PAGARE: 'Da pagare', PAGATO: 'Pagato', PARZIALE: 'Parziale', SCADUTO: 'Scaduto', ANNULLATO: 'Annullato'
};

function ecoMovBuildHtml(risultati) {
  var CSS = '<style>' +
    '.movrpt{font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#1a1a1a;' +
      'background:#fff;padding:16px;max-width:100%;}' +
    '.movrpt h1{font-family:Georgia,"Times New Roman",serif;font-size:16px;color:#1a2a4a;' +
      'text-align:center;margin:0 0 2px;}' +
    '.movrpt .sub{font-family:Georgia,"Times New Roman",serif;font-size:12px;color:#444;' +
      'text-align:center;margin-bottom:4px;}' +
    '.movrpt .meta{font-size:9.5px;color:#888;text-align:center;margin-bottom:12px;}' +
    '.movrpt hr{border:none;border-top:2px solid #1a2a4a;margin:0 0 12px;}' +
    '.movrpt table{width:100%;border-collapse:collapse;}' +
    '.movrpt th{background:#1a2a4a;color:#fff;padding:5px 7px;font-size:10.5px;text-align:left;' +
      'position:sticky;top:0;}' +
    '.movrpt th.num{text-align:right;}' +
    '.movrpt td{padding:4px 7px;border-bottom:1px solid #e5e5e5;font-size:11px;white-space:nowrap;}' +
    '.movrpt td.num{text-align:right;font-variant-numeric:tabular-nums;}' +
    '.movrpt td.desc{white-space:normal;max-width:220px;}' +
    '.movrpt tr:nth-child(even){background:#fafafa;}' +
    '.movrpt tr.tot td{font-weight:bold;background:#eef1f6;border-top:2px solid #1a2a4a;border-bottom:none;}' +
    '.movrpt .stato-badge{font-weight:bold;font-size:10px;padding:1px 6px;border-radius:3px;color:#fff;}' +
    '.movrpt .vuoto{color:#888;font-style:italic;padding:12px 0;text-align:center;}' +
    '@media print{.movrpt{padding:0;} .movrpt table{font-size:10px;}}' +
    '</style>';

  var html = CSS + '<div class="movrpt">';
  html += '<div style="text-align:center;margin-bottom:6px">';
  if (typeof _LOGO_B64 !== 'undefined' && _LOGO_B64) {
    html += '<img src="data:image/jpeg;base64,' + _LOGO_B64 + '" style="height:44px;" alt="Logo">';
  }
  html += '</div>';
  html += '<h1>A.S.D. Basket Campodarsego</h1>';
  html += '<div class="sub">Registro movimenti — esercizio ' + ecoMovAnno + '</div>';
  html += '<div class="meta">Data generazione: ' + (typeof nowStr === 'function' ? nowStr() : new Date().toLocaleDateString('it-IT')) +
    ' — ' + risultati.length + ' movimenti</div>';
  html += '<hr>';

  if (!risultati.length) {
    html += '<div class="vuoto">Nessun movimento corrisponde ai filtri selezionati.</div></div>';
    return html;
  }

  html += '<table><thead><tr>' +
    '<th>Data</th><th class="left">Descrizione</th><th>Categoria</th><th>Sottocategoria</th>' +
    '<th>Centro di costo</th><th>Conto</th><th>Tipo</th><th class="num">Importo</th><th>Stato</th>' +
    '</tr></thead><tbody>';

  var totEntrate = 0, totUscite = 0;
  risultati.forEach(function (m) {
    var imp = Number(m.importoEur) || 0;
    if (m.tipoMovimento === 'ENTRATA') totEntrate += imp; else totUscite += imp;
    var segno = m.tipoMovimento === 'ENTRATA' ? '+' : '−';
    var dataRif = m.dataDocumento || m.dataRegistrazione || '';
    var statoColore = ECO_MOV_STATO_COLORI[m.stato] || '#888';
    var statoLabel = ECO_MOV_STATO_LABEL[m.stato] || m.stato || '';
    html += '<tr>' +
      '<td>' + ecoRepEsc(dataRif) + '</td>' +
      '<td class="desc">' + ecoRepEsc(m.note || m.numeroDocumento || '') + '</td>' +
      '<td>' + ecoRepEsc(ecoRepNomeCategoria(ecoMovConfigCache, m.categoriaCodice)) + '</td>' +
      '<td>' + ecoRepEsc(m.sottocategoriaCodice ? ecoRepNomeSottocategoria(ecoMovConfigCache, m.sottocategoriaCodice) : '—') + '</td>' +
      '<td>' + ecoRepEsc(ecoRepNomeCentroCosto(ecoMovConfigCache, m.centroCostoCodice)) + '</td>' +
      '<td>' + ecoRepEsc(ecoRepNomeConto(ecoMovContiCache, m.contoFinanziarioId)) + '</td>' +
      '<td>' + (m.tipoMovimento === 'ENTRATA' ? 'Entrata' : 'Uscita') + '</td>' +
      '<td class="num">' + segno + ' ' + ecoRepEuro(imp) + '</td>' +
      '<td><span class="stato-badge" style="background:' + statoColore + '">' + ecoRepEsc(statoLabel) + '</span></td>' +
      '</tr>';
  });

  html += '<tr class="tot"><td colspan="7">Totali (risultati filtrati)</td>' +
    '<td class="num">' + ecoRepEuro(totEntrate - totUscite) + '</td><td></td></tr>';
  html += '<tr><td colspan="7" style="border:none;font-size:10px;color:#666">Entrate: ' + ecoRepEuro(totEntrate) +
    ' &nbsp;|&nbsp; Uscite: ' + ecoRepEuro(totUscite) + '</td><td colspan="2" style="border:none"></td></tr>';
  html += '</tbody></table></div>';
  return html;
}

function ecoMovStampa() {
  if (!window._ecoMovHTML) {
    alert('Nessun risultato da stampare.');
    return;
  }
  var titolo = 'Movimenti ' + ecoMovAnno;
  var fullHtml = '<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>' + titolo + '</title>' +
    '<style>@page{size:A4 landscape;margin:8mm}</style></head><body>' + window._ecoMovHTML + '</body></html>';
  try {
    if (typeof _apriStampa === 'function') {
      _apriStampa(fullHtml, titolo);
    } else {
      alert('Funzione di stampa non disponibile.');
    }
  } catch (e) {
    console.error('[economia-report] errore stampa movimenti', e);
    if (typeof log === 'function') log('[economia-report] errore stampa movimenti: ' + (e && e.message || e), 'err');
    alert('Errore stampa: ' + (e && e.message || e));
  }
}

window.addEventListener('error', function (e) {
  var msg = '[economia-report] errore non gestito: ' + (e.error && e.error.message || e.message);
  console.error(msg);
  if (typeof log === 'function') log(msg, 'err');
});
window.addEventListener('unhandledrejection', function (e) {
  var msg = '[economia-report] promise non gestita: ' + (e.reason && e.reason.message || e.reason);
  console.error(msg);
  if (typeof log === 'function') log(msg, 'err');
});
