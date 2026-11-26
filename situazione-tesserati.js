// situazione-tesserati.js | v0.2 · 26/11/2026 11:45 · BK
// v0.2: (Alberto 26/11/2026: la stampa usciva verticale) 🖨️ Stampa ora crea un PDF A4 ORIZZONTALE
//       con jsPDF (l'orientamento non dipende piu' dal browser/telefono): intestazione colonne
//       ripetuta su ogni pagina, colori, totali, "Pagina X di Y". La vecchia stampa HTML resta in stStampaHTML.
// v0.1: SITUAZIONE TESSERATI (richiesta Alberto 26/11/2026): accesso rapido a video e in stampa,
//       per categoria o per annata: documenti (modulo, carta id., tessera san.), certificato
//       con stato (giallo = entro 30 gg, rosso = scaduto/mancante), residenza, quota, rate
//       pagate con data, residuo, note. Totali per gruppo e generali. Stampa A4 orizzontale + CSV.
//       Solo lettura: non scrive nulla nel database.
// Dipende da: DB (gestionale), basket-core.js (esc, _annoNascitaAtleta, _catMultiplaAtleta,
//             _statoCertificato, _comuneAtleta, _isoLocale). Usa _apriStampa se presente.

var ST_QUOTE_CAT = { Pulcini: 200, Scoiattoli: 340, Aquilotti: 340, Esordienti: 340, Special: 340, AmaBasket: 20, AmaVolley: 0, Dirigente: 0, Volontario: 0, Ex: 0 };
var ST_ORDINE_CAT = ['Pulcini', 'Scoiattoli', 'Aquilotti', 'Esordienti', 'Special', 'AmaBasket', 'AmaVolley', 'Dirigente', 'Volontario', 'Ex'];
var ST_MINI = /^(Pulcini|Scoiattoli|Aquilotti|Esordienti)$/;
var _stStato = { stag: '', gruppo: 'categoria', cat: 'MINI', annata: '', ritirati: false };

function _stEsc(s) { return typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _stData(iso) { if (!iso) return ''; var s = String(iso).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : s; }
function _stEuro(n) { return n == null ? '—' : '€ ' + (Math.round(n * 100) / 100).toFixed(2).replace('.', ','); }

// stagioni presenti nelle iscrizioni (formato come salvato, es. "2026-27")
function stStagioni() {
  var v = {};
  (DB && DB.atleti || []).forEach(function (a) { (a.iscrizioni || []).forEach(function (i) { if (i.anno) v[i.anno] = 1; }); });
  return Object.keys(v).sort().reverse();
}
function _stStagioneDefault(lista) {
  var o = new Date(), y = o.getMonth() >= 8 ? o.getFullYear() : o.getFullYear() - 1;
  return lista.find(function (s) { return String(s).slice(0, 4) === String(y); }) || lista[0] || '';
}
function _stPeriodo(stag) { var y = parseInt(String(stag).slice(0, 4), 10); return { da: y + '-09-01', a: (y + 1) + '-08-31' }; }

function _stCategorie(a, stag) {
  if (typeof _catMultiplaAtleta === 'function') return _catMultiplaAtleta(a, stag);
  var out = [];
  (a.iscrizioni || []).forEach(function (i) { if (i.anno === stag) { if (i.cat1 && out.indexOf(i.cat1) < 0) out.push(i.cat1); if (i.cat2 && out.indexOf(i.cat2) < 0) out.push(i.cat2); } });
  return out;
}
// stessa regola del dittafono (dfgQuotaDovuta): quotaAnnua se compilata, altrimenti da categoria (-20% fratello nel minibasket)
function _stQuota(a, cats) {
  if (a.quotaAnnua !== undefined && a.quotaAnnua !== null && a.quotaAnnua !== '') return Number(a.quotaAnnua) || 0;
  if (a.specialPartner) return null;
  var base = null;
  cats.forEach(function (c) { if (ST_QUOTE_CAT[c] != null && (base === null || ST_QUOTE_CAT[c] > base)) base = ST_QUOTE_CAT[c]; });
  if (base === null) return null;
  var mini = cats.some(function (c) { return ST_MINI.test(c); });
  return Math.round(base * (a.scontoFratello && mini ? 0.8 : 1) * 100) / 100;
}
// rate della quota nella stagione (esclusi Divisa/Altro; Assicurazione solo per AmaBasket), in ordine di data
function _stRate(a, cats, per) {
  var ama = cats.indexOf('AmaBasket') >= 0;
  return ((DB.pagamenti || {})[a.id] || []).filter(function (p) {
    if (!p || !p.data || p.data < per.da || p.data > per.a) return false;
    if (p.tipo === 'Divisa' || p.tipo === 'Altro') return false;
    if (p.tipo === 'Assicurazione' && !ama) return false;
    return true;
  }).sort(function (x, y) { return x.data.localeCompare(y.data); });
}

// righe della situazione per la stagione e i filtri scelti
function stCalcola(f) {
  var per = _stPeriodo(f.stag), oggi = typeof _isoLocale === 'function' ? _isoLocale(new Date()) : new Date().toISOString().slice(0, 10);
  var righe = [];
  (DB && DB.atleti || []).forEach(function (a) {
    if (!a || !a.cog) return;
    if (a.ritirato && !f.ritirati) return;
    var cats = _stCategorie(a, f.stag);
    if (!cats.length) return; // non iscritto in questa stagione
    if (f.cat === 'MINI' && !cats.some(function (c) { return ST_MINI.test(c); })) return;
    if (f.cat && f.cat !== 'MINI' && cats.indexOf(f.cat) < 0) return;
    var ann = typeof _annoNascitaAtleta === 'function' ? _annoNascitaAtleta(a) : null;
    if (f.annata && String(ann) !== String(f.annata)) return;
    var d = a.docConsegnati || {};
    var quota = _stQuota(a, cats), rate = _stRate(a, cats, per);
    var pagato = Math.round(rate.reduce(function (s, p) { return s + (+p.importo || 0); }, 0) * 100) / 100;
    righe.push({
      a: a, nome: ((a.cog || '') + ' ' + (a.nom || '')).trim(), annata: ann || '', dn: a.dn || '',
      cat: (f.cat && f.cat !== 'MINI' ? f.cat : f.cat === 'MINI' ? cats.filter(function (c) { return ST_MINI.test(c); })[0] : cats[0]), cats: cats,
      modulo: d.modulo === 'SI', identita: d.identita === 'SI', tessera: d.tessera === 'SI',
      cs: a.cs || '', statoCs: typeof _statoCertificato === 'function' ? _statoCertificato(a.cs, oggi) : (a.cs ? 'OK' : 'MANCA'),
      comune: typeof _comuneAtleta === 'function' ? _comuneAtleta(a) : (a.indComune || ''),
      quota: quota, rate: rate, pagato: pagato, residuo: quota == null ? null : Math.round((quota - pagato) * 100) / 100,
      note: a.note || '', ritirato: !!a.ritirato
    });
  });
  var chiave = f.gruppo === 'annata'
    ? function (r) { return r.annata ? String(r.annata) : 'Annata mancante'; }
    : function (r) { return r.cat; };
  var ordG = function (k) { var i = ST_ORDINE_CAT.indexOf(k); return f.gruppo === 'annata' ? (k === 'Annata mancante' ? '9999' : k) : (i < 0 ? 'z' + k : String(10 + i)); };
  righe.sort(function (x, y) {
    var gx = ordG(chiave(x)), gy = ordG(chiave(y));
    if (gx !== gy) return gx < gy ? -1 : 1;
    if (f.gruppo === 'categoria' && String(x.annata) !== String(y.annata)) return String(x.annata || '9999') < String(y.annata || '9999') ? -1 : 1;
    return x.nome.localeCompare(y.nome);
  });
  var gruppi = [];
  righe.forEach(function (r) {
    var k = chiave(r), g = gruppi[gruppi.length - 1];
    if (!g || g.nome !== k) { g = { nome: k, righe: [] }; gruppi.push(g); }
    g.righe.push(r);
  });
  var maxRate = righe.reduce(function (m, r) { return Math.max(m, r.rate.length); }, 0);
  return { gruppi: gruppi, righe: righe, maxRate: Math.max(2, maxRate), oggi: oggi };
}

function _stTotali(righe) {
  var t = { n: righe.length, quota: 0, pagato: 0, residuo: 0, certKo: 0, docKo: 0, quotaND: 0 };
  righe.forEach(function (r) {
    if (r.quota == null) t.quotaND++; else { t.quota += r.quota; t.residuo += Math.max(0, r.residuo); }
    t.pagato += r.pagato;
    if (r.statoCs !== 'OK') t.certKo++;
    if (!(r.modulo && r.identita && r.tessera)) t.docKo++;
  });
  return t;
}

// tabella HTML (stessa per video e stampa)
function stTabellaHTML(res) {
  var nR = res.maxRate, X = function (b) { return b ? '<td class="st-c">X</td>' : '<td class="st-c st-ko"></td>'; };
  var h = '<table class="st-t"><thead><tr><th>Annata</th><th>Atleta</th><th>Nascita</th><th>Categoria</th>' +
    '<th>Modulo</th><th>Carta id.</th><th>Tess. san.</th><th>Scad. cert.</th><th>Stato cert.</th><th>Residenza</th><th>Quota</th>';
  for (var i = 1; i <= nR; i++) h += '<th>' + i + 'ª rata</th><th>Data ' + i + 'ª</th>';
  h += '<th>Residuo</th><th>Note</th></tr></thead><tbody>';
  var nCol = 13 + nR * 2;
  res.gruppi.forEach(function (g) {
    h += '<tr class="st-g"><td colspan="' + nCol + '">' + _stEsc(g.nome) + ' · ' + g.righe.length + ' atleti</td></tr>';
    g.righe.forEach(function (r) {
      var sc = r.statoCs === 'OK' ? '' : r.statoCs === 'IN SCADENZA' ? ' st-warn' : ' st-ko';
      h += '<tr' + (r.ritirato ? ' class="st-rit"' : '') + '><td class="st-c">' + _stEsc(r.annata) + '</td><td class="st-n">' + _stEsc(r.nome) + (r.ritirato ? ' (rit.)' : '') + '</td>' +
        '<td class="st-c' + (r.dn ? '' : ' st-ko') + '">' + _stEsc(_stData(r.dn)) + '</td><td>' + _stEsc(r.cats.join(' / ')) + '</td>' +
        X(r.modulo) + X(r.identita) + X(r.tessera) +
        '<td class="st-c' + sc + '">' + _stEsc(_stData(r.cs)) + '</td><td class="st-c' + sc + '">' + _stEsc(r.statoCs) + '</td>' +
        '<td' + (r.comune ? '' : ' class="st-ko"') + '>' + _stEsc(r.comune) + '</td><td class="st-r">' + _stEuro(r.quota) + '</td>';
      for (var k = 0; k < nR; k++) { var p = r.rate[k]; h += '<td class="st-r">' + (p ? _stEuro(+p.importo || 0) : '') + '</td><td class="st-c">' + (p ? _stData(p.data) : '') + '</td>'; }
      var rc = r.residuo == null ? '' : r.residuo > 0.005 ? ' st-warn' : r.residuo < -0.005 ? ' st-ko' : ' st-ok';
      h += '<td class="st-r' + rc + '">' + _stEuro(r.residuo) + '</td><td class="st-note">' + _stEsc(r.note) + '</td></tr>';
    });
    var t = _stTotali(g.righe);
    h += '<tr class="st-tot"><td colspan="10">Totale ' + _stEsc(g.nome) + ': ' + t.n + ' atleti · cert. da sistemare ' + t.certKo + ' · documenti incompleti ' + t.docKo + '</td>' +
      '<td class="st-r">' + _stEuro(t.quota) + '</td><td colspan="' + nR * 2 + '" class="st-r">pagato ' + _stEuro(t.pagato) + '</td><td class="st-r">' + _stEuro(t.residuo) + '</td><td></td></tr>';
  });
  var T = _stTotali(res.righe);
  h += '<tr class="st-tot st-totg"><td colspan="10">TOTALE GENERALE: ' + T.n + ' atleti · cert. da sistemare ' + T.certKo + ' · documenti incompleti ' + T.docKo + (T.quotaND ? ' · quota da decidere ' + T.quotaND : '') + '</td>' +
    '<td class="st-r">' + _stEuro(T.quota) + '</td><td colspan="' + nR * 2 + '" class="st-r">pagato ' + _stEuro(T.pagato) + '</td><td class="st-r">' + _stEuro(T.residuo) + '</td><td></td></tr>';
  return h + '</tbody></table>';
}

var ST_CSS = '.st-t{border-collapse:collapse;font-size:11px;width:100%}' +
  '.st-t th,.st-t td{border:1px solid #c8cfdb;padding:3px 4px;vertical-align:top}' +
  '.st-t th{background:#1a2a4a;color:#fff;font-weight:600;white-space:nowrap}' +
  '.st-c{text-align:center;white-space:nowrap}.st-r{text-align:right;white-space:nowrap}.st-n{white-space:nowrap;font-weight:600}' +
  '.st-note{min-width:120px;font-size:10px}.st-g td{background:#dfe6f2;font-weight:700;color:#1a2a4a}' +
  '.st-ko{background:#f8d0d0}.st-warn{background:#fdf0b0}.st-ok{color:#1a7a3a}.st-rit td{color:#888}' +
  '.st-tot td{background:#f2f4f8;font-weight:600}.st-totg td{background:#e4e9f2;font-weight:700}';

function _stTitolo(f) {
  var c = f.cat === 'MINI' ? 'Minibasket' : f.cat || 'Tutte le categorie';
  return 'ASD Basket Campodarsego – Situazione tesserati ' + c + (f.annata ? ' annata ' + f.annata : '') +
    ' – stagione ' + f.stag + ' – per ' + (f.gruppo === 'annata' ? 'annata' : 'categoria');
}

// pagina a video
function stRender() {
  var box = document.getElementById('st-box'); if (!box) return;
  var tb = document.getElementById('tb-title'); if (tb) tb.textContent = 'Situazione tesserati';
  if (!DB || !DB.atleti || !DB.atleti.length) { box.innerHTML = '<div class="card">Dati non ancora caricati.</div>'; return; }
  var stags = stStagioni();
  if (!_stStato.stag || stags.indexOf(_stStato.stag) < 0) _stStato.stag = _stStagioneDefault(stags);
  var annate = {};
  (DB.atleti || []).forEach(function (a) { if (_stCategorie(a, _stStato.stag).length) { var y = typeof _annoNascitaAtleta === 'function' ? _annoNascitaAtleta(a) : null; if (y) annate[y] = 1; } });
  var opt = function (v, l, sel) { return '<option value="' + _stEsc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + _stEsc(l) + '</option>'; };
  var s = '<style>' + ST_CSS + '.st-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}.st-bar select{width:auto;min-height:0}</style>' +
    '<div class="st-bar">' +
    '<select onchange="_stStato.stag=this.value;stRender()">' + stags.map(function (x) { return opt(x, 'Stagione ' + x, _stStato.stag); }).join('') + '</select>' +
    '<select onchange="_stStato.gruppo=this.value;stRender()">' + opt('categoria', 'Per categoria', _stStato.gruppo) + opt('annata', 'Per annata', _stStato.gruppo) + '</select>' +
    '<select onchange="_stStato.cat=this.value;stRender()">' + opt('MINI', 'Solo minibasket', _stStato.cat) + opt('', 'Tutte le categorie', _stStato.cat) +
    ST_ORDINE_CAT.map(function (c) { return opt(c, c, _stStato.cat); }).join('') + '</select>' +
    '<select onchange="_stStato.annata=this.value;stRender()">' + opt('', 'Tutte le annate', _stStato.annata) +
    Object.keys(annate).sort().map(function (y) { return opt(y, 'Annata ' + y, _stStato.annata); }).join('') + '</select>' +
    '<label style="display:flex;gap:4px;align-items:center;font-size:12px;margin:0"><input type="checkbox" style="width:auto;min-height:0"' + (_stStato.ritirati ? ' checked' : '') + ' onchange="_stStato.ritirati=this.checked;stRender()"> anche ritirati</label>' +
    '<button class="btn btn-gold btn-sm" onclick="stStampa()">🖨️ Stampa PDF (A4 orizzontale)</button>' +
    '<button class="btn btn-gray btn-sm" onclick="stCSV()">⬇️ CSV</button></div>';
  var res = stCalcola(_stStato);
  s += '<div style="font-size:11px;color:#556;margin-bottom:6px">X = consegnato, vuoto = manca. Giallo = scade entro 30 gg / residuo da pagare, rosso = scaduto o mancante.</div>';
  s += res.righe.length ? '<div style="overflow-x:auto">' + stTabellaHTML(res) + '</div>' : '<div class="card">Nessun atleta con questi filtri.</div>';
  box.innerHTML = s;
  if (typeof diag === 'function') diag('Situazione tesserati: ' + res.righe.length + ' atleti, stagione ' + _stStato.stag, 'ok');
}
function stApri() { if (typeof goPage === 'function') goPage('situazione'); stRender(); }

function stStampaHTML() {
  var res = stCalcola(_stStato), tit = _stTitolo(_stStato);
  var html = '<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>' + _stEsc(tit) + '</title><style>' + ST_CSS +
    '@page{size:A4 landscape;margin:8mm}body{font-family:Arial,sans-serif;margin:0}h1{font-size:14px;margin:0 0 2px}.leg{font-size:10px;margin-bottom:6px}' +
    '.st-t{font-size:9px}.st-t th,.st-t td{padding:2px 3px}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}tr{page-break-inside:avoid}thead{display:table-header-group}' +
    '@media screen{.pb{margin:8px 0}}@media print{.pb{display:none}}</style></head><body>' +
    '<div class="pb"><button onclick="window.print()">🖨️ Stampa</button></div>' +
    '<h1>' + _stEsc(tit) + ' (aggiornato ' + _stData(res.oggi) + ')</h1>' +
    '<div class="leg">X = consegnato, vuoto = manca. Giallo = scade entro 30 gg / residuo da pagare, rosso = scaduto o mancante.</div>' +
    stTabellaHTML(res) + '</body></html>';
  if (typeof _apriStampa === 'function') _apriStampa(html, tit);
  else { var w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); } }
}

function stCSV() {
  var res = stCalcola(_stStato), nR = res.maxRate;
  var q = function (v) { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var n = function (v) { return v == null ? '' : (Math.round(v * 100) / 100).toFixed(2).replace('.', ','); };
  var hd = ['Gruppo', 'Annata', 'Atleta', 'Data nascita', 'Categoria', 'Modulo', 'Carta id.', 'Tess. san.', 'Scad. certificato', 'Stato cert.', 'Residenza', 'Quota'];
  for (var i = 1; i <= nR; i++) hd.push(i + 'a rata', 'Data ' + i + 'a rata');
  hd.push('Residuo', 'Note');
  var out = [hd.map(q).join(';')];
  res.gruppi.forEach(function (g) {
    g.righe.forEach(function (r) {
      var v = [g.nome, r.annata, r.nome, _stData(r.dn), r.cats.join(' / '), r.modulo ? 'X' : '', r.identita ? 'X' : '', r.tessera ? 'X' : '', _stData(r.cs), r.statoCs, r.comune, n(r.quota)];
      for (var k = 0; k < nR; k++) { var p = r.rate[k]; v.push(p ? n(+p.importo || 0) : '', p ? _stData(p.data) : ''); }
      v.push(n(r.residuo), r.note);
      out.push(v.map(q).join(';'));
    });
  });
  var el = document.createElement('a');
  el.href = URL.createObjectURL(new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  el.download = ('Situazione_tesserati_' + _stStato.stag + '_' + (_stStato.cat || 'tutte') + (_stStato.annata ? '_' + _stStato.annata : '')).replace(/[^\w-]+/g, '_') + '.csv';
  document.body.appendChild(el); el.click();
  setTimeout(function () { URL.revokeObjectURL(el.href); el.remove(); }, 1000);
}

// ── v0.2: PDF A4 orizzontale (jsPDF, gia' caricato nel gestionale) ──
function stStampa() {
  var J = window.jspdf && window.jspdf.jsPDF;
  if (!J) { stStampaHTML(); return; }
  var res = stCalcola(_stStato), tit = _stTitolo(_stStato), nR = res.maxRate;
  if (!res.righe.length) { alert('Nessun atleta con questi filtri.'); return; }
  var doc = new J({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  var W = 297, H = 210, M = 8, LARG = W - 2 * M, FS = 7, LH = 3.1;
  var cols = [['Annata', 9, 'c'], ['Atleta', 34, 'l'], ['Nascita', 15, 'c'], ['Categoria', 20, 'l'], ['Modulo', 9, 'c'], ['Carta id.', 9, 'c'], ['Tess. san.', 9, 'c'],
    ['Scad. cert.', 15, 'c'], ['Stato cert.', 17, 'c'], ['Residenza', 24, 'l'], ['Quota', 14, 'r']];
  for (var i = 1; i <= nR; i++) cols.push([i + '\u00aa rata', 14, 'r'], ['Data ' + i + '\u00aa', 15, 'c']);
  cols.push(['Residuo', 14, 'r']);
  var fisso = cols.reduce(function (t, c) { return t + c[1]; }, 0), note = LARG - fisso;
  if (note < 30) { var k = (LARG - 30) / fisso; cols.forEach(function (c) { c[1] = c[1] * k; }); note = 30; }
  cols.push(['Note', note, 'l']);
  var X = [], x0 = M; cols.forEach(function (c) { X.push(x0); x0 += c[1]; });
  var KO = [248, 208, 208], WARN = [253, 240, 176], y = 0;
  var cella = function (ci, yy, h, testo, fill, bold) {
    var c = cols[ci], x = X[ci];
    if (fill) { doc.setFillColor(fill[0], fill[1], fill[2]); doc.rect(x, yy, c[1], h, 'F'); }
    doc.setDrawColor(190, 198, 212); doc.rect(x, yy, c[1], h);
    if (testo == null || testo === '') return;
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    var righe = Array.isArray(testo) ? testo : [String(testo)];
    righe.forEach(function (t, j) {
      var ty = yy + 2.6 + j * LH;
      if (c[2] === 'r') doc.text(t, x + c[1] - 1, ty, { align: 'right' });
      else if (c[2] === 'c') doc.text(t, x + c[1] / 2, ty, { align: 'center' });
      else doc.text(t, x + 1, ty);
    });
  };
  var taglia = function (t, w) { t = String(t || ''); while (t && doc.getTextWidth(t) > w - 2) t = t.slice(0, -1); return t; };
  var intestazione = function () {
    doc.setTextColor(0); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(tit + ' (aggiornato ' + _stData(res.oggi) + ')', M, M + 3);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text('X = consegnato, vuoto = manca. Giallo = scade entro 30 gg / residuo da pagare, rosso = scaduto o mancante.', M, M + 7);
    y = M + 9; doc.setFontSize(FS);
    doc.setFillColor(26, 42, 74); doc.rect(M, y, LARG, 6, 'F'); doc.setTextColor(255);
    cols.forEach(function (c, ci) { doc.setFont('helvetica', 'bold'); var l = doc.splitTextToSize(c[0], c[1] - 1); l.forEach(function (t, j) { doc.text(t, X[ci] + c[1] / 2, y + 2.5 + j * 2.6, { align: 'center' }); }); });
    doc.setTextColor(0); y += 6;
  };
  var spazio = function (h) { if (y + h > H - M - 5) { doc.addPage(); intestazione(); } };
  var rigaTot = function (testo, t, fill) {
    spazio(5); doc.setFillColor(fill[0], fill[1], fill[2]); doc.rect(M, y, LARG, 5, 'F'); doc.setDrawColor(190, 198, 212); doc.rect(M, y, LARG, 5);
    doc.setFont('helvetica', 'bold'); doc.text(testo, M + 1, y + 3.4);
    var iq = 10, ir = cols.length - 2;
    doc.text(_stEuro(t.quota), X[iq] + cols[iq][1] - 1, y + 3.4, { align: 'right' });
    doc.text('pagato ' + _stEuro(t.pagato), X[ir] - 1, y + 3.4, { align: 'right' });
    doc.text(_stEuro(t.residuo), X[ir] + cols[ir][1] - 1, y + 3.4, { align: 'right' });
    y += 5;
  };
  intestazione();
  res.gruppi.forEach(function (g) {
    spazio(10);
    doc.setFillColor(223, 230, 242); doc.rect(M, y, LARG, 5, 'F'); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 42, 74);
    doc.text(g.nome + ' \u00b7 ' + g.righe.length + ' atleti', M + 1, y + 3.4); doc.setTextColor(0); y += 5;
    g.righe.forEach(function (r) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(FS);
      var nl = r.note ? doc.splitTextToSize(String(r.note).replace(/\s+/g, ' '), cols[cols.length - 1][1] - 2).slice(0, 4) : [];
      var h = Math.max(4.2, nl.length * LH + 1.2);
      spazio(h);
      var sc = r.statoCs === 'OK' ? null : r.statoCs === 'IN SCADENZA' ? WARN : KO;
      if (r.ritirato) doc.setTextColor(130);
      var v = [String(r.annata || ''), taglia(r.nome + (r.ritirato ? ' (rit.)' : ''), cols[1][1]), _stData(r.dn), taglia(r.cats.join(' / '), cols[3][1]),
        r.modulo ? 'X' : '', r.identita ? 'X' : '', r.tessera ? 'X' : '', _stData(r.cs), r.statoCs, taglia(r.comune, cols[9][1]), _stEuro(r.quota)];
      var f = [null, null, r.dn ? null : KO, null, r.modulo ? null : KO, r.identita ? null : KO, r.tessera ? null : KO, sc, sc, r.comune ? null : KO, null];
      for (var k = 0; k < nR; k++) { var p = r.rate[k]; v.push(p ? _stEuro(+p.importo || 0) : '', p ? _stData(p.data) : ''); f.push(null, null); }
      v.push(_stEuro(r.residuo)); f.push(r.residuo != null && r.residuo > 0.005 ? WARN : r.residuo != null && r.residuo < -0.005 ? KO : null);
      v.push(nl); f.push(null);
      v.forEach(function (t, ci) { cella(ci, y, h, t, f[ci], ci === 1); });
      doc.setTextColor(0); y += h;
    });
    var t = _stTotali(g.righe);
    rigaTot('Totale ' + g.nome + ': ' + t.n + ' atleti \u00b7 cert. da sistemare ' + t.certKo + ' \u00b7 documenti incompleti ' + t.docKo, t, [242, 244, 248]);
    y += 2;
  });
  var T = _stTotali(res.righe);
  rigaTot('TOTALE GENERALE: ' + T.n + ' atleti \u00b7 cert. da sistemare ' + T.certKo + ' \u00b7 documenti incompleti ' + T.docKo + (T.quotaND ? ' \u00b7 quota da decidere ' + T.quotaND : ''), T, [228, 233, 242]);
  var n = doc.getNumberOfPages();
  for (var pg = 1; pg <= n; pg++) { doc.setPage(pg); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text('Pagina ' + pg + ' di ' + n, W - M, H - 4, { align: 'right' }); }
  var nome = ('Situazione_tesserati_' + _stStato.stag + '_' + (_stStato.cat || 'tutte') + (_stStato.annata ? '_' + _stStato.annata : '')).replace(/[^\w-]+/g, '_') + '.pdf';
  doc.save(nome);
  if (typeof diag === 'function') diag('Situazione tesserati PDF: ' + nome + ', ' + n + ' pagine', 'ok');
}
