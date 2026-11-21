// ════════════════════════════════════════════════════════
// FILE: dittafono-gestionale.js — ASD Basket Campodarsego
// VERSIONE: v0.7 · 20/11/2026 15:00 · BK
// v0.7: (screenshot Alberto 20/11/2026: "Residenti" salvato come appunto) le parole
//   singole o frasi brevi senza numeri ("residenti", "cassa", "affitti", "documenti
//   mancanti") contano come domanda. "residenti" mostra anche l'elenco con i nomi;
//   "anagrafica incompleta": per ogni atleta cosa manca per TESSERAMENTO, RICEVUTA
//   DETRAIBILE e RICEVUTA NON DETRAIBILE (dfgAnagrafica). Se due atleti con lo stesso
//   cognome sembrano fratelli e solo uno ha i dati del genitore, CHIEDE se e' lo stesso
//   genitore (osservazione Alberto: Zuanon Gabriele e Nicolo'): Si' -> copia i dati del
//   genitore (e l'indirizzo se manca) solo nei campi vuoti; No -> non lo chiede piu'.
//   "comandi" / "aiuto" / "legenda": LEGENDA dei comandi (anche pulsante ❓ Comandi).
//   "non residenti" solo i non residenti; "comune mancante"/"residenza non compilata" chi non ha il comune.
// v0.6: QUOTE dovute/pagate/residuo con le regole di Alberto (Pulcini 200, altri
//   minibasket e Special 340, fratello minore -20%, basket amatori 20; quota dal
//   foglio se presente) + link WhatsApp di sollecito al genitore; "dati da
//   completare" con link alla scheda nel gestionale; avvisi all'apertura;
//   presenze per mese; copia di sicurezza dei dati.
// v0.5: domanda "situazione affitti?" (palestra-affitti.js): dovuto, versato, residuo per utente.
// v0.4: RIEPILOGO DETRAIBILE ("preparami la ricevuta detraibile delle rette
//   di Rossi versate nel 2026"): come "Ricevuta anno" del gestionale, stesso
//   registro. Regola di Alberto 20/11/2026: detraibili SOLO le quote
//   d'iscrizione all'attivita' (quota annuale, rate, saldo) pagate con
//   bonifico o POS; MAI tesseramento/assicurazione (quota associativa),
//   divisa, altro, contanti. I pagamenti registrati dal dittafono nascono gia'
//   con det=false quando non detraibili.
// v0.3: RICEVUTA dal pagamento ("...e fammi la ricevuta"): dopo la conferma il
//   dittafono prepara il PDF (documenti-pdf.js) con numero nel registro ricevute
//   del gestionale, poi un tocco lo invia (WhatsApp...) o lo scarica. Se la
//   frase chiede la ricevuta, la prepara da solo. Ristampa = stesso numero.
// v0.2: PRESENZE DETTATE ("allenamento Aquilotti, assenti Rossi e Bianchi",
//   "Scoiattoli tutti presenti tranne Verdi", "Neri giustificato"):
//   proposta con l'elenco degli iscritti delle categorie e lo stato P/R/G/A
//   di ciascuno, modificabile con un tocco -> allenamento + presenze nel
//   gestionale (stesso formato della pagina Presenze), in transazione.
//   Domanda nuova: "presenze Aquilotti?" -> presenze per atleta nella stagione.
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

var DFG_VERSIONE = 'v0.7 · 20/11/2026 15:00';
var DFG = { atl: [], pag: {}, all: [], pres: [], caricato: false, risposta: null, presStato: {} };
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

// ── QUOTE (v0.6) ──
var DFG_QUOTE_CAT = { Pulcini: 200, Scoiattoli: 340, Aquilotti: 340, Esordienti: 340, Special: 340, AmaBasket: 20, AmaVolley: 0, Dirigente: 0, Volontario: 0, Ex: 0 };
// quota dovuta nella stagione: dal campo quotaAnnua (foglio/scheda) se c'e', altrimenti dalla categoria; null = da decidere
function dfgQuotaDovuta(a, stag) {
  if (a.quotaAnnua !== undefined && a.quotaAnnua !== null && a.quotaAnnua !== '') return Number(a.quotaAnnua) || 0;
  if (a.specialPartner) return null;
  var cats = dfgCategorie(a, stag), base = null;
  cats.forEach(function (c) { if (DFG_QUOTE_CAT[c] != null && (base === null || DFG_QUOTE_CAT[c] > base)) base = DFG_QUOTE_CAT[c]; });
  if (base === null) return null;
  var mini = cats.some(function (c) { return /^(Pulcini|Scoiattoli|Aquilotti|Esordienti)$/.test(c); });
  return Math.round(base * (a.scontoFratello && mini ? 0.8 : 1) * 100) / 100;
}
function dfgQuotaPagata(a, pag, st) {
  var ama = dfgCategorie(a, st.chiave).indexOf('AmaBasket') >= 0;
  return Math.round((pag[a.id] || []).filter(function (p) {
    if (!(p.data >= st.da && p.data <= st.a)) return false;
    if (p.tipo === 'Divisa' || p.tipo === 'Altro') return false;
    if (p.tipo === 'Assicurazione' && !ama) return false;
    return true;
  }).reduce(function (s, p) { return s + (+p.importo || 0); }, 0) * 100) / 100;
}
function dfgTelefono(a) { var t = String(a.tutCell1 || a.tel || a.tutCell2 || '').replace(/\D/g, ''); if (!t) return ''; if (t.length === 10 && t[0] === '3') t = '39' + t; return t; }
function dfgLinkWhatsApp(a, testo) { var t = dfgTelefono(a); return t ? 'https://wa.me/' + t + '?text=' + encodeURIComponent(testo) : ''; }
function dfgMinorenne(a, oggi) { var e = dfgEta(a, oggi.slice(0, 4)); return e !== null && e < 18; }
// v0.7: ANAGRAFICA INCOMPLETA — cosa manca per ciascun uso del dato.
// Ricevuta intestata a chi paga: il genitore per i minorenni, l'atleta se maggiorenne.
function dfgAnagrafica(a, oggi) {
  var v = function (x) { return String(x || '').trim() !== ''; };
  var min = dfgMinorenne(a, oggi);
  var res = v(a.indVia) || v(a.ind) || v(a.tutVia);
  var t = [];
  if (!v(a.cog) || !v(a.nom)) t.push('nome/cognome');
  if (!v(a.dn)) t.push('data nascita');
  if (!v(a.natoA)) t.push('luogo nascita');
  if (!v(a.sex)) t.push('sesso');
  if (!v(a.cf)) t.push('CF atleta');
  if (!res) t.push('indirizzo');
  if (!dfgComune(a)) t.push('comune');
  if (!v(a.cs)) t.push('certificato'); else if (String(a.cs).slice(0, 10) < oggi) t.push('certificato scaduto');
  if (min && !(v(a.tutCog) && v(a.tutNom))) t.push('genitore');
  if (!dfgTelefono(a) && !v(a.email) && !v(a.tutEmail)) t.push('telefono o email');
  var nd = [];
  if (min ? !(v(a.tutCog) && v(a.tutNom)) : (!v(a.cog) || !v(a.nom))) nd.push(min ? 'nome genitore' : 'nome');
  if (!res || !dfgComune(a)) nd.push('indirizzo');
  var d = nd.slice();
  if (min && !v(a.tutCf || a.cfTut)) d.push('CF genitore');
  if (!v(a.cf)) d.push('CF atleta');
  return { tess: t, det: d, nodet: nd };
}
// v0.7: LEGENDA. [Cosa vuoi fare, Esempio da dire/scrivere, Cosa succede]
var DFG_LEGENDA = [
  ['— DOMANDE (risposta subito, non si salva niente) —', '', ''],
  ['Residenti (Comune)', 'residenti · solo residenti · non residenti', '% per categoria + elenco'],
  ['Comune mancante', 'comune mancante', 'chi non ha la residenza'],
  ['Anagrafica incompleta', 'anagrafica incompleta', 'cosa manca per tesseramento e ricevute'],
  ['Schede da completare', 'dati da completare', 'elenco con link alla scheda'],
  ['Certificati', 'chi ha il certificato scaduto?', 'scaduti / in scadenza'],
  ['Quote', 'chi non ha pagato?', 'dovuto, pagato, residuo + WhatsApp'],
  ['Un atleta', 'situazione Rossi', 'scheda, pagamenti, certificato'],
  ['Cassa', 'cassa', 'saldo contanti'],
  ['Spese', 'spese del mese · spese della settimana · spese dell\'anno', 'elenco e totale'],
  ['Documenti', 'documenti mancanti', 'moduli non consegnati'],
  ['Presenze', 'presenze di novembre · presenze pulcini', 'statistica presenze'],
  ['Affitti palestra', 'situazione affitti', 'dovuto, versato, residuo per utente'],
  ['Ricevuta detraibile', 'ricevuta detraibile Rossi 2026', 'PDF dei pagamenti detraibili'],
  ['Questa legenda', 'comandi · aiuto', ''],
  ['— NOTE (si salvano, poi confermi in 📥 Note) —', '', ''],
  ['Spesa', 'comprato palloni 45 euro contanti', '➡️ Registra spesa in Economia'],
  ['Incasso', 'incassati 50 euro dal torneo', '➡️ Registra incasso'],
  ['Pagamento atleta', 'Rossi Luca ha pagato 20 euro assicurazione in contanti', '✅ Registra pagamento + 🧾 ricevuta PDF'],
  ['Dato atleta', 'Rossi Luca certificato scade il 10/09/2027', '✅ Aggiorna scheda'],
  ['Presenze', 'presenze pulcini: presenti Rossi, Bianchi, assenti Verdi', '✅ Registra presenze'],
  ['Palestra', '26 e 27 dicembre niente attività · CDS salta lunedì, ha avvisato', '📅 Registra in palestra'],
  ['Istruzione per BK', 'BK: nella ricevuta aggiungi il codice FIP', '🛠️ Per BK (va nella prossima versione)'],
  ['Appunto', 'qualsiasi altra cosa', '📌 resta come appunto']
];
var DFG_CAMPI_TUT = ['tutCog', 'tutNom', 'tutCf', 'cfTut', 'tutDn', 'tutNatoA', 'tutNatoProv', 'tutVia', 'tutNr', 'tutCap', 'tutComune', 'tutProv', 'tutCell1', 'tutCell2', 'tutEmail', 'indTut'];
var DFG_CAMPI_IND = ['indVia', 'indNr', 'indCap', 'indComune', 'indProv'];
// Coppie da verificare: stesso cognome, uno con genitore (nome+cognome), l'altro con dati del genitore mancanti.
function dfgFratelliDaVerificare(atleti) {
  var v = function (x) { return String(x || '').trim() !== ''; };
  var norm = function (x) { return String(x || '').trim().toUpperCase(); };
  var gruppi = {};
  (atleti || []).forEach(function (a) { if (a && a.cog && !a.ritirato) (gruppi[norm(a.cog)] = gruppi[norm(a.cog)] || []).push(a); });
  var out = [];
  Object.keys(gruppi).forEach(function (g) {
    var arr = gruppi[g]; if (arr.length < 2) return;
    arr.forEach(function (y) {
      var manca = DFG_CAMPI_TUT.filter(function (k) { return !v(y[k]); });
      if (!(manca.indexOf('tutCog') >= 0 || manca.indexOf('tutNom') >= 0 || (manca.indexOf('tutCf') >= 0 && manca.indexOf('cfTut') >= 0) || manca.indexOf('tutCell1') >= 0)) return;
      var cand = arr.filter(function (x) {
        if (x === y || !v(x.tutCog) || !v(x.tutNom)) return false;
        if ((y.tutoreDiversoDa || []).indexOf(x.id) >= 0 || (x.tutoreDiversoDa || []).indexOf(y.id) >= 0) return false;
        if (v(y.tutNom) && norm(y.tutNom) !== norm(x.tutNom)) return false; // genitore diverso gia' scritto
        if (v(y.tutCf) && v(x.tutCf) && norm(y.tutCf) !== norm(x.tutCf)) return false;
        return true;
      }).sort(function (p, q) { return DFG_CAMPI_TUT.filter(function (k) { return v(q[k]); }).length - DFG_CAMPI_TUT.filter(function (k) { return v(p[k]); }).length; });
      var x = cand[0]; if (!x) return;
      var campi = DFG_CAMPI_TUT.filter(function (k) { return !v(y[k]) && v(x[k]); });
      var conInd = !v(y.indVia) && !v(y.ind) && v(x.indVia);
      if (conInd) campi = campi.concat(DFG_CAMPI_IND.filter(function (k) { return !v(y[k]) && v(x[k]); }));
      if (!campi.length) return;
      out.push({ da: x.id, a: y.id, daNome: (x.cog + ' ' + (x.nom || '')).trim(), aNome: (y.cog + ' ' + (y.nom || '')).trim(), genitore: (x.tutNom + ' ' + x.tutCog).trim(), campi: campi, indirizzo: conInd });
    });
  });
  return out;
}
function dfgHtmlFratelli(lista) {
  if (!lista || !lista.length) return '';
  return '<div style="margin-top:10px">' + lista.map(function (f) {
    var idb = 'dfg-fr-' + f.a + '-' + f.da;
    return '<div class="domanda" id="' + idb + '" style="margin-top:6px">👪 <b>' + srEsc(f.aNome) + '</b> e <b>' + srEsc(f.daNome) + '</b> hanno lo stesso genitore (' + srEsc(f.genitore) + ')?<br>' +
      '<button class="btn-sm" onclick="dfgCopiaGenitore(' + f.da + ',' + f.a + ')">Sì, copia i dati' + (f.indirizzo ? ' e l\'indirizzo' : '') + '</button> ' +
      '<button class="btn-gray btn-sm" onclick="dfgNonFratelli(' + f.da + ',' + f.a + ')">No</button></div>';
  }).join('') + '</div>';
}
function _dfgScriviAtleti(fn, descr, idb) {
  var ref = _db.collection('basket052441').doc('atleti'), box = document.getElementById(idb), adesso = new Date().toISOString();
  if (box) box.innerHTML = 'Aggiornamento…';
  return _db.runTransaction(function (tx) {
    return tx.get(ref).then(function (d) {
      var arr = d.exists && d.data().v ? JSON.parse(d.data().v) : [];
      fn(arr, adesso);
      tx.set(ref, { v: JSON.stringify(arr), ts: adesso, da: 'dittafono ' + SR.utente });
      DFG.atl = arr;
    });
  }).then(function () { srLog(descr, 'ok'); if (box) box.innerHTML = '✅ ' + srEsc(descr); })
    .catch(function (err) { srLog('NON aggiornato: ' + err.message, 'err'); if (box) box.innerHTML = '<span class="errore">NON aggiornato: ' + srEsc(err.message) + '</span>'; });
}
function dfgCopiaGenitore(daId, aId) {
  var f = dfgFratelliDaVerificare(DFG.atl).find(function (x) { return x.da === daId && x.a === aId; });
  if (!f) { srLog('Copia genitore: coppia ' + daId + '/' + aId + ' non piu\' da verificare', 'warn'); return; }
  if (!confirm('Copio in ' + f.aNome + ' i dati del genitore ' + f.genitore + (f.indirizzo ? ' e l\'indirizzo' : '') + ' presi da ' + f.daNome + '?\nSolo i campi vuoti: ' + f.campi.length)) return;
  _dfgScriviAtleti(function (arr, adesso) {
    var x = arr.find(function (z) { return z.id === daId; }), y = arr.find(function (z) { return z.id === aId; });
    if (!x || !y) throw new Error('atleta non più presente in anagrafica');
    var fatti = f.campi.filter(function (k) { if (String(y[k] || '').trim() === '' && String(x[k] || '').trim() !== '') { y[k] = x[k]; return true; } return false; });
    y.modTs = adesso;
    y.storiaDittafono = (y.storiaDittafono || []).concat([{ il: adesso, campi: fatti, da: 'copiati da ' + f.daNome + ' (stesso genitore)' }]).slice(-50);
  }, f.aNome + ': dati del genitore copiati da ' + f.daNome, 'dfg-fr-' + aId + '-' + daId);
}
function dfgNonFratelli(daId, aId) {
  _dfgScriviAtleti(function (arr) {
    var y = arr.find(function (z) { return z.id === aId; }); if (!y) throw new Error('atleta non più presente in anagrafica');
    y.tutoreDiversoDa = (y.tutoreDiversoDa || []).filter(function (i) { return i !== daId; }).concat([daId]);
  }, 'Annotato: genitore diverso, non lo chiedo più', 'dfg-fr-' + aId + '-' + daId);
}
// Dati mancanti per ricevute, report e tesseramento
function dfgDatiMancanti(a, oggi) {
  var m = [];
  if (!a.cf) m.push('codice fiscale');
  if (!a.dn) m.push('data di nascita');
  if (!dfgComune(a)) m.push('comune');
  if (dfgMinorenne(a, oggi) && !(a.tutCog || a.tutNom)) m.push('genitore');
  if (dfgMinorenne(a, oggi) && !(a.tutCf || a.cfTut)) m.push('CF genitore');
  if (!a.cs) m.push('certificato');
  if (!dfgTelefono(a)) m.push('telefono');
  return m;
}
function dfgLinkScheda(id) { return 'basket052441.html?atleta=' + encodeURIComponent(id); }

// Riconosce una DOMANDA (non una nota). Ritorna { tipo, atleta? } o null.
function dfgRiconosciDomanda(testo, atleti) {
  var t = String(testo || '').toLowerCase().trim();
  // v0.4: comando "ricevuta detraibile / riepilogo pagamenti <atleta> <anno>" (anche senza punto di domanda)
  if (/ricevut\w*\s+(\w+\s+)?detraibil|riepilogo\s+(annuale|anno|dei pagamenti|pagament)|per (la )?detrazione|detraibil\w*\s+(delle|dei|per)/.test(t)) {
    var ay = t.match(/\b(20\d{2})\b/);
    return { tipo: 'RIEPILOGO_DET', atleti: dfTrovaAtleti(testo, atleti || []), anno: ay ? ay[1] : null };
  }
  if (/^(comandi|aiuto|legenda|help|cosa posso (dire|chiedere)|cosa sai fare)\b/.test(t)) return { tipo: 'COMANDI' }; // v0.7
  var domanda = /\?\s*$/.test(t) || /^(chi|quanti|quante|quanto|quali|quale|elenco|lista|mostra|dimmi|situazione|scheda|stampa|tabulato)\b/.test(t);
  // v0.7: comando breve (max 4 parole, niente numeri) su un argomento noto = domanda
  if (!domanda && t.split(/\s+/).length <= 4 && !/\d/.test(t) && /anagraf|residen|\bcomune\b|\bcassa\b|affitt|certificat|document|complet|presenz|spese|quote|morosi|solleciti/.test(t)) domanda = true;
  if (!domanda) return null;
  if (/certificat|visit\w* medic/.test(t)) return { tipo: /scadut/.test(t) && !/scadenz/.test(t) ? 'CERT_SCADUTI' : 'CERTIFICATI' };
  if (/affitt|utenti (della )?palestra|situazione palestra/.test(t)) return { tipo: 'AFFITTI' };
  if (/anagraf/.test(t)) return { tipo: 'ANAGRAFICA' }; // v0.7
  if (/complet|manca(no)? (dei |i )?dati|dati mancanti|schede incomplete/.test(t)) return { tipo: 'DA_COMPLETARE' };
  if (/deve(no)? (ancora )?pagare|da pagare|quote|residu|chi non ha pagato|morosi|solleciti/.test(t) && !/spes|affitt/.test(t)) { var aq = dfTrovaAtleti(testo, atleti || []); if (!aq.length) return { tipo: 'NON_PAGATO' }; }
  if (/document|modul|tessera/.test(t)) return { tipo: 'DOCUMENTI' };
  if (/presenz|assenz|assent|frequen/.test(t)) { var cp = dfgCategorieDette(t), mm = DFG_MESI.findIndex(function (x) { return t.indexOf(x) >= 0; }); return { tipo: 'PRESENZE_STAT', cats: cp.cats, mese: mm >= 0 ? mm + 1 : null }; }
  if (/non ha(nno)? pagato|pagat|quot|rat[ae]\b|pagament/.test(t) && !/spes/.test(t)) {
    var a1 = dfTrovaAtleti(testo, atleti || []);
    return a1.length ? { tipo: 'ATLETA', atleti: a1 } : { tipo: 'NON_PAGATO' };
  }
  if (/\bcassa\b|contanti/.test(t)) return { tipo: 'CASSA' };
  if (/residen|\bcomune\b/.test(t)) return /manca|senza|non compilat|vuot|non indicat/.test(t) ? { tipo: 'RESIDENZA_MANCANTE' } : { tipo: 'RESIDENTI', filtro: /\bnon\s+residen/.test(t) ? 'NO' : /residen/.test(t) && /\b(solo|elenco|lista)\b/.test(t) ? 'SI' : null }; // v0.7
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
      var link3 = [], daDec = [], tot3 = 0;
      var r3 = ord(atletiVeri.slice()).map(function (a) {
        var dov = dfgQuotaDovuta(a, st.chiave), pg = dfgQuotaPagata(a, pag, st);
        if (dov === null) { daDec.push(dfgNomeAtl(a)); return null; }
        var res = Math.round((dov - pg) * 100) / 100; if (res <= 0.004) return null;
        tot3 += res;
        link3.push(dfgLinkWhatsApp(a, 'Buongiorno, vi ricordiamo la quota ' + st.chiave + ' di ' + dfgNomeAtl(a) + ': ' + srEuro(dov) + ', già versati ' + srEuro(pg) + ', restano ' + srEuro(res) + '. Grazie! ASD Basket Campodarsego'));
        return [dfgNomeAtl(a), cat(a), srEuro(dov), srEuro(pg), srEuro(res)];
      }).filter(Boolean);
      return { titolo: 'Quote da saldare', sotto: 'Stagione ' + st.chiave + ' · ' + r3.length + ' atleti · totale ' + srEuro(tot3), colonne: ['Atleta', 'Categoria', 'Dovuta', 'Pagata', 'Residuo'], righe: r3,
        link: link3, linkTesto: '💬', nota: 'Regole: Pulcini 200 €, altri minibasket e Special 340 €, fratello minore -20%, basket amatori 20 €, volley amatori Max Music = contributo di squadra (no quota individuale); quota scritta in scheda se diversa.' + (daDec.length ? ' Quota da decidere: ' + daDec.join(', ') + '.' : '') + ' 💬 = messaggio WhatsApp pronto al genitore (serve il telefono in scheda).' };
    }
    case 'COMANDI': // v0.7
      return { titolo: '❓ Comandi del dittafono', sotto: 'Detta o scrivi, poi 💾 Salva nota. Le domande non hanno bisogno del punto di domanda.', colonne: ['Cosa vuoi fare', 'Esempio', 'Cosa succede'], righe: DFG_LEGENDA.map(function (r) { return r.slice(); }),
        nota: 'I nomi degli atleti si dicono COGNOME e nome. I dati personali (CF, indirizzi) si inseriscono da tastiera nella scheda del gestionale.' };
    case 'ANAGRAFICA': { // v0.7
      var link7 = [], nT = 0, nD = 0, nN = 0;
      var r7 = ord(atletiVeri.slice()).map(function (a) {
        var x = dfgAnagrafica(a, oggi); if (!x.tess.length && !x.det.length && !x.nodet.length) return null;
        if (x.tess.length) nT++; if (x.det.length) nD++; if (x.nodet.length) nN++;
        link7.push(dfgLinkScheda(a.id)); var f = function (l) { return l.length ? l.join(', ') : '✅'; };
        return [dfgNomeAtl(a), f(x.tess), f(x.det), f(x.nodet)];
      }).filter(Boolean);
      return { titolo: 'Anagrafica incompleta', sotto: 'Stagione ' + st.chiave + ' · ' + r7.length + ' atleti su ' + atletiVeri.length + ' · tesseramento ' + nT + ' · ric. detraibile ' + nD + ' · ric. non detraibile ' + nN,
        colonne: ['Atleta', 'Tesseramento', 'Ricevuta detraibile', 'Ricevuta non detraibile'], righe: r7, link: link7, linkTesto: '✏️', fratelli: dfgFratelliDaVerificare(atleti),
        nota: 'Ricevute intestate al genitore se minorenne. ✏️ apre la scheda nel gestionale: i dati personali si inseriscono da tastiera.' };
    }
    case 'DA_COMPLETARE': {
      var link4 = [];
      var r4b = ord(atletiVeri.slice()).map(function (a) { var m = dfgDatiMancanti(a, oggi); if (!m.length) return null; link4.push(dfgLinkScheda(a.id)); return [dfgNomeAtl(a), cat(a), m.join(', ')]; }).filter(Boolean);
      return { titolo: 'Schede da completare', sotto: 'Stagione ' + st.chiave + ' · ' + r4b.length + ' atleti', colonne: ['Atleta', 'Categoria', 'Manca'], righe: r4b, link: link4, linkTesto: '✏️', fratelli: dfgFratelliDaVerificare(atleti),
        nota: '✏️ apre la scheda nel gestionale: i dati personali si inseriscono da tastiera.' };
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
      // v0.7: elenco nominativo (ordine di iscrizione): nome, categoria, data iscrizione, residente
      var el = rr.righe.filter(function (x) { return !q.filtro || (q.filtro === 'NO' ? x.res !== 'SI' : x.res === 'SI'); });
      r5.push(['— ' + (q.filtro === 'NO' ? 'NON RESIDENTI (compresi senza comune)' : q.filtro === 'SI' ? 'RESIDENTI' : 'ELENCO ISCRITTI') + ' (' + el.length + ') —', '', '', '']);
      el.forEach(function (x) { r5.push([x.nome + (x.ritirato ? ' (ritirato)' : ''), (x.cats || []).join(', '), x.dataIscr ? x.dataIscr.split('-').reverse().join('/') : 'data iscr. mancante', x.res === 'SI' ? '✅ residente' : x.res === 'NO' ? 'non residente' : '⚠️ comune mancante']); });
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
    case 'AFFITTI': {
      var sa = extra.affitti || [];
      return { titolo: 'Affitti palestra' + (extra.stagione ? ' ' + extra.stagione : ''), sotto: 'Situazione al ' + srDataIt(oggi), colonne: ['Utente', 'Dovuto', 'Maturato', 'Versato', 'Residuo', 'Coperto fino'],
        righe: sa.map(function (s) { return [s.u.nome, srEuro(s.c.dovutoStagione), srEuro(s.c.maturato), srEuro(s.versato), srEuro(s.residuo), s.copertoFino ? srDataIt(s.copertoFino) : '—']; }),
        nota: sa.length ? 'Dettaglio e solleciti nella scheda 🏟️ Palestra.' : 'Nessun utente configurato: apri la scheda 🏟️ Palestra.' };
    }
    case 'RIEPILOGO_DET': {
      var anno = q.anno || oggi.slice(0, 4);
      if (!q.atleti || !q.atleti.length) return { titolo: 'Riepilogo detraibile ' + anno, colonne: [], righe: [], nota: 'Dimmi di quale atleta (es. "ricevuta detraibile Rossi Luca ' + anno + '").' };
      if (q.atleti.length > 1) return { titolo: 'Riepilogo detraibile ' + anno, colonne: ['Atleta'], righe: q.atleti.map(function (x) { return [x.nome]; }), nota: 'Più atleti con questo nome: ripeti con nome e cognome.' };
      var a8 = (atleti || []).find(function (y) { return y.id === q.atleti[0].id; });
      if (!a8) return { titolo: 'Riepilogo detraibile ' + anno, colonne: [], righe: [], nota: 'Atleta non trovato in anagrafica.' };
      var pa = dfgPagamentiAnno(pag, a8.id, anno);
      var r8 = pa.tutti.map(function (p) { var d = dfgDetraibile(p); return [srDataIt(p.data), p.tipo || '—', p.metodo || '—', srEuro(p.importo), d === 'SI' ? 'sì' : 'no – ' + dfgMotivoNonDet(p)]; });
      var eta = dfgEta(a8, anno), avvisi = [];
      if (eta !== null && (eta < 5 || eta > 18)) avvisi.push('Attenzione: nel ' + anno + ' l\'atleta ha ' + eta + ' anni (detrazione per figli 5–18 anni).');
      if (pa.no.some(function (p) { return dfgDetraibile(p) === 'DA_VERIFICARE'; })) avvisi.push('Ci sono pagamenti con tipo da verificare: correggili nel gestionale se sono quote.');
      if (!pa.si.length) avvisi.push('Nessun pagamento detraibile nel ' + anno + ': il riepilogo non si può preparare.');
      return { titolo: 'Riepilogo detraibile ' + anno + ' – ' + dfgNomeAtl(a8), sotto: 'Detraibile ' + srEuro(pa.totSi) + (pa.totNo ? ' · non detraibile ' + srEuro(pa.totNo) : ''),
        colonne: ['Data', 'Tipo', 'Metodo', 'Importo', 'Detraibile'], righe: r8, nota: avvisi.join(' '), azione: pa.si.length ? { tipo: 'RIEPILOGO_DET', atletaId: a8.id, anno: anno } : null };
    }
    case 'PRESENZE_STAT': {
      var cats = q.cats && q.cats.length && q.cats[0] !== 'Tutti' ? q.cats : null;
      var meseQ = q.mese ? (Number(q.mese) >= 8 ? st.da.slice(0, 4) : st.a.slice(0, 4)) + '-' + String(q.mese).padStart(2, '0') : null;
      var alls = (extra.allenamenti || []).filter(function (al) { return al.data >= st.da && al.data <= st.a && (!meseQ || al.data.slice(0, 7) === meseQ); });
      var pres = extra.presenze || [];
      var r7 = ord(atletiVeri.filter(function (a) { return !cats || dfgCategorie(a, st.chiave).some(function (c) { return cats.indexOf(c) >= 0; }); })).map(function (a) {
        var ca = dfgCategorie(a, st.chiave);
        var suoi = alls.filter(function (al) { return al.cat === 'Tutti' || String(al.cat).split(',').some(function (c) { return ca.indexOf(c) >= 0; }); });
        var cnt = { P: 0, R: 0, G: 0, A: 0 };
        suoi.forEach(function (al) { var p = pres.find(function (x) { return x.aid === al.id && x.atid === a.id; }); var stt = p ? p.stato : 'A'; cnt[cnt[stt] != null ? stt : 'A']++; });
        var tot = suoi.length;
        return [dfgNomeAtl(a), ca.join(' + '), String(cnt.P + cnt.R), String(cnt.G), String(cnt.A), tot ? Math.round((cnt.P + cnt.R) / tot * 100) + '%' : '—'];
      });
      return { titolo: 'Presenze' + (cats ? ' ' + cats.join(', ') : '') + (meseQ ? ' – ' + DFG_MESI[Number(q.mese) - 1] : ''), sotto: (meseQ ? srDataIt(meseQ + '-01').slice(3) : 'Stagione ' + st.chiave) + ' · ' + alls.length + ' allenamenti registrati', colonne: ['Atleta', 'Categoria', 'Presente', 'Giust.', 'Assente', '%'], righe: r7,
        nota: 'Presente comprende i ritardi. Senza registrazione un atleta conta come assente (come nel gestionale).' };
    }
    default:
      return { titolo: 'Domanda non capita', colonne: [], righe: [], nota: 'Prova con: "anagrafica incompleta", "chi ha il certificato scaduto?", "chi non ha pagato?", "documenti mancanti", "cassa", "residenti", "spese del mese", "situazione Rossi".' };
  }
}

// ════════ CARICAMENTO DATI GESTIONALE (sola lettura qui; scritture solo in transazione) ════════
function dfgCarica() {
  var col = _db.collection('basket052441');
  return Promise.all([col.doc('atleti').get(), col.doc('pagamenti').get(), col.doc('allenamenti').get(), col.doc('presenze').get()]).then(function (ds) {
    DFG.atl = ds[0].exists && ds[0].data().v ? JSON.parse(ds[0].data().v) : [];
    DFG.pag = ds[1].exists && ds[1].data().v ? JSON.parse(ds[1].data().v) : {};
    DFG.all = ds[2].exists && ds[2].data().v ? JSON.parse(ds[2].data().v) : [];
    DFG.pres = ds[3].exists && ds[3].data().v ? JSON.parse(ds[3].data().v) : [];
    DFG.caricato = true;
    srLog('Gestionale: ' + DFG.atl.length + ' atleti, pagamenti di ' + Object.keys(DFG.pag).length + ' atleti', 'ok');
    dfgAvvisi();
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
  if (dfgDetraibile(pagObj) !== 'SI') pagObj.det = false; // v0.4: come il badge DET del gestionale
  es.innerHTML = '<div class="domanda">Registrazione…</div>';
  var col = _db.collection('basket052441'), refPag = col.doc('pagamenti'), copia;
  srAnnoCaricato(m.annoEsercizio).then(function (movAnno) {
    m.numeroMovimento = ecoNextNumeroMovimento(movAnno, m.annoEsercizio);
    var v = ecoValidaMovimento(m, SR.config, {});
    if (!v.valido) throw new Error('movimento non valido: ' + v.errori.join(', '));
    copia = dfgNotaAggiornata(n, [{ tipo: 'PAGAMENTO', atletaId: aid, nome: nome, importo: imp, data: data, metodo: met, tipoPag: tipo }, { tipo: 'MOVIMENTO', id: m.id, numero: m.numeroMovimento }], 'pagamento registrato: ' + nome + ' ' + imp + ' € ' + met + ' → ' + m.numeroMovimento);
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
    var box = document.getElementById('df-import-esito');
    if (box) box.innerHTML = '<div class="ok-msg">✅ Pagamento registrato: ' + srEsc(nome) + ' ' + srEuro(imp) + ' (' + srEsc(met.toLowerCase()) + ') → ' + srEsc(m.numeroMovimento) +
      (typeof dpRicevutaPDF === 'function' ? ' <button class="btn-gold btn-sm" onclick="dfgPreparaRicevuta(\'' + id + '\')">🧾 Ricevuta PDF</button>' : '') + '</div>';
    if (/ricevut/i.test(n.testo || '') && typeof dpRicevutaPDF === 'function') dfgPreparaRicevuta(id); // "...e fammi la ricevuta"
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

// ════════ AVVISI ALL'APERTURA (v0.6) ════════
function dfgAvvisi() {
  var el = typeof document !== 'undefined' && document.getElementById('dfg-avvisi'); if (!el) return;
  var oggi = srOggi(), q = function (t) { return dfgRispondi(dfgRiconosciDomanda(t, DF.atleti), DFG.atl, DFG.pag, oggi, {}); };
  var c = q('certificati?'), p = q('chi deve pagare?'), d = q('dati da completare?');
  var chip = function (n, testo, domanda, colore) { return n ? '<button class="btn-gray btn-sm" style="margin:0 6px 6px 0;border-color:' + colore + '" onclick="dfgProvaDomanda(\'' + domanda + '\')">' + testo.replace('#', n) + '</button>' : ''; };
  el.innerHTML = chip(c.righe.length, '🩺 # certificati da sistemare', 'certificati?', 'var(--warn)') + chip(p.righe.length, '💶 # quote da saldare', 'chi deve pagare?', 'var(--gold)') + chip(d.righe.length, '✏️ # schede da completare', 'dati da completare?', 'var(--border)');
}

// ════════ COPIA DI SICUREZZA (v0.6) ════════
// Scarica un file con tutti i dati (senza le foto). Da tenere sul telefono/PC, MAI su GitHub.
function dfgBackup() {
  var col = _db.collection('basket052441'), out = { formato: 'BK-BACKUP', versione: 1, creatoIl: new Date().toISOString(), da: SR.utente, sezioni: {}, movimenti: [], note: [] };
  var nomi = ['atleti', 'pagamenti', 'allenamenti', 'presenze', 'ricevute', 'listar', 'economiaConfig', 'economiaConti', 'speseRapideConfig', 'palestraAffitti'];
  var el = document.getElementById('df-import-esito'); if (el) el.innerHTML = '<div class="domanda">Preparo la copia…</div>';
  Promise.all(nomi.map(function (n) { return col.doc(n).get(); })).then(function (ds) {
    ds.forEach(function (d, i) { if (d.exists) out.sezioni[nomi[i]] = d.data(); });
    return Promise.all([col.doc('economia').collection('movimenti').get(), dfCol().get()]);
  }).then(function (r) {
    r[0].forEach(function (d) { out.movimenti.push(d.data()); }); r[1].forEach(function (d) { out.note.push(d.data()); });
    var a = document.createElement('a'), nome = 'BK_copia_sicurezza_' + srOggi() + '.json';
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' })); a.download = nome;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    srLog('Copia di sicurezza: ' + Object.keys(out.sezioni).length + ' sezioni, ' + out.movimenti.length + ' movimenti, ' + out.note.length + ' note', 'ok');
    if (el) el.innerHTML = '<div class="ok-msg">💾 ' + srEsc(nome) + ' scaricato (' + out.movimenti.length + ' movimenti, ' + out.note.length + ' note; foto escluse). Tienilo sul telefono o sul PC, mai su GitHub.</div>';
  }).catch(function (err) { srLog('Copia di sicurezza fallita: ' + err.message, 'err'); if (el) el.innerHTML = '<div class="errore">Copia non riuscita: ' + srEsc(err.message) + '</div>'; });
}

// ════════ DOMANDE ════════
// Ritorna true se il testo era una domanda (gestita qui, non salvata come nota).
function dfgProvaDomanda(testo) {
  var q = dfgRiconosciDomanda(testo, DF.atleti);
  if (!q) return false;
  var out = document.getElementById('dfg-risposta');
  if (!DFG.caricato && q.tipo !== 'COMANDI') { out.innerHTML = '<div class="errore">Dati del gestionale non ancora caricati: riprova tra poco.</div>'; return true; }
  var oggi = srOggi(), extra = {};
  var prep = Promise.resolve();
  if (q.tipo === 'CASSA') {
    extra.cassa = srSaldoCassa();
    extra.anticipi = (SR.anticipi || []).filter(function (m) { return m.stato === 'DA_PAGARE'; }).reduce(function (s, m) { return s + (Number(m.importoEur) || 0); }, 0);
  }
  if (q.tipo === 'AFFITTI') prep = (typeof paCarica === 'function' ? (PA.caricato ? Promise.resolve() : paCarica()) : Promise.reject(new Error('modulo palestra non caricato'))).then(function () { extra.affitti = paSituazione(PA.conf, PA.movimenti, oggi); extra.stagione = PA.conf.stagione; });
  if (q.tipo === 'PRESENZE_STAT') { extra.allenamenti = DFG.all; extra.presenze = DFG.pres; }
  if (q.tipo === 'SPESE') prep = srAnnoCaricato(+oggi.slice(0, 4)).then(function (mv) { extra.movimenti = mv; });
  prep.then(function () {
    var r = dfgRispondi(q, DFG.atl, DFG.pag, oggi, extra);
    r.domanda = testo; DFG.risposta = r;
    out.innerHTML = dfgHtmlRisposta(r, false) + (r.azione && r.azione.tipo === 'RIEPILOGO_DET' && typeof dpRiepilogoPDF === 'function'
      ? '<div style="margin-top:8px"><button class="btn-gold btn-sm" onclick="dfgPreparaRiepilogo(' + r.azione.atletaId + ',\'' + r.azione.anno + '\')">📄 Prepara riepilogo detraibile ' + r.azione.anno + '</button></div><div id="dfg-riep-pdf"></div>'
      : (r.righe.length ? '<div style="margin-top:8px"><button class="btn-gray btn-sm" onclick="dfgStampa()">🖨️ Stampa</button> <button class="btn-gray btn-sm" onclick="dfgCSV()">⬇️ CSV</button></div>' : ''));
    srLog('Domanda: "' + testo + '" → ' + r.titolo + ' (' + r.righe.length + ' righe)', 'ok');
  }).catch(function (err) { srLog('Risposta non calcolata: ' + err.message, 'err'); out.innerHTML = '<div class="errore">Risposta non calcolata: ' + srEsc(err.message) + '</div>'; });
  return true;
}
function dfgHtmlRisposta(r, stampa) {
  var conLink = !stampa && r.link && r.link.length === r.righe.length;
  var th = r.colonne.map(function (c) { return '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid #999">' + srEsc(c) + '</th>'; }).join('') + (conLink ? '<th></th>' : '');
  var tr = r.righe.map(function (x, i) { return '<tr>' + x.map(function (c) { return '<td style="padding:4px 6px;border-bottom:1px solid ' + (stampa ? '#ddd' : 'var(--border)') + ';vertical-align:top">' + srEsc(c) + '</td>'; }).join('') +
    (conLink ? '<td style="padding:4px 6px;border-bottom:1px solid var(--border)">' + (r.link[i] ? '<a href="' + srEsc(r.link[i]) + '" target="_blank" rel="noopener" style="text-decoration:none;font-size:18px">' + (r.linkTesto || '↗') + '</a>' : '<span style="opacity:.4" title="manca il telefono">—</span>') + '</td>' : '') + '</tr>'; }).join('');
  return '<div class="card"' + (stampa ? '' : ' style="padding:10px 12px"') + '><div style="font-weight:700;font-size:15px">' + srEsc(r.titolo) + '</div>' +
    (r.sotto ? '<div style="font-size:12px;opacity:.75;margin-bottom:6px">' + srEsc(r.sotto) + '</div>' : '') +
    (r.righe.length ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>' + th + '</tr></thead><tbody>' + tr + '</tbody></table></div>' : '') +
    (r.nota ? '<div style="font-size:12px;opacity:.75;margin-top:6px">' + srEsc(r.nota) + '</div>' : '') + (stampa ? '' : dfgHtmlFratelli(r.fratelli)) + '</div>';
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

// ════════ DETRAIBILITA' (v0.4) ════════
var DFG_TIPI_DETRAIBILI = ['Quota annuale', 'Quota (1a rata)', 'Quota (2a rata)', 'Saldo quota'];
var DFG_TIPI_NON_DETRAIBILI = ['Assicurazione', 'Divisa', 'Altro'];
// 'SI' | 'NO' | 'DA_VERIFICARE' (tipo sconosciuto: mai incluso senza controllo)
function dfgDetraibile(p) {
  if (!p) return 'NO';
  if (p.det === false) return 'NO';
  if (String(p.metodo || '').toLowerCase() === 'contanti') return 'NO';
  if (DFG_TIPI_NON_DETRAIBILI.indexOf(p.tipo) >= 0) return 'NO';
  if (DFG_TIPI_DETRAIBILI.indexOf(p.tipo) >= 0 || !p.tipo) return p.tipo ? 'SI' : 'DA_VERIFICARE';
  return 'DA_VERIFICARE';
}
function dfgMotivoNonDet(p) {
  if (p.det === false) return 'segnato non detraibile';
  if (String(p.metodo || '').toLowerCase() === 'contanti') return 'contanti';
  if (DFG_TIPI_NON_DETRAIBILI.indexOf(p.tipo) >= 0) return p.tipo === 'Assicurazione' ? 'tesseramento/assicurazione' : String(p.tipo).toLowerCase();
  return 'tipo "' + (p.tipo || 'vuoto') + '" da verificare';
}
// Pagamenti di un atleta in un anno solare divisi per detraibilita'
function dfgPagamentiAnno(pag, aid, anno) {
  var tutti = (pag[aid] || []).filter(function (p) { return p.data && String(p.data).slice(0, 4) === String(anno); })
    .sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); });
  var si = tutti.filter(function (p) { return dfgDetraibile(p) === 'SI'; });
  var no = tutti.filter(function (p) { return dfgDetraibile(p) !== 'SI'; });
  var somma = function (l) { return Math.round(l.reduce(function (s, p) { return s + (+p.importo || 0); }, 0) * 100) / 100; };
  return { tutti: tutti, si: si, no: no, totSi: somma(si), totNo: somma(no) };
}
function dfgEta(a, anno) {
  var dn = String(a.dn || ''), m = dn.match(/^(\d{4})-/) || dn.match(/\/(\d{4})$/);
  return m ? Number(anno) - Number(m[1]) : null;
}

// ════════ RICEVUTE (v0.3) ════════
function dfgLinkPagamento(n) { return (n.collegamenti || []).filter(function (c) { return c.tipo === 'PAGAMENTO' && !c.giaPresente && c.importo != null; }).pop() || null; }
function dfgPagante(a) {
  var tut = ((a.tutCog || '') + ' ' + (a.tutNom || '')).trim() || (a.gen || '').trim();
  return tut || dfgNomeAtl(a);
}
function dfgPreparaRicevuta(id) {
  var n = dfTrova(id), el = n && dfgPannello(id);
  if (!n || !el) return;
  var lp = dfgLinkPagamento(n);
  if (!lp) { el.innerHTML = '<div class="errore">Questa nota non ha un pagamento registrato dal dittafono.</div>'; return; }
  if (typeof dpRicevutaPDF !== 'function') { el.innerHTML = '<div class="errore">Modulo ricevute non caricato: aggiorna i file.</div>'; return; }
  var a = dfgAtleta(lp.atletaId) || { cog: lp.nome, nom: '' };
  var ref = _db.collection('basket052441').doc('ricevute'), adesso = new Date().toISOString(), oggi = srOggi(), numero, nuova = false, copia = null;
  el.innerHTML = '<div class="domanda">Preparo la ricevuta…</div>';
  _db.runTransaction(function (tx) {
    return tx.get(ref).then(function (d) {
      var arr = d.exists && d.data().v ? JSON.parse(d.data().v) : [];
      var gia = arr.find(function (r) { return r.notaId === id; });
      if (gia) { numero = gia.numero; nuova = false; return; }
      var anno = oggi.slice(0, 4), max = 0;
      arr.forEach(function (r) { if (r.numero && String(r.numero).indexOf(anno + '-') === 0) { var k = parseInt(String(r.numero).split('-')[1], 10) || 0; if (k > max) max = k; } });
      numero = anno + '-' + String(max + 1).padStart(3, '0'); nuova = true;
      arr.push({ numero: numero, atletaId: lp.atletaId, atleta: dfgNomeAtl(a), importo: lp.importo, data: lp.data, tipo: lp.tipoPag || 'Pagamento', detraibile: false, emessa: adesso, origine: 'dittafono', notaId: id });
      copia = JSON.parse(JSON.stringify(n));
      copia.collegamenti = (n.collegamenti || []).concat([{ tipo: 'RICEVUTA', numero: numero, il: adesso }]);
      copia.storia = (n.storia || []).concat([{ il: adesso, da: SR.utente, azione: 'ricevuta ' + numero }]);
      tx.set(ref, { v: JSON.stringify(arr), ts: adesso, da: 'dittafono ' + SR.utente });
      tx.set(dfCol().doc(id), copia);
    });
  }).then(function () {
    if (copia) Object.assign(n, copia);
    return dpCaricaImmagini();
  }).then(function () {
    var st = dfgStagione(lp.data || oggi).nome;
    var doc = dpRicevutaPDF({ numero: numero, dataEmissione: oggi, pagante: dfgPagante(a), atleta: dfgNomeAtl(a), importo: lp.importo, dataPagamento: lp.data, metodo: lp.metodo, causale: dpCausale(lp.tipoPag, st) });
    var nome = 'Ricevuta_' + numero + '_' + String(a.cog || '').replace(/[^A-Za-z]+/g, '') + '.pdf';
    dpMostraAzioni('dfg-pan-' + id, doc, nome, 'Ricevuta n. ' + numero + ' – ' + DP_SOCIETA.nome);
    srLog('Ricevuta ' + numero + (nuova ? ' emessa' : ' ristampata') + ' per ' + dfgNomeAtl(a), 'ok');
  }).catch(function (err) {
    srLog('Ricevuta non preparata: ' + err.message, 'err');
    var e2 = document.getElementById('dfg-pan-' + id); if (e2) e2.innerHTML = '<div class="errore">Ricevuta non preparata: ' + srEsc(err.message) + '</div>';
  });
}

// Riepilogo annuale detraibile: registro ricevute come "Ricevuta anno" del gestionale (tipo "Riepilogo anno AAAA")
var DFG_CAUSALI_CAT = { Pulcini: 'MINIBASKET', Scoiattoli: 'MINIBASKET', Aquilotti: 'MINIBASKET', Esordienti: 'MINIBASKET', Special: 'SPECIAL OLYMPICS', AmaBasket: 'BASKET', AmaVolley: 'PALLAVOLO' };
function dfgPreparaRiepilogo(aid, anno) {
  var out = document.getElementById('dfg-riep-pdf'), a = dfgAtleta(aid);
  if (!a) { out.innerHTML = '<div class="errore">Atleta non trovato.</div>'; return; }
  var pa = dfgPagamentiAnno(DFG.pag, aid, anno);
  if (!pa.si.length) { out.innerHTML = '<div class="errore">Nessun pagamento detraibile nel ' + srEsc(anno) + '.</div>'; return; }
  var ref = _db.collection('basket052441').doc('ricevute'), adesso = new Date().toISOString(), tipoReg = 'Riepilogo anno ' + anno, numero, nuova = false;
  out.innerHTML = '<div class="domanda">Preparo il riepilogo…</div>';
  _db.runTransaction(function (tx) {
    return tx.get(ref).then(function (d) {
      var arr = d.exists && d.data().v ? JSON.parse(d.data().v) : [];
      var gia = arr.find(function (r) { return r.atletaId === aid && r.tipo === tipoReg; });
      if (gia) { numero = gia.numero; return; }
      var annoN = srOggi().slice(0, 4), max = 0;
      arr.forEach(function (r) { if (r.numero && String(r.numero).indexOf(annoN + '-') === 0) { var k = parseInt(String(r.numero).split('-')[1], 10) || 0; if (k > max) max = k; } });
      numero = annoN + '-' + String(max + 1).padStart(3, '0'); nuova = true;
      arr.push({ numero: numero, atletaId: aid, atleta: dfgNomeAtl(a), importo: pa.totSi, data: pa.si[0].data, tipo: tipoReg, detraibile: true, emessa: adesso, origine: 'dittafono' });
      tx.set(ref, { v: JSON.stringify(arr), ts: adesso, da: 'dittafono ' + SR.utente });
    });
  }).then(function () { return dpCaricaImmagini(); }).then(function () {
    var stag = dfgStagioneAtleti(DFG.atl, anno + '-12-31'), stagPrec = dfgStagioneAtleti(DFG.atl, anno + '-06-30');
    var cats = dfgCategorie(a, stag.chiave); if (!cats.length) cats = dfgCategorie(a, stagPrec.chiave);
    var causale = 'QUOTA ATTIVITA\' SPORTIVA ' + (DFG_CAUSALI_CAT[cats[0]] || 'BASKET');
    var tut = ((a.tutCog || '') + ' ' + (a.tutNom || '')).trim();
    var pagante = tut ? { nome: tut, cf: a.tutCf || a.cfTut || '', via: ((a.tutVia || '') + (a.tutNr ? ' ' + a.tutNr : '')).trim(), comune: ((a.tutComune || '') + (a.tutProv ? ' (' + a.tutProv + ')' : '')).trim() }
      : { nome: dfgNomeAtl(a), cf: a.cf || '', via: ((a.indVia || '') + (a.indNr ? ' ' + a.indNr : '')).trim(), comune: ((a.indComune || '') + (a.indProv ? ' (' + a.indProv + ')' : '')).trim() };
    if (tut && !pagante.via && !pagante.comune) { pagante.via = ((a.indVia || '') + (a.indNr ? ' ' + a.indNr : '')).trim(); pagante.comune = ((a.indComune || '') + (a.indProv ? ' (' + a.indProv + ')' : '')).trim(); }
    var doc = dpRiepilogoPDF({ numero: numero, anno: anno, dataEmissione: srOggi(), pagamenti: pa.si, totale: pa.totSi, nonDetraibili: pa.totNo, pagante: pagante, causale: causale,
      atleta: { nome: dfgNomeAtl(a).toUpperCase(), natoA: ((a.natoA || '') + (a.natoProv ? ' (' + a.natoProv + ')' : '')).toUpperCase(), dn: a.dn ? (String(a.dn).indexOf('-') > 0 ? srDataIt(a.dn) : a.dn) : '', cf: String(a.cf || '').toUpperCase() } });
    var annoNasc = String(a.dn || '').match(/\d{4}/); 
    var nome = (annoNasc ? annoNasc[0] : '0000') + '_' + String(a.cog || '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase() + '_' + String(a.nom || '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase() + '_' + anno + '.pdf';
    var mancano = [!pagante.cf && 'codice fiscale di chi paga', !a.cf && 'codice fiscale dell\'atleta'].filter(Boolean);
    dpMostraAzioni('dfg-riep-pdf', doc, nome, 'Riepilogo pagamenti ' + anno + ' per la detrazione – ' + dfgNomeAtl(a));
    if (mancano.length) document.getElementById('dfg-riep-pdf').insertAdjacentHTML('afterbegin', '<div class="errore">Manca: ' + mancano.join(', ') + '. Senza, il riepilogo non vale per la detrazione: completa la scheda nel gestionale e rifallo (stesso numero).</div>');
    srLog('Riepilogo detraibile ' + anno + ' ' + numero + (nuova ? ' emesso' : ' ristampato') + ' per ' + dfgNomeAtl(a) + ': ' + pa.totSi + ' €', 'ok');
  }).catch(function (err) { srLog('Riepilogo non preparato: ' + err.message, 'err'); out.innerHTML = '<div class="errore">Riepilogo non preparato: ' + srEsc(err.message) + '</div>'; });
}

// ════════ PRESENZE (v0.2) ════════
var DFG_CAT_RADICI = { Pulcini: 'pulcin', Scoiattoli: 'scoiattol', Aquilotti: 'aquilott', Esordienti: 'esordient', Special: 'special' };
var DFG_STATI_PRES = { P: 'Presente', R: 'Ritardo', G: 'Giustificato', A: 'Assente' };
function dfgNormP(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’`]/g, "'"); }
function dfgCategorieDette(testo) {
  var t = dfgNormP(testo), cats = [];
  Object.keys(DFG_CAT_RADICI).forEach(function (c) { if (t.indexOf(DFG_CAT_RADICI[c]) >= 0) cats.push(c); });
  if (!cats.length && /tutti i gruppi|tutte le categorie|tutto il minibasket/.test(t)) cats = ['Tutti'];
  return { cats: cats };
}
// Parole chiave: classe, e se i nomi stanno DOPO (prefisso: "assenti Rossi") o PRIMA (suffisso: "Rossi assente")
var DFG_PRES_RE = /\b(assenti|assente|mancavano|mancava|mancano|manca|non c'era|non c'erano|non (?:e|sono) venut[oiae]|presenti|presente|c'erano|c'era|giustificat[oiae]|in ritardo|ritardo|arrivat[oiae] tardi|tranne|eccetto|a parte|meno)\b\s*:?/g;
function dfgClassePres(k) {
  if (/^(assent|manca|non c'er|non (e|sono) venut|tranne|eccetto|a parte|meno)/.test(k)) return 'A';
  if (/^(present|c'era)/.test(k)) return 'P';
  if (/^giustificat/.test(k)) return 'G';
  return 'R';
}
function dfgPrefissoPres(k) { return /^(assenti|presenti|mancavano|mancano|non c'erano|c'erano|tranne|eccetto|a parte|meno)|giustificat[ie]|:$/.test(k.trim()) || /:\s*$/.test(k); }
// testo -> { data, cats, stati: {atletaId: 'P'|'A'|'G'|'R'}, base: 'P'|'A'|null, nominati: n }
// atletiStag = atleti iscritti nella stagione [{id,cog,nom,cats:[..]}]
function dfgEstraiPresenze(testo, atletiStag, oggi) {
  var t = dfgNormP(testo);
  var date = dfgDate(testo), data = date.length ? date[0].iso : null;
  if (!data) { var gg = /\baltro ieri\b|\bl'altro ieri\b/.test(t) ? 2 : /\bieri\b/.test(t) ? 1 : 0; var p = oggi.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2] - gg); data = d.getFullYear() + '-' + dfgPad(d.getMonth() + 1) + '-' + dfgPad(d.getDate()); }
  var cats = dfgCategorieDette(t).cats;
  var pool = cats.length && cats[0] !== 'Tutti' ? atletiStag.filter(function (a) { return a.cats.some(function (c) { return cats.indexOf(c) >= 0; }); }) : atletiStag;
  var kws = [], m; DFG_PRES_RE.lastIndex = 0;
  while ((m = DFG_PRES_RE.exec(t))) kws.push({ k: m[0], cls: dfgClassePres(m[1]), ini: m.index, fine: m.index + m[0].length, pre: dfgPrefissoPres(m[0]) });
  var stati = {}, assegna = function (seg, cls) { dfTrovaAtleti(seg, pool).forEach(function (x) { if (x.certo) stati[x.id] = cls; }); return seg; };
  var trovaIn = function (seg) { return dfTrovaAtleti(seg, pool).filter(function (x) { return x.certo; }).length; };
  // 1) prefissi: nomi da dopo la parola chiave fino alla successiva
  kws.forEach(function (kw, i) {
    if (!kw.pre) return;
    var seg = t.slice(kw.fine, i + 1 < kws.length ? kws[i + 1].ini : t.length);
    if (trovaIn(seg)) assegna(seg, kw.cls); else kw.pre = false; // niente dopo: allora i nomi stanno prima ("Rossi e Bianchi assenti")
  });
  // 2) suffissi: la frase subito prima (fino a virgola / parola chiave precedente)
  kws.forEach(function (kw, i) {
    if (kw.pre) return;
    var da = i > 0 ? kws[i - 1].fine : 0, seg = t.slice(da, kw.ini);
    var ultimo = Math.max(seg.lastIndexOf(','), seg.lastIndexOf(';'), seg.lastIndexOf('.'));
    // solo l'ultima frase prima della parola chiave ("..., Verdi giustificata"): mai i nomi gia' detti prima della virgola
    if (ultimo >= 0) seg = seg.slice(ultimo + 1);
    if (!trovaIn(seg)) { // niente prima: i nomi stanno dopo ("assente Giora")
      seg = t.slice(kw.fine, i + 1 < kws.length ? kws[i + 1].ini : t.length);
      var primo = seg.search(/[,;.]/); if (primo > 0 && trovaIn(seg.slice(0, primo))) seg = seg.slice(0, primo);
    }
    assegna(seg, kw.cls);
  });
  var haA = kws.some(function (k) { return k.cls === 'A'; }), haP = kws.some(function (k) { return k.cls === 'P'; });
  var tutti = /tutti presenti|tutte presenti|c'erano tutti|presenti tutti|nessun assente/.test(t);
  var base = tutti || (haA && !haP) ? 'P' : (haP ? 'A' : null);
  if (!cats.length) { // categorie non dette: quelle degli atleti nominati
    var cs = {}; Object.keys(stati).forEach(function (id) { var a = atletiStag.find(function (x) { return String(x.id) === String(id); }); if (a) a.cats.forEach(function (c) { cs[c] = 1; }); });
    cats = Object.keys(cs);
  }
  return { data: data, cats: cats, stati: stati, base: base, nominati: Object.keys(stati).length };
}
function dfgAtletiStagione() {
  var st = dfgStagioneAtleti(DFG.atl, srOggi());
  return DFG.atl.filter(function (a) { return a && a.cog && !a.ritirato && (a.iscrizioni || []).some(function (i) { return i.anno === st.chiave; }); })
    .map(function (a) { return { id: a.id, cog: a.cog, nom: a.nom, cats: dfgCategorie(a, st.chiave) }; });
}
function dfgApriPresenze(id) {
  var n = dfTrova(id), el = n && dfgPannello(id);
  if (!n || !el) return;
  if (!DFG.caricato) { el.innerHTML = '<div class="errore">Anagrafica non ancora caricata: riprova tra poco.</div>'; return; }
  var ast = dfgAtletiStagione(), e = dfgEstraiPresenze(n.testo, ast, srOggi());
  DFG.presStato[id] = { data: e.data, cats: e.cats.slice(), stati: e.stati, base: e.base, manuali: {} };
  var tutteCat = Object.keys(DFG_CAT_RADICI);
  ast.forEach(function (a) { a.cats.forEach(function (c) { if (tutteCat.indexOf(c) < 0) tutteCat.push(c); }); });
  el.innerHTML = '<div class="card" style="margin-top:8px;border:1px solid var(--gold)">' +
    '<label>Data allenamento</label><input type="date" id="dfg-pdata-' + id + '" value="' + e.data + '" onchange="dfgPresAggiorna(\'' + id + '\')">' +
    '<label>Categorie</label><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">' + tutteCat.map(function (c) {
      return '<label style="display:flex;gap:4px;align-items:center;margin:0;font-size:13px;color:var(--text)"><input type="checkbox" class="dfg-pcat-' + id + '" value="' + srEsc(c) + '"' + (e.cats.indexOf(c) >= 0 ? ' checked' : '') + ' style="width:auto;min-height:0" onchange="dfgPresAggiorna(\'' + id + '\')"> ' + srEsc(c) + '</label>'; }).join('') + '</div>' +
    '<div id="dfg-plista-' + id + '"></div><div id="dfg-esito-' + id + '"></div>' +
    '<button class="btn-gold btn-sm" onclick="dfgConfermaPresenze(\'' + id + '\')">✅ Registra presenze</button> <button class="btn-gray btn-sm" onclick="dfgChiudi(\'' + id + '\')">Chiudi</button></div>';
  dfgPresAggiorna(id);
}
// manuale > detto nella nota > gia' registrato (allenamento esistente) > regola della frase > assente
function dfgPresStatoDi(ps, aid) { return ps.manuali[aid] || ps.stati[aid] || (ps.esist && ps.esist[aid]) || ps.base || 'A'; }
function dfgPresAggiorna(id) {
  var ps = DFG.presStato[id]; if (!ps) return;
  ps.data = document.getElementById('dfg-pdata-' + id).value;
  ps.cats = Array.prototype.slice.call(document.querySelectorAll('.dfg-pcat-' + id + ':checked')).map(function (c) { return c.value; });
  var lista = dfgAtletiStagione().filter(function (a) { return a.cats.some(function (c) { return ps.cats.indexOf(c) >= 0; }); })
    .sort(function (x, y) { return dfgNomeAtl(x).localeCompare(dfgNomeAtl(y)); });
  ps.lista = lista.map(function (a) { return a.id; });
  var esiste = dfgAllenamentoEsistente(DFG.all, ps.data, ps.cats);
  ps.esist = {};
  if (esiste) DFG.pres.forEach(function (x) { if (x.aid === esiste.id) ps.esist[x.atid] = x.stato; });
  var nota = dfTrova(id), fuori = ((nota && nota.atleti) || []).filter(function (x) { return ps.lista.indexOf(x.id) < 0; }).map(function (x) { return x.nome; });
  var col = { P: '#1a6a3a', R: '#7a5a00', G: '#1a4a8a', A: '#6a1a1a' }, cnt = { P: 0, R: 0, G: 0, A: 0 };
  var righe = lista.map(function (a) {
    var stt = dfgPresStatoDi(ps, a.id); cnt[stt]++;
    return '<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--border)"><span style="flex:1;font-size:13px">' + srEsc(dfgNomeAtl(a)) + (ps.stati[a.id] ? ' <span style="color:var(--gold)">●</span>' : '') + '</span>' +
      ['P', 'R', 'G', 'A'].map(function (x) { var on = x === stt; return '<button style="min-height:34px;padding:4px 9px;border-radius:6px;border:1px solid ' + (on ? col[x] : 'var(--border)') + ';background:' + (on ? col[x] : 'transparent') + ';color:' + (on ? '#fff' : 'var(--muted)') + ';font-size:12px" onclick="dfgPresSet(\'' + id + '\',' + a.id + ',\'' + x + '\')">' + x + '</button>'; }).join('') + '</div>';
  }).join('');
  document.getElementById('dfg-plista-' + id).innerHTML = (lista.length ? '<div style="font-size:12px;color:var(--muted);margin:4px 0">' + lista.length + ' iscritti · ' + cnt.P + ' P · ' + cnt.R + ' R · ' + cnt.G + ' G · ' + cnt.A + ' A' +
    (ps.base ? ' · non nominati = ' + DFG_STATI_PRES[ps.base].toLowerCase() : ' · nessuno indicato: segna tu') + ' · ● = nominato nella nota</div>' + righe
    : '<div style="font-size:12px;color:var(--muted);margin:6px 0">Scegli almeno una categoria.</div>') +
    (fuori.length ? '<div style="font-size:12px;color:var(--warn);margin-top:6px">Nominati nella nota ma non in queste categorie: ' + srEsc(fuori.join(', ')) + '. Aggiungi la categoria o controlla il nome.</div>' : '') +
    (esiste ? '<div style="font-size:12px;color:var(--warn);margin-top:6px">Esiste già l\'allenamento del ' + srDataIt(ps.data) + ' (' + srEsc(esiste.cat) + '): aggiorno quello; chi non è nominato resta com\'era.</div>' : '');
}
function dfgPresSet(id, aid, stt) { var ps = DFG.presStato[id]; if (!ps) return; if (!DFG_STATI_PRES[stt]) { srLog('Stato presenza sconosciuto: ' + stt, 'err'); return; } ps.manuali[aid] = stt; dfgPresAggiorna(id); }
// stesso giorno e stesse categorie (ordine indifferente)
function dfgAllenamentoEsistente(all, data, cats) {
  var chiave = cats.slice().sort().join(',');
  return (all || []).find(function (al) { return al.data === data && String(al.cat || '').split(',').sort().join(',') === chiave; }) || null;
}
function dfgConfermaPresenze(id) {
  var n = dfTrova(id), ps = DFG.presStato[id], es = document.getElementById('dfg-esito-' + id);
  if (!ps || !ps.data || !ps.cats.length || !ps.lista.length) { es.innerHTML = '<div class="errore">Servono data, categoria e almeno un iscritto.</div>'; return; }
  if (ps.data > srOggi()) { es.innerHTML = '<div class="errore">La data è nel futuro.</div>'; return; }
  var col = _db.collection('basket052441'), refA = col.doc('allenamenti'), refP = col.doc('presenze'), adesso = new Date().toISOString(), aid, nuovo;
  var catStr = ps.cats.join(',');
  var copia = dfgNotaAggiornata(n, [{ tipo: 'PRESENZE', data: ps.data, cat: catStr }], 'presenze ' + srDataIt(ps.data) + ' ' + catStr + ': ' + ps.lista.length + ' iscritti');
  es.innerHTML = '<div class="domanda">Registrazione…</div>';
  _db.runTransaction(function (tx) {
    return Promise.all([tx.get(refA), tx.get(refP)]).then(function (ds) {
      var all = ds[0].exists && ds[0].data().v ? JSON.parse(ds[0].data().v) : [];
      var pres = ds[1].exists && ds[1].data().v ? JSON.parse(ds[1].data().v) : [];
      var al = dfgAllenamentoEsistente(all, ps.data, ps.cats);
      nuovo = !al;
      if (!al) { al = { id: Date.now(), data: ps.data, cat: catStr, note: 'da dittafono' }; all.push(al); }
      aid = al.id;
      copia.collegamenti[copia.collegamenti.length - 1].aid = aid;
      ps.lista.forEach(function (atid) {
        var stt = dfgPresStatoDi(ps, atid), i = pres.findIndex(function (p) { return p.aid === aid && p.atid === atid; });
        if (i >= 0) pres[i].stato = stt; else pres.push({ aid: aid, atid: atid, stato: stt });
      });
      tx.set(refA, { v: JSON.stringify(all), ts: adesso, da: 'dittafono ' + SR.utente });
      tx.set(refP, { v: JSON.stringify(pres), ts: adesso, da: 'dittafono ' + SR.utente });
      tx.set(dfCol().doc(id), copia);
      DFG.all = all; DFG.pres = pres;
    });
  }).then(function () {
    Object.assign(n, copia);
    srLog('Presenze ' + ps.data + ' ' + catStr + (nuovo ? ' (nuovo allenamento)' : ' (allenamento aggiornato)'), 'ok');
    dfRenderNote();
    if (DF.ultimaId === id && typeof dfRenderUltima === 'function') dfRenderUltima('✅ Presenze registrate');
  }).catch(function (err) { srLog('Presenze NON registrate: ' + err.message, 'err'); es.innerHTML = '<div class="errore">NON registrate: ' + srEsc(err.message) + '</div>'; });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { dfgQuotaDovuta: dfgQuotaDovuta, dfgQuotaPagata: dfgQuotaPagata, dfgDatiMancanti: dfgDatiMancanti, dfgDetraibile: dfgDetraibile, dfgPagamentiAnno: dfgPagamentiAnno, dfgEstraiPresenze: dfgEstraiPresenze, dfgAllenamentoEsistente: dfgAllenamentoEsistente, dfgCategorieDette: dfgCategorieDette, dfgDate: dfgDate, dfgEstraiDati: dfgEstraiDati, dfgEstraiMetodo: dfgEstraiMetodo, dfgEstraiTipoPag: dfgEstraiTipoPag,
  dfgOscura: dfgOscura, dfgStatoCert: dfgStatoCert, dfgStagione: dfgStagione, dfgRiconosciDomanda: dfgRiconosciDomanda, dfgAnagrafica: dfgAnagrafica, DFG_LEGENDA: DFG_LEGENDA, dfgFratelliDaVerificare: dfgFratelliDaVerificare, dfgRispondi: dfgRispondi, dfgScadenzaDaEmissione: dfgScadenzaDaEmissione, dfgProposta: dfgProposta };
