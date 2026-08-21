// ════════════════════════════════════════════════════════
// economia-admin-ui.js — ASD Basket Campodarsego
// UI pannello tabelle codici Economia (categorie/sottocategorie/centriCosto)
// Estratto da basket052441-admin.html il 20/08/2026 per lavorare a file
// separati (richiesta Alberto: file piccoli, moduli per argomento).
// Dipende da: economia-core-DRAFT.js (funzioni pure), caricato PRIMA di
// questo file. Va incluso con <script src> in basket052441-admin.html,
// dopo economia-core-DRAFT.js.
// ════════════════════════════════════════════════════════

// ── Stato in memoria: un solo documento Firestore per tutte e 3 le tabelle ──
var ecoConfigCache = null; // { categorie:[...], sottocategorie:[...], centriCosto:[...] }
var ecoTabAttiva = 'categorie';
var ECO_FB_DOC = 'economiaConfig'; // stesso pattern di _FB_SEZIONI in basket-core.js

// ── Lettura: stesso pattern di loadDB() già in uso per atleti/pagamenti ──
function ecoCaricaConfig(onOk, onErrore) {
  if (!window._db) {
    var msgNoDb = '[economia-admin] _db non pronto — Firestore non inizializzato';
    console.error(msgNoDb);
    if (typeof log === 'function') log(msgNoDb, 'err');
    if (onErrore) onErrore(new Error('Firestore non pronto: attendi il login e riprova.'));
    return;
  }
  window._db.collection('basket052441').doc(ECO_FB_DOC).get().then(function (doc) {
    var dati = { categorie: [], sottocategorie: [], centriCosto: [] };
    if (doc.exists) {
      var data = doc.data();
      if (data && data.v) {
        try {
          var parsed = JSON.parse(data.v);
          if (parsed && typeof parsed === 'object') dati = parsed;
        } catch (ex) {
          var msgParse = '[economia-admin] errore parsing economiaConfig: ' + ex.message;
          console.error(msgParse, ex);
          if (typeof log === 'function') log(msgParse, 'err');
        }
      }
    }
    if (!dati.categorie) dati.categorie = [];
    if (!dati.sottocategorie) dati.sottocategorie = [];
    if (!dati.centriCosto) dati.centriCosto = [];
    if (typeof log === 'function') log('Firebase letto: sezione "' + ECO_FB_DOC + '"', 'ok');
    onOk(dati);
  }).catch(function (err) {
    var msgErr = '[economia-admin] errore lettura economiaConfig: ' + err.message;
    console.error(msgErr, err);
    if (typeof log === 'function') log(msgErr, 'err');
    if (onErrore) onErrore(err);
  });
}

// ── Scrittura: stesso pattern di salvaSezione() già in uso ──
function ecoSalvaConfig(dati, onOk, onErrore) {
  if (!window._db) {
    var msgNoDb2 = '[economia-admin] _db non pronto — Firestore non inizializzato';
    console.error(msgNoDb2);
    if (typeof log === 'function') log(msgNoDb2, 'err');
    if (onErrore) onErrore(new Error('Firestore non pronto: attendi il login e riprova.'));
    return;
  }
  window._db.collection('basket052441').doc(ECO_FB_DOC).set({ v: JSON.stringify(dati) }).then(function () {
    if (typeof log === 'function') log('Firebase aggiornato: sezione "' + ECO_FB_DOC + '"', 'ok');
    if (onOk) onOk();
  }).catch(function (err) {
    console.error('[economia-admin] errore scrittura economiaConfig', err);
    if (typeof log === 'function') log('Errore scrittura "' + ECO_FB_DOC + '": ' + err.message, 'err');
    if (onErrore) onErrore(err);
  });
}

// ── Cambio tab ──
function ecoMostraTab(nomeTabella) {
  ecoTabAttiva = nomeTabella;
  ['categorie', 'sottocategorie', 'centriCosto'].forEach(function (t) {
    var btn = document.getElementById('eco-tab-btn-' + t);
    if (btn) btn.style.fontWeight = (t === nomeTabella) ? 'bold' : 'normal';
  });
  if (ecoConfigCache) {
    ecoRenderTab(nomeTabella, ecoConfigCache[nomeTabella]);
    return;
  }
  ecoCaricaConfig(function (dati) {
    ecoConfigCache = dati;
    ecoRenderTab(nomeTabella, dati[nomeTabella]);
  }, function (err) {
    document.getElementById('eco-tab-content').innerHTML =
      '<p style="color:#c00;">Errore caricamento tabella: ' + (err && err.message || err) + '</p>';
  });
}

// ── Render tabella + form aggiunta ──
function ecoRenderTab(nomeTabella, righe) {
  var mostraColonnaCategoria = (nomeTabella === 'sottocategorie');
  var categorieDisponibili = (ecoConfigCache && ecoConfigCache.categorie) ? ecoCodiciAttivi(ecoConfigCache.categorie) : [];
  var html = '';

  html += '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">';
  html += '<tr style="border-bottom:2px solid #ccc;text-align:left;">';
  html += '<th>Codice</th><th>Descrizione</th>' + (mostraColonnaCategoria ? '<th>Categoria</th>' : '') + '<th>Tipo</th><th>Stato</th><th></th></tr>';

  (righe || []).forEach(function (r) {
    html += '<tr style="border-bottom:1px solid #eee;' + (r.attivo === false ? 'opacity:.5;' : '') + '">';
    html += '<td><code>' + ecoEsc(r.codice) + '</code></td>';
    html += '<td><input type="text" value="' + ecoEsc(r.descrizione) + '" onchange="ecoModificaDescrizione(\'' + nomeTabella + '\',\'' + r.codice + '\',this.value)"></td>';
    if (mostraColonnaCategoria) {
      var catRow = categorieDisponibili.find(function(c){ return c.codice === r.categoriaCodice; });
      var catLabel = r.categoriaCodice ? (r.categoriaCodice + (catRow ? ' — ' + ecoEsc(catRow.descrizione) : '')) : '';
      html += '<td>' + catLabel + '</td>';
    }
    if (nomeTabella === 'centriCosto') {
      html += '<td>-</td>';
    } else {
      html += '<td><select onchange="ecoModificaTipo(\'' + nomeTabella + '\',\'' + r.codice + '\',this.value)">'
        + '<option value=""' + (!r.tipo ? ' selected' : '') + '>(nessun tipo)</option>'
        + '<option value="ENTRATA"' + (r.tipo === 'ENTRATA' ? ' selected' : '') + '>ENTRATA</option>'
        + '<option value="USCITA"' + (r.tipo === 'USCITA' ? ' selected' : '') + '>USCITA</option>'
        + '</select></td>';
    }
    html += '<td>' + (r.attivo === false ? 'Disattivo' : 'Attivo') + '</td>';
    html += '<td>' + (r.attivo === false
      ? '<button type="button" onclick="ecoRiattiva(\'' + nomeTabella + '\',\'' + r.codice + '\')">Riattiva</button>'
      : '<button type="button" onclick="ecoDisattiva(\'' + nomeTabella + '\',\'' + r.codice + '\')">Disattiva</button>') + '</td>';
    html += '</tr>';
  });
  html += '</table>';

  html += '<h4>Nuovo codice</h4>';
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
  html += '<input type="text" id="eco-new-codice" placeholder="CODICE" style="width:100px;text-transform:uppercase;">';
  html += '<input type="text" id="eco-new-descrizione" placeholder="Descrizione" style="flex:1;min-width:180px;">';
  if (nomeTabella !== 'centriCosto') {
    html += '<select id="eco-new-tipo"><option value="">(nessun tipo)</option><option value="ENTRATA">ENTRATA</option><option value="USCITA">USCITA</option></select>';
  }
  if (mostraColonnaCategoria) {
    if (categorieDisponibili.length === 0) {
      html += '<span style="color:#c60;font-size:.85em;">Nessuna categoria attiva — creane una prima nella tab "Categorie".</span>';
    } else {
      html += '<select id="eco-new-categoria"><option value="">(nessuna categoria padre)</option>';
      categorieDisponibili.forEach(function(c){
        html += '<option value="' + ecoEsc(c.codice) + '">' + ecoEsc(c.codice) + ' — ' + ecoEsc(c.descrizione) + '</option>';
      });
      html += '</select>';
    }
  }
  html += '<button type="button" onclick="ecoAggiungiCodice(\'' + nomeTabella + '\')">Aggiungi</button>';
  html += '</div>';
  html += '<div id="eco-add-errore" style="color:#c00;margin-top:6px;"></div>';

  document.getElementById('eco-tab-content').innerHTML = html;
  ecoRenderSeedBar(nomeTabella, righe);
}

var ECO_SEED_MAP = { categorie: (typeof ECO_SEED_CATEGORIE !== 'undefined' ? ECO_SEED_CATEGORIE : null),
                      centriCosto: (typeof ECO_SEED_CENTRI_COSTO !== 'undefined' ? ECO_SEED_CENTRI_COSTO : null) };

function ecoRenderSeedBar(nomeTabella, righe) {
  var bar = document.getElementById('eco-seed-bar');
  if (!bar) return;
  var seed = ECO_SEED_MAP[nomeTabella];
  if (!seed || (righe && righe.length > 0)) { bar.innerHTML = ''; return; }
  bar.innerHTML = '<button type="button" onclick="ecoCaricaSeed(\'' + nomeTabella + '\')">'
    + 'Carica ' + seed.length + ' voci di esempio</button> '
    + '<span style="color:#666;font-size:.85em;">(puoi modificarle o disattivarle dopo)</span>';
}

function ecoCaricaSeed(nomeTabella) {
  var seed = ECO_SEED_MAP[nomeTabella];
  if (!seed) return;
  var righe = ecoConfigCache[nomeTabella] || [];
  seed.forEach(function (s) {
    var già = righe.some(function (r) { return r.codice === s.codice; });
    if (già) return;
    var risultato = ecoNuovoCodice(righe, s.codice, s.descrizione, { tipo: s.tipo || null });
  if (risultato.ok) righe.push(risultato.record);
  });
  ecoConfigCache[nomeTabella] = righe;
  ecoSalvaConfig(ecoConfigCache, function () {
    ecoRenderTab(nomeTabella, righe);
    if (typeof log === 'function') log('Economia: caricate voci di esempio in "' + nomeTabella + '"', 'ok');
    ecoFeedback('Voci di esempio caricate', 'ok');
  }, function (err) {
    if (typeof log === 'function') log('Errore caricamento seed "' + nomeTabella + '": ' + (err && err.message || err), 'err');
    ecoFeedback('Errore caricamento voci di esempio: ' + (err && err.message || err), 'err');
  });
}

function ecoEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function ecoAggiungiCodice(nomeTabella) {
  var codice = document.getElementById('eco-new-codice').value;
  var descrizione = document.getElementById('eco-new-descrizione').value;
  var tipoEl = document.getElementById('eco-new-tipo');
  var catEl = document.getElementById('eco-new-categoria');
  var opts = {
    tipo: tipoEl ? (tipoEl.value || null) : null,
    categoriaCodice: catEl ? (catEl.value || null) : null
  };

  var righe = ecoConfigCache[nomeTabella] || [];
  var risultato = ecoNuovoCodice(righe, codice, descrizione, opts);
  var errBox = document.getElementById('eco-add-errore');

  if (!risultato.ok) {
    errBox.textContent = risultato.errore;
    return;
  }
  errBox.textContent = '';
  righe.push(risultato.record);
  ecoConfigCache[nomeTabella] = righe;
  ecoSalvaConfig(ecoConfigCache, function () {
    ecoRenderTab(nomeTabella, righe);
    ecoFeedback('Codice "' + risultato.record.codice + '" creato', 'ok');
  }, function (err) {
    errBox.textContent = 'Errore salvataggio: ' + (err && err.message || err);
    ecoFeedback('Errore salvataggio: ' + (err && err.message || err), 'err');
  });
}

// Helper unico di feedback: usa toast() di basket-core.js se presente
// (sempre vero in produzione, questo file è caricato dopo basket-core.js),
// altrimenti fallback ad alert per non restare mai silenzioso.
function ecoFeedback(msg, tipo) {
  if (typeof toast === 'function') toast(msg, tipo);
  else if (tipo === 'err') alert(msg);
}

function ecoModificaDescrizione(nomeTabella, codice, nuovaDescrizione) {
  var righe = ecoConfigCache[nomeTabella] || [];
  var risultato = ecoModificaCodice(righe, codice, { descrizione: nuovaDescrizione });
  if (!risultato.ok) {
    console.error('[economia-admin] ' + risultato.errore);
    ecoFeedback(risultato.errore, 'err');
    return;
  }
  ecoSalvaConfig(ecoConfigCache, function () {
    ecoFeedback('Descrizione salvata', 'ok');
  }, function (err) {
    console.error('[economia-admin] errore salvataggio dopo modifica', err);
    ecoFeedback('Errore salvataggio: ' + (err && err.message || err), 'err');
  });
}

function ecoModificaTipo(nomeTabella, codice, nuovoTipo) {
  var righe = ecoConfigCache[nomeTabella] || [];
  var risultato = ecoModificaCodice(righe, codice, { tipo: nuovoTipo || null });
  if (!risultato.ok) {
    console.error('[economia-admin] ' + risultato.errore);
    ecoFeedback(risultato.errore, 'err');
    return;
  }
  ecoSalvaConfig(ecoConfigCache, function () {
    ecoFeedback('Tipo salvato', 'ok');
  }, function (err) {
    console.error('[economia-admin] errore salvataggio dopo modifica tipo', err);
    ecoFeedback('Errore salvataggio: ' + (err && err.message || err), 'err');
  });
}

function ecoDisattiva(nomeTabella, codice) {
  if (!confirm('Disattivare il codice "' + codice + '"? Resterà valido per i movimenti storici.')) return;
  var righe = ecoConfigCache[nomeTabella] || [];
  var risultato = ecoDisattivaCodice(righe, codice);
  if (!risultato.ok) {
    ecoFeedback(risultato.errore, 'err');
    return;
  }
  ecoSalvaConfig(ecoConfigCache, function () {
    ecoRenderTab(nomeTabella, righe);
    ecoFeedback('Codice "' + codice + '" disattivato', 'ok');
  }, function (err) {
    ecoFeedback('Errore salvataggio: ' + (err && err.message || err), 'err');
  });
}

function ecoRiattiva(nomeTabella, codice) {
  var righe = ecoConfigCache[nomeTabella] || [];
  var record = righe.find(function (r) { return r.codice === codice; });
  if (!record) { ecoFeedback('Codice non trovato: ' + codice, 'err'); return; }
  record.attivo = true;
  ecoSalvaConfig(ecoConfigCache, function () {
    ecoRenderTab(nomeTabella, righe);
    ecoFeedback('Codice "' + codice + '" riattivato', 'ok');
  }, function (err) {
    record.attivo = false; // rollback locale se il salvataggio fallisce
    ecoFeedback('Errore salvataggio: ' + (err && err.message || err), 'err');
  });
}

window.addEventListener('error', function (e) {
  var msg = '[economia-admin] errore non gestito: ' + (e.error && e.error.message || e.message);
  console.error(msg);
  if (typeof log === 'function') log(msg, 'err');
});
window.addEventListener('unhandledrejection', function (e) {
  var msg = '[economia-admin] promise non gestita: ' + (e.reason && e.reason.message || e.reason);
  console.error(msg);
  if (typeof log === 'function') log(msg, 'err');
});
