// ═══════════════════════════════════════════════════════
// FILE: economia-movimenti-ui.js — ASD Basket Campodarsego
// VERSIONE: v1.1 · 23/08/2026 · BK
// v1.1: aggiunto ecoCopiaMovimento() + bottone "Copia" in ecoRenderMovimenti()
//   (richiesta Alberto 23/08: duplicare un movimento esistente con data
//   odierna, utile per la seconda gamba dei GIROCONTO). Data documento
//   impostata a oggi per esplicita richiesta della funzione — non è un
//   default di form generico, resto dei campi vuoti resta invariato altrove.
// v1.0 · 20/08/2026: estratto da basket052441.html per lavorare a file
//   separati (richiesta Alberto: file piccoli, moduli per argomento).
// Dipende da: economia-core-DRAFT.js (funzioni pure), caricato PRIMA di
// questo file. Va incluso con <script src> in basket052441.html, dopo
// economia-core-DRAFT.js.
// ══════════════════════════════════════════════════════

var ecoConfigCache = null; // { categorie:[...], sottocategorie:[...], centriCosto:[...] }
function ecoEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

var ecoMovimenti = [];
var ecoConti = [];
var ecoFiltroStatoV = '';
var ecoFiltroScadV = '';
var ECO_ANNO_ESERCIZIO_DEFAULT = new Date().getFullYear();
var ecoAnnoCorrente = ECO_ANNO_ESERCIZIO_DEFAULT;

function ecoColMovimenti() {
  return window._db.collection('basket052441').doc('economia').collection('movimenti');
}

function ecoLoadSezioni(cb) {
  if (!window._db) { diag('Economia: Firestore non pronto', 'warn'); return; }
  var col = window._db.collection('basket052441');
  Promise.all([
    col.doc('economiaConti').get(),
    col.doc('economiaConfig').get(),
    ecoColMovimenti().where('annoEsercizio', '==', ecoAnnoCorrente).get()
  ]).then(function (res) {
    try {
      ecoConti = (res[0].exists && res[0].data().v) ? JSON.parse(res[0].data().v) : [];
      var cfg = (res[1].exists && res[1].data().v) ? JSON.parse(res[1].data().v) : { categorie: [], sottocategorie: [], centriCosto: [] };
      ecoConfigCache = cfg;
      ecoMovimenti = [];
      res[2].forEach(function (doc) { ecoMovimenti.push(doc.data()); });
    } catch (ex) {
      diag('Economia: errore parsing dati — ' + ex.message, 'err');
    }
    if (cb) cb();
  }).catch(function (err) {
    diag('Economia: errore lettura Firestore — ' + err.message, 'err');
  });
}

function ecoSalvaDocMovimento(m, cb) {
  if (!window._db) { diag('Economia: Firestore non pronto', 'warn'); return; }
  ecoColMovimenti().doc(m.id).set(m).then(function () {
    diag('Economia: movimento ' + m.numeroMovimento + ' salvato', 'ok');
    if (cb) cb();
  }).catch(function (err) {
    diag('Economia: errore scrittura movimento — ' + err.message, 'err');
    alert('Errore salvataggio: ' + err.message);
  });
}

function ecoSalvaSezione(nome, dati, cb) {
  if (!window._db) { diag('Economia: Firestore non pronto', 'warn'); return; }
  window._db.collection('basket052441').doc(nome).set({ v: JSON.stringify(dati) }).then(function () {
    diag('Economia: sezione "' + nome + '" aggiornata', 'ok');
    if (cb) cb();
  }).catch(function (err) {
    diag('Economia: errore scrittura "' + nome + '" — ' + err.message, 'err');
    alert('Errore salvataggio: ' + err.message);
  });
}

function ecoInitPagina() {
  ecoPopolaSelectAnni();
  ecoLoadSezioni(function () {
    ecoPopolaSelectCodici();
    ecoRenderConti();
    ecoRenderMovimenti();
    ecoRenderScadenzario();
  });
}

function ecoPopolaSelectAnni() {
  var sel = document.getElementById('eco-filtro-anno');
  if (!sel) return;
  var oggi = new Date().getFullYear();
  sel.innerHTML = '';
  for (var y = oggi + 1; y >= oggi - 5; y--) {
    sel.innerHTML += '<option value="' + y + '"' + (y === ecoAnnoCorrente ? ' selected' : '') + '>' + y + '</option>';
  }
}

function ecoCambiaAnnoEsercizio() {
  ecoAnnoCorrente = parseInt(document.getElementById('eco-filtro-anno').value, 10);
  ecoLoadSezioni(function () { ecoRenderMovimenti(); ecoRenderScadenzario(); ecoRenderConti(); });
}

function ecoPopolaSelectCodici() {
  var cfg = ecoConfigCache || { categorie: [], sottocategorie: [], centriCosto: [] };
  function fill(id, righe, withEmpty) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = (withEmpty ? '<option value="">' + withEmpty + '</option>' : '');
    ecoCodiciAttivi(righe).forEach(function (r) {
      sel.innerHTML += '<option value="' + r.codice + '">' + ecoEsc(r.descrizione) + '</option>';
    });
    sel.value = cur;
  }
  fill('eco-filtro-cat', cfg.categorie, 'Tutte');
  fill('em-categoria', cfg.categorie, null);
  fill('em-sottocategoria', cfg.sottocategorie, '(nessuna)');
  fill('em-centrocosto', cfg.centriCosto, '(nessuno)');
  var selConto = document.getElementById('em-conto');
  if (selConto) {
    selConto.innerHTML = '<option value="">(nessuno)</option>';
    ecoConti.forEach(function (c) { selConto.innerHTML += '<option value="' + c.id + '">' + ecoEsc(c.nome) + '</option>'; });
  }
}

function ecoFiltroStato(v) {
  ecoFiltroStatoV = v;
  document.querySelectorAll('#eco-filtri-stato .fb').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-v') === v); });
  ecoRenderMovimenti();
}

function ecoRenderMovimenti() {
  var catF = document.getElementById('eco-filtro-cat').value;
  var lista = ecoMovimenti.filter(function (m) {
    if (ecoFiltroStatoV && m.stato !== ecoFiltroStatoV) return false;
    if (catF && m.categoriaCodice !== catF) return false;
    return true;
  }).sort(function (a, b) { return (b.dataRegistrazione || '').localeCompare(a.dataRegistrazione || ''); });

  var tb = document.getElementById('eco-mov-tbody');
  if (!lista.length) { tb.innerHTML = '<tr><td colspan="7" class="empty">Nessun movimento</td></tr>'; return; }
  tb.innerHTML = lista.map(function (m) {
    var segno = m.tipoMovimento === 'ENTRATA' ? '+' : '-';
    var colStato = { DA_PAGARE: '#c8a84b', PAGATO: '#22a85a', PARZIALE: '#1a5aaa', SCADUTO: '#e03545', ANNULLATO: '#666' }[m.stato] || '#888';
    return '<tr>' +
      '<td>' + ecoEsc(m.numeroMovimento || '') + '</td>' +
      '<td>' + (m.tipoMovimento === 'ENTRATA' ? 'Entrata' : 'Uscita') + '</td>' +
      '<td>' + ecoEsc(m.categoriaCodice || '') + '</td>' +
      '<td>' + segno + '€' + Number(m.importoEur || 0).toFixed(2) + '</td>' +
      '<td>' + (m.dataScadenza || '-') + '</td>' +
      '<td><span style="color:' + colStato + ';font-weight:700;font-size:11px">' + m.stato + '</span></td>' +
      '<td><button class="btn btn-gray btn-xs" onclick="ecoApriModalMovimento(\'' + m.id + '\')">Apri</button> ' +
      '<button class="btn btn-gray btn-xs" onclick="ecoCopiaMovimento(\'' + m.id + '\')">Copia</button></td>' +
      '</tr>';
  }).join('');
}

function ecoFiltroScadenza(v) {
  ecoFiltroScadV = v;
  document.querySelectorAll('#eco-filtri-scad .fb').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-v') === v); });
  ecoRenderScadenzario();
}

function ecoRenderScadenzario() {
  var filtro = {};
  if (ecoFiltroScadV === 'scadute') filtro.soloScadute = true;
  else if (ecoFiltroScadV) filtro.entroGiorni = parseInt(ecoFiltroScadV, 10);
  var lista = ecoMovimentiScadenza(ecoMovimenti, filtro);
  var el = document.getElementById('eco-scad-lista');
  if (!lista.length) { el.innerHTML = '<div class="empty">Nessuna scadenza</div>'; return; }
  el.innerHTML = lista.map(function (m) {
    return '<div class="pag-item" onclick="ecoApriModalMovimento(\'' + m.id + '\')" style="cursor:pointer">' +
      '<div class="pag-head"><span class="pag-tipo">' + ecoEsc(m.categoriaCodice || '') + '</span><span class="pag-data">' + m.dataScadenza + '</span></div>' +
      '<div class="pag-importo">€' + Number(m.importoEur || 0).toFixed(2) + '</div>' +
      '</div>';
  }).join('');
}

function ecoRenderConti() {
  var el = document.getElementById('eco-conti-lista');
  var statGrid = document.getElementById('eco-stat-conti');
  if (!ecoConti.length) { el.innerHTML = '<div class="empty">Nessun conto configurato</div>'; statGrid.innerHTML = ''; return; }
  var anno = ecoAnnoCorrente;
  var html = '', statHtml = '';
  ecoConti.forEach(function (c) {
    var saldoIniziale = (c.saldoInizialeEsercizio && c.saldoInizialeEsercizio[anno]) || 0;
    var saldo = ecoSaldoTeoricoConto(c.id, ecoMovimenti, saldoIniziale, anno);
    html += '<div class="pag-item" onclick="ecoApriModalConto(\'' + c.id + '\')" style="cursor:pointer">' +
      '<div class="pag-head"><span class="pag-tipo">' + ecoEsc(c.nome) + '</span><span class="pag-data">' + c.tipo + '</span></div>' +
      '<div class="pag-importo">€' + saldo.toFixed(2) + '</div></div>';
    statHtml += '<div class="stat-card" onclick="ecoApriModalConto(\'' + c.id + '\')">' +
      '<div class="stat-num" style="font-size:18px">€' + saldo.toFixed(2) + '</div>' +
      '<div class="stat-lbl">' + ecoEsc(c.nome) + '</div></div>';
  });
  el.innerHTML = html;
  statGrid.innerHTML = statHtml;
}

function ecoApriModalMovimento(id) {
  ecoPopolaSelectCodici();
  var m = id ? ecoMovimenti.find(function (x) { return x.id === id; }) : null;
  document.getElementById('em-id').value = m ? m.id : '';
  document.getElementById('modal-eco-mov-title').textContent = m ? 'Movimento ' + (m.numeroMovimento || '') : 'Nuovo movimento';
  document.getElementById('em-tipo').value = m ? m.tipoMovimento : 'USCITA';
  document.getElementById('em-importo').value = m ? m.importoEur : '';
  document.getElementById('em-categoria').value = m ? (m.categoriaCodice || '') : '';
  document.getElementById('em-sottocategoria').value = m ? (m.sottocategoriaCodice || '') : '';
  document.getElementById('em-centrocosto').value = m ? (m.centroCostoCodice || '') : '';
  document.getElementById('em-conto').value = m ? (m.contoFinanziarioId || '') : '';
  document.getElementById('em-datadoc').value = m ? (m.dataDocumento || '') : '';
  document.getElementById('em-datascad').value = m ? (m.dataScadenza || '') : '';
  document.getElementById('em-annoesercizio').value = m ? m.annoEsercizio : ecoAnnoCorrente;
  document.getElementById('em-numdoc').value = m ? (m.numeroDocumento || '') : '';
  document.getElementById('em-note').value = m ? (m.note || '') : '';
  document.getElementById('em-stato').value = m ? m.stato : 'DA_PAGARE';
  document.getElementById('em-datapag').value = m ? (m.dataPagamento || '') : '';
  document.getElementById('em-metodo').value = m ? (m.metodoPagamento || 'Bonifico') : 'Bonifico';
  document.getElementById('em-errore').textContent = '';
  document.getElementById('em-btn-annulla').style.display = (m && m.stato !== 'ANNULLATO') ? '' : 'none';
  ecoOnCambioStato();
  openModal('modal-eco-mov');
}

// ── Copia un movimento esistente in un nuovo movimento (v1.1, 23/08/2026).
// Tutti i campi dell'originale tranne id/numeroMovimento, che vengono
// rigenerati al salvataggio. Data documento portata a OGGI per esplicita
// richiesta della funzione (caso d'uso: seconda gamba di un GIROCONTO,
// o qualunque movimento ricorrente identico salvo la data). Se lo stato
// copiato è PAGATO, anche la data di pagamento viene portata a oggi —
// altrimenti resterebbe la data di pagamento originale su un movimento
// che tecnicamente non è ancora stato pagato di nuovo; Alberto corregge
// se serve prima di salvare. ──
function ecoCopiaMovimento(id) {
  var m = ecoMovimenti.find(function (x) { return x.id === id; });
  if (!m) { console.error('[economia-ui] ecoCopiaMovimento: movimento non trovato: ' + id); alert('Movimento non trovato: ' + id); return; }
  ecoPopolaSelectCodici();
  var oggi = new Date().toISOString().slice(0, 10);
  document.getElementById('em-id').value = '';
  document.getElementById('modal-eco-mov-title').textContent = 'Copia movimento (nuovo)';
  document.getElementById('em-tipo').value = m.tipoMovimento;
  document.getElementById('em-importo').value = m.importoEur;
  document.getElementById('em-categoria').value = m.categoriaCodice || '';
  document.getElementById('em-sottocategoria').value = m.sottocategoriaCodice || '';
  document.getElementById('em-centrocosto').value = m.centroCostoCodice || '';
  document.getElementById('em-conto').value = m.contoFinanziarioId || '';
  document.getElementById('em-datadoc').value = oggi;
  document.getElementById('em-datascad').value = m.dataScadenza || '';
  document.getElementById('em-annoesercizio').value = ecoAnnoCorrente;
  document.getElementById('em-numdoc').value = '';
  document.getElementById('em-note').value = m.note || '';
  document.getElementById('em-stato').value = m.stato;
  document.getElementById('em-datapag').value = m.stato === 'PAGATO' ? oggi : (m.dataPagamento || '');
  document.getElementById('em-metodo').value = m.metodoPagamento || 'Bonifico';
  document.getElementById('em-errore').textContent = '';
  document.getElementById('em-btn-annulla').style.display = 'none'; // nuovo movimento, non ancora salvato: nulla da annullare
  ecoOnCambioStato();
  openModal('modal-eco-mov');
}

function ecoOnCambioStato() {
  var pagato = document.getElementById('em-stato').value === 'PAGATO';
  document.getElementById('em-blocco-pagamento').style.display = pagato ? '' : 'none';
}

function ecoSalvaMovimento() {
  var id = document.getElementById('em-id').value;
  var esistente = id ? ecoMovimenti.find(function (x) { return x.id === id; }) : null;
  var m = esistente || {
    id: ecoNewId('MOV'),
    dataRegistrazione: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    createdBy: (window.firebase && firebase.auth().currentUser) ? firebase.auth().currentUser.email : ''
  };
  m.tipoMovimento = document.getElementById('em-tipo').value;
  m.importoEur = parseFloat(document.getElementById('em-importo').value) || 0;
  m.categoriaCodice = document.getElementById('em-categoria').value;
  m.sottocategoriaCodice = document.getElementById('em-sottocategoria').value || null;
  m.centroCostoCodice = document.getElementById('em-centrocosto').value || null;
  m.contoFinanziarioId = document.getElementById('em-conto').value || null;
  m.dataDocumento = document.getElementById('em-datadoc').value || null;
  m.dataScadenza = document.getElementById('em-datascad').value || null;
  m.annoEsercizio = parseInt(document.getElementById('em-annoesercizio').value, 10) || ecoAnnoCorrente;
  m.numeroDocumento = document.getElementById('em-numdoc').value || null;
  m.note = document.getElementById('em-note').value || null;
  m.stato = document.getElementById('em-stato').value;
  m.dataPagamento = m.stato === 'PAGATO' ? (document.getElementById('em-datapag').value || null) : null;
  m.metodoPagamento = m.stato === 'PAGATO' ? document.getElementById('em-metodo').value : null;
  if (!m.numeroMovimento) {
    m.numeroMovimento = ecoNextNumeroMovimento(ecoMovimenti.filter(function (x) { return x.annoEsercizio === m.annoEsercizio; }), m.annoEsercizio);
  }
  m.updatedAt = new Date().toISOString();
  m.updatedBy = m.createdBy;

  var esito = ecoValidaMovimento(m, ecoConfigCache, {});
  if (!esito.valido) {
    document.getElementById('em-errore').textContent = esito.errori.join(' — ');
    return;
  }
  if (!esistente) ecoMovimenti.push(m);
  ecoSalvaDocMovimento(m, function () {
    closeModal('modal-eco-mov');
    ecoRenderMovimenti(); ecoRenderScadenzario(); ecoRenderConti();
  });
}

function ecoAnnullaMovimentoUI() {
  var id = document.getElementById('em-id').value;
  var m = ecoMovimenti.find(function (x) { return x.id === id; });
  if (!m) return;
  var motivo = prompt('Motivo dell\'annullamento (obbligatorio):');
  if (motivo === null) return;
  var r = ecoAnnullaMovimento(m, motivo, m.createdBy);
  if (!r.ok) { alert(r.errore); return; }
  ecoSalvaDocMovimento(m, function () {
    closeModal('modal-eco-mov');
    ecoRenderMovimenti(); ecoRenderScadenzario(); ecoRenderConti();
  });
}

function ecoApriModalConto(id) {
  var c = id ? ecoConti.find(function (x) { return x.id === id; }) : null;
  document.getElementById('ec-id').value = c ? c.id : '';
  document.getElementById('ec-nome').value = c ? c.nome : '';
  document.getElementById('ec-tipo').value = c ? c.tipo : 'BANCA';
  document.getElementById('ec-saldo').value = c ? ((c.saldoInizialeEsercizio || {})[ecoAnnoCorrente] || 0) : 0;
  openModal('modal-eco-conto');
}

function ecoSalvaConto() {
  var id = document.getElementById('ec-id').value;
  var c = id ? ecoConti.find(function (x) { return x.id === id; }) : null;
  var nome = document.getElementById('ec-nome').value.trim();
  if (!nome) { alert('Nome obbligatorio'); return; }
  if (!c) { c = { id: ecoNewId('CONTO'), attivo: true, saldoInizialeEsercizio: {} }; ecoConti.push(c); }
  c.nome = nome;
  c.tipo = document.getElementById('ec-tipo').value;
  c.saldoInizialeEsercizio[ecoAnnoCorrente] = parseFloat(document.getElementById('ec-saldo').value) || 0;
  ecoSalvaSezione('economiaConti', ecoConti, function () {
    closeModal('modal-eco-conto');
    ecoPopolaSelectCodici(); ecoRenderConti();
  });
}

window.addEventListener('error', function (e) { console.error('[economia-ui] errore:', e.error || e.message); });
window.addEventListener('unhandledrejection', function (e) { console.error('[economia-ui] promise non gestita:', e.reason); });
