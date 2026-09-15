// ────────────────────────────────────────────────────────────
// FILE: economia-import-banca.js — ASD Basket Campodarsego
// VERSIONE: v0.2 · 05/09/2026 · BK
// v0.2: aggiunto abbinamento atleta (ecoImportTrovaAtleta, stessa
//   cascata gia' in uso in parsaBancaPDFText/parsaBancaRowsPDF: CF
//   atleta -> CF tutore -> cognome+nome con disambiguazione) e dedup
//   pagamento (ecoImportPagamentoGiaPresente) — un solo import crea,
//   riga per riga, il movimento Economia E (se abbinato a un atleta)
//   anche il pagamento, con le due scritture indipendenti tra loro.
// v0.1: creazione — import estratto conto PDF BCC Roma nei movimenti
//   Economia generali (basket052441/economia/movimenti), DIVERSO dal
//   modulo "Import Banca" gia' esistente in basket052441.html
//   (parsaBancaPDF/bancaImporta), che abbina pagamenti ai singoli
//   atleti cercando il CF nella descrizione — questo file invece crea
//   movimenti di cassa/banca generali (bollette, compensi, stipendi,
//   erogazioni, ecc.), MAI legati a un singolo atleta.
//
// Riusa l'estrazione testo PDF gia' in basket052441.html (loadPdfJs +
// tecnica di raggruppamento per riga via coordinate Y) — questo file
// prende in input il TESTO gia' estratto, non il PDF grezzo, per non
// duplicare quella parte.
//
// DEDUP A CASCATA (nessuna scorciatoia su data+importo da sola):
//   1. riferimentoBancario (ID_BONIFICO/ID.BON, identificativo bolletta,
//      C.ATT) se presente nella riga — il piu' affidabile, univoco
//      per costruzione bancaria.
//   2. in assenza di riferimento: data + importo (tolleranza 1 centesimo)
//      + primi caratteri descrizione — usato SOLO per righe senza alcun
//      riferimento (commissioni, ricariche carta, interessi).
//
// CATEGORIA: mai assegnata alla cieca. ecoImportSuggerisciCategoria()
// propone un codice SOLO se esiste per davvero nella tabella categorie
// che l'app ha gia' caricato da Firestore (ecoConfigCache, letta da
// economia-movimenti-ui.js) — se il codice suggerito non esiste in
// quella tabella (es. Alberto ha rinominato/rimosso i codici seed),
// la proposta resta vuota e va scelta a mano. La UI mostra comunque
// SEMPRE un select modificabile per ogni riga, mai un valore bloccato.
//
// GIROCONTI E CASI AMBIGUI: "Ricarica carta prepagata" (trasferimento
// interno banca->carta, non una spesa reale) e i bonifici del Comune
// per "gestione/pulizia/custodia palestra" (possibile pertinenza al
// modulo separato operazioni-giornaliere.html/Hermagor, non a questa
// Economia) sono marcati con badge "VERIFICA" e NON preselezionati per
// l'import — Alberto decide riga per riga, mai un'assunzione silenziosa.
//
// Dipende da: basket-core.js (g(), esc(), diag()), economia-core-DRAFT.js
// (ECO_TIPO_MOVIMENTO, ECO_STATO_MOVIMENTO), economia-movimenti-ui.js
// (ecoConfigCache, ecoMovimenti, ecoConti, ecoSalvaDocMovimento,
// ecoNextNumeroMovimento, ecoRenderMovimenti/ecoRenderScadenzario/
// ecoRenderConti) — tutti devono essere gia' caricati.
// ────────────────────────────────────────────────────────────

// ── Estrazione righe movimento dal testo PDF gia' estratto ──
// Riconosce l'intestazione riga (data contabile [+ data valuta] +
// importo) e accumula le righe di descrizione successive fino alla
// prossima intestazione. Scarta esplicitamente le righe "Saldo
// iniziale"/"Saldo finale" (non sono movimenti).
function ecoImportEstraiRighe(txt) {
  var righe = (txt || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  var reHead = /^(\d{2}\/\d{2}\/\d{4})\s+(?:(\d{2}\/\d{2}\/\d{4})\s+)?(-?[\d.]+,\d{2})\s+(.*)$/;
  var movimenti = [];
  var corrente = null;
  righe.forEach(function (l) {
    var m = reHead.exec(l);
    if (m) {
      if (corrente) movimenti.push(corrente);
      var descrizioneInline = m[4] || '';
      if (/^Saldo (iniziale|finale)/i.test(descrizioneInline)) {
        corrente = null; // riga di saldo, non un movimento — scartata esplicitamente
        return;
      }
      corrente = {
        dataContabile: m[1],
        dataValuta: m[2] || m[1],
        importo: parseFloat(m[3].replace(/\./g, '').replace(',', '.')),
        descrizione: descrizioneInline
      };
    } else if (corrente) {
      corrente.descrizione += ' ' + l;
    }
  });
  if (corrente) movimenti.push(corrente);
  diag('ecoImportEstraiRighe: ' + movimenti.length + ' righe movimento trovate', 'info');
  return movimenti;
}

// ── Estrazione riferimento univoco bancario, quando presente ──
function ecoImportEstraiRiferimento(descrizione) {
  var m;
  m = /ID[._]?BON(?:IFICO)?[:.]?\s*([A-Z0-9]{10,})/i.exec(descrizione);
  if (m) return { tipo: 'BONIFICO', valore: m[1] };
  m = /Identificativo della bolletta:?\s*(\S+)/i.exec(descrizione);
  if (m) return { tipo: 'BOLLETTA', valore: m[1] };
  m = /C\.ATT:?\s*([\d\/]+)/i.exec(descrizione);
  if (m) return { tipo: 'DELEGA', valore: m[1] };
  return null;
}

// ── Suggerimento categoria — SOLO se il codice esiste davvero nella
// tabella categorie caricata da Firestore (mai un codice inventato) ──
function ecoImportSuggerisciCategoria(descrizione, importo, categorieDisponibili) {
  var d = (descrizione || '').toUpperCase();
  var candidato = null;
  var verifica = false;
  var nota = '';

  if (/RICARICA CARTA PREPAGATA/.test(d)) {
    verifica = true; nota = 'Possibile giroconto interno banca\u2192carta, non una spesa reale — verifica prima di importare.';
  } else if (/COMUNE DI CAMPODARSEGO/.test(d) && /(GESTIONE|PULIZIA|CUSTODIA).*PALESTRA|PALESTRA.*(GESTIONE|PULIZIA|CUSTODIA)/.test(d)) {
    verifica = true; nota = 'Bonifico Comune per gestione/pulizia/custodia palestra — verifica se pertinente a questo modulo Economia o al modulo separato custodia palestra (Hermagor/operazioni-giornaliere.html).';
  } else if (/FASTWEB|ENEL ENERGIA|\bARGOS\b.*(LUCE|GAS)|ETRA SPA|IDR_INT/.test(d)) {
    candidato = 'UTENZE';
  } else if (/COMPENSO LAVORO SPORTIVO|COMPENSI SPORTIVI/.test(d)) {
    candidato = 'COMPENSI';
  } else if (/EROGAZIONE LIBERALE|DONAZ/.test(d)) {
    candidato = 'DONAZ';
  } else if (/REALE MUTUA|POLIZZA RCT|ASSICURAZ/.test(d)) {
    candidato = 'ASSSPORT';
  } else if (importo > 0 && /BASKET|QUOTA|RATA|SALDO|ISCRIZIONE/.test(d)) {
    candidato = 'QUOTE';
  } else if (/COMUNE DI CAMPODARSEGO/.test(d) && /CONTRIBUTO/.test(d)) {
    candidato = 'CONTRIB';
  }

  var esiste = candidato && (categorieDisponibili || []).some(function (c) { return c.codice === candidato; });
  return {
    categoriaCodice: esiste ? candidato : null,
    verifica: verifica,
    nota: nota || (candidato && !esiste ? 'Suggerita categoria "' + candidato + '" ma non esiste nella tua tabella categorie — scegline una tu.' : '')
  };
}

// ── Dedup a cascata contro i movimenti gia' presenti (ecoMovimenti) ──
function ecoImportEDuplicato(mov, movimentiEsistenti) {
  if (mov.riferimento) {
    var perRif = (movimentiEsistenti || []).find(function (m) {
      return m.riferimentoBancario && m.riferimentoBancario === mov.riferimento.valore;
    });
    if (perRif) return { duplicato: true, criterio: 'riferimento', esistente: perRif };
  }
  var perDataImporto = (movimentiEsistenti || []).find(function (m) {
    var stessaData = m.dataDocumento === ecoImportISOData(mov.dataContabile) || m.dataDocumento === ecoImportISOData(mov.dataValuta);
    return stessaData && Math.abs((+m.importoEur || 0) - Math.abs(mov.importo)) < 0.01;
  });
  if (perDataImporto) return { duplicato: true, criterio: 'data+importo', esistente: perDataImporto };
  return { duplicato: false };
}

function ecoImportISOData(ddmmyyyy) {
  var p = (ddmmyyyy || '').split('/');
  if (p.length !== 3) return '';
  return p[2] + '-' + p[1] + '-' + p[0];
}

// ── Ricerca atleta nella descrizione (v0.2) — STESSA cascata gia' in
// uso in parsaBancaPDFText/parsaBancaRowsPDF (CF atleta -> CF tutore ->
// cognome+nome con disambiguazione), estratta qui come funzione
// riusabile invece di duplicarla con una logica leggermente diversa.
// Tentata SOLO su righe in entrata (importo>0): un pagamento atleta e'
// sempre denaro che entra, mai un'uscita. ──
function ecoImportTrovaAtleta(descUp) {
  if (typeof DB === 'undefined' || !DB.atleti) return { atleta: null, fonteTrovato: '', motivoFallback: 'DB atleti non disponibile' };
  var atleti = DB.atleti;
  var match = null, fonteTrovato = '', motivoFallback = '';
  var cfTrovatiTesto = (descUp.match(/[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/g) || []);

  atleti.forEach(function (a) {
    if (!a.cf || match) return;
    if (descUp.indexOf(a.cf.toUpperCase()) > -1) { match = a; fonteTrovato = 'CF atleta'; }
  });
  if (!match) {
    atleti.forEach(function (a) {
      if (match) return;
      var tutCf = (a.tutCf || a.cfTut || '').toUpperCase();
      if (tutCf.length === 16 && descUp.indexOf(tutCf) > -1) { match = a; fonteTrovato = 'CF tutore'; }
    });
  }
  var candidatiNomeDiag = [];
  if (!match) {
    if (cfTrovatiTesto.length > 0) motivoFallback = 'CF ' + cfTrovatiTesto.join(', ') + ' non in anagrafica (n\u00e9 atleta n\u00e9 tutore)';
    var candidati = [];
    atleti.forEach(function (a) {
      var cog = (a.cog || '').toUpperCase();
      if (cog.length > 3 && descUp.indexOf(cog) > -1) candidati.push(a);
    });
    candidatiNomeDiag = candidati.map(function (a) { return a.cog + ' ' + a.nom; });
    if (candidati.length === 1) {
      var a1 = candidati[0];
      var nomTok = (a1.nom || '').toUpperCase().split(' ')[0];
      if (nomTok.length > 2 && descUp.indexOf(nomTok) > -1) { match = a1; fonteTrovato = 'cognome+nome'; }
      else motivoFallback = (motivoFallback ? motivoFallback + '; ' : '') + 'Cognome "' + a1.cog + '" trovato ma nome "' + a1.nom + '" non presente nel testo';
    } else if (candidati.length > 1) {
      var trovati = candidati.filter(function (a) {
        var tok = (a.nom || '').toUpperCase().split(' ').filter(function (t) { return t.length > 2; });
        return tok.some(function (t) { return descUp.indexOf(t) > -1; });
      });
      if (trovati.length === 1) { match = trovati[0]; fonteTrovato = 'cognome+nome (disambiguato)'; }
      else if (trovati.length > 1) motivoFallback = 'Cognome ambiguo: ' + trovati.length + ' atleti (' + trovati.map(function (a) { return a.cog + ' ' + a.nom; }).join(', ') + ') \u2014 scegli tu manualmente';
      else motivoFallback = (motivoFallback ? motivoFallback + '; ' : '') + 'Cognomi trovati (' + candidati.map(function (a) { return a.cog; }).join(', ') + ') ma nessun nome corrisponde';
    } else if (!motivoFallback) {
      motivoFallback = 'Nessun CF n\u00e9 cognome/nome trovato nel testo';
    }
  }
  return { atleta: match, fonteTrovato: fonteTrovato, motivoFallback: motivoFallback, cfTrovatiTesto: cfTrovatiTesto, candidatiNomeDiag: candidatiNomeDiag };
}

// ── Dedup pagamento — stessa regola gia' in uso in bancaImporta()
// (data ISO + importo, tolleranza 1 centesimo) ──
function ecoImportPagamentoGiaPresente(atletaId, dataISO, importo) {
  if (typeof DB === 'undefined' || !DB.pagamenti) return false;
  var pags = DB.pagamenti[atletaId] || [];
  return pags.some(function (p) { return p.data === dataISO && Math.abs((+p.importo || 0) - importo) < 0.01; });
}


// Non scrive nulla — restituisce solo l'elenco arricchito (dedup +
// suggerimento categoria) che la UI mostrera' per la conferma manuale.
function ecoImportPreparaElenco(txt) {
  if (!ecoConfigCache) {
    var msg = 'ecoImportPreparaElenco: ecoConfigCache non caricata — apri prima la pagina Economia almeno una volta in questa sessione';
    diag(msg, 'err');
    alert(msg);
    return [];
  }
  var righe = ecoImportEstraiRighe(txt);
  var categorie = ecoConfigCache.categorie || [];
  var elenco = righe.map(function (r) {
    var riferimento = ecoImportEstraiRiferimento(r.descrizione);
    var dedup = ecoImportEDuplicato({ dataContabile: r.dataContabile, dataValuta: r.dataValuta, importo: r.importo, riferimento: riferimento }, ecoMovimenti);
    var suggerimento = ecoImportSuggerisciCategoria(r.descrizione, r.importo, categorie);

    // Abbinamento atleta — solo per righe in entrata (importo>0)
    var atletaInfo = { atleta: null, fonteTrovato: '', motivoFallback: '' };
    var pagamentoGiaPresente = false;
    var pagamentoDataISO = ecoImportISOData(r.dataContabile);
    if (r.importo > 0) {
      atletaInfo = ecoImportTrovaAtleta(r.descrizione.toUpperCase());
      if (atletaInfo.atleta) {
        pagamentoGiaPresente = ecoImportPagamentoGiaPresente(atletaInfo.atleta.id, pagamentoDataISO, r.importo);
        // Se c'e' un atleta abbinato, la categoria suggerita per il lato
        // Economia e' sempre QUOTE (se esiste nella tabella) — coerente
        // col fatto che questo movimento e' una quota, non altro.
        if (categorie.some(function (c) { return c.codice === 'QUOTE'; })) {
          suggerimento.categoriaCodice = 'QUOTE';
          suggerimento.verifica = false;
          suggerimento.nota = '';
        }
      }
    }

    return {
      dataContabile: r.dataContabile,
      dataValuta: r.dataValuta,
      importo: r.importo,
      descrizione: r.descrizione,
      riferimento: riferimento,
      duplicato: dedup.duplicato,
      criterioDedup: dedup.criterio,
      categoriaCodice: suggerimento.categoriaCodice,
      verifica: suggerimento.verifica,
      notaCategoria: suggerimento.nota,
      selezionato: !dedup.duplicato && !suggerimento.verifica,
      // campi lato pagamento atleta (v0.2)
      atleta: atletaInfo.atleta,
      atletaFonteTrovato: atletaInfo.fonteTrovato,
      atletaMotivoFallback: atletaInfo.motivoFallback,
      pagamentoGiaPresente: pagamentoGiaPresente,
      pagamentoSelezionato: !!atletaInfo.atleta && !pagamentoGiaPresente
    };
  });
  var conAtleta = elenco.filter(function (e) { return e.atleta; }).length;
  diag('ecoImportPreparaElenco: ' + elenco.length + ' righe, ' + elenco.filter(function (e) { return e.duplicato; }).length + ' gi\u00e0 presenti, ' + elenco.filter(function (e) { return e.verifica; }).length + ' da verificare, ' + conAtleta + ' abbinate ad atleta', 'ok');
  return elenco;
}

window.addEventListener('error', function (e) {
  var msg = '[economia-import-banca] errore non gestito: ' + (e.error && e.error.message || e.message);
  console.error(msg);
  if (typeof diag === 'function') diag(msg, 'err');
});
window.addEventListener('unhandledrejection', function (e) {
  var msg = '[economia-import-banca] promise non gestita: ' + (e.reason && e.reason.message || e.reason);
  console.error(msg);
  if (typeof diag === 'function') diag(msg, 'err');
});
