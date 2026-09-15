// ────────────────────────────────────────────────────────────
// FILE: economia-import-banca-ui.js — ASD Basket Campodarsego
// VERSIONE: v0.3 · 15/09/2026 · BK
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
        testi.push(txt);
        fatti++;
        if (fatti === files.length) {
          var nuove = ecoImportPreparaElenco(testi.join('\n'));
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

// ── Punto d'ingresso per l'estratto conto CARTA (formato diverso,
// stessa pipeline) — ACCUMULA nello stesso ecoImportElencoCorrente
// invece di sostituirlo, cosi' si puo' caricare prima il PDF bancario
// e poi quello della carta (o viceversa) e revisionare tutto insieme
// in un'unica tabella prima di confermare. ──
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
        testi.push(txt);
        fatti++;
        if (fatti === files.length) {
          var nuove = ecoImportPreparaElencoCarta(testi.join('\n'));
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

  var nuovi = elenco.filter(function (e) { return !e.duplicato && !e.verifica; }).length;
  var dup = elenco.filter(function (e) { return e.duplicato; }).length;
  var verifica = elenco.filter(function (e) { return e.verifica; }).length;
  var conAtleta = elenco.filter(function (e) { return e.atleta; }).length;

  var categorie = (ecoConfigCache && ecoConfigCache.categorie) || [];
  var optionsCategorie = '<option value="">(nessuna \u2014 scegli)</option>' +
    categorie.map(function (c) { return '<option value="' + ecoImportEsc(c.codice) + '">' + ecoImportEsc(c.descrizione) + '</option>'; }).join('');

  var h = '<div style="margin:8px 0;display:flex;gap:12px;flex-wrap:wrap;font-size:13px">' +
    '<span style="color:#4aaa6a">' + nuovi + ' nuovi</span>' +
    '<span style="color:var(--muted)">' + dup + ' gi\u00e0 presenti (non selezionati)</span>' +
    '<span style="color:#c8a84b">' + verifica + ' da verificare (non selezionati)</span>' +
    '<span style="color:var(--blue)">' + conAtleta + ' abbinate ad atleta</span></div>';

  h += '<div style="max-height:50vh;overflow-y:auto">';
  elenco.forEach(function (e, i) {
    var badge = e.duplicato ? '<span class="badge" style="background:#55555522;color:#888">GI\u00c0 PRESENTE (' + ecoImportEsc(e.criterioDedup) + ')</span>'
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
    e.selezionato = v ? (!e.duplicato) : false;
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
