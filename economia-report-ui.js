// ════════════════════════════════════════════════════════
// economia-report-ui.js — ASD Basket Campodarsego
// Report Bilancio (eco-04): saldi per centro di costo, per categoria,
// dettaglio per sottocategoria. Vista a schermo + stampabile con logo.
// Creato il 22/08/2026. Dipende da: economia-core-DRAFT.js (nessuna
// funzione pura specifica qui, calcolo self-contained) e da funzioni
// già in basket-core.js: nowStr(), _apriStampa(), _LOGO_B64.
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
  var elTabContent = document.getElementById('eco-tab-content');
  var elSeedBar = document.getElementById('eco-seed-bar');
  var elBilancioWrap = document.getElementById('eco-bilancio-wrap');
  if (elTabContent) elTabContent.style.display = isBilancio ? 'none' : '';
  if (elSeedBar) elSeedBar.style.display = isBilancio ? 'none' : '';
  if (elBilancioWrap) elBilancioWrap.style.display = isBilancio ? '' : 'none';
  ['categorie', 'sottocategorie', 'centriCosto', 'bilancio'].forEach(function (t) {
    var btn = document.getElementById('eco-tab-btn-' + t);
    if (btn) btn.style.fontWeight = (t === sezione) ? 'bold' : 'normal';
  });
  if (isBilancio) {
    ecoRepPopolaAnni();
  } else if (typeof ecoMostraTab === 'function') {
    ecoMostraTab(sezione);
  }
}

function ecoRepPopolaAnni() {
  var sel = document.getElementById('eco-rep-anno');
  if (!sel) return;
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
    col.doc('economia').collection('movimenti').where('annoEsercizio', '==', ecoRepAnno).get()
  ]).then(function (res) {
    var config = { categorie: [], sottocategorie: [], centriCosto: [] };
    if (res[0].exists && res[0].data().v) {
      try {
        var parsed = JSON.parse(res[0].data().v);
        if (parsed && typeof parsed === 'object') config = parsed;
      } catch (ex) {
        console.error('[economia-report] errore parsing economiaConfig', ex);
        if (typeof log === 'function') log('[economia-report] errore parsing economiaConfig: ' + ex.message, 'err');
      }
    }
    if (!config.categorie) config.categorie = [];
    if (!config.sottocategorie) config.sottocategorie = [];
    if (!config.centriCosto) config.centriCosto = [];
    var movimenti = [];
    res[1].forEach(function (doc) { movimenti.push(doc.data()); });
    var dati = ecoRepCalcola(movimenti, config);
    ecoRepRender(dati, ecoRepAnno);
    if (typeof log === 'function') log('Bilancio ' + ecoRepAnno + ': ' + movimenti.length + ' movimenti letti', 'ok');
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
function ecoRepCalcola(movimenti, config) {
  config = config || { categorie: [], sottocategorie: [], centriCosto: [] };
  var attivi = (movimenti || []).filter(function (m) {
    return m.stato === 'PAGATO' || m.stato === 'PARZIALE';
  });

  function nomeCategoria(codice) {
    var c = config.categorie.find(function (x) { return x.codice === codice; });
    return c ? c.descrizione : (codice === '(nessuna)' ? 'Senza categoria' : codice);
  }
  function nomeSottocategoria(codice) {
    var s = config.sottocategorie.find(function (x) { return x.codice === codice; });
    return s ? s.descrizione : codice;
  }
  function nomeCentroCosto(codice) {
    var c = config.centriCosto.find(function (x) { return x.codice === codice; });
    return c ? c.descrizione : (codice === '(nessuno)' ? 'Senza centro di costo' : codice);
  }

  // Raggruppa un elenco di movimenti (già filtrati per centro+tipo) in
  // categorie con sottocategorie annidate. Ritorna { totale, categorie:[...] }.
  function raggruppaPerCategoria(elenco) {
    var catMap = {};
    elenco.forEach(function (m) {
      var key = m.categoriaCodice || '(nessuna)';
      if (!catMap[key]) catMap[key] = { totale: 0, sotto: {} };
      var imp = Number(m.importoEur) || 0;
      catMap[key].totale += imp;
      var subKey = m.sottocategoriaCodice || null;
      if (subKey) {
        if (!catMap[key].sotto[subKey]) catMap[key].sotto[subKey] = 0;
        catMap[key].sotto[subKey] += imp;
      }
    });
    var categorie = Object.keys(catMap).map(function (codice) {
      var entry = catMap[codice];
      var sottocategorie = Object.keys(entry.sotto).map(function (subCod) {
        return { codice: subCod, descrizione: nomeSottocategoria(subCod), totale: entry.sotto[subCod] };
      }).sort(function (a, b) { return b.totale - a.totale; });
      return { codice: codice, descrizione: nomeCategoria(codice), totale: entry.totale, sottocategorie: sottocategorie };
    }).sort(function (a, b) { return b.totale - a.totale; });
    var totale = categorie.reduce(function (s, c) { return s + c.totale; }, 0);
    return { totale: totale, categorie: categorie };
  }

  // Raggruppa TUTTI i movimenti attivi per centro di costo
  var ccGroups = {};
  attivi.forEach(function (m) {
    var key = m.centroCostoCodice || '(nessuno)';
    if (!ccGroups[key]) ccGroups[key] = [];
    ccGroups[key].push(m);
  });

  var perCentroCosto = Object.keys(ccGroups).map(function (codiceCc) {
    var movCc = ccGroups[codiceCc];
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
      'font-weight:bold;font-size:12.5px;border-top:1px solid #ccc;}' +
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
