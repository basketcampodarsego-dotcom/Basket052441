// ────────────────────────────────────────────────────────────
// FILE: documenti-atleta-upload.js — ASD Basket Campodarsego
// VERSIONE: v0.1 · 04/09/2026 · BK
// v0.1: creazione — compressione lato client + UI di selezione/anteprima
//   per allegati documentali atleta (certificato medico, modulo iscrizione,
//   altri atti). Vedi DEC-BK-DOC-ATLETA-FOTO-SCANSIONI e comunicato
//   260904_COM_BK_AR_DocumentazioneAtletaFotoScansioni.yaml.
//
// SCOPO DI QUESTO FILE: solo compressione + UI + validazione dimensione.
// NON scrive/legge Firestore direttamente — quello e' in
// documenti-atleta-core.js (approvato da AR il 04/09/2026,
// 260904_COM_AR_BK_ApprovazioneDocumentiAtleta.yaml). Questo file resta
// disaccoppiato dal salvataggio tramite il pattern callback
// (docAtletaImpostaCallback) cosi' la UI di selezione/compressione e'
// riusabile anche se la struttura Firestore cambiasse in futuro.
// docAtletaSalvaPlaceholder() qui sotto resta come rete di sicurezza SOLO
// per il caso in cui qualcuno usi questo modulo senza registrare un
// callback — non e' piu' lo stato normale del modulo.
//
// Dipende da: basket-core.js (log(), toast(), g()) se disponibili —
// tutte le chiamate sono difensive (typeof check) per poter essere
// testato anche isolato prima dell'integrazione finale.
// ────────────────────────────────────────────────────────────

// ── Soglie di sicurezza (stesso principio di VRB_MAX_BASE64_FIRMATO
// gia' in uso per il PDF firmato dei Verbali) ──
// Tenute sotto meta' del limite Firestore (1MB/documento) per lasciare
// margine ad altri campi dello stesso record — non e' un limite
// arbitrario stretto, e' per evitare di sforare in modo silenzioso.
var DOC_ATLETA_MAX_BASE64 = 700000; // ~525KB di file originale
var DOC_ATLETA_DIM_MAX = 1600;      // px lato lungo dopo compressione
var DOC_ATLETA_QUALITA_JPEG = 0.68; // stesso valore testato su foto reali (v. comunicato AR)

var DOC_ATLETA_TIPI = {
  CERTIFICATO_MEDICO: 'CERTIFICATO_MEDICO',
  MODULO_ISCRIZIONE: 'MODULO_ISCRIZIONE',
  ALTRO: 'ALTRO'
};
var DOC_ATLETA_TIPO_LABEL = {
  CERTIFICATO_MEDICO: 'Certificato medico',
  MODULO_ISCRIZIONE: 'Modulo iscrizione',
  ALTRO: 'Altro documento'
};

// ── Log difensivo — funziona anche se basket-core.js non e' ancora caricato ──
function docAtletaLog(msg, tipo) {
  if (typeof log === 'function') { log('[documenti-atleta] ' + msg, tipo || 'info'); return; }
  console.log('[documenti-atleta] ' + msg);
}
function docAtletaErr(msg) {
  console.error('[documenti-atleta] ' + msg);
  docAtletaLog(msg, 'err');
}

// ── Compressione immagine (canvas resize + JPEG) ──
// Restituisce una Promise che risolve con { base64, kb, w, h, mimeType }.
// MAI un fallimento silenzioso: ogni ramo d'errore rigetta con un
// messaggio chiaro, mai un base64 vuoto/troncato passato avanti.
function docAtletaComprimiImmagine(file) {
  return new Promise(function (resolve, reject) {
    if (!file) {
      var msgNo = '[documenti-atleta] docAtletaComprimiImmagine: nessun file fornito';
      docAtletaErr(msgNo);
      reject(new Error('Nessun file selezionato'));
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () {
      var msg = 'docAtletaComprimiImmagine: errore lettura file ' + file.name;
      docAtletaErr(msg);
      reject(new Error('Errore lettura file: ' + file.name));
    };
    reader.onload = function (e) {
      var img = new Image();
      img.onerror = function () {
        var msg = 'docAtletaComprimiImmagine: file non decodificabile come immagine (' + file.name + ') — se e\' un PDF usa docAtletaValidaPdf()';
        docAtletaErr(msg);
        reject(new Error('Il file non è un\'immagine valida (' + file.name + ')'));
      };
      img.onload = function () {
        try {
          var w = img.width, h = img.height;
          var scale = Math.min(1, DOC_ATLETA_DIM_MAX / Math.max(w, h));
          var nw = Math.round(w * scale), nh = Math.round(h * scale);
          var canvas = document.createElement('canvas');
          canvas.width = nw; canvas.height = nh;
          var ctx = canvas.getContext('2d');
          if (!ctx) {
            var msgCtx = 'docAtletaComprimiImmagine: canvas 2d context non disponibile';
            docAtletaErr(msgCtx);
            reject(new Error('Impossibile elaborare l\'immagine su questo dispositivo'));
            return;
          }
          ctx.drawImage(img, 0, 0, nw, nh);
          var dataUrl = canvas.toDataURL('image/jpeg', DOC_ATLETA_QUALITA_JPEG);
          var base64 = dataUrl.split(',')[1] || '';
          if (!base64) {
            var msgEmpty = 'docAtletaComprimiImmagine: risultato compressione vuoto per ' + file.name;
            docAtletaErr(msgEmpty);
            reject(new Error('Compressione fallita per ' + file.name));
            return;
          }
          var kb = Math.round(base64.length * 0.75 / 1024); // stima byte reali da base64
          docAtletaLog('Compressa ' + file.name + ': ' + w + 'x' + h + ' (' + Math.round(file.size / 1024) + 'KB) → ' + nw + 'x' + nh + ' (' + kb + 'KB)', 'ok');
          resolve({ base64: base64, kb: kb, w: nw, h: nh, mimeType: 'image/jpeg' });
        } catch (ex) {
          var msgEx = 'docAtletaComprimiImmagine: errore compressione ' + file.name + ': ' + (ex && ex.message || ex);
          docAtletaErr(msgEx);
          reject(ex);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Validazione PDF (nessuna ricompressione — un PDF gia' e' un formato
// compresso, ricomprimerlo non aiuta; si valida solo la soglia) ──
// Stesso principio di vrbVerificaStrutturaPdfFirmato: controllo
// strutturale minimo (%PDF), non una validazione completa del formato.
function docAtletaValidaPdf(file) {
  return new Promise(function (resolve, reject) {
    if (!file) {
      reject(new Error('Nessun file selezionato'));
      return;
    }
    file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf.slice(0, 5));
      var header = String.fromCharCode.apply(null, bytes);
      if (header !== '%PDF-') {
        var msg = 'docAtletaValidaPdf: intestazione non valida per ' + file.name + ' (atteso %PDF-, trovato "' + header + '")';
        docAtletaErr(msg);
        reject(new Error('Il file non sembra un PDF valido: ' + file.name));
        return;
      }
      var base64 = docAtletaArrayBufferToBase64(buf);
      var kb = Math.round(base64.length * 0.75 / 1024);
      if (base64.length > DOC_ATLETA_MAX_BASE64) {
        var msgSize = 'docAtletaValidaPdf: PDF troppo grande (' + kb + 'KB, limite ~' + Math.round(DOC_ATLETA_MAX_BASE64 * 0.75 / 1024) + 'KB) — ' + file.name;
        docAtletaErr(msgSize);
        reject(new Error('Il PDF è troppo grande (' + kb + 'KB) per essere allegato in questo modo — limite pratico ~' + Math.round(DOC_ATLETA_MAX_BASE64 * 0.75 / 1024) + 'KB. Prova a scansionare a risoluzione più bassa.'));
        return;
      }
      docAtletaLog('PDF validato ' + file.name + ': ' + kb + 'KB', 'ok');
      resolve({ base64: base64, kb: kb, mimeType: 'application/pdf' });
    }).catch(function (err) {
      var msg = 'docAtletaValidaPdf: errore lettura ' + file.name + ': ' + (err && err.message || err);
      docAtletaErr(msg);
      reject(err);
    });
  });
}

function docAtletaArrayBufferToBase64(buf) {
  var bytes = new Uint8Array(buf);
  var chunk = 32768; // evita stack overflow su String.fromCharCode.apply con file grandi
  var binario = '';
  for (var i = 0; i < bytes.length; i += chunk) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binario);
}

// ── Punto d'ingresso unico: decide se comprimere (immagine) o validare
// (PDF) in base al mimetype, sempre con la stessa soglia finale ──
function docAtletaElaboraFile(file) {
  if (!file) return Promise.reject(new Error('Nessun file selezionato'));
  if (file.type === 'application/pdf') return docAtletaValidaPdf(file);
  if (file.type.indexOf('image/') === 0) {
    return docAtletaComprimiImmagine(file).then(function (r) {
      if (r.base64.length > DOC_ATLETA_MAX_BASE64) {
        var msg = 'docAtletaElaboraFile: immagine ancora troppo grande dopo compressione (' + r.kb + 'KB) — ' + file.name;
        docAtletaErr(msg);
        throw new Error('L\'immagine resta troppo grande anche dopo la compressione (' + r.kb + 'KB). Prova con una foto meno dettagliata o illumina meglio il documento.');
      }
      return r;
    });
  }
  var msgTipo = 'docAtletaElaboraFile: tipo file non supportato (' + file.type + ') — ' + file.name;
  docAtletaErr(msgTipo);
  return Promise.reject(new Error('Formato non supportato: ' + (file.type || 'sconosciuto') + '. Usa una foto (JPG/PNG) o un PDF.'));
}

// ── UI: blocco di selezione + anteprima, iniettabile in una modale/scheda
// esistente. Il chiamante passa un containerId gia' presente nel DOM e un
// callback che ricevera' { tipoDoc, base64, kb, mimeType } SOLO dopo che
// l'utente ha confermato — nessun salvataggio automatico silenzioso. ──
function docAtletaCreaUIUpload(containerId, tipoDocDefault) {
  var cont = document.getElementById(containerId);
  if (!cont) {
    docAtletaErr('docAtletaCreaUIUpload: container #' + containerId + ' non trovato nel DOM');
    return;
  }
  var uid = containerId; // usato per rendere univoci gli id interni
  cont.innerHTML =
    '<div class="doc-atleta-upload" data-uid="' + uid + '">' +
      '<label>Tipo documento</label>' +
      '<select id="' + uid + '-tipo">' +
        '<option value="CERTIFICATO_MEDICO"' + (tipoDocDefault === 'CERTIFICATO_MEDICO' ? ' selected' : '') + '>Certificato medico</option>' +
        '<option value="MODULO_ISCRIZIONE"' + (tipoDocDefault === 'MODULO_ISCRIZIONE' ? ' selected' : '') + '>Modulo iscrizione</option>' +
        '<option value="ALTRO"' + (tipoDocDefault === 'ALTRO' ? ' selected' : '') + '>Altro documento</option>' +
      '</select>' +
      '<label style="margin-top:8px;">File (foto o PDF)</label>' +
      '<input type="file" id="' + uid + '-file" accept="image/*,application/pdf" onchange="docAtletaOnFileSelezionato(\'' + uid + '\')">' +
      '<div id="' + uid + '-stato" style="font-size:11px;color:var(--muted);margin-top:6px;">Nessun file selezionato.</div>' +
      '<div id="' + uid + '-anteprima" style="margin-top:8px;"></div>' +
      '<div id="' + uid + '-errore" style="color:#e03545;font-size:12px;margin-top:6px;"></div>' +
      '<button type="button" class="btn btn-gold" id="' + uid + '-btn-conferma" style="margin-top:10px;" disabled onclick="docAtletaConfermaUpload(\'' + uid + '\')">Conferma allegato</button>' +
    '</div>';
  docAtletaCache[uid] = { risultato: null, callback: null };
}

var docAtletaCache = {}; // uid -> { risultato, callback }

function docAtletaOnFileSelezionato(uid) {
  var fileEl = document.getElementById(uid + '-file');
  var statoEl = document.getElementById(uid + '-stato');
  var erroreEl = document.getElementById(uid + '-errore');
  var anteprimaEl = document.getElementById(uid + '-anteprima');
  var btnEl = document.getElementById(uid + '-btn-conferma');
  if (!fileEl || !fileEl.files || !fileEl.files.length) return;
  var file = fileEl.files[0];

  if (erroreEl) erroreEl.textContent = '';
  if (btnEl) btnEl.disabled = true;
  if (statoEl) statoEl.textContent = 'Elaborazione in corso…';
  if (anteprimaEl) anteprimaEl.innerHTML = '';

  docAtletaElaboraFile(file).then(function (risultato) {
    docAtletaCache[uid].risultato = risultato;
    if (statoEl) statoEl.textContent = 'Pronto: ' + risultato.kb + 'KB' + (risultato.w ? ' (' + risultato.w + 'x' + risultato.h + ')' : ' (PDF)');
    if (anteprimaEl && risultato.mimeType === 'image/jpeg') {
      anteprimaEl.innerHTML = '<img src="data:image/jpeg;base64,' + risultato.base64 + '" style="max-width:100%;max-height:220px;border-radius:8px;border:1px solid var(--border);">';
    } else if (anteprimaEl) {
      anteprimaEl.innerHTML = '<div style="font-size:12px;color:var(--muted);">📄 PDF pronto per l\'upload (anteprima non disponibile qui).</div>';
    }
    if (btnEl) btnEl.disabled = false;
  }).catch(function (err) {
    var msg = err && err.message || String(err);
    docAtletaErr('docAtletaOnFileSelezionato: ' + msg);
    if (erroreEl) erroreEl.textContent = msg;
    if (statoEl) statoEl.textContent = 'Errore — vedi sotto.';
    docAtletaCache[uid].risultato = null;
    if (btnEl) btnEl.disabled = true;
  });
}

// Registra il callback che ricevera' il risultato confermato dall'utente.
// Va chiamato dal codice che integra questo modulo, dopo docAtletaCreaUIUpload().
function docAtletaImpostaCallback(uid, callback) {
  if (!docAtletaCache[uid]) {
    docAtletaErr('docAtletaImpostaCallback: uid "' + uid + '" non inizializzato — chiamare prima docAtletaCreaUIUpload()');
    return;
  }
  docAtletaCache[uid].callback = callback;
}

function docAtletaConfermaUpload(uid) {
  var voce = docAtletaCache[uid];
  if (!voce || !voce.risultato) {
    docAtletaErr('docAtletaConfermaUpload: nessun risultato pronto per uid "' + uid + '"');
    return;
  }
  var tipoEl = document.getElementById(uid + '-tipo');
  var tipoDoc = tipoEl ? tipoEl.value : 'ALTRO';
  var payload = {
    tipoDoc: tipoDoc,
    base64: voce.risultato.base64,
    kb: voce.risultato.kb,
    mimeType: voce.risultato.mimeType
  };
  if (typeof voce.callback === 'function') {
    voce.callback(payload);
  } else {
    // Nessun callback registrato: non e' un salvataggio silenzioso, e'
    // un avviso esplicito che questo modulo da solo non salva nulla.
    docAtletaSalvaPlaceholder(payload);
  }
}

// ── Placeholder ESPLICITO — NON un salvataggio silenzioso ──
// Finche' AR non approva la struttura Firestore (subcollection dedicata,
// vedi DEC-BK-DOC-ATLETA-FOTO-SCANSIONI), questo modulo produce SOLO il
// payload compresso e pronto; il salvataggio vero va collegato qui una
// volta arrivata la decisione. Chiamare questa funzione senza averla
// prima sostituita e' un errore di integrazione, non un caso normale —
// per questo alza un errore visibile invece di no-op.
function docAtletaSalvaPlaceholder(payload) {
  var msg = 'docAtletaSalvaPlaceholder: salvataggio NON ancora collegato (in attesa decisione architetturale AR — vedi DEC-BK-DOC-ATLETA-FOTO-SCANSIONI). Payload pronto: tipo=' + payload.tipoDoc + ', ' + payload.kb + 'KB, ' + payload.mimeType + '.';
  docAtletaErr(msg);
  if (typeof toast === 'function') {
    toast('Allegato pronto (' + payload.kb + 'KB) ma il salvataggio non è ancora collegato — in attesa di AR', 'warn');
  } else {
    alert('Allegato elaborato correttamente (' + payload.kb + 'KB), ma il salvataggio su Firestore non è ancora collegato: in attesa della decisione architetturale di AR sulla struttura dati.');
  }
}

window.addEventListener('error', function (e) {
  var msg = '[documenti-atleta] errore non gestito: ' + (e.error && e.error.message || e.message);
  console.error(msg);
  if (typeof log === 'function') log(msg, 'err');
});
window.addEventListener('unhandledrejection', function (e) {
  var msg = '[documenti-atleta] promise non gestita: ' + (e.reason && e.reason.message || e.reason);
  console.error(msg);
  if (typeof log === 'function') log(msg, 'err');
});
