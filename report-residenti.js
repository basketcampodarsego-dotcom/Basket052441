// ════════════════════════════════════════════════════════
// FILE: report-residenti.js — ASD Basket Campodarsego
// VERSIONE: v0.1 · 20/11/2026 07:45 · BK
// v0.1: creazione (richiesta Alberto 20/11/2026). Report "Residenti" per
//   dimostrare al Comune la priorita' ai residenti (Capitolato §9: almeno il
//   50% degli iscritti sul totale e il 30% in ogni categoria Under 18).
//   Contenuto: % residenti sul totale; % residenti per ciascuna categoria
//   Under 18; elenco iscritti della stagione ordinato per data di
//   iscrizione con indicazione del residente; stampa (pag. N di M) e CSV.
// NESSUN CAMPO NUOVO IN ANAGRAFICA: i due dati richiesti esistono gia'.
//   - Data iscrizione: isc.dataIscr di ogni iscrizione stagionale (scheda
//     atleta -> Iscrizioni). Con piu' iscrizioni nella stessa stagione
//     (es. FIP e CSI) vale la data piu' vecchia.
//   - Residente a Campodarsego: ricavato dal Comune di residenza gia'
//     presente (_comuneAtleta in basket-core.js, con ripiego sul CAP 35011).
//     Un campo si/no separato sarebbe un doppione che prima o poi
//     contraddice l'indirizzo. Comune mancante -> "non indicato", contato
//     come NON residente e segnalato (mai una scelta silenziosa).
// Categorie: lette SOLO dal valore memorizzato nell'iscrizione
//   (_catMultiplaAtleta), mai ricalcolate. Under 18 = Pulcini, Scoiattoli,
//   Aquilotti, Esordienti, piu' gli atleti Special con meno di 18 anni al
//   31/12 dell'anno di inizio stagione.
// Privacy: elenco con soli nome, categoria, data iscrizione e residenza
//   (niente data di nascita, indirizzo o codice fiscale: sono minori).
// Dipende da: basket-core.js (DB, _comuneAtleta, _catMultiplaAtleta,
//   _LOGO_B64), variabile _CACHE dell'admin (stagione corrente/elenco).
// ════════════════════════════════════════════════════════

var RR_CAT_U18 = ['Pulcini', 'Scoiattoli', 'Aquilotti', 'Esordienti'];
var RR_CAT_NON_ATLETI = ['Dirigente', 'Volontario', 'Ex'];
var RR_SOGLIA_TOTALE = 50, RR_SOGLIA_U18 = 30;
// Campodarsego e le sue frazioni (Sant'Andrea, Reschigliano, Bronzola), CAP 35011
var RR_RE_COMUNE = /CAMPODARSEGO/;
var RR_RE_FRAZIONI = /RESCHIGLIANO|BRONZOLA|SANT\W*ANDREA/;
var RR_CAP = '35011';
var _rrUltimo = null; // ultimo calcolo, usato da stampa ed export

function rrLog(msg, tipo) {
  if (typeof log === 'function') log('[residenti] ' + msg, tipo || 'info');
  if (tipo === 'err') console.error('[report-residenti] ' + msg);
}
function rrEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function rrNorm(s) { return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
function rrDataIt(iso) { if (!iso) return ''; var p = String(iso).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
function rrPerc(n, tot) { return tot ? Math.round(n / tot * 1000) / 10 : 0; }

// 'SI' | 'NO' | 'ND' (comune non indicato)
function rrResidente(a) {
  var comune = typeof _comuneAtleta === 'function' ? rrNorm(_comuneAtleta(a)) : rrNorm(a.indComune);
  var cap = String(a.indCap || a.tutCap || '').trim();
  if (comune) {
    if (RR_RE_COMUNE.test(comune)) return 'SI';
    if (RR_RE_FRAZIONI.test(comune) && (!cap || cap === RR_CAP)) return 'SI';
    return 'NO';
  }
  if (cap === RR_CAP) return 'SI';
  return 'ND';
}
function rrComune(a) {
  var c = typeof _comuneAtleta === 'function' ? _comuneAtleta(a) : (a.indComune || '');
  return c ? c : (a.indCap || a.tutCap ? 'CAP ' + (a.indCap || a.tutCap) : '');
}
// Categorie memorizzate per la stagione (mai ricalcolate)
function rrCategorie(a, stag) {
  if (typeof _catMultiplaAtleta === 'function') return _catMultiplaAtleta(a, stag) || [];
  var out = [];
  (a.iscrizioni || []).forEach(function (i) { if (i.anno === stag) { if (i.cat1) out.push(i.cat1); if (i.cat2) out.push(i.cat2); } });
  return out.filter(function (c, k, arr) { return arr.indexOf(c) === k; });
}
// Data di iscrizione della stagione: la piu' vecchia tra le iscrizioni di quella stagione
function rrDataIscrizione(a, stag) {
  var date = (a.iscrizioni || []).filter(function (i) { return i.anno === stag && i.dataIscr; })
    .map(function (i) { return String(i.dataIscr).slice(0, 10); }).sort();
  return date[0] || '';
}
// Eta' al 31/12 dell'anno di inizio stagione ("2026-27" -> 2026); null se data nascita mancante
function rrEta(a, stag) {
  var anno = parseInt(String(stag).slice(0, 4), 10);
  var dn = String(a.dn || '');
  var m = dn.match(/^(\d{4})-\d{2}-\d{2}$/) || dn.match(/^\d{2}\/\d{2}\/(\d{4})$/);
  if (!m || !anno) return null;
  return anno - parseInt(m[1], 10);
}

// ── Calcolo puro (testabile): atleti = DB.atleti, opts = { includiNonAtleti } ──
function rrCalcola(atleti, stag, opts) {
  opts = opts || {};
  var righe = [];
  (atleti || []).forEach(function (a) {
    if (!a || !a.cog) return;
    if (!(a.iscrizioni || []).some(function (i) { return i.anno === stag; })) return;
    var cats = rrCategorie(a, stag);
    var soloNonAtleta = cats.length > 0 && cats.every(function (c) { return RR_CAT_NON_ATLETI.indexOf(c) >= 0; });
    if (soloNonAtleta && !opts.includiNonAtleti) return;
    var eta = rrEta(a, stag);
    var u18 = cats.filter(function (c) { return RR_CAT_U18.indexOf(c) >= 0; });
    if (cats.indexOf('Special') >= 0 && eta !== null && eta < 18) u18.push('Special U18');
    righe.push({ id: a.id, nome: ((a.cog || '') + ' ' + (a.nom || '')).trim(), cats: cats, u18: u18, eta: eta,
      specialSenzaEta: cats.indexOf('Special') >= 0 && eta === null,
      dataIscr: rrDataIscrizione(a, stag), res: rrResidente(a), comune: rrComune(a), ritirato: !!a.ritirato });
  });
  righe.sort(function (x, y) {
    if (x.dataIscr && y.dataIscr && x.dataIscr !== y.dataIscr) return x.dataIscr < y.dataIscr ? -1 : 1;
    if (!!x.dataIscr !== !!y.dataIscr) return x.dataIscr ? -1 : 1; // date mancanti in fondo
    return x.nome.localeCompare(y.nome);
  });
  var tot = righe.length, si = righe.filter(function (r) { return r.res === 'SI'; }).length;
  var perCat = RR_CAT_U18.concat(['Special U18']).map(function (c) {
    var rr = righe.filter(function (r) { return r.u18.indexOf(c) >= 0; });
    var s = rr.filter(function (r) { return r.res === 'SI'; }).length;
    return { cat: c, tot: rr.length, si: s, perc: rrPerc(s, rr.length), ok: rr.length ? rrPerc(s, rr.length) >= RR_SOGLIA_U18 : null };
  }).filter(function (c) { return c.tot > 0; });
  return {
    stagione: stag, righe: righe, tot: tot, si: si, perc: rrPerc(si, tot), ok: tot ? rrPerc(si, tot) >= RR_SOGLIA_TOTALE : null,
    perCat: perCat,
    nd: righe.filter(function (r) { return r.res === 'ND'; }).length,
    senzaData: righe.filter(function (r) { return !r.dataIscr; }).length,
    specialSenzaEta: righe.filter(function (r) { return r.specialSenzaEta; }).length,
    includiNonAtleti: !!opts.includiNonAtleti
  };
}

// ── UI admin ──
function rrPopolaStagioni() {
  var sel = document.getElementById('rr-stagione');
  if (!sel || sel.options.length > 0) return;
  var stag = (typeof _CACHE !== 'undefined' && _CACHE.stagioni) ? _CACHE.stagioni : [];
  if (!stag.length && typeof DB !== 'undefined' && DB && DB.atleti) {
    var s = {}; DB.atleti.forEach(function (a) { (a.iscrizioni || []).forEach(function (i) { if (i.anno) s[i.anno] = true; }); });
    stag = Object.keys(s).sort().reverse();
  }
  if (!stag.length) { rrLog('nessuna stagione trovata (DB non ancora caricato?)', 'warn'); return; }
  var corr = (typeof _CACHE !== 'undefined' && _CACHE.stagCorrente) || stag[0];
  sel.innerHTML = stag.map(function (s) { return '<option value="' + rrEsc(s) + '"' + (s === corr ? ' selected' : '') + '>' + rrEsc(s) + '</option>'; }).join('');
}
function rrGenera() {
  var out = document.getElementById('rr-risultato');
  if (!out) { rrLog('rrGenera: #rr-risultato non trovato', 'err'); return; }
  if (typeof DB === 'undefined' || !DB || !DB.atleti || !DB.atleti.length) { out.innerHTML = '<div style="color:var(--red)">Dati atleti non ancora caricati: riprova tra qualche secondo.</div>'; rrLog('DB non pronto', 'warn'); return; }
  rrPopolaStagioni();
  var stag = document.getElementById('rr-stagione').value;
  if (!stag) { out.innerHTML = '<div style="color:var(--red)">Scegli la stagione.</div>'; return; }
  var r = rrCalcola(DB.atleti, stag, { includiNonAtleti: document.getElementById('rr-tutti').checked });
  _rrUltimo = r;
  rrLog('stagione ' + stag + ': ' + r.si + '/' + r.tot + ' residenti (' + r.perc + '%), comune mancante ' + r.nd + ', data iscrizione mancante ' + r.senzaData, 'ok');
  out.innerHTML = rrHtmlRiepilogo(r, false) + rrHtmlElenco(r, false);
}
function rrSpia(ok, soglia) { return ok === null ? '' : (ok ? '<b style="color:#22a85a">✔</b>' : '<b style="color:#e0455a">✘</b>') + ' <span style="opacity:.75">min ' + soglia + '%</span>'; }
function rrHtmlRiepilogo(r, stampa) {
  var b = stampa ? '1px solid #999' : '1px solid var(--border)';
  var td = 'style="padding:5px 6px;border:' + b + '"', tdn = 'style="padding:5px 6px;border:' + b + ';text-align:right;white-space:nowrap"';
  var h = '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;margin:6px 0 10px;font-size:' + (stampa ? '9pt' : '13px') + '">' +
    '<tr><th ' + td + '>Capitolato §9</th><th ' + tdn + '>Res. / iscr.</th><th ' + tdn + '>%</th><th ' + tdn + '>Esito</th></tr>' +
    '<tr><td ' + td + '><b>Totale</b></td><td ' + tdn + '>' + r.si + ' / ' + r.tot + '</td><td ' + tdn + '><b>' + r.perc + '%</b></td><td ' + tdn + '>' + rrSpia(r.ok, RR_SOGLIA_TOTALE) + '</td></tr>';
  r.perCat.forEach(function (c) {
    h += '<tr><td ' + td + '>' + rrEsc(c.cat) + ' <span style="opacity:.7">U18</span></td><td ' + tdn + '>' + c.si + ' / ' + c.tot + '</td><td ' + tdn + '><b>' + c.perc + '%</b></td><td ' + tdn + '>' + rrSpia(c.ok, RR_SOGLIA_U18) + '</td></tr>';
  });
  h += '</table></div>';
  var note = [];
  note.push('Conteggio: ' + (r.includiNonAtleti ? 'tutti gli iscritti della stagione, compresi dirigenti e volontari' : 'atleti iscritti nella stagione (esclusi dirigenti, volontari, ex)') + '. Residente = comune di residenza Campodarsego o sue frazioni (CAP 35011).');
  if (r.nd) note.push('<span style="color:#e07040"><b>' + r.nd + '</b> iscritti senza comune di residenza: contati come NON residenti. Completare l\'anagrafica (filtro "Senza residenza" nel gestionale).</span>');
  if (r.senzaData) note.push('<span style="color:#e07040"><b>' + r.senzaData + '</b> iscritti senza data di iscrizione: in fondo all\'elenco. Si compila nella scheda atleta → Iscrizioni.</span>');
  if (r.specialSenzaEta) note.push('<span style="color:#e07040"><b>' + r.specialSenzaEta + '</b> atleti Special senza data di nascita: non conteggiati tra gli Under 18.</span>');
  return h + '<div style="font-size:' + (stampa ? '8pt' : '12px') + ';line-height:1.5;margin-bottom:10px">' + note.join('<br>') + '</div>';
}
function rrHtmlElenco(r, stampa) {
  var b = stampa ? '1px solid #bbb' : '1px solid var(--border)';
  var td = 'style="padding:3px 6px;border:' + b + '"';
  var h = '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:' + (stampa ? '8pt' : '12px') + '"><thead><tr>' +
    ['N.', 'Data iscrizione', 'Cognome e nome', 'Categoria', 'Residente'].map(function (x) { return '<th ' + td + '>' + x + '</th>'; }).join('') + '</tr></thead><tbody>';
  r.righe.forEach(function (x, i) {
    var res = x.res === 'SI' ? 'Sì' : x.res === 'NO' ? 'No' + (x.comune ? ' (' + rrEsc(x.comune) + ')' : '') : '<span style="color:#e07040">non indicato</span>';
    h += '<tr><td ' + td + '>' + (i + 1) + '</td><td ' + td + '>' + (x.dataIscr ? rrDataIt(x.dataIscr) : '<span style="color:#e07040">mancante</span>') + '</td><td ' + td + '>' + rrEsc(x.nome) + (x.ritirato ? ' <i>(ritirato)</i>' : '') +
      '</td><td ' + td + '>' + rrEsc(x.cats.join(' / ') || '—') + '</td><td ' + td + '>' + res + '</td></tr>';
  });
  return h + '</tbody></table></div>';
}
function rrStampa() {
  if (!_rrUltimo) rrGenera();
  var r = _rrUltimo; if (!r) return;
  var logo = (typeof _LOGO_B64 !== 'undefined' && _LOGO_B64) ? '<img src="data:image/jpeg;base64,' + _LOGO_B64 + '" style="height:40px;float:right" alt="">' : '';
  var oggi = new Date().toLocaleDateString('it-IT');
  var html = '<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Residenti ' + rrEsc(r.stagione) + '</title><style>' +
    '@page{size:A4;margin:12mm 12mm 16mm;@bottom-right{content:"pag. " counter(page) " di " counter(pages);font-size:8pt;color:#555}@bottom-left{content:"ASD Basket Campodarsego — Iscritti residenti, stagione ' + rrEsc(r.stagione) + '";font-size:8pt;color:#555}}' +
    'body{font-family:Arial,sans-serif;color:#111;font-size:9pt} h1{font-size:13pt;margin:0 0 2px} .sub{color:#555;margin-bottom:8px} thead{display:table-header-group} tr{page-break-inside:avoid}' +
    '@media print{.no-print{display:none}}</style></head><body>' +
    '<div class="no-print" style="padding:8px;background:#eee;text-align:center"><button onclick="window.print()" style="padding:8px 22px">🖨️ Stampa / Salva PDF</button></div>' +
    logo + '<h1>ASD Basket Campodarsego — Iscritti residenti a Campodarsego</h1>' +
    '<div class="sub">Stagione ' + rrEsc(r.stagione) + ' · situazione al ' + oggi + ' · priorità ai residenti (Capitolato §9)</div>' +
    rrHtmlRiepilogo(r, true) + '<h2 style="font-size:11pt;margin:12px 0 4px">Elenco iscritti in ordine di data di iscrizione</h2>' + rrHtmlElenco(r, true) +
    '<p style="margin-top:24px">Il Presidente ______________________</p></body></html>';
  var w = window.open('', '_blank');
  if (!w) { rrLog('stampa bloccata dal browser (popup)', 'err'); alert('Il browser ha bloccato la finestra di stampa: consenti i popup e riprova.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
function rrEsportaCSV() {
  if (!_rrUltimo) rrGenera();
  var r = _rrUltimo; if (!r) return;
  function q(v) { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  var righe = [['N.', 'Data iscrizione', 'Cognome e nome', 'Categoria', 'Residente', 'Comune']];
  r.righe.forEach(function (x, i) { righe.push([i + 1, rrDataIt(x.dataIscr), x.nome, x.cats.join(' / '), x.res === 'SI' ? 'Sì' : x.res === 'NO' ? 'No' : 'non indicato', x.comune]); });
  righe.push([]); righe.push(['Totale', r.tot, 'Residenti', r.si, r.perc + '%']);
  r.perCat.forEach(function (c) { righe.push([c.cat + ' (U18)', c.tot, 'Residenti', c.si, c.perc + '%']); });
  var csv = '﻿' + righe.map(function (rr) { return rr.map(q).join(';'); }).join('\r\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url; link.download = 'residenti_' + r.stagione + '.csv';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  rrLog('CSV esportato: ' + r.righe.length + ' righe', 'ok');
}

if (typeof window !== 'undefined') window.addEventListener('error', function (e) { var m = '[report-residenti] errore non gestito: ' + (e.error && e.error.message || e.message); console.error(m); if (typeof log === 'function') log(m, 'err'); });
if (typeof window !== 'undefined') window.addEventListener('unhandledrejection', function (e) { var m = '[report-residenti] promise non gestita: ' + (e.reason && e.reason.message || e.reason); console.error(m); if (typeof log === 'function') log(m, 'err'); });

if (typeof module !== 'undefined' && module.exports) module.exports = { rrCalcola: rrCalcola, rrResidente: rrResidente, rrEta: rrEta };
