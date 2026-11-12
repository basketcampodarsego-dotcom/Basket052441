// ════════════════════════════════════════════════════════
// FILE: spese-rapide-voce.js — ASD Basket Campodarsego
// VERSIONE: v0.1 · 12/11/2026 10:30 · BK
// v0.1: creazione — interpretazione di una frase libera (dettata o scritta)
//   che descrive una spesa: importo, mezzo di pagamento, centro
//   (Palestra/Società), voce di spesa, natura, documento, data relativa.
//   Richiesta Alberto 12/11/2026: "te lo dico a voce e tu fai un controllo
//   su quello che c'è già in database; se non esiste una categoria me la
//   chiedi". Nessuna "comprensione" magica: regole esplicite + un
//   dizionario che IMPARA dalle conferme di Alberto (parola -> voce/centro/
//   natura, con conteggi). Quando non e' sicuro NON indovina: restituisce
//   l'ambiguita' (piu' importi, piu' voci candidate, centro mancante) e la
//   pagina chiede.
// Funzioni PURE: nessun accesso a DOM o Firestore, testabili in Node.
// Usato da: spese-rapide.js
// ════════════════════════════════════════════════════════

// ── Normalizzazione: minuscolo, senza accenti, apostrofi -> spazio ──
function srNorm(s) {
  return String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// ── Numeri scritti in lettere (0-9999), es. "quarantacinque", "centoventi",
// "milleduecento", "duemila". Ritorna null se la parola non e' un numero. ──
var SR_UNITA = { zero: 0, uno: 1, un: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9,
  dieci: 10, undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17, diciotto: 18, diciannove: 19 };
var SR_DECINE = [['venti', 20], ['vent', 20], ['trenta', 30], ['trent', 30], ['quaranta', 40], ['quarant', 40],
  ['cinquanta', 50], ['cinquant', 50], ['sessanta', 60], ['sessant', 60], ['settanta', 70], ['settant', 70],
  ['ottanta', 80], ['ottant', 80], ['novanta', 90], ['novant', 90]];
function srParolaNumero(w) {
  w = srNorm(w);
  if (!w || !/^[a-z]+$/.test(w)) return null;
  function p(s) {
    if (s === '') return 0;
    if (Object.prototype.hasOwnProperty.call(SR_UNITA, s)) return SR_UNITA[s];
    var i;
    if (s.indexOf('mila') > 0) {
      i = s.indexOf('mila');
      var a = p(s.slice(0, i)), b = p(s.slice(i + 4));
      return (a === null || b === null || a < 2) ? null : a * 1000 + b;
    }
    if (s.indexOf('mille') === 0) { var r = p(s.slice(5)); return r === null ? null : 1000 + r; }
    i = s.indexOf('cento');
    if (i >= 0) {
      var sx = s.slice(0, i), dx = s.slice(i + 5);
      var molt = sx === '' ? 1 : p(sx);
      var rest = p(dx);
      if (molt === null || rest === null || molt > 9 || rest > 99) return null;
      return molt * 100 + rest;
    }
    for (var k = 0; k < SR_DECINE.length; k++) {
      var pre = SR_DECINE[k][0];
      if (s.indexOf(pre) === 0) {
        var resto = s.slice(pre.length);
        if (resto === '') return SR_DECINE[k][1];
        var u = p(resto);
        if (u !== null && u >= 1 && u <= 9) return SR_DECINE[k][1] + u;
      }
    }
    return null;
  }
  return p(w);
}

// ── Token numerico "54,65" / "54.65" / "1.200,50" / "1200" -> numero ──
function srTokenNumero(t) {
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  if (/^\d+,\d{1,2}$/.test(t)) return parseFloat(t.replace(',', '.'));
  if (/^\d+\.\d{1,2}$/.test(t)) return parseFloat(t);
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return null;
}

// Unita' di misura / quantita' che indicano che il numero NON e' un importo
var SR_UNITA_MISURA = /^(w|watt|kw|kwh|pz|pezzi|pezzo|kg|g|gr|litri|litro|l|lt|gb|mb|mm|cm|m|metri|ore|ora|h|v|volt|mah|x|confezioni|pacchi)$/;

// ── Estrae l'importo. Ritorna { valore: number|null, candidati: [numeri] } ──
// Regole: preferisce il numero vicino a "euro"/"€"; accetta "45,50",
// "45 e 50 euro", "45 euro e 50", "quarantacinque virgola cinquanta".
// Se ci sono piu' numeri e nessuno e' legato a "euro", NON sceglie: li
// restituisce tutti come candidati (la pagina chiede quale).
function srEstraiImporto(testo) {
  var t = srNorm(testo).replace(/€/g, ' euro ').replace(/(\d)\s*(euro)/g, '$1 euro')
    .replace(/[^a-z0-9.,\s]/g, ' ').replace(/\s+/g, ' ').trim();
  var tok = t ? t.split(' ') : [];
  // toglie punteggiatura finale (es. "45," a fine frase)
  tok = tok.map(function (x) { return /^\d/.test(x) ? x.replace(/[.,]+$/, '') : x.replace(/[.,]/g, ''); });
  var nums = [];
  for (var i = 0; i < tok.length; i++) {
    var v = srTokenNumero(tok[i]);
    var daParola = false;
    if (v === null) { v = srParolaNumero(tok[i]); daParola = v !== null; }
    if (v === null) continue;
    // articoli "un/una/uno" contano solo se seguiti da euro
    if (daParola && /^(un|una|uno)$/.test(tok[i]) && tok[i + 1] !== 'euro') continue;
    if (tok[i + 1] && SR_UNITA_MISURA.test(tok[i + 1])) continue;
    nums.push({ v: v, i: i, fine: i });
  }
  // fusioni decimali
  var fusi = [];
  for (var j = 0; j < nums.length; j++) {
    var n = nums[j], next = nums[j + 1];
    if (next && Number.isInteger(n.v) && Number.isInteger(next.v) && next.v < 100) {
      var tra = tok.slice(n.i + 1, next.i).join(' ');
      if (tra === 'virgola' || tra === 'euro e' || tra === 'e' && tok[next.i + 1] === 'euro' || tra === 'e' && /^(centesimi|cent)$/.test(tok[next.i + 1] || '')) {
        var cent = next.v < 10 && tra === 'virgola' && !/^0/.test(tok[next.i]) ? next.v * 10 : next.v;
        fusi.push({ v: Math.round((n.v + cent / 100) * 100) / 100, i: n.i, fine: next.i, euro: true });
        j++;
        continue;
      }
    }
    fusi.push(n);
  }
  fusi.forEach(function (n) {
    if (n.euro) return;
    n.euro = tok[n.fine + 1] === 'euro' || tok[n.i - 1] === 'euro';
  });
  var conEuro = fusi.filter(function (n) { return n.euro; });
  var candidati = fusi.map(function (n) { return n.v; }).filter(function (v, k, a) { return a.indexOf(v) === k; });
  if (conEuro.length === 1) return { valore: conEuro[0].v, candidati: candidati };
  if (conEuro.length === 0 && fusi.length === 1) return { valore: fusi[0].v, candidati: candidati };
  return { valore: null, candidati: conEuro.length > 1 ? conEuro.map(function (n) { return n.v; }) : candidati };
}

// ── Mezzo di pagamento ──
// BONIFICO, CARTA_TASCA (prepagata della societa'), CONTANTI_CASSA (cassa
// della societa'), CARTA_PERSONALE e CONTANTI_PERSONALI (anticipi di Alberto).
// Ritorna { mezzo: codice|null, personale: bool } — personale=true senza
// mezzo significa "pagato da me" ma non si capisce se carta o contanti.
function srEstraiMezzo(testo) {
  var t = srNorm(testo);
  var personale = /\b(mia carta|carta mia|carta personale|carta di credito mia|la mia|di tasca mia|soldi miei|miei soldi|contanti miei|miei contanti|anticipat\w*|pagato io|ho pagato io|pagata io)\b/.test(t);
  var contanti = /\b(contant\w*|cash|soldi)\b/.test(t);
  var carta = /\b(carta|tasca|prepagata|bancomat)\b/.test(t);
  if (personale) {
    if (contanti && !carta) return { mezzo: 'CONTANTI_PERSONALI', personale: true };
    if (carta && !contanti) return { mezzo: 'CARTA_PERSONALE', personale: true };
    return { mezzo: null, personale: true };
  }
  if (/\bbonific\w*/.test(t)) return { mezzo: 'BONIFICO', personale: false };
  if (/\b(tasca|prepagata)\b/.test(t) || /\bcarta\b/.test(t)) return { mezzo: 'CARTA_TASCA', personale: false };
  if (contanti || /\bcassa\b/.test(t)) return { mezzo: 'CONTANTI_CASSA', personale: false };
  return { mezzo: null, personale: false };
}

// ── Centro: parole tipiche (il dizionario appreso pesa di piu', vedi srInterpreta) ──
var SR_RE_PALESTRA = /\b(palestr\w*|spogliato\w*|pista|robot\w*|ecovacs|winbot|caldaia|impiant\w*|corridoi\w*|lampad\w*|neon|led|tapo|sensor\w*|router|ripetitor\w*|pulizi\w*|detersiv\w*|bollett\w*|utenz\w*|soppalco|segreteria|defibrillator\w*|dae|estintor\w*)\b/;
var SR_RE_SOCIETA = /\b(societa|squadr\w*|minibasket|basket|torne\w*|trasfert\w*|partit\w*|atlet\w*|bambin\w*|pulcin\w*|esordient\w*|aquilott\w*|scoiattol\w*|carburant\w*|benzin\w*|gasolio|diesel|divis\w*|maglie|canotte|palloni|pallone|fip|tesser\w*|arbitr\w*|allenament\w*)\b/;
function srEstraiCentro(testo) {
  var t = srNorm(testo);
  var p = SR_RE_PALESTRA.test(t), s = SR_RE_SOCIETA.test(t);
  if (/\bper la palestra\b|\bdella palestra\b|\bin palestra\b/.test(t)) return 'PALESTRA';
  if (/\bper la societa\b|\bdella societa\b|\bper la squadra\b/.test(t)) return 'SPORT';
  if (p && !s) return 'PALESTRA';
  if (s && !p) return 'SPORT';
  return null;
}

function srEstraiDocumento(testo) {
  var t = srNorm(testo);
  if (/\bfattur\w*/.test(t)) return 'FATTURA';
  if (/\bricevut\w*/.test(t)) return 'RICEVUTA';
  if (/\bscontrin\w*/.test(t)) return 'SCONTRINO';
  return null;
}

function srEstraiTipoMov(testo) {
  var t = srNorm(testo);
  if (/\b(incassat\w*|incasso|ricevut\w* da|entrat\w*|ci hanno dato|hanno pagato|ha pagato|erogazion\w*|donazion\w*|offert\w*)\b/.test(t)) return 'ENTRATA';
  return null;
}

// Data relativa: "ieri", "l'altro ieri". oggiISO = 'AAAA-MM-GG' (data locale).
function srEstraiData(testo, oggiISO) {
  var t = srNorm(testo);
  var giorni = /\baltro ieri\b|\bieri l altro\b/.test(t) ? 2 : /\bieri\b/.test(t) ? 1 : 0;
  if (!giorni) return null;
  var p = oggiISO.split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2] - giorni); // getter locali, mai toISOString (bug storico date UTC)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ── Parole di contenuto: quelle che servono a riconoscere la voce ──
var SR_STOP = ('ho ha hai abbiamo sono e ed o di da del della dello dei degli delle dal dalla al alla allo ai agli alle ' +
  'il lo la i gli le l un una uno in a su per con tra fra che mi ci si ne non piu meno anche poi oggi ieri altro ' +
  'fatto fatta fare speso spesa spese preso presa comprato comprata comprati acquistato acquistata acquisto pagato pagata pagati pagare ' +
  'euro centesimi cent virgola soldi carta tasca prepagata bonifico contanti contante cassa cash bancomat mia mio miei mie personale ' +
  'io tu lui noi voi loro questo questa quello quella circa totale scontrino fattura ricevuta documento ' +
  'societa palestra incassato incasso ricevuto entrata nella nel nei sul sulla dove come quando ' +
  'anticipato anticipata dalla').split(' ');
var SR_STOP_SET = {};
SR_STOP.forEach(function (w) { SR_STOP_SET[w] = true; });
function srParoleContenuto(testo) {
  return srNorm(testo).replace(/[^a-z0-9\s]/g, ' ').split(' ').filter(function (w) {
    return w.length >= 3 && !SR_STOP_SET[w] && !/^\d/.test(w) && srParolaNumero(w) === null;
  }).filter(function (w, i, a) { return a.indexOf(w) === i; });
}

// ── Intenti predefiniti: servono solo quando il dizionario non sa ancora
// nulla. Ogni intento indica i codici categoria candidati (il primo che
// ESISTE in tabella vince), un'espressione sulla descrizione della
// categoria come ripiego, e la proposta di nuova categoria se nessuna
// esiste (la pagina chiede conferma prima di crearla). ──
var SR_INTENTI = [
  { id: 'CARBURANTE', peso: 5, re: /\b(benzin\w*|gasolio|diesel|carburant\w*|distributor\w*|rifornim\w*|eni|q8|esso|tamoil|vega|agip|ip)\b/,
    codici: ['CARBURANTE', 'CARBURANTI', 'CARBUR'], descRe: /carbur|benzin/, nuovo: { codice: 'CARBURANTE', descrizione: 'Carburante' }, centro: 'SPORT', natura: 'FUNZIONAMENTO' },
  { id: 'PULIZIE', peso: 5, re: /\b(detersiv\w*|ricambi|rull\w*|spazzol\w*|sacchett\w*|pulizi\w*|scop\w*|mocio|levaragnatel\w*|panni|sgrassator\w*|igienizzant\w*|carta igienica)\b/,
    codici: ['PUL', 'PULIZIE'], descRe: /pulizi/, nuovo: { codice: 'PUL', descrizione: 'Pulizia palestra' }, centro: 'PALESTRA', natura: 'FUNZIONAMENTO' },
  { id: 'MIGLIORIA', peso: 3, re: /\b(robot\w*|ecovacs|winbot|tapo|sensor\w*|router|ripetitor\w*|hub|rele|domotic\w*|ups|telecomand\w*)\b/,
    codici: ['ATTREZZ', 'MIGLIORIE'], descRe: /attrezz|miglior/, nuovo: { codice: 'ATTREZZ', descrizione: 'Attrezzature e migliorie palestra' }, centro: 'PALESTRA', natura: 'MIGLIORIA' },
  { id: 'MANUTENZIONE', peso: 4, re: /\b(lampad\w*|neon|led|tubi|lampadin\w*|interruttor\w*|fusibil\w*|prese|ferramenta|viti|silicon\w*|vernic\w*|riparazion\w*|idraulic\w*|elettricist\w*)\b/,
    codici: ['MANUT'], descRe: /manuten/, nuovo: { codice: 'MANUT', descrizione: 'Manutenzione palestra' }, centro: 'PALESTRA', natura: 'FUNZIONAMENTO' },
  { id: 'UTENZE', peso: 5, re: /\b(bollett\w*|luce|gas|enel|argos|fastweb|iliad|sim|acqua etra|etra)\b/,
    codici: ['UTENZE'], descRe: /utenz/, nuovo: { codice: 'UTENZE', descrizione: 'Utenze palestra (luce/gas/acqua)' }, centro: 'PALESTRA', natura: 'FISSO' },
  { id: 'MATSPORT', peso: 5, re: /\b(palloni|pallone|divis\w*|maglie|canotte|coni|casacch\w*|fischiett\w*|cinesini|materiale sportivo|retin\w*|canestr\w*)\b/,
    codici: ['MATSPORT'], descRe: /materiale|divis|pallon/, nuovo: { codice: 'MATSPORT', descrizione: 'Materiale, divise, palloni' }, centro: 'SPORT', natura: 'FUNZIONAMENTO' },
  { id: 'EVENTI', peso: 5, re: /\b(pizz\w*|panin\w*|bibit\w*|merend\w*|tort\w*|fest\w*|cen[ae]\w*|pranz\w*|gelat\w*|alimentar\w*|supermercat\w*|caffe)\b/,
    codici: ['EVENTI_CAT', 'EVENTI'], descRe: /event|pranz|cen|alimentar/, nuovo: { codice: 'EVENTI_CAT', descrizione: 'Pranzi, cene, pizze, bar sociali' }, centro: 'SPORT', natura: 'FUNZIONAMENTO' },
  { id: 'TRASPORTO', peso: 5, re: /\b(pullman|bus|autostrad\w*|pedagg\w*|parchegg\w*|treno|biglietto)\b/,
    codici: ['TRASF'], descRe: /trasfer/, nuovo: { codice: 'TRASF', descrizione: 'Trasferte e tornei' }, centro: 'SPORT', natura: 'FUNZIONAMENTO' },
  { id: 'CANCELLERIA', peso: 5, re: /\b(cancelleri\w*|toner|penn\w*|quadern\w*|stampant\w*|risme|buste|francobol\w*|raccomandat\w*)\b/,
    codici: ['AMMSPESE'], descRe: /cancell|amminist|consulen/, nuovo: { codice: 'CANCELLERIA', descrizione: 'Cancelleria e spese di ufficio' }, centro: null, natura: 'FUNZIONAMENTO' },
  { id: 'SICUREZZA', peso: 5, re: /\b(cors\w* sicurezza|primo soccorso|antincendio|defibrillator\w*|dae|elettrod\w*|cassetta|estintor\w*|dvr|rspp)\b/,
    codici: ['SICUREZZA', 'FORMAZ'], descRe: /sicurez|formaz/, nuovo: { codice: 'SICUREZZA', descrizione: 'Sicurezza (corsi, DAE, presidi)' }, centro: 'PALESTRA', natura: 'FISSO' },
  { id: 'TARIFFE', peso: 5, re: /\b(volley|sanp|teatro|sentiero|tariff\w*|uso (della )?palestra|affitto palestra|ore di palestra)\b/,
    codici: ['CONDIVPALESTRA'], descRe: /condivis|tariff|uso palestr/, nuovo: { codice: 'TARIFFE_PAL', descrizione: 'Tariffe d\'uso palestra (utilizzatori)' }, centro: 'PALESTRA', natura: null },
  { id: 'TESS', peso: 5, re: /\b(tesser\w*|affiliazion\w*|iscrizion\w* fip|fip|csi)\b/,
    codici: ['TESS'], descRe: /tesser|affilia/, nuovo: { codice: 'TESS', descrizione: 'Tesseramenti e affiliazioni' }, centro: 'SPORT', natura: 'FUNZIONAMENTO' }
];

// Codice categoria di un intento tra quelle ATTIVE (o null se nessuna esiste)
function srRisolviIntento(intento, categorieAttive) {
  for (var i = 0; i < intento.codici.length; i++) {
    var c = intento.codici[i];
    if (categorieAttive.some(function (k) { return k.codice === c; })) return c;
  }
  var perDesc = categorieAttive.find(function (k) { return intento.descRe.test(srNorm(k.descrizione)); });
  return perDesc ? perDesc.codice : null;
}

// ── Voce di spesa: punteggio per categoria da (1) dizionario appreso,
// (2) intenti predefiniti, (3) somiglianza con la descrizione della
// categoria. Ritorna { codice|null, ambigui:[codici], proposta:{codice,
// descrizione}|null, intento|null }. ──
function srSuggerisciCategoria(testo, parole, diz, categorieAttive) {
  var t = srNorm(testo);
  var punti = {};
  function add(c, n) { if (c) punti[c] = (punti[c] || 0) + n; }
  var attivi = {};
  categorieAttive.forEach(function (k) { attivi[k.codice] = true; });
  (parole || []).forEach(function (w) {
    var voce = diz && diz.parole && diz.parole[w];
    if (voce && voce.cat) Object.keys(voce.cat).forEach(function (c) { if (attivi[c]) add(c, 2 * voce.cat[c]); });
  });
  var intentiPer = {}; // codice (o pseudo-codice di proposta) -> intento
  SR_INTENTI.forEach(function (it) {
    if (!it.re.test(t)) return;
    var c = srRisolviIntento(it, categorieAttive);
    var chiave = c || ('__NUOVO__' + it.nuovo.codice);
    add(chiave, it.peso || 3);
    if (!intentiPer[chiave] || (it.peso || 3) > (intentiPer[chiave].peso || 3)) intentiPer[chiave] = it;
  });
  (parole || []).forEach(function (w) {
    if (w.length < 4) return;
    categorieAttive.forEach(function (k) {
      srNorm(k.descrizione).split(/[^a-z]+/).forEach(function (dw) {
        if (dw.length >= 4 && dw.slice(0, 5) === w.slice(0, 5)) add(k.codice, 1);
      });
    });
  });
  var ord = Object.keys(punti).sort(function (a, b) { return punti[b] - punti[a]; });
  if (!ord.length) return { codice: null, ambigui: [], proposta: null, intento: null };
  var best = ord[0], second = ord[1];
  var intento = intentiPer[best] || null;
  function reale(c) { return c.indexOf('__NUOVO__') !== 0; }
  if (second && punti[second] >= punti[best] * 0.75) {
    var prop = null;
    ord.slice(0, 4).forEach(function (c) { if (!reale(c) && !prop) prop = intentiPer[c].nuovo; });
    return { codice: null, ambigui: ord.slice(0, 4).filter(reale), proposta: prop, intento: null };
  }
  if (!reale(best)) return { codice: null, ambigui: [], proposta: intentiPer[best].nuovo, intento: intento };
  return { codice: best, ambigui: [], proposta: null, intento: intento };
}

// Voto prevalente nel dizionario per un attributo ('centro' o 'natura')
function srVotoDizionario(parole, diz, attr) {
  var punti = {};
  (parole || []).forEach(function (w) {
    var voce = diz && diz.parole && diz.parole[w];
    if (voce && voce[attr]) Object.keys(voce[attr]).forEach(function (k) { punti[k] = (punti[k] || 0) + voce[attr][k]; });
  });
  var ord = Object.keys(punti).sort(function (a, b) { return punti[b] - punti[a]; });
  if (!ord.length) return null;
  if (ord[1] && punti[ord[1]] >= punti[ord[0]] * 0.75) return null;
  return ord[0];
}

// ── Interpretazione completa della frase ──
// ctx = { oggiISO, diz, categorieAttive }
// I campi NON riconosciuti restano null: e' la pagina a chiedere.
function srInterpreta(testo, ctx) {
  ctx = ctx || {};
  var parole = srParoleContenuto(testo);
  var imp = srEstraiImporto(testo);
  var mezzo = srEstraiMezzo(testo);
  var cat = srSuggerisciCategoria(testo, parole, ctx.diz, ctx.categorieAttive || []);
  var centro = srVotoDizionario(parole, ctx.diz, 'centro') || srEstraiCentro(testo) || (cat.intento ? cat.intento.centro : null);
  var natura = srVotoDizionario(parole, ctx.diz, 'natura') || (cat.intento ? cat.intento.natura : null);
  return {
    importo: imp.valore,
    candidatiImporto: imp.candidati,
    mezzo: mezzo.mezzo,
    personale: mezzo.personale,
    tipoMov: srEstraiTipoMov(testo),
    data: ctx.oggiISO ? srEstraiData(testo, ctx.oggiISO) : null,
    documento: srEstraiDocumento(testo),
    categoria: cat.codice,
    categorieAmbigue: cat.ambigui,
    propostaCategoria: cat.proposta,
    intento: cat.intento ? cat.intento.id : null,
    centro: centro,
    natura: natura,
    parole: parole,
    descrizione: String(testo || '').trim()
  };
}

// ── Apprendimento: dopo un salvataggio confermato da Alberto, ogni parola
// di contenuto vota per la voce, il centro e la natura scelti. ──
function srImpara(diz, parole, scelta) {
  diz = diz || {};
  if (!diz.parole) diz.parole = {};
  (parole || []).forEach(function (w) {
    var v = diz.parole[w] || (diz.parole[w] = { cat: {}, centro: {}, natura: {} });
    if (scelta.categoria) v.cat[scelta.categoria] = (v.cat[scelta.categoria] || 0) + 1;
    if (scelta.centro) v.centro[scelta.centro] = (v.centro[scelta.centro] || 0) + 1;
    if (scelta.natura) v.natura[scelta.natura] = (v.natura[scelta.natura] || 0) + 1;
  });
  return diz;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { srNorm: srNorm, srParolaNumero: srParolaNumero, srEstraiImporto: srEstraiImporto, srEstraiMezzo: srEstraiMezzo,
    srEstraiCentro: srEstraiCentro, srEstraiDocumento: srEstraiDocumento, srEstraiTipoMov: srEstraiTipoMov, srEstraiData: srEstraiData,
    srParoleContenuto: srParoleContenuto, srSuggerisciCategoria: srSuggerisciCategoria, srInterpreta: srInterpreta, srImpara: srImpara,
    srVotoDizionario: srVotoDizionario, SR_INTENTI: SR_INTENTI };
}
