// ════════════════════════════════════════════════════════
// FILE: dittafono-gestionale.js — ASD Basket Campodarsego
// VERSIONE: v0.1 · 20/11/2026 11:00 · BK
// v0.1 (richiesta Alberto 20/11/2026: "un dittafono che mi gestisce in
//   automatico il gestionale e mi fornisce con facilita' tabulati e
//   informazioni"). Il dittafono diventa il punto di comando:
//   1) PAGAMENTI: dalla nota -> pagamento sulla scheda atleta (come
//      "Nuovo pagamento" del gestionale) + movimento ENTRATA QUOTE in
//      Economia (cassa o banca), in UNA transazione. Chiude la lacuna di
//      salvaNuovoPag (pagamenti senza movimento).
//   2) DATI SCHEDA: dalla nota -> proposta campo per campo (nascita,
//      comune di residenza, scadenza certificato, documenti consegnati) ->
//      conferma -> scheda aggiornata. Oppure testo aggiunto alle note
//      dell'atleta (dati sensibili oscurati).
//   3) DOMANDE: "chi ha il certificato scaduto?", "chi non ha pagato?",
//      "cassa", "documenti mancanti", "residenti", "spese del mese",
//      "situazione Rossi" -> elenco con stampa (pag. N di M) e CSV.
//   La conferma resta sempre di Alberto. Scritture in transazione: il
//   gestionale aperto altrove le unisce al proprio salvataggio (bk-sync.js).
// Dipende da: spese-rapide.js (SR, _db, srEsc, srEuro, srLog, srCostruisciMovimento,
//   srAnnoCaricato, srRegistraInCache, srSaldoCassa, srOggi, srISO, srDataIt),
//   dittafono.js (DF, dfCol, dfTrova, dfTrovaAtleti, dfRenderNote, dfAggiornaNota),
//   economia-core-DRAFT.js (ecoNextNumeroMovimento, ecoValidaMovimento),
//   report-residenti.js (rrCalcola, facoltativo).
// ════════════════════════════════════════════════════════

var DFG_VERSIONE = 'v0.1 · 20/11/2026 11:00';
var DFG = { atl: [], pag: {}, caricato: false, risposta: null };
var DFG_TIPI_PAG = ['Quota (1a rata)', 'Quota (2a rata)', 'Saldo quota', 'Quota annuale', 'Assicurazione', 'Divisa', 'Altro'];
var DFG_METODI = { Contanti: 'CONTANTI_CASSA', Bonifico: 'BONIFICO', POS: 'BONIFICO' };
var DFG_DOC = { modulo: 'Modulo iscrizione', identita: 'Documento identità', tessera: 'Tessera sanitaria' };
var DFG_MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

// ════════ PARSER (puri, testabili in Node) ════════
function dfgPad(n) { return String(n).padStart(2, '0'); }
function dfgIso(a, m, g) {
  if (a < 100) a += 2000;
  var d = new Date(a, m - 1, g);
  if (d.getFullYear() !== a || d.getMonth() !== m - 1 || d.getDate() !== g) return null;
  return a + '-' + dfgPad(m) + '-' + dfgPad(g);
}
// Tutte le date nel testo: [{iso, pos, fine}]. "24/01/2017", "11-05-2020", "15 ottobre 2027", "1° marzo 2027"
function dfgDate(testo) {
  var t = String(testo || ''), out = [], m;
  var re1 = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}|\d{2})\b/g;
  while ((m = re1.exec(t))) { var iso = dfgIso(+m[3], +m[2], +m[1]); if (iso) out.push({ iso: iso, pos: m.index, fine: m.index + m[0].length }); }
  var re2 = new RegExp('\\b(\\d{1,2})°?\\s+(' + DFG_MESI.join('|') + ')\\s+(\\d{4})\\b', 'gi');
  while ((m = re2.exec(t))) { var iso2 = dfgIso(+m[3], DFG_MESI.indexOf(m[2].toLowerCase()) + 1, +m[1]); if (iso2) out.push({ iso: iso2, pos: m.index, fine: m.index + m[0].length }); }
  return out.sort(function (a, b) { return a.pos - b.pos; });
}
// Scadenza certificato da data di emissione: validita' 365 giorni (fatto il 29/10/2026 -> scade il 28/10/2027)
function dfgScadenzaDaEmissione(iso) {
  var p = iso.split('-').map(Number), d = new Date(p[0] + 1, p[1] - 1, p[2] - 1);
  return d.getFullYear() + '-' + dfgPad(d.getMonth() + 1) + '-' + dfgPad(d.getDate());
}
function dfgTitolo(s) { return String(s).toLowerCase().replace(/(^|[\s'-])([a-zà-ú])/g, function (x, a, b) { return a + b.toUpperCase(); }).replace(/\b(Di|Del|Della|De|San|Sant')\b/g, function (w) { return /^(Di|Del|Della)$/.test(w) ? w.toLowerCase() : w; }); }
// Dati di scheda riconosciuti nel testo. Ritorna {dn, indComune, cs, csDa, doc:{modulo,identita,tessera}}
function dfgEstraiDati(testo) {
  var t = String(testo || ''), r = { doc: {} };
  var frasi = t.split(/(?<=[.;])\s+|\n/);
  var base = 0;
  frasi.forEach(function (f) {
    var fl = f.toLowerCase();
    var neg = /\bnon\s+(ha\s+)?(consegnat|portat|ancora)/.test(fl);
    dfgDate(f).forEach(function (d) {
      var prima = fl.slice(Math.max(0, d.pos - 45), d.pos);
      if (/\bnat[oa]\s+(il\s+|l'\s*|nel\s+)?$/.test(prima)) r.dn = d.iso;
      else if (/certificat|visita|idoneit/.test(fl)) {
        if (/scad\w*\s+(il\s+|l'\s*)?$/.test(prima)) { r.cs = d.iso; r.csDa = 'scadenza'; }
        else if (/(fatto|del|rilasciat\w*|emess\w*|fatta)\s+(il\s+|l'\s*)?$/.test(prima) && r.csDa !== 'scadenza') { r.cs = dfgScadenzaDaEmissione(d.iso); r.csDa = 'emissione ' + d.iso; }
      }
    });
    var mr = f.match(/\b(?:residente|abita|vive)\s+(?:a|ad|in)\s+([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' ]*?)(?=\s*(?:[,.;:(]|$|\s+(?:nat[oa]|e\s|ed\s|ha\s|con\s|certificat)))/i);
    if (mr && !/\?/.test(f)) r.indComune = dfgTitolo(mr[1].trim());
    var v = neg ? 'NO' : 'SI';
    if (/modulo\s+(di\s+)?iscrizion/.test(fl)) r.doc.modulo = v;
    if (/(carta|documento)\s+d.?\s*identit/.test(fl) && !/identit\w*\s*\?/.test(fl)) r.doc.identita = v;
    if (/tessera\s+sanitaria/.test(fl)) r.doc.tessera = v;
    base += f.length;
  });
  if (!Object.keys(r.doc).length) delete r.doc;
  return r;
}
function dfgEstraiMetodo(testo) {
  var t = String(testo || '').toLowerCase();
  if (/\bcontant\w*|\bcash\b|in mano/.test(t)) return 'Contanti';
  if (/\bbonific\w*/.test(t)) return 'Bonifico';
  if (/\bpos\b|bancomat|\bcarta\b/.test(t)) return 'POS';
  return '';
}
function dfgEstraiTipoPag(testo) {
  var t = String(testo || '').toLowerCase();
  if (/saldo/.test(t)) return 'Saldo quota';
  if (/(2|seconda)\s*(a|ª)?\s*rata/.test(t)) return 'Quota (2a rata)';
  if (/(1|prima)\s*(a|ª)?\s*rata|acconto/.test(t)) return 'Quota (1a rata)';
  if (/quota (intera|annuale)|intera/.test(t)) return 'Quota annuale';
  if (/assicuraz/.test(t)) return 'Assicurazione';
  if (/divisa|maglia/.test(t)) return 'Divisa';
  return 'Quota (1a rata)';
}
// Dati da NON registrare nelle note (privacy minori): codice fiscale, telefoni, numeri documento
function dfgOscura(testo) {
  return String(testo || '')
    .replace(/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi, '[CF omesso]')
    .replace(/(\+39\s?)?\b3\d{2}[\s.]?\d{3}[\s.]?\d{3,4}\b/g, '[telefono omesso]')
    .replace(/\b[A-Z]{2}\d{5,7}[A-Z]{0,2}\b/g, '[n. documento omesso]');
}
// Stato certificato come nel foglio: MANCA / SCADUTO / IN SCADENZA (entro 30 gg) / OK
function dfgStatoCert(cs, oggi) {
  if (!cs) return 'MANCA';
  var s = String(cs).slice(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) s = s.slice(6) + '-' + s.slice(3, 5) + '-' + s.slice(0, 2);
  if (s < oggi) return 'SCADUTO';
  var p = oggi.split('-').map(Number), lim = new Date(p[0], p[1] - 1, p[2] + 30);
  return s <= lim.getFullYear() + '-' + dfgPad(lim.getMonth() + 1) + '-' + dfgPad(lim.getDate()) ? 'IN SCADENZA' : 'OK';
}
// Stagione corrente "AAAA-AA" (settembre-agosto) e finestra date
function dfgStagione(oggi) {
  var a = +oggi.slice(0, 4), m = +oggi.slice(5, 7), ini = m >= 9 ? a : a - 1;
  return { nome: ini + '-' + String(ini + 1).slice(2), da: ini + '-09-01', a: (ini + 1) + '-08-31' };
}
function dfgStagioneAtleti(atleti, oggi) {
  var s = dfgStagione(oggi), visti = {};
  (atleti || []).forEach(function (a) { (a.iscrizioni || []).forEach(function (i) { if (i.anno) visti[i.anno] = 1; }); });
  var noti = Object.keys(visti).sort().reverse();
  // formato della stagione come salvato in anagrafica (es. "2026-27" o "2026/27")
  var stessa = noti.find(function (x) { return x.slice(0, 4) === s.nome.slice(0, 4); });
  s.chiave = stessa || noti[0] || s.nome;
  return s;
}
function dfgCategorie(a, stag) {
  var out = [];
  (a.iscrizioni || []).forEach(function (i) { if (i.anno === stag) { if (i.cat1) out.push(i.cat1); if (i.cat2) out.push(i.cat2); } });
  return out.filter(function (c, k, arr) { return arr.indexOf(c) === k; });
}
function dfgNomeAtl(a) { return ((a.cog || '') + ' ' + (a.nom || '')).trim(); }
function dfgComune(a) {
  var c = (a.indComune || a.tutComune || '').trim();
  if (!c && a.ind) { var m = a.ind.match(/,\s*([^,(]+)/); if (m) c = m[1].trim(); }
  return c;
}

// Riconosce una DOMANDA (non una nota). Ritorna { tipo, atleta? } o null.
function dfgRiconosciDomanda(testo, atleti) {
  var t = String(testo || '').toLowerCase().trim();
  var domanda = /\?\s*$/.test(t) || /^(chi|quanti|quante|quanto|quali|quale|elenco|lista|mostra|dimmi|situazione|scheda|stampa|tabulato)\b/.test(t);
  if (!domanda) return null;
  if (/certificat|visit\w* medic/.test(t)) return { tipo: /scadut/.test(t) && !/scadenz/.test(t) ? 'CERT_SCADUTI' : 'CERTIFICATI' };
  if (/document|modul|tessera/.test(t)) return { tipo: 'DOCUMENTI' };
  if (/non ha(nno)? pagato|pagat|quot|rat[ae]\b|pagament/.test(t) && !/spes/.test(t)) {
    var a1 = dfTrovaAtleti(testo, atleti || []);
    return a1.length ? { tipo: 'ATLETA', atleti: a1 } : { tipo: 'NON_PAGATO' };
  }
  if (/\bcassa\b|contanti/.test(t)) return { tipo: 'CASSA' };
  if (/residen/.test(t)) return { tipo: /manca|senza/.test(t) ? 'RESIDENZA_MANCANTE' : 'RESIDENTI' };
  if (/spes|speso|uscit/.test(t)) return { tipo: 'SPESE', periodo: /settiman/.test(t) ? 'SETTIMANA' : /anno/.test(t) ? 'ANNO' : 'MESE' };
  var a2 = dfTrovaAtleti(testo, atleti || []);
  if (a2.length) return { tipo: 'ATLETA', atleti: a2 };
  return { tipo: 'NON_CAPITA' };
}

// Calcoli delle risposte (puri). Ritorna { titolo, sotto, colonne:[..], righe:[[..]], nota }
function dfgRispondi(q, atleti, pag, oggi, extra) {
  extra = extra || {};
  var st = dfgStagioneAtleti(atleti, oggi);
  var iscritti = (atleti || []).filter(function (a) { return a && a.cog && !a.ritirato && (a.iscrizioni || []).some(function (i) { return i.anno === st.chiave; }); });
  var nonAtl = typeof RR_CAT_NON_ATLETI !== 'undefined' ? RR_CAT_NON_ATLETI : ['Dirigente', 'Volontario', 'Ex'];
  var atletiVeri = iscritti.filter(function (a) { var c = dfgCategorie(a, st.chiave); return !(c.length && c.every(function (x) { return nonAtl.indexOf(x) >= 0; })); });
  var ord = function (arr) { return arr.sort(function (x, y) { return dfgNomeAtl(x).localeCompare(dfgNomeAtl(y)); }); };
  var cat = function (a) { return dfgCategorie(a, st.chiave).join(' + '); };
  var pagStag = function (a) { return (pag[a.id] || []).filter(function (p) { return p.data >= st.da && p.data <= st.a; }); };
  switch (q.tipo) {
    case 'CERTIFICATI':
    case 'CERT_SCADUTI': {
      var solo = q.tipo === 'CERT_SCADUTI';
      var r = ord(atletiVeri.slice()).map(function (a) { return [dfgNomeAtl(a), cat(a), a.cs ? srDataIt(a.cs) : '—', dfgStatoCert(a.cs, oggi)]; })
        .filter(function (x) { return solo ? x[3] === 'SCADUTO' : x[3] !== 'OK'; });
      var pri = { SCADUTO: 0, MANCA: 1, 'IN SCADENZA': 2 };
      r.sort(function (x, y) { return pri[x[3]] - pri[y[3]] || x[0].localeCompare(y[0]); });
      return { titolo: solo ? 'Certificati scaduti' : 'Certificati da sistemare', sotto: 'Stagione ' + st.chiave + ' · ' + r.length + ' atleti su ' + atletiVeri.length,
        colonne: ['Atleta', 'Categoria', 'Scadenza', 'Stato'], righe: r, nota: r.length ? '' : 'Tutti in regola.' };
    }
    case 'DOCUMENTI': {
      var r2 = ord(atletiVeri.slice()).map(function (a) {
        var d = a.docConsegnati || {}, manca = Object.keys(DFG_DOC).filter(function (k) { return d[k] !== 'SI'; });
        return manca.length ? [dfgNomeAtl(a), cat(a), manca.map(function (k) { return DFG_DOC[k]; }).join(', ')] : null;
      }).filter(Boolean);
      return { titolo: 'Documenti da consegnare', sotto: 'Stagione ' + st.chiave + ' · ' + r2.length + ' atleti', colonne: ['Atleta', 'Categoria', 'Mancano'], righe: r2,
        nota: 'Conta i documenti segnati come consegnati dal dittafono (campo nuovo): chi è stato registrato prima risulta senza.' };
    }
    case 'NON_PAGATO': {
      var r3 = ord(atletiVeri.filter(function (a) { return !/volley|pallavolo/i.test(cat(a)) && !pagStag(a).length; }))
        .map(function (a) { return [dfgNomeAtl(a), cat(a)]; });
      return { titolo: 'Iscritti senza pagamenti nella stagione', sotto: 'Stagione ' + st.chiave + ' (dal ' + srDataIt(st.da) + ') · ' + r3.length + ' atleti',
        colonne: ['Atleta', 'Categoria'], righe: r3, nota: 'Esclusi ritirati, dirigenti/volontari e volley amatoriale (paga l\'affitto di gruppo).' };
    }
    case 'RESIDENZA_MANCANTE': {
      var r4 = ord(atletiVeri.filter(function (a) { return !dfgComune(a); })).map(function (a) { return [dfgNomeAtl(a), cat(a)]; });
      return { titolo: 'Comune di residenza mancante', sotto: r4.length + ' atleti', colonne: ['Atleta', 'Categoria'], righe: r4, nota: 'Chi non ha il comune conta come NON residente nel report del Comune.' };
    }
    case 'RESIDENTI': {
      if (typeof rrCalcola !== 'function') return { titolo: 'Residenti', colonne: [], righe: [], nota: 'Report non disponibile in questa pagina: usa Admin → Report.' };
      var rr = rrCalcola(atleti, st.chiave, {});
      var r5 = [['Totale', rr.si + ' su ' + rr.tot, rr.perc + '%', rr.ok === null ? '' : (rr.ok ? 'OK (min 50%)' : 'SOTTO il 50%')]];
      rr.perCat.forEach(function (c) { r5.push([c.cat, c.si + ' su ' + c.tot, c.perc + '%', c.ok === null ? '' : (c.ok ? 'OK (min 30%)' : 'SOTTO il 30%')]); });
      return { titolo: 'Residenti a Campodarsego (Capitolato §9)', sotto: 'Stagione ' + st.chiave, colonne: ['Gruppo', 'Residenti', '%', 'Esito'], righe: r5,
        nota: rr.nd ? rr.nd + ' atleti senza comune contati come non residenti.' : '' };
    }
    case 'CASSA': {
      var sc = extra.cassa;
      return { titolo: 'Cassa contanti', sotto: 'al ' + srDataIt(oggi), colonne: ['Voce', 'Importo'],
        righe: sc ? [['Saldo teorico', srEuro(sc.saldo)]].concat(extra.anticipi != null ? [['Anticipi di Alberto da rimborsare', srEuro(extra.anticipi)]] : []) : [],
        nota: sc ? 'Se i contanti contati sono diversi, registra la conta nella scheda 💶 Cassa.' : 'Conto Cassa non configurato.' };
    }
    case 'SPESE': {
      var movs = extra.movimenti || [], da = oggi.slice(0, 8) + '01';
      if (q.periodo === 'SETTIMANA') { var p = oggi.split('-').map(Number); da = srISO(new Date(p[0], p[1] - 1, p[2] - 6)); }
      if (q.periodo === 'ANNO') da = oggi.slice(0, 4) + '-01-01';
      var tot = { PALESTRA: 0, SPORT: 0, ALTRO: 0 };
      movs.forEach(function (m) {
        if (m.tipoMovimento !== 'USCITA' || m.stato === 'ANNULLATO') return;
        var d = m.dataDocumento || m.dataPagamento || ''; if (d < da || d > oggi) return;
        var c = String(m.centroCostoCodice || '').toUpperCase(); tot[c === 'PALESTRA' || c === 'SPORT' ? c : 'ALTRO'] += Number(m.importoEur) || 0;
      });
      var r6 = [['Palestra', srEuro(tot.PALESTRA)], ['Società', srEuro(tot.SPORT)]];
      if (tot.ALTRO) r6.push(['Senza centro', srEuro(tot.ALTRO)]);
      r6.push(['Totale', srEuro(tot.PALESTRA + tot.SPORT + tot.ALTRO)]);
      return { titolo: 'Spese ' + { SETTIMANA: 'degli ultimi 7 giorni', MESE: 'del mese', ANNO: 'dell\'anno' }[q.periodo], sotto: 'dal ' + srDataIt(da) + ' al ' + srDataIt(oggi),
        colonne: ['Centro', 'Importo'], righe: r6, nota: 'Il dettaglio è nella scheda 📋 Elenco.' };
    }
    case 'ATLETA': {
      var righe = [];
      q.atleti.forEach(function (x) {
        var a = (atleti || []).find(function (y) { return y.id === x.id; }); if (!a) return;
        var d = a.docConsegnati || {}, ps = pagStag(a), totP = ps.reduce(function (s, p) { return s + (+p.importo || 0); }, 0);
        righe.push([dfgNomeAtl(a), 'Categoria', cat(a) || '—']);
        righe.push(['', 'Nascita', a.dn ? (String(a.dn).indexOf('-') > 0 ? srDataIt(a.dn) : a.dn) : '—']);
        righe.push(['', 'Comune', dfgComune(a) || '—']);
        righe.push(['', 'Certificato', (a.cs ? srDataIt(a.cs) + ' · ' : '') + dfgStatoCert(a.cs, oggi)]);
        righe.push(['', 'Documenti', Object.keys(DFG_DOC).map(function (k) { return DFG_DOC[k] + ': ' + (d[k] || '?'); }).join(' · ')]);
        righe.push(['', 'Pagato stagione', srEuro(totP) + (ps.length ? ' (' + ps.map(function (p) { return srDataIt(p.data) + ' ' + srEuro(p.importo); }).join('; ') + ')' : '')]);
        if (a.ritirato) righe.push(['', 'Stato', 'RITIRATO']);
      });
      return { titolo: q.atleti.length > 1 ? 'Situazione atleti' : 'Situazione ' + q.atleti[0].nome, sotto: 'Stagione ' + st.chiave, colonne: ['Atleta', 'Voce', 'Valore'], righe: righe,
        nota: q.atleti.some(function (a) { return !a.certo; }) ? 'Più atleti con lo stesso cognome: mostrati tutti.' : '' };
    }
    default:
      return { titolo: 'Domanda non capita', colonne: [], righe: [], nota: 'Prova con: "chi ha il certificato scaduto?", "chi non ha pagato?", "documenti mancanti", "cassa", "residenti", "spese del mese", "situazione Rossi".' };
  }
}

// ════════ CARICAMENTO DATI GESTIONALE (sola lettura qui; scritture solo in transazione) ════════
function dfgCarica() {
  var col = _db.collection('basket052441');
  return Promise.all([col.doc('atleti').get(), col.doc('pagamenti').get()]).then(function (ds) {
    DFG.atl = ds[0].exists && ds[0].data().v ? JSON.parse(ds[0].data().v) : [];
    DFG.pag = ds[1].exists && ds[1].data().v ? JSON.parse(ds[1].data().v) : {};
    DFG.caricato = true;
    srLog('Gestionale: ' + DFG.atl.length + ' atleti, pagamenti di ' + Object.keys(DFG.pag).length + ' atleti', 'ok');
  }).catch(function (err) { srLog('Gestionale non letto: ' + err.message, 'err'); });
}
function dfgAtleta(id) { return DFG.atl.find(function (a) { return a.id === id; }) || null; }

// ════════ UI: pannello di elaborazione dentro la nota ════════
function dfgOpzioniAtleti(n, sel) {
  var cand = (n.atleti || []).map(function (a) { return a.id; });
  var lista = DFG.atl.filter(function (a) { return a && a.cog && !a.ritirato; }).slice().sort(function (x, y) { return dfgNomeAtl(x).localeCompare(dfgNomeAtl(y)); });
  var primi = lista.filter(function (a) { return cand.indexOf(a.id) >= 0; }), altri = lista.filter(function (a) { return cand.indexOf(a.id) < 0; });
  var opt = function (a) { return '<option value="' + a.id + '"' + (a.id === sel ? ' selected' : '') + '>' + srEsc(dfgNomeAtl(a)) + '</option>'; };
  return '<option value="">— scegli l\'atleta —</option>' + (primi.length ? '<optgroup label="Nominati nella nota">' + primi.map(opt).join('') + '</optgroup>' : '') +
    '<optgroup label="Tutti">' + altri.map(opt).join('') + '</optgroup>';
}
function dfgAtletaProposto(n) {
  var certi = (n.atleti || []).filter(function (a) { return a.certo; });
  return certi.length === 1 ? certi[0].id : null;
}
// Pannello della nota nell'elenco Note (dalla scheda Detta si passa all'elenco)
function dfgPannello(id) {
  var el = document.getElementById('dfg-pan-' + id);
  if (!el && typeof srGoTab === 'function') { srGoTab('note'); el = document.getElementById('dfg-pan-' + id); }
  if (!el && typeof dfSetFiltro === 'function') { dfSetFiltro('TUTTE'); el = document.getElementById('dfg-pan-' + id); }
  if (!el) srLog('Nota ' + id + ' non trovata nell\'elenco', 'err');
  else if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  return el;
}
function dfgChiudi(id) { var el = document.getElementById('dfg-pan-' + id); if (el) el.innerHTML = ''; }
function dfgApriPagamento(id) {
  var n = dfTrova(id), el = n && dfgPannello(id);
  if (!n || !el) return;
  if (!DFG.caricato) { el.innerHTML = '<div class="errore">Anagrafica non ancora caricata: riprova tra poco.</div>'; return; }
  var testo = n.testo || '', date = dfgDate(testo), oggi = srOggi();
  var data = n.dataEvento || (date.length ? date[date.length - 1].iso : oggi);
  if (data > oggi) data = oggi;
  var met = dfgEstraiMetodo(testo), tipo = dfgEstraiTipoPag(testo);
  el.innerHTML = '<div class="card" style="margin-top:8px;border:1px solid var(--gold)">' +
    '<label>Atleta</label><select id="dfg-atl-' + id + '">' + dfgOpzioniAtleti(n, dfgAtletaProposto(n)) + '</select>' +
    '<div style="display:flex;gap:8px"><div style="flex:1"><label>Importo €</label><input id="dfg-imp-' + id + '" inputmode="decimal" value="' + (n.importo != null ? String(n.importo).replace('.', ',') : '') + '"></div>' +
    '<div style="flex:1"><label>Data</label><input type="date" id="dfg-data-' + id + '" value="' + data + '"></div></div>' +
    '<div style="display:flex;gap:8px"><div style="flex:1"><label>Tipo</label><select id="dfg-tipo-' + id + '">' + DFG_TIPI_PAG.map(function (x) { return '<option' + (x === tipo ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></div>' +
    '<div style="flex:1"><label>Come</label><select id="dfg-met-' + id + '"><option value="">— scegli —</option>' + Object.keys(DFG_METODI).map(function (x) { return '<option' + (x === met ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></div></div>' +
    '<div style="font-size:12px;color:var(--muted);margin:6px 0">Registra il pagamento sulla scheda dell\'atleta e l\'entrata in Economia (Quote, Società). Contanti = cassa della società.</div>' +
    '<div id="dfg-esito-' + id + '"></div>' +
    '<button class="btn-gold btn-sm" onclick="dfgConfermaPagamento(\'' + id + '\')">✅ Conferma pagamento</button> <button class="btn-gray btn-sm" onclick="dfgChiudi(\'' + id + '\')">Chiudi</button></div>';
}
function dfgLeggiImporto(s) { var v = typeof srParseImporto === 'function' ? srParseImporto(s) : parseFloat(String(s).replace(',', '.')); return v != null && isFinite(v) ? Math.round(v * 100) / 100 : null; }
function dfgNotaAggiornata(n, collegamenti, azione) {
  var adesso = new Date().toISOString(), c = JSON.parse(JSON.stringify(n));
  c.stato = 'ELABORATA';
  c.collegamenti = (n.collegamenti || []).concat(collegamenti.map(function (x) { x.il = adesso; return x; }));
  c.storia = (n.storia || []).concat([{ il: adesso, da: SR.utente, azione: azione }]);
  return c;
}
function dfgConfermaPagamento(id) {
  var n = dfTrova(id), es = document.getElementById('dfg-esito-' + id);
  var aid = parseInt(document.getElementById('dfg-atl-' + id).value, 10), a = dfgAtleta(aid);
  var imp = dfgLeggiImporto(document.getElementById('dfg-imp-' + id).value);
  var data = document.getElementById('dfg-data-' + id).value, tipo = document.getElementById('dfg-tipo-' + id).value, met = document.getElementById('dfg-met-' + id).value;
  var manca = [];
  if (!a) manca.push('atleta'); if (!(imp > 0)) manca.push('importo'); if (!data) manca.push('data'); if (!met) manca.push('come ha pagato');
  if (manca.length) { es.innerHTML = '<div class="errore">Manca: ' + manca.join(', ') + '.</div>'; return; }
  if (!DFG_METODI[met]) { srLog('Metodo pagamento non riconosciuto: ' + met, 'err'); es.innerHTML = '<div class="errore">Metodo "' + srEsc(met) + '" non riconosciuto.</div>'; return; }
  var quote = (SR.config.categorie || []).find(function (c) { return c.codice === 'QUOTE' && c.attivo !== false; });
  if (!quote) { es.innerHTML = '<div class="errore">In Economia manca la categoria QUOTE (Quote associative): aggiungila da Admin → Economia → Codici.</div>'; return; }
  var nome = dfgNomeAtl(a);
  var m = srCostruisciMovimento({ tipoMov: 'ENTRATA', importo: imp, categoria: 'QUOTE', centro: 'SPORT', mezzo: DFG_METODI[met], data: data,
    descrizione: tipo + ' ' + nome, frase: n.testo, natura: null, documento: null });
  if (met === 'POS') { m.metodoPagamento = 'carta'; }
  m.origine = 'DITTAFONO_PAGAMENTO'; m.atletaId = aid; m.notaId = id;
  if (!m.contoFinanziarioId) { es.innerHTML = '<div class="errore">Manca il conto ' + (met === 'Contanti' ? 'Cassa' : 'Banca') + ' in Economia.</div>'; return; }
  var pagObj = { tipo: tipo, importo: imp, data: data, metodo: met, note: 'da dittafono', notaId: id, movId: m.id };
  es.innerHTML = '<div class="domanda">Registrazione…</div>';
  var col = _db.collection('basket052441'), refPag = col.doc('pagamenti'), copia;
  srAnnoCaricato(m.annoEsercizio).then(function (movAnno) {
    m.numeroMovimento = ecoNextNumeroMovimento(movAnno, m.annoEsercizio);
    var v = ecoValidaMovimento(m, SR.config, {});
    if (!v.valido) throw new Error('movimento non valido: ' + v.errori.join(', '));
    copia = dfgNotaAggiornata(n, [{ tipo: 'PAGAMENTO', atletaId: aid, nome: nome }, { tipo: 'MOVIMENTO', id: m.id, numero: m.numeroMovimento }], 'pagamento registrato: ' + nome + ' ' + imp + ' € ' + met + ' → ' + m.numeroMovimento);
    return _db.runTransaction(function (tx) {
      return tx.get(refPag).then(function (d) {
        var cur = d.exists && d.data().v ? JSON.parse(d.data().v) : {};
        var arr = cur[aid] || [];
        if (arr.some(function (p) { return p.notaId === id; })) throw new Error('GIA_REGISTRATO');
        if (arr.some(function (p) { return p.data === data && Math.abs((+p.importo || 0) - imp) < 0.01; })) throw new Error('DUPLICATO');
        if (arr.length >= 5) throw new Error('l\'atleta ha già 5 pagamenti (limite del gestionale)');
        cur[aid] = arr.concat([pagObj]);
        tx.set(refPag, { v: JSON.stringify(cur), ts: new Date().toISOString(), da: 'dittafono ' + SR.utente });
        tx.set(srColMov().doc(m.id), m);
        tx.set(dfCol().doc(id), copia);
        DFG.pag = cur;
      });
    });
  }).then(function () {
    Object.assign(n, copia);
    srRegistraInCache(m);
    if (typeof srAggiornaBadgeCassa === 'function') srAggiornaBadgeCassa();
    srLog('Pagamento ' + nome + ' ' + imp + ' ' + met + ' → ' + m.numeroMovimento, 'ok');
    dfRenderNote();
    if (DF.ultimaId === id && typeof dfRenderUltima === 'function') dfRenderUltima('✅ Pagamento registrato');
  }).catch(function (err) {
    var msg = err && err.message || String(err);
    if (msg === 'DUPLICATO' || msg === 'GIA_REGISTRATO') {
      srLog('Pagamento già presente per ' + nome + ' (' + data + ', ' + imp + ')', 'warn');
      es.innerHTML = '<div class="errore">Nel gestionale c\'è già un pagamento di ' + srEsc(nome) + ' del ' + srDataIt(data) + ' da ' + srEuro(imp) + '. Non lo registro due volte.</div>' +
        '<button class="btn-gray btn-sm" onclick="dfgSegnaGiaFatto(\'' + id + '\',' + aid + ')">Segna la nota come già registrata</button>';
      return;
    }
    srLog('Pagamento NON registrato: ' + msg, 'err');
    es.innerHTML = '<div class="errore">NON registrato: ' + srEsc(msg) + '</div>';
  });
}
function dfgSegnaGiaFatto(id, aid) {
  var n = dfTrova(id), a = dfgAtleta(aid);
  dfAggiornaNota(n, { stato: 'ELABORATA', collegamenti: (n.collegamenti || []).concat([{ tipo: 'PAGAMENTO', atletaId: aid, nome: a ? dfgNomeAtl(a) : '', il: new Date().toISOString(), giaPresente: true }]) },
    'già presente nel gestionale').catch(function () { /* errore già mostrato da dfAggiornaNota */ });
}

// Proposta dati scheda
var DFG_CAMPI = { dn: 'Data di nascita', indComune: 'Comune di residenza', cs: 'Scadenza certificato' };
function dfgValore(campo, v) { return v == null || v === '' ? '—' : (campo === 'dn' || campo === 'cs') && String(v).indexOf('-') > 0 ? srDataIt(v) : String(v); }
function dfgApriDati(id) {
  var n = dfTrova(id), el = n && dfgPannello(id);
  if (!n || !el) return;
  if (!DFG.caricato) { el.innerHTML = '<div class="errore">Anagrafica non ancora caricata: riprova tra poco.</div>'; return; }
  var sel = dfgAtletaProposto(n);
  el.innerHTML = '<div class="card" style="margin-top:8px;border:1px solid var(--gold)"><label>Atleta</label><select id="dfg-atl-' + id + '" onchange="dfgRenderProposta(\'' + id + '\')">' + dfgOpzioniAtleti(n, sel) + '</select>' +
    '<div id="dfg-prop-' + id + '"></div><div id="dfg-esito-' + id + '"></div></div>';
  dfgRenderProposta(id);
}
function dfgProposta(testo, a) {
  var d = dfgEstraiDati(testo), righe = [];
  Object.keys(DFG_CAMPI).forEach(function (k) { if (d[k] && (!a || String(a[k] || '') !== d[k])) righe.push({ k: k, l: DFG_CAMPI[k] + (k === 'cs' && d.csDa && d.csDa !== 'scadenza' ? ' (da ' + d.csDa + ' + 365 gg)' : ''), da: a ? a[k] : '', a: d[k] }); });
  Object.keys(d.doc || {}).forEach(function (k) { var prec = a && a.docConsegnati ? a.docConsegnati[k] : ''; if (prec !== d.doc[k]) righe.push({ k: 'doc.' + k, l: DFG_DOC[k], da: prec || '', a: d.doc[k] }); });
  return righe;
}
function dfgRenderProposta(id) {
  var n = dfTrova(id), a = dfgAtleta(parseInt(document.getElementById('dfg-atl-' + id).value, 10)), el = document.getElementById('dfg-prop-' + id);
  if (!a) { el.innerHTML = '<div style="font-size:12px;color:var(--muted);margin:6px 0">Scegli l\'atleta a cui si riferisce la nota.</div>'; return; }
  var pr = dfgProposta(n.testo, a);
  var sens = dfgOscura(n.testo) !== n.testo;
  el.innerHTML = (pr.length ? '<div style="margin:8px 0;font-size:13px">' + pr.map(function (r, i) {
    return '<label style="display:flex;gap:8px;align-items:flex-start;margin:4px 0;font-size:13px;color:var(--text)"><input type="checkbox" id="dfg-c-' + id + '-' + i + '" checked style="width:auto;min-height:0;margin-top:3px">' +
      '<span><b>' + srEsc(r.l) + '</b>: ' + srEsc(dfgValore(r.k, r.da)) + ' → <b>' + srEsc(dfgValore(r.k, r.a)) + '</b></span></label>';
  }).join('') + '</div><button class="btn-gold btn-sm" onclick="dfgConfermaDati(\'' + id + '\')">✅ Aggiorna la scheda</button> '
    : '<div style="font-size:12px;color:var(--muted);margin:6px 0">Nessun dato di scheda riconosciuto (o già uguale).</div>') +
    '<button class="btn-gray btn-sm" onclick="dfgConfermaDati(\'' + id + '\',true)">📎 Aggiungi alle note dell\'atleta</button> <button class="btn-gray btn-sm" onclick="dfgChiudi(\'' + id + '\')">Chiudi</button>' +
    (sens ? '<div style="font-size:12px;color:var(--warn);margin-top:6px">La nota contiene dati da non registrare (codice fiscale, telefono o n. documento): nelle note dell\'atleta vengono oscurati.</div>' : '');
}
function dfgConfermaDati(id, soloNota) {
  var n = dfTrova(id), es = document.getElementById('dfg-esito-' + id);
  var aid = parseInt(document.getElementById('dfg-atl-' + id).value, 10), a0 = dfgAtleta(aid);
  if (!a0) { es.innerHTML = '<div class="errore">Scegli l\'atleta.</div>'; return; }
  var scelte = soloNota ? [] : dfgProposta(n.testo, a0).filter(function (r, i) { var c = document.getElementById('dfg-c-' + id + '-' + i); return c && c.checked; });
  if (!soloNota && !scelte.length) { es.innerHTML = '<div class="errore">Nessuna voce selezionata.</div>'; return; }
  var nome = dfgNomeAtl(a0), oggiIt = srDataIt(srOggi()), adesso = new Date().toISOString();
  var descr = soloNota ? 'aggiunta alle note dell\'atleta' : scelte.map(function (r) { return r.l + ' ' + dfgValore(r.k, r.a); }).join('; ');
  var copia = dfgNotaAggiornata(n, [{ tipo: 'ATLETA', atletaId: aid, nome: nome, campi: scelte.map(function (r) { return r.k; }) }], 'scheda ' + nome + ': ' + descr);
  var ref = _db.collection('basket052441').doc('atleti');
  es.innerHTML = '<div class="domanda">Aggiornamento…</div>';
  _db.runTransaction(function (tx) {
    return tx.get(ref).then(function (d) {
      var arr = d.exists && d.data().v ? JSON.parse(d.data().v) : [];
      var a = arr.find(function (x) { return x.id === aid; });
      if (!a) throw new Error('atleta non più presente in anagrafica');
      if (soloNota) a.note = ((a.note || '').trim() + (a.note ? '\n' : '') + '[' + oggiIt + '] ' + dfgOscura(n.testo)).slice(0, 4000);
      scelte.forEach(function (r) {
        if (r.k.indexOf('doc.') === 0) { a.docConsegnati = a.docConsegnati || {}; a.docConsegnati[r.k.slice(4)] = r.a; }
        else a[r.k] = r.a;
      });
      a.modTs = adesso;
      a.storiaDittafono = (a.storiaDittafono || []).concat([{ il: adesso, notaId: id, campi: soloNota ? ['note'] : scelte.map(function (r) { return r.k; }) }]).slice(-50);
      tx.set(ref, { v: JSON.stringify(arr), ts: adesso, da: 'dittafono ' + SR.utente });
      tx.set(dfCol().doc(id), copia);
      DFG.atl = arr;
    });
  }).then(function () {
    Object.assign(n, copia);
    srLog('Scheda ' + nome + ' aggiornata: ' + descr, 'ok');
    dfRenderNote();
    if (DF.ultimaId === id && typeof dfRenderUltima === 'function') dfRenderUltima('✅ Scheda aggiornata');
  }).catch(function (err) { srLog('Scheda NON aggiornata: ' + err.message, 'err'); es.innerHTML = '<div class="errore">NON aggiornata: ' + srEsc(err.message) + '</div>'; });
}

// ════════ DOMANDE ════════
// Ritorna true se il testo era una domanda (gestita qui, non salvata come nota).
function dfgProvaDomanda(testo) {
  var q = dfgRiconosciDomanda(testo, DF.atleti);
  if (!q) return false;
  var out = document.getElementById('dfg-risposta');
  if (!DFG.caricato) { out.innerHTML = '<div class="errore">Dati del gestionale non ancora caricati: riprova tra poco.</div>'; return true; }
  var oggi = srOggi(), extra = {};
  var prep = Promise.resolve();
  if (q.tipo === 'CASSA') {
    extra.cassa = srSaldoCassa();
    extra.anticipi = (SR.anticipi || []).filter(function (m) { return m.stato === 'DA_PAGARE'; }).reduce(function (s, m) { return s + (Number(m.importoEur) || 0); }, 0);
  }
  if (q.tipo === 'SPESE') prep = srAnnoCaricato(+oggi.slice(0, 4)).then(function (mv) { extra.movimenti = mv; });
  prep.then(function () {
    var r = dfgRispondi(q, DFG.atl, DFG.pag, oggi, extra);
    r.domanda = testo; DFG.risposta = r;
    out.innerHTML = dfgHtmlRisposta(r, false) + (r.righe.length ? '<div style="margin-top:8px"><button class="btn-gray btn-sm" onclick="dfgStampa()">🖨️ Stampa</button> <button class="btn-gray btn-sm" onclick="dfgCSV()">⬇️ CSV</button></div>' : '');
    srLog('Domanda: "' + testo + '" → ' + r.titolo + ' (' + r.righe.length + ' righe)', 'ok');
  }).catch(function (err) { srLog('Risposta non calcolata: ' + err.message, 'err'); out.innerHTML = '<div class="errore">Risposta non calcolata: ' + srEsc(err.message) + '</div>'; });
  return true;
}
function dfgHtmlRisposta(r, stampa) {
  var th = r.colonne.map(function (c) { return '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid #999">' + srEsc(c) + '</th>'; }).join('');
  var tr = r.righe.map(function (x) { return '<tr>' + x.map(function (c) { return '<td style="padding:4px 6px;border-bottom:1px solid ' + (stampa ? '#ddd' : 'var(--border)') + ';vertical-align:top">' + srEsc(c) + '</td>'; }).join('') + '</tr>'; }).join('');
  return '<div class="card"' + (stampa ? '' : ' style="padding:10px 12px"') + '><div style="font-weight:700;font-size:15px">' + srEsc(r.titolo) + '</div>' +
    (r.sotto ? '<div style="font-size:12px;opacity:.75;margin-bottom:6px">' + srEsc(r.sotto) + '</div>' : '') +
    (r.righe.length ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>' + th + '</tr></thead><tbody>' + tr + '</tbody></table></div>' : '') +
    (r.nota ? '<div style="font-size:12px;opacity:.75;margin-top:6px">' + srEsc(r.nota) + '</div>' : '') + '</div>';
}
function dfgStampa() {
  var r = DFG.risposta; if (!r) return;
  var w = window.open('', '_blank');
  if (!w) { alert('Il telefono ha bloccato la finestra di stampa: consenti i popup per questa pagina.'); srLog('Stampa bloccata (popup)', 'warn'); return; }
  w.document.write('<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>' + srEsc(r.titolo) + '</title><style>body{font-family:Arial,sans-serif;font-size:12px;color:#000;margin:0}' +
    '@page{size:A4;margin:14mm 12mm 16mm;@bottom-right{content:"pag. " counter(page) " di " counter(pages);font-size:9px}@bottom-left{content:"ASD Basket Campodarsego · stampato il ' + srDataIt(srOggi()) + '";font-size:9px}}' +
    'thead{display:table-header-group}tr{page-break-inside:avoid}.no-print{padding:8px;background:#eee;text-align:center}@media print{.no-print{display:none}}</style></head><body>' +
    '<div class="no-print"><button onclick="window.print()" style="padding:8px 22px">🖨️ Stampa / Salva PDF</button></div>' +
    '<div style="font-size:11px;margin:4px 0 8px">ASD Basket Campodarsego · FIP 52441</div>' + dfgHtmlRisposta(r, true) + '</body></html>');
  w.document.close();
}
function dfgCSV() {
  var r = DFG.risposta; if (!r) return;
  var q = function (c) { c = String(c == null ? '' : c); return /[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; };
  var txt = '﻿' + [r.colonne].concat(r.righe).map(function (x) { return x.map(q).join(';'); }).join('\r\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  a.download = r.titolo.replace(/[^\w]+/g, '_') + '_' + srOggi() + '.csv';
  document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { dfgDate: dfgDate, dfgEstraiDati: dfgEstraiDati, dfgEstraiMetodo: dfgEstraiMetodo, dfgEstraiTipoPag: dfgEstraiTipoPag,
  dfgOscura: dfgOscura, dfgStatoCert: dfgStatoCert, dfgStagione: dfgStagione, dfgRiconosciDomanda: dfgRiconosciDomanda, dfgRispondi: dfgRispondi, dfgScadenzaDaEmissione: dfgScadenzaDaEmissione, dfgProposta: dfgProposta };
