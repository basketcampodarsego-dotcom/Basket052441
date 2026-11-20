// ════════════════════════════════════════════════════════
// FILE: dittafono-import.js — ASD Basket Campodarsego
// VERSIONE: v0.1 · 20/11/2026 18:00 · BK
// v0.1 (richiesta Alberto 20/11/2026: "un unico caricamento con tutte le
//   informazioni gia' passate con la lista atleti", "diminuire al massimo
//   l'intervento manuale"): IMPORT IN BLOCCO della tabella Atleti del foglio
//   dell'agente IA, con UNA revisione e "Applica tutto":
//   - atleti gia' in anagrafica: proposte campo per campo (scadenza
//     certificato, nascita, comune, documenti, quota annua, sconto fratello,
//     iscrizione alla stagione). Campo vuoto -> proposta gia' spuntata;
//     valore diverso -> proposta NON spuntata (si decide guardando);
//   - atleti nuovi: scheda creata con iscrizione alla stagione (da completare
//     da tastiera con i dati personali);
//   - pagamenti del foglio non ancora nel gestionale: pagamento sulla scheda +
//     entrata in Economia (metodo predefinito bonifico: l'import dell'estratto
//     conto li abbinera'); quelli gia' presenti (stessa data e importo) saltati;
//   - le note del dittafono gia' importate dal foglio vengono chiuse come
//     "assorbite dall'import" (niente da rifare a mano una per una).
//   Tutto in UNA transazione; nessun codice fiscale nel file del foglio.
// Dipende da: dittafono.js, dittafono-gestionale.js, spese-rapide.js, economia-core-DRAFT.js.
// ════════════════════════════════════════════════════════

var DFI_VERSIONE = 'v0.1 · 20/11/2026 18:00';
var DFI = { righe: [], dati: null };
var DFI_CAT = [[/^pulcini/i, 'Pulcini'], [/^scoiattoli/i, 'Scoiattoli'], [/^aquilotti/i, 'Aquilotti'], [/^esordienti/i, 'Esordienti'], [/special\s*[–-]\s*partner/i, 'Special', true],
  [/pallacanestro special|^special/i, 'Special'], [/pallacanestro amatoriale|basket amatori/i, 'AmaBasket'], [/pallavolo amatoriale|volley/i, 'AmaVolley'], [/dirigenza|dirigente/i, 'Dirigente'], [/volontari/i, 'Volontario']];
var DFI_PREFISSI = ['el', 'de', 'da', 'di', 'dal', 'del', 'della', 'la', 'lo', 'van', 'von', 'mc'];

// ── puri ──
function dfiDist(a, b) { // distanza di modifica (Levenshtein)
  var m = [], i, j; for (i = 0; i <= a.length; i++) { m[i] = [i]; } for (j = 0; j <= b.length; j++) m[0][j] = j;
  for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}
// Atleti dell'anagrafica che potrebbero essere la stessa persona scritta diversamente (Baldo/Balbo, Marconato/Martellato)
function dfiSimili(nominativo, atleti, usati) {
  var nn = dfiSeparaNome(nominativo), cog = dfNorm(nn.cog), nom = dfNorm(nn.nom).split(' ')[0];
  if (!nom) return [];
  return atleti.filter(function (a) {
    if (usati[a.id]) return false;
    var ac = dfNorm(a.cog), an = dfNorm(a.nom).split(' ')[0];
    if (an !== nom || ac === cog) return false;
    return dfiDist(ac, cog) <= 2 || (ac.slice(0, 3) === cog.slice(0, 3) && Math.abs(ac.length - cog.length) <= 2);
  });
}
function dfiCategoria(s) { for (var i = 0; i < DFI_CAT.length; i++) if (DFI_CAT[i][0].test(String(s || ''))) return { cat: DFI_CAT[i][1], partner: !!DFI_CAT[i][2] }; return null; }
// "El Hattabi Nasim" -> {cog:'EL HATTABI', nom:'Nasim'}; "Zanetti Leonardo Paolo" -> {cog:'ZANETTI', nom:'Leonardo Paolo'}
function dfiSeparaNome(n) {
  var p = String(n || '').trim().split(/\s+/), k = 1;
  while (k < p.length - 1 && DFI_PREFISSI.indexOf(p[k - 1].toLowerCase()) >= 0) k++;
  return { cog: p.slice(0, k).join(' ').toUpperCase(), nom: p.slice(k).join(' ') };
}
function dfiSiNo(v) { v = String(v || '').trim().toLowerCase(); return v === 'sì' || v === 'si' ? 'SI' : v === 'no' ? 'NO' : ''; }
function dfiTipoPag(importo, quota, i) { if (quota && Math.abs(importo - quota) < 0.01) return 'Quota annuale'; return i === 0 ? 'Quota (1a rata)' : 'Quota (2a rata)'; }
// Costruisce le proposte. atleti = anagrafica, pag = pagamenti, righe = tabella del foglio
function dfiProposte(righe, atleti, pag, stag, oggi) {
  var usati = {};
  return righe.map(function (r, idx) {
    var c = dfiCategoria(r.categoria);
    var trov = dfTrovaAtleti(r.nominativo, atleti).filter(function (x) { return x.certo && !usati[x.id]; });
    var out = { idx: idx, r: r, cat: c, voci: [], pagamenti: [], azione: '', atletaId: null, nome: r.nominativo };
    if (trov.length > 1) { out.azione = 'AMBIGUO'; out.candidati = trov.map(function (x) { return x.nome; }); return out; }
    var a = trov.length ? atleti.find(function (x) { return x.id === trov[0].id; }) : null;
    if (a) { usati[a.id] = 1; out.azione = 'AGGIORNA'; out.atletaId = a.id; out.nome = dfgNomeAtl(a); } else out.azione = 'NUOVO';
    if (!a) { var sim = dfiSimili(r.nominativo, atleti, usati); if (sim.length) { out.simili = sim.map(function (x) { return { id: x.id, nome: dfgNomeAtl(x) }; }); out.unisciCon = sim[0].id; } }
    var vecchio = a || {};
    var voce = function (k, etichetta, nuovo, vecchioV) {
      if (nuovo === undefined || nuovo === null || nuovo === '') return;
      if (String(vecchioV == null ? '' : vecchioV) === String(nuovo)) return;
      out.voci.push({ k: k, l: etichetta, da: vecchioV == null ? '' : vecchioV, a: nuovo, sel: vecchioV == null || vecchioV === '' });
    };
    voce('cs', 'Scadenza certificato', r.cs, vecchio.cs);
    voce('dn', 'Data di nascita', r.dn, vecchio.dn);
    voce('indComune', 'Comune', r.comune, typeof dfgComune === 'function' && a ? dfgComune(a) : vecchio.indComune);
    ['modulo', 'identita', 'tessera'].forEach(function (k) { var v = r.doc && r.doc[k]; if (v) voce('doc.' + k, DFG_DOC[k], v, (vecchio.docConsegnati || {})[k]); });
    if (r.quotaAnnua !== null && r.quotaAnnua !== undefined && r.quotaAnnua !== '') voce('quotaAnnua', 'Quota annua', Number(r.quotaAnnua), vecchio.quotaAnnua);
    if (r.scontoFratello) voce('scontoFratello', 'Sconto fratello', true, vecchio.scontoFratello || '');
    if (c && c.partner) voce('specialPartner', 'Partner Special', true, vecchio.specialPartner || '');
    if (c && !(vecchio.iscrizioni || []).some(function (i) { return i.anno === stag; })) out.voci.push({ k: 'iscrizione', l: 'Iscrizione ' + stag, da: '', a: c.cat, sel: true });
    (r.pagamenti || []).forEach(function (p, i) {
      if (!(p.importo > 0) || !p.data) return;
      var gia = a && (pag[a.id] || []).some(function (x) { return x.data === p.data && Math.abs((+x.importo || 0) - p.importo) < 0.01; });
      if (!gia) out.pagamenti.push({ importo: p.importo, data: p.data, tipo: dfiTipoPag(p.importo, Number(r.quotaAnnua) || 0, i), sel: true });
    });
    out.sel = out.azione !== 'AMBIGUO' && !out.simili; // possibile doppione: decide Alberto
    return out;
  });
}

// ── interfaccia ──
function dfiRevisione(dati) {
  var el = document.getElementById('df-import-esito');
  if (!DFG.caricato) { el.innerHTML = '<div class="errore">Anagrafica non ancora caricata: riprova tra poco.</div>'; return; }
  var st = dfgStagioneAtleti(DFG.atl, srOggi());
  DFI.dati = dati; DFI.stag = st.chiave;
  DFI.righe = dfiProposte(dati.atleti || [], DFG.atl, DFG.pag, st.chiave, srOggi());
  dfiRender();
}
function dfiRender() {
  var el = document.getElementById('df-import-esito'), R = DFI.righe;
  var nAgg = R.filter(function (x) { return x.azione === 'AGGIORNA' && (x.voci.length || x.pagamenti.length); }).length, nNuovi = R.filter(function (x) { return x.azione === 'NUOVO'; }).length;
  var nPag = R.reduce(function (s, x) { return s + x.pagamenti.length; }, 0), totPag = R.reduce(function (s, x) { return s + x.pagamenti.reduce(function (t, p) { return t + p.importo; }, 0); }, 0);
  var amb = R.filter(function (x) { return x.azione === 'AMBIGUO'; });
  el.innerHTML = '<div class="card" style="border:1px solid var(--gold)"><div class="card-title">📋 Revisione dati del foglio atleti</div>' +
    '<div class="card-desc">' + nAgg + ' schede da aggiornare · ' + nNuovi + ' atleti nuovi · ' + nPag + ' pagamenti da registrare (' + srEuro(totPag) + ') · stagione ' + srEsc(DFI.stag) + '</div>' +
    '<button class="btn-gold btn-sm" style="margin:6px 0" onclick="dfiApplica()">✅ Applica tutto il selezionato</button>' +
    '<label>Metodo dei pagamenti del foglio</label><select id="dfi-metodo"><option>Bonifico</option><option>Contanti</option><option>POS</option></select>' +
    '<div class="card-desc">Spuntato = verrà scritto. I valori DIVERSI da quelli del gestionale sono proposti senza spunta: tocca per accettarli.</div>' +
    (amb.length ? '<div class="errore">Da fare a mano (più atleti con lo stesso nome): ' + amb.map(function (x) { return srEsc(x.r.nominativo); }).join(', ') + '</div>' : '') +
    R.filter(function (x) { return x.azione !== 'AMBIGUO' && (x.azione === 'NUOVO' || x.voci.length || x.pagamenti.length); }).map(function (x) {
      return '<div style="border-top:1px solid var(--border);padding:6px 0"><label style="display:flex;gap:8px;align-items:center;font-weight:700;color:var(--text);margin:0"><input type="checkbox" style="width:auto;min-height:0"' + (x.sel ? ' checked' : '') + ' onchange="DFI.righe[' + x.idx + '].sel=this.checked">' +
        srEsc(x.nome) + (x.azione === 'NUOVO' ? ' <span class="badge b-att">nuovo' + (x.cat ? ' · ' + srEsc(x.cat.cat) : '') + '</span>' : '') + '</label>' +
        (x.simili ? '<div style="margin:2px 0 4px 26px;font-size:12px;color:var(--warn)">⚠ Forse è già in anagrafica scritto diversamente: <select style="font-size:12px;min-height:30px" onchange="DFI.righe[' + x.idx + '].unisciCon=this.value?Number(this.value):null">' +
          x.simili.map(function (sm) { return '<option value="' + sm.id + '">è ' + srEsc(sm.nome) + ' → correggi in ' + srEsc(x.r.nominativo) + '</option>'; }).join('') + '<option value="">è un atleta nuovo</option></select> (spunta per applicare)</div>' : '') +
        x.voci.map(function (v, j) {
          return '<label style="display:flex;gap:8px;align-items:center;font-size:12px;color:var(--text);margin:2px 0 2px 26px"><input type="checkbox" style="width:auto;min-height:0"' + (v.sel ? ' checked' : '') + ' onchange="DFI.righe[' + x.idx + '].voci[' + j + '].sel=this.checked">' +
            srEsc(v.l) + ': ' + srEsc(dfiVal(v.k, v.da) || '—') + ' → <b>' + srEsc(dfiVal(v.k, v.a)) + '</b></label>';
        }).join('') +
        x.pagamenti.map(function (p, j) {
          return '<label style="display:flex;gap:8px;align-items:center;font-size:12px;color:var(--text);margin:2px 0 2px 26px"><input type="checkbox" style="width:auto;min-height:0"' + (p.sel ? ' checked' : '') + ' onchange="DFI.righe[' + x.idx + '].pagamenti[' + j + '].sel=this.checked">💶 ' +
            srEuro(p.importo) + ' del ' + srDataIt(p.data) + ' · ' + srEsc(p.tipo) + '</label>';
        }).join('') + '</div>';
    }).join('') +
    '<div id="dfi-esito"></div><button class="btn-gold btn-block" onclick="dfiApplica()">✅ Applica tutto il selezionato</button></div>';
}
function dfiVal(k, v) { if (v === true) return 'sì'; if ((k === 'cs' || k === 'dn') && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) return srDataIt(v); if (k === 'quotaAnnua' && v !== '') return srEuro(v); return String(v == null ? '' : v); }
function dfiApplica() {
  var es = document.getElementById('dfi-esito'), metodo = document.getElementById('dfi-metodo').value;
  if (!DFG_METODI[metodo]) { srLog('Metodo sconosciuto: ' + metodo, 'err'); return; }
  var scelte = DFI.righe.filter(function (x) { return x.sel && x.azione !== 'AMBIGUO'; });
  var nPag = scelte.reduce(function (s, x) { return s + x.pagamenti.filter(function (p) { return p.sel; }).length; }, 0);
  if (!scelte.length) { es.innerHTML = '<div class="errore">Niente di selezionato.</div>'; return; }
  if (!confirm('Applico: ' + scelte.length + ' schede (nuove o aggiornate) e ' + nPag + ' pagamenti con ' + metodo.toLowerCase() + '. Confermi?')) return;
  var quote = (SR.config.categorie || []).find(function (c) { return c.codice === 'QUOTE' && c.attivo !== false; });
  if (nPag && !quote) { es.innerHTML = '<div class="errore">In Economia manca la categoria QUOTE: aggiungila prima (Admin → Economia).</div>'; return; }
  es.innerHTML = '<div class="domanda">Applico…</div>';
  var col = _db.collection('basket052441'), refA = col.doc('atleti'), refP = col.doc('pagamenti'), adesso = new Date().toISOString(), oggi = srOggi();
  var anni = {}; scelte.forEach(function (x) { x.pagamenti.forEach(function (p) { if (p.sel) anni[p.data.slice(0, 4)] = 1; }); });
  var esito = { nuovi: 0, aggiornati: 0, pagamenti: 0, movimenti: [], noteChiuse: 0 };
  Promise.all(Object.keys(anni).map(function (y) { return srAnnoCaricato(Number(y)); })).then(function () {
    return _db.runTransaction(function (tx) {
      esito = { nuovi: 0, aggiornati: 0, pagamenti: 0, movimenti: [], noteChiuse: 0 };
      return Promise.all([tx.get(refA), tx.get(refP)]).then(function (ds) {
        var atl = ds[0].exists && ds[0].data().v ? JSON.parse(ds[0].data().v) : [];
        var pag = ds[1].exists && ds[1].data().v ? JSON.parse(ds[1].data().v) : {};
        var numeri = {}; Object.keys(anni).forEach(function (y) { numeri[y] = (SR.movAnno[Number(y)] || []).slice(); });
        var maxId = atl.reduce(function (m, a) { return Math.max(m, Number(a.id) || 0); }, 0);
        scelte.forEach(function (x) {
          var a;
          if (x.azione === 'NUOVO' && x.simili && x.unisciCon) { // stesso atleta scritto diversamente: correggo il nome e aggiorno
            a = atl.find(function (y) { return y.id === x.unisciCon; });
            if (!a) throw new Error('atleta da unire non trovato');
            var nc = dfiSeparaNome(x.r.nominativo);
            a.storiaDittafono = (a.storiaDittafono || []).concat([{ il: adesso, origine: 'import foglio atleti', campi: ['nome: ' + a.cog + ' ' + a.nom + ' → ' + nc.cog + ' ' + nc.nom] }]);
            a.cog = nc.cog; a.nom = nc.nom; esito.aggiornati++;
          } else if (x.azione === 'NUOVO') {
            var nn = dfiSeparaNome(x.r.nominativo);
            a = { id: ++maxId, cog: nn.cog, nom: nn.nom, iscrizioni: [], convocabile: true, daCompletare: true, creatoDa: 'import foglio atleti ' + oggi, modTs: adesso, note: x.r.note ? '[foglio atleti] ' + x.r.note : '' };
            atl.push(a); esito.nuovi++;
          } else {
            a = atl.find(function (y) { return y.id === x.atletaId; });
            if (!a) throw new Error(x.nome + ' non è più in anagrafica');
            esito.aggiornati++;
          }
          x.voci.forEach(function (v) {
            if (!v.sel && x.azione !== 'NUOVO') return;
            if (x.azione === 'NUOVO' && x.unisciCon && v.k !== 'iscrizione' && a[v.k] && v.k.indexOf('doc.') !== 0) return; // unione: non sovrascrivo valori gia' presenti
            if (v.k === 'iscrizione') { if (!(a.iscrizioni || []).some(function (i) { return i.anno === DFI.stag; })) a.iscrizioni = (a.iscrizioni || []).concat([{ anno: DFI.stag, fed: '', cat1: v.a, cat2: '', dataIscr: '', note: 'da foglio atleti' }]); }
            else if (v.k.indexOf('doc.') === 0) { a.docConsegnati = a.docConsegnati || {}; a.docConsegnati[v.k.slice(4)] = v.a; }
            else a[v.k] = v.a;
          });
          if (x.azione === 'NUOVO' && x.cat && !(a.iscrizioni = a.iscrizioni || []).some(function (i) { return i.anno === DFI.stag; })) a.iscrizioni.push({ anno: DFI.stag, fed: '', cat1: x.cat.cat, cat2: '', dataIscr: '', note: 'da foglio atleti' });
          if (x.azione === 'NUOVO' && !a.cat) a.cat = x.cat ? x.cat.cat : '';
          a.modTs = adesso;
          a.storiaDittafono = (a.storiaDittafono || []).concat([{ il: adesso, origine: 'import foglio atleti', campi: x.voci.filter(function (v) { return v.sel || x.azione === 'NUOVO'; }).map(function (v) { return v.k; }) }]).slice(-50);
          x.pagamenti.forEach(function (p) {
            if (!p.sel) return;
            var arr = pag[a.id] || [];
            if (arr.some(function (q) { return q.data === p.data && Math.abs((+q.importo || 0) - p.importo) < 0.01; })) return;
            if (arr.length >= 5) throw new Error(dfgNomeAtl(a) + ' ha già 5 pagamenti (limite del gestionale)');
            var m = srCostruisciMovimento({ tipoMov: 'ENTRATA', importo: p.importo, categoria: 'QUOTE', centro: 'SPORT', mezzo: DFG_METODI[metodo], data: p.data, descrizione: p.tipo + ' ' + dfgNomeAtl(a), frase: 'import foglio atleti', natura: null, documento: null });
            if (metodo === 'POS') m.metodoPagamento = 'carta';
            m.origine = 'IMPORT_FOGLIO_ATLETI'; m.atletaId = a.id;
            var y = p.data.slice(0, 4); m.numeroMovimento = ecoNextNumeroMovimento(numeri[y], Number(y)); numeri[y].push(m);
            var v2 = ecoValidaMovimento(m, SR.config, {}); if (!v2.valido) throw new Error('movimento non valido per ' + dfgNomeAtl(a) + ': ' + v2.errori.join(', '));
            var pg = { tipo: p.tipo, importo: p.importo, data: p.data, metodo: metodo, note: 'da foglio atleti', movId: m.id };
            if (dfgDetraibile(pg) !== 'SI') pg.det = false;
            pag[a.id] = arr.concat([pg]);
            tx.set(srColMov().doc(m.id), m); esito.movimenti.push(m); esito.pagamenti++;
          });
        });
        tx.set(refA, { v: JSON.stringify(atl), ts: adesso, da: 'import foglio ' + SR.utente });
        tx.set(refP, { v: JSON.stringify(pag), ts: adesso, da: 'import foglio ' + SR.utente });
        // note del foglio ancora aperte (pagamenti e dati atleta): assorbite
        DF.note.filter(function (n) { return n.origine === 'IMPORT_FOGLIO' && n.stato === 'NUOVA' && /^(PAGAMENTO|DATO_ATLETA|NOTA_ATLETA)$/.test(n.tipo); }).slice(0, 400).forEach(function (n) {
          var c = JSON.parse(JSON.stringify(n)); c.stato = 'ELABORATA';
          c.collegamenti = (n.collegamenti || []).concat([{ tipo: 'IMPORT_FOGLIO', il: adesso }]);
          c.storia = (n.storia || []).concat([{ il: adesso, da: SR.utente, azione: 'assorbita dall\'import in blocco del foglio atleti' }]);
          tx.set(dfCol().doc(n.id), c); esito.noteChiuse++;
        });
        DFG.atl = atl; DFG.pag = pag;
      });
    });
  }).then(function () {
    esito.movimenti.forEach(function (m) { srRegistraInCache(m); });
    DF.note.forEach(function (n) { if (n.origine === 'IMPORT_FOGLIO' && n.stato === 'NUOVA' && /^(PAGAMENTO|DATO_ATLETA|NOTA_ATLETA)$/.test(n.tipo)) { n.stato = 'ELABORATA'; } });
    if (typeof srAggiornaBadgeCassa === 'function') srAggiornaBadgeCassa();
    srLog('Import foglio: ' + esito.nuovi + ' nuovi, ' + esito.aggiornati + ' aggiornati, ' + esito.pagamenti + ' pagamenti, ' + esito.noteChiuse + ' note chiuse', 'ok');
    document.getElementById('df-import-esito').innerHTML = '<div class="ok-msg">✅ Fatto: ' + esito.nuovi + ' atleti nuovi, ' + esito.aggiornati + ' schede aggiornate, ' + esito.pagamenti + ' pagamenti registrati anche in Economia, ' + esito.noteChiuse + ' note chiuse.<br>' +
      (esito.nuovi ? 'Gli atleti nuovi vanno completati da tastiera (codice fiscale, genitore, telefono): chiedi "dati da completare?".' : '') + '</div>';
    dfRenderNote(); if (typeof dfgAvvisi === 'function') dfgAvvisi();
  }).catch(function (err) { srLog('Import foglio NON applicato: ' + err.message, 'err'); es.innerHTML = '<div class="errore">NON applicato (nessuna modifica fatta): ' + srEsc(err.message) + '</div>'; });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { dfiSimili: dfiSimili, dfiProposte: dfiProposte, dfiSeparaNome: dfiSeparaNome, dfiCategoria: dfiCategoria, dfiSiNo: dfiSiNo };
