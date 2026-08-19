// ════════════════════════════════════════════════════════
// economia-core.js — ASD Basket Campodarsego
// Modulo Economia/Cassa/Amministrazione — TASK-BK-eco-01
// Bozza v0.2 — DA REVISIONARE con Alberto prima di integrare in
// basket-core.js. Non ancora collegato all'app: nessuna scrittura
// reale su Firestore avviene includendo solo questo file.
//
// v0.2: categorie/sottocategorie/centri di costo sono TABELLE DI
// CODICI gestite dall'utente (config/categorie ecc. su Firestore),
// non enum scritti nel codice. Qui sotto ci sono solo: le funzioni
// CRUD sulla tabella codici, un seed facoltativo di righe di
// esempio, e i validatori che LEGGONO la tabella invece di
// assumerne il contenuto.
// ══════════════════════════════════════════════════════

// ── Enum veri (questi sì fissi: sono stati del programma, non dati dell'utente) ──
var ECO_TIPO_MOVIMENTO = { ENTRATA: 'ENTRATA', USCITA: 'USCITA' };

var ECO_STATO_MOVIMENTO = {
  DA_PAGARE: 'DA_PAGARE',
  PAGATO: 'PAGATO',
  PARZIALE: 'PARZIALE',
  ANNULLATO: 'ANNULLATO',
  SCADUTO: 'SCADUTO'
};

var ECO_METODO_PAGAMENTO = ['bonifico', 'carta', 'assegno', 'contanti', 'altro'];
var ECO_TIPO_CONTO = { BANCA: 'BANCA', CARTA: 'CARTA', CASSA: 'CASSA', ALTRO: 'ALTRO' };

// ══════════════════════════════════════════════════
// TABELLA CODICI — categorie, sottocategorie, centri di costo
// Struttura record: { codice, descrizione, tipo, attivo, ordine, categoriaCodice? }
// Vive in config/categorie, config/sottocategorie, config/centriCosto su Firestore.
// Il codice qui sotto NON conosce quali codici esistono: opera sulla tabella
// che gli viene passata come parametro (letta da Firestore a monte).
// ══════════════════════════════════════════════════

// Crea un nuovo codice. Ritorna { ok, record, errore }.
// tabella = array corrente (letto da Firestore prima della chiamata).
function ecoNuovoCodice(tabella, codice, descrizione, opts) {
  opts = opts || {};
  codice = (codice || '').trim().toUpperCase();
  if (!codice) return { ok: false, errore: 'Codice obbligatorio' };
  if (!descrizione || !descrizione.trim()) return { ok: false, errore: 'Descrizione obbligatoria' };
  if ((tabella || []).some(function (r) { return r.codice === codice; })) {
    return { ok: false, errore: 'Codice già esistente: ' + codice };
  }
  var record = {
    codice: codice,
    descrizione: descrizione.trim(),
    tipo: opts.tipo || null,
    attivo: true,
    ordine: opts.ordine != null ? opts.ordine : (tabella || []).length,
    categoriaCodice: opts.categoriaCodice || null // solo per sottocategorie
  };
  return { ok: true, record: record };
}

// Rinomina/modifica descrizione o tipo di un codice esistente. Il codice stesso è immutabile.
function ecoModificaCodice(tabella, codice, modifiche) {
  var record = (tabella || []).find(function (r) { return r.codice === codice; });
  if (!record) return { ok: false, errore: 'Codice non trovato: ' + codice };
  var campiModificati = {};
  ['descrizione', 'tipo', 'ordine'].forEach(function (campo) {
    if (modifiche[campo] !== undefined && modifiche[campo] !== record[campo]) {
      campiModificati[campo] = { da: record[campo], a: modifiche[campo] };
      record[campo] = modifiche[campo];
    }
  });
  return { ok: true, record: record, campiModificati: campiModificati };
}

// Disattiva un codice (mai eliminazione fisica: i movimenti storici che lo usano
// devono restare leggibili e coerenti).
function ecoDisattivaCodice(tabella, codice) {
  var record = (tabella || []).find(function (r) { return r.codice === codice; });
  if (!record) return { ok: false, errore: 'Codice non trovato: ' + codice };
  record.attivo = false;
  return { ok: true, record: record };
}

// Codici selezionabili in un NUOVO movimento (solo attivi). Per i movimenti
// storici invece si mostra sempre il codice salvato, anche se nel frattempo disattivato.
function ecoCodiciAttivi(tabella) {
  return (tabella || []).filter(function (r) { return r.attivo !== false; })
    .sort(function (a, b) { return (a.ordine || 0) - (b.ordine || 0); });
}

// ── Seed facoltativo — righe di ESEMPIO caricabili una tantum alla prima
// configurazione (da §7 della spec originale). Alberto può ignorarle, modificarle
// o cancellarne il caricamento: non sono un vincolo del programma, sono solo dati. ──
var ECO_SEED_CENTRI_COSTO = [
  { codice: 'SPORT', descrizione: 'Attività agonistica e minibasket' },
  { codice: 'PALESTRA', descrizione: 'Gestione palestra comunale' },
  { codice: 'AMMIN', descrizione: 'Gestione generale ASD' },
  { codice: 'PERSONALE', descrizione: 'Costi trasversali di personale' },
  { codice: 'EVENTI', descrizione: 'Tornei, eventi, iniziative' },
  { codice: 'GENERALE', descrizione: 'Movimenti non attribuibili' }
];

var ECO_SEED_CATEGORIE = [
  { codice: 'TESS', descrizione: 'Tesseramenti e affiliazioni', tipo: 'USCITA' },
  { codice: 'ARBITRI', descrizione: 'Arbitri e campionati', tipo: 'USCITA' },
  { codice: 'MATSPORT', descrizione: 'Materiale, divise, palloni', tipo: 'USCITA' },
  { codice: 'TRASF', descrizione: 'Trasferte e tornei', tipo: 'USCITA' },
  { codice: 'ASSSPORT', descrizione: 'Assicurazioni sportive', tipo: 'USCITA' },
  { codice: 'UTENZE', descrizione: 'Utenze palestra (luce/gas/acqua)', tipo: 'USCITA' },
  { codice: 'PUL', descrizione: 'Pulizia palestra', tipo: 'USCITA' },
  { codice: 'MANUT', descrizione: 'Manutenzione palestra', tipo: 'USCITA' },
  { codice: 'AMMSPESE', descrizione: 'Commercialista, consulenze, software', tipo: 'USCITA' },
  { codice: 'COMPENSI', descrizione: 'Compensi sportivi e collaboratori', tipo: 'USCITA' },
  { codice: 'QUOTE', descrizione: 'Quote associative e sportive', tipo: 'ENTRATA' },
  { codice: 'CONTRIB', descrizione: 'Contributi comunali/pubblici', tipo: 'ENTRATA' },
  { codice: 'SPONSOR', descrizione: 'Sponsorizzazioni', tipo: 'ENTRATA' },
  { codice: 'DONAZ', descrizione: 'Donazioni ed erogazioni liberali', tipo: 'ENTRATA' },
  { codice: 'ALTRO', descrizione: 'Altre entrate/uscite', tipo: null }
];
// Nessun seed per sottocategorie: troppo specifiche della singola ASD, meglio
// che Alberto le crei lui stesso con ecoNuovoCodice() dal pannello admin.

// ── Generatori ID ──
function ecoNextNumeroMovimento(movimentiEsercizio, annoEsercizio) {
  var max = 0;
  (movimentiEsercizio || []).forEach(function (m) {
    var match = /^MOV-\d{4}-(\d{6})$/.exec(m.numeroMovimento || '');
    if (match) { var n = parseInt(match[1], 10); if (n > max) max = n; }
  });
  var next = String(max + 1).padStart(6, '0');
  return 'MOV-' + annoEsercizio + '-' + next;
}

function ecoNewId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// ── Validazione movimento (§22 spec) ──
// tabelleCodici = { categorie: [...], sottocategorie: [...], centriCosto: [...] }
// letti da Firestore a monte e passati qui — il validatore controlla che il
// codice usato ESISTA nella tabella, non lo confronta con un elenco fisso.
function ecoValidaMovimento(m, tabelleCodici, opts) {
  opts = opts || {};
  tabelleCodici = tabelleCodici || {};
  var errori = [];

  if (!m) return { valido: false, errori: ['Movimento mancante'] };

  if (m.tipoMovimento !== ECO_TIPO_MOVIMENTO.ENTRATA && m.tipoMovimento !== ECO_TIPO_MOVIMENTO.USCITA) {
    errori.push('tipoMovimento deve essere ENTRATA o USCITA');
  }

  if (typeof m.importoEur !== 'number' || isNaN(m.importoEur)) {
    errori.push('importoEur mancante o non numerico');
  } else if (m.importoEur < 0) {
    errori.push('importoEur non può essere negativo: usare tipoMovimento per il segno');
  }

  if (!m.categoriaCodice) {
    errori.push('categoriaCodice obbligatoria');
  } else if (tabelleCodici.categorie && !tabelleCodici.categorie.some(function (c) { return c.codice === m.categoriaCodice; })) {
    errori.push('categoriaCodice "' + m.categoriaCodice + '" non esiste in config/categorie');
  }

  if (m.centroCostoCodice && tabelleCodici.centriCosto &&
      !tabelleCodici.centriCosto.some(function (c) { return c.codice === m.centroCostoCodice; })) {
    errori.push('centroCostoCodice "' + m.centroCostoCodice + '" non esiste in config/centriCosto');
  }

  if (m.stato === ECO_STATO_MOVIMENTO.PAGATO && !m.dataPagamento) {
    errori.push('dataPagamento obbligatoria se stato = PAGATO');
  }

  if (m.stato === ECO_STATO_MOVIMENTO.PAGATO && !m.contoFinanziarioId) {
    errori.push('contoFinanziarioId obbligatorio per movimenti già pagati');
  }

  if (m.dataScadenza && isNaN(new Date(m.dataScadenza))) {
    errori.push('dataScadenza non è una data valida');
  }

  if (opts.esercizioChiuso && !opts.utenteAmministratore) {
    errori.push('esercizio chiuso: modifica consentita solo ad amministratore');
  }

  if (!m.annoEsercizio) {
    errori.push('annoEsercizio obbligatorio');
  }

  return { valido: errori.length === 0, errori: errori };
}

// ── Annullamento (mai cancellazione fisica — §21/§3 spec) ──
function ecoAnnullaMovimento(movimento, motivo, utente) {
  if (!motivo || !motivo.trim()) {
    return { ok: false, errore: 'Motivo obbligatorio per annullare un movimento' };
  }
  var precedente = movimento.stato;
  movimento.stato = ECO_STATO_MOVIMENTO.ANNULLATO;
  movimento.updatedAt = new Date().toISOString();
  movimento.updatedBy = utente || '';
  return {
    ok: true,
    auditEntry: {
      entita: 'movimento',
      entitaId: movimento.id,
      operazione: 'ANNULLA',
      campiModificati: { stato: { da: precedente, a: ECO_STATO_MOVIMENTO.ANNULLATO } },
      motivo: motivo,
      utente: utente || '',
      timestamp: new Date().toISOString()
    }
  };
}

// ── Saldo teorico conto (calcolato, mai salvato) ──
function ecoSaldoTeoricoConto(contoId, movimenti, saldoInizialeEsercizio, annoEsercizio) {
  var saldo = saldoInizialeEsercizio || 0;
  (movimenti || []).forEach(function (m) {
    if (m.contoFinanziarioId !== contoId) return;
    if (m.annoEsercizio !== annoEsercizio) return;
    if (m.stato === ECO_STATO_MOVIMENTO.ANNULLATO) return;
    var segno = m.tipoMovimento === ECO_TIPO_MOVIMENTO.ENTRATA ? 1 : -1;
    if (m.stato === ECO_STATO_MOVIMENTO.PAGATO || m.stato === ECO_STATO_MOVIMENTO.PARZIALE) {
      saldo += segno * (m.importoEur || 0);
    }
  });
  return Math.round(saldo * 100) / 100;
}

// ── Scadenziario come vista, non entità duplicata ──
function ecoMovimentiScadenza(movimenti, filtro) {
  filtro = filtro || {};
  var oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  return (movimenti || []).filter(function (m) {
    if (m.stato !== ECO_STATO_MOVIMENTO.DA_PAGARE) return false;
    if (!m.dataScadenza) return false;
    if (filtro.categoriaCodice && m.categoriaCodice !== filtro.categoriaCodice) return false;
    if (filtro.centroCostoCodice && m.centroCostoCodice !== filtro.centroCostoCodice) return false;
    var scad = new Date(m.dataScadenza);
    if (filtro.soloScadute) return scad < oggi;
    if (filtro.entroGiorni != null) {
      var limite = new Date(oggi); limite.setDate(limite.getDate() + filtro.entroGiorni);
      return scad >= oggi && scad <= limite;
    }
    return true;
  }).sort(function (a, b) { return (a.dataScadenza || '').localeCompare(b.dataScadenza || ''); });
}
