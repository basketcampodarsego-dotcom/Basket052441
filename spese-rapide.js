// ════════════════════════════════════════════════════════
// FILE: spese-rapide.js — ASD Basket Campodarsego
// VERSIONE: v0.13 · 20/11/2026 15:00 · BK
// v0.13: i movimenti importati da CSV (origine IMPORT_CSV_SPESE) si possono annullare da 📋 Elenco.
// v0.12: solo allineamento versione (import file anche da Download su Android).
// v0.11: solo allineamento versione (import CSV di spese).
// v0.10: solo allineamento versione (import in blocco del foglio, quote, dati da completare, copia di sicurezza).
// v0.9: scheda 🏟️ Palestra (affitti utenti, palestra-affitti.js) e avvisi in Detta.
// v0.8: solo allineamento versione (riepilogo detraibile dal dittafono).
// v0.7: solo allineamento versione (ricevute e modulo rimborso in PDF, documenti-pdf.js).
// v0.6: solo allineamento versione (presenze dettate, dittafono v0.4).
// v0.5: solo allineamento versione (dittafono v0.3 + dittafono-gestionale.js).
// v0.4: solo allineamento versione (pulsante Importa note del dittafono v0.2).
// v0.3: la pagina diventa anche DITTAFONO (dittafono.js, richiesta Alberto
//   20/11/2026): prima scheda "Detta" (salvataggio immediato della nota),
//   scheda "Note" (da elaborare / appunti / elaborate). Da una nota di spesa
//   si apre il modulo Spesa gia' compilato: al salvataggio la nota viene
//   collegata al movimento (SR.notaInElaborazione + dfDopoSalvataggioMovimento).
// v0.2: aggiunta MODIFICA di una spesa gia' registrata (richiesta Alberto
//   12/11/2026: "registro uno scontrino ma mi accorgo che ho sbagliato la
//   data"). Dall'Elenco, ✏️ Modifica riapre la spesa nel modulo: stesso
//   movimento (stesso id e numero, la foto resta), ogni cambiamento
//   tracciato nel campo modifiche[] (chi, quando, campo da -> a). Se la
//   spesa e' gia' abbinata all'estratto o gia' rimborsata, importo, tipo e
//   mezzo di pagamento restano bloccati (cambiarli romperebbe l'abbinamento:
//   in quel caso Annulla e reinserisci). Cambio di anno -> nuovo numero
//   nell'anno giusto (il vecchio resta annotato nelle modifiche).
// v0.1: creazione (richiesta Alberto 12/11/2026). Pagina standalone per:
//   1) registrare una spesa/incasso in 15 secondi: foto dello scontrino +
//      frase libera (voce o tastiera) -> riepilogo -> Salva;
//   2) controllare velocemente i movimenti di un periodo (ultimi 7/30
//      giorni, mese, da una data) con centro, mezzo di pagamento, foto e
//      confronto Palestra/Societa', stampabile;
//   3) cassa contanti: saldo teorico, conta cassa con rettifica, giroconti
//      banca<->cassa;
//   4) anticipi di Alberto (carta/contanti personali): rimborso e nota spese.
// SCRIVE NELLO STESSO ARCHIVIO del gestionale: basket052441/economia/
// movimenti (stessa forma dei movimenti di economia-movimenti-ui.js e
// dell'import banca), quindi bilancio, report, export CSV e rendiconto li
// vedono senza passaggi in piu'. Campi AGGIUNTIVI (ignorati dal resto
// dell'app, nessuna migrazione): origine, mezzoPagamento, natura,
// documento, fotoDocId, daRiconciliare, riconciliaSu, anticipatoDa,
// rimborso, giroId, fraseOriginale.
// Foto: basket052441/documentiMovimenti/{movId}/{foto|mini} (stesso schema
// di documentiAtleti: base64 compresso, niente Firebase Storage).
// Dizionario appreso: basket052441/speseRapideConfig (campo v, JSON).
// MODELLO CARTA TASCA: come l'import estratti attuale (economia-import-
// banca-ui.js), le spese con la carta Tasca vanno sul conto BANCA con
// metodoPagamento 'carta' e mezzoPagamento CARTA_TASCA (vedi
// SR_CONTO_PER_CARTA). Se un giorno la carta avra' un conto suo, basta
// filtrare per mezzoPagamento — decisione aperta, non presa qui.
// Dipende da: economia-core-DRAFT.js, spese-rapide-voce.js, Firebase compat.
// ════════════════════════════════════════════════════════

var SR_BUILD = 'v0.13 · 20/11/2026 15:00';
var SR_CONTO_PER_CARTA = 'BANCA';
var SR_CODICE_CENTRO = { PALESTRA: 'PALESTRA', SPORT: 'SPORT' }; // codici usati dai movimenti storici importati
var SR_MEZZI = {
  BONIFICO: { label: '🏦 Bonifico', breve: 'Bonifico' },
  CARTA_TASCA: { label: '💳 Carta Tasca', breve: 'Carta Tasca' },
  CONTANTI_CASSA: { label: '💶 Contanti cassa', breve: 'Cassa' },
  CARTA_PERSONALE: { label: '👤💳 Mia carta', breve: 'Carta di Alberto' },
  CONTANTI_PERSONALI: { label: '👤💶 Miei contanti', breve: 'Contanti di Alberto' }
};
var SR_NATURE = {
  FISSO: 'Costo fisso struttura',
  FUNZIONAMENTO: 'Funzionamento',
  MIGLIORIA: 'Miglioria / attrezzatura'
};
var SR_DOCUMENTI = { SCONTRINO: 'Scontrino', FATTURA: 'Fattura', RICEVUTA: 'Ricevuta', NESSUNO: 'Nessuno' };
var SR_MAX_BASE64 = 700000;
var SR_FOTO_LATO = 1600, SR_FOTO_Q = 0.68, SR_MINI_LATO = 240, SR_MINI_Q = 0.6;

var _db = null;
var SR = {
  utente: '',
  config: null,           // { categorie, sottocategorie, centriCosto }
  conti: [],
  diz: { parole: {} },
  movAnno: {},            // anno -> [movimenti]
  cassaMov: [],           // tutti i movimenti del conto cassa (tutti gli anni)
  anticipi: [],           // movimenti anticipatoDa Alberto (tutti gli anni)
  foto: null,             // { full:{base64,kb}, mini:{base64,kb} }
  s: null,                // stato del modulo Nuova
  periodo: '7',
  giroVerso: 'PRELIEVO',
  rimbModo: 'BONIFICO',
  rimbSel: {},
  salvataggioInCorso: false,
  modificaId: null,       // v0.2: id del movimento in modifica (null = nuova spesa)
  notaInElaborazione: null, // v0.3: id della nota del dittafono da cui nasce la spesa
  miniCache: {}
};

// ── LOG (mai un fallimento silenzioso) ──
function srLog(msg, tipo) {
  var panel = document.getElementById('diag-panel');
  if (panel) {
    var riga = document.createElement('div');
    riga.className = 'log-line' + (tipo === 'err' ? ' log-err' : tipo === 'ok' ? ' log-ok' : tipo === 'warn' ? ' log-warn' : '');
    riga.textContent = '[' + new Date().toTimeString().slice(0, 8) + '] ' + msg;
    panel.insertBefore(riga, panel.firstChild);
  }
  if (tipo === 'err') console.error('[spese-rapide] ' + msg);
}
window.addEventListener('error', function (e) { srLog('Errore non gestito: ' + (e.error && e.error.message || e.message), 'err'); });
window.addEventListener('unhandledrejection', function (e) { srLog('Promise non gestita: ' + (e.reason && e.reason.message || e.reason), 'err'); });

function srEl(id) { return document.getElementById(id); }
function srEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function srEuro(n) { return (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
function srR2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
// Date sempre da getter locali (bug storico UTC in operazioni-giornaliere v0.11)
function srISO(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function srOggi() { return srISO(new Date()); }
function srDataIt(iso) { if (!iso) return ''; var p = String(iso).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
function srParseImporto(s) {
  s = String(s || '').trim().replace(/€/g, '').replace(/\s/g, '');
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  var v = parseFloat(s);
  return isNaN(v) ? null : srR2(v);
}
function srFmtImportoCampo(v) { return v == null ? '' : String(v.toFixed(2)).replace('.', ','); }

// ── FIREBASE ──
var _fbConfig = {apiKey:"AIzaSyAFnQMyoIYei-9naUbY_GSLNvYNXFJBkZY",authDomain:"basket052441.firebaseapp.com",projectId:"basket052441",storageBucket:"basket052441.appspot.com",messagingSenderId:"708269881035",appId:"1:708269881035:web:62a9d32bad5de2c68d0d4e"};
function srCol() { return _db.collection('basket052441'); }
function srColMov() { return srCol().doc('economia').collection('movimenti'); }
function srColFoto(movId) { return srCol().doc('documentiMovimenti').collection(String(movId)); }

function fbInit() {
  srEl('build-badge').textContent = 'Build ' + SR_BUILD;
  try {
    if (!firebase.apps.length) firebase.initializeApp(_fbConfig);
    _db = firebase.firestore();
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function (err) { srLog('setPersistence fallita: ' + err.message, 'err'); });
    firebase.auth().onAuthStateChanged(function (user) {
      if (user) {
        SR.utente = user.email || '';
        srEl('login-scr').style.display = 'none';
        srEl('main-scr').style.display = 'block';
        srLog('Autenticato: ' + SR.utente, 'ok');
        srCaricaTutto();
      } else {
        srEl('login-scr').style.display = '';
        srEl('main-scr').style.display = 'none';
      }
    });
  } catch (e) {
    srLog('ERRORE fbInit: ' + e.message, 'err');
    alert('Errore di avvio: ' + e.message);
  }
}
function doLogin() {
  var email = srEl('login-email').value.trim(), pass = srEl('login-pass').value, errEl = srEl('login-err');
  errEl.textContent = '';
  if (!email || !pass) { errEl.textContent = 'Inserisci email e password.'; return; }
  firebase.auth().signInWithEmailAndPassword(email, pass).catch(function (err) {
    errEl.textContent = 'Accesso fallito: ' + err.message;
    srLog('Login fallito: ' + err.message, 'err');
  });
}

function srLeggiJson(snap, vuoto, nome) {
  if (!snap.exists || !snap.data().v) return vuoto;
  try { return JSON.parse(snap.data().v); } catch (ex) {
    var msg = nome + ' corrotto (' + ex.message + '): non posso procedere senza rischiare di sovrascrivere dati.';
    srLog(msg, 'err');
    throw new Error(msg);
  }
}

// ── CARICAMENTO ──
function srCaricaTutto() {
  var anno = new Date().getFullYear();
  return Promise.all([srCol().doc('economiaConfig').get(), srCol().doc('economiaConti').get(), srCol().doc('speseRapideConfig').get()])
    .then(function (r) {
      SR.config = srLeggiJson(r[0], { categorie: [], sottocategorie: [], centriCosto: [] }, 'economiaConfig');
      ['categorie', 'sottocategorie', 'centriCosto'].forEach(function (k) { if (!SR.config[k]) SR.config[k] = []; });
      SR.conti = srLeggiJson(r[1], [], 'economiaConti');
      SR.diz = srLeggiJson(r[2], { parole: {} }, 'speseRapideConfig');
      if (!SR.diz.parole) SR.diz.parole = {};
      srLog('Config: ' + SR.config.categorie.length + ' categorie, ' + SR.config.centriCosto.length + ' centri, ' + SR.conti.length + ' conti', 'ok');
      return Promise.all([srCaricaAnno(anno), srCaricaAnno(anno - 1), srCaricaCassa(), srCaricaAnticipi()]);
    })
    .then(function () {
      srControllaConfig();
      srNuova();
      srAggiornaBadgeCassa();
      srElencoAggiorna();
      if (typeof dfInit === 'function') dfInit().catch(function (err) { srLog('Dittafono: avvio fallito ' + err.message, 'err'); }); // v0.3
      if (typeof paAvvisiDetta === 'function') paAvvisiDetta(); // v0.9: avvisi affitti (dicembre / fine attivita')
    })
    .catch(function (err) {
      srLog('Caricamento fallito: ' + (err && err.message || err), 'err');
      srEl('avvisi-config').innerHTML = '<div class="page active"><div class="errore">Caricamento dati fallito: ' + srEsc(err && err.message || err) + '<br>Ricarica la pagina; se si ripete apri 🔧 e mandami la riga rossa.</div></div>';
    });
}
function srCaricaAnno(anno) {
  return srColMov().where('annoEsercizio', '==', anno).get().then(function (snap) {
    var arr = []; snap.forEach(function (d) { arr.push(d.data()); });
    SR.movAnno[anno] = arr;
    srLog('Movimenti ' + anno + ': ' + arr.length, 'ok');
    return arr;
  });
}
function srCaricaCassa() {
  var c = srConto('CASSA');
  if (!c) { SR.cassaMov = []; return Promise.resolve([]); }
  return srColMov().where('contoFinanziarioId', '==', c.id).get().then(function (snap) {
    var arr = []; snap.forEach(function (d) { arr.push(d.data()); });
    SR.cassaMov = arr;
    return arr;
  });
}
function srCaricaAnticipi() {
  return srColMov().where('anticipatoDa', '==', 'Alberto').get().then(function (snap) {
    var arr = []; snap.forEach(function (d) { arr.push(d.data()); });
    SR.anticipi = arr;
    return arr;
  });
}
function srAnnoCaricato(anno) { return SR.movAnno[anno] ? Promise.resolve(SR.movAnno[anno]) : srCaricaAnno(anno); }

// ── CONFIG: conti, centri, categorie ──
function srConto(tipo) { return (SR.conti || []).find(function (c) { return c.tipo === tipo && c.attivo !== false; }) || null; }
function srCentroAttivo(codice) { return (SR.config.centriCosto || []).some(function (c) { return c.codice === codice && c.attivo !== false; }); }
function srCategorieAttive() { return (SR.config.categorie || []).filter(function (c) { return c.attivo !== false; }); }
function srNomeCategoria(cod) {
  var c = (SR.config && SR.config.categorie || []).find(function (k) { return k.codice === cod; });
  return c ? c.descrizione : (cod || '—');
}
function srCentroDi(m) {
  var c = String(m.centroCostoCodice || '').toUpperCase();
  if (c === 'PALESTRA') return 'PALESTRA';
  if (c === 'SPORT') return 'SPORT';
  return c ? 'ALTRO' : 'NESSUNO';
}

function srControllaConfig() {
  var h = '';
  var mancaCentri = ['PALESTRA', 'SPORT'].filter(function (c) { return !srCentroAttivo(c); });
  if (mancaCentri.length) {
    h += '<div class="errore">Mancano i centri di costo <b>' + mancaCentri.join(' e ') + '</b> nella tabella codici. Sono i codici usati dai movimenti già importati: senza, Palestra e Società non si possono separare.' +
      '<br><button class="btn-gold btn-sm" style="margin-top:6px" onclick="srCreaCentri()">Crea ' + mancaCentri.join(' e ') + '</button></div>';
  }
  if (!srConto('CASSA')) h += '<div class="errore">Non esiste un conto di tipo <b>Cassa</b>: i pagamenti in contanti non si possono registrare.<br><button class="btn-gold btn-sm" style="margin-top:6px" onclick="srCreaContoCassa()">Crea conto "Cassa contanti"</button></div>';
  if (!srConto('BANCA')) h += '<div class="errore">Non esiste un conto di tipo <b>Banca</b>: bonifici e carta Tasca non si possono registrare. Crealo dal gestionale (Economia → Conti).</div>';
  srEl('avvisi-config').innerHTML = h ? '<div class="page active" style="padding-bottom:0">' + h + '</div>' : '';
}

// Lettura-modifica-scrittura di economiaConfig (rilegge PRIMA di scrivere, per non perdere modifiche fatte altrove)
function srModificaConfig(fn) {
  return srCol().doc('economiaConfig').get().then(function (snap) {
    var cfg = srLeggiJson(snap, { categorie: [], sottocategorie: [], centriCosto: [] }, 'economiaConfig');
    ['categorie', 'sottocategorie', 'centriCosto'].forEach(function (k) { if (!cfg[k]) cfg[k] = []; });
    var esito = fn(cfg);
    if (esito && esito.ok === false) throw new Error(esito.errore);
    return srCol().doc('economiaConfig').set({ v: JSON.stringify(cfg) }).then(function () { SR.config = cfg; return esito; });
  });
}
function srCreaCentri() {
  srModificaConfig(function (cfg) {
    var seed = { PALESTRA: 'Gestione palestra comunale', SPORT: 'Attività agonistica e minibasket' };
    ['PALESTRA', 'SPORT'].forEach(function (cod) {
      var es = cfg.centriCosto.find(function (c) { return c.codice === cod; });
      if (es) { es.attivo = true; return; }
      var r = ecoNuovoCodice(cfg.centriCosto, cod, seed[cod], {});
      if (r.ok) cfg.centriCosto.push(r.record);
    });
    return { ok: true };
  }).then(function () { srLog('Centri PALESTRA/SPORT pronti', 'ok'); srControllaConfig(); srRenderForm(); })
    .catch(function (err) { srLog('Creazione centri fallita: ' + err.message, 'err'); alert('Creazione centri fallita: ' + err.message); });
}
function srCreaContoCassa() {
  srCol().doc('economiaConti').get().then(function (snap) {
    var conti = srLeggiJson(snap, [], 'economiaConti');
    if (conti.some(function (c) { return c.tipo === 'CASSA' && c.attivo !== false; })) { SR.conti = conti; return; }
    conti.push({ id: ecoNewId('CONTO'), nome: 'Cassa contanti', tipo: 'CASSA', attivo: true, saldoInizialeEsercizio: {} });
    return srCol().doc('economiaConti').set({ v: JSON.stringify(conti) }).then(function () { SR.conti = conti; });
  }).then(function () { srLog('Conto cassa pronto', 'ok'); srControllaConfig(); return srCaricaCassa(); })
    .then(function () { srAggiornaBadgeCassa(); })
    .catch(function (err) { srLog('Creazione conto cassa fallita: ' + err.message, 'err'); alert('Creazione conto cassa fallita: ' + err.message); });
}
// Crea una categoria (dopo conferma di Alberto). Ritorna Promise<codice>.
function srCreaCategoria(codice, descrizione, tipo) {
  return srModificaConfig(function (cfg) {
    var r = ecoNuovoCodice(cfg.categorie, codice, descrizione, { tipo: tipo || null });
    if (!r.ok) return r;
    cfg.categorie.push(r.record);
    return { ok: true, codice: r.record.codice };
  }).then(function (esito) { srLog('Categoria creata: ' + esito.codice + ' — ' + descrizione, 'ok'); return esito.codice; });
}
// Categoria tecnica (rettifica cassa, giroconto): la crea solo dopo conferma
function srCategoriaTecnica(codici, descRe, nuova) {
  var att = srCategorieAttive();
  for (var i = 0; i < codici.length; i++) if (att.some(function (c) { return c.codice === codici[i]; })) return Promise.resolve(codici[i]);
  var perDesc = att.find(function (c) { return descRe.test(srNorm(c.descrizione)); });
  if (perDesc) return Promise.resolve(perDesc.codice);
  if (!confirm('Serve la categoria "' + nuova.descrizione + '" (' + nuova.codice + '), che non esiste ancora. La creo?')) return Promise.reject(new Error('Categoria "' + nuova.codice + '" non creata: operazione annullata'));
  return srCreaCategoria(nuova.codice, nuova.descrizione, null);
}

// ── CASSA: saldo teorico, stessa logica del Bilancio (ecoRepCalcolaLiquidita) ──
function srSaldoCassa() {
  var c = srConto('CASSA');
  if (!c) return null;
  var anno = new Date().getFullYear();
  function flusso(lista) {
    var s = 0;
    lista.forEach(function (m) {
      if (m.stato !== 'PAGATO' && m.stato !== 'PARZIALE') return;
      s += (m.tipoMovimento === 'ENTRATA' ? 1 : -1) * (Number(m.importoEur) || 0);
    });
    return srR2(s);
  }
  var dich = c.saldoInizialeEsercizio && c.saldoInizialeEsercizio[anno] != null ? Number(c.saldoInizialeEsercizio[anno]) : null;
  var prec = flusso(SR.cassaMov.filter(function (m) { return parseInt(m.annoEsercizio, 10) < anno; }));
  var inizio = dich != null ? dich : prec;
  var annoCorr = flusso(SR.cassaMov.filter(function (m) { return parseInt(m.annoEsercizio, 10) === anno; }));
  var futuri = SR.cassaMov.some(function (m) { return parseInt(m.annoEsercizio, 10) > anno; });
  return { saldo: srR2(inizio + annoCorr), inizio: inizio, fonte: dich != null ? 'saldo di inizio anno dichiarato' : 'calcolato dallo storico', futuri: futuri };
}
function srAggiornaBadgeCassa() {
  var s = srSaldoCassa();
  srEl('cassa-badge').textContent = s ? 'Cassa: ' + srEuro(s.saldo) : 'Cassa: —';
  srEl('cassa-badge').style.color = s && s.saldo < 0 ? 'var(--err)' : '';
}

// ════════ NUOVA SPESA ════════
function srStatoVuoto() {
  return { tipoMov: 'USCITA', importo: null, candidatiImporto: [], data: srOggi(), centro: null, categoria: null, categorieAmbigue: [],
    propostaCategoria: null, mezzo: null, personale: false, natura: null, documento: null, descrizione: '', frase: '', parole: [] };
}
function srNuova() {
  SR.s = srStatoVuoto();
  SR.foto = null;
  SR.modificaId = null;
  SR.notaInElaborazione = null;
  srEl('banner-modifica').innerHTML = '';
  srEl('btn-salva').innerHTML = '💾 Salva';
  srEl('frase').value = '';
  srEl('foto-prev').style.display = 'none';
  srEl('foto-prev').removeAttribute('src');
  srEl('esito-salva').innerHTML = '';
  srEl('domande').innerHTML = '';
  srRenderForm();
}
function srSetTipoMov(v) {
  SR.s.tipoMov = v;
  if (v === 'ENTRATA' && SR.s.mezzo && /PERSONAL|CARTA_TASCA/.test(SR.s.mezzo)) SR.s.mezzo = null;
  srRenderForm();
}

function srRenderChips(id, opzioni, valore, onclickFn, classiExtra) {
  srEl(id).innerHTML = opzioni.map(function (o) {
    var cls = 'chip' + (o.v === valore ? ' sel' : '') + (classiExtra && classiExtra[o.v] ? ' ' + classiExtra[o.v] : '');
    return '<button class="' + cls + '" onclick="' + onclickFn + '(\'' + o.v + '\')">' + srEsc(o.l) + '</button>';
  }).join('');
}

function srRenderForm() {
  var s = SR.s;
  document.querySelectorAll('#tipo-mov .chip').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-v') === s.tipoMov); });
  srEl('f-importo').value = s.importo != null ? srFmtImportoCampo(s.importo) : srEl('f-importo').value;
  if (s.importo == null && document.activeElement !== srEl('f-importo')) srEl('f-importo').value = '';
  srEl('f-data').value = s.data;
  var blocco = !!(s.bloccati && s.bloccati.importo); // v0.2: spesa abbinata/rimborsata
  srEl('f-importo').disabled = blocco;
  document.querySelectorAll('#tipo-mov .chip').forEach(function (b) { b.disabled = blocco; });
  srRenderChips('f-centro', [{ v: 'PALESTRA', l: '🏟️ Palestra' }, { v: 'SPORT', l: '🏀 Società' }], s.centro, 'srSetCentro', { PALESTRA: 'pal', SPORT: 'soc' });
  var mezzi = s.tipoMov === 'ENTRATA' ? ['CONTANTI_CASSA', 'BONIFICO'] : ['BONIFICO', 'CARTA_TASCA', 'CONTANTI_CASSA', 'CARTA_PERSONALE', 'CONTANTI_PERSONALI'];
  if (s.personale && !s.mezzo) mezzi = ['CARTA_PERSONALE', 'CONTANTI_PERSONALI'].concat(mezzi.filter(function (m) { return !/PERSONAL/.test(m); }));
  srRenderChips('f-mezzo', mezzi.map(function (m) { return { v: m, l: SR_MEZZI[m].label }; }), s.mezzo, 'srSetMezzo');
  if (blocco) srEl('f-mezzo').querySelectorAll('.chip').forEach(function (b) { b.disabled = true; });
  srEl('blocco-natura').style.display = s.centro === 'PALESTRA' && s.tipoMov === 'USCITA' ? '' : 'none';
  srRenderChips('f-natura', Object.keys(SR_NATURE).map(function (k) { return { v: k, l: SR_NATURE[k] }; }), s.natura, 'srSetNatura');
  srRenderChips('f-documento', Object.keys(SR_DOCUMENTI).map(function (k) { return { v: k, l: SR_DOCUMENTI[k] }; }), s.documento, 'srSetDocumento');
  srEl('f-categoria-label').innerHTML = s.categoria ? srEsc(srNomeCategoria(s.categoria)) : '<span style="color:var(--err)">da scegliere</span>';
  if (document.activeElement !== srEl('f-descrizione')) srEl('f-descrizione').value = s.descrizione;
  ['f-centro', 'f-mezzo'].forEach(function (id) {
    var manca = id === 'f-centro' ? !s.centro : !s.mezzo;
    srEl(id).querySelectorAll('.chip').forEach(function (b) { b.classList.toggle('manca', manca); });
  });
  srRenderRiepilogo();
}
function srRenderRiepilogo() {
  var s = SR.s;
  var segno = s.tipoMov === 'ENTRATA' ? '+' : '−';
  var imp = s.importo != null ? segno + ' ' + srEuro(s.importo) : '<span style="color:var(--muted)">importo?</span>';
  var righe = [
    s.categoria ? srEsc(srNomeCategoria(s.categoria)) : '<span style="color:var(--err)">voce?</span>',
    s.centro === 'PALESTRA' ? '🏟️ Palestra' : s.centro === 'SPORT' ? '🏀 Società' : '<span style="color:var(--err)">centro?</span>',
    s.mezzo ? SR_MEZZI[s.mezzo].breve : '<span style="color:var(--err)">pagato con?</span>',
    srDataIt(s.data)
  ];
  srEl('riepilogo').innerHTML = '<div class="riep-imp">' + imp + '</div><div class="riep-riga">' + righe.join(' · ') + '</div>' +
    (SR.foto ? '<div class="riep-riga">📷 foto allegata (' + SR.foto.full.kb + ' KB)</div>' : '');
}
function srSetCentro(v) { SR.s.centro = v; srRenderForm(); srRenderDomande(); }
function srSetMezzo(v) { SR.s.mezzo = v; srRenderForm(); srRenderDomande(); }
function srSetNatura(v) { SR.s.natura = SR.s.natura === v ? null : v; srRenderForm(); }
function srSetDocumento(v) { SR.s.documento = SR.s.documento === v ? null : v; srRenderForm(); }
function srDaCampi() {
  SR.s.importo = srParseImporto(srEl('f-importo').value);
  SR.s.data = srEl('f-data').value || srOggi();
  SR.s.descrizione = srEl('f-descrizione').value;
  srRenderRiepilogo();
}

// ── Interpretazione della frase ──
function srInterpretaDaCampo() { srApplicaFrase(srEl('frase').value); }
function srApplicaFrase(frase) {
  frase = String(frase || '').trim();
  if (!frase) return;
  var r = srInterpreta(frase, { oggiISO: srOggi(), diz: SR.diz, categorieAttive: srCategorieAttive() });
  var s = SR.s;
  s.frase = frase;
  s.parole = r.parole;
  if (r.tipoMov) s.tipoMov = r.tipoMov;
  if (r.importo != null) s.importo = r.importo;
  s.candidatiImporto = r.importo == null ? r.candidatiImporto : [];
  if (r.data) s.data = r.data;
  if (r.mezzo) s.mezzo = r.mezzo;
  s.personale = r.personale;
  if (r.centro) s.centro = r.centro;
  if (r.natura) s.natura = r.natura;
  if (r.documento) s.documento = r.documento; else if (SR.foto && !s.documento) s.documento = 'SCONTRINO';
  s.categoria = r.categoria;
  s.categorieAmbigue = r.categorieAmbigue;
  s.propostaCategoria = r.propostaCategoria;
  s.descrizione = frase;
  srLog('Frase: "' + frase + '" → importo=' + r.importo + ' mezzo=' + r.mezzo + ' centro=' + r.centro + ' voce=' + r.categoria +
    (r.categorieAmbigue.length ? ' (ambigua: ' + r.categorieAmbigue.join(',') + ')' : '') + (r.propostaCategoria ? ' (proposta: ' + r.propostaCategoria.codice + ')' : ''), 'info');
  srRenderForm();
  srRenderDomande();
}

// Domande su cio' che manca o e' ambiguo — sempre esplicite, mai una scelta silenziosa
function srRenderDomande() {
  var s = SR.s, h = '';
  if (s.importo == null && s.candidatiImporto.length > 1) {
    h += '<div class="domanda">Ho sentito più numeri: qual è l\'importo?<div class="chips">' +
      s.candidatiImporto.map(function (v) { return '<button class="chip" onclick="srScegliImporto(' + v + ')">' + srEuro(v) + '</button>'; }).join('') + '</div></div>';
  } else if (s.importo == null && s.frase) {
    h += '<div class="domanda">Non ho capito l\'importo: scrivilo nel campo Importo.</div>';
  }
  if (!s.categoria && s.frase) {
    var parola = (s.parole[0] || '').toString();
    if (s.categorieAmbigue.length) {
      h += '<div class="domanda">Più voci possibili: quale?<div class="chips">' +
        s.categorieAmbigue.map(function (c) { return '<button class="chip" onclick="srScegliCategoria(\'' + c + '\')">' + srEsc(srNomeCategoria(c)) + '</button>'; }).join('') +
        (s.propostaCategoria ? '<button class="chip" onclick="srCreaProposta()">➕ ' + srEsc(s.propostaCategoria.descrizione) + ' (nuova)</button>' : '') +
        '<button class="chip" onclick="srApriSceltaCategoria(null)">Altra…</button></div></div>';
    } else if (s.propostaCategoria) {
      h += '<div class="domanda">Non c\'è ancora una voce per «' + srEsc(parola) + '». Creo <b>' + srEsc(s.propostaCategoria.descrizione) + '</b>?' +
        '<div class="chips"><button class="chip sel" onclick="srCreaProposta()">Sì, creala</button><button class="chip" onclick="srApriSceltaCategoria(null)">No, scelgo io</button></div></div>';
    } else {
      h += '<div class="domanda">Non conosco «' + srEsc(parola || s.frase) + '»: a quale voce va? La prossima volta lo riconosco da solo.' +
        '<div class="chips"><button class="chip sel" onclick="srApriSceltaCategoria(null)">Scegli la voce</button></div></div>';
    }
  }
  if (!s.centro && s.frase) h += '<div class="domanda">È una spesa della <b>palestra</b> o della <b>società</b>? Tocca qui sotto, nel campo Centro.</div>';
  if (!s.mezzo && s.frase) h += '<div class="domanda">' + (s.personale ? 'Pagata da te: con la <b>tua carta</b> o con i <b>tuoi contanti</b>?' : 'Come l\'hai pagata? Scegli in "Pagato con".') + '</div>';
  srEl('domande').innerHTML = h;
}
function srScegliImporto(v) { SR.s.importo = v; SR.s.candidatiImporto = []; srRenderForm(); srRenderDomande(); }
function srScegliCategoria(cod) {
  SR.s.categoria = cod; SR.s.categorieAmbigue = []; SR.s.propostaCategoria = null;
  var chooser = srEl('scelta-categoria'); if (chooser) chooser.remove();
  srRenderForm(); srRenderDomande();
}
function srCreaProposta() {
  var p = SR.s.propostaCategoria;
  if (!p) return;
  srCreaCategoria(p.codice, p.descrizione, SR.s.tipoMov).then(function (cod) { srScegliCategoria(cod); })
    .catch(function (err) { srLog('Creazione categoria fallita: ' + err.message, 'err'); alert('Non ho creato la voce: ' + err.message); });
}
function srApriSceltaCategoria() {
  var vecchio = srEl('scelta-categoria'); if (vecchio) vecchio.remove();
  var tipo = SR.s.tipoMov;
  var lista = srCategorieAttive().filter(function (c) { return !c.tipo || c.tipo === tipo; })
    .sort(function (a, b) { return srNorm(a.descrizione).localeCompare(srNorm(b.descrizione)); });
  var parola = SR.s.parole[0] || '';
  var box = document.createElement('div');
  box.id = 'scelta-categoria';
  box.className = 'domanda';
  box.innerHTML = 'Scegli la voce' + (parola ? ' per «' + srEsc(parola) + '»' : '') + ':' +
    '<div class="chips cat-list">' + lista.map(function (c) {
      return '<button class="chip' + (c.codice === SR.s.categoria ? ' sel' : '') + '" onclick="srScegliCategoria(\'' + c.codice + '\')">' + srEsc(c.descrizione) + '</button>';
    }).join('') + '</div>' +
    '<label>Oppure nuova voce</label><div style="display:flex;gap:6px"><input id="nuova-cat-desc" placeholder="es. Carburante" style="margin:0" value="' + srEsc(parola ? parola.charAt(0).toUpperCase() + parola.slice(1) : '') + '">' +
    '<button class="btn-gold" onclick="srCreaDaCampo()">Crea</button></div>';
  srEl('domande').appendChild(box);
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function srCreaDaCampo() {
  var desc = srEl('nuova-cat-desc').value.trim();
  if (!desc) { alert('Scrivi il nome della nuova voce.'); return; }
  var codice = srNorm(desc).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20);
  if (!codice) { alert('Nome non valido.'); return; }
  srCreaCategoria(codice, desc, SR.s.tipoMov).then(function (cod) { srScegliCategoria(cod); })
    .catch(function (err) { srLog('Creazione categoria fallita: ' + err.message, 'err'); alert('Non ho creato la voce: ' + err.message); });
}

// ── VOCE (Web Speech API, Chrome Android) ──
var srRiconoscitore = null;
function srAscolta() {
  var SRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SRec) {
    srLog('SpeechRecognition non disponibile in questo browser', 'warn');
    alert('Il riconoscimento vocale non è disponibile in questo browser. Tocca il campo di testo e usa il microfono della tastiera.');
    srEl('frase').focus();
    return;
  }
  if (srRiconoscitore) { srRiconoscitore.stop(); return; }
  var rec = new SRec();
  rec.lang = 'it-IT'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
  var btn = srEl('mic-btn');
  btn.classList.add('ascolto');
  btn.innerHTML = '<span class="ico">⏺️</span>Ascolto…';
  var finale = '';
  rec.onresult = function (ev) {
    var tx = '';
    for (var i = ev.resultIndex; i < ev.results.length; i++) {
      tx += ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finale += ev.results[i][0].transcript;
    }
    srEl('frase').value = finale || tx;
  };
  rec.onerror = function (ev) {
    srLog('Riconoscimento vocale: errore ' + ev.error, 'err');
    if (ev.error === 'not-allowed') alert('Permesso microfono negato: abilitalo per questa pagina nelle impostazioni del browser.');
    else if (ev.error !== 'no-speech' && ev.error !== 'aborted') alert('Riconoscimento vocale non riuscito (' + ev.error + '). Puoi scrivere o dettare con la tastiera.');
  };
  rec.onend = function () {
    srRiconoscitore = null;
    btn.classList.remove('ascolto');
    btn.innerHTML = '<span class="ico">🎤</span>Parla';
    var testo = srEl('frase').value.trim();
    if (testo) srApplicaFrase(testo);
  };
  try { rec.start(); srRiconoscitore = rec; } catch (ex) {
    srLog('Avvio riconoscimento fallito: ' + ex.message, 'err');
    btn.classList.remove('ascolto'); btn.innerHTML = '<span class="ico">🎤</span>Parla';
  }
}

// ── FOTO: compressione come documenti-atleta-upload.js (testata su foto reali) ──
function srComprimi(file, lato, qualita) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error('Errore lettura file ' + file.name)); };
    reader.onload = function (e) {
      var img = new Image();
      img.onerror = function () { reject(new Error('Il file non è un\'immagine valida (' + file.name + ')')); };
      img.onload = function () {
        try {
          var sc = Math.min(1, lato / Math.max(img.width, img.height));
          var w = Math.round(img.width * sc), h = Math.round(img.height * sc);
          var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          var ctx = cv.getContext('2d');
          if (!ctx) { reject(new Error('Elaborazione immagine non disponibile su questo dispositivo')); return; }
          ctx.drawImage(img, 0, 0, w, h);
          var b64 = (cv.toDataURL('image/jpeg', qualita).split(',')[1]) || '';
          if (!b64) { reject(new Error('Compressione fallita')); return; }
          resolve({ base64: b64, kb: Math.round(b64.length * 0.75 / 1024), w: w, h: h });
        } catch (ex) { reject(ex); }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
function srPreparaFoto(file) {
  return Promise.all([srComprimi(file, SR_FOTO_LATO, SR_FOTO_Q), srComprimi(file, SR_MINI_LATO, SR_MINI_Q)]).then(function (r) {
    if (r[0].base64.length > SR_MAX_BASE64) throw new Error('Foto troppo grande anche dopo la compressione (' + r[0].kb + ' KB)');
    srLog('Foto compressa: ' + Math.round(file.size / 1024) + ' KB → ' + r[0].kb + ' KB (+ miniatura ' + r[1].kb + ' KB)', 'ok');
    return { full: r[0], mini: r[1] };
  });
}
function srFotoScelta(inp) {
  var f = inp.files && inp.files[0];
  inp.value = '';
  if (!f) return;
  srPreparaFoto(f).then(function (foto) {
    SR.foto = foto;
    var prev = srEl('foto-prev');
    prev.src = 'data:image/jpeg;base64,' + foto.mini.base64;
    prev.style.display = 'block';
    if (!SR.s.documento) SR.s.documento = 'SCONTRINO';
    // foto dalla galleria: proponi la data dello scatto (modificabile)
    if (f.lastModified && !SR.s.frase) {
      var d = new Date(f.lastModified);
      if (srISO(d) !== srOggi() && d.getTime() < Date.now()) SR.s.data = srISO(d);
    }
    srRenderForm();
  }).catch(function (err) { srLog('Foto: ' + err.message, 'err'); alert('Foto non utilizzabile: ' + err.message); });
}

// ── Costruzione del movimento (stessa forma dei movimenti del gestionale) ──
function srCostruisciMovimento(s, anticipoComeCassa) {
  var adesso = new Date().toISOString();
  var anno = parseInt(s.data.slice(0, 4), 10);
  var m = {
    id: ecoNewId('MOV'), tipoMovimento: s.tipoMov, importoEur: srR2(s.importo),
    categoriaCodice: s.categoria, sottocategoriaCodice: null, centroCostoCodice: SR_CODICE_CENTRO[s.centro] || null,
    contoFinanziarioId: null, dataDocumento: s.data, dataScadenza: null, annoEsercizio: anno, numeroDocumento: null,
    note: (s.descrizione || '').substring(0, 300) || null, stato: 'PAGATO', dataPagamento: s.data, metodoPagamento: null,
    riferimentoBancario: null, dataRegistrazione: adesso, createdAt: adesso, createdBy: SR.utente, updatedAt: adesso, updatedBy: SR.utente,
    origine: 'SPESA_RAPIDA', mezzoPagamento: s.mezzo, natura: s.centro === 'PALESTRA' && s.tipoMov === 'USCITA' ? (s.natura || null) : null,
    documento: s.documento || null, fotoDocId: null, daRiconciliare: false, riconciliaSu: null, anticipatoDa: null, fraseOriginale: s.frase || null
  };
  var banca = srConto('BANCA'), cassa = srConto('CASSA');
  switch (s.mezzo) {
    case 'BONIFICO':
      m.contoFinanziarioId = banca && banca.id; m.metodoPagamento = 'bonifico'; m.daRiconciliare = true; m.riconciliaSu = 'BANCA'; break;
    case 'CARTA_TASCA':
      m.contoFinanziarioId = (srConto(SR_CONTO_PER_CARTA) || {}).id || null; m.metodoPagamento = 'carta'; m.daRiconciliare = true; m.riconciliaSu = 'CARTA'; break;
    case 'CONTANTI_CASSA':
      m.contoFinanziarioId = cassa && cassa.id; m.metodoPagamento = 'contanti'; break;
    case 'CARTA_PERSONALE':
    case 'CONTANTI_PERSONALI':
      m.stato = 'DA_PAGARE'; m.dataPagamento = null; m.metodoPagamento = null; m.anticipatoDa = 'Alberto'; break;
    default: break;
  }
  return m;
}

function srValidaForm(s) {
  var err = [];
  if (s.importo == null || !(s.importo > 0)) err.push('importo');
  if (!s.categoria) err.push('voce di spesa');
  if (!s.centro) err.push('centro (Palestra o Società)');
  if (!s.mezzo) err.push('come è stata pagata');
  if (!s.data) err.push('data');
  return err;
}

function srSalva() {
  if (SR.salvataggioInCorso) return;
  if (SR.modificaId) { srSalvaModifica(); return; } // v0.2
  srDaCampi();
  var s = SR.s;
  var esito = srEl('esito-salva');
  var mancano = srValidaForm(s);
  if (mancano.length) { esito.innerHTML = '<div class="errore">Manca: ' + mancano.join(', ') + '.</div>'; return; }
  if (s.mezzo === 'CONTANTI_CASSA' && s.tipoMov === 'USCITA') {
    var sc = srSaldoCassa();
    if (sc && s.importo > sc.saldo + 0.004) {
      var tuoi = confirm('In cassa risultano ' + srEuro(sc.saldo) + ', meno di ' + srEuro(s.importo) + '.\n\nOK = l\'hai pagata con soldi TUOI (da rimborsarti)\nAnnulla = dalla cassa comunque (poi fai una conta cassa)');
      if (tuoi) s.mezzo = 'CONTANTI_PERSONALI';
    }
  }
  var m = srCostruisciMovimento(s);
  if ((s.mezzo === 'BONIFICO' || s.mezzo === 'CARTA_TASCA' || s.mezzo === 'CONTANTI_CASSA') && !m.contoFinanziarioId) {
    esito.innerHTML = '<div class="errore">Manca il conto ' + (s.mezzo === 'CONTANTI_CASSA' ? 'Cassa' : 'Banca') + ' (vedi avviso in alto).</div>'; return;
  }
  SR.salvataggioInCorso = true;
  srEl('btn-salva').disabled = true;
  esito.innerHTML = '<div class="domanda">Salvataggio…</div>';
  srAnnoCaricato(m.annoEsercizio).then(function (movAnno) {
    m.numeroMovimento = ecoNextNumeroMovimento(movAnno, m.annoEsercizio);
    var v = ecoValidaMovimento(m, SR.config, {});
    if (!v.valido) throw new Error('Movimento non valido: ' + v.errori.join(', '));
    var batch = _db.batch();
    if (SR.foto) {
      m.fotoDocId = 'foto';
      batch.set(srColFoto(m.id).doc('foto'), { mimeType: 'image/jpeg', base64: SR.foto.full.base64, kb: SR.foto.full.kb, caricatoIl: new Date().toISOString(), caricatoDa: SR.utente });
      batch.set(srColFoto(m.id).doc('mini'), { mimeType: 'image/jpeg', base64: SR.foto.mini.base64, kb: SR.foto.mini.kb });
    }
    batch.set(srColMov().doc(m.id), m);
    return batch.commit();
  }).then(function () {
    srRegistraInCache(m);
    if (SR.notaInElaborazione && typeof dfDopoSalvataggioMovimento === 'function') dfDopoSalvataggioMovimento(SR.notaInElaborazione, m); // v0.3
    if (SR.foto) SR.miniCache[m.id] = SR.foto.mini.base64;
    srLog('Salvato ' + m.numeroMovimento + ' ' + m.tipoMovimento + ' ' + m.importoEur + ' ' + m.categoriaCodice + ' ' + m.centroCostoCodice + ' ' + m.mezzoPagamento, 'ok');
    srImparaESalva(s);
    var nota = m.anticipatoDa ? ' — da rimborsarti' : m.daRiconciliare ? ' — si abbinerà all\'estratto ' + (m.riconciliaSu === 'CARTA' ? 'carta' : 'banca') : '';
    var msg = '✅ Salvato ' + srEsc(m.numeroMovimento) + ': ' + srEuro(m.importoEur) + ' · ' + srEsc(srNomeCategoria(m.categoriaCodice)) + nota;
    srNuova();
    srEl('esito-salva').innerHTML = '<div class="ok-msg">' + msg + '</div>';
    srAggiornaBadgeCassa();
  }).catch(function (err) {
    srLog('Salvataggio fallito: ' + (err && err.message || err), 'err');
    esito.innerHTML = '<div class="errore">NON salvato: ' + srEsc(err && err.message || err) + '<br>I dati sono ancora qui: riprova.</div>';
  }).then(function () { SR.salvataggioInCorso = false; srEl('btn-salva').disabled = false; });
}
function srRegistraInCache(m) {
  var arr = SR.movAnno[m.annoEsercizio] || (SR.movAnno[m.annoEsercizio] = []);
  var i = arr.findIndex(function (x) { return x.id === m.id; });
  if (i >= 0) arr[i] = m; else arr.push(m);
  var cassa = srConto('CASSA');
  var j = SR.cassaMov.findIndex(function (x) { return x.id === m.id; });
  if (cassa && m.contoFinanziarioId === cassa.id) { if (j >= 0) SR.cassaMov[j] = m; else SR.cassaMov.push(m); }
  else if (j >= 0) SR.cassaMov.splice(j, 1);
  var k = SR.anticipi.findIndex(function (x) { return x.id === m.id; });
  if (m.anticipatoDa) { if (k >= 0) SR.anticipi[k] = m; else SR.anticipi.push(m); }
}
function srImparaESalva(s) {
  if (!s.parole || !s.parole.length) return;
  srImpara(SR.diz, s.parole, { categoria: s.categoria, centro: s.centro, natura: s.natura });
  srCol().doc('speseRapideConfig').set({ v: JSON.stringify(SR.diz) })
    .then(function () { srLog('Dizionario aggiornato: ' + s.parole.join(', '), 'ok'); })
    .catch(function (err) { srLog('Dizionario NON salvato (la spesa sì): ' + err.message, 'warn'); });
}

// ════════ ELENCO / CONTROLLO VELOCE ════════
function srGoTab(tab) {
  document.querySelectorAll('.nav-tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === tab); });
  document.querySelectorAll('.page[id^="page-"]').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + tab); });
  if (tab === 'elenco') srElencoAggiorna();
  if (tab === 'cassa') srRenderCassa();
  if (tab === 'rimborsi') srRenderRimborsi();
  if (tab === 'note' && typeof dfRenderNote === 'function') dfRenderNote(); // v0.3
  if (tab === 'palestra' && typeof paRender === 'function') paRender(); // v0.9
}
function srSetPeriodo(v) {
  SR.periodo = v;
  document.querySelectorAll('#el-periodo .chip').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-v') === v); });
  srEl('el-da-box').style.display = v === 'DA' ? '' : 'none';
  if (v === 'DA' && !srEl('el-da').value) { var d = new Date(); d.setDate(d.getDate() - 14); srEl('el-da').value = srISO(d); }
  srElencoAggiorna();
}
function srIntervallo() {
  var oggi = new Date(), da;
  if (SR.periodo === '7' || SR.periodo === '30') { da = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate() - (parseInt(SR.periodo, 10) - 1)); return { da: srISO(da), a: srOggi(), label: 'ultimi ' + SR.periodo + ' giorni' }; }
  if (SR.periodo === 'MESE') { da = new Date(oggi.getFullYear(), oggi.getMonth(), 1); return { da: srISO(da), a: srOggi(), label: 'questo mese' }; }
  var v = srEl('el-da').value || srOggi();
  return { da: v, a: '9999-12-31', label: 'dal ' + srDataIt(v) };
}
function srElencoAggiorna() {
  var iv = srIntervallo();
  var anni = [];
  for (var y = parseInt(iv.da.slice(0, 4), 10); y <= new Date().getFullYear(); y++) anni.push(y);
  Promise.all(anni.map(srAnnoCaricato)).then(srRenderElenco)
    .catch(function (err) { srLog('Elenco: caricamento fallito ' + err.message, 'err'); srEl('el-lista').innerHTML = '<div class="errore">Caricamento fallito: ' + srEsc(err.message) + '</div>'; });
}
function srMovimentiPeriodo() {
  var iv = srIntervallo(), out = [];
  Object.keys(SR.movAnno).forEach(function (a) {
    SR.movAnno[a].forEach(function (m) { var d = m.dataDocumento || ''; if (d >= iv.da && d <= iv.a) out.push(m); });
  });
  return out.sort(function (a, b) { return (b.dataDocumento || '').localeCompare(a.dataDocumento || '') || (b.createdAt || '').localeCompare(a.createdAt || ''); });
}
function srMezzoDi(m) {
  if (m.mezzoPagamento && SR_MEZZI[m.mezzoPagamento]) return m.mezzoPagamento;
  var conto = (SR.conti || []).find(function (c) { return c.id === m.contoFinanziarioId; });
  if (conto && conto.tipo === 'CASSA') return 'CONTANTI_CASSA';
  if (m.metodoPagamento === 'carta') return 'CARTA_TASCA';
  if (conto && conto.tipo === 'BANCA') return 'BONIFICO';
  return null;
}
function srEtichettaMezzo(m) {
  var k = srMezzoDi(m);
  if (k) return SR_MEZZI[k].breve;
  return m.metodoPagamento || '—';
}
function srFiltra(lista) {
  var f = srEl('el-filtro').value;
  return lista.filter(function (m) {
    if (f === 'PALESTRA' || f === 'SPORT') return srCentroDi(m) === f;
    if (f === 'ATTESA') return m.daRiconciliare && m.stato !== 'ANNULLATO';
    if (f === 'NOFOTO') return m.tipoMovimento === 'USCITA' && !m.fotoDocId && m.stato !== 'ANNULLATO' && (srNorm(srNomeCategoria(m.categoriaCodice)).indexOf('giroconto') < 0);
    return true;
  });
}
// Confronto Palestra/Societa': conta i movimenti non annullati del periodo.
// Gli anticipi non ancora rimborsati sono spese REALI gia' fatte: entrano
// nelle uscite del periodo (riga a parte), anche se in Bilancio (cassa)
// compariranno solo al rimborso. Giroconti e rettifiche esclusi dal confronto.
function srCalcolaConfronto(lista) {
  var c = { PALESTRA: { e: 0, u: 0, att: 0 }, SPORT: { e: 0, u: 0, att: 0 }, ALTRO: { e: 0, u: 0, att: 0 } };
  var mezzi = {};
  lista.forEach(function (m) {
    if (m.stato === 'ANNULLATO') return;
    var nomeCat = srNorm(srNomeCategoria(m.categoriaCodice));
    if (/giroconto|rettific/.test(nomeCat) || /GIROCONTO|RETT/.test(m.categoriaCodice || '')) return;
    var k = srCentroDi(m); if (k !== 'PALESTRA' && k !== 'SPORT') k = 'ALTRO';
    var imp = Number(m.importoEur) || 0;
    if (m.tipoMovimento === 'ENTRATA') c[k].e += imp;
    else { c[k].u += imp; if (m.anticipatoDa && m.stato === 'DA_PAGARE') c[k].att += imp; }
    if (m.tipoMovimento === 'USCITA') { var mz = srEtichettaMezzo(m); mezzi[mz] = (mezzi[mz] || 0) + imp; }
  });
  return { centri: c, mezzi: mezzi };
}
function srHtmlConfronto(conf) {
  var c = conf.centri;
  function cel(v, cls) { return '<td class="' + (cls || '') + '">' + srEuro(v) + '</td>'; }
  var altro = c.ALTRO.e || c.ALTRO.u;
  var h = '<table class="conf"><tr><th></th><th>🏟️ Palestra</th><th>🏀 Società</th>' + (altro ? '<th>Altro</th>' : '') + '</tr>';
  h += '<tr><td>Entrate</td>' + cel(c.PALESTRA.e, 'pos') + cel(c.SPORT.e, 'pos') + (altro ? cel(c.ALTRO.e) : '') + '</tr>';
  h += '<tr><td>Uscite</td>' + cel(c.PALESTRA.u, 'neg') + cel(c.SPORT.u, 'neg') + (altro ? cel(c.ALTRO.u) : '') + '</tr>';
  if (c.PALESTRA.att || c.SPORT.att || c.ALTRO.att) h += '<tr><td>di cui da rimborsare ad Alberto</td>' + cel(c.PALESTRA.att) + cel(c.SPORT.att) + (altro ? cel(c.ALTRO.att) : '') + '</tr>';
  function saldo(x) { var v = srR2(x.e - x.u); return '<td class="' + (v < 0 ? 'neg' : 'pos') + '">' + (v > 0 ? '+' : '') + srEuro(v) + '</td>'; }
  h += '<tr class="saldo"><td>Saldo</td>' + saldo(c.PALESTRA) + saldo(c.SPORT) + (altro ? saldo(c.ALTRO) : '') + '</tr></table>';
  return h;
}
function srHtmlMezzi(conf) {
  var k = Object.keys(conf.mezzi);
  if (!k.length) return '';
  return '<div class="card-desc" style="margin-bottom:10px">Uscite per mezzo di pagamento: ' +
    k.sort(function (a, b) { return conf.mezzi[b] - conf.mezzi[a]; }).map(function (x) { return '<b>' + srEsc(x) + '</b> ' + srEuro(conf.mezzi[x]); }).join(' · ') + '</div>';
}
function srRenderElenco() {
  var tutti = srMovimentiPeriodo();
  var lista = srFiltra(tutti);
  var conf = srCalcolaConfronto(lista);
  srEl('el-confronto').innerHTML = srHtmlConfronto(conf);
  srEl('el-mezzi').innerHTML = srHtmlMezzi(conf);
  if (!lista.length) { srEl('el-lista').innerHTML = '<div class="empty">Nessun movimento nel periodo (' + srEsc(srIntervallo().label) + ').</div>'; return; }
  srEl('el-lista').innerHTML = lista.map(srHtmlRiga).join('');
  lista.forEach(function (m) { if (m.fotoDocId) srCaricaMini(m.id); });
}
function srHtmlRiga(m) {
  var cen = srCentroDi(m);
  var segno = m.tipoMovimento === 'ENTRATA' ? '+' : '−';
  var badge = '';
  if (cen === 'PALESTRA') badge += '<span class="badge b-pal">Palestra</span>';
  else if (cen === 'SPORT') badge += '<span class="badge b-soc">Società</span>';
  else badge += '<span class="badge" style="background:var(--bg2);color:var(--muted)">' + (cen === 'NESSUNO' ? 'senza centro' : srEsc(m.centroCostoCodice)) + '</span>';
  badge += '<span class="badge" style="background:var(--bg2);color:var(--text)">' + srEsc(srEtichettaMezzo(m)) + '</span>';
  if (m.stato === 'ANNULLATO') badge += '<span class="badge" style="background:#333;color:#aaa">ANNULLATO</span>';
  else if (m.anticipatoDa && m.stato === 'DA_PAGARE') badge += '<span class="badge b-rimb">da rimborsare</span>';
  else if (m.anticipatoDa && m.rimborso) badge += '<span class="badge b-ok">rimborsato ' + srDataIt(m.rimborso.data) + '</span>';
  if (m.daRiconciliare && m.stato !== 'ANNULLATO') badge += '<span class="badge b-att">attesa ' + (m.riconciliaSu === 'CARTA' ? 'estratto carta' : 'estratto banca') + '</span>';
  if (m.natura) badge += '<span class="badge" style="background:var(--bg2);color:var(--muted)">' + srEsc(SR_NATURE[m.natura] || m.natura) + '</span>';
  var thumb = m.fotoDocId
    ? '<img class="mov-thumb" id="mini-' + m.id + '" alt="" onclick="srApriFoto(\'' + m.id + '\')" src="' + (SR.miniCache[m.id] ? 'data:image/jpeg;base64,' + SR.miniCache[m.id] : '') + '">'
    : '<div class="mov-thumb" title="nessun documento">' + (m.tipoMovimento === 'USCITA' ? '📄' : '·') + '</div>';
  var azioni = '<button class="btn-gray btn-sm" onclick="srAllegaFoto(\'' + m.id + '\')">' + (m.fotoDocId ? '📷 Sostituisci' : '📎 Foto') + '</button> ';
  if (srModificabile(m)) azioni += '<button class="btn-gray btn-sm" onclick="srApriModifica(\'' + m.id + '\')">✏️ Modifica</button> ';
  if (srAnnullabile(m)) azioni += '<button class="btn-red btn-sm" onclick="srAnnulla(\'' + m.id + '\')">Annulla</button>';
  return '<div class="mov' + (m.stato === 'ANNULLATO' ? ' annullato' : '') + '">' + thumb + '<div class="mov-body">' +
    '<div class="mov-top"><span>' + srDataIt(m.dataDocumento) + ' · ' + srEsc(srNomeCategoria(m.categoriaCodice)) + '</span>' +
    '<span class="' + (m.tipoMovimento === 'ENTRATA' ? 'pos' : 'neg') + '">' + segno + ' ' + srEuro(m.importoEur) + '</span></div>' +
    '<div class="mov-desc">' + srEsc(m.note || '') + '</div><div>' + badge + '</div>' +
    '<div style="margin-top:6px">' + azioni + '</div></div></div>';
}
// ── v0.2: MODIFICA di una spesa registrata da questa pagina ──
function srModificabile(m) {
  return m.stato !== 'ANNULLATO' && m.origine === 'SPESA_RAPIDA';
}
function srBloccata(m) { return !!(m.riconciliatoIl || m.rimborso); }
function srApriModifica(id) {
  var m = srTrovaMov(id);
  if (!m || !srModificabile(m)) { srLog('srApriModifica: movimento ' + id + ' non modificabile o non trovato', 'err'); return; }
  srNuova();
  SR.modificaId = id;
  var cen = srCentroDi(m);
  var blocc = srBloccata(m);
  SR.s = { tipoMov: m.tipoMovimento, importo: Number(m.importoEur), candidatiImporto: [], data: m.dataDocumento, centro: cen === 'PALESTRA' || cen === 'SPORT' ? cen : null,
    categoria: m.categoriaCodice, categorieAmbigue: [], propostaCategoria: null, mezzo: srMezzoDi(m), personale: false, natura: m.natura || null,
    documento: m.documento || null, descrizione: m.note || '', frase: '', parole: [], bloccati: { importo: blocc } };
  srEl('frase').value = '';
  if (m.fotoDocId) {
    var mostra = function (b64) { var prev = srEl('foto-prev'); prev.src = 'data:image/jpeg;base64,' + b64; prev.style.display = 'block'; };
    if (SR.miniCache[id]) mostra(SR.miniCache[id]);
    else srColFoto(id).doc('mini').get().then(function (d) { if (d.exists) { SR.miniCache[id] = d.data().base64; mostra(SR.miniCache[id]); } })
      .catch(function (err) { srLog('Miniatura in modifica: ' + err.message, 'warn'); });
  }
  srEl('banner-modifica').innerHTML = '<div class="domanda">✏️ Stai modificando <b>' + srEsc(m.numeroMovimento) + '</b> del ' + srDataIt(m.dataDocumento) + '.' +
    (blocc ? '<br>Già ' + (m.rimborso ? 'rimborsata' : 'abbinata all\'estratto') + ': importo e pagamento non si cambiano (se sono sbagliati: Annulla e reinserisci).' : '') +
    ' Una nuova foto sostituisce quella attuale.<div class="chips"><button class="chip" onclick="srNuova()">Annulla modifica</button></div></div>';
  srEl('btn-salva').innerHTML = '💾 Salva modifiche';
  srGoTab('nuova');
  srRenderForm();
  window.scrollTo(0, 0);
}
function srSalvaModifica() {
  srDaCampi();
  var s = SR.s, esito = srEl('esito-salva');
  var orig = srTrovaMov(SR.modificaId);
  if (!orig) { esito.innerHTML = '<div class="errore">Spesa da modificare non trovata: ricarica la pagina.</div>'; return; }
  var mancano = srValidaForm(s);
  if (mancano.length) { esito.innerHTML = '<div class="errore">Manca: ' + mancano.join(', ') + '.</div>'; return; }
  var blocc = srBloccata(orig);
  var t = srCostruisciMovimento(s); // modello dei campi derivati (conto, stato, ...) — id e date di creazione NON usati
  var nuovo = JSON.parse(JSON.stringify(orig));
  ['categoriaCodice', 'centroCostoCodice', 'dataDocumento', 'annoEsercizio', 'note', 'natura', 'documento'].forEach(function (k) { nuovo[k] = t[k]; });
  if (!blocc) {
    nuovo.tipoMovimento = t.tipoMovimento; nuovo.importoEur = t.importoEur;
    if (t.mezzoPagamento !== srMezzoDi(orig)) {
      ['contoFinanziarioId', 'stato', 'dataPagamento', 'metodoPagamento', 'daRiconciliare', 'riconciliaSu', 'anticipatoDa', 'mezzoPagamento'].forEach(function (k) { nuovo[k] = t[k]; });
    } else if (nuovo.stato === 'PAGATO' && !nuovo.anticipatoDa) {
      nuovo.dataPagamento = t.dataDocumento;
    }
    if (nuovo.contoFinanziarioId == null && nuovo.stato === 'PAGATO') { esito.innerHTML = '<div class="errore">Manca il conto per il pagamento scelto (vedi avviso in alto).</div>'; return; }
  }
  var campi = {};
  ['tipoMovimento', 'importoEur', 'categoriaCodice', 'centroCostoCodice', 'dataDocumento', 'note', 'natura', 'documento', 'mezzoPagamento', 'stato', 'contoFinanziarioId'].forEach(function (k) {
    if (JSON.stringify(orig[k] == null ? null : orig[k]) !== JSON.stringify(nuovo[k] == null ? null : nuovo[k])) campi[k] = { da: orig[k] == null ? null : orig[k], a: nuovo[k] == null ? null : nuovo[k] };
  });
  if (SR.foto) campi.foto = { da: orig.fotoDocId ? 'presente' : null, a: 'nuova' };
  if (!Object.keys(campi).length) { esito.innerHTML = '<div class="domanda">Nessuna modifica da salvare.</div>'; return; }
  var annoVecchio = parseInt(orig.annoEsercizio, 10), annoNuovo = parseInt(nuovo.annoEsercizio, 10);
  SR.salvataggioInCorso = true; srEl('btn-salva').disabled = true;
  esito.innerHTML = '<div class="domanda">Salvataggio modifiche…</div>';
  srAnnoCaricato(annoNuovo).then(function (movAnno) {
    if (annoNuovo !== annoVecchio) {
      campi.numeroMovimento = { da: orig.numeroMovimento, a: null };
      nuovo.numeroMovimento = ecoNextNumeroMovimento(movAnno, annoNuovo);
      campi.numeroMovimento.a = nuovo.numeroMovimento;
    }
    var adesso = new Date().toISOString();
    nuovo.updatedAt = adesso; nuovo.updatedBy = SR.utente;
    nuovo.modifiche = (orig.modifiche || []).concat([{ il: adesso, da: SR.utente, campi: campi }]);
    var v = ecoValidaMovimento(nuovo, SR.config, {});
    if (!v.valido) throw new Error('Movimento non valido: ' + v.errori.join(', '));
    var b = _db.batch();
    if (SR.foto) {
      nuovo.fotoDocId = 'foto'; if (!nuovo.documento) nuovo.documento = 'SCONTRINO';
      b.set(srColFoto(nuovo.id).doc('foto'), { mimeType: 'image/jpeg', base64: SR.foto.full.base64, kb: SR.foto.full.kb, caricatoIl: adesso, caricatoDa: SR.utente });
      b.set(srColFoto(nuovo.id).doc('mini'), { mimeType: 'image/jpeg', base64: SR.foto.mini.base64, kb: SR.foto.mini.kb });
    }
    b.set(srColMov().doc(nuovo.id), nuovo);
    return b.commit();
  }).then(function () {
    if (annoNuovo !== annoVecchio && SR.movAnno[annoVecchio]) SR.movAnno[annoVecchio] = SR.movAnno[annoVecchio].filter(function (x) { return x.id !== nuovo.id; });
    if (!nuovo.anticipatoDa) SR.anticipi = SR.anticipi.filter(function (x) { return x.id !== nuovo.id; });
    Object.keys(orig).forEach(function (k) { if (!(k in nuovo)) delete orig[k]; });
    Object.assign(orig, nuovo);
    srRegistraInCache(orig);
    if (SR.foto) SR.miniCache[nuovo.id] = SR.foto.mini.base64;
    if (campi.categoriaCodice || campi.centroCostoCodice) srImparaESalva({ parole: srParoleContenuto(nuovo.note || ''), categoria: s.categoria, centro: s.centro, natura: s.natura });
    srLog('Modificato ' + nuovo.numeroMovimento + ': ' + Object.keys(campi).join(', '), 'ok');
    var msg = '✅ Modificato ' + srEsc(nuovo.numeroMovimento) + ': ' + Object.keys(campi).map(function (k) { return { dataDocumento: 'data', importoEur: 'importo', categoriaCodice: 'voce', centroCostoCodice: 'centro', mezzoPagamento: 'pagamento', note: 'descrizione', natura: 'natura', documento: 'documento', foto: 'foto', numeroMovimento: 'numero (cambio anno)', tipoMovimento: 'tipo', stato: 'stato', contoFinanziarioId: 'conto' }[k] || k; }).join(', ');
    srNuova();
    srEl('esito-salva').innerHTML = '<div class="ok-msg">' + msg + '</div>';
    srAggiornaBadgeCassa();
  }).catch(function (err) {
    srLog('Modifica fallita: ' + (err && err.message || err), 'err');
    esito.innerHTML = '<div class="errore">Modifica NON salvata: ' + srEsc(err && err.message || err) + '</div>';
  }).then(function () { SR.salvataggioInCorso = false; srEl('btn-salva').disabled = false; });
}

function srAnnullabile(m) {
  return m.stato !== 'ANNULLATO' && /^(SPESA_RAPIDA|CONTA_CASSA|GIROCONTO_RAPIDO|IMPORT_CSV_SPESE)$/.test(m.origine || '') && !m.rimborso && !m.riconciliatoIl;
}
function srCaricaMini(id) {
  if (SR.miniCache[id]) return;
  srColFoto(id).doc('mini').get().then(function (d) {
    if (!d.exists) { srLog('Miniatura assente per ' + id, 'warn'); return; }
    SR.miniCache[id] = d.data().base64;
    var el = srEl('mini-' + id); if (el) el.src = 'data:image/jpeg;base64,' + SR.miniCache[id];
  }).catch(function (err) { srLog('Miniatura ' + id + ': ' + err.message, 'warn'); });
}
function srApriFoto(id) {
  srColFoto(id).doc('foto').get().then(function (d) {
    if (!d.exists) { alert('Foto non trovata.'); return; }
    srEl('lightbox-img').src = 'data:image/jpeg;base64,' + d.data().base64;
    srEl('lightbox').style.display = 'flex';
  }).catch(function (err) { srLog('Foto ' + id + ': ' + err.message, 'err'); alert('Foto non caricata: ' + err.message); });
}
function srTrovaMov(id) {
  var trovato = null;
  Object.keys(SR.movAnno).forEach(function (a) { var m = SR.movAnno[a].find(function (x) { return x.id === id; }); if (m) trovato = m; });
  return trovato || SR.anticipi.find(function (x) { return x.id === id; }) || SR.cassaMov.find(function (x) { return x.id === id; }) || null;
}
// Allega/sostituisce la foto di QUALSIASI movimento (anche importato dall'estratto)
function srAllegaFoto(id) {
  var m = srTrovaMov(id);
  if (!m) { srLog('srAllegaFoto: movimento ' + id + ' non trovato', 'err'); return; }
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = function () {
    var f = inp.files && inp.files[0]; if (!f) return;
    srPreparaFoto(f).then(function (foto) {
      var agg = JSON.parse(JSON.stringify(m));
      agg.fotoDocId = 'foto'; agg.documento = agg.documento || 'SCONTRINO';
      agg.updatedAt = new Date().toISOString(); agg.updatedBy = SR.utente;
      var b = _db.batch();
      b.set(srColFoto(id).doc('foto'), { mimeType: 'image/jpeg', base64: foto.full.base64, kb: foto.full.kb, caricatoIl: new Date().toISOString(), caricatoDa: SR.utente });
      b.set(srColFoto(id).doc('mini'), { mimeType: 'image/jpeg', base64: foto.mini.base64, kb: foto.mini.kb });
      b.set(srColMov().doc(id), agg);
      return b.commit().then(function () { Object.assign(m, agg); SR.miniCache[id] = foto.mini.base64; srRegistraInCache(m); srLog('Foto allegata a ' + (m.numeroMovimento || id), 'ok'); srRenderElenco(); });
    }).catch(function (err) { srLog('Foto non allegata: ' + err.message, 'err'); alert('Foto non allegata: ' + err.message); });
  };
  inp.click();
}
function srAnnulla(id) {
  var m = srTrovaMov(id);
  if (!m || !srAnnullabile(m)) return;
  var motivo = prompt('Motivo dell\'annullamento (obbligatorio):');
  if (motivo === null) return;
  var coppia = m.giroId ? srTuttiMov().filter(function (x) { return x.giroId === m.giroId && x.id !== m.id && x.stato !== 'ANNULLATO'; }) : [];
  var copie = [m].concat(coppia).map(function (x) { return JSON.parse(JSON.stringify(x)); });
  var b = _db.batch(), errore = null;
  copie.forEach(function (c) {
    var r = ecoAnnullaMovimento(c, motivo, SR.utente);
    if (!r.ok) errore = r.errore;
    c.daRiconciliare = false;
    b.set(srColMov().doc(c.id), c);
  });
  if (errore) { alert(errore); return; }
  b.commit().then(function () {
    copie.forEach(function (c) { var orig = srTrovaMov(c.id); if (orig) Object.assign(orig, c); srRegistraInCache(orig || c); });
    srLog('Annullato ' + copie.map(function (c) { return c.numeroMovimento; }).join(', ') + ': ' + motivo, 'ok');
    srAggiornaBadgeCassa(); srRenderElenco();
  }).catch(function (err) { srLog('Annullamento fallito: ' + err.message, 'err'); alert('Annullamento fallito: ' + err.message); });
}
function srTuttiMov() {
  var out = []; Object.keys(SR.movAnno).forEach(function (a) { out = out.concat(SR.movAnno[a]); }); return out;
}

// ── STAMPA (R3: numero pagina progressivo + totale pagine) ──
function srApriStampa(titolo, corpo) {
  var base = location.href.replace(/[^/]*$/, '');
  var html = '<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><base href="' + base + '"><title>' + srEsc(titolo) + '</title><style>' +
    '@page{size:A4;margin:14mm 12mm 16mm;@bottom-right{content:"pag. " counter(page) " di " counter(pages);font-size:9pt;color:#555;}@bottom-left{content:"ASD Basket Campodarsego — ' + srEsc(titolo).replace(/"/g, '') + '";font-size:9pt;color:#555;}}' +
    'body{font-family:Arial,sans-serif;font-size:10pt;color:#111;} h1{font-size:14pt;margin:0 0 2px;} .sub{color:#555;margin-bottom:10px;}' +
    'table{width:100%;border-collapse:collapse;margin:8px 0 14px;} th,td{border-bottom:1px solid #ccc;padding:4px 5px;text-align:left;vertical-align:top;} th{background:#eee;font-size:9pt;}' +
    'td.n,th.n{text-align:right;white-space:nowrap;} tr{page-break-inside:avoid;} .tot td{font-weight:bold;border-top:2px solid #333;} .logo{height:42px;float:right;}' +
    '</style></head><body><img class="logo" src="logo.jpg" alt="">' + corpo + '</body></html>';
  var w = window.open('', '_blank');
  if (!w) { srLog('Stampa: finestra bloccata dal browser', 'err'); alert('Il browser ha bloccato la finestra di stampa: consenti i popup per questa pagina e riprova.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
  w.onload = function () { try { w.focus(); w.print(); } catch (ex) { srLog('Stampa: ' + ex.message, 'err'); } };
}
function srStampaElenco() {
  var iv = srIntervallo();
  var lista = srFiltra(srMovimentiPeriodo());
  var conf = srCalcolaConfronto(lista);
  var c = conf.centri;
  var filtro = srEl('el-filtro').options[srEl('el-filtro').selectedIndex].text;
  var corpo = '<h1>Movimenti — ' + srEsc(iv.label) + '</h1><div class="sub">' + srDataIt(iv.da) + (iv.a < '9999' ? ' – ' + srDataIt(iv.a) : ' – oggi') + ' · ' + srEsc(filtro) + ' · stampato il ' + srDataIt(srOggi()) + '</div>' +
    '<table><tr><th></th><th class="n">Palestra</th><th class="n">Società</th></tr>' +
    '<tr><td>Entrate</td><td class="n">' + srEuro(c.PALESTRA.e) + '</td><td class="n">' + srEuro(c.SPORT.e) + '</td></tr>' +
    '<tr><td>Uscite</td><td class="n">' + srEuro(c.PALESTRA.u) + '</td><td class="n">' + srEuro(c.SPORT.u) + '</td></tr>' +
    '<tr class="tot"><td>Saldo</td><td class="n">' + srEuro(c.PALESTRA.e - c.PALESTRA.u) + '</td><td class="n">' + srEuro(c.SPORT.e - c.SPORT.u) + '</td></tr></table>' +
    (c.ALTRO.e || c.ALTRO.u ? '<div class="sub">Movimenti senza centro Palestra/Società: entrate ' + srEuro(c.ALTRO.e) + ', uscite ' + srEuro(c.ALTRO.u) + '.</div>' : '') +
    '<table><tr><th>Data</th><th>N.</th><th>Voce</th><th>Centro</th><th>Pagato con</th><th>Descrizione</th><th>Doc.</th><th class="n">Importo</th></tr>' +
    lista.map(function (m) {
      var cen = srCentroDi(m);
      return '<tr' + (m.stato === 'ANNULLATO' ? ' style="color:#999;text-decoration:line-through"' : '') + '><td>' + srDataIt(m.dataDocumento) + '</td><td>' + srEsc((m.numeroMovimento || '').replace(/^MOV-/, '')) + '</td><td>' + srEsc(srNomeCategoria(m.categoriaCodice)) + '</td><td>' +
        (cen === 'PALESTRA' ? 'Palestra' : cen === 'SPORT' ? 'Società' : '—') + '</td><td>' + srEsc(srEtichettaMezzo(m)) + (m.anticipatoDa && m.stato === 'DA_PAGARE' ? ' (da rimb.)' : '') + '</td><td>' + srEsc((m.note || '').slice(0, 90)) + '</td><td>' +
        (m.fotoDocId ? 'sì' : '') + '</td><td class="n">' + (m.tipoMovimento === 'ENTRATA' ? '+' : '−') + ' ' + srEuro(m.importoEur) + '</td></tr>';
    }).join('') + '</table>';
  srApriStampa('Movimenti ' + iv.label, corpo);
}

// ════════ CASSA ════════
function srRenderCassa() {
  var s = srSaldoCassa();
  if (!s) { srEl('cassa-saldo').innerHTML = '<div class="errore">Nessun conto Cassa (vedi avviso in alto).</div>'; srEl('cassa-lista').innerHTML = ''; return; }
  var uc = SR.diz.ultimaConta;
  srEl('cassa-saldo').innerHTML = '<div class="riep-imp' + (s.saldo < 0 ? ' neg' : '') + '">' + srEuro(s.saldo) + '</div>' +
    '<div class="riep-riga">Saldo teorico: ' + srEsc(s.fonte) + ' + movimenti di quest\'anno.</div>' +
    (uc ? '<div class="riep-riga">Ultima conta: ' + srDataIt(uc.data) + ', contati ' + srEuro(uc.reale) + (uc.differenza ? ' (rettifica ' + (uc.differenza > 0 ? '+' : '') + srEuro(uc.differenza) + ')' : ' (coincideva)') + '</div>'
      : '<div class="riep-riga" style="color:var(--warn)">Nessuna conta registrata: falla adesso, diventa la base di partenza.</div>') +
    (s.saldo < 0 ? '<div class="errore">Saldo negativo: c\'è sicuramente un movimento di cassa mancante o registrato male. Fai una conta.</div>' : '');
  srEl('giro-data').value = srEl('giro-data').value || srOggi();
  var ult = SR.cassaMov.slice().sort(function (a, b) { return (b.dataDocumento || '').localeCompare(a.dataDocumento || ''); }).slice(0, 15);
  srEl('cassa-lista').innerHTML = ult.length ? ult.map(srHtmlRiga).join('') : '<div class="empty">Nessun movimento di cassa.</div>';
  ult.forEach(function (m) { if (m.fotoDocId) srCaricaMini(m.id); });
}
function srContaCassa() {
  var reale = srParseImporto(srEl('conta-reale').value);
  var esito = srEl('conta-esito');
  if (reale == null || reale < 0) { esito.innerHTML = '<div class="errore">Scrivi quanti contanti hai contato.</div>'; return; }
  var s = srSaldoCassa(); if (!s) { esito.innerHTML = '<div class="errore">Manca il conto Cassa.</div>'; return; }
  var diff = srR2(reale - s.saldo);
  var nota = srEl('conta-nota').value.trim();
  var registraConta = function (differenza) {
    SR.diz.ultimaConta = { data: srOggi(), reale: reale, teorico: s.saldo, differenza: differenza, utente: SR.utente };
    return srCol().doc('speseRapideConfig').set({ v: JSON.stringify(SR.diz) });
  };
  if (Math.abs(diff) < 0.005) {
    registraConta(0).then(function () { esito.innerHTML = '<div class="ok-msg">✅ Coincide: ' + srEuro(reale) + '.</div>'; srRenderCassa(); })
      .catch(function (err) { srLog('Conta: ' + err.message, 'err'); esito.innerHTML = '<div class="errore">Conta non salvata: ' + srEsc(err.message) + '</div>'; });
    return;
  }
  if (!confirm('Teorico ' + srEuro(s.saldo) + ', contati ' + srEuro(reale) + ': differenza ' + (diff > 0 ? '+' : '') + srEuro(diff) + '.\nRegistro la rettifica?')) return;
  srCategoriaTecnica(['RETTCASSA', 'RETTIFICA_CASSA'], /rettific/, { codice: 'RETTCASSA', descrizione: 'Rettifica di cassa (differenza conta)' }).then(function (cod) {
    var anno = new Date().getFullYear();
    return srAnnoCaricato(anno).then(function (movAnno) {
      var adesso = new Date().toISOString();
      var m = { id: ecoNewId('MOV'), tipoMovimento: diff > 0 ? 'ENTRATA' : 'USCITA', importoEur: Math.abs(diff), categoriaCodice: cod, sottocategoriaCodice: null, centroCostoCodice: null,
        contoFinanziarioId: srConto('CASSA').id, dataDocumento: srOggi(), dataScadenza: null, annoEsercizio: anno, numeroDocumento: null,
        note: 'Conta cassa: contati ' + srEuro(reale) + ', teorico ' + srEuro(s.saldo) + (nota ? ' — ' + nota : ''), stato: 'PAGATO', dataPagamento: srOggi(), metodoPagamento: 'contanti',
        riferimentoBancario: null, dataRegistrazione: adesso, createdAt: adesso, createdBy: SR.utente, updatedAt: adesso, updatedBy: SR.utente,
        origine: 'CONTA_CASSA', mezzoPagamento: 'CONTANTI_CASSA', natura: null, documento: null, fotoDocId: null, daRiconciliare: false, riconciliaSu: null, anticipatoDa: null };
      m.numeroMovimento = ecoNextNumeroMovimento(movAnno, anno);
      var v = ecoValidaMovimento(m, SR.config, {});
      if (!v.valido) throw new Error(v.errori.join(', '));
      return srColMov().doc(m.id).set(m).then(function () { srRegistraInCache(m); return registraConta(diff); });
    });
  }).then(function () {
    esito.innerHTML = '<div class="ok-msg">✅ Rettifica registrata: ' + (diff > 0 ? '+' : '') + srEuro(diff) + '. Cassa ora ' + srEuro(reale) + '.</div>';
    srEl('conta-reale').value = ''; srEl('conta-nota').value = '';
    srAggiornaBadgeCassa(); srRenderCassa();
  }).catch(function (err) { srLog('Conta cassa: ' + err.message, 'err'); esito.innerHTML = '<div class="errore">Non registrata: ' + srEsc(err.message) + '</div>'; });
}
function srSetGiroVerso(v) { SR.giroVerso = v; document.querySelectorAll('#giro-verso .chip').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-v') === v); }); }
// Giroconto banca<->cassa: due movimenti GIROCONTO collegati da giroId. Il
// lato banca resta "in attesa" finche' l'import dell'estratto non lo abbina.
function srGiroconto() {
  var imp = srParseImporto(srEl('giro-importo').value), data = srEl('giro-data').value || srOggi();
  var esito = srEl('giro-esito');
  var banca = srConto('BANCA'), cassa = srConto('CASSA');
  if (!(imp > 0)) { esito.innerHTML = '<div class="errore">Importo mancante.</div>'; return; }
  if (!banca || !cassa) { esito.innerHTML = '<div class="errore">Servono un conto Banca e un conto Cassa.</div>'; return; }
  if (SR.giroVerso === 'VERSAMENTO') { var sc = srSaldoCassa(); if (sc && imp > sc.saldo + 0.004 && !confirm('In cassa risultano solo ' + srEuro(sc.saldo) + '. Registro comunque?')) return; }
  srCategoriaTecnica(['GIROCONTO'], /giroconto|spostament/, { codice: 'GIROCONTO', descrizione: 'Spostamenti tra conti propri (banca/cassa/carta)' }).then(function (cod) {
    var anno = parseInt(data.slice(0, 4), 10);
    return srAnnoCaricato(anno).then(function (movAnno) {
      var giroId = ecoNewId('GIRO'), adesso = new Date().toISOString(), prel = SR.giroVerso === 'PRELIEVO';
      function mov(conto, tipo, extra) {
        var m = { id: ecoNewId('MOV'), tipoMovimento: tipo, importoEur: imp, categoriaCodice: cod, sottocategoriaCodice: null, centroCostoCodice: null, contoFinanziarioId: conto.id,
          dataDocumento: data, dataScadenza: null, annoEsercizio: anno, numeroDocumento: null, note: (prel ? 'Prelievo banca → cassa' : 'Versamento cassa → banca'), stato: 'PAGATO', dataPagamento: data,
          metodoPagamento: conto.tipo === 'CASSA' ? 'contanti' : 'bonifico', riferimentoBancario: null, dataRegistrazione: adesso, createdAt: adesso, createdBy: SR.utente, updatedAt: adesso, updatedBy: SR.utente,
          origine: 'GIROCONTO_RAPIDO', mezzoPagamento: conto.tipo === 'CASSA' ? 'CONTANTI_CASSA' : 'BONIFICO', natura: null, documento: null, fotoDocId: null, daRiconciliare: false, riconciliaSu: null, anticipatoDa: null, giroId: giroId };
        return Object.assign(m, extra || {});
      }
      var lb = mov(banca, prel ? 'USCITA' : 'ENTRATA', { daRiconciliare: true, riconciliaSu: 'BANCA' });
      var lc = mov(cassa, prel ? 'ENTRATA' : 'USCITA');
      lb.numeroMovimento = ecoNextNumeroMovimento(movAnno, anno);
      lc.numeroMovimento = ecoNextNumeroMovimento(movAnno.concat([lb]), anno);
      [lb, lc].forEach(function (m) { var v = ecoValidaMovimento(m, SR.config, {}); if (!v.valido) throw new Error(v.errori.join(', ')); });
      var b = _db.batch(); b.set(srColMov().doc(lb.id), lb); b.set(srColMov().doc(lc.id), lc);
      return b.commit().then(function () { srRegistraInCache(lb); srRegistraInCache(lc); });
    });
  }).then(function () {
    esito.innerHTML = '<div class="ok-msg">✅ ' + (SR.giroVerso === 'PRELIEVO' ? 'Prelievo' : 'Versamento') + ' di ' + srEuro(imp) + ' registrato.</div>';
    srEl('giro-importo').value = ''; srAggiornaBadgeCassa(); srRenderCassa();
  }).catch(function (err) { srLog('Giroconto: ' + err.message, 'err'); esito.innerHTML = '<div class="errore">Non registrato: ' + srEsc(err.message) + '</div>'; });
}

// ════════ RIMBORSI ════════
function srAnticipiAperti() {
  return SR.anticipi.filter(function (m) { return m.stato === 'DA_PAGARE'; }).sort(function (a, b) { return (a.dataDocumento || '').localeCompare(b.dataDocumento || ''); });
}
function srSetRimbModo(v) { SR.rimbModo = v; document.querySelectorAll('#rimb-modo .chip').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-v') === v); }); }
function srRenderRimborsi() {
  var aperti = srAnticipiAperti();
  var tot = aperti.reduce(function (s, m) { return s + (Number(m.importoEur) || 0); }, 0);
  var sel = aperti.filter(function (m) { return SR.rimbSel[m.id]; }).reduce(function (s, m) { return s + (Number(m.importoEur) || 0); }, 0);
  srEl('rimb-totale').innerHTML = '<div class="riep-imp">' + srEuro(tot) + '</div><div class="riep-riga">' + aperti.length + ' spese da rimborsare · selezionate ' + srEuro(sel) + '</div>';
  srEl('rimb-lista').innerHTML = aperti.length ? aperti.map(function (m) {
    return '<label class="mov" style="cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;color:var(--text)"><input type="checkbox" style="width:22px;height:22px;margin:4px 0" ' + (SR.rimbSel[m.id] ? 'checked' : '') +
      ' onchange="SR.rimbSel[\'' + m.id + '\']=this.checked;srRenderRimborsi()"><div class="mov-body"><div class="mov-top"><span>' + srDataIt(m.dataDocumento) + ' · ' + srEsc(srNomeCategoria(m.categoriaCodice)) + '</span><span>' + srEuro(m.importoEur) + '</span></div>' +
      '<div class="mov-desc">' + srEsc(SR_MEZZI[m.mezzoPagamento] ? SR_MEZZI[m.mezzoPagamento].breve : '') + ' · ' + srEsc(m.note || '') + '</div></div></label>';
  }).join('') : '<div class="empty">Nessuna spesa da rimborsare.</div>';
  srEl('nota-mese').value = srEl('nota-mese').value || srOggi().slice(0, 7);
}
function srRimborsa() {
  var scelti = srAnticipiAperti().filter(function (m) { return SR.rimbSel[m.id]; });
  var esito = srEl('rimb-esito');
  if (!scelti.length) { esito.innerHTML = '<div class="errore">Seleziona almeno una spesa.</div>'; return; }
  var totale = srR2(scelti.reduce(function (s, m) { return s + (Number(m.importoEur) || 0); }, 0));
  var conto = SR.rimbModo === 'BONIFICO' ? srConto('BANCA') : srConto('CASSA');
  if (!conto) { esito.innerHTML = '<div class="errore">Manca il conto ' + (SR.rimbModo === 'BONIFICO' ? 'Banca' : 'Cassa') + '.</div>'; return; }
  if (SR.rimbModo === 'CONTANTI') { var sc = srSaldoCassa(); if (sc && totale > sc.saldo + 0.004 && !confirm('In cassa risultano ' + srEuro(sc.saldo) + ', meno del rimborso (' + srEuro(totale) + '). Registro comunque?')) return; }
  if (!confirm('Rimborso ad Alberto di ' + srEuro(totale) + ' (' + scelti.length + ' spese) con ' + (SR.rimbModo === 'BONIFICO' ? 'bonifico' : 'contanti dalla cassa') + '. Confermi?')) return;
  var gruppo = { gruppoId: ecoNewId('RIMB'), totale: totale, data: srOggi(), modo: SR.rimbModo, spese: scelti.length };
  var copie = scelti.map(function (m) {
    var c = JSON.parse(JSON.stringify(m));
    c.stato = 'PAGATO'; c.dataPagamento = srOggi(); c.contoFinanziarioId = conto.id;
    c.metodoPagamento = SR.rimbModo === 'BONIFICO' ? 'bonifico' : 'contanti';
    c.rimborso = gruppo;
    // con bonifico: l'estratto banca mostrera' UN solo bonifico per il totale -> l'import lo abbina al gruppo
    c.daRiconciliare = SR.rimbModo === 'BONIFICO'; c.riconciliaSu = SR.rimbModo === 'BONIFICO' ? 'BANCA' : null;
    c.updatedAt = new Date().toISOString(); c.updatedBy = SR.utente;
    return c;
  });
  for (var i = 0; i < copie.length; i++) {
    var v = ecoValidaMovimento(copie[i], SR.config, {});
    if (!v.valido) { esito.innerHTML = '<div class="errore">' + srEsc(copie[i].numeroMovimento) + ' non valido: ' + srEsc(v.errori.join(', ')) + '</div>'; return; }
  }
  var b = _db.batch();
  copie.forEach(function (c) { b.set(srColMov().doc(c.id), c); });
  b.commit().then(function () {
    copie.forEach(function (c) { var orig = srTrovaMov(c.id); if (orig) Object.assign(orig, c); srRegistraInCache(orig || c); delete SR.rimbSel[c.id]; });
    srLog('Rimborso ' + gruppo.gruppoId + ' registrato: ' + totale + ' € (' + copie.length + ' spese, ' + gruppo.modo + ')', 'ok');
    esito.innerHTML = '<div class="ok-msg">✅ Rimborso di ' + srEuro(totale) + ' registrato.' + (gruppo.modo === 'BONIFICO' ? ' Fai il bonifico di ESATTAMENTE ' + srEuro(totale) + ': l\'import dell\'estratto lo riconoscerà.' : '') + '</div>';
    srAggiornaBadgeCassa(); srRenderRimborsi();
  }).catch(function (err) { srLog('Rimborso fallito: ' + err.message, 'err'); esito.innerHTML = '<div class="errore">Non registrato: ' + srEsc(err.message) + '</div>'; });
}
function srStampaNotaSpese() {
  var mese = srEl('nota-mese').value;
  if (!mese) { alert('Scegli il mese.'); return; }
  var lista = SR.anticipi.filter(function (m) { return m.stato !== 'ANNULLATO' && (m.dataDocumento || '').slice(0, 7) === mese; })
    .sort(function (a, b) { return (a.dataDocumento || '').localeCompare(b.dataDocumento || ''); });
  if (!lista.length) { alert('Nessuna spesa anticipata in questo mese.'); return; }
  var tot = lista.reduce(function (s, m) { return s + (Number(m.importoEur) || 0); }, 0);
  var daRimb = lista.filter(function (m) { return m.stato === 'DA_PAGARE'; }).reduce(function (s, m) { return s + (Number(m.importoEur) || 0); }, 0);
  var p = mese.split('-');
  var nomeMese = new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  var corpo = '<h1>Nota spese — ' + srEsc(nomeMese) + '</h1><div class="sub">Spese sostenute per conto di ASD Basket Campodarsego da Alberto (presidente), con documento allegato in archivio.</div>' +
    '<table><tr><th>Data</th><th>Voce</th><th>Centro</th><th>Pagato con</th><th>Descrizione</th><th>Doc.</th><th>Stato</th><th class="n">Importo</th></tr>' +
    lista.map(function (m) {
      var cen = srCentroDi(m);
      return '<tr><td>' + srDataIt(m.dataDocumento) + '</td><td>' + srEsc(srNomeCategoria(m.categoriaCodice)) + '</td><td>' + (cen === 'PALESTRA' ? 'Palestra' : cen === 'SPORT' ? 'Società' : '—') + '</td><td>' +
        srEsc(SR_MEZZI[m.mezzoPagamento] ? SR_MEZZI[m.mezzoPagamento].breve : '') + '</td><td>' + srEsc((m.note || '').slice(0, 80)) + '</td><td>' + srEsc(SR_DOCUMENTI[m.documento] || '') + (m.fotoDocId ? ' (foto)' : '') + '</td><td>' +
        (m.stato === 'DA_PAGARE' ? 'da rimborsare' : 'rimborsato ' + srDataIt(m.rimborso && m.rimborso.data)) + '</td><td class="n">' + srEuro(m.importoEur) + '</td></tr>';
    }).join('') + '<tr class="tot"><td colspan="7">Totale del mese</td><td class="n">' + srEuro(tot) + '</td></tr>' +
    '<tr class="tot"><td colspan="7">di cui ancora da rimborsare</td><td class="n">' + srEuro(daRimb) + '</td></tr></table>' +
    '<p style="margin-top:30px">Data ____________ &nbsp;&nbsp;&nbsp; Firma ______________________</p>';
  srApriStampa('Nota spese ' + nomeMese, corpo);
}

// v0.9: avvio solo quando TUTTI gli script della pagina sono caricati (dittafono, palestra, PDF):
// con la cache di Firebase la catena di avvio poteva finire prima che gli ultimi script fossero letti.
function srAvvia() { if (typeof firebase !== 'undefined') fbInit(); else srLog('Firebase non caricato', 'err'); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', srAvvia); else srAvvia();
