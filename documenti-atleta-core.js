// ────────────────────────────────────────────────────────────
// FILE: documenti-atleta-core.js — ASD Basket Campodarsego
// VERSIONE: v0.2 · 04/09/2026 · BK
// v0.1: creazione — CRUD Firestore per gli allegati documentali atleta
//   (certificato medico, modulo iscrizione, altri atti), approvato da AR
//   il 04/09/2026 (260904_COM_AR_BK_ApprovazioneDocumentiAtleta.yaml,
//   rif. DEC-BK-DOC-ATLETA-FOTO-SCANSIONI). Path v0.1 basato su un
//   ref-getter configurabile, per non assumere la struttura di "atleti".
// v0.2: corretto il path (vedi sotto) dopo aver verificato che DB.atleti
//   e' un blob JSON unico, non un documento per atleta — il ref-getter
//   configurabile non serve piu', il path e' ora fisso e autosufficiente.
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
