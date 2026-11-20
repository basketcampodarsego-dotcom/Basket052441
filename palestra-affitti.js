// ════════════════════════════════════════════════════════
// FILE: palestra-affitti.js — ASD Basket Campodarsego
// VERSIONE: v0.1 · 20/11/2026 17:00 · BK
// v0.1 (regole di Alberto, 20/11/2026) — affitti degli utenti della palestra
//   di Via Hermagor:
//   - tariffa 14 €/ora (dal 2009, modificabile in un punto solo);
//   - si pagano le ORE DI CALENDARIO assegnate, usate o no, dall'inizio
//     attivita' al termine comunicato; senza termine: fine delle scuole
//     (Veneto 2026/27: 08/06/2027); amatori +1/2 settimane (impostabile);
//   - escluse solo le feste comandate e le sospensioni comunicate per tutti
//     (es. 26-27 dicembre);
//   - una lezione saltata da un utente si paga, SALVO avviso preventivo E ora
//     riutilizzata da altri; se la riutilizza un altro utente, la paga lui;
//   - rinuncia a un'ora: da quella data non si conta piu';
//   - versamenti irregolari (1-2 l'anno): residuo e "coperto fino al",
//     avvisi a dicembre (chiusura anno solare) e a fine attivita' (saldo);
//   - modalita' alternativa: cifra fissa mensile (es. volley 300 €/mese, dal
//     foglio atleti) finche' Alberto non conferma il calcolo a ore.
// Dati: basket052441/palestraAffitti {v: JSON}. Versamenti = movimenti
//   ENTRATA in Economia collegati all'utente (utentePalestraId) o con
//   categoria CONDIVPALESTRA e il nome dell'utente nella descrizione.
// Gratuito, nessun servizio esterno.
// ════════════════════════════════════════════════════════

var PA_VERSIONE = 'v0.1 · 20/11/2026 17:00';
var PA_GIORNI = ['', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
var PA_MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
var PA = { conf: null, caricato: false, movimenti: [], form: null };

// ════════ DATE (pure) ════════
function paPad(n) { return String(n).padStart(2, '0'); }
function paIso(d) { return d.getFullYear() + '-' + paPad(d.getMonth() + 1) + '-' + paPad(d.getDate()); }
function paData(iso) { var p = String(iso).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function paGiornoSett(iso) { var g = paData(iso).getDay(); return g === 0 ? 7 : g; } // 1 = lunedi'
function paAggiungi(iso, giorni) { var d = paData(iso); d.setDate(d.getDate() + giorni); return paIso(d); }
function paPasqua(a) { // algoritmo di Gauss/Meeus
  var b = a % 19, c = Math.floor(a / 100), d = a % 100, e = Math.floor(c / 4), f = c % 4, g = Math.floor((c + 8) / 25), h = Math.floor((c - g + 1) / 3);
  var i = (19 * b + c - e - h + 15) % 30, k = Math.floor(d / 4), l = d % 4, m = (32 + 2 * f + 2 * k - i - l) % 7, n = Math.floor((b + 11 * i + 22 * m) / 451);
  var mese = Math.floor((i + m - 7 * n + 114) / 31), giorno = ((i + m - 7 * n + 114) % 31) + 1;
  return a + '-' + paPad(mese) + '-' + paPad(giorno);
}
// Feste comandate nazionali (piu' Pasqua e Pasquetta)
function paFestivita(anno) {
  var f = {};
  [['01-01', 'Capodanno'], ['01-06', 'Epifania'], ['04-25', 'Liberazione'], ['05-01', 'Festa del lavoro'], ['06-02', 'Festa della Repubblica'], ['08-15', 'Ferragosto'],
    ['11-01', 'Ognissanti'], ['12-08', 'Immacolata'], ['12-25', 'Natale'], ['12-26', 'Santo Stefano']].forEach(function (x) { f[anno + '-' + x[0]] = x[1]; });
  var p = paPasqua(anno); f[p] = 'Pasqua'; f[paAggiungi(p, 1)] = 'Lunedì dell\'Angelo';
  return f;
}
function paFineUtente(u, conf) {
  if (u.fineComunicata) return u.fineComunicata;
  return paAggiungi(conf.fineScuole, 7 * (Number(u.extraSettimane) || 0));
}
// Ore di calendario dell'utente in quel giorno (con le rinunce)
function paOreGiorno(u, iso) {
  var g = paGiornoSett(iso), ore = 0;
  (u.slots || []).forEach(function (s) { if (Number(s.giorno) === g) ore += Number(s.ore) || 0; });
  (u.rinunce || []).forEach(function (r) { if (Number(r.giorno) === g && r.dal && iso >= r.dal) ore -= Number(r.ore) || 0; });
  return Math.max(0, ore);
}

// ════════ CALCOLO (puro) ════════
// Ritorna { modalita, inizio, fine, oreStagione, dovutoStagione, oreMaturate, maturato, esclusi:[{data,ore,motivo}], saltatePagate:[..], extra:[{data,ore,da}], perMese:{AAAA-MM: €} }
function paCalcola(u, conf, oggi) {
  var tar = Number(conf.tariffaOraria) || 0, ini = u.inizio, fine = paFineUtente(u, conf);
  var out = { modalita: u.modalita || 'ORARIA', inizio: ini, fine: fine, oreStagione: 0, dovutoStagione: 0, oreMaturate: 0, maturato: 0, esclusi: [], saltatePagate: [], extra: [], perMese: {} };
  if (!ini || !fine || fine < ini) return out;
  if (out.modalita === 'FISSO_MENSILE') {
    var imp = Number(u.importoMese) || 0, d = paData(ini), f = paData(fine), mesi = 0, mat = 0;
    for (var cur = new Date(d.getFullYear(), d.getMonth(), 1); cur <= f; cur.setMonth(cur.getMonth() + 1)) {
      mesi++; var k = cur.getFullYear() + '-' + paPad(cur.getMonth() + 1); out.perMese[k] = imp;
      if (k <= oggi.slice(0, 7)) mat++;
    }
    out.dovutoStagione = Math.round(mesi * imp * 100) / 100; out.maturato = Math.round(mat * imp * 100) / 100; out.mesi = mesi;
    return out;
  }
  var fest = {}; [Number(ini.slice(0, 4)), Number(fine.slice(0, 4))].forEach(function (a) { Object.assign(fest, paFestivita(a)); });
  var sosp = conf.sospensioni || [];
  var cade = function (s, iso) { return iso >= s.data && iso <= (s.dataFine || s.data); };
  for (var iso = ini; iso <= fine; iso = paAggiungi(iso, 1)) {
    var ore = paOreGiorno(u, iso), mese = iso.slice(0, 7), eff = ore;
    if (ore > 0) {
      var tutti = sosp.find(function (s) { return !s.utenteId && cade(s, iso); });
      var mia = sosp.find(function (s) { return s.utenteId === u.id && cade(s, iso); });
      if (fest[iso]) { out.esclusi.push({ data: iso, ore: ore, motivo: fest[iso] }); eff = 0; }
      else if (tutti) { out.esclusi.push({ data: iso, ore: ore, motivo: tutti.nota || 'sospensione comunicata' }); eff = 0; }
      else if (mia) {
        if (mia.avvisato && mia.riutilizzata) { var oreLib = Math.min(ore, Number(mia.ore) || ore); out.esclusi.push({ data: iso, ore: oreLib, motivo: 'avvisato e ora riutilizzata' }); eff = ore - oreLib; }
        else out.saltatePagate.push({ data: iso, ore: ore, motivo: !mia.avvisato ? 'non avvisato' : 'ora non riutilizzata' });
      }
    }
    // ore riutilizzate da questo utente al posto di un altro
    sosp.forEach(function (s) {
      if (s.riutilizzataDa !== u.id || !s.avvisato || !s.riutilizzata || !cade(s, iso)) return;
      var altro = (conf.utenti || []).find(function (x) { return x.id === s.utenteId; });
      var oreAltro = altro ? Math.min(paOreGiorno(altro, iso), Number(s.ore) || 99) : (Number(s.ore) || 0);
      if (oreAltro > 0 && !fest[iso]) { out.extra.push({ data: iso, ore: oreAltro, da: altro ? altro.nome : '' }); eff += oreAltro; }
    });
    if (eff > 0) {
      out.oreStagione += eff; out.perMese[mese] = (out.perMese[mese] || 0) + eff * tar;
      if (iso <= oggi) out.oreMaturate += eff;
    }
  }
  out.dovutoStagione = Math.round(out.oreStagione * tar * 100) / 100;
  out.maturato = Math.round(out.oreMaturate * tar * 100) / 100;
  return out;
}
// Fino a che data il versato copre il calendario
function paCopertoFino(c, versato) {
  var mesi = Object.keys(c.perMese).sort(), cum = 0, ultimo = null;
  for (var i = 0; i < mesi.length; i++) {
    cum += c.perMese[mesi[i]];
    if (cum <= versato + 0.004) ultimo = mesi[i]; else break;
  }
  if (!ultimo) return null;
  var p = ultimo.split('-').map(Number), d = new Date(p[0], p[1], 0);
  return paIso(d) > c.fine ? c.fine : paIso(d);
}
// Versamenti dell'utente nella stagione (date tra 1 agosto e 31 dicembre dell'anno dopo... ma mai di un'altra stagione: vedi stagioneAffitto)
function paVersamenti(u, movimenti, conf) {
  var y = Number(String(conf.stagione || '').slice(0, 4)), da = y + '-08-01', a = (y + 1) + '-12-31';
  var alias = [u.nome].concat(u.alias || []).map(function (x) { return String(x || '').toLowerCase().trim(); }).filter(function (x) { return x.length >= 3; });
  return (movimenti || []).filter(function (m) {
    if (m.tipoMovimento !== 'ENTRATA' || m.stato === 'ANNULLATO') return false;
    if (m.stagioneAffitto && m.stagioneAffitto !== conf.stagione) return false;
    if (m.utentePalestraId) return m.utentePalestraId === u.id;
    var d = m.dataDocumento || m.dataPagamento || '';
    if (d < da || d > a) return false;
    if (String(m.categoriaCodice || '').toUpperCase() !== 'CONDIVPALESTRA') return false;
    var testo = ((m.note || '') + ' ' + (m.fraseOriginale || '') + ' ' + (m.descrizione || '')).toLowerCase();
    return alias.some(function (x) { return testo.indexOf(x) >= 0; });
  });
}
function paSituazione(conf, movimenti, oggi) {
  return (conf.utenti || []).filter(function (u) { return u.attivo !== false; }).map(function (u) {
    var c = paCalcola(u, conf, oggi), vs = paVersamenti(u, movimenti, conf);
    var versato = Math.round(vs.reduce(function (s, m) { return s + (Number(m.importoEur) || 0); }, 0) * 100) / 100;
    return { u: u, c: c, versamenti: vs, versato: versato, residuo: Math.round((c.dovutoStagione - versato) * 100) / 100,
      scopertoOggi: Math.round((c.maturato - versato) * 100) / 100, copertoFino: paCopertoFino(c, versato) };
  });
}
// Avvisi: dicembre (chiusura anno solare) e fine attivita' (saldo)
function paAvvisi(sit, oggi) {
  var out = [], mese = Number(oggi.slice(5, 7));
  sit.forEach(function (s) {
    if (mese === 12 && s.scopertoOggi > 0.004) out.push({ u: s.u, tipo: 'DICEMBRE', importo: s.scopertoOggi, testo: 'Chiusura anno: ' + s.u.nome + ' deve ' + paEuro(s.scopertoOggi) + ' per le ore fino a oggi.' });
    var tra = paAggiungi(oggi, 21);
    if (s.c.fine && s.c.fine <= tra && s.residuo > 0.004) out.push({ u: s.u, tipo: 'SALDO', importo: s.residuo, testo: (s.c.fine < oggi ? 'Attività finita il ' : 'Fine attività il ') + paDataIt(s.c.fine) + ': ' + s.u.nome + ' deve il saldo di ' + paEuro(s.residuo) + '.' });
  });
  return out;
}
function paEuro(n) { return typeof srEuro === 'function' ? srEuro(n) : (Number(n) || 0).toFixed(2).replace('.', ',') + ' €'; }
function paDataIt(iso) { if (!iso) return ''; var p = String(iso).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
function paTestoSollecito(s, conf) {
  return 'Buongiorno, vi riepiloghiamo l\'utilizzo della palestra di Via Hermagor per la stagione ' + conf.stagione + ': ' +
    (s.c.modalita === 'FISSO_MENSILE' ? s.c.mesi + ' mesi a ' + paEuro(s.u.importoMese) : s.c.oreStagione + ' ore di calendario a ' + paEuro(conf.tariffaOraria) + '/ora') +
    ' = ' + paEuro(s.c.dovutoStagione) + '. Versato finora: ' + paEuro(s.versato) + (s.copertoFino ? ' (copre fino al ' + paDataIt(s.copertoFino) + ')' : '') +
    '. Ad oggi risultano da versare ' + paEuro(Math.max(0, s.scopertoOggi)) + ', a fine stagione ' + paEuro(Math.max(0, s.residuo)) + '. Grazie, ASD Basket Campodarsego.';
}

// ════════ DETTATURA (pure) ════════
// Date in una frase: "26 e 27 dicembre", "dal 24 dicembre al 6 gennaio", "il 3/12". Anno dalla stagione (set-dic = primo anno).
function paDateDette(testo, stagione) {
  var t = String(testo || '').toLowerCase(), y0 = Number(String(stagione).slice(0, 4)), out = [];
  var anno = function (m) { return m >= 8 ? y0 : y0 + 1; };
  var mesiRe = PA_MESI.join('|');
  var range = new RegExp('dal(?:l[\'’]\\s*)?\\s*(\\d{1,2})(?:\\s+(' + mesiRe + '))?\\s+al(?:l[\'’]\\s*)?\\s*(\\d{1,2})\\s+(' + mesiRe + ')', 'g'), m;
  var presi = [];
  while ((m = range.exec(t))) {
    var m2 = PA_MESI.indexOf(m[4]) + 1, m1 = m[2] ? PA_MESI.indexOf(m[2]) + 1 : m2;
    var da = anno(m1) + '-' + paPad(m1) + '-' + paPad(+m[1]), a = anno(m2) + '-' + paPad(m2) + '-' + paPad(+m[3]);
    out.push({ data: da, dataFine: a }); presi.push([m.index, m.index + m[0].length]);
  }
  var lista = new RegExp('((?:\\d{1,2}\\s*(?:,|e|ed)\\s*)*\\d{1,2})\\s+(' + mesiRe + ')', 'g');
  while ((m = lista.exec(t))) {
    if (presi.some(function (p) { return m.index >= p[0] && m.index < p[1]; })) continue;
    var mm = PA_MESI.indexOf(m[2]) + 1;
    m[1].split(/\s*(?:,|e|ed)\s*/).forEach(function (g) { if (g) out.push({ data: anno(mm) + '-' + paPad(mm) + '-' + paPad(+g) }); });
  }
  var re3 = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  while ((m = re3.exec(t))) { var mn = +m[2], aa = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : anno(mn); out.push({ data: aa + '-' + paPad(mn) + '-' + paPad(+m[1]) }); }
  return out.filter(function (x) { return !isNaN(paData(x.data)); });
}
function paUtentiDetti(testo, utenti) {
  var t = ' ' + String(testo || '').toLowerCase().replace(/[^a-zà-ù0-9 ]/g, ' ') + ' ';
  return (utenti || []).filter(function (u) {
    return [u.nome].concat(u.alias || []).some(function (x) { x = String(x || '').toLowerCase().trim(); return x.length >= 3 && t.indexOf(' ' + x) >= 0; });
  });
}
// La nota parla di attivita' della palestra (sospensioni/assenze di utenti)? -> 'PALESTRA' o null
function paClassificaNota(testo, utenti, atletiNominati) {
  var t = String(testo || '').toLowerCase();
  var parlaUtente = paUtentiDetti(testo, utenti).length > 0;
  var sospensione = /(niente|nessuna|non c.?e)\s+attivit|palestra chius|sospes|sospend|non (vien\w*|vengono|fann\w*|fa)\b|salta\w*|rinunci\w*|avvisat\w*|riutilizz/.test(t);
  if (sospensione && (parlaUtente || /palestra|attivit/.test(t)) && !(atletiNominati && atletiNominati.length && !parlaUtente)) return 'PALESTRA';
  return null;
}
// Proposta di sospensione dalla nota
function paPropostaSospensione(testo, conf) {
  var t = String(testo || '').toLowerCase(), utenti = paUtentiDetti(testo, conf.utenti);
  var date = paDateDette(testo, conf.stagione);
  var perTutti = /(niente|nessuna|non c.?e)\s+attivit|palestra chius|per tutti/.test(t) && !/non (vien\w*|fa)\b/.test(t);
  var chi = perTutti || !utenti.length ? null : utenti[0];
  var da = null;
  if (utenti.length > 1) da = utenti[1];
  var mr = t.match(/(?:data|dat[ao] a|usat[ao] da|pres[ao] da|riutilizzat[ao] da|l.ha (?:presa|usata))\s+(?:a(?:gli|lla|l)?\s+)?([a-zà-ù ]+)/);
  if (mr) { var u2 = paUtentiDetti(mr[1], conf.utenti)[0]; if (u2 && (!chi || u2.id !== chi.id)) da = u2; }
  return { date: date, utenteId: chi ? chi.id : null, avvisato: /avvisat\w*|ha avvisato|comunicat\w*|ha detto|preavvis/.test(t), riutilizzata: /riutilizz|data a|dat[ao] ad?|usat[ao] da|pres[ao] da|recuperat/.test(t) || !!da, riutilizzataDa: da ? da.id : null };
}

// ════════ CONFIGURAZIONE DI PARTENZA ════════
function paConfIniziale(oggi) {
  var a = Number(oggi.slice(5, 7)) >= 8 ? Number(oggi.slice(0, 4)) : Number(oggi.slice(0, 4)) - 1;
  return {
    tariffaOraria: 14, stagione: a + '-' + String(a + 1).slice(2),
    fineScuole: a === 2026 ? '2027-06-08' : (a + 1) + '-06-08', // Veneto 2026/27: delibera n. 712 del 07/07/2026
    utenti: [{ id: 'U-VOLLEY', nome: 'Volley amatoriale', alias: ['volley', 'pallavolo'], modalita: 'FISSO_MENSILE', importoMese: 300, inizio: a + '-09-01', fineComunicata: (a + 1) + '-05-31',
      slots: [], rinunce: [], extraSettimane: 2, attivo: true, nota: 'Dal foglio atleti: 300 €/mese settembre-maggio. Da confermare se passare a ore × tariffa.' }],
    sospensioni: [], storia: [{ il: new Date().toISOString(), azione: 'creata configurazione iniziale' }]
  };
}

// ════════ PAGINA 🏟️ PALESTRA (browser) ════════
function paDoc() { return _db.collection('basket052441').doc('palestraAffitti'); }
function paCarica() {
  var oggi = srOggi();
  return paDoc().get().then(function (d) {
    PA.conf = d.exists && d.data().v ? JSON.parse(d.data().v) : paConfIniziale(oggi);
    PA.nuova = !d.exists;
    var y0 = Number(String(PA.conf.stagione).slice(0, 4));
    return Promise.all([srAnnoCaricato(y0), srAnnoCaricato(y0 + 1)]);
  }).then(function (mm) {
    PA.movimenti = (mm[0] || []).concat(mm[1] || []);
    PA.caricato = true;
  });
}
// Scrittura: legge, modifica, riscrive (transazione) + storia
function paSalvaConf(fn, azione) {
  var nuova;
  return _db.runTransaction(function (tx) {
    return tx.get(paDoc()).then(function (d) {
      var c = d.exists && d.data().v ? JSON.parse(d.data().v) : (PA.conf ? JSON.parse(JSON.stringify(PA.conf)) : paConfIniziale(srOggi()));
      fn(c);
      c.storia = (c.storia || []).concat([{ il: new Date().toISOString(), da: SR.utente, azione: azione }]).slice(-200);
      tx.set(paDoc(), { v: JSON.stringify(c), ts: new Date().toISOString(), da: 'dittafono ' + SR.utente });
      nuova = c;
    });
  }).then(function () { PA.conf = nuova; PA.nuova = false; srLog('Palestra: ' + azione, 'ok'); return nuova; });
}
function paRender() {
  var el = document.getElementById('pa-contenuto'); if (!el) return;
  if (!PA.caricato) {
    el.innerHTML = '<div class="empty">Caricamento…</div>';
    paCarica().then(paRender).catch(function (err) { srLog('Palestra non caricata: ' + err.message, 'err'); el.innerHTML = '<div class="errore">Dati palestra non caricati: ' + srEsc(err.message) + '</div>'; });
    return;
  }
  var c = PA.conf, oggi = srOggi(), sit = paSituazione(c, PA.movimenti, oggi), avv = paAvvisi(sit, oggi);
  var tot = sit.reduce(function (a, s) { a.d += s.c.dovutoStagione; a.v += s.versato; a.r += Math.max(0, s.residuo); return a; }, { d: 0, v: 0, r: 0 });
  el.innerHTML = '<div class="card"><div class="card-title">🏟️ Affitti palestra · stagione ' + srEsc(c.stagione) + '</div>' +
    '<div class="card-desc">' + paEuro(c.tariffaOraria) + '/ora sulle ore di calendario · fine attività se non comunicata: fine scuole ' + paDataIt(c.fineScuole) + ' · <a href="#" onclick="paApriImpostazioni();return false">modifica</a></div>' +
    (PA.nuova ? '<div class="domanda">Configurazione nuova (non ancora salvata): controlla il volley e aggiungi gli altri utenti.</div>' : '') +
    '<div class="riep-riga">Dovuto stagione ' + paEuro(tot.d) + ' · versato ' + paEuro(tot.v) + ' · da versare ' + paEuro(tot.r) + '</div>' +
    avv.map(function (a) { return '<div class="errore" style="margin-top:6px">⏰ ' + srEsc(a.testo) + '</div>'; }).join('') + '</div>' +
    sit.map(function (s) {
      var u = s.u;
      var calend = u.modalita === 'FISSO_MENSILE' ? paEuro(u.importoMese) + '/mese × ' + s.c.mesi + ' mesi' :
        ((u.slots || []).map(function (x) { return PA_GIORNI[x.giorno].slice(0, 3) + ' ' + x.ore + 'h'; }).join(', ') || 'nessun orario') + ' · ' + s.c.oreStagione + ' ore';
      return '<div class="card"><div class="mov-top"><span style="font-weight:700">' + srEsc(u.nome) + '</span><span>' + paEuro(s.residuo) + '</span></div>' +
        '<div class="mov-desc">' + srEsc(calend) + ' · dal ' + paDataIt(s.c.inizio) + ' al ' + paDataIt(s.c.fine) + (u.fineComunicata ? ' (comunicato)' : '') + '</div>' +
        '<div class="mov-desc">Dovuto ' + paEuro(s.c.dovutoStagione) + ' · maturato a oggi ' + paEuro(s.c.maturato) + ' · versato ' + paEuro(s.versato) + (s.copertoFino ? ' · coperto fino al ' + paDataIt(s.copertoFino) : '') + '</div>' +
        (s.c.saltatePagate.length ? '<div class="mov-desc">Lezioni saltate ma pagate: ' + s.c.saltatePagate.map(function (x) { return paDataIt(x.data) + ' (' + x.motivo + ')'; }).join(', ') + '</div>' : '') +
        (s.c.extra.length ? '<div class="mov-desc">Ore in più riutilizzate: ' + s.c.extra.map(function (x) { return paDataIt(x.data) + ' ' + x.ore + 'h al posto di ' + x.da; }).join(', ') + '</div>' : '') +
        (u.nota ? '<div class="mov-desc" style="color:var(--warn)">' + srEsc(u.nota) + '</div>' : '') +
        '<div style="margin-top:6px"><button class="btn-gray btn-sm" onclick="paApriUtente(\'' + u.id + '\')">✏️ Modifica</button> <button class="btn-gray btn-sm" onclick="paSollecito(\'' + u.id + '\')">📤 Riepilogo/sollecito</button></div></div>';
    }).join('') +
    '<div class="card"><button class="btn-gray btn-sm" onclick="paApriUtente(null)">➕ Nuovo utente</button> <button class="btn-gray btn-sm" onclick="paNuovaSospensione()">📅 Sospensione / assenza</button> <button class="btn-gray btn-sm" onclick="paStampa()">🖨️ Stampa</button>' +
    '<div id="pa-form"></div></div>' +
    '<div class="card"><div class="card-title">📅 Sospensioni e assenze</div>' + ((c.sospensioni || []).length ? (c.sospensioni || []).slice().sort(function (a, b) { return a.data.localeCompare(b.data); }).map(function (x) {
      var u = (c.utenti || []).find(function (k) { return k.id === x.utenteId; }), da = (c.utenti || []).find(function (k) { return k.id === x.riutilizzataDa; });
      var effetto = !x.utenteId ? 'per tutti: ore non conteggiate' : (x.avvisato && x.riutilizzata ? 'non pagata' + (da ? ', la paga ' + da.nome : '') : 'si paga (' + (!x.avvisato ? 'non avvisato' : 'ora non riutilizzata') + ')');
      return '<div class="mov-desc">' + paDataIt(x.data) + (x.dataFine && x.dataFine !== x.data ? '–' + paDataIt(x.dataFine) : '') + ' · ' + srEsc(u ? u.nome : 'tutti') + ' · ' + effetto + (x.nota ? ' · ' + srEsc(x.nota) : '') +
        ' <a href="#" onclick="paEliminaSospensione(\'' + x.id + '\');return false">✖</a></div>';
    }).join('') : '<div class="empty">Nessuna.</div>') + '</div>';
}
function paOpzUtenti(sel, conTutti) {
  return (conTutti ? '<option value="">— tutti / palestra chiusa —</option>' : '<option value="">— nessuno —</option>') +
    (PA.conf.utenti || []).map(function (u) { return '<option value="' + u.id + '"' + (u.id === sel ? ' selected' : '') + '>' + srEsc(u.nome) + '</option>'; }).join('');
}
function paApriImpostazioni() {
  var c = PA.conf;
  document.getElementById('pa-form').innerHTML = '<div class="card" style="border:1px solid var(--gold)"><label>Tariffa €/ora</label><input id="pa-tar" inputmode="decimal" value="' + c.tariffaOraria + '">' +
    '<label>Stagione</label><input id="pa-stag" value="' + srEsc(c.stagione) + '"><label>Fine delle scuole (termine se non comunicato)</label><input type="date" id="pa-fs" value="' + c.fineScuole + '">' +
    '<button class="btn-gold btn-sm" onclick="paSalvaImpostazioni()">Salva</button></div>';
  document.getElementById('pa-form').scrollIntoView({ block: 'nearest' });
}
function paSalvaImpostazioni() {
  var tar = parseFloat(String(document.getElementById('pa-tar').value).replace(',', '.')), st = document.getElementById('pa-stag').value.trim(), fs = document.getElementById('pa-fs').value;
  if (!(tar > 0) || !/^\d{4}-\d{2}$/.test(st) || !fs) { alert('Controlla tariffa, stagione (es. 2026-27) e fine scuole.'); return; }
  paSalvaConf(function (c) { c.tariffaOraria = tar; c.stagione = st; c.fineScuole = fs; }, 'impostazioni: ' + tar + ' €/ora, stagione ' + st + ', fine scuole ' + fs).then(paRender)
    .catch(function (err) { srLog('Impostazioni palestra non salvate: ' + err.message, 'err'); alert('Non salvate: ' + err.message); });
}
function paApriUtente(id) {
  var u = id ? (PA.conf.utenti || []).find(function (x) { return x.id === id; }) : { id: '', nome: '', alias: [], modalita: 'ORARIA', inizio: '', fineComunicata: '', extraSettimane: 0, slots: [], rinunce: [], importoMese: 0, telefono: '' };
  var oreG = function (g) { return (u.slots || []).filter(function (s) { return Number(s.giorno) === g; }).reduce(function (t, s) { return t + Number(s.ore); }, 0) || ''; };
  document.getElementById('pa-form').innerHTML = '<div class="card" style="border:1px solid var(--gold)">' +
    '<label>Nome</label><input id="pa-nome" value="' + srEsc(u.nome) + '"><label>Altri nomi con cui lo detti (separati da virgola)</label><input id="pa-alias" value="' + srEsc((u.alias || []).join(', ')) + '">' +
    '<label>Telefono referente (per WhatsApp, facoltativo)</label><input id="pa-tel" inputmode="tel" value="' + srEsc(u.telefono || '') + '">' +
    '<label>Calcolo</label><select id="pa-mod" onchange="document.getElementById(\'pa-fisso\').style.display=this.value===\'FISSO_MENSILE\'?\'block\':\'none\'"><option value="ORARIA"' + (u.modalita !== 'FISSO_MENSILE' ? ' selected' : '') + '>Ore di calendario × tariffa</option><option value="FISSO_MENSILE"' + (u.modalita === 'FISSO_MENSILE' ? ' selected' : '') + '>Cifra fissa al mese</option></select>' +
    '<div id="pa-fisso" style="display:' + (u.modalita === 'FISSO_MENSILE' ? 'block' : 'none') + '"><label>€ al mese</label><input id="pa-imp" inputmode="decimal" value="' + (u.importoMese || '') + '"></div>' +
    '<label>Ore di calendario per giorno</label><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">' + [1, 2, 3, 4, 5, 6, 7].map(function (g) { return '<div><div style="font-size:11px;color:var(--muted)">' + PA_GIORNI[g].slice(0, 3) + '</div><input id="pa-g' + g + '" inputmode="decimal" value="' + oreG(g) + '" placeholder="0"></div>'; }).join('') + '</div>' +
    '<div style="display:flex;gap:8px"><div style="flex:1"><label>Inizio attività</label><input type="date" id="pa-ini" value="' + (u.inizio || '') + '"></div><div style="flex:1"><label>Fine comunicata</label><input type="date" id="pa-fine" value="' + (u.fineComunicata || '') + '"></div></div>' +
    '<label>Settimane oltre la fine scuole (amatori: 1-2)</label><input id="pa-extra" inputmode="numeric" value="' + (u.extraSettimane || 0) + '">' +
    '<label>Rinunce (una per riga: data giorno ore, es. "2027-01-01 lun 1")</label><textarea id="pa-rin" rows="2">' + srEsc((u.rinunce || []).map(function (r) { return r.dal + ' ' + PA_GIORNI[r.giorno].slice(0, 3).toLowerCase() + ' ' + r.ore; }).join('\n')) + '</textarea>' +
    '<button class="btn-gold btn-sm" onclick="paSalvaUtente(\'' + (u.id || '') + '\')">Salva utente</button>' + (u.id ? ' <button class="btn-red btn-sm" onclick="paDisattivaUtente(\'' + u.id + '\')">Togli dall\'elenco</button>' : '') + '</div>';
  document.getElementById('pa-form').scrollIntoView({ block: 'nearest' });
}
function paSalvaUtente(id) {
  var v = function (k) { return document.getElementById(k).value; }, num = function (x) { return parseFloat(String(x || '').replace(',', '.')) || 0; };
  var nome = v('pa-nome').trim(), mod = v('pa-mod'), slots = [], rinunce = [], err = [];
  if (mod !== 'ORARIA' && mod !== 'FISSO_MENSILE') { srLog('Modalità affitto sconosciuta: ' + mod, 'err'); return; }
  [1, 2, 3, 4, 5, 6, 7].forEach(function (g) { var o = num(v('pa-g' + g)); if (o > 0) slots.push({ giorno: g, ore: o }); });
  v('pa-rin').split('\n').map(function (r) { return r.trim(); }).filter(Boolean).forEach(function (r) {
    var m = r.match(/^(\d{4}-\d{2}-\d{2})\s+(\w{3})\w*\s+([\d.,]+)/i), g = m ? PA_GIORNI.findIndex(function (x) { return x && x.slice(0, 3).toLowerCase() === m[2].toLowerCase(); }) : -1;
    if (!m || g < 1) err.push('rinuncia non capita: "' + r + '"'); else rinunce.push({ dal: m[1], giorno: g, ore: num(m[3]) });
  });
  if (!nome) err.push('nome'); if (!v('pa-ini')) err.push('inizio attività');
  if (mod === 'ORARIA' && !slots.length) err.push('almeno un giorno con le ore');
  if (mod === 'FISSO_MENSILE' && !(num(v('pa-imp')) > 0)) err.push('€ al mese');
  if (err.length) { alert('Manca o non va: ' + err.join(', ')); return; }
  var dati = { nome: nome, alias: v('pa-alias').split(',').map(function (x) { return x.trim(); }).filter(Boolean), telefono: v('pa-tel').trim(), modalita: mod, importoMese: num(v('pa-imp')),
    slots: slots, inizio: v('pa-ini'), fineComunicata: v('pa-fine'), extraSettimane: Math.max(0, Math.round(num(v('pa-extra')))), rinunce: rinunce, attivo: true };
  var nuovoId = id || ('U-' + Date.now().toString(36).toUpperCase());
  paSalvaConf(function (c) {
    c.utenti = c.utenti || [];
    var i = c.utenti.findIndex(function (x) { return x.id === nuovoId; });
    if (i >= 0) { dati.nota = c.utenti[i].nota && mod === c.utenti[i].modalita ? c.utenti[i].nota : ''; c.utenti[i] = Object.assign({}, c.utenti[i], dati); }
    else c.utenti.push(Object.assign({ id: nuovoId }, dati));
  }, (id ? 'modificato' : 'nuovo') + ' utente ' + nome).then(function () { document.getElementById('pa-form').innerHTML = ''; paRender(); })
    .catch(function (e) { srLog('Utente palestra non salvato: ' + e.message, 'err'); alert('Non salvato: ' + e.message); });
}
function paDisattivaUtente(id) {
  if (!confirm('Togliere l\'utente dall\'elenco? Resta nello storico.')) return;
  paSalvaConf(function (c) { (c.utenti || []).forEach(function (u) { if (u.id === id) u.attivo = false; }); }, 'utente ' + id + ' tolto').then(paRender)
    .catch(function (e) { srLog('Utente non tolto: ' + e.message, 'err'); });
}
function paNuovaSospensione(pr, notaId) {
  pr = pr || { date: [{ data: srOggi() }], utenteId: null, avvisato: false, riutilizzata: false, riutilizzataDa: null };
  var d0 = pr.date[0] || { data: srOggi() };
  var html = '<div class="card" style="border:1px solid var(--gold)">' +
    '<div style="display:flex;gap:8px"><div style="flex:1"><label>Dal</label><input type="date" id="pas-da" value="' + d0.data + '"></div><div style="flex:1"><label>Al (se più giorni)</label><input type="date" id="pas-a" value="' + (d0.dataFine || (pr.date.length > 1 ? pr.date[pr.date.length - 1].data : '')) + '"></div></div>' +
    (pr.date.length > 1 && !d0.dataFine ? '<div class="card-desc">Date dette: ' + pr.date.map(function (x) { return paDataIt(x.data); }).join(', ') + '</div>' : '') +
    '<label>Chi</label><select id="pas-chi">' + paOpzUtenti(pr.utenteId, true) + '</select>' +
    '<label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" id="pas-avv" style="width:auto;min-height:0"' + (pr.avvisato ? ' checked' : '') + '> Ha avvisato prima</label>' +
    '<label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" id="pas-riu" style="width:auto;min-height:0"' + (pr.riutilizzata ? ' checked' : '') + '> L\'ora è stata riutilizzata da altri</label>' +
    '<label>Riutilizzata da (paga lui)</label><select id="pas-da-chi">' + paOpzUtenti(pr.riutilizzataDa, false) + '</select>' +
    '<label>Nota</label><input id="pas-nota" value="">' +
    '<div class="card-desc">Per tutti = ore non conteggiate a nessuno. Per un utente: non pagata solo se ha avvisato E l\'ora è stata riutilizzata.</div>' +
    '<button class="btn-gold btn-sm" onclick="paSalvaSospensione(' + (notaId ? '\'' + notaId + '\'' : 'null') + ')">Registra</button></div>';
  var dove = notaId ? document.getElementById('dfg-pan-' + notaId) : document.getElementById('pa-form');
  if (dove) { dove.innerHTML = html; if (notaId) { var sel = PA._dateNota = pr.date; } dove.scrollIntoView({ block: 'nearest' }); }
}
function paSalvaSospensione(notaId) {
  var v = function (k) { return document.getElementById(k).value; }, chk = function (k) { return document.getElementById(k).checked; };
  var da = v('pas-da'), a = v('pas-a') || da, chi = v('pas-chi') || null;
  if (!da || a < da) { alert('Controlla le date.'); return; }
  var elenco = [];
  var dateNota = notaId && PA._dateNota && PA._dateNota.length > 1 && !PA._dateNota[0].dataFine && !document.getElementById('pas-a').value ? PA._dateNota : null;
  (dateNota || [{ data: da, dataFine: a }]).forEach(function (x, i) {
    elenco.push({ id: 'S-' + Date.now().toString(36) + i, data: x.data, dataFine: x.dataFine || x.data, utenteId: chi, avvisato: chk('pas-avv'), riutilizzata: chk('pas-riu'), riutilizzataDa: v('pas-da-chi') || null, nota: v('pas-nota'), notaId: notaId || null });
  });
  if (elenco.some(function (x) { return x.riutilizzataDa && x.riutilizzataDa === x.utenteId; })) { alert('Chi riutilizza l\'ora non può essere lo stesso utente.'); return; }
  paSalvaConf(function (c) { c.sospensioni = (c.sospensioni || []).concat(elenco); }, 'sospensione ' + elenco.map(function (x) { return x.data + (x.dataFine !== x.data ? '→' + x.dataFine : ''); }).join(', ') + ' ' + (chi || 'tutti'))
    .then(function () {
      if (notaId && typeof dfAggiornaNota === 'function') {
        var n = dfTrova(notaId);
        return dfAggiornaNota(n, { stato: 'ELABORATA', collegamenti: (n.collegamenti || []).concat([{ tipo: 'PALESTRA', sospensioni: elenco.map(function (x) { return x.id; }), il: new Date().toISOString() }]) }, 'registrata in palestra');
      }
    }).then(function () { var f = document.getElementById('pa-form'); if (f) f.innerHTML = ''; paRender(); })
    .catch(function (e) { srLog('Sospensione non registrata: ' + e.message, 'err'); alert('Non registrata: ' + e.message); });
}
function paEliminaSospensione(id) {
  if (!confirm('Eliminare questa sospensione? Le ore tornano a essere conteggiate.')) return;
  paSalvaConf(function (c) { c.sospensioni = (c.sospensioni || []).filter(function (x) { return x.id !== id; }); }, 'sospensione ' + id + ' eliminata').then(paRender)
    .catch(function (e) { srLog('Sospensione non eliminata: ' + e.message, 'err'); });
}
// Nota del dittafono di tipo PALESTRA -> proposta di sospensione
function paApriNota(notaId) {
  var n = dfTrova(notaId), el = n && typeof dfgPannello === 'function' ? dfgPannello(notaId) : null;
  if (!n || !el) return;
  var vai = function () { paNuovaSospensione(paPropostaSospensione(n.testo, PA.conf), notaId); };
  if (PA.caricato) vai(); else { el.innerHTML = '<div class="domanda">Carico la palestra…</div>'; paCarica().then(vai).catch(function (e) { el.innerHTML = '<div class="errore">' + srEsc(e.message) + '</div>'; }); }
}
function paSollecito(id) {
  var sit = paSituazione(PA.conf, PA.movimenti, srOggi()), s = sit.find(function (x) { return x.u.id === id; }); if (!s) return;
  var testo = paTestoSollecito(s, PA.conf);
  if (navigator.share) { navigator.share({ title: 'Affitto palestra ' + s.u.nome, text: testo }).catch(function (e) { if (e && e.name !== 'AbortError') srLog('Condivisione: ' + e.message, 'warn'); }); return; }
  var tel = String(s.u.telefono || '').replace(/\D/g, '');
  if (tel) { window.open('https://wa.me/' + (tel.length === 10 ? '39' + tel : tel) + '?text=' + encodeURIComponent(testo), '_blank'); return; }
  prompt('Copia il messaggio:', testo);
}
function paStampa() {
  var c = PA.conf, sit = paSituazione(c, PA.movimenti, srOggi());
  var corpo = '<h1>Affitti palestra Via Hermagor — stagione ' + srEsc(c.stagione) + '</h1><div class="sub">' + paEuro(c.tariffaOraria) + '/ora sulle ore di calendario · situazione al ' + paDataIt(srOggi()) + '</div>' +
    '<table><tr><th>Utente</th><th>Calcolo</th><th>Periodo</th><th class="n">Dovuto</th><th class="n">Maturato</th><th class="n">Versato</th><th class="n">Residuo</th><th>Coperto fino</th></tr>' +
    sit.map(function (s) { return '<tr><td>' + srEsc(s.u.nome) + '</td><td>' + (s.c.modalita === 'FISSO_MENSILE' ? paEuro(s.u.importoMese) + '/mese' : s.c.oreStagione + ' ore') + '</td><td>' + paDataIt(s.c.inizio) + '–' + paDataIt(s.c.fine) + '</td><td class="n">' + paEuro(s.c.dovutoStagione) + '</td><td class="n">' + paEuro(s.c.maturato) + '</td><td class="n">' + paEuro(s.versato) + '</td><td class="n">' + paEuro(s.residuo) + '</td><td>' + paDataIt(s.copertoFino) + '</td></tr>'; }).join('') + '</table>';
  srApriStampa('Affitti palestra ' + c.stagione, corpo);
}
// Avvisi in cima alla scheda Detta (solo quando servono)
function paAvvisiDetta() {
  var el = document.getElementById('pa-avvisi'); if (!el) return;
  var mostra = function () {
    var a = paAvvisi(paSituazione(PA.conf, PA.movimenti, srOggi()), srOggi());
    el.innerHTML = a.length ? '<div class="errore" style="margin-bottom:8px;cursor:pointer" onclick="srGoTab(\'palestra\')">🏟️ ' + a.map(function (x) { return srEsc(x.testo); }).join('<br>') + '</div>' : '';
  };
  if (PA.caricato) mostra(); else paCarica().then(mostra).catch(function (e) { srLog('Avvisi palestra: ' + e.message, 'warn'); });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { paCalcola: paCalcola, paCopertoFino: paCopertoFino, paVersamenti: paVersamenti, paSituazione: paSituazione, paAvvisi: paAvvisi,
  paFestivita: paFestivita, paPasqua: paPasqua, paDateDette: paDateDette, paUtentiDetti: paUtentiDetti, paClassificaNota: paClassificaNota, paPropostaSospensione: paPropostaSospensione, paConfIniziale: paConfIniziale, paTestoSollecito: paTestoSollecito, paGiornoSett: paGiornoSett };
