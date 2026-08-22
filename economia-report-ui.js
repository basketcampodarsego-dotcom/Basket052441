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
// ANNULLATO e DA_PAGARE non entrano nel consuntivo. ──
function ecoRepCalcola(movimenti, config) {
  config = config || { categorie: [], sottocategorie: [], centriCosto: [] };
  var attivi = (movimenti || []).filter(function (m) {
    return m.stato === 'PAGATO' || m.stato === 'PARZIALE';
  });

  function nuovoAgg() { return { entrate: 0, uscite: 0 }; }
  function accumula(agg, m) {
    var imp = Number(m.importoEur) || 0;
    if (m.tipoMovimento === 'ENTRATA') agg.entrate += imp; else agg.uscite += imp;
  }
  function conSaldo(agg) { return { entrate: agg.entrate, uscite: agg.uscite, saldo: agg.entrate - agg.uscite }; }

  // Per centro di costo
  var ccMap = {};
  attivi.forEach(function (m) {
    var key = m.centroCostoCodice || '(nessuno)';
    if (!ccMap[key]) ccMap[key] = nuovoAgg();
    accumula(ccMap[key], m);
  });
  var perCentroCosto = Object.keys(ccMap).map(function (codice) {
    var cc = config.centriCosto.find(function (c) { return c.codice === codice; });
    var s = conSaldo(ccMap[codice]);
    s.codice = codice;
    s.descrizione = cc ? cc.descrizione : (codice === '(nessuno)' ? 'Nessun centro di costo' : codice);
    return s;
  }).sort(function (a, b) { return (b.entrate + b.uscite) - (a.entrate + a.uscite); });

  // Per categoria, con dettaglio sottocategorie annidato
  var catMap = {};
  attivi.forEach(function (m) {
    var key = m.categoriaCodice || '(nessuna)';
    if (!catMap[key]) catMap[key] = { agg: nuovoAgg(), sotto: {} };
    accumula(catMap[key].agg, m);
    var subKey = m.sottocategoriaCodice || null;
    if (subKey) {
      if (!catMap[key].sotto[subKey]) catMap[key].sotto[subKey] = nuovoAgg();
      accumula(catMap[key].sotto[subKey], m);
    }
  });
  var perCategoria = Object.keys(catMap).map(function (codice) {
    var cat = config.categorie.find(function (c) { return c.codice === codice; });
    var entry = catMap[codice];
    var sottocategorie = Object.keys(entry.sotto).map(function (subCod) {
      var sub = config.sottocategorie.find(function (s) { return s.codice === subCod; });
      var s = conSaldo(entry.sotto[subCod]);
      s.codice = subCod;
      s.descrizione = sub ? sub.descrizione : subCod;
      return s;
    }).sort(function (a, b) { return (b.entrate + b.uscite) - (a.entrate + a.uscite); });
    var s = conSaldo(entry.agg);
    s.codice = codice;
    s.descrizione = cat ? cat.descrizione : (codice === '(nessuna)' ? 'Nessuna categoria' : codice);
    s.sottocategorie = sottocategorie;
    return s;
  }).sort(function (a, b) { return (b.entrate + b.uscite) - (a.entrate + a.uscite); });

  var totEntrate = attivi.filter(function (m) { return m.tipoMovimento === 'ENTRATA'; })
    .reduce(function (s, m) { return s + (Number(m.importoEur) || 0); }, 0);
  var totUscite = attivi.filter(function (m) { return m.tipoMovimento === 'USCITA'; })
    .reduce(function (s, m) { return s + (Number(m.importoEur) || 0); }, 0);

  return {
    perCentroCosto: perCentroCosto,
    perCategoria: perCategoria,
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

function ecoRepEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function ecoRepEuro(n) {
  return '&euro; ' + (Number(n) || 0).toFixed(2);
}

// ── Stesso pattern CSS/markup di _renderReportSoci() (classe .rpt, header
// con logo _LOGO_B64) — coerenza visiva con gli altri report del gestionale. ──
function ecoRepBuildHtml(dati, anno) {
  var CSS = '<style>.rpt{font-family:Arial,sans-serif;font-size:12px;color:#111;max-width:900px}' +
    '.rpt h1{font-size:16px;font-weight:bold;margin-bottom:4px}' +
    '.rpt h2{font-size:13px;font-weight:bold;margin:16px 0 6px;border-bottom:2px solid #1a2a4a;padding-bottom:3px;color:#1a2a4a}' +
    '.rpt table{border-collapse:collapse;width:100%;margin-bottom:12px}' +
    '.rpt th{background:#1a2a4a;color:#fff;padding:5px 8px;text-align:right;font-size:11px}' +
    '.rpt th.left{text-align:left}' +
    '.rpt td{padding:4px 8px;border:1px solid #ccc;font-size:11px;text-align:right}' +
    '.rpt td.left{text-align:left}' +
    '.rpt tr.tot{background:#e8f0ff;font-weight:bold}' +
    '.rpt tr.sub td.left{padding-left:22px;color:#555}' +
    '.rpt tr.sub{background:#f7f9ff}' +
    '.rpt .meta{font-size:11px;color:#666;margin-bottom:12px;text-align:center}</style>';

  var html = CSS + '<div class="rpt">';
  html += '<div style="text-align:center;margin-bottom:8px">';
  if (typeof _LOGO_B64 !== 'undefined' && _LOGO_B64) {
    html += '<img src="data:image/jpeg;base64,' + _LOGO_B64 + '" style="height:60px;" alt="Logo">';
  }
  html += '</div>';
  html += '<h1 style="text-align:center">A.S.D. Basket Campodarsego<br>' +
    '<span style="font-size:14px;font-weight:normal">Bilancio consuntivo esercizio ' + anno + '</span></h1>';
  html += '<div class="meta">Data generazione: ' + (typeof nowStr === 'function' ? nowStr() : new Date().toLocaleDateString('it-IT')) + '</div>';

  html += '<h2>Riepilogo generale</h2>';
  html += '<table><tbody>';
  html += '<tr><td class="left">Totale Entrate</td><td>' + ecoRepEuro(dati.totEntrate) + '</td></tr>';
  html += '<tr><td class="left">Totale Uscite</td><td>' + ecoRepEuro(dati.totUscite) + '</td></tr>';
  html += '<tr class="tot"><td class="left">Saldo esercizio</td><td>' + ecoRepEuro(dati.saldoEsercizio) + '</td></tr>';
  html += '</tbody></table>';

  html += '<h2>Per centro di costo</h2>';
  if (!dati.perCentroCosto.length) {
    html += '<p style="color:#888">Nessun movimento con centro di costo per questo esercizio.</p>';
  } else {
    html += '<table><thead><tr><th class="left">Centro di costo</th><th>Entrate</th><th>Uscite</th><th>Saldo</th></tr></thead><tbody>';
    dati.perCentroCosto.forEach(function (r) {
      html += '<tr><td class="left">' + ecoRepEsc(r.descrizione) + '</td><td>' + ecoRepEuro(r.entrate) + '</td><td>' + ecoRepEuro(r.uscite) + '</td><td>' + ecoRepEuro(r.saldo) + '</td></tr>';
    });
    html += '</tbody></table>';
  }

  html += '<h2>Per categoria</h2>';
  if (!dati.perCategoria.length) {
    html += '<p style="color:#888">Nessun movimento registrato per questo esercizio.</p>';
  } else {
    html += '<table><thead><tr><th class="left">Categoria / Sottocategoria</th><th>Entrate</th><th>Uscite</th><th>Saldo</th></tr></thead><tbody>';
    dati.perCategoria.forEach(function (cat) {
      html += '<tr><td class="left"><strong>' + ecoRepEsc(cat.descrizione) + '</strong></td><td>' + ecoRepEuro(cat.entrate) + '</td><td>' + ecoRepEuro(cat.uscite) + '</td><td>' + ecoRepEuro(cat.saldo) + '</td></tr>';
      cat.sottocategorie.forEach(function (sub) {
        html += '<tr class="sub"><td class="left">' + ecoRepEsc(sub.descrizione) + '</td><td>' + ecoRepEuro(sub.entrate) + '</td><td>' + ecoRepEuro(sub.uscite) + '</td><td>' + ecoRepEuro(sub.saldo) + '</td></tr>';
      });
    });
    html += '</tbody></table>';
  }
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
