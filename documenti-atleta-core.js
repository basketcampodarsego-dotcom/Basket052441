// ────────────────────────────────────────────────────────────
// FILE: documenti-atleta-core.js — ASD Basket Campodarsego
// VERSIONE: v0.4 · 04/09/2026 · BK
// v0.1: creazione — CRUD Firestore per gli allegati documentali atleta
//   (certificato medico, modulo iscrizione, altri atti), approvato da AR
//   il 04/09/2026 (260904_COM_AR_BK_ApprovazioneDocumentiAtleta.yaml,
//   rif. DEC-BK-DOC-ATLETA-FOTO-SCANSIONI). Path v0.1 basato su un
//   ref-getter configurabile, per non assumere la struttura di "atleti".
// v0.2: corretto il path (vedi sotto) dopo aver verificato che DB.atleti
//   e' un blob JSON unico, non un documento per atleta — il ref-getter
//   configurabile non serve piu', il path e' ora fisso e autosufficiente.
// v0.3: aggiunte docAtletaStampa() (finestra di stampa nativa browser) e
//   docAtletaCondividi() (Web Share API — menu nativo Android, incluso
//   WhatsApp se installato; nessuna integrazione diretta con WhatsApp).
// v0.4: aggiunta docAtletaVisualizza() — apertura a schermo intero per
//   lettura (PDF: nuova scheda con visualizzatore nativo; immagine:
//   lightbox creata al volo, tap per chiudere).
//
// Sottocollection: basket052441/documentiAtleti/{atletaId}/documenti/{docId}
// CORRETTO il 04/09/2026 (v0.2) — path originale v0.1
// (basket052441/atleti/{atletaId}/documenti/{docId}) presupponeva un
// documento Firestore per singolo atleta CHE NON ESISTE: DB.atleti e' un
// unico array JSON salvato in un solo documento basket052441/atleti
// (campo v), stesso pattern di basket052441/pagamenti,
// basket052441/allenamenti ecc. Vedi
// VIO-BK-PROPOSTA-ARCH-NON-VERIFICATA-DOCATLETA-20260904.
// Path nuovo: documento contenitore DEDICATO "documentiAtleti" (stesso
// pattern di "economiaConfig"), con una sottocollection per atleta
// (nome = atletaId) sotto quel documento — completamente separato dal
// blob JSON esistente di basket052441/atleti, nessuna interferenza con
// la sincronizzazione localStorage<->Firebase gia' in uso su quella
// sezione. I principi approvati da AR (sottocollection dedicata,
// base64+soglia esplicita, niente Firebase Storage) restano tutti
// applicati — cambia solo l'ancoraggio del path.
// Procede su ordine esplicito di Alberto (04/09/2026) senza attendere la
// ri-conferma di AR sul path corretto (richiesta in
// 260904_COM_BK_AR_CorrezioneStrutturaDocAtleta.yaml) — vedi nota in
// DEC-BK-DOC-ATLETA-FOTO-SCANSIONI.
//
// Dipende da: basket-core.js (_db, log(), toast(), nowStr()).
// Dipende da: documenti-atleta-upload.js (DOC_ATLETA_TIPI, soglie —
//   questo file NON ridefinisce quelle costanti, le riusa).
// ────────────────────────────────────────────────────────────

var DOC_ATLETA_DOC_CONTENITORE = 'documentiAtleti'; // documento dedicato, sotto basket052441

function docAtletaCollRef(atletaId) {
  if (!atletaId) {
    throw new Error('docAtletaCollRef: atletaId mancante');
  }
  if (typeof _db === 'undefined' || !_db) {
    var msgDb = 'docAtletaCollRef: _db (Firestore) non disponibile — basket-core.js non caricato?';
    docAtletaErr(msgDb);
    throw new Error('Connessione al database non disponibile');
  }
  // basket052441 → documentiAtleti (doc contenitore dedicato) → {atletaId} (sottocollection) → {docId} (doc)
  return _db.collection('basket052441').doc(DOC_ATLETA_DOC_CONTENITORE).collection(String(atletaId));
}

// ── Crea un nuovo documento allegato ──
// payload atteso: { tipoDoc, base64, kb, mimeType } — l'output di
// docAtletaElaboraFile() in documenti-atleta-upload.js.
// Restituisce una Promise<docId>. MAI un salvataggio troncato: se il
// base64 supera la soglia, rifiuta qui di nuovo (seconda barriera,
// indipendente da quella gia' fatta lato upload — difesa in profondita').
function docAtletaSalva(atletaId, payload) {
  return new Promise(function (resolve, reject) {
    if (typeof _db === 'undefined' || !_db) {
      var msgDb = 'docAtletaSalva: _db (Firestore) non disponibile — basket-core.js non caricato?';
      docAtletaErr(msgDb);
      reject(new Error('Connessione al database non disponibile'));
      return;
    }
    if (!atletaId) {
      docAtletaErr('docAtletaSalva: atletaId mancante');
      reject(new Error('Atleta non specificato'));
      return;
    }
    if (!payload || !payload.base64) {
      docAtletaErr('docAtletaSalva: payload mancante o senza base64 per atletaId=' + atletaId);
      reject(new Error('Nessun contenuto da salvare'));
      return;
    }
    if (payload.base64.length > DOC_ATLETA_MAX_BASE64) {
      var msgSize = 'docAtletaSalva: base64 oltre soglia (' + payload.kb + 'KB) per atletaId=' + atletaId + ' — RIFIUTATO, seconda barriera lato core';
      docAtletaErr(msgSize);
      reject(new Error('Il file è troppo grande per essere salvato (' + payload.kb + 'KB)'));
      return;
    }
    if (!payload.tipoDoc || !DOC_ATLETA_TIPO_LABEL[payload.tipoDoc]) {
      docAtletaErr('docAtletaSalva: tipoDoc non riconosciuto "' + payload.tipoDoc + '" per atletaId=' + atletaId);
      reject(new Error('Tipo documento non valido: ' + payload.tipoDoc));
      return;
    }

    var record = {
      tipoDoc: payload.tipoDoc,
      mimeType: payload.mimeType,
      base64: payload.base64,
      kb: payload.kb,
      caricatoIl: (typeof nowStr === 'function') ? nowStr() : new Date().toISOString(),
      caricatoDa: (typeof currentUserLabel === 'function') ? currentUserLabel() : null
    };

    docAtletaCollRef(atletaId).add(record).then(function (docRef) {
      docAtletaLog('Documento salvato per atletaId=' + atletaId + ': docId=' + docRef.id + ', tipo=' + payload.tipoDoc + ', ' + payload.kb + 'KB', 'ok');
      resolve(docRef.id);
    }).catch(function (err) {
      var msgWrite = 'docAtletaSalva: errore scrittura Firestore per atletaId=' + atletaId + ': ' + (err && err.message || err);
      docAtletaErr(msgWrite);
      reject(err);
    });
  });
}

// ── Elenco documenti di un atleta (ordinati per data caricamento, piu' recenti prima) ──
// Restituisce Promise<Array<{id, tipoDoc, mimeType, kb, caricatoIl, caricatoDa}>>
// NOTA: non include il base64 nell'elenco (potenzialmente pesante per una
// lista) — usare docAtletaLeggiDocumento() per il contenuto completo di
// un singolo documento quando serve (es. anteprima o ristampa).
function docAtletaListaDocumenti(atletaId) {
  return new Promise(function (resolve, reject) {
    if (typeof _db === 'undefined' || !_db) {
      docAtletaErr('docAtletaListaDocumenti: _db non disponibile');
      reject(new Error('Connessione al database non disponibile'));
      return;
    }
    if (!atletaId) {
      docAtletaErr('docAtletaListaDocumenti: atletaId mancante');
      reject(new Error('Atleta non specificato'));
      return;
    }
    docAtletaCollRef(atletaId).orderBy('caricatoIl', 'desc').get().then(function (snap) {
      var elenco = [];
      snap.forEach(function (doc) {
        var d = doc.data();
        elenco.push({
          id: doc.id,
          tipoDoc: d.tipoDoc,
          mimeType: d.mimeType,
          kb: d.kb,
          caricatoIl: d.caricatoIl,
          caricatoDa: d.caricatoDa
        });
      });
      docAtletaLog('Elenco documenti atletaId=' + atletaId + ': ' + elenco.length + ' trovati', 'info');
      resolve(elenco);
    }).catch(function (err) {
      var msg = 'docAtletaListaDocumenti: errore lettura per atletaId=' + atletaId + ': ' + (err && err.message || err);
      docAtletaErr(msg);
      reject(err);
    });
  });
}

// ── Lettura completa di un singolo documento (con base64) ──
// Usare solo quando serve davvero il contenuto (anteprima, ristampa) —
// mai per popolare liste, per non caricare inutilmente centinaia di KB.
function docAtletaLeggiDocumento(atletaId, docId) {
  return new Promise(function (resolve, reject) {
    if (typeof _db === 'undefined' || !_db) {
      docAtletaErr('docAtletaLeggiDocumento: _db non disponibile');
      reject(new Error('Connessione al database non disponibile'));
      return;
    }
    if (!atletaId || !docId) {
      docAtletaErr('docAtletaLeggiDocumento: parametri mancanti (atletaId=' + atletaId + ', docId=' + docId + ')');
      reject(new Error('Riferimento documento incompleto'));
      return;
    }
    docAtletaCollRef(atletaId).doc(docId).get().then(function (doc) {
      if (!doc.exists) {
        var msgNo = 'docAtletaLeggiDocumento: documento non trovato (atletaId=' + atletaId + ', docId=' + docId + ')';
        docAtletaErr(msgNo);
        reject(new Error('Documento non trovato'));
        return;
      }
      var d = doc.data();
      resolve({
        id: doc.id, tipoDoc: d.tipoDoc, mimeType: d.mimeType, base64: d.base64,
        kb: d.kb, caricatoIl: d.caricatoIl, caricatoDa: d.caricatoDa
      });
    }).catch(function (err) {
      var msg = 'docAtletaLeggiDocumento: errore lettura (atletaId=' + atletaId + ', docId=' + docId + '): ' + (err && err.message || err);
      docAtletaErr(msg);
      reject(err);
    });
  });
}

// ── Eliminazione di un documento ──
// Nessuna conferma qui dentro (responsabilita' della UI chiamante,
// coerente con il resto del gestionale — confirm() lato admin-ui).
function docAtletaEliminaDocumento(atletaId, docId) {
  return new Promise(function (resolve, reject) {
    if (typeof _db === 'undefined' || !_db) {
      docAtletaErr('docAtletaEliminaDocumento: _db non disponibile');
      reject(new Error('Connessione al database non disponibile'));
      return;
    }
    if (!atletaId || !docId) {
      docAtletaErr('docAtletaEliminaDocumento: parametri mancanti (atletaId=' + atletaId + ', docId=' + docId + ')');
      reject(new Error('Riferimento documento incompleto'));
      return;
    }
    docAtletaCollRef(atletaId).doc(docId).delete().then(function () {
      docAtletaLog('Documento eliminato: atletaId=' + atletaId + ', docId=' + docId, 'ok');
      resolve();
    }).catch(function (err) {
      var msg = 'docAtletaEliminaDocumento: errore eliminazione (atletaId=' + atletaId + ', docId=' + docId + '): ' + (err && err.message || err);
      docAtletaErr(msg);
      reject(err);
    });
  });
}

// ── Collante tra UI (documenti-atleta-upload.js) e salvataggio reale ──
// Da chiamare subito dopo docAtletaCreaUIUpload(uid, ...): registra il
// callback che, alla conferma dell'utente, salva davvero su Firestore e
// invoca onSalvato(docId) — es. per ricaricare la lista o chiudere una
// modale. Se il salvataggio fallisce, l'errore arriva gia' visibile
// all'utente (toast/alert) da docAtletaSalva/docAtletaErr — questa
// funzione non aggiunge un secondo livello di gestione errori silenzioso.
function docAtletaCollegaUpload(uid, atletaId, onSalvato) {
  if (typeof docAtletaImpostaCallback !== 'function') {
    docAtletaErr('docAtletaCollegaUpload: docAtletaImpostaCallback non disponibile — documenti-atleta-upload.js caricato dopo questo file?');
    throw new Error('Ordine di caricamento script errato: documenti-atleta-upload.js deve precedere documenti-atleta-core.js');
  }
  docAtletaImpostaCallback(uid, function (payload) {
    docAtletaSalva(atletaId, payload).then(function (docId) {
      if (typeof toast === 'function') toast('Documento salvato', 'ok');
      if (typeof onSalvato === 'function') onSalvato(docId);
    }).catch(function (err) {
      var msg = err && err.message || String(err);
      if (typeof toast === 'function') toast('Errore salvataggio: ' + msg, 'err');
      else alert('Errore salvataggio: ' + msg);
    });
  });
}

// ── Visualizzazione a schermo intero (lettura, non stampa/condivisione).
// PDF: nuova scheda col visualizzatore nativo del browser (gia' pensato
// per la lettura: zoom, scorrimento). Immagine: lightbox a schermo
// intero creata al volo, tap per chiudere. ──
function docAtletaVisualizza(atletaId, docId) {
  docAtletaLeggiDocumento(atletaId, docId).then(function (doc) {
    if (doc.mimeType === 'application/pdf') {
      var w = window.open('', '_blank');
      if (!w) {
        var msg = 'docAtletaVisualizza: popup bloccato dal browser (atletaId=' + atletaId + ', docId=' + docId + ')';
        docAtletaErr(msg);
        alert('Il browser ha bloccato l\'apertura del documento. Controlla le impostazioni popup e riprova.');
        return;
      }
      w.document.write('<html><head><title>Documento</title><style>body{margin:0}</style></head><body>' +
        '<embed src="data:application/pdf;base64,' + doc.base64 + '" type="application/pdf" width="100%" height="100%" style="border:0;position:fixed;inset:0;">' +
        '</body></html>');
      w.document.close();
    } else {
      docAtletaMostraLightbox(doc.base64);
    }
    docAtletaLog('Documento aperto per lettura: atletaId=' + atletaId + ', docId=' + docId, 'info');
  }).catch(function (err) {
    var msg = 'docAtletaVisualizza: errore lettura documento (atletaId=' + atletaId + ', docId=' + docId + '): ' + (err && err.message || err);
    docAtletaErr(msg);
    alert('Errore apertura documento: ' + (err && err.message || err));
  });
}

function docAtletaMostraLightbox(base64) {
  var ov = document.getElementById('doc-atleta-lightbox');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'doc-atleta-lightbox';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.onclick = function () { ov.style.display = 'none'; };
    var img = document.createElement('img');
    img.id = 'doc-atleta-lightbox-img';
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
    ov.appendChild(img);
    var hint = document.createElement('div');
    hint.textContent = 'Tocca per chiudere';
    hint.style.cssText = 'position:absolute;bottom:16px;left:0;right:0;text-align:center;color:#fff;font-size:12px;opacity:0.7;';
    ov.appendChild(hint);
    document.body.appendChild(ov);
  }
  var imgEl = document.getElementById('doc-atleta-lightbox-img');
  if (!imgEl) {
    docAtletaErr('docAtletaMostraLightbox: #doc-atleta-lightbox-img non trovato dopo la creazione — DOM manipolato altrove?');
    return;
  }
  imgEl.src = 'data:image/jpeg;base64,' + base64;
  ov.style.display = 'flex';
}

// ── Stampa: apre il documento in una nuova finestra e richiama la stampa
// nativa del browser. Per le immagini la stampa parte automaticamente al
// caricamento, con comunque un bottone visibile come rete di sicurezza
// (alcuni browser mobile sopprimono il print() automatico) — mai un
// fallimento silenzioso se la finestra non si apre (popup bloccato). ──
function docAtletaStampa(atletaId, docId) {
  docAtletaLeggiDocumento(atletaId, docId).then(function (doc) {
    var w = window.open('', '_blank');
    if (!w) {
      var msg = 'docAtletaStampa: popup bloccato dal browser (atletaId=' + atletaId + ', docId=' + docId + ')';
      docAtletaErr(msg);
      alert('Il browser ha bloccato l\'apertura della finestra di stampa. Controlla le impostazioni popup e riprova.');
      return;
    }
    var corpo;
    if (doc.mimeType === 'application/pdf') {
      corpo = '<button onclick="window.print()" style="position:fixed;top:10px;right:10px;z-index:9;padding:10px 16px;">Stampa</button>' +
        '<embed src="data:application/pdf;base64,' + doc.base64 + '" type="application/pdf" width="100%" height="100%" style="border:0;">';
    } else {
      corpo = '<button onclick="window.print()" style="position:fixed;top:10px;right:10px;z-index:9;padding:10px 16px;">Stampa</button>' +
        '<img src="data:image/jpeg;base64,' + doc.base64 + '" style="max-width:100%;display:block;margin:0 auto;" onload="window.print()">';
    }
    w.document.write('<html><head><title>Stampa documento</title><style>body{margin:0}</style></head><body>' + corpo + '</body></html>');
    w.document.close();
    docAtletaLog('Aperta finestra di stampa: atletaId=' + atletaId + ', docId=' + docId, 'info');
  }).catch(function (err) {
    var msg = 'docAtletaStampa: errore lettura documento (atletaId=' + atletaId + ', docId=' + docId + '): ' + (err && err.message || err);
    docAtletaErr(msg);
    alert('Errore apertura documento per la stampa: ' + (err && err.message || err));
  });
}

// ── Condivisione via Web Share API (menu nativo Android: WhatsApp, Gmail,
// Telegram, ecc. — qualunque app installata sul telefono che supporti la
// condivisione di file). Nessuna integrazione diretta con WhatsApp: e'
// l'utente a scegliere la destinazione nel menu di sistema, come quando
// condivide una foto da qualsiasi altra app. ──
function docAtletaCondividi(atletaId, docId, tipoDocLabel) {
  docAtletaLeggiDocumento(atletaId, docId).then(function (doc) {
    if (!navigator.share || !navigator.canShare) {
      var msgNo = 'docAtletaCondividi: Web Share API non disponibile su questo browser';
      docAtletaErr(msgNo);
      alert('La condivisione diretta non è supportata su questo browser/dispositivo. Apri il documento con "Stampa" e salvalo da lì, poi condividilo manualmente.');
      return;
    }
    var byteChars = atob(doc.base64);
    var byteNumbers = new Array(byteChars.length);
    for (var i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    var byteArray = new Uint8Array(byteNumbers);
    var ext = doc.mimeType === 'application/pdf' ? 'pdf' : 'jpg';
    var file = new File([byteArray], (tipoDocLabel || 'documento').replace(/[^a-z0-9]/gi, '_') + '.' + ext, { type: doc.mimeType });
    if (!navigator.canShare({ files: [file] })) {
      var msgCant = 'docAtletaCondividi: canShare ha rifiutato il file (mimeType=' + doc.mimeType + ')';
      docAtletaErr(msgCant);
      alert('Questo browser non permette di condividere direttamente questo tipo di file.');
      return;
    }
    navigator.share({ files: [file], title: tipoDocLabel || 'Documento' }).then(function () {
      docAtletaLog('Condivisione completata: atletaId=' + atletaId + ', docId=' + docId, 'ok');
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return; // utente ha annullato — non è un errore
      var msg = 'docAtletaCondividi: errore condivisione (atletaId=' + atletaId + ', docId=' + docId + '): ' + (err && err.message || err);
      docAtletaErr(msg);
      alert('Errore durante la condivisione: ' + (err && err.message || err));
    });
  }).catch(function (err) {
    var msg = 'docAtletaCondividi: errore lettura documento (atletaId=' + atletaId + ', docId=' + docId + '): ' + (err && err.message || err);
    docAtletaErr(msg);
    alert('Errore apertura documento per la condivisione: ' + (err && err.message || err));
  });
}

window.addEventListener('error', function (e) {
  var msg = '[documenti-atleta-core] errore non gestito: ' + (e.error && e.error.message || e.message);
  console.error(msg);
  if (typeof log === 'function') log(msg, 'err');
});
window.addEventListener('unhandledrejection', function (e) {
  var msg = '[documenti-atleta-core] promise non gestita: ' + (e.reason && e.reason.message || e.reason);
  console.error(msg);
  if (typeof log === 'function') log(msg, 'err');
});
