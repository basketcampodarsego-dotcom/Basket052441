// ────────────────────────────────────────────────────────────
// FILE: economia-import-carta.js — ASD Basket Campodarsego
// VERSIONE: v0.1 · 15/09/2026 · BK
// v0.1: creazione — import estratto conto PDF CartaBCC (carta Tasca
//   prepagata, N. 5226 **** **** 8068) nei movimenti Economia generali.
//   Formato PDF DIVERSO dall'estratto conto bancario BCC Roma (ordine
//   colonne: data acquisto, data registrazione, descrizione, importo —
//   l'importo e' in fondo alla riga, non dopo le date come nel formato
//   bancario) quindi serve un estrattore di righe dedicato
//   (ecoImportEstraiRigheCarta), ma da qui in poi RIUSA tutta la
//   pipeline gia' costruita in economia-import-banca.js: stessa
//   funzione di dedup (ecoImportEDuplicato — cascata riferimento poi
//   data+importo, qui sempre quest'ultima visto che la carta non ha
//   riferimenti bancari), stessa UI di preview/conferma
//   (economia-import-banca-ui.js), stesso confronto con ecoMovimenti
//   gia' caricato da Firestore — quindi il controllo di sovrapposizione
//   con le operazioni inserite MANUALMENTE e' automatico: sono nello
//   stesso array, non serve una verifica separata.
//
// RICARICHE ESCLUSE PER PRINCIPIO, MAI IN SILENZIO: le righe "RICARICA
// DA HB BANCA COLLOCATRICE" / "PRIMA RICARICA" sono lo stesso
// trasferimento gia' contato come uscita "Ricarica carta prepagata"
// nell'estratto conto bancario (o lo sara' quando importato) — non sono
// una spesa reale, il denaro esce dal conto solo quando la carta viene
// davvero usata per un acquisto. Vengono mostrate in elenco con badge
// "RICARICA — non importare" e MAI preselezionate, ma restano visibili
// (non sparisce nulla senza che l'utente lo veda).
//
// Dipende da: economia-import-banca.js (ecoImportEDuplicato,
// ecoImportISOData — deve essere caricato PRIMA di questo file).
// ────────────────────────────────────────────────────────────

function ecoImportEstraiRigheCarta(txt) {
  var righe = (txt || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  // Formato CartaBCC: DD/MM/YYYY DD/MM/YYYY DESCRIZIONE ...  IMPORTO
  // (importo in fondo, a differenza del formato bancario BCC Roma)
  var reRiga = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([+-]?[\d.]+,\d{2})$/;
  var movimenti = [];
  righe.forEach(function (l) {
    var m = reRiga.exec(l);
    if (!m) return;
    var descrizione = m[3];
    if (/^SALDO AL/i.test(descrizione) || /^Carta N\./i.test(l)) return; // righe di saldo/intestazione, non movimenti
    movimenti.push({
      dataContabile: m[1],
      dataValuta: m[2],
      importo: parseFloat(m[4].replace(/\./g, '').replace(',', '.')),
      descrizione: descrizione
    });
  });
  diag('ecoImportEstraiRigheCarta: ' + movimenti.length + ' righe movimento trovate', 'info');
  return movimenti;
}

// ── Suggerimento categoria per spese carta — stesso principio del
// modulo bancario: propone un codice SOLO se esiste davvero, altrimenti
// lascia scegliere. Poche corrispondenze ad alta confidenza (federazioni
// sportive), tutto il resto (GEROTTO SRL, PRIX QUALITY, distributori,
// ecc.) lasciato SENZA suggerimento — BK non conosce questi esercenti
// abbastanza da proporre una categoria plausibile, meglio niente che
// una proposta indovinata a caso su spese vere. ──
function ecoImportSuggerisciCategoriaCarta(descrizione, categorieDisponibili) {
  var d = (descrizione || '').toUpperCase();
  var candidato = null;

  if (/RICARICA DA HB BANCA COLLOCATRICE|PRIMA RICARICA/.test(d)) {
    return { categoriaCodice: null, giroconto: true, nota: 'Ricarica carta \u2014 stesso trasferimento gi\u00e0 contato (o da contare) come uscita "Ricarica carta prepagata" nell\'estratto conto bancario. Non e\' una spesa reale: non importare come movimento.' };
  }
  if (/CSI[- ]?NET|CSI CENTRO SPORTIVO|WWW\.FIP\.IT|FEDERAZIONE ITALIANA/.test(d)) {
    candidato = 'TESS';
  } else if (/COMMISSIONE RICARICA/.test(d)) {
    candidato = null; // spesa bancaria vera, ma nessun codice seed adatto — lasciare scegliere
  }

  var esiste = candidato && (categorieDisponibili || []).some(function (c) { return c.codice === candidato; });
  return {
    categoriaCodice: esiste ? candidato : null,
    giroconto: false,
    nota: (candidato && !esiste) ? 'Suggerita categoria "' + candidato + '" ma non esiste nella tua tabella categorie \u2014 scegline una tu.' : ''
  };
}

// ── Orchestrazione — stessa forma di ecoImportPreparaElenco() cosi\'
// il resto della pipeline (UI, dedup, conferma) non deve sapere da
// quale formato di PDF arriva ogni riga. ──
function ecoImportPreparaElencoCarta(txt) {
  if (!ecoConfigCache) {
    var msg = 'ecoImportPreparaElencoCarta: ecoConfigCache non caricata \u2014 apri prima la pagina Economia almeno una volta in questa sessione';
    diag(msg, 'err');
    alert(msg);
    return [];
  }
  var righe = ecoImportEstraiRigheCarta(txt);
  var categorie = ecoConfigCache.categorie || [];
  var elenco = righe.map(function (r) {
    var suggerimento = ecoImportSuggerisciCategoriaCarta(r.descrizione, categorie);
    var dedup = suggerimento.giroconto
      ? { duplicato: false }
      : ecoImportEDuplicato({ dataContabile: r.dataContabile, dataValuta: r.dataValuta, importo: r.importo, riferimento: null }, ecoMovimenti);
    return {
      dataContabile: r.dataContabile,
      dataValuta: r.dataValuta,
      importo: r.importo,
      descrizione: r.descrizione,
      riferimento: null,
      duplicato: dedup.duplicato,
      criterioDedup: dedup.criterio,
      categoriaCodice: suggerimento.categoriaCodice,
      verifica: suggerimento.giroconto, // stesso meccanismo di badge/non-preselezione gia' in UI
      notaCategoria: suggerimento.nota,
      selezionato: !dedup.duplicato && !suggerimento.giroconto,
      // righe carta non abbinate mai ad atleta: quasi tutte spese, e le
      // uniche entrate (ricariche) sono gia' escluse per principio sopra
      atleta: null, atletaFonteTrovato: '', atletaMotivoFallback: '',
      pagamentoGiaPresente: false, pagamentoSelezionato: false
    };
  });
  diag('ecoImportPreparaElencoCarta: ' + elenco.length + ' righe, ' + elenco.filter(function (e) { return e.verifica; }).length + ' ricariche escluse, ' + elenco.filter(function (e) { return e.duplicato; }).length + ' gi\u00e0 presenti', 'ok');
  return elenco;
}

window.addEventListener('error', function (e) {
  var msg = '[economia-import-carta] errore non gestito: ' + (e.error && e.error.message || e.message);
  console.error(msg);
  if (typeof diag === 'function') diag(msg, 'err');
});
window.addEventListener('unhandledrejection', function (e) {
  var msg = '[economia-import-carta] promise non gestita: ' + (e.reason && e.reason.message || e.reason);
  console.error(msg);
  if (typeof diag === 'function') diag(msg, 'err');
});
