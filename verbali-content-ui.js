// ────────────────────────────────────────────────────────────
// FILE: verbali-content-ui.js — ASD Basket Campodarsego
// VERSIONE: v0.1 · 28/08/2026 · BK
// v0.1: creazione — editor di contenuto per un verbale in BOZZA (step 2)
//   + upload PDF firmato (step 3). Sostituisce il riepilogo readonly di
//   vrbAdmApri() con un editor vero quando lo stato è BOZZA.
// "Stile editor" (richiesta esplicita di Alberto 28/08/2026): le aree di
//   testo libero (discussione, delibera, relazione tesoriere, osservazioni
//   soci) usano un piccolo editor contenteditable con toolbar
//   Grassetto/Corsivo/Elenco invece di semplici <textarea> — coerente con
//   l'uso reale (verbali sono testo formattato, non dati strutturati).
// Autosalvataggio: 1.5s dopo l'ultima modifica, silenzioso in caso di
//   successo (stesso pattern toast/log del resto del progetto), MAI
//   silenzioso in caso di errore.
// Dipende da: verbali-core.js (deve essere caricato PRIMA), basket-core.js.
// ────────────────────────────────────────────────────────────

var vrbEditorVerbaleId = null;   // verbale attualmente aperto nell'editor
var vrbEditorAutosaveTimer = null;
var vrbEditorDirty = false;

// ── Editor di testo minimale (contenteditable + toolbar) ──
// Non è un rich-text editor completo: solo grassetto/corsivo/elenco
// puntato, il minimo che serve per un verbale leggibile. execCommand è
// deprecato ma resta l'unico modo di fare questo senza dipendenze esterne
// nel sandbox vanilla-JS del progetto — accettabile per questo scopo.
function vrbCreaEditorHtml(campoId, valoreIniziale, placeholder) {
  return '<div class="vrb-editor-toolbar">' +
    '<button type="button" onclick="vrbEditorCmd(\'' + campoId + '\',\'bold\')"><b>B</b></button>' +
    '<button type="button" onclick="vrbEditorCmd(\'' + campoId + '\',\'italic\')"><i>I</i></button>' +
    '<button type="button" onclick="vrbEditorCmd(\'' + campoId + '\',\'insertUnorderedList\')">&bull; Elenco</button>' +
    '</div>' +
    '<div id="' + campoId + '" class="vrb-editor" contenteditable="true" data-placeholder="' + vrbAdmEsc(placeholder || '') + '" oninput="vrbEditorSegnaModifica()">' +
    (valoreIniziale || '') + '</div>';
}

function vrbEditorCmd(campoId, comando) {
  var el = document.getElementById(campoId);
  if (!el) { console.error('[verbali-content-ui] vrbEditorCmd: campo non trovato: ' + campoId); return; }
  el.focus();
  document.execCommand(comando, false, null);
  vrbEditorSegnaModifica();
}

function vrbEditorSegnaModifica() {
  vrbEditorDirty = true;
  clearTimeout(vrbEditorAutosaveTimer);
  var indicatore = document.getElementById('vrb-editor-stato-salvataggio');
  if (indicatore) indicatore.textContent = 'Modifiche non salvate…';
  vrbEditorAutosaveTimer = setTimeout(vrbEditorAutosalva, 1500);
}

// ── Apertura editor (sostituisce il riepilogo readonly per stato BOZZA) ──
function vrbAdmApriEditor(id) {
  var v = vrbListaCache.find(function (x) { return x.id === id; });
  if (!v) { console.error('[verbali-content-ui] vrbAdmApriEditor: id non in cache: ' + id); return; }
  vrbEditorVerbaleId = id;
  vrbEditorDirty = false;

  var titleEl = document.getElementById('modal-vrb-dettaglio-title');
  var bodyEl = document.getElementById('vrb-dettaglio-body');
  if (!titleEl || !bodyEl) {
    console.error('[verbali-content-ui] markup modale #modal-vrb-dettaglio mancante nel DOM');
    return;
  }
  titleEl.textContent = 'Verbale ' + v.id + ' — Bozza';

  if (v.stato !== VRB_STATI.BOZZA) {
    vrbAdmMostraReadonly(v);
    if (typeof openModal === 'function') openModal('modal-vrb-dettaglio');
    return;
  }

  var html = '<div id="vrb-editor-stato-salvataggio" class="vrb-editor-savestate">Salvato</div>';

  html += '<label>Numero convocazione</label>' +
    '<select id="vrb-c-convocazione" onchange="vrbEditorSegnaModifica()">' +
    '<option value="PRIMA"' + (v.numeroConvocazione === 'SECONDA' ? '' : ' selected') + '>Prima</option>' +
    '<option value="SECONDA"' + (v.numeroConvocazione === 'SECONDA' ? ' selected' : '') + '>Seconda</option>' +
    '</select>';

  html += '<label>Presidente</label><input type="text" id="vrb-c-presidente" value="' + vrbAdmEsc(v.presidente || '') + '" oninput="vrbEditorSegnaModifica()">';
  html += '<label>Segretario verbalizzante</label><input type="text" id="vrb-c-segretario" value="' + vrbAdmEsc(v.segretario || '') + '" oninput="vrbEditorSegnaModifica()">';

  html += '<label>Presenti <span style="font-weight:400;color:var(--muted)">(un nome per riga)</span></label>' +
    '<textarea id="vrb-c-presenti" rows="3" oninput="vrbEditorSegnaModifica()">' + vrbAdmEsc((v.presenti || []).join('\n')) + '</textarea>';
  html += '<label>Assenti <span style="font-weight:400;color:var(--muted)">(un nome per riga)</span></label>' +
    '<textarea id="vrb-c-assenti" rows="2" oninput="vrbEditorSegnaModifica()">' + vrbAdmEsc((v.assenti || []).join('\n')) + '</textarea>';

  html += '<label>Nota quorum <span style="font-weight:400;color:var(--muted)">(facoltativa, es. "presenti 5 su 7")</span></label>' +
    '<input type="text" id="vrb-c-quorum" value="' + vrbAdmEsc(v.quorumNota || '') + '" oninput="vrbEditorSegnaModifica()">';

  if (v.tipo === 'BILANCIO') {
    html += vrbEditorBloccoBilancio(v);
  }

  html += '<div style="margin:16px 0 8px;font-size:12px;font-weight:700;color:var(--gold);display:flex;justify-content:space-between;align-items:center;">' +
    '<span>Ordine del giorno</span>' +
    '<button type="button" class="btn btn-gray btn-sm" onclick="vrbOdgAggiungiPunto()">➕ Punto</button></div>';
  html += '<div id="vrb-odg-lista"></div>';

  html += '<div class="btn-bar" style="margin-top:16px;">' +
    '<button type="button" class="btn btn-gray" onclick="closeModal(\'modal-vrb-dettaglio\')">Chiudi (bozza salvata)</button>' +
    '<button type="button" class="btn btn-gold" onclick="vrbConfermaGeneraPdf()">📄 Genera PDF definitivo</button>' +
    '</div>';
  html += '<p style="font-size:10.5px;color:var(--muted);margin-top:8px;">Dopo la generazione del PDF il contenuto non è più modificabile: per correggere un errore servirà un nuovo verbale con nota di rettifica.</p>';

  bodyEl.innerHTML = html;

  // Ordine del giorno popolato DOPO l'inserimento dell'HTML base, perché
  // ogni punto genera markup con editor contenteditable che deve poter
  // referenziare id già presenti nel DOM.
  vrbOdgCache = (v.ordineDelGiorno || []).map(function (p) { return Object.assign({}, p); });
  vrbOdgRenderLista();

  if (typeof openModal === 'function') openModal('modal-vrb-dettaglio');
}

// ── Blocco specifico modello BILANCIO (§3.4, §4.2) ──
function vrbEditorBloccoBilancio(v) {
  var html = '<div class="vrb-bilancio-box">';
  html += '<label>Esercizio di riferimento</label>' +
    '<input type="number" id="vrb-c-anno-esercizio" value="' + vrbAdmEsc(v.annoEsercizioRif || v.dataRiunione ? (v.annoEsercizioRif || v.dataRiunione.slice(0, 4)) : '') + '" oninput="vrbEditorSegnaModifica()">';
  html += '<button type="button" class="btn btn-blue btn-sm" style="margin-bottom:10px;" onclick="vrbRecuperaTotaliBilancio()">🔄 Recupera totali da Economia</button>';
  html += '<div id="vrb-bilancio-totali" style="font-size:12px;color:var(--muted);margin-bottom:10px;">' +
    (v.totaliBilancioTesto ? vrbAdmEsc(v.totaliBilancioTesto) : 'Totali non ancora recuperati.') + '</div>';
  html += '<label>Relazione del tesoriere</label>' + vrbCreaEditorHtml('vrb-c-relazione', v.relazioneTesoriere, 'Testo della relazione…');
  html += '<label style="margin-top:10px;">Osservazioni dei soci</label>' + vrbCreaEditorHtml('vrb-c-osservazioni', v.osservazioniSoci, 'Eventuali dissensi o osservazioni…');
  html += '<label style="margin-top:10px;">Destinazione avanzo di gestione <span style="font-weight:400;color:var(--muted)">(opzionale)</span></label>' + vrbCreaEditorHtml('vrb-c-destinazione', v.destinazioneAvanzo, 'Es. accantonamento a riserva…');
  html += '</div>';
  return html;
}

function vrbRecuperaTotaliBilancio() {
  var annoEl = document.getElementById('vrb-c-anno-esercizio');
  var anno = annoEl ? annoEl.value : '';
  var out = document.getElementById('vrb-bilancio-totali');
  if (!anno) { alert('Indica prima l\'esercizio di riferimento.'); return; }
  if (out) out.textContent = 'Caricamento…';
  vrbBilancioTotali(anno).then(function (tot) {
    var testo = 'Totale entrate: € ' + tot.totEntrate.toFixed(2) +
      ' — Totale uscite: € ' + tot.totUscite.toFixed(2) +
      ' — Saldo esercizio: € ' + tot.saldoEsercizio.toFixed(2);
    if (out) out.textContent = testo;
    vrbEditorBilancioTotaliCache = { anno: anno, testo: testo, dati: tot };
    vrbEditorSegnaModifica();
  }).catch(function (err) {
    if (out) out.textContent = 'Errore: ' + (err && err.message || err);
  });
}
var vrbEditorBilancioTotaliCache = null;

// ── Ordine del giorno: lista dinamica di punti ──
var vrbOdgCache = [];

function vrbOdgAggiungiPunto() {
  vrbOdgCache.push({ testo: '', discussione: '', delibera: '', esitoVoto: { tipo: 'UNANIMITA', favorevoli: 0, contrari: 0, astenuti: 0 } });
  vrbOdgRenderLista();
  vrbEditorSegnaModifica();
}

function vrbOdgRimuoviPunto(idx) {
  vrbOdgCache.splice(idx, 1);
  vrbOdgRenderLista();
  vrbEditorSegnaModifica();
}

function vrbOdgRenderLista() {
  vrbOdgSincronizzaDalDom(); // salva quanto digitato finora prima di rigenerare il markup
  var cont = document.getElementById('vrb-odg-lista');
  if (!cont) { console.error('[verbali-content-ui] #vrb-odg-lista non trovato'); return; }
  if (!vrbOdgCache.length) {
    cont.innerHTML = '<p style="color:var(--muted);font-size:11px;">Nessun punto. Usa "➕ Punto" per aggiungerne uno.</p>';
    return;
  }
  var html = '';
  vrbOdgCache.forEach(function (p, i) {
    var ev = p.esitoVoto || { tipo: 'UNANIMITA', favorevoli: 0, contrari: 0, astenuti: 0 };
    html += '<div class="vrb-odg-punto">' +
      '<div style="display:flex;gap:8px;align-items:flex-start;">' +
      '<input type="text" id="vrb-odg-testo-' + i + '" placeholder="Punto ' + (i + 1) + ': oggetto" value="' + vrbAdmEsc(p.testo) + '" oninput="vrbEditorSegnaModifica()" style="flex:1;">' +
      '<button type="button" class="btn btn-red btn-sm" onclick="vrbOdgRimuoviPunto(' + i + ')" title="Rimuovi punto">✕</button>' +
      '</div>' +
      '<label style="margin-top:6px;">Discussione</label>' + vrbCreaEditorHtml('vrb-odg-discussione-' + i, p.discussione, 'Sintesi della discussione…') +
      '<label style="margin-top:6px;">Delibera</label>' + vrbCreaEditorHtml('vrb-odg-delibera-' + i, p.delibera, 'Testo della delibera…') +
      '<div style="display:flex;gap:10px;align-items:center;margin-top:6px;flex-wrap:wrap;">' +
      '<select id="vrb-odg-esito-' + i + '" onchange="vrbOdgToggleVoto(' + i + ')">' +
      '<option value="UNANIMITA"' + (ev.tipo === 'UNANIMITA' ? ' selected' : '') + '>Unanimità</option>' +
      '<option value="MAGGIORANZA"' + (ev.tipo === 'MAGGIORANZA' ? ' selected' : '') + '>Maggioranza</option>' +
      '</select>' +
      '<span id="vrb-odg-voto-conteggio-' + i + '" style="display:' + (ev.tipo === 'MAGGIORANZA' ? 'flex' : 'none') + ';gap:6px;">' +
      '<input type="number" min="0" id="vrb-odg-fav-' + i + '" value="' + (ev.favorevoli || 0) + '" placeholder="Fav." style="width:64px;margin:0;" oninput="vrbEditorSegnaModifica()">' +
      '<input type="number" min="0" id="vrb-odg-con-' + i + '" value="' + (ev.contrari || 0) + '" placeholder="Contr." style="width:64px;margin:0;" oninput="vrbEditorSegnaModifica()">' +
      '<input type="number" min="0" id="vrb-odg-ast-' + i + '" value="' + (ev.astenuti || 0) + '" placeholder="Ast." style="width:64px;margin:0;" oninput="vrbEditorSegnaModifica()">' +
      '</span></div></div>';
  });
  cont.innerHTML = html;
}

function vrbOdgToggleVoto(idx) {
  var sel = document.getElementById('vrb-odg-esito-' + idx);
  var box = document.getElementById('vrb-odg-voto-conteggio-' + idx);
  if (box && sel) box.style.display = sel.value === 'MAGGIORANZA' ? 'flex' : 'none';
  vrbEditorSegnaModifica();
}

// Legge lo stato attuale del DOM (editor contenteditable + input) dentro
// vrbOdgCache PRIMA di rigenerare il markup — altrimenti aggiungere/
// rimuovere un punto perderebbe silenziosamente quanto scritto negli
// altri punti già in editing. Mai una perdita di dati non segnalata.
function vrbOdgSincronizzaDalDom() {
  vrbOdgCache.forEach(function (p, i) {
    var testoEl = document.getElementById('vrb-odg-testo-' + i);
    var discEl = document.getElementById('vrb-odg-discussione-' + i);
    var delEl = document.getElementById('vrb-odg-delibera-' + i);
    var esitoEl = document.getElementById('vrb-odg-esito-' + i);
    if (testoEl) p.testo = testoEl.value;
    if (discEl) p.discussione = discEl.innerHTML;
    if (delEl) p.delibera = delEl.innerHTML;
    if (esitoEl) {
      var favEl = document.getElementById('vrb-odg-fav-' + i);
      var conEl = document.getElementById('vrb-odg-con-' + i);
      var astEl = document.getElementById('vrb-odg-ast-' + i);
      p.esitoVoto = {
        tipo: esitoEl.value,
        favorevoli: favEl ? (parseInt(favEl.value, 10) || 0) : 0,
        contrari: conEl ? (parseInt(conEl.value, 10) || 0) : 0,
        astenuti: astEl ? (parseInt(astEl.value, 10) || 0) : 0
      };
    }
  });
}

// ── Raccolta campi + autosalvataggio ──
function vrbEditorRaccogliCampi() {
  vrbOdgSincronizzaDalDom();
  var presentiEl = document.getElementById('vrb-c-presenti');
  var assentiEl = document.getElementById('vrb-c-assenti');
  var campi = {
    numeroConvocazione: (document.getElementById('vrb-c-convocazione') || {}).value || 'PRIMA',
    presidente: (document.getElementById('vrb-c-presidente') || {}).value || '',
    segretario: (document.getElementById('vrb-c-segretario') || {}).value || '',
    presenti: presentiEl ? presentiEl.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) : [],
    assenti: assentiEl ? assentiEl.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) : [],
    quorumNota: (document.getElementById('vrb-c-quorum') || {}).value || '',
    ordineDelGiorno: vrbOdgCache.map(function (p) { return Object.assign({}, p); })
  };
  var v = vrbListaCache.find(function (x) { return x.id === vrbEditorVerbaleId; });
  if (v && v.tipo === 'BILANCIO') {
    campi.annoEsercizioRif = (document.getElementById('vrb-c-anno-esercizio') || {}).value || '';
    campi.relazioneTesoriere = (document.getElementById('vrb-c-relazione') || {}).innerHTML || '';
    campi.osservazioniSoci = (document.getElementById('vrb-c-osservazioni') || {}).innerHTML || '';
    campi.destinazioneAvanzo = (document.getElementById('vrb-c-destinazione') || {}).innerHTML || '';
    if (vrbEditorBilancioTotaliCache && vrbEditorBilancioTotaliCache.anno === campi.annoEsercizioRif) {
      campi.totaliBilancioTesto = vrbEditorBilancioTotaliCache.testo;
    }
  }
  return campi;
}

function vrbEditorAutosalva() {
  if (!vrbEditorDirty || !vrbEditorVerbaleId) return;
  var campi = vrbEditorRaccogliCampi();
  var indicatore = document.getElementById('vrb-editor-stato-salvataggio');
  vrbSalvaBozza(vrbEditorVerbaleId, campi).then(function () {
    vrbEditorDirty = false;
    if (indicatore) indicatore.textContent = 'Salvato';
    // Aggiorna la cache locale così una chiusura/riapertura del modale
    // mostra i dati coerenti senza un round-trip di lettura in più.
    var v = vrbListaCache.find(function (x) { return x.id === vrbEditorVerbaleId; });
    if (v) Object.assign(v, campi);
  }).catch(function (err) {
    if (indicatore) indicatore.innerHTML = '<span style="color:#e03545">Errore salvataggio: ' + vrbAdmEsc(err && err.message || err) + '</span>';
  });
}

// ── Genera PDF definitivo (transizione BOZZA → GENERATO, irreversibile) ──
function vrbConfermaGeneraPdf() {
  if (!confirm('Generare il PDF definitivo? Da questo momento il contenuto non sarà più modificabile.')) return;
  var campi = vrbEditorRaccogliCampi();
  var id = vrbEditorVerbaleId;
  vrbSalvaBozza(id, campi).then(function () {
    return vrbLeggi(id);
  }).then(function (record) {
    return vrbAvanzaAGenerato(id, record);
  }).then(function () {
    if (typeof toast === 'function') toast('Verbale ' + id + ': PDF generato, verbale bloccato in modifica', 'ok');
    vrbAdmInit();
    if (typeof closeModal === 'function') closeModal('modal-vrb-dettaglio');
  }).catch(function (err) {
    var msg = 'Errore generazione PDF verbale ' + id + ': ' + (err && err.message || err);
    // Log SEMPRE scritto, indipendentemente dal fatto che l'alert arrivi
    // a schermo o venga soppresso dal browser (successione confirm+alert
    // rapida su mobile — comportamento noto, non un bug del codice, ma
    // un canale di consegna che non va usato come UNICO segnale d'errore).
    if (typeof log === 'function') log('[verbali-content-ui] ' + msg, 'err');
    alert(msg);
  });
}

// ── Vista readonly per GENERATO/FIRMATO (sostituisce quella base di
// verbali-admin-ui.js con link al PDF e, se GENERATO, upload firmato) ──
function vrbAdmMostraReadonly(v) {
  var bodyEl = document.getElementById('vrb-dettaglio-body');
  if (!bodyEl) return;
  var corpo = '<b>' + vrbAdmEsc(v.id) + '</b> — ' + vrbAdmEsc(VRB_STATO_LABEL[v.stato] || v.stato) + '<br>' +
    vrbAdmEsc(VRB_TIPO_LABEL[v.tipo] || v.tipo) + ' · ' + vrbAdmEsc(VRB_ORGANO_LABEL[v.organo] || v.organo) + '<br>' +
    'Riunione: ' + vrbAdmEsc(v.dataRiunione || '—') + ' · ' + vrbAdmEsc(v.luogo || '—') + '<br><br>';
  if (v.stato === VRB_STATI.GENERATO || v.stato === VRB_STATI.FIRMATO) {
    corpo += '<button type="button" class="btn btn-blue btn-sm" onclick="vrbAdmVisualizzaGenerato(\'' + v.id + '\')">📄 Visualizza/stampa PDF</button><br><br>';
  }
  if (v.pdfFirmatoBase64) {
    corpo += '<button type="button" class="btn btn-green btn-sm" onclick="vrbAdmVisualizzaFirmato(\'' + v.id + '\')">✅ Apri PDF firmato</button><br>';
    corpo += '<span style="font-size:11px;color:var(--muted)">Firmato il ' + vrbAdmEsc(v.dataFirma || '—') + '</span>';
  } else if (v.stato === VRB_STATI.GENERATO) {
    corpo += '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">' +
      '<label>Carica PDF firmato</label>' +
      '<input type="file" id="vrb-upload-firmato" accept="application/pdf">' +
      '<label>Tipo di firma</label>' +
      '<select id="vrb-upload-tipofirma"><option value="FEQ">FEQ — Firma Elettronica Qualificata</option><option value="FEA">FEA — Firma Elettronica Avanzata</option></select>' +
      '<label>Firmatari <span style="font-weight:400;color:var(--muted)">(un nome per riga)</span></label>' +
      '<textarea id="vrb-upload-firmatari" rows="2"></textarea>' +
      '<button type="button" class="btn btn-gold" style="margin-top:8px;width:100%" onclick="vrbAdmCaricaFirmato(\'' + v.id + '\')">Carica e blocca definitivamente</button>' +
      '<p style="font-size:10px;color:var(--muted);margin-top:6px;">Verifica solo strutturale (il file è un PDF con firma incorporata) — non sostituisce una verifica crittografica completa.</p>' +
      '</div>';
  }
  bodyEl.innerHTML = corpo;
}

// Visualizza il PDF rigenerandolo al volo dai dati — mai un URL salvato,
// mai un artefatto persistito separatamente (§ v0.3 verbali-core.js).
function vrbAdmVisualizzaGenerato(id) {
  var v = vrbListaCache.find(function (x) { return x.id === id; });
  if (!v) { console.error('[verbali-content-ui] vrbAdmVisualizzaGenerato: id non in cache: ' + id); return; }
  try {
    vrbVisualizzaPdfGenerato(v);
  } catch (e) {
    // Errore mostrato SIA con alert SIA nel log — su mobile un alert
    // subito dopo un confirm() può essere soppresso dal browser, quindi
    // l'unico canale davvero affidabile è il log (già scritto dentro
    // vrbVisualizzaPdfGenerato). Qui l'alert è un aiuto in più, non l'unico.
    alert('Errore visualizzazione PDF: ' + (e && e.message || e));
  }
}

function vrbAdmVisualizzaFirmato(id) {
  var v = vrbListaCache.find(function (x) { return x.id === id; });
  if (!v) { console.error('[verbali-content-ui] vrbAdmVisualizzaFirmato: id non in cache: ' + id); return; }
  try {
    vrbVisualizzaPdfFirmato(v.pdfFirmatoBase64);
  } catch (e) {
    alert('Errore apertura PDF firmato: ' + (e && e.message || e));
  }
}

function vrbAdmCaricaFirmato(id) {
  var fileEl = document.getElementById('vrb-upload-firmato');
  var tipoEl = document.getElementById('vrb-upload-tipofirma');
  var firmatariEl = document.getElementById('vrb-upload-firmatari');
  if (!fileEl || !fileEl.files || !fileEl.files.length) { alert('Seleziona un file PDF.'); return; }
  var metadati = {
    tipoFirmaDichiarato: tipoEl ? tipoEl.value : '',
    firmatari: firmatariEl ? firmatariEl.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) : []
  };
  vrbCaricaFirmato(id, fileEl.files[0], metadati).then(function () {
    if (typeof toast === 'function') toast('Verbale ' + id + ' firmato e bloccato definitivamente', 'ok');
    vrbAdmInit();
    if (typeof closeModal === 'function') closeModal('modal-vrb-dettaglio');
  }).catch(function (err) {
    var msg = 'Errore caricamento PDF firmato verbale ' + id + ': ' + (err && err.message || err);
    if (typeof log === 'function') log('[verbali-content-ui] ' + msg, 'err');
    alert(msg);
  });
}

// Sovrascrive l'apertura "solo lettura sempre" di verbali-admin-ui.js
// con la versione che apre l'editor per le bozze — unico punto in cui
// una funzione di un file successivamente caricato prende il posto di
// una di un file precedente: dichiarato qui esplicitamente per evitare
// che sembri uno shadowing accidentale in futuro.
function vrbAdmApri(id) {
  vrbAdmApriEditor(id);
}

window.addEventListener('error', function (e) {
  var msg = '[verbali-content-ui] errore non gestito: ' + (e.error && e.error.message || e.message);
  console.error(msg);
  if (typeof log === 'function') log(msg, 'err');
});
window.addEventListener('unhandledrejection', function (e) {
  var msg = '[verbali-content-ui] promise non gestita: ' + (e.reason && e.reason.message || e.reason);
  console.error(msg);
  if (typeof log === 'function') log(msg, 'err');
});
