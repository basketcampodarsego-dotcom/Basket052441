// ────────────────────────────────────────────────────────────
// FILE: economia-import-banca-ui.js — ASD Basket Campodarsego
// VERSIONE: v0.7 · 16/09/2026 · BK
// v0.7: il report duplicati DB ora ha una checkbox per movimento e un
//   pulsante "Annulla i selezionati" — usa ecoAnnullaMovimento(), lo
//   stesso meccanismo gia' in uso nel resto dell'app (mai una vera
//   cancellazione Firestore, sempre marcato ANNULLATO con motivo).
//   Blocco di sicurezza: se in un gruppo risultano selezionati TUTTI i
//   movimenti, non annulla NULLA (di nessun gruppo) e avvisa quale
//   gruppo correggere — almeno un movimento per gruppo deve restare.
// v0.6: badge "GIA' PRESENTE" separato da "POSSIBILE DUPLICATO" (segue
//   la correzione in economia-import-banca.js v0.6). Aggiunta
//   ecoImportMostraDuplicatiDB() — report di sola lettura sui doppioni
//   gia' presenti nel database, con pulsante dedicato.
// v0.5: aggiunta ecoImportOnFileMisto() — un solo input file per banca+
//   carta insieme, riconoscimento tipo per-file, elaborazione
//   VOLUTAMENTE sequenziale (non in parallelo) cosi' il controllo
//   duplicati vede anche le sovrapposizioni tra file diversi dello
//   stesso lotto (es. estratto annuale + trimestrale che si
//   sovrappongono). File non riconosciuti mai scartati in silenzio -
//   elencati a fine lotto. I due pulsanti separati esistenti ora
//   passano anch'essi ecoImportElencoCorrente per coerenza.
// v0.4: entrambi i punti di ingresso file (banca/carta) ora chiamano
//   ecoImportRilevaTipoPDF() per-file e avvisano esplicitamente (con
//   conferma manuale, mai un blocco silenzioso) se il file caricato
//   sembra del tipo sbagliato per quel pulsante.
// v0.3: estratta ecoImportEstraiTestoPDF() come funzione condivisa
//   (prima duplicata solo dentro ecoImportOnFilePdf), aggiunto
//   ecoImportOnFileCartaPdf() per l'estratto conto carta Tasca
//   (economia-import-carta.js) — ora entrambi i tipi di PDF si
//   accumulano nello stesso elenco di revisione invece di sostituirsi
//   a vicenda, cosi' si puo' caricare banca+carta insieme.
// v0.2: doppio binario per riga (movimento Economia + pagamento atleta
//   quando abbinato), checkbox indipendenti, scritture indipendenti in
//   conferma — un fallimento su un lato non blocca ne' nasconde l'altro.
// v0.1: creazione — UI di preview/conferma per economia-import-banca.js.
//   Ogni riga resta SEMPRE modificabile (checkbox + select categoria)
//   prima della conferma — nessun import automatico senza revisione.
// Dipende da: economia-import-banca.js (deve essere caricato PRIMA),
// economia-movimenti-ui.js, basket-core.js (loadPdfJs, gia' definita
// in basket052441.html per il modulo Import Banca esistente).
// ────────────────────────────────────────────────────────────

var ecoImportElencoCorrente = [];

// ── Estrazione testo da un PDF (condivisa tra import bancario e
// import carta — stessa tecnica di raggruppamento righe per Y gia' in
// uso in parsaBancaPDF, fattorizzata qui per non duplicarla due volte). ──
function ecoImportEstraiTestoPDF(file, cbOk, cbErr) {
  var reader = new FileReader();
  reader.onload = function (e) {
    var typedArray = new Uint8Array(e.target.result);
    pdfjsLib.getDocument(typedArray).promise.then(function (pdf) {
      var pageTexts = new Array(pdf.numPages);
      var done = 0;
      for (var p = 1; p <= pdf.numPages; p++) {
        (function (pNum) {
          pdf.getPage(pNum).then(function (page) {
            page.getTextContent().then(function (tc) {
              var lines = {};
              tc.items.forEach(function (item) {
                var y = Math.round(item.transform[5] / 3) * 3;
                if (!lines[y]) lines[y] = [];
                lines[y].push({ x: item.transform[4], txt: item.str });
              });
              var ySorted = Object.keys(lines).map(Number).sort(function (a, b) { return b - a; });
              pageTexts[pNum - 1] = ySorted.map(function (y) {
                return lines[y].sort(function (a, b) { return a.x - b.x; }).map(function (i) { return i.txt; }).join(' ');
              }).join('\n');
              done++;
              if (done === pdf.numPages) cbOk(pageTexts.join('\n'));
            });
          });
        })(p);
      }
    }).catch(function (err) {
      if (cbErr) cbErr(err); else console.error('ecoImportEstraiTestoPDF: ' + err.message);
    });
  };
  reader.readAsArrayBuffer(file);
}

// ── Punto d'ingresso: input file PDF bancario selezionato — ACCUMULA
// nell'elenco condiviso (non sostituisce) cosi' si puo' caricare anche
// il PDF della carta nella stessa sessione di revisione. ──
function ecoImportOnFilePdf(input) {
  var files = Array.from(input.files || []);
  if (!files.length) return;
  var out = document.getElementById('eco-import-esito');
  if (out && !ecoImportElencoCorrente.length) out.innerHTML = '<div style="color:var(--gold);padding:16px;text-align:center">Lettura PDF in corso\u2026</div>';

  if (typeof loadPdfJs !== 'function') {
    var msgNo = 'ecoImportOnFilePdf: loadPdfJs non disponibile — deve essere gia\' definita in basket052441.html';
    console.error(msgNo);
    if (out) out.innerHTML = '<div style="color:var(--red)">Errore interno: lettore PDF non disponibile.</div>';
    return;
  }

  loadPdfJs(function () {
    var testi = [];
    var fatti = 0;
    files.forEach(function (file) {
      ecoImportEstraiTestoPDF(file, function (txt) {
        var tipo = ecoImportRilevaTipoPDF(txt);
        if (tipo === 'CARTA') {
          var msgTipo = 'ecoImportOnFilePdf: file "' + file.name + '" rilevato come estratto CARTA, non banca';
          diag(msgTipo, 'warn');
          var continua = confirm('"' + file.name + '" sembra un estratto della CARTA TASCA, non del conto corrente bancario.\n\nSe è davvero la carta, annulla e usa il pulsante "PDF estratto conto carta Tasca" qui sotto.\n\nSe invece è comunque un estratto banca (il riconoscimento può sbagliare), premi OK per continuare.');
          if (!continua) {
            fatti++;
            if (fatti === files.length && testi.length) {
              var nuove0 = ecoImportPreparaElenco(testi.join('\n'), ecoImportElencoCorrente);
              ecoImportElencoCorrente = ecoImportElencoCorrente.concat(nuove0);
              ecoImportRenderTabella();
            }
            return;
          }
        }
        testi.push(txt);
        fatti++;
        if (fatti === files.length) {
          var nuove = ecoImportPreparaElenco(testi.join('\n'), ecoImportElencoCorrente);
          ecoImportElencoCorrente = ecoImportElencoCorrente.concat(nuove);
          ecoImportRenderTabella();
        }
      }, function (err) {
        var msg = 'ecoImportOnFilePdf: errore lettura PDF ' + file.name + ': ' + err.message;
        console.error(msg);
        if (out) out.innerHTML = '<div style="color:var(--red)">Errore lettura PDF: ' + err.message + '</div>';
      });
    });
  });
  input.value = ''; // permette di riselezionare lo stesso file in un secondo tentativo
}

// ── Report duplicati gia' nel DB — ora con possibilita' di annullare
// (mai una vera cancellazione Firestore: stesso meccanismo gia' in uso
// nell'app per "cancellare" un movimento, ecoAnnullaMovimento(), che
// marca come ANNULLATO con un motivo — mai perso il dato originale).
// REGOLA DI SICUREZZA: in ogni gruppo di duplicati almeno un movimento
// deve restare NON annullato — bloccato con un avviso chiaro se si
// prova a selezionarli tutti, mai un annullamento totale silenzioso. ──
var ecoImportUltimoReportDuplicati = null;

function ecoImportMostraDuplicatiDB() {
  var out = document.getElementById('eco-import-esito');
  if (!out) { console.error('ecoImportMostraDuplicatiDB: #eco-import-esito non trovato'); return; }
  var ris = ecoImportTrovaDuplicatiInDB();
  ecoImportUltimoReportDuplicati = ris;
  var h = '<div style="font-weight:700;margin-bottom:8px">Controllo duplicati nel database \u2014 ' + (ecoMovimenti || []).length + ' movimenti controllati</div>';

  if (!ris.certi.length && !ris.possibili.length) {
    h += '<div class="empty">Nessun duplicato trovato.</div>';
    out.innerHTML = h;
    return;
  }

  function rigaMov(m, gruppoIdx, tipoGruppo) {
    var cbId = 'eco-dup-' + tipoGruppo + '-' + gruppoIdx + '-' + m.id;
    return '<div style="font-size:12px;padding:4px 0 4px 8px;border-left:2px solid var(--border);display:flex;align-items:flex-start;gap:8px">' +
      '<input type="checkbox" id="' + cbId + '" data-gruppo="' + tipoGruppo + '-' + gruppoIdx + '" data-id="' + m.id + '">' +
      '<label for="' + cbId + '" style="flex:1">' +
      '#' + ecoImportEsc(m.numeroMovimento || '?') + ' \u2014 ' + ecoImportEsc(m.dataDocumento || '?') +
      ' \u2014 \u20ac' + (+m.importoEur || 0).toFixed(2) + ' (' + ecoImportEsc(m.tipoMovimento || '?') + ', ' + ecoImportEsc(m.categoriaCodice || '?') + ')' +
      '<br><span style="color:var(--muted)">' + ecoImportEsc((m.note || '').substring(0, 100)) + '</span></label></div>';
  }

  if (ris.certi.length) {
    h += '<div style="color:#e03545;font-weight:700;margin-top:10px">' + ris.certi.length + ' gruppo/i CERTI (stesso riferimento bancario \u2014 quasi sicuramente lo stesso movimento importato piu\u2019 volte)</div>';
    ris.certi.forEach(function (g, gi) {
      h += '<div style="margin:6px 0;padding:6px;background:#e0354511;border-radius:6px">' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Seleziona quelli da annullare \u2014 almeno uno deve restare</div>' +
        g.movimenti.map(function (m) { return rigaMov(m, gi, 'certo'); }).join('') + '</div>';
    });
  }
  if (ris.possibili.length) {
    h += '<div style="color:#c88a4b;font-weight:700;margin-top:10px">' + ris.possibili.length + ' gruppo/i DA VERIFICARE (stessa data e importo, nessun riferimento per esserne certi \u2014 potrebbero essere operazioni diverse legittime)</div>';
    ris.possibili.forEach(function (g, gi) {
      h += '<div style="margin:6px 0;padding:6px;background:#c88a4b11;border-radius:6px">' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Seleziona quelli da annullare SOLO se hai verificato che sono davvero lo stesso movimento \u2014 almeno uno deve restare</div>' +
        g.movimenti.map(function (m) { return rigaMov(m, gi, 'poss'); }).join('') + '</div>';
    });
  }
  h += '<button class="btn btn-red" style="margin-top:12px" onclick="ecoImportAnnullaDuplicatiSelezionati()">Annulla i selezionati</button>';
  h += '<div style="font-size:11px;color:var(--muted);margin-top:6px">L\u2019annullamento non cancella il dato: marca il movimento come ANNULLATO con motivo "duplicato", resta visibile e tracciato, coerente col resto dell\u2019app.</div>';
  out.innerHTML = h;
}

// ── Applica l'annullamento ai movimenti selezionati nel report. Prima
// controlla OGNI gruppo: se tutti i movimenti di un gruppo risultano
// selezionati, blocca con un avviso specifico e non annulla NULLA (di
// nessun gruppo) — meglio fermarsi del tutto che lasciare un gruppo
// senza nessun movimento valido rimasto. ──
function ecoImportAnnullaDuplicatiSelezionati() {
  if (!ecoImportUltimoReportDuplicati) { console.error('ecoImportAnnullaDuplicatiSelezionati: nessun report in memoria \u2014 rilancia il controllo prima'); return; }
  var tuttiGruppi = ecoImportUltimoReportDuplicati.certi.map(function (g, gi) { return { tipo: 'certo', idx: gi, gruppo: g }; })
    .concat(ecoImportUltimoReportDuplicati.possibili.map(function (g, gi) { return { tipo: 'poss', idx: gi, gruppo: g }; }));

  var selezionatiPerGruppo = {};
  var checkboxes = document.querySelectorAll('#eco-import-esito input[type=checkbox][data-gruppo]');
  checkboxes.forEach(function (cb) {
    if (!cb.checked) return;
    var k = cb.getAttribute('data-gruppo');
    if (!selezionatiPerGruppo[k]) selezionatiPerGruppo[k] = [];
    selezionatiPerGruppo[k].push(cb.getAttribute('data-id'));
  });

  // controllo di sicurezza: nessun gruppo puo' finire senza almeno un movimento non annullato
  for (var i = 0; i < tuttiGruppi.length; i++) {
    var tg = tuttiGruppi[i];
    var k = tg.tipo + '-' + tg.idx;
    var selezionati = selezionatiPerGruppo[k] || [];
    if (selezionati.length >= tg.gruppo.movimenti.length && selezionati.length > 0) {
      alert('Nel gruppo "' + tg.gruppo.chiave + '" hai selezionato TUTTI i movimenti (' + selezionati.length + ') \u2014 almeno uno deve restare. Nessun annullamento e\u2019 stato applicato, correggi la selezione e riprova.');
      return;
    }
  }

  var idsDaAnnullare = [];
  Object.keys(selezionatiPerGruppo).forEach(function (k) { idsDaAnnullare = idsDaAnnullare.concat(selezionatiPerGruppo[k]); });
  if (!idsDaAnnullare.length) { alert('Nessun movimento selezionato.'); return; }

  var annullati = 0, errori = [];
  var daSalvare = 0, salvati = 0;
  idsDaAnnullare.forEach(function (id) {
    var m = ecoMovimenti.find(function (x) { return x.id === id; });
    if (!m) { errori.push(id + ': non trovato in ecoMovimenti (gia\' rimosso da un\'altra sessione?)'); return; }
    var r = ecoAnnullaMovimento(m, 'Duplicato individuato dal controllo duplicati BK', m.createdBy);
    if (!r.ok) { errori.push('#' + (m.numeroMovimento || id) + ': ' + r.errore); return; }
    daSalvare++;
    ecoSalvaDocMovimento(m, function () {
      salvati++;
      if (salvati === daSalvare) {
        ecoRenderMovimenti(); ecoRenderScadenzario(); ecoRenderConti();
        ecoImportMostraDuplicatiDB(); // ricontrolla e ridisegna il report aggiornato
      }
    });
    annullati++;
  });

  diag('ecoImportAnnullaDuplicatiSelezionati: ' + annullati + ' annullati, ' + errori.length + ' errori', errori.length ? 'warn' : 'ok');
  if (errori.length) alert(annullati + ' movimento/i annullato/i.\n\n' + errori.length + ' errore/i:\n' + errori.join('\n'));
}

// ── Punto d'ingresso per l'estratto conto CARTA (formato diverso,
// stessa pipeline) — ACCUMULA nello stesso ecoImportElencoCorrente
// invece di sostituirlo, cosi' si puo' caricare prima il PDF bancario
// e poi quello della carta (o viceversa) e revisionare tutto insieme
// in un'unica tabella prima di confermare. ──
// ── Caricamento unico misto: Alberto seleziona insieme file banca e
// file carta (in qualunque combinazione, anche periodi sovrapposti tra
// loro) e questa funzione riconosce da sola il tipo di ciascuno,
// smistandolo al parser giusto — nessun pulsante da scegliere prima.
// Elaborazione VOLUTAMENTE sequenziale (un file alla volta, non in
// parallelo): ogni file deve vedere cosa e' gia' stato estratto dai
// file precedenti in questo stesso lotto per il controllo duplicati
// (ecoImportPreparaElenco/Carta ora accettano un secondo parametro
// proprio per questo — vedi economia-import-banca.js v0.5). File non
// riconoscibili non vengono scartati in silenzio: restano in un elenco
// mostrato a fine caricamento, Alberto decide come trattarli. ──
function ecoImportOnFileMisto(input) {
  var files = Array.from(input.files || []);
  if (!files.length) return;
  var out = document.getElementById('eco-import-esito');
  if (out) out.innerHTML = '<div style="color:var(--gold);padding:16px;text-align:center">Lettura ' + files.length + ' PDF in corso\u2026 (uno alla volta, per il controllo duplicati incrociato)</div>';

  if (typeof loadPdfJs !== 'function') {
    var msgNo = 'ecoImportOnFileMisto: loadPdfJs non disponibile';
    console.error(msgNo);
    if (out) out.innerHTML = '<div style="color:var(--red)">Errore interno: lettore PDF non disponibile.</div>';
    return;
  }

  var nonRiconosciuti = [];
  var riepilogoPerFile = [];

  function processaFile(idx) {
    if (idx >= files.length) {
      // fine lotto: aggiorna la tabella e mostra il riepilogo di cosa e' stato letto da dove
      ecoImportRenderTabella();
      if (nonRiconosciuti.length) {
        var msgIgnoti = nonRiconosciuti.length + ' file non riconosciuti come banca ne\' come carta (non elaborati): ' + nonRiconosciuti.join(', ') + '. Controllali singolarmente con i pulsanti sopra/sotto se sono comunque estratti validi.';
        console.error('[ecoImportOnFileMisto] ' + msgIgnoti);
        alert(msgIgnoti);
      }
      diag('ecoImportOnFileMisto: lotto completo \u2014 ' + riepilogoPerFile.join(' | '), 'ok');
      input.value = '';
      return;
    }
    var file = files[idx];
    ecoImportEstraiTestoPDF(file, function (txt) {
      var tipo = ecoImportRilevaTipoPDF(txt);
      var nuove = [];
      if (tipo === 'BANCA') {
        nuove = ecoImportPreparaElenco(txt, ecoImportElencoCorrente);
        riepilogoPerFile.push(file.name + '\u2192banca(' + nuove.length + ')');
      } else if (tipo === 'CARTA') {
        nuove = ecoImportPreparaElencoCarta(txt, ecoImportElencoCorrente);
        riepilogoPerFile.push(file.name + '\u2192carta(' + nuove.length + ')');
      } else {
        nonRiconosciuti.push(file.name);
        riepilogoPerFile.push(file.name + '\u2192NON RICONOSCIUTO');
      }
      ecoImportElencoCorrente = ecoImportElencoCorrente.concat(nuove);
      if (out) out.innerHTML = '<div style="color:var(--gold);padding:16px;text-align:center">Elaborato ' + (idx + 1) + '/' + files.length + '\u2026</div>';
      processaFile(idx + 1);
    }, function (err) {
      var msg = 'ecoImportOnFileMisto: errore lettura PDF ' + file.name + ': ' + err.message;
      console.error(msg);
      riepilogoPerFile.push(file.name + '\u2192ERRORE LETTURA');
      processaFile(idx + 1); // continua con gli altri file, non blocca l'intero lotto per uno rotto
    });
  }

  loadPdfJs(function () { processaFile(0); });
}

function ecoImportOnFileCartaPdf(input) {
  var files = Array.from(input.files || []);

  if (!files.length) return;
  var out = document.getElementById('eco-import-esito');
  if (out && !ecoImportElencoCorrente.length) out.innerHTML = '<div style="color:var(--gold);padding:16px;text-align:center">Lettura PDF in corso\u2026</div>';

  if (typeof loadPdfJs !== 'function') {
    var msgNo = 'ecoImportOnFileCartaPdf: loadPdfJs non disponibile';
    console.error(msgNo);
    if (out) out.innerHTML = '<div style="color:var(--red)">Errore interno: lettore PDF non disponibile.</div>';
    return;
  }

  loadPdfJs(function () {
    var testi = [];
    var fatti = 0;
    files.forEach(function (file) {
      ecoImportEstraiTestoPDF(file, function (txt) {
        var tipo = ecoImportRilevaTipoPDF(txt);
        if (tipo === 'BANCA') {
          var msgTipo = 'ecoImportOnFileCartaPdf: file "' + file.name + '" rilevato come estratto BANCA, non carta';
          diag(msgTipo, 'warn');
          var continua = confirm('"' + file.name + '" sembra un estratto conto BANCARIO, non della carta Tasca.\n\nSe è davvero l\'estratto banca, annulla e usa il pulsante "PDF estratto conto banca" qui sopra.\n\nSe invece è comunque un estratto carta (il riconoscimento può sbagliare), premi OK per continuare.');
          if (!continua) {
            fatti++;
            if (fatti === files.length && testi.length) {
              var nuove0 = ecoImportPreparaElencoCarta(testi.join('\n'), ecoImportElencoCorrente);
              ecoImportElencoCorrente = ecoImportElencoCorrente.concat(nuove0);
              ecoImportRenderTabella();
            }
            return;
          }
        }
        testi.push(txt);
        fatti++;
        if (fatti === files.length) {
          var nuove = ecoImportPreparaElencoCarta(testi.join('\n'), ecoImportElencoCorrente);
          ecoImportElencoCorrente = ecoImportElencoCorrente.concat(nuove);
          ecoImportRenderTabella();
        }
      }, function (err) {
        var msg = 'ecoImportOnFileCartaPdf: errore lettura PDF ' + file.name + ': ' + err.message;
        console.error(msg);
        if (out) out.innerHTML = '<div style="color:var(--red)">Errore lettura PDF: ' + err.message + '</div>';
      });
    });
  });
  input.value = '';
}

function ecoImportEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function ecoImportRenderTabella() {
  var out = document.getElementById('eco-import-esito');
  if (!out) { console.error('ecoImportRenderTabella: #eco-import-esito non trovato nel DOM'); return; }
  var elenco = ecoImportElencoCorrente;
  if (!elenco.length) { out.innerHTML = '<div class="empty">Nessun movimento trovato nel PDF.</div>'; return; }

  var nuovi = elenco.filter(function (e) { return !e.duplicato && !e.possibileDuplicato && !e.verifica; }).length;
  var dup = elenco.filter(function (e) { return e.duplicato; }).length;
  var possDup = elenco.filter(function (e) { return e.possibileDuplicato; }).length;
  var verifica = elenco.filter(function (e) { return e.verifica; }).length;
  var conAtleta = elenco.filter(function (e) { return e.atleta; }).length;

  var categorie = (ecoConfigCache && ecoConfigCache.categorie) || [];
  var optionsCategorie = '<option value="">(nessuna \u2014 scegli)</option>' +
    categorie.map(function (c) { return '<option value="' + ecoImportEsc(c.codice) + '">' + ecoImportEsc(c.descrizione) + '</option>'; }).join('');

  var h = '<div style="margin:8px 0;display:flex;gap:12px;flex-wrap:wrap;font-size:13px">' +
    '<span style="color:#4aaa6a">' + nuovi + ' nuovi</span>' +
    '<span style="color:var(--muted)">' + dup + ' gi\u00e0 presenti (non selezionati)</span>' +
    '<span style="color:#c88a4b">' + possDup + ' possibili duplicati \u2014 nessun riferimento univoco, verifica tu (non selezionati)</span>' +
    '<span style="color:#c8a84b">' + verifica + ' da verificare (non selezionati)</span>' +
    '<span style="color:var(--blue)">' + conAtleta + ' abbinate ad atleta</span></div>';

  h += '<div style="max-height:50vh;overflow-y:auto">';
  elenco.forEach(function (e, i) {
    var badge = e.duplicato ? '<span class="badge" style="background:#55555522;color:#888">GI\u00c0 PRESENTE (' + ecoImportEsc(e.criterioDedup) + ')</span>'
      : e.possibileDuplicato ? '<span class="badge" style="background:#c88a4b22;color:#c88a4b">POSSIBILE DUPLICATO \u2014 verifica</span>'
      : e.verifica ? '<span class="badge" style="background:#c8a84b22;color:#c8a84b">VERIFICA</span>'
      : '<span class="badge" style="background:#4aaa6a22;color:#4aaa6a">NUOVO</span>';

    var rigaAtleta = '';
    if (e.importo > 0) {
      if (e.atleta) {
        var badgePag = e.pagamentoGiaPresente
          ? '<span class="badge" style="background:#55555522;color:#888">PAGAMENTO GI\u00c0 PRESENTE</span>'
          : '<span class="badge" style="background:#4aaa6a22;color:#4aaa6a">NUOVO PAGAMENTO</span>';
        rigaAtleta = '<div style="display:flex;align-items:center;gap:8px;padding-left:26px;margin-top:4px">' +
          '<input type="checkbox" id="eco-imp-pag-' + i + '" ' + (e.pagamentoSelezionato ? 'checked' : '') + ' onchange="ecoImportElencoCorrente[' + i + '].pagamentoSelezionato=this.checked">' +
          '<span style="font-size:12px">Pagamento atleta: <b>' + ecoImportEsc(e.atleta.cog) + ' ' + ecoImportEsc(e.atleta.nom) + '</b> <span style="color:var(--muted)">(' + ecoImportEsc(e.atletaFonteTrovato) + ')</span></span> ' + badgePag +
          '</div>';
      } else if (e.atletaMotivoFallback) {
        rigaAtleta = '<div style="font-size:11px;color:var(--muted);padding-left:26px;margin-top:2px">Nessun pagamento atleta abbinato: ' + ecoImportEsc(e.atletaMotivoFallback) + '</div>';
      }
    }

    h += '<div class="op-row" style="align-items:flex-start;flex-direction:column;gap:4px;padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<div style="display:flex;align-items:center;gap:8px;width:100%">' +
      '<input type="checkbox" id="eco-imp-sel-' + i + '" ' + (e.selezionato ? 'checked' : '') + ' onchange="ecoImportElencoCorrente[' + i + '].selezionato=this.checked">' +
      '<span style="font-weight:700">' + ecoImportEsc(e.dataContabile) + '</span>' +
      '<span style="color:' + (e.importo >= 0 ? '#4aaa6a' : '#e03545') + '">\u20ac' + e.importo.toFixed(2) + '</span>' +
      badge + '</div>' +
      '<div style="font-size:11px;color:var(--muted);padding-left:26px">Movimento Economia \u2014 ' + ecoImportEsc(e.descrizione.substring(0, 160)) + (e.descrizione.length > 160 ? '\u2026' : '') + '</div>' +
      (e.notaCategoria ? '<div style="font-size:11px;color:#c8a84b;padding-left:26px">' + ecoImportEsc(e.notaCategoria) + '</div>' : '') +
      '<div style="padding-left:26px"><select onchange="ecoImportElencoCorrente[' + i + '].categoriaCodice=this.value">' +
      optionsCategorie.replace('value="' + ecoImportEsc(e.categoriaCodice || '') + '"', 'value="' + ecoImportEsc(e.categoriaCodice || '') + '" selected') +
      '</select></div>' +
      rigaAtleta +
      '</div>';
  });
  h += '</div>';
  h += '<div class="btn-bar" style="margin-top:10px">' +
    '<button class="btn btn-gray" onclick="ecoImportSelTutti(false)">Deseleziona tutto</button>' +
    '<button class="btn btn-gold" onclick="ecoImportSelTutti(true)">Seleziona tutti i NUOVI (economia + pagamenti)</button>' +
    '<button class="btn btn-green" onclick="ecoImportConferma()">Importa selezionati</button>' +
    '</div>';
  out.innerHTML = h;
}

function ecoImportSelTutti(v) {
  ecoImportElencoCorrente.forEach(function (e, i) {
    e.selezionato = v ? (!e.duplicato && !e.possibileDuplicato) : false;
    e.pagamentoSelezionato = v ? (!!e.atleta && !e.pagamentoGiaPresente) : false;
    var cb = document.getElementById('eco-imp-sel-' + i);
    if (cb) cb.checked = e.selezionato;
    var cbPag = document.getElementById('eco-imp-pag-' + i);
    if (cbPag) cbPag.checked = e.pagamentoSelezionato;
  });
}

// ── Conferma: per ogni riga, le due scritture (movimento Economia e
// pagamento atleta) sono TENTATE E VALUTATE INDIPENDENTEMENTE — se una
// fallisce (es. categoria mancante, max 5 pagamenti/anno raggiunto),
// l'altra si salva comunque, e l'errore specifico viene riportato per
// quella sola riga/lato, mai un fallimento silenzioso ne' un blocco
// dell'intero import per un singolo problema. ──
function ecoImportConferma() {
  var righeEconomia = ecoImportElencoCorrente.filter(function (e) { return e.selezionato; });
  var righePagamento = ecoImportElencoCorrente.filter(function (e) { return e.pagamentoSelezionato; });
  if (!righeEconomia.length && !righePagamento.length) { alert('Nessuna riga selezionata.'); return; }

  var senzaCategoria = righeEconomia.filter(function (e) { return !e.categoriaCodice; });
  if (senzaCategoria.length) {
    alert(senzaCategoria.length + ' riga/e movimento Economia selezionata/e senza categoria \u2014 scegli una categoria per ciascuna prima di importare.');
    return;
  }

  var contoDefault = (ecoConti || []).find(function (c) { return c.tipo === 'BANCA'; });
  if (righeEconomia.length && !contoDefault) {
    var msg = 'ecoImportConferma: nessun conto di tipo BANCA configurato in Economia \u2014 crealo prima (tab Conti).';
    console.error(msg);
    alert(msg);
    return;
  }

  var movCreati = 0, movErrori = [];
  righeEconomia.forEach(function (e) {
    var tipoMovimento = e.importo >= 0 ? 'ENTRATA' : 'USCITA';
    var annoEsercizio = parseInt(ecoImportISOData(e.dataContabile).substring(0, 4), 10) || ecoAnnoCorrente;
    var m = {
      id: ecoNewId('MOV'), tipoMovimento: tipoMovimento, importoEur: Math.abs(e.importo),
      categoriaCodice: e.categoriaCodice, sottocategoriaCodice: null, centroCostoCodice: null,
      contoFinanziarioId: contoDefault.id, dataDocumento: ecoImportISOData(e.dataContabile),
      dataScadenza: null, annoEsercizio: annoEsercizio, numeroDocumento: null,
      note: e.descrizione.substring(0, 300), stato: 'PAGATO', dataPagamento: ecoImportISOData(e.dataValuta),
      metodoPagamento: 'bonifico', riferimentoBancario: e.riferimento ? e.riferimento.valore : null,
      dataRegistrazione: new Date().toISOString(), createdAt: new Date().toISOString(),
      createdBy: (window.firebase && firebase.auth().currentUser) ? firebase.auth().currentUser.email : ''
    };
    m.numeroMovimento = ecoNextNumeroMovimento(ecoMovimenti.filter(function (x) { return x.annoEsercizio === annoEsercizio; }), annoEsercizio);
    var esito = ecoValidaMovimento(m, ecoConfigCache, {});
    if (!esito.valido) { movErrori.push(e.dataContabile + ' \u20ac' + e.importo.toFixed(2) + ' [Economia]: ' + esito.errori.join(', ')); return; }
    ecoMovimenti.push(m);
    ecoSalvaDocMovimento(m);
    movCreati++;
  });

  var pagCreati = 0, pagErrori = [];
  righePagamento.forEach(function (e) {
    if (!e.atleta) { pagErrori.push(e.dataContabile + ' \u20ac' + e.importo.toFixed(2) + ' [Pagamento]: atleta non abbinato (incoerenza interna, riga saltata)'); return; }
    var id = e.atleta.id;
    var pags = DB.pagamenti[id] || [];
    if (pags.length >= 5) { pagErrori.push(e.dataContabile + ' \u20ac' + e.importo.toFixed(2) + ' [Pagamento ' + e.atleta.cog + ']: massimo 5 pagamenti/anno gi\u00e0 raggiunto'); return; }
    var dataISO = ecoImportISOData(e.dataContabile);
    if (ecoImportPagamentoGiaPresente(id, dataISO, e.importo)) { pagErrori.push(e.dataContabile + ' \u20ac' + e.importo.toFixed(2) + ' [Pagamento ' + e.atleta.cog + ']: diventato duplicato nel frattempo, saltato'); return; }
    var tipo = (typeof _classificaTipoPDF === 'function') ? _classificaTipoPDF(e.descrizione.toUpperCase()) : 'Quota annuale';
    pags.push({ tipo: tipo, importo: e.importo, data: dataISO, metodo: 'Bonifico', note: e.descrizione.substring(0, 80), det: true });
    DB.pagamenti[id] = pags;
    pagCreati++;
  });
  if (pagCreati > 0 && typeof saveDB === 'function') saveDB();

  if (movCreati > 0 || righeEconomia.length) { ecoRenderMovimenti(); ecoRenderScadenzario(); ecoRenderConti(); }

  var riepilogo = movCreati + ' movimenti Economia importati, ' + pagCreati + ' pagamenti atleta importati.';
  if (movErrori.length) riepilogo += '\n\n' + movErrori.length + ' movimento/i Economia NON importato/i:\n' + movErrori.join('\n');
  if (pagErrori.length) riepilogo += '\n\n' + pagErrori.length + ' pagamento/i NON importato/i:\n' + pagErrori.join('\n');
  alert(riepilogo);
  diag('ecoImportConferma: mov ' + movCreati + '/' + movErrori.length + ' errori, pag ' + pagCreati + '/' + pagErrori.length + ' errori', (movErrori.length || pagErrori.length) ? 'warn' : 'ok');

  ecoImportElencoCorrente = ecoImportElencoCorrente.filter(function (e) { return !e.selezionato && !e.pagamentoSelezionato; });
  ecoImportRenderTabella();
}

window.addEventListener('error', function (e) {
  var msg = '[economia-import-banca-ui] errore non gestito: ' + (e.error && e.error.message || e.message);
  console.error(msg);
  if (typeof diag === 'function') diag(msg, 'err');
});
window.addEventListener('unhandledrejection', function (e) {
  var msg = '[economia-import-banca-ui] promise non gestita: ' + (e.reason && e.reason.message || e.reason);
  console.error(msg);
  if (typeof diag === 'function') diag(msg, 'err');
});
