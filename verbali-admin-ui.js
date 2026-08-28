// ────────────────────────────────────────────────────────────
// FILE: verbali-admin-ui.js — ASD Basket Campodarsego
// VERSIONE: v0.1 · 28/08/2026 · BK
// v0.1: creazione — tab Verbali nell'admin: lista registro (tutti gli
//   organi/anni, piu' recenti in cima) + form "Nuovo verbale" che crea
//   una BOZZA (tipo, organo, data riunione, luogo, ora inizio).
//   Step 1/5 (vedi verbali-core.js per lo scope preciso). Nessuna
//   compilazione contenuto/PDF/firma qui — solo apertura del record e
//   navigazione verso la scheda di dettaglio, che e' step 2.
// Dipende da: verbali-core.js (deve essere caricato PRIMA via
//   <script src>), basket-core.js (log(), toast(), nowStr()).
// ────────────────────────────────────────────────────────────

var vrbListaCache = [];

function vrbAdmInit() {
  vrbCaricaLista().then(function (elenco) {
    vrbListaCache = elenco;
    vrbAdmRenderLista();
  }).catch(function () {
    var out = document.getElementById('vrb-lista-output');
    if (out) out.innerHTML = '<p style="color:#e03545">Errore caricamento registro verbali — vedi log.</p>';
  });
}

function vrbAdmRenderLista() {
  var out = document.getElementById('vrb-lista-output');
  if (!out) { console.error('[verbali-admin-ui] #vrb-lista-output non trovato nel DOM — HTML disallineato dal JS?'); return; }
  if (!vrbListaCache.length) {
    out.innerHTML = '<p style="color:#7a8fa8;font-size:12px;">Nessun verbale registrato. Usa "Nuovo verbale" per iniziare.</p>';
    return;
  }
  var html = '<div class="op-list">';
  vrbListaCache.forEach(function (v) {
    var colore = VRB_STATO_COLORI[v.stato] || '#7a8fa8';
    html += '<div class="op-row" style="cursor:pointer" onclick="vrbAdmApri(\'' + v.id + '\')">' +
      '<div class="op-info">' +
      '<div class="op-title">' + vrbAdmEsc(v.id) + ' — ' + vrbAdmEsc(VRB_TIPO_LABEL[v.tipo] || v.tipo) + '</div>' +
      '<div class="op-desc">' + vrbAdmEsc(VRB_ORGANO_LABEL[v.organo] || v.organo) +
      ' · riunione ' + vrbAdmEsc(v.dataRiunione || '—') +
      (v.retroattivo ? ' · <span style="color:#c8a84b">storico</span>' : '') + '</div>' +
      '</div>' +
      '<span class="badge" style="background:' + colore + '22;color:' + colore + '">' + vrbAdmEsc(VRB_STATO_LABEL[v.stato] || v.stato) + '</span>' +
      '</div>';
  });
  html += '</div>';
  out.innerHTML = html;
}

function vrbAdmEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

// Apertura scheda dettaglio — fuori scope step 1 (form compilazione e'
// step 2). Per ora mostra solo un riepilogo readonly, cosi' il record
// creato e' comunque ispezionabile subito, senza fingere una feature
// non ancora costruita.
function vrbAdmApri(id) {
  var v = vrbListaCache.find(function (x) { return x.id === id; });
  if (!v) { console.error('[verbali-admin-ui] vrbAdmApri: id non in cache: ' + id); return; }
  var corpo = '<b>' + vrbAdmEsc(v.id) + '</b><br>' +
    'Tipo: ' + vrbAdmEsc(VRB_TIPO_LABEL[v.tipo] || v.tipo) + '<br>' +
    'Organo: ' + vrbAdmEsc(VRB_ORGANO_LABEL[v.organo] || v.organo) + '<br>' +
    'Stato: ' + vrbAdmEsc(VRB_STATO_LABEL[v.stato] || v.stato) + '<br>' +
    'Data redazione: ' + vrbAdmEsc(v.dataRedazione) + '<br>' +
    'Data riunione: ' + vrbAdmEsc(v.dataRiunione || '—') + '<br>' +
    'Luogo: ' + vrbAdmEsc(v.luogo || '—') +
    (v.retroattivo ? '<br><i>Verbale storico/retroattivo</i>' : '') +
    '<br><br><span style="color:#7a8fa8;font-size:11px">Compilazione contenuto, generazione PDF e firma non ancora disponibili (step 2/3 del modulo, in sviluppo).</span>';
  var titleEl = document.getElementById('modal-vrb-dettaglio-title');
  var bodyEl = document.getElementById('vrb-dettaglio-body');
  if (!titleEl || !bodyEl) {
    console.error('[verbali-admin-ui] markup modale #modal-vrb-dettaglio mancante nel DOM — HTML disallineato dal JS?');
    if (typeof log === 'function') log('[verbali-admin-ui] markup modale dettaglio mancante', 'err');
    alert(corpo.replace(/<br>/g, '\n').replace(/<[^>]+>/g, ''));
    return;
  }
  titleEl.textContent = 'Verbale ' + v.id;
  bodyEl.innerHTML = corpo;
  if (typeof openModal === 'function') {
    openModal('modal-vrb-dettaglio');
  } else {
    console.error('[verbali-admin-ui] openModal non disponibile (basket-core.js mancante/vecchio)');
  }
}

function vrbAdmMostraFormNuovo() {
  var html =
    '<label>Tipo</label>' +
    '<select id="vrb-nuovo-tipo">' +
    '<option value="GENERICO">Generico</option>' +
    '<option value="BILANCIO">Approvazione Bilancio</option>' +
    '</select>' +
    '<label>Organo</label>' +
    '<select id="vrb-nuovo-organo">' +
    '<option value="DIRETTIVO">Direttivo</option>' +
    '<option value="ASSEMBLEA_SOCI">Assemblea Soci</option>' +
    '</select>' +
    '<label>Data riunione</label>' +
    '<input type="date" id="vrb-nuovo-data">' +
    '<label>Luogo</label>' +
    '<input type="text" id="vrb-nuovo-luogo" placeholder="es. Sede sociale">' +
    '<label>Ora inizio</label>' +
    '<input type="time" id="vrb-nuovo-ora">' +
    '<label style="display:flex;align-items:center;gap:8px;margin-top:4px;">' +
    '<input type="checkbox" id="vrb-nuovo-retroattivo" style="width:auto;margin:0;"> Verbale storico/retroattivo (§3.5)</label>' +
    '<button type="button" class="btn btn-gold" style="margin-top:10px;width:100%" onclick="vrbAdmCreaBozza()">Crea bozza</button>';
  var bodyEl = document.getElementById('vrb-nuovo-body');
  if (!bodyEl) {
    console.error('[verbali-admin-ui] markup modale #modal-vrb-nuovo mancante nel DOM — HTML disallineato dal JS?');
    if (typeof log === 'function') log('[verbali-admin-ui] markup modale nuovo verbale mancante', 'err');
    return;
  }
  bodyEl.innerHTML = html;
  if (typeof openModal === 'function') {
    openModal('modal-vrb-nuovo');
  } else {
    console.error('[verbali-admin-ui] openModal non disponibile — impossibile aprire il form nuovo verbale');
  }
}

function vrbAdmCreaBozza() {
  var tipo = document.getElementById('vrb-nuovo-tipo').value;
  var organo = document.getElementById('vrb-nuovo-organo').value;
  var dataRiunione = document.getElementById('vrb-nuovo-data').value;
  var luogo = document.getElementById('vrb-nuovo-luogo').value;
  var oraInizio = document.getElementById('vrb-nuovo-ora').value;
  var retroattivo = document.getElementById('vrb-nuovo-retroattivo').checked;

  if (!dataRiunione) {
    // Niente uscita silenziosa: campo obbligatorio mancante segnalato
    // esplicitamente, non un salvataggio con data vuota.
    alert('Data riunione obbligatoria.');
    return;
  }

  vrbCreaBozza({
    tipo: tipo, organo: organo, dataRiunione: dataRiunione,
    luogo: luogo, oraInizio: oraInizio, retroattivo: retroattivo
  }, vrbListaCache).then(function (record) {
    if (typeof closeModal === 'function') closeModal('modal-vrb-nuovo');
    if (typeof toast === 'function') toast('Verbale ' + record.id + ' creato (bozza)', 'ok');
    vrbAdmInit(); // ricarica lista da Firestore, non un push locale — coerenza con la fonte dati reale
  }).catch(function (err) {
    alert('Errore creazione verbale: ' + (err && err.message || err));
  });
}

window.addEventListener('error', function (e) {
  var msg = '[verbali-admin-ui] errore non gestito: ' + (e.error && e.error.message || e.message);
  console.error(msg);
  if (typeof log === 'function') log(msg, 'err');
});
window.addEventListener('unhandledrejection', function (e) {
  var msg = '[verbali-admin-ui] promise non gestita: ' + (e.reason && e.reason.message || e.reason);
  console.error(msg);
  if (typeof log === 'function') log(msg, 'err');
});
