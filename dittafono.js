// ════════════════════════════════════════════════════════
// FILE: dittafono.js — ASD Basket Campodarsego
// VERSIONE: v0.10 · 20/11/2026 15:45 · BK
// v0.10: APPRENDIMENTO TRA VERSIONI (richiesta Alberto 20/11/2026):
//   - nota che inizia con "BK", "per BK", "istruzione", "sviluppo", "prossima versione"
//     -> tipo 🛠️ Per BK, stato "Per BK" (non entra in "Da elaborare");
//   - "🔄 Rileggi appunti": dopo un aggiornamento rilegge gli appunti con le regole nuove
//     (diventano spese, pagamenti, domande...; quelli ancora non capiti restano appunti);
//   - "📤 Per BK": file di testo con istruzioni + appunti non capiti (CF, telefoni e
//     documenti oscurati) da passare a BK per la versione successiva.
// v0.9: su Android i CSV scaricati restavano grigi (non selezionabili): il campo file
//   accetta qualunque file e il tipo (CSV/JSON) si riconosce dal nome o dal contenuto.
// v0.8: "Importa dati da file" accetta anche un CSV di spese (es. dalla chat palestra) ->
//   revisione e registrazione in blocco (dittafono-import.js v0.2).
// v0.7: il file del foglio (versione 2) porta anche la tabella Atleti -> revisione e
//   applicazione in blocco (dittafono-import.js) dopo l'import delle note.
// v0.6: tipo PALESTRA (sospensioni/assenze degli utenti della palestra, palestra-affitti.js):
//   "26 e 27 dicembre niente attività", "il karate salta lunedì, ha avvisato, ora usata dagli amatori".
// v0.5: nota con pagamento registrato -> pulsante "🧾 Ricevuta PDF" (dittafono-gestionale v0.3).
// v0.4: note PRESENZE -> "✅ Registra presenze" (dittafono-gestionale v0.2).
// v0.3: il dittafono comanda il gestionale (dittafono-gestionale.js):
//   note PAGAMENTO -> "Registra pagamento" (scheda atleta + movimento in
//   Economia); note DATO/NOTA ATLETA -> "Aggiorna scheda"; le DOMANDE
//   ("chi ha il certificato scaduto?") non diventano note: rispondono subito.
// v0.2: IMPORTA NOTE DA FILE (richiesta Alberto 20/11/2026: "le informazioni
//   inserite nella lista atleti con l'agente IA possono essere ricaricate sul
//   dittafono?"). File JSON formato BK-DITTAFONO-NOTE preparato da BK leggendo
//   il foglio dell'agente. Ogni riga diventa una nota "da elaborare" (le
//   REGOLE come appunti). Id deterministico da chiave -> reimportare lo
//   stesso file (o uno aggiornato) aggiunge solo le righe nuove.
//   Il file NON va mai pubblicato su GitHub (dati di minori).
// v0.1: creazione (richiesta Alberto 20/11/2026): "una specie di dittafono
//   in cui memorizzo le informazioni veloci ... che vengono immagazzinate e
//   poi smistate, confrontandole nel tempo con informazioni supplementari".
//   1) CATTURA: ogni nota si salva SUBITO, cosi' come e' stata detta, con
//      data/ora (ed eventuale foto). Nessuna conferma richiesta. Se il
//      database non e' raggiungibile la nota resta sul telefono (coda in
//      localStorage) e parte appena possibile: non si perde mai niente.
//   2) PROPOSTA: la nota viene classificata (spesa, incasso, pagamento
//      atleta, presenze, dato atleta, nota atleta, appunto) e collegata
//      agli atleti nominati, cercati nell'anagrafica (SOLA LETTURA: il
//      dittafono non scrive mai nel blocco dati atleti).
//   3) ELABORAZIONE: le spese/incassi si registrano con un tocco (modulo
//      Spesa gia' compilato, la foto passa al movimento) e la nota resta
//      collegata al movimento creato. Le note su atleti restano "da
//      elaborare": verranno applicate dal gestionale (passo successivo,
//      cosi' il blocco atleti lo scrive solo il gestionale).
// Archivio note: basket052441/dittafono/note/{id} (un documento per nota).
// Foto note: basket052441/documentiNote/{id}/{foto|mini}.
// Dipende da: spese-rapide-voce.js (srNorm, srEstraiImporto, srEstraiTipoMov),
//   spese-rapide.js (SR, _db, srComprimi/srPreparaFoto, srApplicaFrase, ...),
//   economia-core-DRAFT.js (ecoNewId).
// ════════════════════════════════════════════════════════

var DF_TIPI = {
  SPESA: { l: '💸 Spesa', c: '#d58a3a' },
  INCASSO: { l: '💰 Incasso', c: '#22a85a' },
  PAGAMENTO: { l: '💶 Pagamento atleta', c: '#3a9bd5' },
  PRESENZE: { l: '🏀 Presenze', c: '#9b6bd5' },
  DATO_ATLETA: { l: '🪪 Dato atleta', c: '#3a9bd5' },
  NOTA_ATLETA: { l: '📝 Nota su atleta', c: '#7a8fa8' },
  APPUNTO: { l: '📌 Appunto', c: '#7a8fa8' },
  PALESTRA: { l: '🏟️ Palestra', c: '#c8a84b' }, // v0.6
  PER_BK: { l: '🛠️ Per BK (sviluppo)', c: '#c86bd5' } // v0.10
};
var DF_STATI = { NUOVA: 'Da elaborare', ELABORATA: 'Elaborata', APPUNTO: 'Appunto', SCARTATA: 'Scartata', SVILUPPO: 'Per BK' };
var DF_RE_PER_BK = /^\s*(per\s+bk|bk|istruzion\w*|sviluppo|nota per (lo )?sviluppo|(per la |nella )?prossima versione)\b[\s:,.-]*/i; // v0.10
var DF_CODA_KEY = 'bk_dittafono_coda_v1';
var DF_FORMATO_IMPORT = 'BK-DITTAFONO-NOTE';
var DF = { note: [], atleti: [], filtro: 'NUOVA', ultimaId: null, foto: null, caricato: false };

// ════════ FUNZIONI PURE (testabili in Node) ════════
function dfNorm(s) {
  return (typeof srNorm === 'function' ? srNorm(s) : String(s || '').toLowerCase()).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
// Atleti nominati nella frase. atleti = [{id, cog, nom}]. Il cognome deve
// comparire come parola intera; se compare anche il nome il punteggio sale.
// Se lo stesso cognome appartiene a piu' atleti e il nome non e' stato
// detto, li restituisce TUTTI (la pagina chiedera' quale): mai indovinare.
var DF_ARTICOLI = {};
'il lo la i gli le l un uno una del dello della dei degli delle al allo alla ai agli alle dal dallo dalla dai dagli dalle nel nello nella nei negli nelle sul sullo sulla sui sugli sulle col'.split(' ').forEach(function (w) { DF_ARTICOLI[w] = true; });
function dfTrovaAtleti(testo, atleti) {
  var t = ' ' + dfNorm(testo) + ' ';
  var trovati = [];
  // cognomi lunghi prima: "de rossi" va riconosciuto prima di "rossi"
  var cognomi = {};
  (atleti || []).forEach(function (a) { var c = dfNorm(a.cog); if (c && c.length >= 3) cognomi[c] = true; });
  var lunghi = Object.keys(cognomi).filter(function (c) { return c.indexOf(' ') > 0 && t.indexOf(' ' + c + ' ') >= 0; });
  (atleti || []).forEach(function (a) {
    var cog = dfNorm(a.cog), nom = dfNorm(a.nom);
    if (!cog || cog.length < 3) return;
    // testo senza i cognomi composti piu' lunghi che contengono questo cognome
    var tt = t;
    lunghi.forEach(function (l) { if (l !== cog && (' ' + l + ' ').indexOf(' ' + cog + ' ') >= 0) tt = tt.split(' ' + l + ' ').join(' § '); });
    var pos = tt.indexOf(' ' + cog + ' ');
    if (pos < 0) return;
    var punti = 1;
    if (nom) nom.split(' ').forEach(function (p) { if (p.length >= 3 && tt.indexOf(' ' + p + ' ') >= 0) punti = 2; });
    // solo cognome, preceduto da articolo/preposizione: e' una parola comune ("la costa", "del moro"), non un atleta
    if (punti === 1) {
      var prima = tt.slice(0, pos).trim().split(' ').pop();
      if (DF_ARTICOLI[prima]) return;
    }
    trovati.push({ id: a.id, nome: ((a.cog || '') + ' ' + (a.nom || '')).trim(), cog: cog, punti: punti });
  });
  // per ogni cognome: se qualcuno ha anche il nome, tieni solo quelli con il nome
  var perCog = {};
  trovati.forEach(function (x) { (perCog[x.cog] = perCog[x.cog] || []).push(x); });
  var out = [];
  Object.keys(perCog).forEach(function (c) {
    var g = perCog[c], max = Math.max.apply(null, g.map(function (x) { return x.punti; }));
    g.filter(function (x) { return x.punti === max; }).forEach(function (x) { out.push({ id: x.id, nome: x.nome, certo: max === 2 || g.length === 1 }); });
  });
  return out;
}
var DF_RE_PRESENZE = /\b(allenament\w*|assent\w*|present\w*|convocat\w*)\b/;
var DF_RE_PAGAMENTO = /\b(pagat\w*|pagamento|quota|rata|rate|saldo|versat\w*|bonific\w*|acconto)\b/;
var DF_RE_DATO = /\b(certificat\w*|maglia|cellular\w*|telefon\w*|numero|iscritt\w*|iscrizion\w*|residen\w*|abita|via|nat[oa]|tutor\w*|mamma|papa|madre|padre|document\w*|consegnat\w*|email|mail|categoria|ritirat\w*|fratell\w*|sorell\w*)\b/;
// Classificazione della nota. Ritorna { tipo, atleti, importo }
function dfClassifica(testo, atleti) {
  var t = dfNorm(testo);
  if (DF_RE_PER_BK.test(String(testo || ''))) return { tipo: 'PER_BK', atleti: [], importo: null }; // v0.10
  var trov = dfTrovaAtleti(testo, atleti);
  // le date ("15 marzo", "15/03/2027") non sono importi
  var senzaDate = String(testo || '').replace(/\b\d{1,2}\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(\s+\d{4})?\b/gi, ' ')
    .replace(/\b\d{1,2}[\/.-]\d{1,2}([\/.-]\d{2,4})?\b/g, ' ');
  var imp = typeof srEstraiImporto === 'function' ? srEstraiImporto(senzaDate).valore : null;
  var tipo;
  if (DF_RE_PRESENZE.test(t)) tipo = 'PRESENZE';
  else if (trov.length) {
    if (DF_RE_PAGAMENTO.test(t) || (imp != null && !DF_RE_DATO.test(t))) tipo = 'PAGAMENTO';
    else if (DF_RE_DATO.test(t)) tipo = 'DATO_ATLETA';
    else tipo = 'NOTA_ATLETA';
  } else if (imp != null) {
    tipo = (typeof srEstraiTipoMov === 'function' && srEstraiTipoMov(testo) === 'ENTRATA') ? 'INCASSO' : 'SPESA';
  } else tipo = 'APPUNTO';
  return { tipo: tipo, atleti: trov, importo: imp };
}

// ════════ ARCHIVIO ════════
function dfCol() { return _db.collection('basket052441').doc('dittafono').collection('note'); }
function dfColFoto(id) { return _db.collection('basket052441').doc('documentiNote').collection(String(id)); }
function dfLeggiCoda() { try { return JSON.parse(localStorage.getItem(DF_CODA_KEY) || '[]'); } catch (ex) { srLog('Coda dittafono illeggibile: ' + ex.message, 'err'); return []; } }
function dfScriviCoda(c) {
  try { localStorage.setItem(DF_CODA_KEY, JSON.stringify(c)); return true; }
  catch (ex) { srLog('Coda dittafono NON salvata sul telefono: ' + ex.message, 'err'); return false; }
}
function dfScriviNota(nota, foto) {
  var b = _db.batch();
  if (foto) {
    b.set(dfColFoto(nota.id).doc('foto'), { mimeType: 'image/jpeg', base64: foto.full.base64, kb: foto.full.kb });
    b.set(dfColFoto(nota.id).doc('mini'), { mimeType: 'image/jpeg', base64: foto.mini.base64, kb: foto.mini.kb });
  }
  b.set(dfCol().doc(nota.id), nota);
  return b.commit();
}
function dfInit() {
  dfAggiornaContatore();
  var atl = _db.collection('basket052441').doc('atleti').get().then(function (d) {
    var arr = [];
    if (d.exists && d.data().v) { try { arr = JSON.parse(d.data().v); } catch (ex) { srLog('Anagrafica atleti illeggibile: ' + ex.message, 'err'); } }
    DF.atleti = (arr || []).filter(function (a) { return a && a.cog; }).map(function (a) { return { id: a.id, cog: a.cog, nom: a.nom || '' }; });
    srLog('Dittafono: ' + DF.atleti.length + ' atleti per il riconoscimento dei nomi', 'ok');
  }).catch(function (err) { srLog('Dittafono: anagrafica non letta (' + err.message + '): i nomi non verranno riconosciuti', 'warn'); });
  var note = dfCol().get().then(function (snap) {
    var arr = []; snap.forEach(function (d) { arr.push(d.data()); });
    DF.note = arr;
    DF.caricato = true;
  }).catch(function (err) { srLog('Dittafono: note non caricate (' + err.message + ')', 'err'); });
  var gest = typeof dfgCarica === 'function' ? dfgCarica() : Promise.resolve(); // v0.3
  return Promise.all([atl, note, gest]).then(function () { return dfInviaCoda(); }).then(function () { dfAggiornaContatore(); dfRenderNote(); dfRenderCodaInfo(); });
}
if (typeof window !== 'undefined') window.addEventListener('online', function () { if (_db) dfInviaCoda().then(function () { dfRenderNote(); dfRenderCodaInfo(); }); });
// Invia le note rimaste sul telefono. Ritorna Promise (non rifiuta mai: gli errori restano in coda e nel log).
function dfInviaCoda() {
  var coda = dfLeggiCoda();
  if (!coda.length || !_db) return Promise.resolve();
  var restano = [];
  return coda.reduce(function (p, item) {
    return p.then(function () {
      return dfScriviNota(item.nota, item.foto).then(function () {
        if (!DF.note.some(function (n) { return n.id === item.nota.id; })) DF.note.push(item.nota);
        srLog('Nota dal telefono inviata: ' + item.nota.id, 'ok');
      }).catch(function (err) { restano.push(item); srLog('Nota ' + item.nota.id + ' ancora sul telefono: ' + err.message, 'warn'); });
    });
  }, Promise.resolve()).then(function () { dfScriviCoda(restano); dfRenderCodaInfo(); dfAggiornaContatore(); });
}

// ════════ CATTURA ════════
function dfSalva(testo) {
  testo = String(testo || '').trim();
  var esito = document.getElementById('df-esito');
  if (!testo && !DF.foto) { esito.innerHTML = '<div class="errore">Detta o scrivi qualcosa (o fai una foto).</div>'; return; }
  // v0.3: una domanda non e' una nota -> risposta immediata
  if (!DF.foto && typeof dfgProvaDomanda === 'function' && dfgProvaDomanda(testo)) { document.getElementById('df-testo').value = ''; esito.innerHTML = ''; return; }
  var risp = document.getElementById('dfg-risposta'); if (risp) risp.innerHTML = '';
  var cl = dfClassifica(testo, DF.atleti);
  if (typeof paClassificaNota === 'function' && typeof PA !== 'undefined' && PA.conf && paClassificaNota(testo, PA.conf.utenti, cl.atleti) === 'PALESTRA') { cl.tipo = 'PALESTRA'; cl.importo = null; } // v0.6
  var adesso = new Date().toISOString();
  var nota = { id: ecoNewId('NOTA'), testo: testo, creataIl: adesso, creataDa: SR.utente, stato: cl.tipo === 'PER_BK' ? 'SVILUPPO' : 'NUOVA', tipo: cl.tipo, importo: cl.importo,
    atleti: cl.atleti, foto: !!DF.foto, collegamenti: [], storia: [{ il: adesso, da: SR.utente, azione: 'creata' }] };
  var foto = DF.foto;
  DF.foto = null; dfMostraFoto(null);
  document.getElementById('df-testo').value = '';
  DF.ultimaId = nota.id;
  DF.note.push(nota);
  dfRenderUltima('Salvataggio…');
  dfScriviNota(nota, foto).then(function () {
    srLog('Nota salvata: ' + nota.id + ' [' + nota.tipo + '] ' + testo, 'ok');
    dfRenderUltima('✅ Salvata');
  }).catch(function (err) {
    var coda = dfLeggiCoda(); coda.push({ nota: nota, foto: foto });
    var ok = dfScriviCoda(coda);
    srLog('Nota NON inviata (' + err.message + '): ' + (ok ? 'tenuta sul telefono' : 'ATTENZIONE: nemmeno il telefono ha spazio'), ok ? 'warn' : 'err');
    dfRenderUltima(ok ? '📱 Salvata sul telefono: la invio appena c\'è connessione' : '⚠️ NON salvata: ricopiala o riprova (' + srEsc(err.message) + ')');
    dfRenderCodaInfo();
  }).then(dfAggiornaContatore);
}
function dfSalvaDaCampo() { dfSalva(document.getElementById('df-testo').value); }
function dfFotoScelta(inp) {
  var f = inp.files && inp.files[0];
  inp.value = '';
  if (!f) return;
  srPreparaFoto(f).then(function (foto) { DF.foto = foto; dfMostraFoto(foto); })
    .catch(function (err) { srLog('Foto nota: ' + err.message, 'err'); alert('Foto non utilizzabile: ' + err.message); });
}
function dfMostraFoto(foto) {
  var img = document.getElementById('df-foto-prev');
  if (foto) { img.src = 'data:image/jpeg;base64,' + foto.mini.base64; img.style.display = 'block'; }
  else { img.removeAttribute('src'); img.style.display = 'none'; }
}
var dfRiconoscitore = null;
function dfAscolta() {
  var SRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SRec) { alert('Il riconoscimento vocale non è disponibile in questo browser: tocca il campo di testo e usa il microfono della tastiera.'); document.getElementById('df-testo').focus(); return; }
  if (dfRiconoscitore) { dfRiconoscitore.stop(); return; }
  var rec = new SRec();
  rec.lang = 'it-IT'; rec.interimResults = true; rec.continuous = false;
  var btn = document.getElementById('df-mic'), campo = document.getElementById('df-testo');
  var prima = campo.value ? campo.value.trim() + ' ' : '';
  var finale = '';
  btn.classList.add('ascolto'); btn.innerHTML = '<span class="ico">⏺️</span>Ascolto… (tocca per finire)';
  rec.onresult = function (ev) {
    var tx = '';
    for (var i = ev.resultIndex; i < ev.results.length; i++) { tx += ev.results[i][0].transcript; if (ev.results[i].isFinal) finale += ev.results[i][0].transcript; }
    campo.value = prima + (finale || tx);
  };
  rec.onerror = function (ev) {
    srLog('Dittafono voce: ' + ev.error, 'err');
    if (ev.error === 'not-allowed') alert('Permesso microfono negato: abilitalo per questa pagina.');
  };
  rec.onend = function () {
    dfRiconoscitore = null;
    btn.classList.remove('ascolto'); btn.innerHTML = '<span class="ico">🎤</span>Detta';
    if (finale.trim()) dfSalva(campo.value); // salva SUBITO, senza conferme
  };
  try { rec.start(); dfRiconoscitore = rec; } catch (ex) { srLog('Avvio voce: ' + ex.message, 'err'); btn.classList.remove('ascolto'); btn.innerHTML = '<span class="ico">🎤</span>Detta'; }
}

// ════════ VISUALIZZAZIONE ════════
function dfTrova(id) { return DF.note.find(function (n) { return n.id === id; }) || null; }
function dfAggiornaContatore() {
  var n = DF.note.filter(function (x) { return x.stato === 'NUOVA'; }).length + dfLeggiCoda().length;
  var el = document.querySelector('.nav-tab[data-tab="note"]');
  if (el) el.textContent = '📥 Note' + (n ? ' (' + n + ')' : '');
}
function dfRenderCodaInfo() {
  var c = dfLeggiCoda().length, el = document.getElementById('df-coda');
  if (el) el.innerHTML = c ? '<div class="domanda">📱 ' + (c === 1 ? '1 nota è ancora' : c + ' note sono ancora') + ' sul telefono, in attesa di connessione. <button class="btn-gray btn-sm" onclick="dfInviaCoda().then(function(){dfRenderNote();dfRenderCodaInfo();dfAggiornaContatore();})">Riprova ora</button></div>' : '';
}
function dfRenderUltima(stato) {
  var n = dfTrova(DF.ultimaId), el = document.getElementById('df-ultima');
  if (!n || !el) return;
  el.innerHTML = '<div class="card" style="border-color:var(--gold)"><div style="font-size:12px;color:var(--muted)">' + srEsc(stato) + '</div>' + dfHtmlNota(n, true) + '</div>';
}
function dfHtmlNota(n, compatta) {
  var t = DF_TIPI[n.tipo] || { l: n.tipo, c: '#888' };
  var d = new Date(n.creataIl);
  var quando = isNaN(d) ? '' : d.toLocaleDateString('it-IT') + ' ' + d.toTimeString().slice(0, 5);
  var atl = (n.atleti || []).map(function (a) { return '<span class="badge" style="background:var(--bg2);color:var(--text)">' + srEsc(a.nome) + (a.certo ? '' : ' ?') + '</span>'; }).join('');
  var ambiguo = (n.atleti || []).length > 1 && (n.atleti || []).some(function (a) { return !a.certo; });
  var azioni = '';
  if (n.stato === 'NUOVA') {
    if (n.tipo === 'SPESA' || n.tipo === 'INCASSO') azioni += '<button class="btn-gold btn-sm" onclick="dfElaboraSpesa(\'' + n.id + '\')">➡️ Registra ' + (n.tipo === 'INCASSO' ? 'incasso' : 'spesa') + '</button> ';
    else if (n.tipo === 'PAGAMENTO' && typeof dfgApriPagamento === 'function') azioni += '<button class="btn-gold btn-sm" onclick="dfgApriPagamento(\'' + n.id + '\')">✅ Registra pagamento</button> ';
    else if ((n.tipo === 'DATO_ATLETA' || n.tipo === 'NOTA_ATLETA') && typeof dfgApriDati === 'function') azioni += '<button class="btn-gold btn-sm" onclick="dfgApriDati(\'' + n.id + '\')">✅ Aggiorna scheda</button> ';
    else if (n.tipo === 'PALESTRA' && typeof paApriNota === 'function') azioni += '<button class="btn-gold btn-sm" onclick="paApriNota(\'' + n.id + '\')">📅 Registra in palestra</button> ';
    else if (n.tipo === 'PRESENZE' && typeof dfgApriPresenze === 'function') azioni += '<button class="btn-gold btn-sm" onclick="dfgApriPresenze(\'' + n.id + '\')">✅ Registra presenze</button> <button class="btn-gray btn-sm" onclick="dfgApriDati(\'' + n.id + '\')">📎 Note atleta</button> ';
    azioni += '<button class="btn-gray btn-sm" onclick="dfCambiaTipo(\'' + n.id + '\')">Cambia tipo</button> ';
    if (!compatta) azioni += '<button class="btn-gray btn-sm" onclick="dfImpostaStato(\'' + n.id + '\',\'APPUNTO\')">📌 Tieni come appunto</button> <button class="btn-red btn-sm" onclick="dfImpostaStato(\'' + n.id + '\',\'SCARTATA\')">Scarta</button>';
  }
  if (n.stato === 'ELABORATA' && !compatta && typeof dfgLinkPagamento === 'function' && dfgLinkPagamento(n))
    azioni += '<button class="btn-gold btn-sm" onclick="dfgPreparaRicevuta(\'' + n.id + '\')">🧾 Ricevuta PDF</button> ';
  var link = (n.collegamenti || []).map(function (c) { return '<span class="badge b-ok">→ ' + srEsc(c.numero || c.id) + '</span>'; }).join('');
  return '<div class="mov" style="background:transparent;border:none;padding:6px 0;margin:0">' +
    (n.foto ? '<img class="mov-thumb" id="dfmini-' + n.id + '" alt="" onclick="dfApriFoto(\'' + n.id + '\')">' : '') +
    '<div class="mov-body"><div class="mov-top"><span style="color:' + t.c + '">' + t.l + '</span><span style="font-weight:400;font-size:12px;color:var(--muted)">' + quando + '</span></div>' +
    '<div style="margin:4px 0;white-space:pre-wrap">' + srEsc(n.testo || '(solo foto)') + '</div>' +
    '<div>' + atl + (n.importo != null && /^(SPESA|INCASSO|PAGAMENTO)$/.test(n.tipo) ? '<span class="badge" style="background:var(--bg2);color:var(--text)">' + srEuro(n.importo) + '</span>' : '') +
    (n.stato !== 'NUOVA' ? '<span class="badge" style="background:var(--bg2);color:var(--muted)">' + (DF_STATI[n.stato] || n.stato) + '</span>' : '') + link + '</div>' +
    (ambiguo ? '<div style="font-size:12px;color:var(--warn);margin-top:4px">Più atleti con lo stesso cognome: si chiarisce in elaborazione.</div>' : '') +
    (azioni ? '<div style="margin-top:6px">' + azioni + '</div>' : '') + (compatta ? '' : '<div id="dfg-pan-' + n.id + '"></div>') + '</div></div>';
}
function dfCaricaMini(id) {
  if (SR.miniCache['N' + id]) { var e = document.getElementById('dfmini-' + id); if (e) e.src = 'data:image/jpeg;base64,' + SR.miniCache['N' + id]; return; }
  dfColFoto(id).doc('mini').get().then(function (d) {
    if (!d.exists) return;
    SR.miniCache['N' + id] = d.data().base64;
    var el = document.getElementById('dfmini-' + id); if (el) el.src = 'data:image/jpeg;base64,' + SR.miniCache['N' + id];
  }).catch(function (err) { srLog('Miniatura nota ' + id + ': ' + err.message, 'warn'); });
}
function dfApriFoto(id) {
  dfColFoto(id).doc('foto').get().then(function (d) {
    if (!d.exists) { alert('Foto non trovata.'); return; }
    document.getElementById('lightbox-img').src = 'data:image/jpeg;base64,' + d.data().base64;
    document.getElementById('lightbox').style.display = 'flex';
  }).catch(function (err) { srLog('Foto nota: ' + err.message, 'err'); alert('Foto non caricata: ' + err.message); });
}
function dfSetFiltro(v) {
  DF.filtro = v;
  document.querySelectorAll('#df-filtro .chip').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-v') === v); });
  dfRenderNote();
}
function dfRenderNote() {
  var el = document.getElementById('df-lista'); if (!el) return;
  var lista = DF.note.filter(function (n) { return DF.filtro === 'TUTTE' ? true : n.stato === DF.filtro; })
    .sort(function (a, b) { return (b.creataIl || '').localeCompare(a.creataIl || ''); });
  if (!DF.caricato) { el.innerHTML = '<div class="empty">Caricamento note…</div>'; return; }
  el.innerHTML = lista.length ? lista.map(function (n) { return '<div class="card" style="padding:8px 12px">' + dfHtmlNota(n, false) + '</div>'; }).join('')
    : '<div class="empty">' + (DF.filtro === 'NUOVA' ? 'Nessuna nota da elaborare. 👍' : 'Nessuna nota.') + '</div>';
  lista.forEach(function (n) { if (n.foto) dfCaricaMini(n.id); });
  dfAggiornaContatore();
}

// ════════ v0.10: RILEGGI APPUNTI / ESPORTA PER BK ════════
// Proposta di riclassificazione di un appunto con le regole attuali (funzione pura).
function dfRiclassifica(n, atleti, eDomanda) {
  if (!n || n.tipo !== 'APPUNTO' || !(n.stato === 'NUOVA' || n.stato === 'APPUNTO') || !n.testo) return null;
  if (eDomanda && eDomanda(n.testo)) return { stato: 'ELABORATA', tipo: 'APPUNTO', azione: 'riletta: era una domanda (ora riconosciuta)' };
  var cl = dfClassifica(n.testo, atleti);
  if (cl.tipo === 'APPUNTO') return null;
  return { stato: cl.tipo === 'PER_BK' ? 'SVILUPPO' : 'NUOVA', tipo: cl.tipo, importo: cl.importo, atleti: cl.atleti, azione: 'riletta con le regole ' + (typeof SR_BUILD !== 'undefined' ? SR_BUILD : '') + ': ' + cl.tipo };
}
function dfRileggiAppunti() {
  var eDom = typeof dfgRiconosciDomanda === 'function' ? function (t) { return !!dfgRiconosciDomanda(t, DF.atleti); } : null;
  var prop = DF.note.map(function (n) { return { n: n, r: dfRiclassifica(n, DF.atleti, eDom) }; }).filter(function (x) { return x.r; });
  var tot = DF.note.filter(function (n) { return n.tipo === 'APPUNTO' && (n.stato === 'NUOVA' || n.stato === 'APPUNTO'); }).length;
  if (!prop.length) { alert('Riletti ' + tot + ' appunti: nessuno è stato capito meglio con le regole attuali.'); srLog('Rileggi appunti: ' + tot + ' riletti, 0 cambiati', 'ok'); return; }
  var dom = prop.filter(function (x) { return x.r.stato === 'ELABORATA'; }).length;
  if (!confirm('Riletti ' + tot + ' appunti con le regole nuove:\n' + (prop.length - dom) + ' diventano note da elaborare (spese, pagamenti, dati...)\n' + dom + ' erano domande (le chiudo)\nGli altri restano appunti. Procedo?')) return;
  var b = _db.batch(), adesso = new Date().toISOString(), copie = [];
  prop.forEach(function (x) {
    var c = JSON.parse(JSON.stringify(x.n)); var az = x.r.azione; delete x.r.azione; Object.assign(c, x.r);
    c.storia = (x.n.storia || []).concat([{ il: adesso, da: SR.utente, azione: az }]);
    b.set(dfCol().doc(c.id), c); copie.push([x.n, c]);
  });
  b.commit().then(function () {
    copie.forEach(function (p) { Object.assign(p[0], p[1]); });
    srLog('Rileggi appunti: ' + copie.length + ' note riclassificate', 'ok'); dfRenderNote();
  }).catch(function (err) { srLog('Rileggi appunti NON salvato: ' + err.message, 'err'); alert('Non salvato: ' + err.message); });
}
// Testo da passare a BK (puro): istruzioni + appunti non capiti, dati personali oscurati.
function dfTestoPerBK(note, build, oggi) {
  var osc = typeof dfgOscura === 'function' ? dfgOscura : function (x) { return String(x || ''); };
  var it = function (iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('it-IT'); };
  var ist = note.filter(function (n) { return n.tipo === 'PER_BK' && n.stato !== 'SCARTATA'; });
  var nc = note.filter(function (n) { return n.tipo === 'APPUNTO' && (n.stato === 'NUOVA' || n.stato === 'APPUNTO') && n.testo; });
  var riga = function (n) { return '- ' + it(n.creataIl) + ': ' + osc(n.testo).replace(DF_RE_PER_BK, '').replace(/\s+/g, ' ').trim(); };
  return 'BK DITTAFONO — PER LA PROSSIMA VERSIONE\nVersione in uso: ' + (build || '?') + ' · esportato il ' + oggi + '\n\n' +
    'ISTRUZIONI E INFORMAZIONI DETTATE (' + ist.length + ')\n' + (ist.map(riga).join('\n') || '- nessuna') + '\n\n' +
    'NOTE NON CAPITE / APPUNTI (' + nc.length + ')\n' + (nc.map(riga).join('\n') || '- nessuna') + '\n';
}
function dfEsportaPerBK() {
  var oggi = typeof srOggi === 'function' ? srOggi() : new Date().toISOString().slice(0, 10);
  var txt = dfTestoPerBK(DF.note, typeof SR_BUILD !== 'undefined' ? SR_BUILD : '', oggi);
  try {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
    a.download = 'BK_dittafono_per_BK_' + oggi + '.txt'; document.body.appendChild(a); a.click(); a.remove();
    srLog('Esportato file per BK', 'ok');
  } catch (err) { srLog('Export per BK non riuscito: ' + err.message, 'err'); alert('File non creato: ' + err.message); }
}

// ════════ ELABORAZIONE ════════
function dfAggiornaNota(n, modifiche, azione) {
  var copia = JSON.parse(JSON.stringify(n));
  Object.assign(copia, modifiche);
  copia.storia = (n.storia || []).concat([{ il: new Date().toISOString(), da: SR.utente, azione: azione }]);
  return dfCol().doc(n.id).set(copia).then(function () { Object.assign(n, copia); dfRenderNote(); if (DF.ultimaId === n.id) dfRenderUltima('✅ Aggiornata'); })
    .catch(function (err) { srLog('Nota ' + n.id + ' non aggiornata: ' + err.message, 'err'); alert('Nota non aggiornata: ' + err.message); throw err; });
}
function dfImpostaStato(id, stato) {
  var n = dfTrova(id); if (!n) return;
  if (stato === 'SCARTATA' && !confirm('Scartare la nota? Resta comunque nell\'archivio (filtro "Tutte").')) return;
  dfAggiornaNota(n, { stato: stato }, 'stato → ' + stato).catch(function () {});
}
function dfCambiaTipo(id) {
  var n = dfTrova(id); if (!n) return;
  var chiavi = Object.keys(DF_TIPI);
  var scelta = prompt('Tipo della nota (numero):\n' + chiavi.map(function (k, i) { return (i + 1) + ' = ' + DF_TIPI[k].l.replace(/^\S+\s/, ''); }).join('\n'), String(chiavi.indexOf(n.tipo) + 1));
  if (scelta === null) return;
  var k = chiavi[parseInt(scelta, 10) - 1];
  if (!k) { alert('Numero non valido.'); return; }
  dfAggiornaNota(n, { tipo: k }, 'tipo ' + n.tipo + ' → ' + k).catch(function () {});
}
// Spesa/incasso: apre il modulo Spesa gia' compilato dalla nota (con la sua foto)
function dfElaboraSpesa(id) {
  var n = dfTrova(id); if (!n) return;
  srGoTab('nuova');
  srNuova();
  SR.notaInElaborazione = id;
  srEl('banner-modifica').innerHTML = '<div class="domanda">📥 Dalla nota del ' + new Date(n.creataIl).toLocaleDateString('it-IT') + ': controlla e premi Salva.<div class="chips"><button class="chip" onclick="srNuova()">Annulla</button></div></div>';
  var applica = function () {
    srEl('frase').value = n.testo || '';
    if (n.testo) srApplicaFrase(n.testo);
    if (n.tipo === 'INCASSO') srSetTipoMov('ENTRATA');
    var d = new Date(n.creataIl);
    if (!isNaN(d) && !/\b(ieri|altro ieri)\b/.test(dfNorm(n.testo))) { SR.s.data = srISO(d); srRenderForm(); }
  };
  if (!n.foto) { applica(); return; }
  Promise.all([dfColFoto(id).doc('foto').get(), dfColFoto(id).doc('mini').get()]).then(function (r) {
    if (r[0].exists && r[1].exists) {
      SR.foto = { full: { base64: r[0].data().base64, kb: r[0].data().kb }, mini: { base64: r[1].data().base64, kb: r[1].data().kb } };
      var prev = srEl('foto-prev'); prev.src = 'data:image/jpeg;base64,' + SR.foto.mini.base64; prev.style.display = 'block';
      if (!SR.s.documento) SR.s.documento = 'SCONTRINO';
    }
    applica();
  }).catch(function (err) { srLog('Foto della nota non caricata: ' + err.message, 'warn'); applica(); });
}
// Chiamata da srSalva dopo il salvataggio del movimento
function dfDopoSalvataggioMovimento(notaId, m) {
  var n = dfTrova(notaId);
  if (!n) { srLog('dfDopoSalvataggioMovimento: nota ' + notaId + ' non trovata', 'err'); return; }
  var coll = (n.collegamenti || []).concat([{ tipo: 'MOVIMENTO', id: m.id, numero: m.numeroMovimento, il: new Date().toISOString() }]);
  dfAggiornaNota(n, { stato: 'ELABORATA', collegamenti: coll }, 'registrata come ' + m.numeroMovimento).catch(function () {});
}

if (typeof module !== 'undefined' && module.exports) module.exports = { dfTrovaAtleti: dfTrovaAtleti, dfClassifica: dfClassifica };

// ════════ IMPORT DA FILE (v0.2) ════════
// Id stabile dalla chiave della riga (FNV-1a 32 bit, due passate -> 16 hex).
function dfIdImport(chiave) {
  function fnv(str, seed) { var h = seed >>> 0; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }
  return 'IMP-' + fnv(chiave, 2166136261) + fnv(chiave + '#', 33554467);
}
// Converte il contenuto del file in note. Ritorna {note, scartate[]} (mai eccezioni per righe singole).
function dfNoteDaImport(dati, atleti, utente, adesso) {
  if (!dati || dati.formato !== DF_FORMATO_IMPORT || !Array.isArray(dati.note)) throw new Error('file non riconosciuto (atteso formato ' + DF_FORMATO_IMPORT + ')');
  var out = [], scartate = [];
  dati.note.forEach(function (r, i) {
    if (!r || !r.chiave || !r.testo) { scartate.push('riga ' + (i + 1) + ': senza chiave o testo'); return; }
    var testo = (r.nominativo ? r.nominativo + ' — ' : '') + r.testo;
    var cl = dfClassifica(testo, atleti);
    var trov = r.nominativo ? dfTrovaAtleti(r.nominativo, atleti) : [];
    if (!trov.length) trov = cl.atleti;
    var tipo = cl.tipo;
    if (r.tipo != null) {
      if (DF_TIPI[r.tipo]) tipo = r.tipo;
      else scartate.push('riga ' + (i + 1) + ': tipo "' + r.tipo + '" sconosciuto, uso la classificazione automatica (' + tipo + ')');
    }
    // Le cifre dentro il testo (anni, date) NON diventano importi: conta solo il campo importo del file.
    var imp = (typeof r.importo === 'number' && isFinite(r.importo)) ? Math.round(r.importo * 100) / 100 : null;
    if (imp == null && /^(SPESA|INCASSO|PAGAMENTO)$/.test(tipo)) { tipo = trov.length ? 'DATO_ATLETA' : 'APPUNTO'; scartate.push('riga ' + (i + 1) + ': cifra senza importo dichiarato, classificata ' + tipo); }
    var quando = /^\d{4}-\d{2}-\d{2}$/.test(r.data || '') ? r.data + 'T12:00:00' : adesso;
    out.push({ id: dfIdImport(r.chiave), testo: testo, creataIl: new Date(quando).toISOString(), creataDa: utente,
      stato: tipo === 'APPUNTO' ? 'APPUNTO' : 'NUOVA', tipo: tipo, importo: imp, atleti: trov, foto: false, collegamenti: [],
      origine: 'IMPORT_FOGLIO', fonte: String(r.fonte || dati.fonte || 'file'), dataEvento: r.dataPagamento || null,
      storia: [{ il: adesso, da: utente, azione: 'importata da file (' + String(dati.fonte || 'foglio') + ')' }] });
  });
  return { note: out, scartate: scartate };
}
function dfImportaFile(inp) {
  var f = inp && inp.files && inp.files[0];
  if (!f) return;
  var esito = document.getElementById('df-import-esito');
  var r = new FileReader();
  r.onerror = function () { srLog('Import note: file illeggibile', 'err'); esito.innerHTML = '<div class="errore">File illeggibile.</div>'; };
  var csv = /\.csv$/i.test(f.name || '') || /csv/.test(f.type || '');
  r.onload = function () {
    inp.value = '';
    var testo = String(r.result || '').replace(/^\uFEFF/, '');
    if (!/\.json$/i.test(f.name || '') && !/^\s*[\[{]/.test(testo)) { // v0.9: riconosce dal contenuto
      if (/[;,\t]/.test(testo.split(/\r?\n/)[0] || '')) csv = true;
      else { srLog('Import: file non riconosciuto ' + f.name, 'err'); esito.innerHTML = '<div class="errore">File non riconosciuto: serve un CSV (righe separate da ;) o il file .json del foglio.</div>'; return; }
    }
    if (csv) { if (typeof dfsImportaCSV === 'function') dfsImportaCSV(String(r.result), f.name); else esito.innerHTML = '<div class="errore">Import CSV non disponibile: aggiorna i file.</div>'; return; } // v0.8
    var res;
    var dati;
    try { dati = JSON.parse(r.result); res = dfNoteDaImport(dati, DF.atleti, SR.utente, new Date().toISOString()); }
    catch (ex) { srLog('Import note: ' + ex.message, 'err'); esito.innerHTML = '<div class="errore">Import non fatto: ' + srEsc(ex.message) + '</div>'; return; }
    var gia = {}; DF.note.forEach(function (n) { gia[n.id] = true; });
    var nuove = res.note.filter(function (n) { return !gia[n.id]; });
    res.scartate.forEach(function (s) { srLog('Import note: ' + s, 'warn'); });
    var revisione = function () { if (dati.atleti && dati.atleti.length && typeof dfiRevisione === 'function') dfiRevisione(dati); };
    if (!nuove.length) { esito.innerHTML = '<div class="empty">Niente di nuovo: tutte le ' + res.note.length + ' righe sono già nel dittafono.</div>'; revisione(); return; }
    var pag = nuove.filter(function (n) { return n.tipo === 'PAGAMENTO'; }).length;
    if (!confirm('Importo ' + nuove.length + ' note nuove (' + pag + ' pagamenti)?\nGià presenti: ' + (res.note.length - nuove.length) + (res.scartate.length ? '\nAvvisi: ' + res.scartate.length + ' (vedi log)' : ''))) return;
    esito.innerHTML = '<div class="empty">Importazione…</div>';
    var blocchi = []; for (var i = 0; i < nuove.length; i += 400) blocchi.push(nuove.slice(i, i + 400));
    var fatte = 0;
    blocchi.reduce(function (p, bl) {
      return p.then(function () {
        var b = _db.batch(); bl.forEach(function (n) { b.set(dfCol().doc(n.id), n); });
        return b.commit().then(function () { fatte += bl.length; Array.prototype.push.apply(DF.note, bl); });
      });
    }, Promise.resolve()).then(function () {
      srLog('Import note: ' + fatte + ' note importate', 'ok');
      esito.innerHTML = '<div class="riepilogo">✅ Importate ' + fatte + ' note. Già presenti: ' + (res.note.length - nuove.length) + '.</div>';
    }).catch(function (err) {
      srLog('Import note interrotto dopo ' + fatte + ': ' + err.message, 'err');
      esito.innerHTML = '<div class="errore">Import interrotto dopo ' + fatte + ' note (' + srEsc(err.message) + '). Ricarica lo stesso file: riparte dalle mancanti.</div>';
    }).then(function () { dfRenderNote(); dfAggiornaContatore(); revisione(); });
  };
  r.readAsText(f);
}
if (typeof module !== 'undefined') { module.exports.dfNorm = dfNorm; module.exports.dfIdImport = dfIdImport; module.exports.dfNoteDaImport = dfNoteDaImport; module.exports.dfRiclassifica = dfRiclassifica; module.exports.dfTestoPerBK = dfTestoPerBK; }
