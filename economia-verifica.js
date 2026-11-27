// ════════════════════════════════════════════════════════
// FILE: economia-verifica.js — ASD Basket Campodarsego
// VERSIONE: v0.2 · 27/11/2026 00:45 · BK
// v0.2: (BK_ListaModifiche punto 16) Estratto gestionale PDF: colonna "Mezzo" con una lettera e legenda in fondo:
//   B bonifico (anche addebiti in conto) · T carta Tasca · C contanti societa' · R contanti del presidente da
//   rimborsare · P PostePay del presidente · G giroconto conto -> carta Tasca · ? non indicato (da sistemare).
// v0.1: VERIFICA ALLINEAMENTO (Alberto 25/11/2026: "ho il sospetto che le registrazioni
//   in database siano confuse, doppie o mancanti").
//   1) Confronto VOCE PER VOCE tra le righe degli estratti PDF (banca BCC + carta Tasca,
//      anche piu' file insieme) e i movimenti del database sui conti di tipo BANCA:
//      - abbinati (riferimento / stessa descrizione / importo+data entro 3 giorni);
//      - abbinati con DATA DIVERSA (stesso importo entro 10 giorni) -> da controllare;
//      - MANCANTI: riga dell'estratto senza movimento;
//      - DOPPI: secondo movimento sulla stessa riga dell'estratto (annullabile);
//      - SOLO NEL DATABASE: movimento su conto banca, nel periodo, che non c'e' negli estratti;
//      - CASSA SOSPETTI: movimento in cassa con stesso importo e data di una riga
//        dell'estratto (registrato due volte con conti diversi?).
//      Rimborsi ad Alberto con bonifico: le spese dello stesso rimborso valgono come UN
//      bonifico (totale), come in banca.
//   2) ESTRATTO GESTIONALE in PDF per conto (Banca o Cassa), periodo dal/al, con saldo
//      progressivo e "Pagina X di Y" (regola tabulati).
//   Solo lettura, salvo "Annulla doppione" (stato ANNULLATO con motivo, mai cancellazione).
// Dipende da: economia-import-banca.js / -carta.js / -ui.js (lettura PDF e righe),
//   economia-core-DRAFT.js (ecoAnnullaMovimento), economia-movimenti-ui.js (ecoColMovimenti,
//   ecoConti, ecoSalvaDocMovimento), jsPDF, diag().
// ════════════════════════════════════════════════════════

var ECO_VER_VERSIONE = 'v0.1 · 25/11/2026 11:30';
var ECO_VER = { righe: [], movimenti: [], conti: [], esito: null, file: [] };

function _ecoVerNorm(x) { return String(x || '').toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 200); }
function _ecoVerGiorni(a, b) { var x = Date.parse(a), y = Date.parse(b); return isNaN(x) || isNaN(y) ? 9999 : Math.round(Math.abs(x - y) / 86400000); }
function _ecoVerImp(m) { return Math.round((m.tipoMovimento === 'ENTRATA' ? 1 : -1) * (+m.importoEur || 0) * 100) / 100; }
function _ecoVerData(m) { return m.dataPagamento || m.dataDocumento || ''; }

// ── Confronto (funzione pura) ──
// righe: [{fonte:'BANCA'|'CARTA', data, valuta, importo (con segno), descrizione, riferimento}]
// movimenti: tutti i movimenti; conti: [{id, tipo}]
function ecoVerConfronta(righe, movimenti, conti) {
  var idBanca = {}, idCassa = {};
  (conti || []).forEach(function (c) { if (c.tipo === 'BANCA') idBanca[c.id] = 1; if (c.tipo === 'CASSA') idCassa[c.id] = 1; });
  var date = righe.map(function (r) { return r.data; }).filter(Boolean).sort();
  var da = date[0] || '', a = date[date.length - 1] || '';
  var vivi = (movimenti || []).filter(function (m) { return m && m.stato !== 'ANNULLATO' && m.stato !== 'DA_PAGARE'; });
  // voci del database sui conti banca (rimborsi con bonifico raggruppati)
  var voci = [], gruppi = {};
  vivi.forEach(function (m) {
    if (!idBanca[m.contoFinanziarioId]) return;
    if (m.rimborso && m.rimborso.gruppoId && m.metodoPagamento === 'bonifico') {
      var g = gruppi[m.rimborso.gruppoId];
      if (!g) { g = gruppi[m.rimborso.gruppoId] = { id: 'RIMB:' + m.rimborso.gruppoId, gruppo: true, movs: [], importo: 0, data: m.rimborso.data || _ecoVerData(m), descrizione: 'Rimborso spese ad Alberto (' + (m.rimborso.spese || '') + ' spese)', numero: m.rimborso.gruppoId }; voci.push(g); }
      g.movs.push(m); g.importo = Math.round((g.importo - (+m.importoEur || 0)) * 100) / 100; return;
    }
    voci.push({ id: m.id, m: m, movs: [m], importo: _ecoVerImp(m), data: _ecoVerData(m), descrizione: m.descrizioneEstratto || m.note || '', numero: m.numeroMovimento || m.id, riferimento: m.riferimentoBancario || null, descEstratto: _ecoVerNorm(m.descrizioneEstratto) });
  });
  var abbinata = {}, usata = {}, abbinati = [], conDataDiversa = [];
  var diff = function (r, v) { return Math.min(_ecoVerGiorni(r.data, v.data), _ecoVerGiorni(r.valuta || r.data, v.data)); };
  var stessoImp = function (r, v) { return Math.abs(r.importo - v.importo) < 0.005; };
  var passa = function (nome, prova) {
    righe.forEach(function (r, i) {
      if (abbinata[i] !== undefined) return;
      var best = null, bestD = 9999;
      voci.forEach(function (v, k) { if (usata[k] || !stessoImp(r, v) || !prova(r, v)) return; var d = diff(r, v); if (d < bestD) { best = k; bestD = d; } });
      if (best === null) return;
      abbinata[i] = best; usata[best] = 1;
      (nome === 'data diversa' ? conDataDiversa : abbinati).push({ r: r, v: voci[best], criterio: nome, giorni: bestD });
    });
  };
  passa('riferimento', function (r, v) { return r.riferimento && v.riferimento && r.riferimento === v.riferimento; });
  passa('descrizione', function (r, v) { return v.descEstratto && v.descEstratto === _ecoVerNorm(r.descrizione) && diff(r, v) <= 3; });
  passa('importo e data', function (r, v) { return diff(r, v) <= 3; });
  passa('data diversa', function (r, v) { return diff(r, v) <= 10; });
  var mancanti = righe.filter(function (r, i) { return abbinata[i] === undefined; });
  // doppi: voce non usata che coincide con una riga gia' abbinata
  var doppi = [], soloDB = [];
  voci.forEach(function (v, k) {
    if (usata[k]) return;
    var riga = null;
    righe.forEach(function (r, i) {
      if (riga || abbinata[i] === undefined || !stessoImp(r, v)) return;
      if ((r.riferimento && v.riferimento === r.riferimento) || (v.descEstratto && v.descEstratto === _ecoVerNorm(r.descrizione)) || diff(r, v) <= 3) riga = { r: r, primo: voci[abbinata[i]] };
    });
    if (riga) doppi.push({ v: v, r: riga.r, primo: riga.primo });
    else if (v.data >= da && v.data <= a) soloDB.push(v);
  });
  // cassa: stesso importo (stesso segno) e data entro 3 giorni di una riga dell'estratto
  var cassaSospetti = [];
  vivi.forEach(function (m) {
    if (!idCassa[m.contoFinanziarioId]) return;
    var imp = _ecoVerImp(m), d = _ecoVerData(m);
    var r = righe.find(function (x) { return Math.abs(x.importo - imp) < 0.005 && _ecoVerGiorni(x.data, d) <= 3; });
    if (r) cassaSospetti.push({ m: m, r: r });
  });
  // totali per mese: estratti vs database (conti banca)
  var mesi = {};
  var add = function (ym, campo, imp) { var x = mesi[ym] = mesi[ym] || { estrEntr: 0, estrUsc: 0, dbEntr: 0, dbUsc: 0 }; x[campo] = Math.round((x[campo] + imp) * 100) / 100; };
  righe.forEach(function (r) { add(r.data.slice(0, 7), r.importo >= 0 ? 'estrEntr' : 'estrUsc', Math.abs(r.importo)); });
  voci.forEach(function (v) { if (v.data >= da && v.data <= a) add(v.data.slice(0, 7), v.importo >= 0 ? 'dbEntr' : 'dbUsc', Math.abs(v.importo)); });
  return { da: da, a: a, nRighe: righe.length, nVoci: voci.length, abbinati: abbinati, conDataDiversa: conDataDiversa, mancanti: mancanti, doppi: doppi, soloDB: soloDB, cassaSospetti: cassaSospetti, mesi: mesi };
}

// ── Lettura estratti (banca + carta) ──
function ecoVerOnFile(input) {
  var files = Array.from(input.files || []); input.value = '';
  var out = document.getElementById('eco-ver-esito');
  if (!files.length) return;
  if (typeof loadPdfJs !== 'function' || typeof ecoImportEstraiTestoPDF !== 'function') { diag('Verifica: lettore PDF non disponibile', 'err'); out.innerHTML = '<div style="color:var(--red)">Lettore PDF non disponibile.</div>'; return; }
  out.innerHTML = '<div style="color:var(--gold);padding:12px">Lettura di ' + files.length + ' PDF…</div>';
  loadPdfJs(function () {
    var fatti = 0, nuove = [];
    files.forEach(function (file) {
      ecoImportEstraiTestoPDF(file, function (txt, pagine) {
        try {
          var tipo = ecoImportRilevaTipoPDF(txt);
          var righe = tipo === 'CARTA' ? ecoImportEstraiRigheCarta(txt) : ecoImportEstraiRighe(ecoImportRiordinaRigheBanca(pagine));
          righe.forEach(function (r) {
            var rif = tipo === 'CARTA' ? null : ecoImportEstraiRiferimento(r.descrizione);
            nuove.push({ fonte: tipo === 'CARTA' ? 'CARTA' : 'BANCA', file: file.name, data: ecoImportISOData(r.dataContabile), valuta: ecoImportISOData(r.dataValuta), importo: Math.round(r.importo * 100) / 100, descrizione: r.descrizione, riferimento: rif ? rif.valore : null });
          });
          ECO_VER.file.push(file.name + ' (' + (tipo === 'CARTA' ? 'carta' : 'banca') + ', ' + righe.length + ' righe)');
        } catch (ex) { diag('Verifica: errore lettura ' + file.name + ': ' + ex.message, 'err'); }
        if (++fatti === files.length) ecoVerAggiungiRighe(nuove);
      }, function (err) {
        diag('Verifica: PDF ' + file.name + ' non letto: ' + err.message, 'err');
        if (++fatti === files.length) ecoVerAggiungiRighe(nuove);
      });
    });
  });
}
// stesse righe caricate due volte (stesso file o estratti sovrapposti) contano una volta
function ecoVerAggiungiRighe(nuove) {
  var chiave = function (r) { return r.fonte + '|' + r.data + '|' + r.importo + '|' + _ecoVerNorm(r.descrizione); };
  var visti = {}, contaEsist = {};
  ECO_VER.righe.forEach(function (r) { var k = chiave(r); contaEsist[k] = (contaEsist[k] || 0) + 1; });
  var perFile = {};
  nuove.forEach(function (r) { var k = chiave(r) + '|' + r.file; perFile[k] = (perFile[k] || 0) + 1; });
  // dentro lo stesso file le righe identiche sono operazioni vere; tra file diversi sono sovrapposizioni
  var tenute = 0, scartate = 0;
  Object.keys(perFile).forEach(function (kf) {
    var k = kf.slice(0, kf.lastIndexOf('|')), n = perFile[kf], gia = (contaEsist[k] || 0) + (visti[k] || 0);
    var daAggiungere = Math.max(0, n - gia);
    var campione = nuove.find(function (r) { return chiave(r) + '|' + r.file === kf; });
    for (var i = 0; i < daAggiungere; i++) ECO_VER.righe.push(campione);
    visti[k] = (visti[k] || 0) + daAggiungere; tenute += daAggiungere; scartate += n - daAggiungere;
  });
  diag('Verifica: ' + tenute + ' righe aggiunte, ' + scartate + ' gia\' presenti da altri file', 'info');
  ecoVerCalcola();
}
function ecoVerAzzera() { ECO_VER.righe = []; ECO_VER.file = []; ECO_VER.esito = null; document.getElementById('eco-ver-esito').innerHTML = ''; }

function ecoVerCaricaMovimenti(anni) {
  var col = window._db.collection('basket052441');
  return Promise.all([col.doc('economiaConti').get()].concat(anni.map(function (y) { return ecoColMovimenti().where('annoEsercizio', '==', y).get(); })))
    .then(function (res) {
      ECO_VER.conti = res[0].exists && res[0].data().v ? JSON.parse(res[0].data().v) : [];
      var movs = [];
      res.slice(1).forEach(function (snap) { snap.forEach(function (d) { movs.push(d.data()); }); });
      ECO_VER.movimenti = movs;
      return movs;
    });
}
function ecoVerCalcola() {
  var out = document.getElementById('eco-ver-esito');
  if (!ECO_VER.righe.length) { out.innerHTML = '<div style="color:var(--red)">Nessuna riga letta dagli estratti.</div>'; return; }
  var anni = {}; ECO_VER.righe.forEach(function (r) { var y = parseInt(r.data.slice(0, 4), 10); anni[y] = 1; anni[y + 1] = 1; anni[y - 1] = 1; });
  out.innerHTML = '<div style="color:var(--gold);padding:12px">Confronto con il database…</div>';
  ecoVerCaricaMovimenti(Object.keys(anni).map(Number)).then(function () {
    ECO_VER.esito = ecoVerConfronta(ECO_VER.righe, ECO_VER.movimenti, ECO_VER.conti);
    ecoVerRender();
  }).catch(function (err) { diag('Verifica: lettura database fallita: ' + err.message, 'err'); out.innerHTML = '<div style="color:var(--red)">Lettura database fallita: ' + ecoImportEsc(err.message) + '</div>'; });
}

function _ecoVerIt(iso) { return iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : ''; }
function _ecoVerEur(n) { return (n < 0 ? '-' : '') + '€' + Math.abs(n).toFixed(2).replace('.', ','); }
function _ecoVerRigaR(r) { return '<b>' + _ecoVerIt(r.data) + '</b> ' + _ecoVerEur(r.importo) + ' <span style="opacity:.7">[' + (r.fonte === 'CARTA' ? 'carta' : 'banca') + ']</span> ' + ecoImportEsc(String(r.descrizione).slice(0, 110)); }
function _ecoVerRigaV(v) { return 'n. ' + ecoImportEsc(v.numero) + ' del ' + _ecoVerIt(v.data) + ' ' + _ecoVerEur(v.importo) + ' — ' + ecoImportEsc(String(v.descrizione || '').slice(0, 90)); }
function ecoVerRender() {
  var e = ECO_VER.esito, out = document.getElementById('eco-ver-esito');
  var sez = function (titolo, colore, n, corpo, aperta) { return '<details' + (aperta ? ' open' : '') + ' style="margin:8px 0;border-left:3px solid ' + colore + ';padding-left:8px"><summary style="cursor:pointer;color:' + colore + ';font-weight:600">' + titolo + ' (' + n + ')</summary><div style="font-size:12px;line-height:1.5;margin-top:4px">' + (corpo || '<i>nessuno</i>') + '</div></details>'; };
  var h = '<div style="font-size:12px;opacity:.8">Estratti: ' + ecoImportEsc(ECO_VER.file.join(' · ')) + '<br>Periodo coperto: ' + _ecoVerIt(e.da) + ' – ' + _ecoVerIt(e.a) + ' · ' + e.nRighe + ' righe estratto · ' + e.nVoci + ' voci sui conti banca nel database</div>';
  h += sez('❌ Mancanti nel database (righe dell\'estratto senza movimento)', '#e03545', e.mancanti.length, e.mancanti.map(function (r) { return '<div>' + _ecoVerRigaR(r) + '</div>'; }).join(''), e.mancanti.length > 0);
  h += sez('🔁 Doppi nel database (secondo movimento sulla stessa riga)', '#c88a4b', e.doppi.length, e.doppi.map(function (d, i) {
    return '<div style="margin-bottom:6px">' + _ecoVerRigaR(d.r) + '<br>• già abbinato: ' + _ecoVerRigaV(d.primo) + '<br>• <b>doppio</b>: ' + _ecoVerRigaV(d.v) +
      (d.v.gruppo ? '' : ' <button class="btn btn-gray" style="font-size:11px;padding:2px 8px" onclick="ecoVerAnnullaDoppio(' + i + ')">Annulla questo doppione</button>') + '</div>';
  }).join(''), e.doppi.length > 0);
  h += sez('❓ Solo nel database (su conto banca, non negli estratti)', '#c8a84b', e.soloDB.length, e.soloDB.map(function (v) { return '<div>' + _ecoVerRigaV(v) + (v.m && v.m.daRiconciliare ? ' <i>(in attesa di estratto)</i>' : '') + '</div>'; }).join('') + (e.soloDB.length ? '<div style="opacity:.75;margin-top:4px">Possibili cause: registrato con il conto sbagliato (era cassa o carta personale?), data sbagliata, oppure doppione di un movimento con importo diverso.</div>' : ''), e.soloDB.length > 0);
  h += sez('📅 Abbinati ma con data diversa (4-10 giorni)', '#3a9bd5', e.conDataDiversa.length, e.conDataDiversa.map(function (x) { return '<div>' + _ecoVerRigaR(x.r) + '<br>↔ ' + _ecoVerRigaV(x.v) + ' (' + x.giorni + ' giorni)</div>'; }).join(''), false);
  h += sez('💶 Cassa: movimenti uguali a una riga dell\'estratto (registrati due volte?)', '#c86bd5', e.cassaSospetti.length, e.cassaSospetti.map(function (x) { return '<div>Cassa: n. ' + ecoImportEsc(x.m.numeroMovimento || x.m.id) + ' del ' + _ecoVerIt(_ecoVerData(x.m)) + ' ' + _ecoVerEur(_ecoVerImp(x.m)) + ' — ' + ecoImportEsc(String(x.m.note || '').slice(0, 80)) + '<br>↔ ' + _ecoVerRigaR(x.r) + '</div>'; }).join(''), e.cassaSospetti.length > 0);
  h += sez('✅ Abbinati', '#4aaa6a', e.abbinati.length, '', false);
  var ms = Object.keys(e.mesi).sort();
  h += '<div style="overflow-x:auto;margin-top:8px"><table style="width:100%;font-size:12px;border-collapse:collapse"><tr style="opacity:.75"><th style="text-align:left">Mese</th><th>Entrate estratto</th><th>Entrate DB</th><th>Uscite estratto</th><th>Uscite DB</th></tr>' +
    ms.map(function (k) { var x = e.mesi[k], ok = function (a, b) { return Math.abs(a - b) < 0.01 ? '' : ' style="color:#e03545;font-weight:600"'; };
      return '<tr><td>' + k.split('-').reverse().join('/') + '</td><td style="text-align:right">' + x.estrEntr.toFixed(2) + '</td><td style="text-align:right"' + ok(x.estrEntr, x.dbEntr) + '>' + x.dbEntr.toFixed(2) + '</td><td style="text-align:right">' + x.estrUsc.toFixed(2) + '</td><td style="text-align:right"' + ok(x.estrUsc, x.dbUsc) + '>' + x.dbUsc.toFixed(2) + '</td></tr>'; }).join('') + '</table></div>';
  h += '<div style="font-size:11px;opacity:.7;margin-top:6px">Per i mancanti: caricali con "Import movimenti Economia" qui sopra. La carta Tasca ha un suo conto? Se no, le sue spese stanno sul conto banca e vengono confrontate con l\'estratto carta.</div>';
  out.innerHTML = h;
  diag('Verifica: ' + e.abbinati.length + ' abbinati, ' + e.mancanti.length + ' mancanti, ' + e.doppi.length + ' doppi, ' + e.soloDB.length + ' solo DB, ' + e.cassaSospetti.length + ' cassa sospetti', (e.mancanti.length || e.doppi.length || e.soloDB.length) ? 'warn' : 'ok');
}
function ecoVerAnnullaDoppio(i) {
  var d = ECO_VER.esito && ECO_VER.esito.doppi[i]; if (!d || !d.v.m) return;
  var m = d.v.m;
  if (!confirm('Annullo il movimento n. ' + (m.numeroMovimento || m.id) + ' (' + _ecoVerEur(_ecoVerImp(m)) + ') come DOPPIONE?\nResta in archivio come ANNULLATO, non viene cancellato.')) return;
  var r = ecoAnnullaMovimento(m, 'Doppione individuato dalla verifica con l\'estratto (' + _ecoVerIt(d.r.data) + ' ' + _ecoVerEur(d.r.importo) + ')', (window.firebase && firebase.auth().currentUser) ? firebase.auth().currentUser.email : '');
  if (!r.ok) { alert(r.errore); return; }
  ecoSalvaDocMovimento(m, function () { diag('Verifica: doppione ' + (m.numeroMovimento || m.id) + ' annullato', 'ok'); ecoVerCalcola(); });
}

// ── ESTRATTO GESTIONALE PDF (per conto, con saldo progressivo) ──
// v0.2: lettera del mezzo di pagamento di un movimento
var ECO_VER_MEZZI = { B: 'bonifico (anche addebiti in conto)', T: 'carta Tasca', C: 'contanti della societa\'', R: 'contanti del presidente da rimborsare', P: 'PostePay del presidente', G: 'giroconto (conto -> carta Tasca)', '?': 'non indicato: da sistemare' };
function _ecoVerMezzo(m, tipoConto) {
  if (m.origine === 'GIROCONTO_RAPIDO' || /GIROCONTO/i.test(m.categoriaCodice || '')) return 'G';
  var mz = { BONIFICO: 'B', CARTA_TASCA: 'T', CONTANTI_CASSA: 'C', CONTANTI_PERSONALI: 'R', CARTA_PERSONALE: 'P' }[m.mezzoPagamento || ''];
  if (mz) return mz;
  if (m.riconciliaSu === 'CARTA' || m.fonte === 'CARTA') return 'T';
  var mt = String(m.metodoPagamento || '').toLowerCase();
  if (mt === 'bonifico') return 'B';
  if (mt === 'contanti') return tipoConto === 'CASSA' ? 'C' : '?';
  if (!mt) return tipoConto === 'CASSA' ? 'C' : '?';
  return '?'; // carta/POS/assegno/altro: mezzi non usati dall'ASD
}
function ecoVerEstrattoPDF() {
  var tipo = document.getElementById('eco-ver-conto').value, da = document.getElementById('eco-ver-da').value, a = document.getElementById('eco-ver-a').value;
  if (!da || !a || a < da) { alert('Indica il periodo (dal ... al ...).'); return; }
  var jsPDF = window.jspdf && window.jspdf.jsPDF; if (!jsPDF) { alert('jsPDF non disponibile'); return; }
  var y0 = parseInt(da.slice(0, 4), 10), y1 = parseInt(a.slice(0, 4), 10), anni = [];
  for (var y = y0 - 1; y <= y1 + 1; y++) anni.push(y);
  ecoVerCaricaMovimenti(anni).then(function (movs) {
    var conti = ECO_VER.conti.filter(function (c) { return c.tipo === tipo; });
    if (!conti.length) { alert('Nessun conto di tipo ' + tipo); return; }
    var ids = {}; conti.forEach(function (c) { ids[c.id] = 1; });
    var vivi = movs.filter(function (m) { return ids[m.contoFinanziarioId] && m.stato !== 'ANNULLATO' && (m.stato === 'PAGATO' || m.stato === 'PARZIALE'); });
    // saldo iniziale: saldo di apertura dell'esercizio (anno di "da") + movimenti di quell'anno prima di "da"
    var saldo = 0; conti.forEach(function (c) { saldo += +((c.saldoInizialeEsercizio || {})[y0] || 0); });
    vivi.forEach(function (m) { if (m.annoEsercizio === y0 && _ecoVerData(m) < da) saldo += _ecoVerImp(m); });
    saldo = Math.round(saldo * 100) / 100;
    var lista = vivi.filter(function (m) { var d = _ecoVerData(m); return d >= da && d <= a; }).sort(function (p, q) { return _ecoVerData(p).localeCompare(_ecoVerData(q)) || String(p.numeroMovimento || '').localeCompare(String(q.numeroMovimento || '')); });
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var Y = 0, entr = 0, usc = 0, conteMezzi = {};
    var testata = function () {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.text('ESTRATTO GESTIONALE — ' + (tipo === 'BANCA' ? 'CONTO BANCA' : 'CASSA CONTANTI') + ' · ASD Basket Campodarsego', 12, 14);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text('Periodo ' + _ecoVerIt(da) + ' – ' + _ecoVerIt(a) + ' · dati del gestionale (non della banca) · stampato il ' + new Date().toLocaleDateString('it-IT'), 12, 19);
      doc.setFillColor(235, 235, 235); doc.rect(10, 22, 190, 6, 'F'); doc.setFont('helvetica', 'bold');
      doc.text('Data', 11, 26); doc.text('N. mov.', 29, 26); doc.text('M.', 50, 26); doc.text('Descrizione', 57, 26); doc.text('Entrate', 150, 26, { align: 'right' }); doc.text('Uscite', 172, 26, { align: 'right' }); doc.text('Saldo', 198, 26, { align: 'right' });
      doc.setFont('helvetica', 'normal'); Y = 32;
    };
    testata();
    doc.text(_ecoVerIt(da), 11, Y); doc.text('Saldo iniziale', 52, Y); doc.text(saldo.toFixed(2), 198, Y, { align: 'right' }); Y += 5;
    lista.forEach(function (m) {
      if (Y > 280) { doc.addPage(); testata(); }
      var imp = _ecoVerImp(m); saldo = Math.round((saldo + imp) * 100) / 100; if (imp >= 0) entr += imp; else usc -= imp;
      var desc = String(m.descrizioneEstratto || m.note || m.categoriaCodice || '').replace(/\s+/g, ' ');
      doc.text(_ecoVerIt(_ecoVerData(m)), 11, Y); doc.text(String(m.numeroMovimento || '').slice(0, 12), 29, Y);
      var lett = _ecoVerMezzo(m, tipo); conteMezzi[lett] = (conteMezzi[lett] || 0) + 1;
      doc.setFont('helvetica', 'bold'); doc.text(lett, 51, Y); doc.setFont('helvetica', 'normal');
      doc.text((doc.splitTextToSize(desc, 79)[0] || ''), 57, Y);
      if (imp >= 0) doc.text(imp.toFixed(2), 150, Y, { align: 'right' }); else doc.text((-imp).toFixed(2), 172, Y, { align: 'right' });
      doc.text(saldo.toFixed(2), 198, Y, { align: 'right' });
      Y += 4.6; doc.setDrawColor(225); doc.line(10, Y - 3.4, 200, Y - 3.4);
    });
    if (Y > 270) { doc.addPage(); testata(); }
    Y += 3; doc.setFont('helvetica', 'bold');
    doc.text('Totali periodo (' + lista.length + ' movimenti)', 52, Y); doc.text(entr.toFixed(2), 150, Y, { align: 'right' }); doc.text(usc.toFixed(2), 172, Y, { align: 'right' }); doc.text(saldo.toFixed(2), 198, Y, { align: 'right' });
    // v0.2: legenda mezzi
    if (Y > 262) { doc.addPage(); testata(); }
    Y += 8; doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text('Legenda colonna M. (mezzo di pagamento):', 11, Y); doc.setFont('helvetica', 'normal');
    Object.keys(ECO_VER_MEZZI).forEach(function (k) { Y += 4; doc.text(k + ' = ' + ECO_VER_MEZZI[k] + (conteMezzi[k] ? '  (' + conteMezzi[k] + ')' : ''), 14, Y); });
    var n = doc.getNumberOfPages();
    for (var p = 1; p <= n; p++) { doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text('Pagina ' + p + ' di ' + n, 200, 292, { align: 'right' }); }
    var nome = 'Estratto_gestionale_' + tipo + '_' + da + '_' + a + '.pdf';
    doc.save(nome);
    diag('Estratto gestionale ' + tipo + ': ' + lista.length + ' movimenti, saldo finale ' + saldo.toFixed(2), 'ok');
  }).catch(function (err) { diag('Estratto gestionale non creato: ' + err.message, 'err'); alert('Estratto non creato: ' + err.message); });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { ecoVerConfronta: ecoVerConfronta };
