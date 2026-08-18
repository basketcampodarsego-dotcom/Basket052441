// ════════════════════════════════════════════════════════
// basket-core.js — ASD Basket Campodarsego
// Libreria condivisa tra basket052441.html e basket052441-admin.html
// Contiene SOLO le funzioni verificate identiche in entrambi i moduli
// (confronto automatico byte-per-byte, 17/08/2026).
// Variabili come DB, DB_KEY, BUILD_VERSION restano locali a ciascun modulo.
// Versione: v1.1 — Build 18/08/2026 (aggiunto controllo residenza atleta)
// ════════════════════════════════════════════════════════

function _loadImmagini(){
  var toB64=function(url,cb){
    var xhr=new XMLHttpRequest();
    xhr.open('GET',url,true);
    xhr.responseType='blob';
    xhr.onload=function(){
      if(xhr.status===200){
        var r=new FileReader();
        r.onloadend=function(){cb(r.result.split(',')[1]);};
        r.readAsDataURL(xhr.response);
      }
    };
    xhr.onerror=function(){console.warn('Immagine non trovata:',url);cb('');};
    xhr.send();
  };
  toB64('logo.jpg',function(b64){
    _LOGO_B64=b64;_LOGO_B64_APP=b64;
    _LOGO_READY=b64?('data:image/jpeg;base64,'+b64):null;
    diag('Logo caricato: '+(b64?'ok':'non trovato'));
  });
  toB64('firma.png',function(b64){
    _FIRMA_B64=b64;_FIRMA_B64_APP=b64;
    _FIRMA_READY=b64?('data:image/png;base64,'+b64):null;
    diag('Firma caricata: '+(b64?'ok':'non trovata'));
  });
}

function _dbReady(fn){
  if(!DB||!DB.atleti||!DB.atleti.length){
    if(typeof fn==='function'){
      // Retry automatico dopo 1.5 secondi
      toast('Attendere caricamento DB...','warn');
      setTimeout(function(){if(DB&&DB.atleti&&DB.atleti.length){_DB_READY=true;fn();}
        else toast('DB non disponibile — riprova','err');},1500);
    }
    return false;
  }
  _DB_READY=true;
  return true;
}

function _diagRender(){
  if(!_diagPanel) return;
  var log = _diagPanel.querySelector('#_diag_log');
  if(!log) return;
  log.innerHTML = _diagLines.slice().reverse().map(function(l){
    return '<div style="padding:2px 0;border-bottom:1px solid #1a2a3a;color:'+l.color+';font-size:11px">'+
      '<span style="color:#4a6a8a;margin-right:6px">'+l.ts+'</span>'+
      l.msg.replace(/</g,'&lt;')+'</div>';
  }).join('');
}

function _diagCreate(){
  if(_diagPanel) return;
  var el = document.createElement('div');
  el.id = '_diag_panel';
  el.style.cssText = [
    'position:fixed','bottom:0','left:0','right:0',
    'max-height:50vh','background:#060e18',
    'border-top:2px solid #c8a84b','z-index:99999',
    'display:flex','flex-direction:column',
    'font-family:monospace','transition:transform .3s',
  ].join(';');
  el.innerHTML =
    '<div style="display:flex;align-items:center;padding:6px 10px;background:#0d1a2a;border-bottom:1px solid #1a2a3a;min-height:44px">' +
      '<span style="color:#c8a84b;font-weight:bold;font-size:13px;flex:1">🔧 Diagnostica</span>' +
      '<span id="_diag_fb" style="font-size:10px;margin-right:12px;color:#4a6a8a">Firebase: —</span>' +
      '<span id="_diag_db" style="font-size:10px;margin-right:12px;color:#4a6a8a">DB: —</span>' +
      '<button onclick="_diagClear()" style="background:#1a2a3a;border:none;color:#8a9aaa;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:11px;min-width:44px;min-height:44px;margin-right:6px">🗑</button>' +
      '<button onclick="_diagCopy()" style="background:#1a2a3a;border:none;color:#8a9aaa;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:11px;min-width:44px;min-height:44px;margin-right:6px">📋</button>' +
      '<button onclick="_diagHide()" style="background:#8a2a2a;border:none;color:#ffaaaa;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:13px;min-width:44px;min-height:44px">✕</button>' +
    '</div>' +
    '<div id="_diag_log" style="overflow-y:auto;flex:1;padding:6px 10px"></div>';
  document.body.appendChild(el);
  _diagPanel = el;
}

function _diagShow(){
  _diagCreate();
  _diagVisible = true;
  _diagPanel.style.display = 'flex';
  _diagUpdateStatus();
  _diagRender();
}

function _diagHide(){
  _diagVisible = false;
  if(_diagPanel) _diagPanel.style.display = 'none';
}

function _diagToggle(){
  if(_diagVisible) _diagHide(); else _diagShow();
}

function _diagClear(){
  _diagLines = [];
  _diagRender();
}

function _diagCopy(){
  var txt = _diagLines.map(function(l){return l.ts+' '+l.msg;}).join('\n');
  navigator.clipboard ? navigator.clipboard.writeText(txt) : (function(){
    var ta=document.createElement('textarea');
    ta.value=txt; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
  })();
  _diagLog('Log copiato negli appunti (' + _diagLines.length + ' righe)', '#22a85a');
}

function _diagUpdateStatus(){
  if(!_diagPanel) return;
  var fb = _diagPanel.querySelector('#_diag_fb');
  var db = _diagPanel.querySelector('#_diag_db');
  if(fb) fb.innerHTML = 'Firebase: <span style="color:'+(_fbReady?'#22a85a':'#e03545')+'">'+(_fbReady?'OK':'OFF')+'</span>';
  if(db){
    var nAtl = DB&&DB.atleti?DB.atleti.length:0;
    db.innerHTML = 'DB: <span style="color:'+( nAtl>0?'#22a85a':'#e03545')+'">'+( nAtl>0?nAtl+' atleti':'vuoto')+'</span>';
  }
}

function g(id) { return document.getElementById(id); }

function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

function fmtData(d) { if(!d) return ""; if(d.indexOf("-")>-1){var p=d.split("-");return p[2]+"/"+p[1]+"/"+p[0];} return d; }

function certScaduto(d) { if(!d) return false; try{var p=d.split("/");return new Date(+p[2],+p[1]-1,+p[0])<new Date();}catch(e){return false;} }

function nextId(arr) { return arr.length?Math.max.apply(null,arr.map(function(x){return x.id||0;}))+1:1; }

function nowStr() { var n=new Date();return n.toLocaleDateString("it-IT")+" "+n.toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"}); }

function _parseIndirizzo(ind) {
  if(!ind) return {via:"", comune:""};
  var comma = ind.lastIndexOf(",");
  if(comma > 0) {
    return {via: ind.substring(0,comma).trim(), comune: ind.substring(comma+1).trim()};
  }
  return {via: ind, comune: ""};
}

function cfDecodeData(cf){
  // Decodifica data nascita dal CF → "aaaa-mm-gg" o ""
  if(!cf||cf.length<16)return "";
  var mesi={A:"01",B:"02",C:"03",D:"04",E:"05",H:"06",L:"07",M:"08",P:"09",R:"10",S:"11",T:"12"};
  var anno=cf.substring(6,8);
  var meseL=cf.substring(8,9).toUpperCase();
  var giorno=parseInt(cf.substring(9,11));
  if(giorno>40)giorno-=40; // femmine
  var mese=mesi[meseL]; if(!mese)return "";
  var aaaa=(parseInt(anno)>=0?parseInt(anno):0);
  // Stima secolo: >30 = 1900, <=30 = 2000
  aaaa=aaaa>30?1900+aaaa:2000+aaaa;
  var gg=String(giorno).padStart(2,"0");
  return aaaa+"-"+mese+"-"+gg;
}

function cfDecodeNascita(cf){
  if(!cf||cf.length<16)return{comune:'',prov:''};
  var cod=cf.substring(11,15).toUpperCase();
  var r=_CF_COMUNI[cod];
  if(!r)return{comune:'',prov:''};
  return{comune:r[0],prov:r[1]};
}

function arricchisciDaCF(a){
  if(!a.cf)return;
  if(a.natoA&&a.natoProv)return; // già presenti
  var decoded=cfDecodeNascita(a.cf);
  if(decoded.comune){
    if(!a.natoA)a.natoA=decoded.comune;
    if(!a.natoProv)a.natoProv=decoded.prov;
  }
}

function _parseIndVia(indLegacy,via,nr,cap,comune,prov){
  // Se ha gia' i campi separati usali, altrimenti parsa il legacy
  // Fix: se comune contiene CAP iniziale (es. "30035 Mirano"), separa
  if(comune&&/^\d{5}\s+/.test(comune)){
    var mCap=comune.match(/^(\d{5})\s+(.+)$/);
    if(mCap){if(!cap)cap=mCap[1];comune=mCap[2];}
  }
  if(via||comune||nr||cap){return{via:via||"",nr:nr||"",cap:cap||"",comune:comune||"",prov:prov||""};}
  if(!indLegacy)return{via:"",nr:"",cap:"",comune:"",prov:""};
  indLegacy=indLegacy.trim();
  // Normalizza separatore " - NNNNN Comune" → ", NNNNN Comune"
  indLegacy=indLegacy.replace(/\s+-\s+(\d{5}\s)/,' , $1');
  // Legacy: "VIA ROMA 10, 30035 CAMPODARSEGO (PD)" o "VIA ROMA 10, CAMPODARSEGO (PD)"
  var comma=indLegacy.lastIndexOf(",");
  if(comma>0){
    var viaPart=indLegacy.substring(0,comma).trim();
    var comunePart=indLegacy.substring(comma+1).trim();
    var mProv=comunePart.match(/\(([A-Z]{2})\)$/);
    var provStr=mProv?mProv[1]:"";
    var comuneStr=mProv?comunePart.replace(/\s*\([A-Z]{2}\)$/,"").trim():comunePart;
    // Estrai CAP se presente all'inizio del comune
    var capStr="";
    var mCapComune=comuneStr.match(/^(\d{5})\s+(.+)$/);
    if(mCapComune){capStr=mCapComune[1];comuneStr=mCapComune[2];}
    var vParts=viaPart.split(/\s+/);
    var nrStr="";
    if(vParts.length>1&&/^\d+[A-Za-z]*(?:\/[A-Za-z0-9]+)?$/.test(vParts[vParts.length-1])){
      nrStr=vParts.pop();
    }
    return{via:vParts.join(" "),nr:nrStr,cap:capStr,comune:comuneStr,prov:provStr};
  }
  // Senza virgola: se sembra solo un comune (no numeri civici) mettilo in comune
  var mProvSolo=indLegacy.match(/^(.+?)\s*\(([A-Z]{2})\)$/);
  if(mProvSolo){
    var comuneSolo=mProvSolo[1].trim();
    var capSolo="";
    var mCapSolo=comuneSolo.match(/^(\d{5})\s+(.+)$/);
    if(mCapSolo){capSolo=mCapSolo[1];comuneSolo=mCapSolo[2];}
    return{via:"",nr:"",cap:capSolo,comune:comuneSolo,prov:mProvSolo[2]};
  }
  // Altrimenti metti in via
  return{via:indLegacy,nr:"",cap:"",comune:"",prov:""};
}

function _parseTut(a){
  if(!a)return{cog:"",nom:"",cf:"",email:"",cell1:"",cell2:"",dn:"",natoA:"",natoProv:"",via:"",nr:"",cap:"",comune:"",prov:""};
  // Se ha QUALSIASI campo nuovo, usa schema nuovo (anche se vuoto)
  var hasNewSchema=(a.tutCog!==undefined||a.tutVia!==undefined||a.tutCf!==undefined||a.iscrizioni!==undefined);
  if(hasNewSchema){
    // Prova a riempire dai campi legacy se i nuovi sono vuoti
    var genParts=(a.gen||"").trim().split(/\s+/);
    var indTutP=_parseIndVia(a.indTut||"","","","","","");
    return{
      cog:a.tutCog||(genParts[0]||""),
      nom:a.tutNom||(genParts.slice(1).join(" ")||""),
      cf:a.tutCf||a.cfTut||"",
      email:a.tutEmail||a.email||"",
      cell1:a.tutCell1||a.tel||"",
      cell2:a.tutCell2||"",
      dn:a.tutDn||"",
      natoA:a.tutNatoA||"",
      natoProv:a.tutNatoProv||"",
      via:a.tutVia||indTutP.via||"",
      nr:a.tutNr||indTutP.nr||"",
      cap:a.tutCap||indTutP.cap||"",
      comune:a.tutComune||indTutP.comune||"",
      prov:a.tutProv||indTutP.prov||""
    };
  }
  // Schema completamente legacy
  var genPartsL=(a.gen||"").trim().split(/\s+/);
  var indTutParsed=_parseIndVia(a.indTut||"","","","","","");
  return{
    cog:genPartsL[0]||"",nom:genPartsL.slice(1).join(" "),
    cf:a.cfTut||"",email:a.email||"",cell1:a.tel||"",cell2:"",
    dn:"",natoA:"",natoProv:"",
    via:indTutParsed.via,nr:indTutParsed.nr,cap:indTutParsed.cap,
    comune:indTutParsed.comune,prov:indTutParsed.prov
  };
}

function openModal(id) { var el=g(id);if(el)el.classList.add("show"); }

function closeModal(id) { var el=g(id);if(el)el.classList.remove("show"); }

function toast(msg, tipo) {
  // tipo: 'ok' | 'err' | 'warn' | '' (info)
  tipo = tipo || '';
  diag(msg, tipo);
  var el = document.getElementById('toast-msg');
  if(!el) return;
  el.textContent = msg;
  el.className = 'toast-show ' + tipo;
  clearTimeout(el._t);
  el._t = setTimeout(function(){ el.className = ''; }, 4000);
}

function syncStatus(on) { var el=g("sync-dot");if(el)el.style.display=on?"inline-block":"none"; }

function goPage(id) {
  diag("naviga: "+id);
  document.querySelectorAll(".page").forEach(function(p){p.classList.remove("active");});
  document.querySelectorAll(".di").forEach(function(d){d.classList.remove("active");});
  var pg=g("page-"+id);if(pg)pg.classList.add("active");
  var di=document.querySelector('[data-page="'+id+'"]');if(di)di.classList.add("active");
  var tb=g("tb-title");
  var labels={dashboard:"Dashboard",anagrafica:"Anagrafica Atleti",pagamenti:"Pagamenti & Ricevute",
               "importa-banca":"Import Banca",presenze:"Presenze Allenamenti",
               listar:"Lista R / Convocazioni",impostazioni:"Impostazioni & Dati"};
  if(tb)tb.textContent=labels[id]||id;
  closeDrawer();
  if(id==="dashboard") renderDashboard();
  else if(id==="anagrafica") renderAnagrafica();
  else if(id==="pagamenti") renderPagamenti();
  else if(id==="presenze") renderPresenze();
  else if(id==="listar") lrInit();
  else if(id==="impostazioni") renderImpostazioni();
}

function toggleDrawer() { g("drawer").classList.toggle("open");g("drawer-ov").classList.toggle("show"); }

function fbInitAdmin(onReady, onError) {
  _diagLog("fbInitAdmin() avviato");
  try {
    _diagLog("Firebase SDK: "+(typeof firebase !== "undefined" ? "OK" : "NON TROVATO"), "#c8a84b");
    if(typeof firebase === "undefined") {
      var msg = "Firebase SDK non caricato. Verifica connessione internet.";
      _diagLog(msg, "#e03545");
      if(onError) onError(msg); return;
    }
    if(!firebase.apps.length) {
      var cfg = {
        apiKey:"AIzaSyAFnQMyoIYei-9naUbY_GSLNvYNXFJBkZY",
        authDomain:"basket052441.firebaseapp.com",
        projectId:"basket052441",
        storageBucket:"basket052441.appspot.com",
        messagingSenderId:"708269881035",
        appId:"1:708269881035:web:62a9d32bad5de2c68d0d4e"
      };
      _fbApp = firebase.initializeApp(cfg);
      _diagLog("App Firebase inizializzata", "#22a85a");
    } else {
      _fbApp = firebase.app();
      _diagLog("App Firebase già attiva", "#22a85a");
    }
    _db = firebase.firestore();
    _fbReady = true;
    _diagLog("Firestore pronto", "#22a85a");
    if(onReady) onReady();
  } catch(e) {
    _diagLog("ERRORE fbInitAdmin: "+e.message, "#e03545");
    _fbReady = false;
    if(onError) onError(e.message);
  }
}

function fipImport(input){
  var files=Array.from(input.files); if(!files.length)return;
  input.value='';
  diag('fipImport: '+files.length+' file(s) selezionati');
  // Import multiplo: elabora ogni PDF in sequenza, accumula risultati
  _statinoRisultati=[];
  _statinoAnnoStr='';
  _statinoDataIscr='';
  var _allResults=[]; // [{annoStr, dataIscr, atleti:[...]}]
  var idx=0;
  function _processNext(){
    if(idx>=files.length){
      // Tutti elaborati: mostra riepilogo e importa direttamente
      if(_allResults.length===0){diag('Nessun atleta trovato','warn');return;}
      var totNuovi=0,totAgg=0;
      _allResults.forEach(function(gruppo){
        var r=_importaGruppoStatino(gruppo.atleti, gruppo.annoStr, gruppo.dataIscr);
        totNuovi+=r.aggiunti; totAgg+=r.aggiornati;
        diag('Statino '+gruppo.annoStr+': +'+r.aggiunti+' nuovi, '+r.aggiornati+' aggiornati','ok');
      });
      buildSearchIndex();
      saveDB();
      toast('FIP import: +'+totNuovi+' nuovi, '+totAgg+' aggiornati ('+_allResults.length+' stagioni)','ok');
      if(totNuovi>0)setTimeout(function(){toast(totNuovi+' nuovi FIP: completa anagrafica','warn');},3000);
      closeModal('modal-fip');
      renderAnagrafica();
      renderDashboard();
      return;
    }
    var file=files[idx]; idx++;
    diag('fipImport ['+idx+'/'+files.length+']: '+file.name);
    loadPdfJs(function(){
      var reader=new FileReader();
      reader.onload=function(e){
        var typedArray=new Uint8Array(e.target.result);
        pdfjsLib.getDocument(typedArray).promise.then(function(pdf){
          var pageTexts=[];
          var done=0;
          for(var pNum=1;pNum<=pdf.numPages;pNum++){
            (function(pn){
              pdf.getPage(pn).then(function(page){
                page.getTextContent().then(function(tc){
                  var lines={};
                  tc.items.forEach(function(item){
                    var y=Math.round(item.transform[5]);
                    if(!lines[y])lines[y]=[];
                    lines[y].push({txt:item.str,x:item.transform[4]});
                  });
                  var ySorted=Object.keys(lines).map(Number).sort(function(a,b){return b-a;});
                  var pageText=ySorted.map(function(y){
                    return lines[y].sort(function(a,b){return a.x-b.x;}).map(function(i){return i.txt;}).join(' ');
                  }).join('\n');
                  pageTexts[pn-1]=pageText;
                  done++;
                  if(done===pdf.numPages){
                    var txt=pageTexts.join('\n');
                    var parsed=_parsaStatinoFIPTxt(txt);
                    if(parsed.risultati.length>0){
                      _allResults.push({annoStr:parsed.annoStr,dataIscr:parsed.dataIscr,atleti:parsed.risultati});
                    }
                    _processNext();
                  }
                });
              });
            })(pNum);
          }
        }).catch(function(err){diag('Errore PDF FIP ['+file.name+']: '+err.message,'err');_processNext();});
      };
      reader.readAsArrayBuffer(file);
    });
  }
  _processNext();
}

function _parsaStatinoFIPTxt(txt){
  var CF_RE=/^([A-Z]{6}[0-9]{2}[A-EHLMPRST][0-9]{2}[A-Z][0-9]{3}[A-Z])/;
  var NOME_DATA_RE=/^([A-Z][A-Z\s\'\'\'`\-]+?)\s+(I|E)\s+(\d{2}\/\d{2}\/\d{4})$/;
  var lines=txt.split('\n').map(function(l){return l.trim();}).filter(Boolean);
  diag('_parsaStatinoFIPTxt: '+lines.length+' righe');
  var stagioneCorrente=_stagioneCorrente();
  var annoStrFIP='';
  var dataIscrFIP='';
  var mStagione=txt.match(/[Ss]tagione\s+sportiva[:\s]+(\d{2})\/(\d{2})/);
  if(mStagione){
    var yy1=parseInt(mStagione[1],10);
    var yy2=parseInt(mStagione[2],10);
    var yyyy1=(yy1>=90?1900:2000)+yy1;
    var yyyy2=(yy2>=90?1900:2000)+yy2;
    annoStrFIP=yyyy1+'-'+(yyyy2.toString().slice(-2));
    dataIscrFIP=(annoStrFIP===stagioneCorrente)?new Date().toISOString().split('T')[0]:(yyyy1+'-09-01');
    diag('Stagione statino: '+annoStrFIP+' \u2192 dataIscr: '+dataIscrFIP,'ok');
  } else {
    annoStrFIP=stagioneCorrente;
    dataIscrFIP=new Date().toISOString().split('T')[0];
    diag('Stagione non trovata nel PDF, uso stagione corrente: '+annoStrFIP,'warn');
  }
  var risultati=[];
  var i=0;
  while(i<lines.length){
    var m=NOME_DATA_RE.exec(lines[i]);
    if(m){
      var nomeFull=m[1].trim();
      var dnRaw=m[3];
      var dp=dnRaw.split('/');
      var dn=dp[2]+'-'+dp[1]+'-'+dp[0];
      var sesso='M', cf='', fascia='';
      for(var j=i+1;j<Math.min(i+6,lines.length);j++){
        var l=lines[j];
        if(l==='M'||l==='F'){sesso=l;continue;}
        var mCf=CF_RE.exec(l);
        if(mCf){cf=mCf[1];continue;}
        if(l.indexOf('Minibasket')===0){fascia='Minibasket';continue;}
        if(l.indexOf('Under')===0){fascia='Under';continue;}
        if(NOME_DATA_RE.test(l))break;
      }
      if(cf){
        var cf3=cf.substring(0,3);
        var parti=nomeFull.split(/\s+/);
        var cog=parti[0],nom=parti.slice(1).join(' ');
        for(var k=1;k<parti.length;k++){
          var cTest=parti.slice(0,k).join(' ');
          var cons=[],vow=[];
          cTest.toUpperCase().replace(/\s/g,'').split('').forEach(function(c){
            if('BCDFGHJKLMNPQRSTVWXYZ'.indexOf(c)>=0)cons.push(c);
            else if('AEIOU'.indexOf(c)>=0)vow.push(c);
          });
          var r3=cons.concat(vow).slice(0,3).join('');
          if(r3===cf3){cog=cTest;nom=parti.slice(k).join(' ');break;}
        }
        var atEsistente=DB.atleti.find(function(a){return a.cf&&a.cf.toUpperCase()===cf;});
        risultati.push({cf:cf,cog:cog,nom:nom,dn:dn,sesso:sesso,fascia:fascia,atleta:atEsistente||null});
      }
    }
    i++;
  }
  diag('_parsaStatinoFIPTxt: trovati '+risultati.length+' atleti ('+annoStrFIP+')','ok');
  return {annoStr:annoStrFIP, dataIscr:dataIscrFIP, risultati:risultati};
}

function _importaGruppoStatino(risultati, annoStr, oggi){
  var aggiunti=0, aggiornati=0;
  var annoInizio=parseInt(annoStr.substring(0,4));
  risultati.forEach(function(r){
    // Calcola categoria da anno nascita se disponibile
    var annoNasc=r.dn?parseInt(r.dn.substring(0,4)):null;
    var catCalc={cat1:'',cat2:''};
    if(r.fascia==='Under'){
      catCalc={cat1:'Esordienti',cat2:''};
    } else if(annoNasc){
      catCalc=_categoriaFIPDaAnnoNascita(annoNasc, annoInizio);
      if(!catCalc.cat1)catCalc.cat1='Aquilotti';
    } else {
      catCalc={cat1:'Aquilotti',cat2:''};
    }
    // Ri-cerca per CF per evitare duplicati
    var _cfN=(r.cf||"").toUpperCase().trim();
    var _aByCf=_cfN?DB.atleti.find(function(x){return(x.cf||"").toUpperCase().trim()===_cfN;}):null;
    if(_aByCf&&!r.atleta)r.atleta=_aByCf;
    if(r.atleta){
      var a=DB.atleti.find(function(x){return x.id===r.atleta.id;})||_aByCf;
      if(!a)return;
      if(!a.iscrizioni)a.iscrizioni=[];
      var isc=a.iscrizioni.find(function(i){return i.anno===annoStr;});
      // Log diagnostico categoria
      var _d=annoNasc?(annoInizio-annoNasc):'?';
      diag('FIP '+annoStr+': '+r.cog+' '+r.nom+' nato:'+(annoNasc||'?')+' d='+_d+' -> '+catCalc.cat1+(catCalc.cat2?'+'+catCalc.cat2:''),'ok');
      if(isc){
        isc.fed=isc.fed==='CSI'?'FIP+CSI':'FIP';
        if(!isc.cat1)isc.cat1=catCalc.cat1;
        if(!isc.cat2&&catCalc.cat2)isc.cat2=catCalc.cat2;
        if(!isc.dataIscr)isc.dataIscr=oggi;
      }else{
        a.iscrizioni.push({anno:annoStr,fed:'FIP',cat1:catCalc.cat1,cat2:catCalc.cat2,dataIscr:oggi,note:'Da statino FIP'});
      }
      // NON aggiornare a.cat — ogni stagione e' indipendente
      // Aggiorna a.cat con categoria stagione più recente
      var _isc5=(a.iscrizioni||[]).slice().sort(function(x,y){return(x.anno||'').localeCompare(y.anno||'');});
      if(_isc5.length)a.cat=_isc5[_isc5.length-1].cat1||a.cat;
      _arricchisciAtleta(a);
      aggiornati++;
    }else if(r.cf&&r.cog){
      var newA={
        id:nextId(DB.atleti),
        cog:r.cog, nom:r.nom||'', sex:r.sesso||'M', dn:r.dn||'',
        natoA:'', natoProv:'', cf:r.cf, naz:r.naz||'Italia',
        cit:'Italiana', docTipo:'', docNum:'',
        indVia:'', indNr:'', indCap:'', indComune:'', indProv:'',
        tutCog:'', tutNom:'', tutCf:'', tutEmail:'',
        tutCell1:'', tutCell2:'', tutDn:'', tutNatoA:'', tutNatoProv:'',
        tutVia:'', tutNr:'', tutCap:'', tutComune:'', tutProv:'',
        iscrizioni:[{anno:annoStr,fed:'FIP',cat1:catCalc.cat1,cat2:catCalc.cat2,dataIscr:oggi,note:'Da statino FIP'}],
        cat:catCalc.cat1, mag:'', cs:'', note:'', scheda:{}, ritirato:false, convocabile:true,
        gen:'', tel:'', cfTut:'', indTut:'', email:'', ind:'',
      };
      _arricchisciAtleta(newA);
      DB.atleti.push(newA);
      aggiunti++;
    }
  });
  return {aggiunti:aggiunti, aggiornati:aggiornati};
}

function mostraRisultatiStatino(risultati){
  var trovati=risultati.filter(function(r){return r.atleta;});
  var nonTrovati=risultati.filter(function(r){return !r.atleta;});
  var h='';
  h+='<div class="card"><div class="card-title">&#128196; Statino FIP - '+risultati.length+' atleti</div>';
  h+='<div style="display:flex;gap:16px;margin-bottom:12px;font-size:13px">';
  h+='<span style="color:var(--green)">&#10003; '+trovati.length+' gia\' in anagrafica</span>';
  h+='<span style="color:var(--gold)">&#43; '+nonTrovati.length+' nuovi</span></div>';
  // Tabella risultati
  h+='<table class="tbl" style="margin-bottom:10px"><thead><tr>';
  h+='<th>CF</th><th>Cognome Nome</th><th>Data nasc.</th><th>Fascia</th><th>Stato</th></tr></thead><tbody>';
  risultati.forEach(function(r){
    var st=r.atleta?
      '<span style="color:var(--green);font-size:11px">&#10003; In anagrafica</span>':
      '<span style="color:var(--gold);font-size:11px">&#43; Nuovo</span>';
    h+='<tr>';
    h+='<td style="font-family:monospace;font-size:11px">'+esc(r.cf)+'</td>';
    h+='<td style="font-weight:bold">'+esc(r.cog||'')+'<br><small style="color:var(--muted)">'+esc(r.nom||'')+'</small></td>';
    h+='<td style="color:var(--muted);font-size:11px">'+fmtData(r.dn||'')+'</td>';
    h+='<td><span class="badge '+(r.fascia==='Under'?'Esordienti':'Aquilotti')+'">'+esc(r.fascia||'')+'</span></td>';
    h+='<td>'+st+'</td>';
    h+='</tr>';
  });
  h+='</tbody></table>';
  h+='<div class="btn-bar">';
  h+='<button class="btn btn-gold" onclick="confermaImportaStatino()">&#10003; Registra iscrizione FIP e aggiungi nuovi</button>';
  h+='</div></div>';
  // Popola e apri sempre la modal FIP
  if(g('modal-fip-title'))g('modal-fip-title').textContent='Statino FIP - '+risultati.length+' atleti';
  if(g('fip-risultati'))g('fip-risultati').innerHTML=h;
  openModal('modal-fip');
}

function confermaImportaStatino(){
  // Usa stagione e dataIscr estratte dal PDF (o stagione corrente se non trovata)
  var annoStr=_statinoAnnoStr||_stagioneCorrente();
  var oggi=_statinoDataIscr||new Date().toISOString().split('T')[0];
  var stagioneCorrente=_stagioneCorrente();
  diag('confermaImportaStatino: stagione='+annoStr+', dataIscr='+oggi);
  var aggiunti=0, aggiornati=0;
  _statinoRisultati.forEach(function(r){
    if(r.atleta){
      // Atleta esistente: aggiorna/aggiunge iscrizione per la stagione dello statino
      var a=DB.atleti.find(function(x){return x.id===r.atleta.id;});
      if(!a)return;
      if(!a.iscrizioni)a.iscrizioni=[];
      var isc=a.iscrizioni.find(function(i){return i.anno===annoStr;});
      if(isc){
        // Aggiorna federazione ma NON sovrascrive dataIscr se già presente
        isc.fed=isc.fed==='CSI'?'FIP+CSI':'FIP';
        isc.cat1=r.fascia==='Under'?'Esordienti':isc.cat1||'Aquilotti';
        if(!isc.dataIscr)isc.dataIscr=oggi;
      }else{
        a.iscrizioni.push({anno:annoStr,fed:'FIP',cat1:r.fascia==='Under'?'Esordienti':'Aquilotti',cat2:'',dataIscr:oggi,note:'Da statino FIP'});
      }
      _arricchisciAtleta(a);
      aggiornati++;
    }else if(r.cf&&r.cog){
      // Atleta nuovo: crea record base
      var catFip=r.fascia==='Under'?'Esordienti':'Aquilotti';
      var newA={
        id:nextId(DB.atleti),
        cog:r.cog, nom:r.nom||'', sex:r.sesso||'M', dn:r.dn||'',
        natoA:'', natoProv:'', cf:r.cf, naz:r.naz||'Italia',
        cit:'Italiana', docTipo:'', docNum:'',
        indVia:'', indNr:'', indCap:'', indComune:'', indProv:'',
        tutCog:'', tutNom:'', tutCf:'', tutEmail:'',
        tutCell1:'', tutCell2:'', tutDn:'', tutNatoA:'', tutNatoProv:'',
        tutVia:'', tutNr:'', tutCap:'', tutComune:'', tutProv:'',
        iscrizioni:[{anno:annoStr,fed:'FIP',cat1:catFip,cat2:'',dataIscr:oggi,note:'Da statino FIP'}],
        cat:catFip, mag:'', cs:'', note:'', scheda:{}, ritirato:false, convocabile:true,
        gen:'', tel:'', cfTut:'', indTut:'', email:'', ind:'',
      };
      _arricchisciAtleta(newA);
      DB.atleti.push(newA);
      aggiunti++;
    }
  });
  buildSearchIndex();
  saveDB();
  diag('FIP import: +'+aggiunti+' nuovi, '+aggiornati+' aggiornati ('+annoStr+')','ok');
  closeModal('modal-fip');
  toast('FIP '+annoStr+': +'+aggiunti+' nuovi, '+aggiornati+' aggiornati','ok');
  if(aggiunti>0)setTimeout(function(){toast(aggiunti+' nuovi FIP: completa anagrafica','warn');},3000);
  renderAnagrafica();
  renderDashboard();
}

function _mostraPreviewCsi(){
  var da=window._csiDaImportare||[];
  var nuovi=da.filter(function(x){return !x.esistente;});
  var agg=da.filter(function(x){return !!x.esistente;});
  var h='<div style="margin-bottom:10px;display:flex;gap:16px;font-size:13px">';
  h+='<span style="color:#4aaa6a">&#10003; '+agg.length+' gi\u00e0 in anagrafica</span>';
  h+='<span style="color:var(--gold)">+ '+nuovi.length+' nuovi</span>';
  h+='<span style="color:var(--muted)">Totale: '+da.length+'</span></div>';
  h+='<table style="border-collapse:collapse;width:100%;font-size:11px">';
  h+='<thead><tr><th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--border)">CF</th>';
  h+='<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--border)">Cognome Nome</th>';
  h+='<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--border)">Attivit\u00e0</th>';
  h+='<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--border)">Stato</th></tr></thead><tbody>';
  da.forEach(function(x){
    var st=x.esistente
      ?'<span style="color:#4aaa6a;font-size:10px">&#10003; '+esc(x.esistente.cog)+' '+esc(x.esistente.nom)+'</span>'
      :'<span style="color:var(--gold);font-size:10px">&#43; NUOVO</span>';
    var catLabel=x.attivita==='PCA'?'AmaBasket':x.attivita==='PVO'?'AmaVolley':(x.attivita&&x.attivita!=='__QUAL__')?x.attivita:(x.qualifiche?x.attivita:'—');
    h+='<tr><td style="padding:3px 6px;font-family:monospace;font-size:10px">'+esc(x.cf)+'</td>';
    h+='<td style="padding:3px 6px"><strong>'+esc(x.cog)+'</strong> '+esc(x.nom)+'</td>';
    h+='<td style="padding:3px 6px"><span class="badge '+catLabel+'">'+catLabel+'</span></td>';
    h+='<td style="padding:3px 6px">'+st+'</td></tr>';
  });
  h+='</tbody></table>';
  if(g('csi-risultati'))g('csi-risultati').innerHTML=h;
  if(g('modal-csi-title'))g('modal-csi-title').textContent='CSI: '+da.length+' atleti trovati';
  if(g('csi-conferma-btn'))g('csi-conferma-btn').style.display=da.length?'':'none';
  // Popola select annata — range fisso 2013-14 → corrente+1, funziona anche a DB vuoto
  var selAnnata=g('csi-annata');
  if(selAnnata){ selAnnata.innerHTML=''; _buildStaginoniOptions(selAnnata); }
  // Default data iscrizione: oggi se stagione corrente, 01/09 se passata
  var dataEl=g('csi-data-iscr');
  if(dataEl){
    var _annSel=g('csi-annata')?g('csi-annata').value:'';
    var _sc=_stagioneCorrente();
    dataEl.value=(_annSel&&_annSel!==_sc)?(_annSel.substring(0,4)+'-09-01'):new Date().toISOString().split('T')[0];
  }
  openModal('modal-csi');
  diag('csiImport: preview '+da.length+' atleti ('+nuovi.length+' nuovi, '+agg.length+' aggiornati)','ok');
}

function confermaImportaCsi(){
  var da=window._csiDaImportare||[];
  if(!da.length)return;
  // Leggi annata e data iscrizione dal form — non dalla data di sistema
  var annoStr=(g('csi-annata')&&g('csi-annata').value)||'';
  var oggi=(g('csi-data-iscr')&&g('csi-data-iscr').value)||new Date().toISOString().split('T')[0];
  if(!annoStr){
    alert('Seleziona l\'annata sportiva prima di confermare l\'import.');
    return;
  }
  diag('confermaImportaCsi: annata='+annoStr+', dataIscr='+oggi,'ok');
  var aggiunti=0,aggiornati=0;
  da.forEach(function(x){
    var catCsi=x.attivita==='PCA'?'AmaBasket':x.attivita==='PVO'?'AmaVolley':x.attivita&&x.attivita!=='__QUAL__'?x.attivita:'';
    if(x.esistente){
      var a=DB.atleti.find(function(z){return z.id===x.esistente.id;});
      if(!a)return;
      var changed=false;
      // Aggiorna dati anagrafici solo se mancanti
      if(!a.tel&&x.tel){a.tel=x.tel;changed=true;}
      if(!a.tutCell1&&x.tel){a.tutCell1=x.tel;changed=true;}
      if(!a.email&&x.email){a.email=x.email;changed=true;}
      if(!a.tutEmail&&x.email){a.tutEmail=x.email;changed=true;}
      if(!a.ind&&x.indFull){a.ind=x.indFull;changed=true;}
      if(x.cs&&a.cs!==x.cs){a.cs=x.cs;changed=true;}
      // Aggiorna iscrizione per l'annata specifica — NON toccare a.cat
      if(!a.iscrizioni)a.iscrizioni=[];
      var isc=a.iscrizioni.find(function(i){return i.anno===annoStr;});
      if(isc){
        if(isc.fed.indexOf('CSI')<0){isc.fed=isc.fed?isc.fed+'+CSI':'CSI';changed=true;}
        if(!isc.cat1&&catCsi){isc.cat1=catCsi;changed=true;}
      } else {
        a.iscrizioni.push({anno:annoStr,fed:'CSI',cat1:catCsi,cat2:'',dataIscr:oggi,note:'Da CSI'});
        changed=true;
      }
      if(changed){
        var _isc6=(a.iscrizioni||[]).slice().sort(function(x,y){return(x.anno||'').localeCompare(y.anno||'');});
        if(_isc6.length)a.cat=_isc6[_isc6.length-1].cat1||a.cat;
        _arricchisciAtleta(a);aggiornati++;
      }
    } else {
      var maxId=DB.atleti.reduce(function(m,a){return Math.max(m,a.id||0);},0)+1;
      var indP=_parseIndirizzo(x.indFull);
      DB.atleti.push({
        id:maxId,cog:x.cog,nom:x.nom,sex:x.sex,dn:x.dn,cf:x.cf,
        natoA:'',natoProv:'',cit:'Italiana',naz:'Italia',
        docTipo:'',docNum:'',
        indVia:indP.via,indNr:'',indCap:'',indComune:indP.comune,indProv:'',
        tutCog:'',tutNom:'',tutCf:'',tutEmail:x.email,
        tutCell1:x.tel,tutCell2:'',tutDn:'',tutNatoA:'',tutNatoProv:'',
        tutVia:'',tutNr:'',tutCap:'',tutComune:'',tutProv:'',
        iscrizioni:[{anno:annoStr,fed:'CSI',cat1:catCsi,cat2:'',dataIscr:oggi,note:'Da CSI'}],
        // cat legacy: categoria della prima iscrizione, mai sovrascritto da import successivi
        cat:catCsi,mag:'',cs:x.cs,
        gen:'',tel:x.tel,cfTut:'',indTut:'',email:x.email,ind:x.indFull,
        note:'',scheda:{},ritirato:false,convocabile:true
      });
      _arricchisciAtleta(DB.atleti[DB.atleti.length-1]);
      aggiunti++;
    }
  });
  buildSearchIndex();saveDB();
  closeModal('modal-csi');
  window._csiDaImportare=[];
  toast('CSI '+annoStr+': +'+aggiunti+' nuovi, '+aggiornati+' aggiornati','ok');
  diag('confermaImportaCsi: annata='+annoStr+' +'+aggiunti+' nuovi, '+aggiornati+' aggiornati','ok');
  if(aggiunti>0)setTimeout(function(){toast(aggiunti+' nuovi: assegna categoria','warn');},3000);
  renderAnagrafica();renderDashboard();
}

function _stagioniRange(){
  var sc=_stagioneCorrente();
  var annoFine=parseInt(sc.substring(0,4))+1;
  var result=[];
  for(var y=2013;y<=annoFine;y++) result.push(y+'-'+(y+1).toString().slice(-2));
  return result.reverse();
}

function _buildStaginoniOptions(sel,defaultVal){
  if(!sel)return;
  sel.innerHTML='<option value="">— seleziona annata —</option>';
  var sc=_stagioneCorrente();
  var stagSet={};
  (DB.atleti||[]).forEach(function(a){(a.iscrizioni||[]).forEach(function(i){if(i.anno)stagSet[i.anno]=1;});});
  _stagioniRange().forEach(function(s){stagSet[s]=1;});
  Object.keys(stagSet).sort().reverse().forEach(function(s){
    var o=document.createElement('option');o.value=s;o.textContent=s+(s===sc?' (corrente)':'');sel.appendChild(o);
  });
  sel.value=defaultVal||sc;
}

function saveDB(){
  // Salva localStorage sempre (immediato)
  localStorage.setItem(DB_KEY,JSON.stringify(DB));
  if(!_fbReady)return;
  // Calcola quali sezioni sono cambiate rispetto all'ultimo hash
  _FB_SEZIONI.forEach(function(sez){
    var h=JSON.stringify(DB[sez]||'').length+':'+(JSON.stringify(DB[sez]||'')).slice(-20);
    if(_fbDirty[sez]!==h)_fbDirty[sez]=h;
  });
  if(_saveTimer)clearTimeout(_saveTimer);
  _saveTimer=setTimeout(function(){
    syncStatus(true);
    var col=_db.collection("basket052441");
    var batch=_db.batch();
    _FB_SEZIONI.forEach(function(sez){
      batch.set(col.doc(sez),{v:JSON.stringify(DB[sez]||[]),ts:new Date().toISOString()});
    });
    batch.commit().then(function(){
      syncStatus(false);
      console.log("[FB] Salvato (sezioni separate)"); diag("saveDB: salvato su Firebase","ok");
    }).catch(function(e){
      syncStatus(false);
      console.error("[FB] Errore salvataggio batch:",e);
    });
  },1500);
}

function doLogin() {
  var email = document.getElementById("login-email").value || "";
  var pwd   = document.getElementById("login-pwd").value || "";
  var btn   = document.getElementById("login-btn");
  var err   = document.getElementById("login-err");
  if(!email || !pwd) { if(err) err.textContent = "Inserire email e password."; return; }
  if(!_fbReady) {
    _diagLog("Firebase non pronto","#e03545");
    if(err) err.textContent = "Connessione non pronta, attendi e riprova.";
    setTimeout(function() { try{ fbInit(); }catch(ex){ console.warn('[fbInit retry] '+ex.message); if(err) err.textContent = "Riconnessione fallita: "+ex.message; } }, 1000);
    return;
  }
  _diagLog("Login: "+email);
  if(btn) btn.disabled = true;
  if(err) err.textContent = "";
  firebase.auth().signInWithEmailAndPassword(email, pwd)
    .then(function() {
      _diagLog("signIn OK","#22a85a");
      if(btn) btn.disabled = false;
    })
    .catch(function(e) {
      _diagLog("Errore: "+e.code,"#e03545");
      if(btn) btn.disabled = false;
      var msg = "Credenziali non valide.";
      if(e.code === "auth/user-not-found" || e.code === "auth/wrong-password" || e.code === "auth/invalid-credential")
        msg = "Email o password errati.";
      else if(e.code === "auth/too-many-requests") msg = "Troppi tentativi. Riprova tra qualche minuto.";
      else if(e.code === "auth/network-request-failed") msg = "Errore di rete.";
      else msg = "Errore: "+e.code;
      if(err) err.textContent = msg;
    });
}

function buildSearchIndex() {
  _searchIndex = {};
  DB.atleti.forEach(function(a) {
    _searchIndex[a.id] = (a.cog+" "+a.nom+" "+a.cf+" "+a.cat).toLowerCase();
  });
}

function _stagioneCorrente(){
  return _annoDaStagione(new Date().toISOString().split('T')[0]);
}

function _annoNascitaAtleta(a){
  // Estrae anno di nascita dal campo dn (AAAA-MM-GG o GG/MM/AAAA)
  if(a.dn){
    var dn = a.dn;
    if(dn.indexOf('-')>-1) return parseInt(dn.substring(0,4));
    if(dn.indexOf('/')>-1){ var p=dn.split('/'); return parseInt(p[2]); }
  }
  // Fallback: dal CF (posizioni 6-7 = anno 2 cifre)
  if(a.cf && a.cf.length>=8){
    var aa = parseInt(a.cf.substring(6,8));
    if(!isNaN(aa)) return aa <= 25 ? 2000+aa : 1900+aa;
  }
  return null;
}

function _pagDuplicato(pags, nuovoPag){
  // Duplicato = stessa data + stesso importo (tolleranza 0.01€)
  return pags.some(function(p){
    return p.data===nuovoPag.data && Math.abs((+p.importo||0)-(+nuovoPag.importo||0))<0.01;
  });
}

function _pagAnno(pags, anno){
  // Conta pagamenti per anno solare
  return pags.filter(function(p){return p.data&&p.data.startsWith(anno);});
}

function _esportaReportImport(){
  var r=window._lastImportReport;
  if(!r)return;
  var csv='Tipo,Messaggio\n';
  r.righe.forEach(function(riga){
    csv+='"'+riga.tipo+'","'+riga.msg.replace(/"/g,"'").replace(/<[^>]+>/g,'')+'"\n';
  });
  var blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  var url=URL.createObjectURL(blob);
  var lnk=document.createElement('a');
  lnk.href=url;
  lnk.download='report_import_'+new Date().toISOString().substring(0,10)+'.csv';
  document.body.appendChild(lnk);lnk.click();document.body.removeChild(lnk);
  setTimeout(function(){URL.revokeObjectURL(url);},3000);
}

// ── Controllo residenza atleta ──
// Serve per non confondere "dato non inserito" con "atleta genuinamente
// non residente" nei tabulati comunali che richiedono la differenziazione
// statistica residenti/non residenti.
function _comuneAtleta(a){
  var c=(a.indComune||'').trim().toUpperCase();
  if(!c&&a.tutComune)c=a.tutComune.trim().toUpperCase();
  if(!c&&a.ind){var m=a.ind.match(/,\s*([^,(]+)/);if(m)c=m[1].trim().toUpperCase();}
  return c;
}
function _residenzaMancante(a){ return !_comuneAtleta(a); }
