// ════════════════════════════════════════════════════════
// FILE: documenti-pdf.js — ASD Basket Campodarsego
// VERSIONE: v0.2 · 20/11/2026 15:00 · BK
// v0.2: RIEPILOGO PAGAMENTI ANNO per la detrazione (stesso impianto di "Ricevuta anno"
//   del gestionale): solo pagamenti detraibili, codici fiscali di chi paga e dell'atleta.
// v0.1 (richiesta Alberto 20/11/2026): documenti PDF pronti da mandare.
//   1) RICEVUTA di un pagamento (es. "Brugnolo Andrea ha pagato 20 euro per
//      assicurazione e tesseramento, fammi la ricevuta"): numero nello stesso
//      registro ricevute del gestionale (AAAA-NNN), logo, firma, dati societa'.
//      Niente codici fiscali (si manda via WhatsApp): il riepilogo annuale per
//      la detrazione resta quello del gestionale.
//   2) MODULO DI RIMBORSO SPESE per gli anticipi di Alberto, gia' compilato.
//   Condivisione: menu del telefono (WhatsApp, mail...) con il PDF allegato;
//   se il telefono non lo permette, il PDF si scarica.
// Gratuito: jsPDF da cdnjs (come il gestionale), nessun servizio esterno.
// Dipende da: jsPDF 2.5.1, spese-rapide.js (srEsc, srEuro, srDataIt, srOggi, srLog).
// ════════════════════════════════════════════════════════

var DP_VERSIONE = 'v0.2 · 20/11/2026 15:00';
var DP_SOCIETA = {
  nome: 'A.S.D. BASKET CAMPODARSEGO',
  righe: ['Via Pioga 254 - 35011 CAMPODARSEGO (PD)', 'C.F. 92201430284 – P.IVA 04322580285', 'Segreteria Tel. 389.4759392', 'basketcampodarsego@gmail.com | basketcampodarsego@pec.it'],
  presidente: 'Alberto Scarin'
};
var DP = { logo: null, firma: null, ultimo: null };

// ── importo in lettere (per ricevute e moduli): 20 -> "venti/00" ──
function dpLettere(n) {
  var u = ['', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove'];
  var d = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];
  function sotto100(x) {
    if (x < 20) return u[x];
    var t = d[Math.floor(x / 10)], r = x % 10;
    if (r === 1 || r === 8) t = t.slice(0, -1);
    return t + u[r];
  }
  function sotto1000(x) {
    var c = Math.floor(x / 100), r = x % 100;
    var s = c === 0 ? '' : c === 1 ? 'cento' : u[c] + 'cento';
    if (c && Math.floor(r / 10) === 8) s = s.slice(0, -1); // centottanta
    return s + sotto100(r);
  }
  var cent = Math.round(Math.abs(n) * 100), intero = Math.floor(cent / 100), dec = cent % 100;
  var mig = Math.floor(intero / 1000), resto = intero % 1000;
  var s = (mig === 0 ? '' : mig === 1 ? 'mille' : sotto1000(mig) + 'mila') + sotto1000(resto);
  return (s || 'zero') + '/' + String(dec).padStart(2, '0');
}

// Causale della ricevuta dal tipo di pagamento del gestionale
function dpCausale(tipo, stagione) {
  var t = String(tipo || '');
  var base = /assicuraz/i.test(t) ? 'Tesseramento e assicurazione' : /divisa/i.test(t) ? 'Divisa sportiva' : /^altro$/i.test(t) ? 'Contributo' : 'Quota attività sportiva' + (/rata|saldo/i.test(t) ? ' – ' + t.replace(/^Quota\s*/i, '').replace(/[()]/g, '') : '');
  return base + (stagione ? ' – stagione ' + stagione : '');
}

function dpCaricaImmagini() {
  if (DP.logo !== null && DP.firma !== null) return Promise.resolve();
  function b64(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.blob(); }).then(function (bl) {
      return new Promise(function (ok) { var fr = new FileReader(); fr.onloadend = function () { ok(String(fr.result).split(',')[1] || ''); }; fr.readAsDataURL(bl); });
    }).catch(function (err) { srLog('Immagine non caricata (' + err.message + '): il PDF esce senza', 'warn'); return ''; });
  }
  return Promise.all([b64('logo.jpg'), b64('firma.png')]).then(function (x) { DP.logo = x[0]; DP.firma = x[1]; });
}
function dpJsPDF() {
  var J = window.jspdf && window.jspdf.jsPDF;
  if (!J) throw new Error('libreria PDF non caricata (serve connessione la prima volta)');
  return new J({ orientation: 'portrait', unit: 'mm', format: 'a4' });
}
function dpIntestazione(doc, titolo, sotto) {
  var y = 14;
  if (DP.logo) { try { doc.addImage('data:image/jpeg;base64,' + DP.logo, 'JPEG', 90, y, 30, 30); y += 40; } catch (e) { srLog('Logo nel PDF: ' + e.message, 'warn'); y += 4; } } else y += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(titolo, 105, y, { align: 'center' }); y += 7;
  if (sotto) { doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.text(sotto, 105, y, { align: 'center' }); y += 6; }
  return y + 4;
}
function dpFirmaEPiede(doc, y, etichetta) {
  var tx = 130;
  // etichetta, poi la firma, poi il nome stampato (niente sovrapposizioni)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(etichetta || 'Il presidente', tx, y);
  if (DP.firma) { try { doc.addImage('data:image/png;base64,' + DP.firma, 'PNG', tx - 4, y + 1, 50, 19); } catch (e) { srLog('Firma nel PDF: ' + e.message, 'warn'); } }
  doc.setFont('helvetica', 'italic'); doc.text(DP_SOCIETA.presidente, tx, y + 24);
  dpPiede(doc);
}
function dpPiede(doc) {
  var y = 272;
  doc.setDrawColor(180); doc.line(20, y - 4, 190, y - 4);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(DP_SOCIETA.nome, 105, y, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  DP_SOCIETA.righe.forEach(function (l, i) { doc.text(l, 105, y + 4 + i * 3.4, { align: 'center' }); });
}
function dpRiga(doc, y, etichetta, valore, larg) {
  larg = larg || 45;
  doc.setDrawColor(150); doc.rect(20, y, larg, 8); doc.rect(20 + larg, y, 170 - larg, 8);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(etichetta, 22, y + 5.4);
  doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(String(valore || ''), 170 - larg - 4)[0] || '', 22 + larg, y + 5.4);
  return y + 8;
}

// ── 1) RICEVUTA ──
// r = { numero, dataEmissione, pagante, atleta, importo, dataPagamento, metodo, causale }
function dpRicevutaPDF(r) {
  var doc = dpJsPDF();
  var y = dpIntestazione(doc, 'RICEVUTA N. ' + r.numero, 'Campodarsego, ' + srDataIt(r.dataEmissione));
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text('L\'associazione sportiva dilettantistica ' + DP_SOCIETA.nome + ' dichiara di aver ricevuto', 20, y, { maxWidth: 170 }); y += 10;
  y = dpRiga(doc, y, 'Da', r.pagante);
  y = dpRiga(doc, y, 'La somma di', 'Euro ' + Number(r.importo).toFixed(2).replace('.', ',') + '  (' + dpLettere(r.importo) + ')');
  y = dpRiga(doc, y, 'Causale', r.causale);
  if (r.atleta && r.atleta !== r.pagante) y = dpRiga(doc, y, 'Per l\'atleta', r.atleta);
  y = dpRiga(doc, y, 'Pagato', (r.metodo || '').toLowerCase() + ' il ' + srDataIt(r.dataPagamento));
  y += 8;
  doc.setFontSize(9);
  ['Prestazione sportiva dilettantistica non soggetta ad IVA per mancanza dei presupposti di cui all\'art. 4, DPR 633/1972.',
    'Ricevuta esente da imposta di bollo ai sensi della Tabella art. 7, ultimo comma, allegata al DPR 642/1972.'].forEach(function (t) {
    var l = doc.splitTextToSize(t, 170); doc.text(l, 20, y); y += l.length * 4.3 + 1.5;
  });
  dpFirmaEPiede(doc, y + 18);
  return doc;
}

// ── 1b) RIEPILOGO ANNUALE DETRAIBILE ──
// r = { numero, anno, dataEmissione, pagamenti:[{data, importo}], totale, nonDetraibili, pagante:{nome,cf,via,comune}, causale, atleta:{nome,natoA,dn,cf} }
function dpRiepilogoPDF(r) {
  var doc = dpJsPDF();
  var y = dpIntestazione(doc, 'RIEPILOGO PAGAMENTI ANNO ' + r.anno, 'N. ' + r.numero + ' · Campodarsego, ' + srDataIt(r.dataEmissione));
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text('Con la presente si attesta di aver ricevuto la somma di', 20, y); y += 7;
  r.pagamenti.forEach(function (p, i) {
    doc.setDrawColor(150); doc.rect(20, y, 40, 7); doc.rect(60, y, 60, 7); doc.rect(120, y, 70, 7);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(r.pagamenti.length > 1 ? 'RATA ' + (i + 1) : 'EURO', 22, y + 4.8);
    doc.setFont('helvetica', 'normal'); doc.text(Number(p.importo || 0).toFixed(2).replace('.', ','), 62, y + 4.8); doc.text(srDataIt(p.data) + (p.metodo ? ' · ' + String(p.metodo).toLowerCase() : ''), 122, y + 4.8);
    y += 7;
  });
  if (r.pagamenti.length > 1) {
    y += 2; doc.rect(20, y, 40, 7); doc.rect(60, y, 60, 7); doc.rect(120, y, 70, 7);
    doc.setFont('helvetica', 'bold'); doc.text('TOTALE', 22, y + 4.8); doc.text(Number(r.totale).toFixed(2).replace('.', ','), 62, y + 4.8); y += 7;
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.text('(' + dpLettere(r.totale) + ')', 22, y + 4.5); y += 8;
  y = dpRiga(doc, y, 'Dal sig./sig.ra', r.pagante.nome);
  y = dpRiga(doc, y, 'Residente in', r.pagante.comune);
  y = dpRiga(doc, y, 'Indirizzo', r.pagante.via);
  y = dpRiga(doc, y, 'Codice Fiscale', r.pagante.cf); y += 3;
  y = dpRiga(doc, y, 'Causale', r.causale); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text('Per l\'esercizio dell\'attività sportiva dilettantistica di:', 20, y); y += 5;
  y = dpRiga(doc, y, 'Atleta', r.atleta.nome);
  y = dpRiga(doc, y, 'Nato a', r.atleta.natoA || '-');
  y = dpRiga(doc, y, 'Il', r.atleta.dn);
  y = dpRiga(doc, y, 'Codice Fiscale', r.atleta.cf); y += 5;
  doc.setFontSize(9);
  ['Altresì si dichiara che per tale somma si ha diritto ad usufruire di una detrazione d\'imposta IRPEF pari al 19% dell\'importo pagato fino ad un massimo di Euro 210,00 su base annua e complessivo per ciascuna persona che effettua il pagamento, ai sensi dell\'art. 15, co 1, lett i-quinques, DPR 917/1986 e relativo decreto di attuazione.',
    'Prestazione sportiva dilettantistica non soggetta ad IVA per mancanza dei presupposti di cui all\'art 4, DPR 633/1972.',
    'Riepilogo esente da imposta di bollo ai sensi della Tabella art 7, ultimo comma, allegata al DPR 642/1972.']
    .concat(r.nonDetraibili ? ['Non compresi nel presente riepilogo, perché non detraibili, altri versamenti dell\'anno per Euro ' + Number(r.nonDetraibili).toFixed(2).replace('.', ',') + ' (tesseramento e assicurazione, divisa, contanti).'] : [])
    .forEach(function (t) { var l = doc.splitTextToSize(t, 170); doc.text(l, 20, y); y += l.length * 4.2 + 1.5; });
  if (y > 238) { dpPiede(doc); doc.addPage(); y = 20; } // firma (26 mm) prima del piede a 268
  dpFirmaEPiede(doc, y + 4);
  return doc;
}

// ── 2) MODULO DI RIMBORSO SPESE ──
// m = { numero, data, richiedente, ruolo, spese:[{data, voce, descrizione, centro, documento, importo}], modo, periodo }
function dpRimborsoPDF(m) {
  var doc = dpJsPDF();
  var y = dpIntestazione(doc, 'RICHIESTA DI RIMBORSO SPESE', (m.periodo ? m.periodo + ' · ' : '') + 'Campodarsego, ' + srDataIt(m.data));
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
  var intro = 'Il sottoscritto ' + m.richiedente + ', ' + m.ruolo + ' di ' + DP_SOCIETA.nome + ', dichiara di aver sostenuto personalmente, per conto dell\'associazione e nell\'ambito delle sue attività istituzionali, le spese sotto elencate, documentate dai giustificativi conservati in archivio, e ne chiede il rimborso.';
  var li = doc.splitTextToSize(intro, 170); doc.text(li, 20, y); y += li.length * 5 + 4;
  var cols = [{ h: 'Data', w: 20 }, { h: 'Voce', w: 38 }, { h: 'Descrizione', w: 56 }, { h: 'Centro', w: 20 }, { h: 'Doc.', w: 16 }, { h: 'Importo', w: 20 }];
  var testata = function () {
    doc.setFillColor(235, 235, 235); doc.rect(20, y, 170, 7, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    var x = 20; cols.forEach(function (c, i) { doc.text(c.h, i === 5 ? x + c.w - 1 : x + 1, y + 4.8, i === 5 ? { align: 'right' } : undefined); x += c.w; }); y += 7;
  };
  testata();
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  var tot = 0;
  m.spese.forEach(function (s) {
    var desc = doc.splitTextToSize(String(s.descrizione || ''), cols[2].w - 2).slice(0, 2), voce = doc.splitTextToSize(String(s.voce || ''), cols[1].w - 2).slice(0, 2);
    var h = Math.max(desc.length, voce.length) * 4 + 3;
    if (y + h > 225) { dpPiede(doc); doc.addPage(); y = 20; testata(); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); }
    var x = 20;
    doc.text(srDataIt(s.data), x + 1, y + 4); x += cols[0].w;
    doc.text(voce, x + 1, y + 4); x += cols[1].w;
    doc.text(desc, x + 1, y + 4); x += cols[2].w;
    doc.text(String(s.centro || ''), x + 1, y + 4); x += cols[3].w;
    doc.text(String(s.documento || ''), x + 1, y + 4); x += cols[4].w;
    doc.text(Number(s.importo).toFixed(2).replace('.', ','), x + cols[5].w - 1, y + 4, { align: 'right' });
    tot += Number(s.importo) || 0;
    y += h; doc.setDrawColor(210); doc.line(20, y - 1, 190, y - 1);
  });
  tot = Math.round(tot * 100) / 100;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('TOTALE', 20 + 1, y + 5); doc.text('Euro ' + tot.toFixed(2).replace('.', ','), 190 - 1, y + 5, { align: 'right' }); y += 9;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text('(' + dpLettere(tot) + ')', 190 - 1, y, { align: 'right' }); y += 8;
  if (y > 225) { dpPiede(doc); doc.addPage(); y = 20; }
  doc.text('Modalità di rimborso richiesta: ' + (m.modo === 'CONTANTI' ? 'contanti dalla cassa sociale' : 'bonifico bancario') + '.', 20, y); y += 16;
  if (y > 230) { dpPiede(doc); doc.addPage(); y = 20; }
  doc.text('Il richiedente', 20, y); doc.text('Per approvazione (consiglio direttivo)', 120, y);
  if (DP.firma) { try { doc.addImage('data:image/png;base64,' + DP.firma, 'PNG', 16, y + 1, 50, 19); } catch (e) { srLog('Firma nel PDF: ' + e.message, 'warn'); } }
  doc.setFont('helvetica', 'italic'); doc.text(m.richiedente, 20, y + 24);
  doc.setDrawColor(120); doc.line(120, y + 20, 188, y + 20);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text('nome e firma (vicepresidente o segretario)', 120, y + 24);
  dpPiede(doc);
  return { doc: doc, totale: tot };
}

// ── condivisione / download ──
function dpFile(doc, nome) { return new File([doc.output('blob')], nome, { type: 'application/pdf' }); }
function dpCondividi(doc, nome, testo) {
  var f = dpFile(doc, nome);
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    return navigator.share({ files: [f], title: nome, text: testo || '' }).then(function () { srLog('PDF condiviso: ' + nome, 'ok'); }).catch(function (err) {
      if (err && err.name === 'AbortError') { srLog('Condivisione annullata: ' + nome, 'info'); return; }
      srLog('Condivisione non riuscita (' + (err && err.message) + '): scarico il PDF', 'warn'); dpScarica(doc, nome);
    });
  }
  srLog('Il telefono non permette di condividere file: scarico il PDF ' + nome, 'warn');
  dpScarica(doc, nome);
  return Promise.resolve();
}
function dpScarica(doc, nome) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(doc.output('blob')); a.download = nome;
  document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

// ── azioni sul PDF pronto: due tocchi (il telefono vuole un tocco "fresco" per aprire WhatsApp) ──
function dpMostraAzioni(elId, doc, nome, testo) {
  DP.ultimo = { doc: doc, nome: nome, testo: testo };
  var el = document.getElementById(elId); if (!el) return;
  el.innerHTML = '<div class="ok-msg" style="margin-top:8px">📄 ' + srEsc(nome) + ' pronto.</div>' +
    '<div style="display:flex;gap:8px;margin-top:6px"><button class="btn-green btn-sm" style="flex:1" onclick="dpInviaUltimo()">📤 Invia (WhatsApp…)</button>' +
    '<button class="btn-gray btn-sm" style="flex:1" onclick="dpScaricaUltimo()">⬇️ Scarica PDF</button></div>';
}
function dpInviaUltimo() { if (!DP.ultimo) return; dpCondividi(DP.ultimo.doc, DP.ultimo.nome, DP.ultimo.testo); }
function dpScaricaUltimo() { if (!DP.ultimo) return; dpScarica(DP.ultimo.doc, DP.ultimo.nome); }

// ── modulo di rimborso dalla pagina Rimborsi: 'SEL' = spese selezionate, 'MESE' = anticipi del mese scelto ──
function dpModuloRimborso(quali) {
  var out = 'rimb-pdf', el = document.getElementById(out), lista, periodo = '';
  if (quali === 'SEL') lista = srAnticipiAperti().filter(function (m) { return SR.rimbSel[m.id]; });
  else {
    var mese = document.getElementById('nota-mese').value;
    if (!mese) { el.innerHTML = '<div class="errore">Scegli il mese.</div>'; return; }
    lista = SR.anticipi.filter(function (m) { return m.stato !== 'ANNULLATO' && (m.dataDocumento || '').slice(0, 7) === mese; });
    var p = mese.split('-'); periodo = new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  }
  if (!lista.length) { el.innerHTML = '<div class="errore">' + (quali === 'SEL' ? 'Seleziona almeno una spesa da rimborsare.' : 'Nessuna spesa anticipata in quel mese.') + '</div>'; return; }
  lista = lista.slice().sort(function (a, b) { return (a.dataDocumento || '').localeCompare(b.dataDocumento || ''); });
  el.innerHTML = '<div class="domanda">Preparo il modulo…</div>';
  dpCaricaImmagini().then(function () {
    var r = dpRimborsoPDF({ data: srOggi(), richiedente: DP_SOCIETA.presidente, ruolo: 'presidente', periodo: periodo, modo: SR.rimbModo,
      spese: lista.map(function (m) { var c = srCentroDi(m); return { data: m.dataDocumento, voce: srNomeCategoria(m.categoriaCodice), descrizione: m.note || '', centro: c === 'PALESTRA' ? 'Palestra' : c === 'SPORT' ? 'Società' : '', documento: (typeof SR_DOCUMENTI !== 'undefined' && SR_DOCUMENTI[m.documento]) || '', importo: m.importoEur }; }) });
    var nome = 'Rimborso_spese_' + (periodo ? periodo.replace(/\s+/g, '_') : srOggi()) + '.pdf';
    dpMostraAzioni(out, r.doc, nome, 'Richiesta di rimborso spese: ' + lista.length + ' spese, totale ' + srEuro(r.totale));
    srLog('Modulo rimborso pronto: ' + lista.length + ' spese, ' + r.totale + ' €', 'ok');
  }).catch(function (err) { srLog('Modulo rimborso non creato: ' + err.message, 'err'); el.innerHTML = '<div class="errore">Modulo non creato: ' + srEsc(err.message) + '</div>'; });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { dpLettere: dpLettere, dpCausale: dpCausale };
