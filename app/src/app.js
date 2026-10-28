/* =========================================================================
   app.js — Application terrain « Rapport d'intervention »
   Écran unique, pensé pour aller vite :
     • un chrono à démarrer / mettre en pause / terminer (heures sur site)
     • un gros bouton « Ajouter un évènement » (l'assistant gère tout)
     • la signature du client après le point de fin d'intervention
     • « Soumettre le rapport » : PDF + Word envoyés au client et au SAV
   ========================================================================= */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p) => (p || 'i') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };

  function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o); }
  function setPath(o, p, v) {
    const parts = p.split('.'); let c = o;
    for (let i = 0; i < parts.length - 1; i++) { if (c[parts[i]] == null) c[parts[i]] = {}; c = c[parts[i]]; }
    c[parts[parts.length - 1]] = v;
    if (typeof R !== 'undefined' && o === R) {
      if (p === 'machine.designation' && R.machines && R.machines[0]) R.machines[0].designation = v;
      if (p === 'machine.modele' && R.machines && R.machines[0]) R.machines[0].modele = v;
      if (p === 'machine.serie' && R.machines && R.machines[0]) R.machines[0].serie = v;
      if (p === 'technicien' && R.techniciens && R.techniciens[0]) R.techniciens[0].nom = v;
    }
  }

  const Store = (function () {
    let ok = true;
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); } catch (e) { ok = false; }
    const mem = {};
    return {
      ok: ok,
      get(k, def) { try { const v = ok ? localStorage.getItem(k) : mem[k]; return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
      set(k, v) { try { const s = JSON.stringify(v); if (ok) localStorage.setItem(k, s); else mem[k] = s; return true; } catch (e) { return false; } }
    };
  })();

  let toastTimer;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }
  /* Boîtes de dialogue intégrées à la page. confirm(), alert() et prompt() du
     navigateur sont bloqués dans certains cadres (artefact Claude : confirm()
     y répond toujours « non ») ; elles sont donc remplacées partout par ces
     versions asynchrones : confirmer() -> Promise<bool>, saisir() -> Promise<texte|null>,
     informer() -> Promise. */
  const Dialogue = (function () {
    function ouvrir(message, o) {
      return new Promise(function (resolve) {
        const fond = document.createElement('div');
        fond.className = 'dlg-fond';
        fond.innerHTML = '<div class="dlg" role="dialog" aria-modal="true"><p class="dlg-msg"></p>' +
          (o.saisie ? '<input type="text" class="dlg-input" id="dlgSaisie" autocomplete="off">' : '') +
          '<div class="dlg-btns">' +
          (o.annuler ? '<button type="button" class="btn grey" data-r="non"></button>' : '') +
          '<button type="button" class="btn' + (o.danger ? ' danger' : '') + '" data-r="oui"></button></div></div>';
        fond.querySelector('.dlg-msg').textContent = message;
        fond.querySelector('[data-r="oui"]').textContent = o.ok;
        if (o.annuler) fond.querySelector('[data-r="non"]').textContent = o.annuler;
        const champ = fond.querySelector('#dlgSaisie');
        function fin(oui) {
          document.removeEventListener('keydown', clavier, true);
          fond.remove();
          resolve(o.saisie ? (oui ? champ.value : null) : oui);
        }
        function clavier(e) {
          if (e.key === 'Escape') { e.preventDefault(); fin(false); }
          else if (e.key === 'Enter' && champ) { e.preventDefault(); fin(true); }
        }
        fond.addEventListener('click', function (e) {
          const b = e.target.closest('[data-r]');
          if (b) fin(b.dataset.r === 'oui');
          else if (e.target === fond && o.annuler) fin(false);
        });
        document.addEventListener('keydown', clavier, true);
        document.body.appendChild(fond);
        setTimeout(function () { (champ || fond.querySelector('[data-r="oui"]')).focus(); }, 30);
      });
    }
    return {
      confirmer: function (message, opts) {
        opts = opts || {};
        return ouvrir(message, { ok: opts.ok || 'Confirmer', annuler: opts.annuler || 'Annuler', danger: !!opts.danger });
      },
      saisir: function (message, opts) {
        opts = opts || {};
        return ouvrir(message, { ok: opts.ok || 'Valider', annuler: 'Annuler', saisie: true });
      },
      informer: function (message) { return ouvrir(message, { ok: 'OK' }); }
    };
  })();
  if (typeof window !== 'undefined') window.Dialogue = Dialogue;

  function vibrate(ms) { if (navigator.vibrate) try { navigator.vibrate(ms || 12); } catch (e) {} }
  const pad2 = (n) => ('0' + n).slice(-2);
  const ICO = (typeof window !== 'undefined' && window.ICO) || (typeof global !== 'undefined' && global.ICO) || {};

  /* ===================== Réglages ===================================== */
  const K = { settings: 'sav3.settings', rapport: 'sav3.rapport', rapports: 'sav3.rapports' };

  /* ===================== Base de données locale (IndexedDB) ===================== */
  /* IndexedDB permet de stocker l'intégralité des rapports et de toutes leurs photos
     sans la limite de 5 Mo du localStorage (pratiquement illimité sur Android).
     En cas d'absence d'IndexedDB (ex. tests unitaires Node.js ou navigation privée),
     un repli automatique en mémoire et localStorage est assuré. */
  const RapportDB = (function () {
    const DB_NAME = 'bfr_sav_v3';
    const DB_VERSION = 1;
    const STORE_RAPPORTS = 'rapports';
    const STORE_PHOTOS = 'photos';

    const memRapports = new Map();
    const memPhotos = new Map();

    function estDispo() {
      return typeof window !== 'undefined' && !!window.indexedDB;
    }

    let dbPromise = null;
    let ouverte = false;   // base réellement ouverte (et non simplement présente)
    function ouvrirDB() {
      if (!estDispo()) return Promise.resolve(null);
      if (dbPromise) return dbPromise;
      dbPromise = new Promise(function (resolve) {
        try {
          const req = window.indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = function (e) {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_RAPPORTS)) {
              db.createObjectStore(STORE_RAPPORTS, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
              db.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
            }
          };
          req.onsuccess = function (e) {
            ouverte = true;
            resolve(e.target.result);
          };
          req.onerror = function () {
            resolve(null);
          };
        } catch (err) {
          resolve(null);
        }
      });
      return dbPromise;
    }

    async function sauverPhoto(id, dataUrl, contexte, rapportId) {
      if (!id || !dataUrl) return false;
      memPhotos.set(id, { id: id, dataUrl: dataUrl, contexte: contexte || '', rapportId: rapportId || '', maj: Date.now() });
      const db = await ouvrirDB();
      if (!db) return true;
      return new Promise(function (resolve) {
        try {
          const tx = db.transaction([STORE_PHOTOS], 'readwrite');
          tx.objectStore(STORE_PHOTOS).put({
            id: id,
            dataUrl: dataUrl,
            contexte: contexte || '',
            rapportId: rapportId || '',
            maj: Date.now()
          });
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }

    async function getPhoto(id) {
      if (!id) return null;
      if (memPhotos.has(id)) {
        const item = memPhotos.get(id);
        return typeof item === 'string' ? item : (item && item.dataUrl ? item.dataUrl : null);
      }
      const db = await ouvrirDB();
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          const tx = db.transaction([STORE_PHOTOS], 'readonly');
          const req = tx.objectStore(STORE_PHOTOS).get(id);
          req.onsuccess = function () {
            const res = req.result;
            if (res && res.dataUrl) {
              memPhotos.set(id, res);
              resolve(res.dataUrl);
            } else {
              resolve(null);
            }
          };
          req.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }

    /* Enregistre toutes les images du rapport dans la base photos et renvoie
       l'ensemble des identifiants réellement enregistrés. */
    async function sauverPhotosDeRapport(rapport) {
      if (!rapport) return new Set();
      const taches = [];
      const garder = (id, dataUrl, ctx) => taches.push(sauverPhoto(id, dataUrl, ctx, rapport.id).then(ok => ok ? id : null, () => null));
      (rapport.evenements || []).forEach(function (ev) {
        (ev.photos || []).forEach(function (ph, idx) {
          if (ph && !ph.id) ph.id = 'p_' + (rapport.id || 'r') + '_' + (ev.id || 'e') + '_' + idx;
          if (ph && ph.id && ph.dataUrl) garder(ph.id, ph.dataUrl, 'evenement');
        });
      });
      (rapport.photosLibres || []).forEach(function (ph, idx) {
        if (ph && !ph.id) ph.id = 'phl_' + (rapport.id || 'r') + '_' + idx;
        if (ph && ph.id && ph.dataUrl) garder(ph.id, ph.dataUrl, 'photosLibres');
      });
      (rapport.pieces || []).forEach(function (pc) {
        if (pc && pc.id && pc.photo) garder('pc_' + pc.id, pc.photo, 'piece');
      });
      if (rapport.signatureClient && rapport.signatureClient.dataUrl) {
        sauverPhoto('sig_client_' + rapport.id, rapport.signatureClient.dataUrl, 'signatureClient', rapport.id);
      }
      if (rapport.signatureTech && rapport.signatureTech.dataUrl) {
        sauverPhoto('sig_tech_' + rapport.id, rapport.signatureTech.dataUrl, 'signatureTech', rapport.id);
      }
      const ids = await Promise.all(taches);
      return new Set(ids.filter(Boolean));
    }

    /* Copie du rapport sans les images déjà en sécurité dans la base photos :
       l'enregistrement du rapport reste léger (liste rapide, moins de mémoire). */
    function alleger(r, enregistrees) {
      const sans = (ph) => (ph && ph.id && ph.dataUrl && enregistrees.has(ph.id)) ? Object.assign({}, ph, { dataUrl: '' }) : ph;
      const o = Object.assign({}, r);
      o.evenements = (r.evenements || []).map(ev => Object.assign({}, ev, { photos: (ev.photos || []).map(sans) }));
      o.photosLibres = (r.photosLibres || []).map(sans);
      o.pieces = (r.pieces || []).map(pc => (pc && pc.id && pc.photo && enregistrees.has('pc_' + pc.id)) ? Object.assign({}, pc, { photo: '' }) : pc);
      return o;
    }

    /* Liste « à plat » des emplacements d'images d'un rapport : [{ id, lire(), ecrire(v) }].
       Sert à ne JAMAIS remplacer une image enregistrée par une version vide. */
    function emplacementsImages(r) {
      const out = [];
      (r.evenements || []).forEach(function (ev) {
        (ev.photos || []).forEach(function (ph) {
          if (ph) out.push({ id: ph.id, lire: () => ph.dataUrl, ecrire: (v) => { ph.dataUrl = v; } });
        });
      });
      (r.photosLibres || []).forEach(function (ph) {
        if (ph) out.push({ id: ph.id, lire: () => ph.dataUrl, ecrire: (v) => { ph.dataUrl = v; } });
      });
      (r.pieces || []).forEach(function (pc) {
        // une pièce sans photo est normale : on ne la compte comme « manquante » que si
        // elle en avait une (champ présent)
        if (pc && pc.id && 'photo' in pc) out.push({ id: 'pc_' + pc.id, lire: () => pc.photo, ecrire: (v) => { pc.photo = v; } });
      });
      // signatures : seulement si elles ont été recueillies (date renseignée)
      if (r.signatureClient && r.signatureClient.date) out.push({ id: 'sig_client_' + r.id, lire: () => r.signatureClient.dataUrl, ecrire: (v) => { r.signatureClient.dataUrl = v; } });
      if (r.signatureTech && r.signatureTech.date) out.push({ id: 'sig_tech_' + r.id, lire: () => r.signatureTech.dataUrl, ecrire: (v) => { r.signatureTech.dataUrl = v; } });
      return out;
    }

    function lireRapportBrut(db, id) {
      return new Promise(function (resolve) {
        try {
          const tx = db.transaction([STORE_RAPPORTS], 'readonly');
          const req = tx.objectStore(STORE_RAPPORTS).get(id);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }

    async function sauverRapport(rapport) {
      if (!rapport || !rapport.id) return false;
      // Identifiants des photos attribués AVANT la copie : la copie enregistrée et la
      // base photos partagent ainsi les mêmes clés (avant, la copie partait sans id).
      attribuerIds(rapport);
      const copie = JSON.parse(JSON.stringify(rapport));
      memRapports.set(rapport.id, copie);
      const db = await ouvrirDB();
      if (!db) { await sauverPhotosDeRapport(copie); return true; }
      // Garde-fou : une image absente de la copie (version « allégée » du localStorage,
      // sauvegarde incomplète…) est reprise de la base photos ou de l'enregistrement
      // existant, au lieu d'écraser l'image déjà conservée.
      const manquants = emplacementsImages(copie).filter(e => !e.lire());
      if (manquants.length) {
        const ancien = await lireRapportBrut(db, copie.id);
        const parId = {};
        if (ancien) emplacementsImages(ancien).forEach(e => { if (e.id && e.lire()) parId[e.id] = e.lire(); });
        for (const e of manquants) {
          let v = e.id ? parId[e.id] : null;
          if (!v && e.id) v = await getPhoto(e.id);
          if (v) e.ecrire(v);
        }
      }
      const enregistrees = await sauverPhotosDeRapport(copie);
      const leger = alleger(copie, enregistrees);
      return new Promise(function (resolve) {
        try {
          const tx = db.transaction([STORE_RAPPORTS], 'readwrite');
          tx.objectStore(STORE_RAPPORTS).put(leger);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }

    function attribuerIds(rapport) {
      (rapport.evenements || []).forEach(function (ev) {
        (ev.photos || []).forEach(function (ph, idx) {
          if (ph && !ph.id) ph.id = 'p_' + (rapport.id || 'r') + '_' + (ev.id || 'e') + '_' + idx;
        });
      });
      (rapport.photosLibres || []).forEach(function (ph, idx) {
        if (ph && !ph.id) ph.id = 'phl_' + (rapport.id || 'r') + '_' + idx;
      });
    }

    /* Nombre d'images annoncées par le rapport mais introuvables sur ce téléphone
       (rapports enregistrés par une ancienne version, qui ne gardait pas les photos
       dans l'historique). */
    function imagesManquantes(r) {
      let n = 0;
      (r.evenements || []).forEach(ev => (ev.photos || []).forEach(ph => { if (ph && !ph.dataUrl) n++; }));
      (r.photosLibres || []).forEach(ph => { if (ph && !ph.dataUrl) n++; });
      return n;
    }

    async function getRapport(id) {
      if (!id) return null;
      let r = null;
      const db = await ouvrirDB();
      if (db) {
        r = await new Promise(function (resolve) {
          try {
            const tx = db.transaction([STORE_RAPPORTS], 'readonly');
            const req = tx.objectStore(STORE_RAPPORTS).get(id);
            req.onsuccess = function () { resolve(req.result || null); };
            req.onerror = function () { resolve(null); };
          } catch (e) { resolve(null); }
        });
      }
      if (!r && memRapports.has(id)) {
        r = JSON.parse(JSON.stringify(memRapports.get(id)));
      }
      if (r) {
        await restaurerPhotos(r);
      }
      return r;
    }

    async function tousLesRapports() {
      let liste = [];
      const db = await ouvrirDB();
      if (db) {
        liste = await new Promise(function (resolve) {
          try {
            const tx = db.transaction([STORE_RAPPORTS], 'readonly');
            const req = tx.objectStore(STORE_RAPPORTS).getAll();
            req.onsuccess = function () { resolve(req.result || []); };
            req.onerror = function () { resolve([]); };
          } catch (e) { resolve([]); }
        });
      }
      if (!liste || !liste.length) {
        liste = Array.from(memRapports.values()).map(r => JSON.parse(JSON.stringify(r)));
      }
      for (const r of liste) {
        await restaurerPhotos(r);
      }
      return liste;
    }

    /* Supprime le rapport ET ses photos (sinon la base photos grossit indéfiniment). */
    async function supprimerRapport(id) {
      if (!id) return false;
      memRapports.delete(id);
      memPhotos.forEach(function (v, k) { if (v && v.rapportId === id) memPhotos.delete(k); });
      const db = await ouvrirDB();
      if (!db) return true;
      return new Promise(function (resolve) {
        try {
          const tx = db.transaction([STORE_RAPPORTS, STORE_PHOTOS], 'readwrite');
          tx.objectStore(STORE_RAPPORTS).delete(id);
          const cur = tx.objectStore(STORE_PHOTOS).openCursor();
          cur.onsuccess = function () {
            const c = cur.result;
            if (!c) return;
            if (c.value && c.value.rapportId === id) c.delete();
            c.continue();
          };
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }

    /* Identifiants des rapports présents en base (sans rien charger d'autre). */
    async function idsRapports() {
      const db = await ouvrirDB();
      if (!db) return new Set(memRapports.keys());
      return new Promise(function (resolve) {
        try {
          const rq = db.transaction([STORE_RAPPORTS], 'readonly').objectStore(STORE_RAPPORTS).getAllKeys();
          rq.onsuccess = function () { resolve(new Set(rq.result || [])); };
          rq.onerror = function () { resolve(new Set()); };
        } catch (e) { resolve(new Set()); }
      });
    }

    /* Résumé d'un rapport pour la liste « Rapports enregistrés » (aucune image). */
    function resume(r, clesPhotos) {
      let nbPhotos = 0, perdues = 0;
      const voir = function (ph) {
        if (!ph) return;
        nbPhotos++;
        if (!ph.dataUrl && !(ph.id && clesPhotos && clesPhotos.has(ph.id))) perdues++;
      };
      (r.evenements || []).forEach(function (ev) { (ev.photos || []).forEach(voir); });
      (r.photosLibres || []).forEach(voir);
      (r.pieces || []).forEach(function (pc) { if (pc && (pc.photo || (clesPhotos && clesPhotos.has('pc_' + pc.id)))) nbPhotos++; });
      return {
        id: r.id, numero: r.numero || '', statut: r.statut || 'brouillon', date: r.date || '',
        cree: r.cree || '', maj: r.maj || '',
        client: { nom: (r.client && r.client.nom) || '' },
        machine: { designation: (r.machine && r.machine.designation) || '' },
        nbEvenements: (r.evenements || []).length, nbPhotos: nbPhotos, perdues: perdues,
        vierge: !(r.evenements || []).length && !(r.client && r.client.nom) && !(r.chrono && r.chrono.debut)
      };
    }

    /* Liste légère : parcourt les rapports un par un et n'en garde que le résumé.
       Avant, la liste chargeait toutes les photos de tous les rapports. */
    async function resumes() {
      const db = await ouvrirDB();
      if (!db) return null;
      const clesPhotos = await new Promise(function (resolve) {
        try {
          const rq = db.transaction([STORE_PHOTOS], 'readonly').objectStore(STORE_PHOTOS).getAllKeys();
          rq.onsuccess = function () { resolve(new Set(rq.result || [])); };
          rq.onerror = function () { resolve(new Set()); };
        } catch (e) { resolve(new Set()); }
      });
      return new Promise(function (resolve) {
        const out = [];
        try {
          const cur = db.transaction([STORE_RAPPORTS], 'readonly').objectStore(STORE_RAPPORTS).openCursor();
          cur.onsuccess = function () {
            const c = cur.result;
            if (!c) { resolve(out); return; }
            if (c.value && c.value.id) out.push(resume(c.value, clesPhotos));
            c.continue();
          };
          cur.onerror = function () { resolve(out); };
        } catch (e) { resolve(out); }
      });
    }

    async function restaurerPhotos(rapport) {
      if (!rapport) return rapport;
      // 1. Photos des évènements
      for (const ev of (rapport.evenements || [])) {
        for (let idx = 0; idx < (ev.photos || []).length; idx++) {
          const ph = ev.photos[idx];
          if (ph) {
            if (!ph.id) ph.id = 'p_' + (rapport.id || 'r') + '_' + (ev.id || 'e') + '_' + idx;
            if (!ph.dataUrl || ph.dataUrl === '') {
              const u = await getPhoto(ph.id);
              if (u) ph.dataUrl = u;
            }
          }
        }
      }
      // 2. Photos libres
      for (let idx = 0; idx < (rapport.photosLibres || []).length; idx++) {
        const ph = rapport.photosLibres[idx];
        if (ph) {
          // même préfixe que l'enregistrement (« phl_ ») ; « phlib_ » conservé pour les
          // rapports enregistrés avec l'ancienne clé
          const pid = ph.id || ('phl_' + (rapport.id || 'r') + '_' + idx);
          ph.id = pid;
          if (!ph.dataUrl || ph.dataUrl === '') {
            const u = (await getPhoto(pid)) || (await getPhoto('phlib_' + (rapport.id || 'r') + '_' + idx));
            if (u) ph.dataUrl = u;
          }
        }
      }
      // 3. Photos des pièces
      for (const pc of (rapport.pieces || [])) {
        if (pc && pc.id && (!pc.photo || pc.photo === '')) {
          const u = await getPhoto('pc_' + pc.id);
          if (u) pc.photo = u;
        }
      }
      // 4. Signatures
      if (rapport.signatureClient && (!rapport.signatureClient.dataUrl || rapport.signatureClient.dataUrl === '')) {
        const u = await getPhoto('sig_client_' + rapport.id);
        if (u) rapport.signatureClient.dataUrl = u;
      }
      if (rapport.signatureTech && (!rapport.signatureTech.dataUrl || rapport.signatureTech.dataUrl === '')) {
        const u = await getPhoto('sig_tech_' + rapport.id);
        if (u) rapport.signatureTech.dataUrl = u;
      }
      return rapport;
    }

    return {
      disponible: estDispo,
      estOuverte: function () { return ouverte; },
      sauverRapport,
      getRapport,
      tousLesRapports,
      supprimerRapport,
      sauverPhoto,
      getPhoto,
      sauverPhotosDeRapport,
      restaurerPhotos,
      imagesManquantes,
      idsRapports,
      resume,
      resumes
    };
  })();

  if (typeof window !== 'undefined') window.RapportDB = RapportDB;
  if (typeof global !== 'undefined') global.RapportDB = RapportDB;

  const DOMAINES_DEFAUT = [
    { id: 'MECANIQUE', libelle: 'Mécanique', icone: '🔧' },
    { id: 'ELECTRIQUE', libelle: 'Électrique', icone: '⚡' },
    { id: 'AUTOMATISME', libelle: 'Automatisme', icone: '🤖' }
  ];
  const CATEGORIES_DEFAUT = [
    { id: 'SECURITE', libelle: 'Problème de sécurité', icone: '🛑', couleur: '#b91c1c', fond: '#fee2e2' },
    { id: 'URGENT', libelle: 'Urgent', icone: '⚠️', couleur: '#c2410c', fond: '#ffedd5' },
    { id: 'HAUTE', libelle: 'Priorité haute', icone: '🔺', couleur: '#b45309', fond: '#fef3c7' },
    { id: 'BASSE', libelle: 'Priorité basse', icone: '🔽', couleur: '#1d4ed8', fond: '#dbeafe' },
    { id: 'INFO', libelle: 'Informatif', icone: 'ℹ️', couleur: '#475569', fond: '#e2e8f0' }
  ];

  const settingsDefaut = {
    societe: {
      nom: 'BFR SYSTEMS', sigle: 'BFR', sigleSuffixe: 'SYSTEMS', adresse: '', cpVille: '01150 BLYES',
      tel: '', email: '', siteWeb: '', siret: '', tva: '',
      /* Logo du modèle « Compte rendu d'intervention » utilisé tant qu'aucun
         logo n'a été choisi dans les réglages. */
      logo: (typeof window !== 'undefined' && window.LOGO_BFR) || '',
      lieuLettre: 'Blyes',                 // « À Blyes, le … »
      // adresse(s) du pied de page, une par ligne ; vide = site de Blyes
      piedPage: '',
      siege1: '', siege2: ''               // anciens réglages (repris s'ils avaient été saisis)
    },
    technicien: { prenom: '', nom: '', fonction: 'Technicien SAV', tel: '', email: '', signature: '' },
    mail: {
      /* Aucune adresse dans le code (dépôt public) : elle arrive par le fichier
         « réglages d'équipe » importé une fois sur chaque téléphone, ou se saisit dans Réglages. */
      destinataireSAV: '', assistantSAV: '', destinatairesCopie: '',
      objet: 'Rapport d\'intervention N° {{numero}} — {{client}} — {{date}}',
      corps: '', envoyerClient: true, envoyerSAV: true,
      messagePartage: 'Bonjour, veuillez trouver ci-joint le rapport d\'intervention N° {{numero}} du {{date}}. Cordialement.'
    },
    impression: {
      mentionClient: "Le client reconnaît avoir pris connaissance du présent rapport, avoir reçu les explications du technicien et accepte les constats et travaux décrits.",
      /* 'compacte' : évènements à la suite, mise en page selon le nombre de photos ;
         'unParPage' : une page par évènement (ancienne mise en page). */
      miseEnPageEvenements: 'compacte'
    },
    domaines: DOMAINES_DEFAUT,
    categories: CATEGORIES_DEFAUT,
    canevas: null,                 // null = canevas par défaut (Report.canevasDefaut())
    numeroPrefixe: '',
    iconeApp: 'opt1'
  };

  function fusion(base, modif) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!modif || typeof modif !== 'object') return out;
    Object.keys(modif).forEach(k => {
      if (modif[k] && typeof modif[k] === 'object' && !Array.isArray(modif[k]) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = fusion(base[k], modif[k]);
      else if (modif[k] !== undefined) out[k] = modif[k];
    });
    return out;
  }

  let S = fusion(settingsDefaut, Store.get(K.settings, {}));
  /* Migrations ponctuelles des réglages : chacune ne s'exécute qu'UNE fois par téléphone
     (drapeau S.migrations). Avant, elles tournaient à chaque ouverture : un corps de mail
     personnalisé contenant « Cordialement » était effacé, et un e-mail SAV vidé exprès
     était remis d'office. */
  S.migrations = S.migrations || {};
  if (!S.migrations.corpsMailV2) {
    // ancien modèle de corps de mail (champs d'évènements retirés) : on revient au corps par défaut
    if (S.mail && S.mail.corps && /\{\{\s*(pointsCles|actions|nbEvenements|technicien)\s*\}\}|Points clés|Synthèse :/.test(S.mail.corps)) {
      S.mail.corps = '';
    }
    S.migrations.corpsMailV2 = true;
    Store.set(K.settings, S);
  }
  if (!S.migrations.mailSAVv2) {
    // ancienne adresse générique remplacée par celle du responsable SAV
    S.migrations.mailSAVv2 = true;
    Store.set(K.settings, S);
  }
  if (!S.canevas) S.canevas = Report.canevasDefaut();

  /* Capture de l'événement d'installation PWA Android */
  let deferredInstallPrompt = null;
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      const btns = document.querySelectorAll('[data-a="installer-pwa"]');
      btns.forEach(b => { b.style.display = 'block'; });
    });
  }

  // Détection du paramètre URL ?icone= pour synchroniser l'icône lors du lancement depuis un raccourci
  if (typeof window !== 'undefined' && window.location && window.location.search) {
    try {
      const uParams = new URLSearchParams(window.location.search);
      const urlIcone = uParams.get('icone');
      if (urlIcone) {
        const options = window.BFR_ICONES_OPTIONS || [];
        const optMatch = options.find(o => o.id === urlIcone || o.version === urlIcone || o.alias === urlIcone);
        if (optMatch) {
          S.iconeApp = optMatch.id;
          Store.set(K.settings, S);
        }
      }
    } catch (_) {}
  }

  // Assainissement : strictement les 3 icônes officielles BFR
  if (!['opt1', 'opt2', 'opt3'].includes(S.iconeApp)) {
    S.iconeApp = 'opt1';
    Store.set(K.settings, S);
  }

  /* ---------- Gestion de l'icône de l'application (Écran d'accueil) ---------- */
  function appliquerIconeApp(id) {
    if (typeof document === 'undefined') return;
    const options = (typeof window !== 'undefined' && window.BFR_ICONES_OPTIONS) || [];
    const opt = options.find(o => o.id === id || o.version === id || o.alias === id) || options[0];
    if (!opt) return;

    try {
      // 1. Mise à jour de la favicon et de l'icône tactile Apple
      const iconeUrl = opt.src192 || opt.dataUri;
      ['link[rel="icon"]', 'link[rel="shortcut icon"]'].forEach(sel => {
        let el = document.querySelector(sel);
        if (!el) {
          el = document.createElement('link');
          el.rel = 'icon';
          document.head.appendChild(el);
        }
        el.href = iconeUrl;
      });
      const apple = document.querySelector('link[rel="apple-touch-icon"]');
      if (apple) apple.href = iconeUrl;

      // 2. Remplacement dynamique et forcé du manifest PWA (URL physique versionnée, sans blob: non supporté sur Android)
      const manifestFichier = opt.manifest || ('manifest-' + opt.id + '.json');
      const manifestUrl = manifestFichier + '?v=' + Date.now();
      const ancienLien = document.querySelector('link[rel="manifest"]');
      const nouveauLien = document.createElement('link');
      nouveauLien.rel = 'manifest';
      nouveauLien.href = manifestUrl;
      if (ancienLien && ancienLien.parentNode) {
        ancienLien.parentNode.replaceChild(nouveauLien, ancienLien);
      } else {
        document.head.appendChild(nouveauLien);
      }

      // 3. Notification au Service Worker pour actualiser le cache
      if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          action: 'changerIcone',
          iconeId: opt.id,
          manifest: manifestFichier
        });
      }
    } catch (_) {}
  }

  // Application de l'icône choisie au démarrage
  appliquerIconeApp(S.iconeApp || 'opt1');

  /* ===================== Intervention ================================= */
  /* Code du technicien dans le n° de rapport : celui saisi dans « Mes informations »,
     sinon ses initiales (Romuald TEST -> RT). Deux techniciens ne produisent ainsi
     jamais le même numéro le même jour. */
  function codeTechnicien() {
    const t = (S && S.technicien) || {};
    const saisi = String(t.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (saisi) return saisi;
    const initiale = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase();
    return initiale(t.prenom) + initiale(t.nom);
  }
  function debutNumero() {
    const d = new Date();
    const base = d.getFullYear().toString().slice(2) + pad2(d.getMonth() + 1) + pad2(d.getDate());
    const code = codeTechnicien();
    return (S.numeroPrefixe ? S.numeroPrefixe.replace(/[-\s]+$/, '') + '-' : '') + (code ? code + '-' : '') + base + '-';
  }
  function numeroSuggere(exclureId) {
    const debut = debutNumero();
    /* Numéro suivant = plus grand numéro déjà utilisé aujourd'hui avec ce début, + 1. */
    let max = 0;
    Store.get(K.rapports, []).forEach(r => {
      if (!r || (exclureId && r.id === exclureId)) return;
      const n = String((r && r.numero) || '');
      if (n.indexOf(debut) === 0) { const k = parseInt(n.slice(debut.length), 10); if (k > max) max = k; }
    });
    return debut + pad2(max + 1);
  }

  function nouvelleIntervention() {
    return {
      id: uid('r'), cree: new Date().toISOString(), maj: new Date().toISOString(), statut: 'brouillon',
      numero: numeroSuggere(), date: todayISO(),
      client: { nom: '', reference: '', numeroClient: '', contact: '', fonction: '', tel: '', email: '',
                lieu: '', adresse: '', logo: '', noteContacts: '', langue: '' },
      /* Rapport bilingue : désactivé = un seul rapport en français ;
         activé = deux rapports (français + langue choisie). */
      langue: { active: false, code: '' },
      machine: { designation: '', marque: '', modele: '', serie: '', compteur: '', parc: '' },
      machines: [
        { id: uid('m'), designation: '', modele: '', serie: '' }
      ],
      objet: '', technicien: Report.nomComplet(S.technicien),
      techniciens: [
        { id: uid('t'), nom: Report.nomComplet(S.technicien), fonction: (S.technicien && S.technicien.fonction) || 'Technicien SAV', principal: true }
      ],
      chrono: { debut: null, fin: null, pauses: [], enPause: false, debutPause: null },
      multiJours: false,
      jours: [],
      evenements: [], photosLibres: [], pieces: [],
      trajet: {
        actif: false,
        allerDateDepart: '', allerHeureDepart: '', allerDateArrivee: '', allerHeureArrivee: '', allerDureeMinutes: 0,
        retourDateDepart: '', retourHeureDepart: '', retourDateArrivee: '', retourHeureArrivee: '', retourDureeMinutes: 0, retourEstime: true,
        retourReelDateDepart: '', retourReelHeureDepart: '', retourReelDateArrivee: '', retourReelHeureArrivee: '', retourReelDureeMinutes: 0,
        retourCloture: false, note: ''
      },
      actions: '', aPrevoir: '', resumeTechnicien: '', noteInterne: '',
      travauxTermines: '', faitLe: todayISO(),
      signatureClient: { nom: '', fonction: '', dataUrl: '', date: '', heure: '' }
    };
  }

  const rapportStocke = Store.get(K.rapport, null) || {};
  let R = fusion(nouvelleIntervention(), rapportStocke);
  /* numeroAuto : numéro généré par l'appli, recalculé si le code technicien change
     (jamais pour un rapport existant ou dont le numéro a été saisi à la main). */
  if (!rapportStocke.id) { R.numeroAuto = true; R.typeIntervention = 'sav'; }
  if (!R.evenements) R.evenements = [];
  if (!Array.isArray(R.pieces)) R.pieces = [];
  if (!R.trajet || typeof R.trajet !== 'object') {
    R.trajet = {
      actif: false,
      allerDateDepart: '', allerHeureDepart: '', allerDateArrivee: '', allerHeureArrivee: '', allerDureeMinutes: 0,
      retourDateDepart: '', retourHeureDepart: '', retourDateArrivee: '', retourHeureArrivee: '', retourDureeMinutes: 0, retourEstime: true,
      retourReelDateDepart: '', retourReelHeureDepart: '', retourReelDateArrivee: '', retourReelHeureArrivee: '', retourReelDureeMinutes: 0,
      retourCloture: false, note: ''
    };
  }
  /* Rapports enregistrés avant l'option de traduction : valeurs par défaut. */
  if (!R.langue || typeof R.langue !== 'object') R.langue = { active: false, code: '' };
  if (R.client && R.client.langue == null) R.client.langue = '';

  if (!Array.isArray(R.machines) || R.machines.length === 0) {
    R.machines = [{
      id: uid('m'),
      designation: (R.machine && R.machine.designation) || '',
      modele: (R.machine && R.machine.modele) || '',
      serie: (R.machine && R.machine.serie) || ''
    }];
  }
  if (!Array.isArray(R.techniciens) || R.techniciens.length === 0) {
    R.techniciens = [{
      id: uid('t'),
      nom: R.technicien || Report.nomComplet(S.technicien) || '',
      fonction: (S.technicien && S.technicien.fonction) || 'Technicien SAV',
      principal: true
    }];
  }
  if (!Array.isArray(R.jours)) R.jours = [];
  if (typeof R.multiJours !== 'boolean') R.multiJours = (R.jours.length > 0);

  function synchroniserEntites() {
    if (!Array.isArray(R.machines) || R.machines.length === 0) {
      R.machines = [{ id: uid('m'), designation: '', modele: '', serie: '' }];
    }
    if (R.machine) {
      if (R.machine.designation && !R.machines[0].designation) R.machines[0].designation = R.machine.designation;
      if (R.machine.modele && !R.machines[0].modele) R.machines[0].modele = R.machine.modele;
      if (R.machine.serie && !R.machines[0].serie) R.machines[0].serie = R.machine.serie;

      R.machine.designation = R.machines[0].designation || '';
      R.machine.modele = R.machines[0].modele || '';
      R.machine.serie = R.machines[0].serie || '';
    }
    if (!Array.isArray(R.techniciens) || R.techniciens.length === 0) {
      R.techniciens = [{ id: uid('t'), nom: R.technicien || Report.nomComplet(S.technicien) || '', fonction: (S.technicien && S.technicien.fonction) || 'Technicien SAV', principal: true }];
    } else {
      if (R.technicien && !R.techniciens[0].nom) R.techniciens[0].nom = R.technicien;
      R.technicien = R.techniciens[0].nom || '';
    }
  }

  // Initialisation asynchrone du stockage IndexedDB et auto-guérison des photos
  if (typeof RapportDB !== 'undefined') {
    (async function initialiserStockage() {
      try {
        if (R && R.id) {
          const avant = (R.evenements || []).reduce((acc, e) => acc + (e.photos || []).filter(p => p && p.dataUrl).length, 0);
          await RapportDB.restaurerPhotos(R);
          const apres = (R.evenements || []).reduce((acc, e) => acc + (e.photos || []).filter(p => p && p.dataUrl).length, 0);
          if (apres > avant) {
            Store.set(K.rapport, R);
            if (typeof rendreTout === 'function') rendreTout();
          }
          // Un rapport vierge (jamais modifié) n'est pas enregistré : évite les rapports
          // fantômes vides avec un numéro en double au premier lancement.
          if (!rapportVierge(R)) await RapportDB.sauverRapport(R);
        }
        const liste = Store.get(K.rapports, []);
        const presents = await RapportDB.idsRapports();
        let toutEnBase = RapportDB.estOuverte();
        for (const rep of liste) {
          if (rep && rep.id && !presents.has(rep.id)) {
            if (!(await RapportDB.sauverRapport(rep))) toutEnBase = false;
          }
        }
        /* Tout l'historique est dans la base : la copie du localStorage est allégée
           (photos retirées), ce qui libère la place prise par les anciennes versions. */
        if (toutEnBase) ecrireHistoriqueLocal(liste);
      } catch (e) {
        console.warn('Initialisation stockage:', e);
      }
    })();
  }

  function rapportVierge(r) {
    return !!r && !(r.evenements || []).length && !(r.photosLibres || []).length && !(r.pieces || []).length
      && !(r.client && r.client.nom) && !(r.chrono && r.chrono.debut) && !(r.jours || []).length && !r.objet && !r.actions && !r.aPrevoir
      && !(r.signatureClient && r.signatureClient.dataUrl);
  }

  /* Stockage permanent : sans cette demande, Android peut effacer les données de
     l'application (rapports + photos) quand la mémoire du téléphone est pleine. */
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(deja => { if (!deja) return navigator.storage.persist(); }).catch(() => {});
  }

  /* Rappel de sauvegarde : tout est dans le téléphone ; s'il est perdu ou cassé, seuls
     les rapports exportés (ou déjà envoyés) sont récupérables. */
  const RAPPEL_SAUVEGARDE_JOURS = 7;
  function joursDepuisSauvegarde() {
    const d = Store.get('sav3.derniereSauvegarde', null);
    return d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;
  }
  function sauvegardeEnRetard() {
    const nbRapports = Store.get(K.rapports, []).filter(r => r && !rapportVierge(r)).length;
    if (!nbRapports) return false;
    const j = joursDepuisSauvegarde();
    return j === null || j >= RAPPEL_SAUVEGARDE_JOURS;
  }
  setTimeout(() => {
    if (sauvegardeEnRetard()) {
      const j = joursDepuisSauvegarde();
      toast(j === null ? 'Aucune sauvegarde exportée : Menu → Exporter la sauvegarde'
                       : 'Dernière sauvegarde il y a ' + j + ' jours : Menu → Exporter la sauvegarde', 6000);
    }
  }, 2500);

  let dirty = false, saveTimer;
  /* Copie de secours de l'historique dans le localStorage. Quand la base IndexedDB
     est ouverte (elle garde les rapports ET leurs photos), cette copie est faite
     SANS les photos : avec elles, elle remplissait les 5 Mo du localStorage et plus
     rien d'autre ne pouvait y être enregistré (réglages, fiches clients…). */
  function sansPhotos(r) {
    const c = JSON.parse(JSON.stringify(r));
    c.evenements = (c.evenements || []).map(e => Object.assign({}, e, {
      photos: (e.photos || []).map(p => ({ id: p.id, legende: p.legende || '', annotations: p.annotations || [], dataUrl: '' }))
    }));
    c.photosLibres = (c.photosLibres || []).map(p => ({
      id: p.id, legende: p.legende || '', annotations: p.annotations || [], dataUrl: ''
    }));
    return c;
  }
  function ecrireHistoriqueLocal(liste) {
    const base = typeof RapportDB !== 'undefined' && RapportDB.estOuverte && RapportDB.estOuverte();
    return Store.set(K.rapports, base ? liste.map(sansPhotos) : liste);
  }

  function sauver(silencieux) {
    synchroniserEntites();
    R.maj = new Date().toISOString();

    // 1. Persistance intégrale dans IndexedDB (aucun quota de 5 Mo, 100 % des photos conservées)
    if (typeof RapportDB !== 'undefined') {
      RapportDB.sauverRapport(R);
    }

    // 2. Persistance du rapport actif dans localStorage
    let ok = Store.set(K.rapport, R);
    if (!ok) {
      // Si R dépasse le quota localStorage (5 Mo), on enregistre une version légère dans localStorage
      // tandis qu'IndexedDB conserve 100 % des photos
      const rLeger = JSON.parse(JSON.stringify(R));
      rLeger.evenements = (rLeger.evenements || []).map(e => Object.assign({}, e, {
        photos: (e.photos || []).map(p => ({ id: p.id, legende: p.legende || '', annotations: p.annotations || [], dataUrl: '' }))
      }));
      rLeger.photosLibres = (rLeger.photosLibres || []).map(p => ({
        id: p.id, legende: p.legende || '', annotations: p.annotations || [], dataUrl: ''
      }));
      ok = Store.set(K.rapport, rLeger);
    }

    // 3. Mise à jour de la liste d'historique
    const liste = Store.get(K.rapports, []);
    const i = liste.findIndex(x => x.id === R.id);
    if (i >= 0) liste[i] = R; else liste.unshift(R);
    if (liste.length > 40) liste.length = 40;

    let ok2 = ecrireHistoriqueLocal(liste);
    if (!ok2) {
      // Si le localStorage sature (quota 5 Mo dépassé), on allège la copie de secours du localStorage
      // tout en conservant les identifiants et métadonnées de photos.
      // RapportDB conserve 100 % des photos en haute résolution dans IndexedDB.
      const listeCondensee = liste.map(r => {
        if (r.id === R.id) return r;
        const c = JSON.parse(JSON.stringify(r));
        c.evenements = (c.evenements || []).map(e => Object.assign({}, e, {
          photos: (e.photos || []).map(p => ({ id: p.id, legende: p.legende || '', annotations: p.annotations || [], dataUrl: '' }))
        }));
        c.photosLibres = (c.photosLibres || []).map(p => ({
          id: p.id, legende: p.legende || '', annotations: p.annotations || [], dataUrl: ''
        }));
        return c;
      });
      ok2 = Store.set(K.rapports, listeCondensee);
      if (!ok2) {
        const listeUltra = listeCondensee.map(r => {
          const c = JSON.parse(JSON.stringify(r));
          c.evenements = (c.evenements || []).map(e => Object.assign({}, e, {
            photos: (e.photos || []).map(p => ({ id: p.id, legende: p.legende || '', annotations: p.annotations || [], dataUrl: '' }))
          }));
          c.photosLibres = (c.photosLibres || []).map(p => ({
            id: p.id, legende: p.legende || '', annotations: p.annotations || [], dataUrl: ''
          }));
          return c;
        });
        ok2 = Store.set(K.rapports, listeUltra);
      }
    }

    if (!ok && (!RapportDB || !RapportDB.disponible())) {
      if (!silencieux) toast('Mémoire pleine : exportez la sauvegarde (Menu)', 5000);
      return false;
    }
    dirty = false;
    if (!silencieux) toast('Enregistré');
    return true;
  }
  function planifier() { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(() => sauver(true), 800); }

  /* ===================== Chronomètre ================================== */
  let tic = null;
  function duree() {
    return Report.dureeTotale ? Report.dureeTotale(R) : Report.dureeMs(R.chrono);
  }
  function dureeTexte(ms) {
    if (ms === undefined) ms = tempsAffiche();
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 3600) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
  }
  /* Temps affiché par le chrono : la journée en cours (intervention sur plusieurs
     jours) ou toute l'intervention. */
  function tempsAffiche() {
    return (R.multiJours && R.chrono && R.chrono.jourEnCours) ? Report.dureeMs(R.chrono) : duree();
  }

  /* ---------- Intervention sur plusieurs jours ----------
     Les journées terminées sont dans le relevé (R.jours) ; le chrono ne mesure que
     la journée en cours (R.chrono.jourEnCours). Une nouvelle journée s'ouvre toute
     seule quand on reprend un autre jour (bouton « Reprendre », ou pause du soir
     reprise le lendemain). */
  const dateLocale = (iso) => Report.dateLocale(iso ? new Date(iso) : new Date());
  const heureCourte = (iso) => Report.heureFr(iso);
  function chronoVide() { return { debut: null, fin: null, pauses: [], enPause: false, debutPause: null }; }
  /* La journée du chrono rejoint le relevé (fin : finIso) ; le chrono est remis à zéro. */
  function versReleve(finIso) {
    if (!R.multiJours) R.jours = [];          // un ancien relevé non utilisé ne se mélange pas au nouveau
    const j = Object.assign({ id: uid('j') }, Report.jourDepuisChrono(R.chrono, finIso));
    R.jours.push(j);
    R.multiJours = true;
    R.chrono = chronoVide();
    return j;
  }
  function nouvelleJournee(debutIso) {
    R.chrono = Object.assign(chronoVide(), { debut: debutIso || new Date().toISOString(), jourEnCours: true });
    R.statut = 'en cours';
  }
  const libelleJour = (j) => (Report.frDate(j.date) || j.date) + ' (' + Report.dureeDecimale(j.dureeMs || 0) + ' h)';
  /* Chrono lancé un jour précédent et jamais arrêté (hors pause du soir). */
  function chronoOublie() {
    const c = R.chrono;
    return !!(c && c.debut && !c.fin && !c.enPause && !c.nuit && dateLocale(c.debut) !== dateLocale());
  }

  function demarrerChrono() {
    R.chrono.debut = new Date().toISOString();
    R.chrono.fin = null; R.chrono.pauses = []; R.chrono.enPause = false; R.chrono.debutPause = null;
    R.statut = 'en cours';
    if (!R.date) R.date = todayISO();
    planifier(); rendreChrono(); sauver(true);
    toast('Intervention démarrée à ' + Report.heureFr(R.chrono.debut));
  }
  function basculerPause() {
    const c = R.chrono;
    if (!c.enPause) {
      if (chronoOublie()) { feuilleOubliChrono(); return; }
      c.enPause = true; c.debutPause = new Date().toISOString();
      toast('Pause (interruption, repas, fin de journée…) — le temps est déduit');
    } else {
      const maintenant = new Date().toISOString();
      if (dateLocale(c.debutPause) !== dateLocale(maintenant)) {
        // pause du soir reprise le lendemain : la journée d'hier s'arrête au début de la pause
        const finJour = c.debutPause;
        c.enPause = false; c.debutPause = null;
        const j = versReleve(finJour);
        nouvelleJournee(maintenant);
        toast('Jour ' + (R.jours.length + 1) + ' commencé à ' + heureCourte(maintenant) +
          ' — journée du ' + libelleJour(j) + ' enregistrée', 5000);
      } else {
        c.pauses.push({ d: c.debutPause, f: maintenant });
        c.enPause = false; c.debutPause = null;
        toast('Reprise de l\'intervention');
      }
    }
    planifier(); rendreChrono();
  }
  function terminerChrono() {
    const c = R.chrono;
    if (chronoOublie()) { feuilleOubliChrono(); return; }
    const maintenant = new Date().toISOString();
    let fin = maintenant;
    if (c.enPause) {
      // en pause depuis la veille : la journée s'est arrêtée au début de la pause
      if (dateLocale(c.debutPause) !== dateLocale(maintenant)) fin = c.debutPause;
      else c.pauses.push({ d: c.debutPause, f: maintenant });
      c.enPause = false; c.debutPause = null;
    }
    if (R.multiJours && c.jourEnCours) {
      const j = versReleve(fin);
      toast('Journée du ' + libelleJour(j) + ' enregistrée — ' + R.jours.length + ' jour(s), ' + Report.formatDuree(duree()) + ' au total', 4500);
    } else {
      c.fin = fin;
      toast('Intervention terminée — ' + Report.formatDuree(duree()) + ' sur site');
    }
    R.statut = R.signatureClient.dataUrl ? 'signé' : 'terminé';
    R.travauxTermines = R.travauxTermines || 'Oui';
    planifier(); rendreChrono();
  }
  /* « Reprendre » après « Terminer » : le même jour, l'interruption devient une pause ;
     un autre jour, une nouvelle journée commence (la précédente rejoint le relevé). */
  function reprendreIntervention() {
    const c = R.chrono;
    const maintenant = new Date().toISOString();
    if (!R.multiJours && c.debut && c.fin) {
      if (dateLocale(c.fin) === dateLocale(maintenant)) {
        c.pauses = c.pauses || [];
        c.pauses.push({ d: c.fin, f: maintenant });
        toast('Reprise — l\'interruption de ' + heureCourte(c.fin) + ' à ' + heureCourte(maintenant) + ' est déduite', 4000);
        c.fin = null;
        R.statut = 'en cours';
      } else {
        const j = versReleve(c.fin);
        nouvelleJournee(maintenant);
        toast('Jour 2 commencé à ' + heureCourte(maintenant) + ' — journée du ' + libelleJour(j) + ' enregistrée', 5000);
      }
    } else if (R.multiJours && !c.jourEnCours) {
      nouvelleJournee(maintenant);
      toast('Jour ' + (R.jours.length + 1) + ' commencé à ' + heureCourte(maintenant), 3500);
    }
    planifier(); rendreChrono(); sauver(true);
  }
  /* Chrono resté lancé depuis un jour précédent : on demande l'heure de fin de cette
     journée et l'heure de reprise aujourd'hui. */
  function feuilleOubliChrono() {
    const c = R.chrono;
    const jour1 = dateLocale(c.debut);
    const finDefaut = heureCourte(c.debut) < '17:00' ? '17:00' : heureCourte(new Date(new Date(c.debut).getTime() + 3600000).toISOString());
    const maintenantHeure = heureCourte(new Date().toISOString());
    const repriseDefaut = maintenantHeure < '08:00' ? maintenantHeure : '08:00';
    Ouvrir.ouvrir(null, `<div class="panel">
      <div class="grab"></div><h3>Chrono resté lancé</h3>
      <p class="sub">Le chrono tourne depuis le <strong>${esc(Report.frDate(jour1))} à ${esc(heureCourte(c.debut))}</strong> : il n'a sans doute pas été arrêté en fin de journée.</p>
      <div class="grid2">
        <div class="field"><label>Fin de journée le ${esc(Report.frDate(jour1))}</label><input type="time" id="oubliFin" value="${esc(finDefaut)}"></div>
        <div class="field"><label>Reprise aujourd'hui</label><input type="time" id="oubliReprise" value="${esc(repriseDefaut)}"></div>
      </div>
      <p class="small">La journée du ${esc(Report.frDate(jour1))} rejoint le relevé des journées ; celle d'aujourd'hui continue depuis l'heure de reprise.</p>
      <div class="btnrow"><button class="btn grey" data-a="oubli-nuit">Non : travail continu (de nuit)</button>
        <button class="btn" data-a="oubli-ok">Enregistrer</button></div>
      <button class="btn ghost wide" style="margin-top:8px" data-a="fermer">Annuler</button></div>`, (panneau) => {
      panneau.addEventListener('click', (e) => {
        if (e.target.closest('[data-a="oubli-nuit"]')) {
          R.chrono.nuit = true;             // on ne redemande plus pour ce chrono
          planifier(); rendreChrono();
          panneau.closest('.sheet').remove();
          toast('Compris : le temps continue sans interruption');
          return;
        }
        if (!e.target.closest('[data-a="oubli-ok"]')) return;
        const hFin = $('#oubliFin', panneau).value || finDefaut;
        const hRep = $('#oubliReprise', panneau).value || repriseDefaut;
        let finIso = new Date(jour1 + 'T' + hFin + ':00').toISOString();
        if (new Date(finIso) <= new Date(c.debut)) finIso = new Date(new Date(c.debut).getTime() + 60000).toISOString();
        let repriseIso = new Date(todayISO() + 'T' + hRep + ':00').toISOString();
        if (new Date(repriseIso) > new Date()) repriseIso = new Date().toISOString();
        const j = versReleve(finIso);
        nouvelleJournee(repriseIso);
        planifier(); rendreChrono(); sauver(true);
        panneau.closest('.sheet').remove();
        toast('Journée du ' + libelleJour(j) + ' enregistrée — aujourd\'hui depuis ' + heureCourte(repriseIso), 5000);
      });
    });
  }

  function rendreChrono() {
    const barre = $('#chronoBarre');
    if (!barre) return;
    const c = R.chrono;
    const icoPlay = (ICO.play && ICO.play(14)) || '', icoPen = (ICO.pen && ICO.pen(14)) || '';
    const smsLien = (txt) => (R.client && R.client.nom ? ' • <a href="#" data-a="sms-arrivee" style="color:var(--bleu,#06baf2);text-decoration:underline">' + (contactArriveeAppel() ? 'Appeler le contact' : txt) + '</a>' : '');
    const avertissementOubli = chronoOublie()
      ? `<div class="chrono-oubli">Chrono lancé le ${esc(Report.frDate(dateLocale(c.debut)))} à ${esc(heureCourte(c.debut))} et jamais arrêté.
          <button type="button" class="btn sm" data-a="chrono-oubli">Corriger</button></div>` : '';
    const boutonsEnCours = `<div class="chrono-actions">
          <button class="btn sm grey" data-a="chrono-pause">${c.enPause ? (icoPlay + ' Reprendre') : (((ICO.pause && ICO.pause(14)) || '') + ' Pause')}</button>
          <button class="btn sm or" data-a="chrono-terminer">${(ICO.stop && ICO.stop(14)) || ''} Terminer</button>
        </div>`;

    if (R.multiJours && Array.isArray(R.jours) && (R.jours.length > 0 || c.jourEnCours)) {
      const tot = duree();
      const listeJours = R.jours.map(libelleJour).join(' • ');
      if (c.jourEnCours && c.debut) {
        // une journée est en cours
        barre.innerHTML = `<div class="chrono-encours">
          <div class="chrono-temps"><span class="chrono-label">Jour ${R.jours.length + 1} — ${c.enPause ? 'en pause depuis' : 'sur site depuis'} ${esc(heureCourte(c.enPause ? c.debutPause : c.debut))}</span>
            <strong id="chronoTemps">${dureeTexte()}</strong></div>
          ${boutonsEnCours}</div>
          ${avertissementOubli}
          <p class="chrono-note">${listeJours ? 'Jours précédents : ' + esc(listeJours) + ' • ' : ''}cumul ${esc(Report.formatDuree(tot) || '0 min')}${(c.pauses || []).length ? ' • ' + c.pauses.length + ' pause(s) aujourd\'hui' : ''}${smsLien('SMS d\'arrivée')}</p>`;
      } else {
        barre.innerHTML = `<div class="chrono-encours">
          <div class="chrono-temps"><span class="chrono-label">Heures cumulées (${R.jours.length} jour(s))</span>
            <strong id="chronoTemps">${Report.formatDuree(tot) || '0 min'}</strong></div>
          <div class="chrono-actions">
            <button class="btn sm" data-a="chrono-reprendre" title="Commencer une nouvelle journée d'intervention">${icoPlay} Reprendre</button>
            <button class="btn sm grey" data-a="chrono-ajuster">${icoPen} Relevé jours</button></div></div>
          <p class="chrono-note">${esc(listeJours)} • ${Report.dureeDecimale(tot)} h</p>`;
      }
    } else if (!c.debut) {
      barre.innerHTML = `<button class="btn chrono-demarrer" data-a="chrono-demarrer" style="width:100%">
        ${(ICO.play && ICO.play(16)) || ''} Démarrer l'intervention</button>
        <p class="chrono-note">L'heure de début est enregistrée automatiquement.${smsLien('Prévenir le contact par SMS')}</p>`;
    } else if (!c.fin) {
      barre.innerHTML = `<div class="chrono-encours">
        <div class="chrono-temps"><span class="chrono-label">${c.enPause ? 'En pause depuis' : 'Sur site depuis'}</span>
          <strong id="chronoTemps">${dureeTexte()}</strong></div>
        ${boutonsEnCours}</div>
        ${avertissementOubli}
        <p class="chrono-note">Début ${Report.heureFr(c.debut)}${(c.pauses || []).length ? ' — ' + c.pauses.length + ' pause(s) déduite(s)' : ''}${smsLien('SMS d\'arrivée')}</p>`;
    } else {
      barre.innerHTML = `<div class="chrono-encours">
        <div class="chrono-temps"><span class="chrono-label">Temps sur site</span><strong>${Report.formatDuree(duree()) || '0 min'}</strong></div>
        <div class="chrono-actions">
          <button class="btn sm" data-a="chrono-reprendre" title="Reprendre l'intervention (un autre jour : nouvelle journée)">${icoPlay} Reprendre</button>
          <button class="btn sm grey" data-a="chrono-ajuster">${icoPen} Ajuster</button></div></div>
        <p class="chrono-note">De ${Report.heureFr(c.debut)} à ${Report.heureFr(c.fin)}${(c.pauses || []).length ? ' — ' + c.pauses.length + ' pause(s)' : ''} • ${Report.dureeDecimale(duree())} h</p>`;
    }
    clearInterval(tic);
    if (c.debut && !c.fin && !c.enPause) {
      tic = setInterval(() => { const el = $('#chronoTemps'); if (el) el.textContent = dureeTexte(); else clearInterval(tic); }, 1000);
    }
  }

  /* ===================== Rendu ======================================= */
  function catDe(id) { return (S.categories || []).find(c => c.id === id) || S.categories[S.categories.length - 1] || { id: 'INFO', libelle: 'Informatif', couleur: '#475569', fond: '#e2e8f0', icone: 'ℹ️' }; }
  function domDe(id) { return (S.domaines || []).find(d => d.id === id) || { id: '', libelle: '—', icone: '' }; }

  function rendreTout() {
    const bm = $('#brandMark'), bn = $('#brandName'), tl = $('#topbarLogo');
    if (tl && window.LOGO_BFR_TOPBAR && tl.getAttribute('src') !== window.LOGO_BFR_TOPBAR) {
      tl.src = window.LOGO_BFR_TOPBAR;
    }
    if (bn) bn.textContent = S.societe.nom || 'Rapport d\'intervention';
    if (bm) {
      if (S.societe.logo) { bm.innerHTML = '<img src="' + S.societe.logo + '" alt="logo">'; }
      else bm.textContent = S.societe.sigle || 'SAV';
    }
    const e = Report.etat(R, S);
    const hn = $('#hdrNum');
    if (hn) {
      hn.textContent = (R.signatureClient.dataUrl ? '✔ Signé • ' : '') + 'N° ' + (R.numero || '—') +
        (R.client.nom ? ' • ' + R.client.nom : '');
    }
    rendreChrono();
    rendreEntete();
    rendreEvenements(e);
    rendreCloture(e);
    $$('.compteur-ev').forEach(el => { el.textContent = String(e.evenements.length); });
  }

  function rendreEntete() {
    const zone = $('#zoneEntete');
    if (!zone) return;
    synchroniserEntites();
    const c = R.client, m = R.machine;
    const machinesValides = (R.machines || []).filter(x => x && (x.designation || x.modele || x.serie));
    const renseigne = c.nom || m.designation || machinesValides.length > 0;
    const recapMachines = machinesValides.length > 1
      ? `<div><span>Machines</span><strong>${machinesValides.length} machines (${esc(machinesValides.map(x => x.designation || 'Machine').join(', '))})</strong></div>`
      : `<div><span>Machine</span><strong>${esc([m.designation, m.modele].filter(Boolean).join(' — ') || '—')}</strong></div>
         <div><span>N° série</span><strong>${esc(m.serie || '—')}</strong></div>`;

    const techsValides = (R.techniciens || []).filter(t => t && t.nom);
    const recapTechs = techsValides.length > 1
      ? `<div><span>Techniciens</span><strong>${esc(techsValides.map(t => t.nom + (t.fonction ? ' (' + t.fonction + ')' : '')).join(' · '))}</strong></div>`
      : '';

    zone.innerHTML = `
      <div class="card">
        <h2>Intervention <button class="btn sm grey" data-a="editer-client">${(ICO.pen && ICO.pen(14)) || ''} ${renseigne ? 'Modifier' : 'Renseigner'}</button></h2>
        ${renseigne
          ? `<div class="recap">
              <div><span>Client</span><strong>${esc(c.nom || '—')}</strong></div>
              <div><span>Lieu</span><strong>${esc(c.lieu || c.adresse || '—')}</strong></div>
              ${recapMachines}
              <div><span>Contact</span><strong>${esc(c.contact || '—')}${c.tel ? ' · ' + esc(c.tel) : ''}</strong></div>
              ${recapTechs}
              <div><span>Type</span><strong>${esc((Report.TYPES_INTERVENTION[R.typeIntervention] || {}).libelle || 'Non précisé')}</strong></div>
              <div><span>Objet</span><strong>${esc(R.objet || '—')}</strong></div>
              <div><span>Langue du rapport</span><strong>${R.langue.active && R.langue.code
                ? 'français + ' + esc(I18N.natif(R.langue.code))
                : 'français'}</strong></div>
            </div>
            <div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--bord,#cbd5e1)">
              <button type="button" class="btn sm" data-a="sms-arrivee" style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;background:#f0f9ff;border:1.5px solid var(--bleu,#06baf2);color:#0284c7;font-weight:600;padding:7px 10px;font-size:12.5px">
                ${icoContact(15)} ${contactArriveeAppel() ? 'Appeler le contact (arrivée sur site)' : 'Prévenir le contact par SMS (arrivée sur site)'}
              </button>
            </div>`
          : `<p class="hint">Renseignez le client et la machine : ces informations se retrouvent dans le rapport.</p>
             <button class="btn wide" data-a="editer-client">Client & machine</button>`}
      </div>`;
  }

  /* Couleurs et libellé d'un évènement : vert « Travail réalisé », ou la catégorie
     (priorité) d'un constat. */
  const STYLE_TRAVAIL = { couleur: '#15803d', fond: '#dcfce7' };
  const FONDS_RESULTAT = { termine: '#ccfbf1', resolu: '#dcfce7', partiel: '#ffedd5', surveiller: '#fef3c7' };
  function styleEvenement(ev) {
    if (Report.estTravail(ev)) {
      return { couleur: STYLE_TRAVAIL.couleur, fond: STYLE_TRAVAIL.fond, libelle: 'Travail réalisé',
        ico: (ICO.wrench && ICO.wrench(16)) || '🔧' };
    }
    const cat = catDe(ev.categorie);
    return { couleur: cat.couleur, fond: cat.fond, libelle: cat.libelle,
      ico: (ICO.categorie && ICO.categorie(cat.id || cat.icone, 16)) || '' };
  }
  /* Pastille sous le texte : résultat du travail, ou « corrigé sur place ». */
  function mentionCarte(ev) {
    if (Report.estTravail(ev)) {
      const r = Report.RESULTATS[ev.resultat];
      return r ? `<span class="ev-mention" style="--c:${r.couleur};--f:${FONDS_RESULTAT[ev.resultat]}">Résultat : ${esc(r.libelle)}</span>` : '';
    }
    return ev.corrige ? `<span class="ev-mention">✓ Corrigé pendant l'intervention</span>` : '';
  }

  function carteEvenement(ev, i) {
    const st = styleEvenement(ev), dom = domDe(ev.domaine);
    const travail = Report.estTravail(ev);
    const texte = Report.valeur(ev.texte);
    return `<div class="ev-carte${travail ? ' travail' : ''}" data-ev="${ev.id}" style="--c:${st.couleur};--f:${st.fond}">
      <div class="ev-tete">
        <span class="ev-dom">${(ICO.domaine && ICO.domaine(dom.id || dom.icone, 16)) || ''} ${esc(dom.libelle)}</span>
        ${ev.machineNom ? `<span class="pill" style="background:var(--bfr-primary-light);color:var(--bfr-secondary);font-weight:600;border:1px solid var(--bfr-primary-border)">${(ICO.gear && ICO.gear(13)) || ''} ${esc(ev.machineNom)}</span>` : ''}
        <span class="ev-cat">${st.ico} ${esc(st.libelle)}</span>
        <span class="ev-heure">${esc(Report.heureFr(ev.heure))}</span>
      </div>
      <div class="ev-corps">
        ${(ev.photos || []).filter(p => p && p.dataUrl).length ? `<div class="ev-vignettes">${ev.photos.filter(p => p && p.dataUrl).slice(0, 3).map(p => `<img src="${p.dataUrl}" alt="">`).join('')}</div>` : ''}
        <div class="ev-texte-bloc">
          <p class="ev-texte">${texte ? esc(texte.length > 180 ? texte.slice(0, 180) + '…' : texte) : '<em>Annotation à compléter…</em>'}</p>
          ${mentionCarte(ev)}
        </div>
      </div>
      <div class="ev-pied">
        ${(ev.photos || []).length ? `<span class="pill">${ev.photos.length} photo(s)</span>` : '<span class="pill">sans photo</span>'}
        ${!ev.texte ? '<span class="pill surv">texte manquant</span>' : ''}
        <div class="ev-actions-pied">
          <button type="button" class="btn-ev-pill basculer" data-a="basculer-nature" data-id="${ev.id}"
            title="${travail ? 'Classer cet évènement dans les constats' : 'Classer cet évènement dans les travaux réalisés'}">${travail
              ? ((ICO.eye && ICO.eye(13)) || '') + ' En constat'
              : ((ICO.wrench && ICO.wrench(13)) || '') + ' En travail'}</button>
          <button type="button" class="btn-ev-pill apercu" data-a="apercu-ev" data-id="${ev.id}" title="Aperçu débrief client">${(ICO.eye && ICO.eye(13)) || ''} Aperçu</button>
          <button type="button" class="btn-ev-pill modifier" data-a="modifier-ev" data-id="${ev.id}" title="Modifier cet évènement">${(ICO.pen && ICO.pen(13)) || ''} Modifier</button>
        </div>
      </div>
    </div>`;
  }

  function rendreEvenements(e) {
    const zone = $('#zoneEvenements');
    if (!zone) return;
    const evs = R.evenements.slice().sort((a, b) => new Date(a.heure || 0) - new Date(b.heure || 0));
    const travaux = evs.filter(x => Report.estTravail(x));
    const constats = evs.filter(x => !Report.estTravail(x));
    /* Deux listes dès qu'il y a un travail réalisé ou un type d'intervention ;
       un ancien rapport sans travaux garde sa liste unique. */
    const separer = travaux.length > 0 || !!R.typeIntervention;
    const groupe = (cls, ico, titre, liste, vide) =>
      `<div class="ev-groupe-titre ${cls}">${ico} ${titre} <span class="compte">${liste.length}</span></div>` +
      (liste.length ? `<div class="ev-liste">${liste.map(carteEvenement).join('')}</div>` : `<p class="hint">${vide}</p>`);
    const blocTravaux = groupe('travaux', (ICO.wrench && ICO.wrench(16)) || '🔧', 'Travaux réalisés', travaux,
      'Aucun travail réalisé pour l\'instant.');
    const blocConstats = groupe('constats', (ICO.eye && ICO.eye(16)) || '🔍', 'Constats', constats,
      'Aucun constat pour l\'instant.');
    zone.innerHTML = `
      <div class="card">
        <h2>Évènements <span class="pill compteur-ev">0</span></h2>
        <p class="hint">${separer
          ? '<strong>Travaux réalisés</strong> : ce que vous avez fait. <strong>Constats</strong> : ce que vous avez observé, avec une priorité. Appuyez sur un évènement pour le compléter ; « En travail / En constat » le change de liste.'
          : 'Chaque constat, défaut ou information relevée sur la machine. Appuyez sur un évènement pour le compléter ou le corriger à tout moment.'}</p>
        ${e.securite ? `<div class="alerte-securite">${(ICO.shieldAlert && ICO.shieldAlert(18)) || ''} ${e.securite} point(s) de sécurité ou d'urgence — ils apparaîtront en tête des constats.</div>` : ''}
        ${!evs.length
          ? `<div class="ev-vide">
               <span class="ev-vide-ico">${(ICO.fileText && ICO.fileText(36)) || ''}</span>
               <p>Aucun évènement pour l'instant.</p>
               <p class="small">Commencez par le premier : travail ou constat → annotation → photo → résultat ou catégorie.</p>
             </div>`
          : !separer
            ? `<div class="ev-liste">${evs.map(carteEvenement).join('')}</div>`
            : (R.typeIntervention === 'audit' ? blocConstats + blocTravaux : blocTravaux + blocConstats)}
      </div>`;
  }

  function rendreCloture(e) {
    const zone = $('#zoneCloture');
    if (!zone) return;
    const signe = !!(R.signatureClient && R.signatureClient.dataUrl);
    const tr = Report.calculerTrajet ? Report.calculerTrajet(R.trajet, e.duree) : null;
    zone.innerHTML = `
      <div class="card">
        <h2>Compte rendu</h2>
        <div class="field"><label>Résumé / synthèse de l\'intervention</label>
          <textarea data-k="resumeTechnicien" rows="4" placeholder="Ex. Audit complet du groupe hydraulique : courroie détendue, roulement d'arbre principal en fin de vie. Remplacement de la courroie, graissage, essai en charge concluant.">${esc(R.resumeTechnicien)}</textarea></div>
        <div class="field"><label>Travaux réalisés — résumé</label>
          <textarea data-k="actions" rows="3" placeholder="Ex. Remplacement courroie XPB 2360, réglage tension, graissage des paliers…">${esc(R.actions)}</textarea>
          <p class="small" style="margin-top:4px">Imprimé en tête de la partie « Travaux réalisés », avant le détail des travaux saisis en évènements.</p></div>
        <div class="field"><label>Travaux à prévoir (base du devis)</label>
          <textarea data-k="aPrevoir" rows="3" placeholder="Ex. Remplacer le roulement principal sous 48 h, 4 silentblocs…">${esc(R.aPrevoir)}</textarea></div>
        <div class="grid2">
          ${champSelect('travauxTermines', 'Travaux terminés', ['', 'Oui', 'Non', 'Partiellement'])}
          <div class="field"><label>Fait le</label><input type="date" data-k="faitLe" value="${esc(R.faitLe || todayISO())}"></div>
        </div>
      </div>

      <div class="card" id="cardPieces">
        <h2>Pièces de rechange
          ${(R.pieces && R.pieces.length) ? `<span class="pill">${R.pieces.length} pièce${R.pieces.length > 1 ? 's' : ''}</span>` : ''}
        </h2>
        <p class="hint">Pièces échangées ou laissées dans le stock du client sur place. La signature du client vaudra pour acceptation du devis final.</p>
        ${rendreTableauPieces()}
        <p class="hint" style="margin-top:8px">Ajout d'une pièce : bouton « Ajouter une pièce » en bas de l'écran.</p>
      </div>

      <div class="card" id="cardTrajet">
        <h2>Temps de route &amp; Déplacement
          ${(tr && tr.actif) ? `<span class="pill" style="background:#e0f2fe;color:#0369a1">${tr.totalRoute.texte}</span>` : ''}
        </h2>
        <p class="hint">Horaires aller et retour. Le retour est automatiquement estimé sur la base de l'aller avant la signature client.</p>
        ${rendreContenuTrajet(tr)}
      </div>

      <div class="card">
        <h2>Point client & signature</h2>
        ${signe
          ? `<div class="signe-ok">${(ICO.checkCircle && ICO.checkCircle(18)) || ''} Signé par <strong>${esc(R.signatureClient.nom || 'le client')}</strong>
               ${R.signatureClient.heure ? 'à ' + esc(R.signatureClient.heure) : ''}
               <img src="${R.signatureClient.dataUrl}" alt="signature"></div>
             <div class="btnrow" style="margin-top:8px">
               <button class="btn sm grey" id="btnSigner" data-a="signer">Refaire signer</button>
               <button class="btn sm grey" data-a="effacer-signature">Effacer</button>
             </div>`
          : `<p class="hint">En fin d'intervention : présentez le déroulé au client, puis faites-le signer directement sur l'écran.</p>
             <button class="btn wide" id="btnSigner" data-a="signer">${(ICO.signature && ICO.signature(18)) || ''} Faire signer le client</button>`}
      </div>

      <div class="card">
        <h2>Soumettre le rapport</h2>
        <p class="hint">Le rapport est mis en forme selon le canevas « ${esc((S.canevas && S.canevas.nom) || 'standard')} » : ${e.evenements.length} évènement(s), ${e.nbPhotos} photo(s), ${Report.formatDuree(e.duree) || 'durée non mesurée'}.</p>
        ${(R.langue && R.langue.active && R.langue.code)
          ? `<div class="sticky-note" style="margin-bottom:10px;background:#f0fdf4;border-color:#86efac;font-size:12px">
               🌐 <strong>Rapport bilingue actif (${esc((typeof I18N !== 'undefined' && I18N.natif) ? I18N.natif(R.langue.code) : R.langue.code.toUpperCase())})</strong> : à la soumission, l'application génère les 2 PDF (français de référence + traduit) et vous permet d'envoyer le message au Client dans sa langue et au SAV en français, avec les 2 PDF attachés.
             </div>`
          : ''}
        <button class="btn or wide" id="btnSoumettre" data-a="soumettre">${(ICO.send && ICO.send(18)) || ''} Soumettre le rapport</button>
        <div class="btnrow" style="margin-top:8px">
          <button class="btn ghost" data-a="apercu">${(ICO.eye && ICO.eye(18)) || ''} Aperçu PDF</button>
          <button class="btn grey" data-a="word">${(ICO.fileText && ICO.fileText(18)) || ''} Word</button>
        </div>
        ${(() => { const n = photosIntervention(R).filter(ph => ph.dataUrl).length; return n
          ? `<button class="btn ghost wide" style="margin-top:8px" data-a="photos-zip">${(ICO.image && ICO.image(18)) || ''} Toutes les photos (${n}) — dossier .zip</button>`
          : ''; })()}
        <p class="small" style="margin-top:8px">Destinataires : client <strong>${esc(R.client.email || 'non renseigné')}</strong> — SAV <strong>${esc(S.mail.destinataireSAV || 'non renseigné')}</strong>${S.mail.assistantSAV ? ` — Assistant SAV (CC) <strong>${esc(S.mail.assistantSAV)}</strong>` : ''}</p>
      </div>`;
  }

  function champSelect(cle, label, options) {
    let v = getPath(R, cle) || '';
    if (v && options.indexOf(v) < 0) {
      // valeur abîmée par une ancienne version (« Oui. », « oui ») : on retrouve le choix
      const net = String(v).trim().replace(/[.!\s]+$/, '').toLowerCase();
      const trouve = options.find(o => o && o.toLowerCase() === net);
      if (trouve) { v = trouve; setPath(R, cle, trouve); planifier(); }
    }
    return `<div class="field"><label>${esc(label)}</label><select data-k="${cle}">
      ${options.map(o => `<option value="${esc(o)}"${v === o ? ' selected' : ''}>${esc(o || '— choisir —')}</option>`).join('')}</select></div>`;
  }

  /* ===================== Pièces de rechange ============================ */
  function rendreTableauPieces() {
    const pcs = R.pieces || [];
    if (!pcs.length) {
      return '<p class="small" style="font-style:italic;color:var(--gris);padding:4px 0">Aucune pièce de rechange enregistrée pour cette intervention.</p>';
    }
    return `<div style="overflow-x:auto;margin:6px 0">
      <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid var(--bord);border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1.5px solid var(--bord);text-align:left;color:var(--gris)">
            <th style="padding:7px 9px;font-size:11.5px;text-transform:uppercase;width:48px;text-align:center">Photo</th>
            <th style="padding:7px 9px;font-size:11.5px;text-transform:uppercase">Dénomination</th>
            <th style="padding:7px 9px;font-size:11.5px;text-transform:uppercase">Référence</th>
            <th style="padding:7px 9px;font-size:11.5px;text-transform:uppercase">Machine (N° série)</th>
            <th style="padding:7px 9px;font-size:11.5px;text-transform:uppercase;text-align:center">Qté</th>
            <th style="padding:7px 9px;font-size:11.5px;text-transform:uppercase;text-align:right">Action</th>
          </tr>
        </thead>
        <tbody>
          ${pcs.map((p, idx) => {
            const mInfo = (typeof Report !== 'undefined' && Report.infoMachinePiece)
              ? Report.infoMachinePiece(p, R)
              : { serie: p.machineSerie || '', designation: p.machineNom || '' };
            return `
            <tr style="border-bottom:1px solid var(--bord);background:${idx % 2 === 1 ? '#fcfdff' : '#fff'}">
              <td style="padding:6px 8px;text-align:center;vertical-align:middle">
                ${p.photo
                  ? `<button type="button" data-a="voir-photo-pc" data-id="${esc(p.id)}" style="background:none;border:none;padding:0;cursor:pointer;display:inline-block;vertical-align:middle" title="Agrandir la photo">
                       <img src="${p.photo}" alt="${esc(p.denomination || 'pièce')}" style="width:38px;height:38px;object-fit:cover;border-radius:4px;border:1px solid var(--bord);display:block">
                     </button>`
                  : '<span style="color:#94a3b8;font-size:11px">—</span>'}
              </td>
              <td style="padding:7px 9px;vertical-align:middle"><strong>${esc(p.denomination || '—')}</strong></td>
              <td style="padding:7px 9px;font-family:ui-monospace,monospace;color:#475569;vertical-align:middle">${esc(p.reference || '—')}</td>
              <td style="padding:7px 9px;vertical-align:middle">
                ${mInfo.serie ? `<div style="font-weight:600;color:var(--bleu,#0369a1);font-size:12.5px"><span style="font-size:10.5px;font-weight:normal;color:#64748b">N°</span> ${esc(mInfo.serie)}</div>` : ''}
                ${mInfo.designation ? `<div style="font-size:11.5px;color:#334155">${esc(mInfo.designation)}</div>` : (!mInfo.serie ? '<span style="color:#94a3b8;font-size:11.5px">—</span>' : '')}
              </td>
              <td style="padding:7px 9px;text-align:center;vertical-align:middle"><strong>${esc(p.quantite || 1)}</strong></td>
              <td style="padding:7px 9px;text-align:right;white-space:nowrap;vertical-align:middle">
                <button type="button" class="btn sm grey" style="min-height:28px;padding:2px 7px;font-size:12px" data-a="editer-piece" data-id="${esc(p.id)}" title="Modifier">${(ICO.pen && ICO.pen(12)) || ''}</button>
                <button type="button" class="btn sm danger" style="min-height:28px;padding:2px 7px;font-size:12px;margin-left:4px" data-a="supprimer-piece" data-id="${esc(p.id)}" title="Supprimer">${(ICO.trash && ICO.trash(12)) || ''}</button>
              </td>
            </tr>
          `;}).join('')}
        </tbody>
      </table>
    </div>`;
  }

  function rendreContenuTrajet(tr) {
    if (!tr || !tr.actif) {
      return `<div style="border:1.5px dashed #cbd5e1;border-radius:8px;padding:12px;text-align:center;background:#f8fafc">
        <p class="small" style="color:#64748b;margin:0 0 10px 0">Enregistrez les horaires de déplacement aller et retour pour les intégrer au rapport.</p>
        <button type="button" class="btn sm" data-a="editer-trajet">${(ICO.mapPin && ICO.mapPin(14)) || ''} Renseigner le temps de route</button>
      </div>`;
    }
    return `<div style="background:#f8fafc;border:1px solid var(--bord);border-radius:8px;padding:12px;margin:6px 0">
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;font-size:12.5px">
        <div style="background:#fff;padding:8px 10px;border-radius:6px;border:1px solid #e2e8f0">
          <div style="color:#64748b;font-size:11px;font-weight:600">🚗 Trajet Aller</div>
          <div style="font-weight:700;color:#1e293b;font-size:13.5px;margin-top:2px">${tr.aller.texte} <small style="font-weight:normal;color:#64748b">(${tr.aller.decimale} h)</small></div>
          <div style="color:#64748b;font-size:11px">${(tr.aller.heureDepart && tr.aller.heureArrivee) ? tr.aller.heureDepart + ' → ' + tr.aller.heureArrivee : 'Durée directe'}</div>
        </div>
        <div style="background:#fff;padding:8px 10px;border-radius:6px;border:1px solid #e2e8f0">
          <div style="color:#64748b;font-size:11px;font-weight:600">⏱️ Temps sur site</div>
          <div style="font-weight:700;color:#1e293b;font-size:13.5px;margin-top:2px">${tr.surSite.texte} <small style="font-weight:normal;color:#64748b">(${tr.surSite.decimale} h)</small></div>
          <div style="color:#64748b;font-size:11px">Chrono intervention</div>
        </div>
        <div style="background:#fff;padding:8px 10px;border-radius:6px;border:1px solid #e2e8f0">
          <div style="color:#64748b;font-size:11px;font-weight:600;display:flex;justify-content:space-between">
            <span>🔄 Trajet Retour</span>
            <span class="pill" style="font-size:9.5px;padding:1px 5px;${tr.retour.estime ? 'background:#fef3c7;color:#92400e' : 'background:#dcfce7;color:#166534'}">${tr.retour.estime ? 'Estimé' : 'Réel'}</span>
          </div>
          <div style="font-weight:700;color:#1e293b;font-size:13.5px;margin-top:2px">${tr.retour.texte} <small style="font-weight:normal;color:#64748b">(${tr.retour.decimale} h)</small></div>
          <div style="color:#64748b;font-size:11px">${(tr.retour.heureDepart && tr.retour.heureArrivee) ? (tr.retour.estime ? '~' : '') + tr.retour.heureDepart + ' → ' + (tr.retour.estime ? '~' : '') + tr.retour.heureArrivee : 'Durée estimée'}</div>
        </div>
      </div>
      <div style="margin-top:10px;padding-top:8px;border-top:1px dashed #cbd5e1;display:flex;justify-content:space-between;align-items:center;font-size:13px;flex-wrap:wrap;gap:6px">
        <span style="color:#475569">Total déplacement : <strong>${tr.totalRoute.texte}</strong> (${tr.totalRoute.decimale} h)</span>
        <span style="color:var(--bfr-secondary);font-weight:800;font-size:14px">TOTAL : ${tr.totalGeneral.texte} (${tr.totalGeneral.decimale} h)</span>
      </div>
      ${tr.note ? `<div style="margin-top:6px;font-size:12px;color:#64748b;font-style:italic">Note : ${esc(tr.note)}</div>` : ''}
    </div>
    <div class="btnrow" style="margin-top:8px">
      <button type="button" class="btn sm grey" data-a="editer-trajet">${(ICO.pen && ICO.pen(13)) || ''} Modifier le trajet</button>
      ${tr.retour.estime ? `<button type="button" class="btn sm or" data-a="cloturer-retour-reel">${(ICO.checkCircle && ICO.checkCircle(13)) || ''} Confirmer le retour réel</button>` : ''}
    </div>`;
  }

  function feuillePiece(pieceExistante) {
    const edit = !!pieceExistante;
    const p = pieceExistante || { id: uid('p'), denomination: '', reference: '', quantite: 1, photo: null, machineId: '', machineSerie: '', machineNom: '' };
    let photoEnCours = p.photo || null;

    synchroniserEntites();
    const machinesDispos = (R.machines || []).filter(m => m && (m.serie || m.designation || m.modele));
    const listeM = (machinesDispos.length > 0) ? machinesDispos : (R.machines || []);

    let selId = p.machineId || '';
    if (!selId && p.machineSerie) {
      const trouv = listeM.find(m => m && m.serie === p.machineSerie);
      if (trouv) selId = trouv.id;
    }
    if (!selId && !edit && listeM.length === 1 && (listeM[0].serie || listeM[0].designation || listeM[0].modele)) {
      selId = listeM[0].id || '';
    }

    const optionsMachinesHtml = listeM.map((m, idx) => {
      const numMach = idx + 1;
      const serie = (m.serie || '').trim();
      const nom = (m.designation || '').trim();
      const mod = (m.modele || '').trim();
      let lib = '';
      if (serie && nom) {
        lib = 'N° de série : ' + serie + ' — ' + nom + (mod ? ' (' + mod + ')' : '');
      } else if (serie) {
        lib = 'N° de série : ' + serie + (mod ? ' (' + mod + ')' : '');
      } else if (nom) {
        lib = nom + (mod ? ' (' + mod + ')' : '') + ' (Machine ' + numMach + ' - sans N° de série)';
      } else {
        lib = 'Machine ' + numMach;
      }
      const isSel = (selId && (m.id === selId || m.serie === selId));
      return `<option value="${esc(m.id || ('m_' + idx))}"${isSel ? ' selected' : ''}>${esc(lib)}</option>`;
    }).join('');

    function htmlZonePhoto(dataUrl) {
      if (dataUrl) {
        return `<div style="display:flex;align-items:center;gap:12px;background:#f8fafc;padding:10px;border-radius:8px;border:1px solid var(--bord)">
          <img src="${dataUrl}" alt="Photo pièce" style="width:68px;height:68px;object-fit:cover;border-radius:6px;border:1px solid #cbd5e1;cursor:pointer" data-a="zoom-photo-pc" title="Agrandir">
          <div style="flex:1">
            <div style="font-size:12.5px;color:#1e293b;font-weight:600;margin-bottom:6px">Photo enregistrée</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" class="btn sm grey" data-a="changer-photo-pc">${(ICO.camera && ICO.camera(13)) || ''} Remplacer</button>
              <button type="button" class="btn sm danger" data-a="supprimer-photo-pc">${(ICO.trash && ICO.trash(13)) || ''} Supprimer</button>
            </div>
          </div>
        </div>`;
      }
      return `<div style="border:1.5px dashed #cbd5e1;border-radius:8px;padding:12px 10px;text-align:center;background:#f8fafc">
        <p class="small" style="color:#64748b;margin:0 0 10px 0">Prenez en photo la pièce ou son étiquette / référence.</p>
        <div class="btnrow" style="margin:0;justify-content:center;gap:8px">
          <button type="button" class="btn sm" data-a="photo-pc-cam">${(ICO.camera && ICO.camera(14)) || ''} Prendre une photo</button>
          <button type="button" class="btn sm ghost" data-a="photo-pc-gal">${(ICO.image && ICO.image(14)) || ''} Galerie</button>
        </div>
      </div>`;
    }

    const panneau = Ouvrir.ouvrir(null, `<div class="panel">
      <div class="grab"></div><h3>${edit ? 'Modifier la pièce' : 'Ajouter une pièce de rechange'}</h3>
      <p class="sub">Pièce neuve de remplacement utilisée ou laissée dans le stock du client.</p>

      <div class="field"><label>Machine concernée</label>
        <select id="pcMachine" style="width:100%;padding:9px 11px;border-radius:6px;border:1px solid var(--bord,#cbd5e1);background:#fff;font-size:0.95rem;color:#1e293b">
          <option value="">— Non rattachée / Toute l'installation —</option>
          ${optionsMachinesHtml}
        </select>
        <p class="hint" style="margin-top:4px;font-size:11.5px;color:#64748b">Identification BFR par N° de série en priorité.</p>
      </div>

      <div class="field"><label>Dénomination / désignation</label>
        <input type="text" id="pcDenom" value="${esc(p.denomination || '')}" placeholder="Ex. Roulement SKF 6205, Courroie SPZ 1250, Vérin…"></div>

      <div class="field"><label>Référence BFR / fabricant</label>
        <input type="text" id="pcRef" value="${esc(p.reference || '')}" placeholder="Ex. 734-9021-A, BFR-8820…"></div>

      <div class="field"><label>Quantité</label>
        <input type="number" id="pcQte" min="1" step="1" value="${esc(p.quantite || 1)}"></div>

      <div class="field">
        <label>Photo de la pièce / étiquette (facultatif)</label>
        <div id="pcPhotoZone">${htmlZonePhoto(photoEnCours)}</div>
        <input type="file" id="pcPhotoCam" accept="image/*" capture="environment" style="display:none">
        <input type="file" id="pcPhotoGal" accept="image/*" style="display:none">
      </div>

      <div class="btnrow"><button class="btn grey" data-a="fermer">Annuler</button>
        <button class="btn" data-a="sauvegarder-piece">${edit ? 'Enregistrer' : 'Ajouter la pièce'}</button></div></div>`, (pEl) => {
      setTimeout(() => { const el = $('#pcDenom', pEl); if (el) el.focus(); }, 80);

      const zonePhoto = $('#pcPhotoZone', pEl);
      const inputCam = $('#pcPhotoCam', pEl);
      const inputGal = $('#pcPhotoGal', pEl);

      function rafraichirPhoto() {
        if (zonePhoto) zonePhoto.innerHTML = htmlZonePhoto(photoEnCours);
      }

      async function traiterFichier(f) {
        if (!f) return;
        try {
          toast('Compression de la photo...', 1200);
          photoEnCours = await compresserImage(f, 1200, 0.82);
          rafraichirPhoto();
        } catch (_) {
          toast('Format d\'image non pris en charge');
        }
      }

      if (inputCam) inputCam.addEventListener('change', (e) => {
        traiterFichier(e.target.files && e.target.files[0]);
        inputCam.value = '';
      });
      if (inputGal) inputGal.addEventListener('change', (e) => {
        traiterFichier(e.target.files && e.target.files[0]);
        inputGal.value = '';
      });

      pEl.addEventListener('click', (e) => {
        if (e.target.closest('[data-a="photo-pc-cam"]')) {
          if (inputCam) inputCam.click();
          return;
        }
        if (e.target.closest('[data-a="photo-pc-gal"]')) {
          if (inputGal) inputGal.click();
          return;
        }
        if (e.target.closest('[data-a="changer-photo-pc"]')) {
          if (inputCam) inputCam.click();
          return;
        }
        if (e.target.closest('[data-a="supprimer-photo-pc"]')) {
          photoEnCours = null;
          rafraichirPhoto();
          return;
        }
        if (e.target.closest('[data-a="zoom-photo-pc"]')) {
          if (photoEnCours) {
            afficherVisionneusePhoto(photoEnCours, ($('#pcDenom', pEl).value || 'Pièce de rechange'), ($('#pcRef', pEl).value ? 'Réf : ' + $('#pcRef', pEl).value : ''));
          }
          return;
        }
        if (!e.target.closest('[data-a="sauvegarder-piece"]')) return;
        const denom = ($('#pcDenom', pEl).value || '').trim();
        const ref = ($('#pcRef', pEl).value || '').trim();
        const qteVal = parseInt($('#pcQte', pEl).value, 10);
        const qte = (!isNaN(qteVal) && qteVal > 0) ? qteVal : 1;
        if (!denom && !ref) {
          toast('Veuillez renseigner au moins la dénomination ou la référence');
          return;
        }

        const machEl = $('#pcMachine', pEl);
        const machIdChoisi = (machEl ? machEl.value : '') || '';
        let machSerieChoisie = '';
        let machNomChoisi = '';
        if (machIdChoisi) {
          const mObj = (R.machines || []).find(m => m && (m.id === machIdChoisi || m.serie === machIdChoisi));
          if (mObj) {
            machSerieChoisie = (mObj.serie || '').trim();
            machNomChoisi = (mObj.designation || mObj.modele || '').trim();
          }
        }

        if (edit) {
          p.denomination = denom;
          p.reference = ref;
          p.quantite = qte;
          p.photo = photoEnCours || null;
          p.machineId = machIdChoisi;
          p.machineSerie = machSerieChoisie;
          p.machineNom = machNomChoisi;
        } else {
          if (!Array.isArray(R.pieces)) R.pieces = [];
          R.pieces.push({
            id: p.id,
            denomination: denom,
            reference: ref,
            quantite: qte,
            photo: photoEnCours || null,
            machineId: machIdChoisi,
            machineSerie: machSerieChoisie,
            machineNom: machNomChoisi
          });
        }
        if (photoEnCours && typeof RapportDB !== 'undefined') {
          RapportDB.sauverPhoto('pc_' + p.id, photoEnCours, 'piece', (typeof R !== 'undefined' && R && R.id) || '');
        }
        planifier();
        rendreTout();
        pEl.closest('.sheet').remove();
        toast(edit ? 'Pièce modifiée' : 'Pièce ajoutée');
      });
    });
    return panneau;
  }

  /* ===================== Évènements =================================== */
  /* Nature proposée pour un nouvel évènement : travail en SAV, constat en audit ;
     en « SAV + audit » (ou sans type), la même que le dernier évènement saisi. */
  function natureParDefaut() {
    if (R.typeIntervention === 'sav') return 'travail';
    if (R.typeIntervention === 'audit') return 'constat';
    const dernier = (R.evenements || []).filter(x => x.domaine)
      .sort((a, b) => new Date(b.heure || 0) - new Date(a.heure || 0))[0];
    return (dernier && Report.estTravail(dernier)) ? 'travail' : 'constat';
  }

  /* Bouton « En travail / En constat » d'une carte : reclasse l'évènement. */
  function basculerNature(id) {
    const ev = (R.evenements || []).find(x => x.id === id);
    if (!ev) return;
    ev.nature = Report.estTravail(ev) ? 'constat' : 'travail';
    if (!ev.categorie) ev.categorie = 'INFO';
    planifier(); rendreTout();
    toast(ev.nature === 'travail' ? 'Classé dans les travaux réalisés' : 'Classé dans les constats');
  }

  function ajouterEvenement() {
    synchroniserEntites();
    const machinesValides = (R.machines || []).filter(m => m && (m.designation || m.modele || m.serie));
    const ev = Assistant.nouvelEvenement({
      nature: natureParDefaut(),
      machineId: (machinesValides.length === 1) ? machinesValides[0].id : '',
      machineNom: (machinesValides.length === 1) ? machinesValides[0].designation : ''
    });
    R.evenements.push(ev);
    planifier();
    Assistant.ouvrir(ev, {
      reglages: S,
      machines: machinesValides,
      toast: toast,
      onMaj: () => { planifier(); rendreTout(); },
      onSupprimer: (x) => {
        R.evenements = R.evenements.filter(e => e.id !== x.id);
        planifier(); rendreTout();
      },
      onFermer: () => {
        // un évènement vide (créé puis abandonné) est supprimé automatiquement
        const vide = !ev.domaine && !Report.valeur(ev.texte) && !(ev.photos || []).length;
        if (vide) R.evenements = R.evenements.filter(e => e.id !== ev.id);
        planifier(); rendreTout();
      }
    });
  }

  function editerEvenement(id) {
    synchroniserEntites();
    const ev = R.evenements.find(e => e.id === id);
    if (!ev) return;
    const machinesValides = (R.machines || []).filter(m => m && (m.designation || m.modele || m.serie));
    Assistant.ouvrir(ev, {
      reglages: S,
      machines: machinesValides,
      toast: toast,
      onMaj: () => { planifier(); rendreTout(); },
      onSupprimer: (x) => { R.evenements = R.evenements.filter(e => e.id !== x.id); planifier(); rendreTout(); },
      onFermer: () => { planifier(); rendreTout(); }
    });
  }

  /* ===================== Visionneuse Photo Plein Écran (Lightbox) ==== */
  function afficherVisionneusePhoto(dataUrl, titre, legende) {
    if (!dataUrl) return null;

    let zoom = 1.0;
    let tx = 0, ty = 0;
    let isDragging = false;
    let startX = 0, startY = 0;
    let lastTap = 0;

    const lb = document.createElement('div');
    lb.className = 'debrief-lightbox';
    lb.innerHTML = `
      <div class="debrief-lightbox-bar">
        <div class="debrief-lightbox-titre">${esc(titre || 'Photo')}</div>
        <div class="debrief-lightbox-actions">
          <button type="button" class="btn-lightbox" data-lb="zoom-moins" title="Dézoomer">−</button>
          <button type="button" class="btn-lightbox" data-lb="reset" title="Taille normale"><span id="lbZoomVal">100%</span></button>
          <button type="button" class="btn-lightbox" data-lb="zoom-plus" title="Zoomer">+</button>
          <button type="button" class="btn-lightbox" data-lb="fermer" style="background:#e11d48;border-color:#be123c">✕</button>
        </div>
      </div>
      <div class="debrief-lightbox-viewport" id="lbViewport">
        <img src="${dataUrl}" class="debrief-lightbox-img" id="lbImg" alt="${esc(titre || 'Photo')}">
      </div>
      ${legende ? `<div class="debrief-lightbox-legende">${esc(legende)}</div>` : ''}
    `;

    document.body.appendChild(lb);

    const img = lb.querySelector('#lbImg');
    const vp = lb.querySelector('#lbViewport');
    const lblZoom = lb.querySelector('#lbZoomVal');

    function appliquerTrans() {
      img.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + zoom + ')';
      if (lblZoom) lblZoom.textContent = Math.round(zoom * 100) + '%';
    }

    function modifierZoom(delta, reset) {
      if (reset) {
        zoom = 1.0; tx = 0; ty = 0;
      } else {
        zoom = Math.max(1.0, Math.min(4.0, zoom + delta));
        if (zoom === 1.0) { tx = 0; ty = 0; }
      }
      appliquerTrans();
    }

    lb.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-lb]');
      if (!btn) return;
      const action = btn.getAttribute('data-lb');
      if (action === 'fermer') {
        lb.remove();
      } else if (action === 'zoom-plus') {
        modifierZoom(0.5);
      } else if (action === 'zoom-moins') {
        modifierZoom(-0.5);
      } else if (action === 'reset') {
        modifierZoom(0, true);
      }
    });

    // Double-tap pour zoomer / dézoomer rapidement
    vp.addEventListener('click', (e) => {
      if (e.target.closest('.debrief-lightbox-bar')) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        if (zoom > 1.2) modifierZoom(0, true);
        else modifierZoom(1.5);
      }
      lastTap = now;
    });

    // Drag / Pan tactile et pointeur
    vp.addEventListener('pointerdown', (e) => {
      if (zoom <= 1.0) return;
      isDragging = true;
      startX = e.clientX - tx;
      startY = e.clientY - ty;
      vp.classList.add('dragging');
      vp.setPointerCapture(e.pointerId);
    });

    vp.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      tx = e.clientX - startX;
      ty = e.clientY - startY;
      appliquerTrans();
    });

    const stopperDrag = (e) => {
      if (isDragging) {
        isDragging = false;
        vp.classList.remove('dragging');
        try { vp.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    vp.addEventListener('pointerup', stopperDrag);
    vp.addEventListener('pointercancel', stopperDrag);

    return lb;
  }

  /* ===================== Aperçu Évènement / Débrief Client ============ */
  function apercuEvenement(id) {
    synchroniserEntites();
    const ev = (R.evenements || []).find(e => e.id === id);
    if (!ev) return;
    const evs = (R.evenements || []).slice().sort((a, b) => new Date(a.heure || 0) - new Date(b.heure || 0));
    const index = evs.findIndex(e => e.id === id) + 1;
    const total = evs.length;
    const cat = styleEvenement(ev), dom = domDe(ev.domaine);
    const texte = Report.valeur(ev.texte) || '';
    const photos = (ev.photos || []).filter(p => p && p.dataUrl);
    const mention = Report.mentionEvenement(ev);

    const overlay = document.createElement('div');
    overlay.className = 'assistant debrief-overlay';
    overlay.innerHTML = `
      <div class="assistant-bar">
        <button type="button" class="btn sm grey" data-a="fermer">${(ICO.close && ICO.close(16)) || ''} Fermer</button>
        <div class="assistant-titre">Aperçu Évènement ${index}/${total}</div>
        <button type="button" class="btn sm or" data-a="modifier-direct">${(ICO.pen && ICO.pen(14)) || ''} Modifier</button>
      </div>

      <div class="assistant-corps debrief-corps">
        <div class="debrief-bandeau-aide">
          <span style="font-weight:600">Mode débrief client (vue PDF)</span>
          <div class="debrief-zoom-text-controls">
            <span class="debrief-zoom-lbl">Zoom texte :</span>
            <button type="button" class="btn-zoom-t" data-zoom="small" title="Texte compact">A-</button>
            <button type="button" class="btn-zoom-t actif" data-zoom="medium" title="Grand texte">A</button>
            <button type="button" class="btn-zoom-t" data-zoom="large" title="Très grand texte">A+</button>
          </div>
        </div>

        <div class="debrief-page-papier">
          <div class="debrief-pdf-entete">
            <div class="debrief-pdf-logo">
              <img src="${window.LOGO_BFR_TOPBAR || 'uploads/logo_bfr.png'}" alt="BFR SYSTEMS">
            </div>
            <div class="debrief-pdf-meta">
              <div class="debrief-pdf-num">Compte rendu N° <strong>${esc(R.numero || '—')}</strong></div>
              <div class="debrief-pdf-client">${esc(R.client.nom || 'Client non renseigné')}${R.client.lieu ? ' (' + esc(R.client.lieu) + ')' : ''}</div>
              <div class="debrief-pdf-machine">${esc(R.machine.designation || 'Machine')}${R.machine.serie ? ' — N° ' + esc(R.machine.serie) : ''}</div>
            </div>
          </div>

          <div class="debrief-ev-bandeau" style="--c:${cat.couleur};--f:${cat.fond}">
            <div class="debrief-ev-dom">${(ICO.domaine && ICO.domaine(dom.id || dom.icone, 16)) || ''} ${esc(dom.libelle)}${ev.machineNom ? ' — [' + esc(ev.machineNom) + ']' : ''}</div>
            <div class="debrief-ev-heure">${esc(Report.heureFr(ev.heure))}</div>
            <div class="debrief-ev-cat">${esc(cat.libelle).toUpperCase()}</div>
          </div>

          <div class="debrief-commentaire-zone font-medium" id="debriefTexteBox">
            <div class="debrief-comm-label">${Report.estTravail(ev) ? 'Travail réalisé :' : 'Constat :'}</div>
            <div class="debrief-comm-contenu">${texte ? esc(texte).replace(/\n/g, '<br>') : '<em style="color:#94a3b8">Aucune annotation rédigée pour cet évènement.</em>'}</div>
            ${mention ? `<div style="margin-top:10px;font-weight:700;color:${mention.couleur}">${Report.estTravail(ev) ? '' : '✓ '}${esc(mention.texte)}</div>` : ''}
          </div>

          <div class="debrief-photos-section">
            <div class="debrief-photos-header">
              <div class="debrief-photos-titre">${(ICO.image && ICO.image(16)) || ''} Photos de l'évènement (${photos.length})</div>
              ${photos.length ? `<span class="debrief-photos-hint">🔍 Toucher pour zoomer en plein écran</span>` : ''}
            </div>

            ${photos.length ? `
              <div class="debrief-photos-grille">
                ${photos.map((ph, idx) => `
                  <div class="debrief-photo-item" data-photo-idx="${idx}">
                    <div class="debrief-photo-cadre">
                      <img src="${ph.dataUrl}" alt="Photo ${idx + 1}" loading="lazy">
                      <div class="debrief-photo-loupe">🔍 Zoomer</div>
                    </div>
                    ${ph.legende ? `<div class="debrief-photo-legende">${esc(ph.legende)}</div>` : ''}
                  </div>
                `).join('')}
              </div>
            ` : `
              <div class="debrief-photos-vide">
                <span style="opacity:0.6">${(ICO.camera && ICO.camera(28)) || ''}</span>
                <p>Aucune photo prise pour cet évènement.</p>
              </div>
            `}
          </div>
        </div>

        <div class="btnrow" style="margin-top:16px;padding-bottom:16px">
          <button type="button" class="btn grey" data-a="fermer">Fermer l'aperçu</button>
          <button type="button" class="btn or" data-a="modifier-direct">${(ICO.pen && ICO.pen(14)) || ''} Modifier l'évènement</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Zoom interactif du texte des commentaires
    const texteBox = overlay.querySelector('#debriefTexteBox');
    const zoomBtns = overlay.querySelectorAll('.btn-zoom-t');
    zoomBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        zoomBtns.forEach(b => b.classList.remove('actif'));
        btn.classList.add('actif');
        const z = btn.getAttribute('data-zoom');
        texteBox.className = 'debrief-commentaire-zone font-' + z;
      });
    });

    // Clics boutons dans l'aperçu
    overlay.addEventListener('click', (evClick) => {
      const bFermer = evClick.target.closest('[data-a="fermer"]');
      if (bFermer) {
        overlay.remove();
        return;
      }
      const bModifier = evClick.target.closest('[data-a="modifier-direct"]');
      if (bModifier) {
        overlay.remove();
        editerEvenement(id);
        return;
      }
      const itemPhoto = evClick.target.closest('[data-photo-idx]');
      if (itemPhoto) {
        const pIdx = parseInt(itemPhoto.getAttribute('data-photo-idx'), 10);
        ouvrirVisionneusePhoto(pIdx);
      }
    });

    // Visionneuse photo interactive Lightbox avec zoom fluide et pan tactile
    function ouvrirVisionneusePhoto(photoIdx) {
      const ph = photos[photoIdx];
      if (!ph) return;
      afficherVisionneusePhoto(ph.dataUrl, `Photo ${photoIdx + 1} / ${photos.length}`, ph.legende);
    }
  }

  /* ===================== Client & machine ============================= */
  function feuilleClient() {
    synchroniserEntites();
    const f = (k, label, opt) => {
      opt = opt || {};
      const val = getPath(R, k) || '';
      return `<div class="field"><label>${esc(label)}</label><input type="${opt.type || 'text'}" data-fk="${k}" value="${esc(val)}" placeholder="${esc(opt.ph || '')}"${opt.list ? ' data-sugg="' + opt.list + '" autocomplete="off"' : ''}></div>`;
    };
    const histo = Store.get(K.rapports, []);
    const nbClients = Clients.liste().length;
    const techsBFR = (Clients.listeTechniciens ? Clients.listeTechniciens() : (window.TECHNICIENS_BFR || [])).map(t => t.nom);
    /* Propositions des champs Lieu, Machine et Collègue. Elles remplacent les listes
       <datalist> du navigateur : leur menu natif s'affichait en noir (mode sombre du
       téléphone ou de Windows) et ne pouvait pas prendre les couleurs de l'appli. */
    const uniques = (arr) => [...new Set((arr || []).map(v => String(v || '').trim()).filter(Boolean))];
    const SOURCES_SUGG = {
      dlLieux: uniques(histo.map(r => r.client && r.client.lieu)).reverse(),            // les plus récents d'abord
      dlMachines: uniques(histo.map(r => r.machine && r.machine.designation)).reverse(),
      dlTechsBFR: uniques(techsBFR)
    };

    const ouvrir = (e) => Ouvrir.ouvrir(e, `<div class="panel">
      <div class="grab"></div><h3>Client & machine</h3>
      <p class="sub">Ces informations figurent en tête du rapport.</p>
      <div class="card"><h2>Client</h2>
        <div class="field"><label>Client</label>
          <input type="text" id="cliRecherche" autocomplete="off" value="${esc(R.client.nom || '')}"
                 placeholder="${nbClients ? 'Tapez 3 lettres (ex. ENT, CFR, LAC…)' : 'Tapez 3 lettres du nom du client'}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
            <p class="small" style="margin:0">${nbClients
              ? 'Liste BFR : ' + nbClients + " client(s) — suggestions dès la 3<sup>e</sup> lettre."
              : 'Aucune liste clients dans cette version : importez-la dans Menu → Réglages.'}</p>
            <button type="button" class="btn ghost sm" data-a="vers-annuaire" style="font-size:11px;padding:2px 8px;flex-shrink:0">${(ICO.users && ICO.users(12)) || ''} Annuaire complet</button>
          </div>
          <div class="suggestions" id="cliSug" hidden></div>
        </div>
        <div class="grid2">${f('client.contact', 'Contact sur site (nom)', { ph: 'Ex. M. Rivière' })}${f('client.fonction', 'Fonction', { ph: 'Ex. Responsable maintenance' })}</div>
        <div class="grid2">${f('client.tel', 'Téléphone du client', { type: 'tel', ph: 'Ex. 04 78 55 44 33' })}${f('client.email', 'E-mail du client', { type: 'email', ph: 'Ex. contact@client.fr' })}</div>
        <div style="display:flex;justify-content:flex-end;margin-top:-6px;margin-bottom:8px">
          <button type="button" class="btn ghost sm" data-a="sms-arrivee" style="font-size:11.5px;padding:2px 8px;display:flex;align-items:center;gap:4px;color:#0284c7">
            ${icoContact(13)} ${contactArriveeAppel() ? 'Appeler le contact' : 'Prévenir le contact par SMS'}
          </button>
        </div>
        ${f('client.adresse', 'Adresse du client', { ph: 'Rue, code postal, ville' })}
        ${f('client.lieu', "Lieu d'intervention", { list: 'dlLieux', ph: "Ex. Atelier 2 — ligne 4" })}
        <div class="filebtn" style="margin-top:8px"><input type="file" id="logoClient" accept="image/*">
          <label for="logoClient">${(ICO.image && ICO.image(16)) || ''} ${R.client.logo ? 'Changer le logo du client' : 'Ajouter le logo du client (facultatif)'}</label></div>
        <div id="zoneApercuLogoClient">
          ${R.client.logo ? '<img src="' + R.client.logo + '" style="max-height:52px;margin-top:8px;background:#fff;border:1px solid var(--bord);border-radius:6px">'
                          : '<p class="small">Sans logo, la place reste vide dans le compte rendu.</p>'}
        </div>
      </div>
      <div class="card" id="cardMachines">
        <h2>${(R.machines && R.machines.length > 1) ? 'Machines visitées' : 'Machine'}</h2>
        <div id="listeMachinesForm">
          <div class="machine-item" data-mach-idx="0">
            ${(R.machines && R.machines.length > 1) ? '<div style="font-weight:600;font-size:0.9rem;margin-bottom:6px;color:var(--bleu,#0369a1)">Machine 1 (principale)</div>' : ''}
            ${f('machine.designation', 'Machine / équipement', { list: 'dlMachines', ph: 'Ex. Presse hydraulique 120 T' })}
            <div class="grid2">${f('machine.modele', 'Modèle', { ph: 'Ex. PH-120/4D' })}${f('machine.serie', 'N° de série', { ph: 'Ex. PH1204D-2011-0387' })}</div>
          </div>
          <div id="zoneMachinesSub">
            ${(R.machines || []).slice(1).map((m, idx) => `
              <div class="machine-item" data-mach-idx="${idx + 1}" style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--bord,#cbd5e1)">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                  <span style="font-weight:600;font-size:0.9rem;color:var(--bleu,#0369a1)">Machine ${idx + 2}</span>
                  <button type="button" class="btn sm danger" data-rm-machine="${idx + 1}" style="padding:2px 8px;font-size:0.8rem">${(ICO.trash && ICO.trash(12)) || ''} Retirer</button>
                </div>
                <div class="field"><label>Machine / équipement</label>
                  <input type="text" data-m-k="designation" data-m-i="${idx + 1}" value="${esc(m.designation || '')}" placeholder="Ex. Ensacheuse, Convoyeur..." data-sugg="dlMachines" autocomplete="off"></div>
                <div class="grid2">
                  <div class="field"><label>Modèle</label><input type="text" data-m-k="modele" data-m-i="${idx + 1}" value="${esc(m.modele || '')}" placeholder="Ex. FP-400"></div>
                  <div class="field"><label>N° de série</label><input type="text" data-m-k="serie" data-m-i="${idx + 1}" value="${esc(m.serie || '')}" placeholder="Ex. FP400-2020-001"></div>
                </div>
              </div>`).join('')}
          </div>
        </div>
        <button type="button" class="btn sm grey" id="btnAjouterMachine" style="margin-top:10px">+ Ajouter une autre machine</button>
        <p class="small" style="margin-top:8px">Marque, compteur et n° de parc ne sont plus demandés : nos machines et notre marque sont connues.</p>
      </div>
      <div class="card"><h2>Langue du client</h2>
        <div class="agreement"><input type="checkbox" id="langActive" ${R.langue.active ? 'checked' : ''}>
          <label for="langActive">Traduire le rapport dans la langue du client</label></div>
        <div class="field" id="langChoix" ${R.langue.active ? '' : 'hidden'}>
          <label>Langue du rapport envoyé au client</label>
          <select id="langCode">
            ${I18N.langues.map(l => `<option value="${l.code}" ${R.langue.code === l.code ? 'selected' : ''}>${l.nom} — ${l.natif}</option>`).join('')}
          </select>
        </div>
        <div class="btnrow" id="langPretBloc" ${R.langue.active ? '' : 'hidden'}>
          <button class="btn grey" type="button" id="langPret">Préparer la langue sur ce téléphone</button>
        </div>
        <p class="small" id="langResume">${texteLangue(R)}</p>
        <p class="small" id="langEtat">${texteEtatTraduction()}</p>
      </div>
      <div class="card"><h2>Intervention</h2>
        <div class="grid2">${f('numero', 'N° de rapport')}<div class="field"><label>Date</label><input type="date" data-fk="date" value="${esc(R.date)}"></div></div>
        ${f('technicien', 'Technicien principal (signataire)', { ph: Report.nomComplet(S.technicien) })}
        ${Report.contactTech(S.technicien) ? '<p class="small">Vos coordonnées (' + esc(Report.contactTech(S.technicien)) + ') apparaissent dans les blocs de signature — modifiables dans Menu → Mes informations.</p>' : ''}
        <div id="listeColleguesForm" style="margin-top:12px">
          <label style="font-size:0.85rem;font-weight:600;color:var(--texte-doux,#475569);display:block;margin-bottom:6px">Collègue(s) / Technicien(s) sur site</label>
          <div id="zoneColleguesSub">
            ${(R.techniciens || []).slice(1).map((t, idx) => `
              <div class="collegue-item" data-col-idx="${idx + 1}" style="padding:10px;background:var(--fond,#f8fafc);border:1px solid var(--bord,#e2e8f0);border-radius:6px;margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                  <span style="font-size:0.85rem;font-weight:600">Collègue ${idx + 1}</span>
                  <button type="button" class="btn sm danger" data-rm-technicien="${idx + 1}" style="padding:2px 8px;font-size:0.8rem">${(ICO.trash && ICO.trash(12)) || ''} Retirer</button>
                </div>
                <div class="field" style="margin-bottom:6px"><label>Nom du collègue</label>
                  <input type="text" data-t-k="nom" data-t-i="${idx + 1}" value="${esc(t.nom || '')}" placeholder="Ex. Thomas BERNARD" data-sugg="dlTechsBFR" autocomplete="off"></div>
                <div class="field"><label>Fonction / Spécialité</label>
                  <input type="text" data-t-k="fonction" data-t-i="${idx + 1}" value="${esc(t.fonction || 'Technicien SAV')}" placeholder="Ex. Automaticien, Mécanicien..."></div>
              </div>`).join('')}
          </div>
          <button type="button" class="btn sm grey" id="btnAjouterTechnicien">+ Ajouter un collègue sur site</button>
        </div>
        <div class="field"><label>Type d'intervention</label>
          <select data-fk="typeIntervention">
            ${R.typeIntervention ? '' : '<option value="" selected>Non précisé (plan standard)</option>'}
            ${Object.keys(Report.TYPES_INTERVENTION).map(k => `<option value="${k}"${R.typeIntervention === k ? ' selected' : ''}>${esc(Report.TYPES_INTERVENTION[k].libelle)}</option>`).join('')}
          </select></div>
        <p class="small">Il donne le titre du rapport et l'ordre des parties : <strong>SAV</strong> → travaux réalisés d'abord ;
          <strong>Audit</strong> → constats par priorité d'abord ; <strong>SAV + audit</strong> → une partie travaux puis une partie constats.</p>
        ${f('objet', 'Objet / demande du client', { ph: 'Ex. Audit mécanique suite à des bruits anormaux' })}
      </div>
      <div class="btnrow"><button class="btn grey" data-a="fermer">Fermer</button>
        <button class="btn" data-a="ok">Valider</button></div>
    </div>`, (panneau) => {
      /* ---------- Propositions sous les champs Lieu / Machine / Collègue ---------- */
      const sansAccent = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const boiteSugg = (champ) => {
        let b = champ.nextElementSibling;
        if (!b || !b.classList.contains('sugg-champ')) {
          b = document.createElement('div');
          b.className = 'suggestions sugg-champ';
          b.hidden = true;
          champ.insertAdjacentElement('afterend', b);
        }
        return b;
      };
      const fermerSugg = (champ) => { const b = boiteSugg(champ); b.hidden = true; b.innerHTML = ''; };
      const majSugg = (champ) => {
        const q = sansAccent(champ.value.trim());
        const liste = (SOURCES_SUGG[champ.dataset.sugg] || [])
          .filter(v => (!q || sansAccent(v).indexOf(q) >= 0) && v !== champ.value.trim())
          .slice(0, 8);
        const b = boiteSugg(champ);
        if (!liste.length) { fermerSugg(champ); return; }
        b.hidden = false;
        b.innerHTML = liste.map(v => `<button type="button" class="suggestion" data-sugg-val="${esc(v)}"><span class="sug-nom">${esc(v)}</span></button>`).join('');
      };
      panneau.addEventListener('focusin', (e) => { if (e.target.matches && e.target.matches('input[data-sugg]')) majSugg(e.target); });
      panneau.addEventListener('input', (e) => { if (e.target.matches && e.target.matches('input[data-sugg]') && e.isTrusted) majSugg(e.target); });
      panneau.addEventListener('focusout', (e) => {
        if (!(e.target.matches && e.target.matches('input[data-sugg]'))) return;
        const champ = e.target;
        setTimeout(() => { if (document.activeElement !== champ) fermerSugg(champ); }, 250);
      });
      // le champ garde le focus (et le clavier reste ouvert) pendant qu'on touche une proposition
      panneau.addEventListener('mousedown', (e) => { if (e.target.closest('[data-sugg-val]')) e.preventDefault(); });
      panneau.addEventListener('click', (e) => {
        const s = e.target.closest('[data-sugg-val]');
        if (!s) return;
        const b = s.closest('.sugg-champ'), champ = b && b.previousElementSibling;
        if (!champ) return;
        champ.value = s.dataset.suggVal;
        fermerSugg(champ);
        champ.dispatchEvent(new Event('input', { bubbles: true }));   // enregistrement comme une saisie
      });

      $$('[data-fk]', panneau).forEach(el => {
        el.addEventListener('input', () => {
          setPath(R, el.dataset.fk, el.value);
          if (el.dataset.fk === 'numero') R.numeroAuto = false;   // numéro choisi à la main : on n'y touche plus
          planifier(); rendreEntete(); rendreTout();
        });
      });

      function rafraichirMachinesSub() {
        const zone = $('#zoneMachinesSub', panneau);
        if (!zone) return;
        zone.innerHTML = (R.machines || []).slice(1).map((m, idx) => `
          <div class="machine-item" data-mach-idx="${idx + 1}" style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--bord,#cbd5e1)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-weight:600;font-size:0.9rem;color:var(--bleu,#0369a1)">Machine ${idx + 2}</span>
              <button type="button" class="btn sm danger" data-rm-machine="${idx + 1}" style="padding:2px 8px;font-size:0.8rem">${(ICO.trash && ICO.trash(12)) || ''} Retirer</button>
            </div>
            <div class="field"><label>Machine / équipement</label>
              <input type="text" data-m-k="designation" data-m-i="${idx + 1}" value="${esc(m.designation || '')}" placeholder="Ex. Ensacheuse, Convoyeur..." data-sugg="dlMachines" autocomplete="off"></div>
            <div class="grid2">
              <div class="field"><label>Modèle</label><input type="text" data-m-k="modele" data-m-i="${idx + 1}" value="${esc(m.modele || '')}" placeholder="Ex. FP-400"></div>
              <div class="field"><label>N° de série</label><input type="text" data-m-k="serie" data-m-i="${idx + 1}" value="${esc(m.serie || '')}" placeholder="Ex. FP400-2020-001"></div>
            </div>
          </div>`).join('');
      }

      function rafraichirColleguesSub() {
        const zone = $('#zoneColleguesSub', panneau);
        if (!zone) return;
        zone.innerHTML = (R.techniciens || []).slice(1).map((t, idx) => `
          <div class="collegue-item" data-col-idx="${idx + 1}" style="padding:10px;background:var(--fond,#f8fafc);border:1px solid var(--bord,#e2e8f0);border-radius:6px;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:0.85rem;font-weight:600">Collègue ${idx + 1}</span>
              <button type="button" class="btn sm danger" data-rm-technicien="${idx + 1}" style="padding:2px 8px;font-size:0.8rem">${(ICO.trash && ICO.trash(12)) || ''} Retirer</button>
            </div>
            <div class="field" style="margin-bottom:6px"><label>Nom du collègue</label>
              <input type="text" data-t-k="nom" data-t-i="${idx + 1}" value="${esc(t.nom || '')}" placeholder="Ex. Thomas BERNARD" data-sugg="dlTechsBFR" autocomplete="off"></div>
            <div class="field"><label>Fonction / Spécialité</label>
              <input type="text" data-t-k="fonction" data-t-i="${idx + 1}" value="${esc(t.fonction || 'Technicien SAV')}" placeholder="Ex. Automaticien, Mécanicien..."></div>
          </div>`).join('');
      }

      panneau.addEventListener('input', (ev) => {
        const mk = ev.target.dataset.mK, mi = ev.target.dataset.mI;
        if (mk && mi !== undefined) {
          const idx = parseInt(mi, 10);
          if (R.machines && R.machines[idx]) {
            R.machines[idx][mk] = ev.target.value;
            planifier(); rendreEntete();
          }
        }
        const tk = ev.target.dataset.tK, ti = ev.target.dataset.tI;
        if (tk && ti !== undefined) {
          const idx = parseInt(ti, 10);
          if (R.techniciens && R.techniciens[idx]) {
            R.techniciens[idx][tk] = ev.target.value;
            planifier(); rendreEntete();
          }
        }
      });

      panneau.addEventListener('click', (ev) => {
        const btnM = ev.target.closest('#btnAjouterMachine');
        if (btnM) {
          if (!Array.isArray(R.machines)) R.machines = [];
          R.machines.push({ id: uid('m'), designation: '', modele: '', serie: '' });
          planifier(); rendreEntete();
          rafraichirMachinesSub();
          return;
        }
        const rmM = ev.target.closest('[data-rm-machine]');
        if (rmM) {
          const idx = parseInt(rmM.dataset.rmMachine, 10);
          if (R.machines && R.machines.length > idx) {
            R.machines.splice(idx, 1);
            planifier(); rendreEntete();
            rafraichirMachinesSub();
          }
          return;
        }
        const btnT = ev.target.closest('#btnAjouterTechnicien');
        if (btnT) {
          if (!Array.isArray(R.techniciens)) R.techniciens = [];
          R.techniciens.push({ id: uid('t'), nom: '', fonction: 'Technicien SAV', principal: false });
          planifier(); rendreEntete();
          rafraichirColleguesSub();
          return;
        }
        const rmT = ev.target.closest('[data-rm-technicien]');
        if (rmT) {
          const idx = parseInt(rmT.dataset.rmTechnicien, 10);
          if (R.techniciens && R.techniciens.length > idx) {
            R.techniciens.splice(idx, 1);
            planifier(); rendreEntete();
            rafraichirColleguesSub();
          }
          return;
        }
        if (ev.target.closest('[data-a="ok"], [data-a="fermer"]')) Clients.retenir(R.client);
      });

      /* ---------- Rapport bilingue (langue du client) ------------------- */
      const caseLangue = $('#langActive', panneau);
      const selLangue = $('#langCode', panneau);

      function majLangue() {
        R.langue.active = !!(caseLangue && caseLangue.checked);
        if (R.langue.active && !R.langue.code) {
          R.langue.code = R.client.langue || (I18N.langues[0] && I18N.langues[0].code) || 'en';
        }
        if (!R.langue.active) R.langue.code = R.langue.code || R.client.langue || 'en';
        if (selLangue) selLangue.value = R.langue.code;
        const choix = $('#langChoix', panneau);
        if (choix) choix.hidden = !R.langue.active;
        const blocPret = $('#langPretBloc', panneau);
        if (blocPret) blocPret.hidden = !R.langue.active;
        const zoneEtat = $('#langEtat', panneau);
        const btn = $('#langPret', panneau);
        if (zoneEtat && (!btn || !btn.disabled)) zoneEtat.textContent = texteEtatTraduction();
        const resume = $('#langResume', panneau);
        if (resume) resume.textContent = texteLangue(R);
        if (R.langue.active) {
          R.client.langue = R.langue.code;      // retenu pour ce client
          if (R.client.nom) Clients.retenir(R.client);
        }
        Cache.pdf = Cache.docx = null; Cache.clePdf = Cache.cleDocx = '';
        planifier(); rendreEntete(); rendreTout();
      }
      if (caseLangue) caseLangue.addEventListener('change', majLangue);
      if (selLangue) selLangue.addEventListener('change', () => { R.langue.code = selLangue.value; majLangue(); });

      /* Téléchargement de la langue, à faire une fois (au bureau ou en Wi-Fi)
         pour que la traduction fonctionne ensuite même sans réseau. */
      const btnPret = $('#langPret', panneau);
      if (btnPret) btnPret.addEventListener('click', async () => {
        const zone = $('#langEtat', panneau);
        const dire = (t) => { if (zone) zone.textContent = t; };
        const l = I18N.langue(R.langue.code);
        const nom = l ? l.natif : R.langue.code;
        if (!Traduction.utilisable()) { dire(texteEtatTraduction()); return; }
        btnPret.disabled = true;
        dire('Préparation de la langue ' + nom + '…');
        let res;
        try {
          res = await Traduction.pret(R.langue.code, (e) => {
            if (e && e.etape === 'telechargement') {
              dire('Téléchargement de la langue ' + nom + ' : ' + e.pct + ' % (une seule fois, avec du réseau).');
            }
          });
        } catch (e) { res = { ok: false, motif: 'refus' }; }
        btnPret.disabled = false;
        if (res.ok) {
          dire('Langue ' + nom + ' prête sur ce téléphone : la traduction fonctionnera même sans réseau.');
        } else if (res.motif === 'modele') {
          dire('Téléchargement impossible : ce téléphone n\'a pas de réseau pour le moment. À refaire une fois connecté (bureau, Wi-Fi de l\'atelier) — le rapport reste envoyable en attendant.');
        } else if (res.motif === 'refus') {
          dire("La langue " + nom + " n'est pas disponible sur ce téléphone : les libellés du rapport seront traduits, les commentaires resteront en français.");
        } else {
          dire(texteEtatTraduction());
        }
      });
      /* Toute correction saisie ici (téléphone, e-mail, contact, logo) est
         mémorisée pour les prochaines interventions chez ce client. */
      panneau.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-a="vers-annuaire"]')) {
          panneau.closest('.sheet').remove();
          feuilleAnnuaireClients();
          return;
        }
        if (ev.target.closest('[data-a="sms-arrivee"]')) {
          feuilleSMSArrivee();
          return;
        }
        if (ev.target.closest('[data-a="ok"], [data-a="fermer"]')) Clients.retenir(R.client);
      });

      /* ---------- Autocomplétion de la liste clients ---------- */
      const champ = $('#cliRecherche', panneau);
      const boite = $('#cliSug', panneau);
      let dernier = '', propositions = [];

      function fermerSuggestions() { boite.hidden = true; boite.innerHTML = ''; propositions = []; }

      function afficherSuggestions() {
        const q = champ.value.trim();
        if (q.length < 3) { fermerSuggestions(); return; }
        propositions = Clients.chercher(q, 12);   // plusieurs contacts par client possibles
        if (!propositions.length) { fermerSuggestions(); return; }
        boite.hidden = false;
        boite.innerHTML = propositions.map((c, i) => `<button type="button" class="suggestion" data-i="${i}">
            <span class="sug-nom">${esc(c.nom)}</span>
            <span class="sug-detail">${esc([c.ville, c.contact ? c.contact + (c.fonction ? ' (' + c.fonction + ')' : '') : '', c.tel].filter(Boolean).join(' · ')) || '—'}</span>
          </button>`).join('');
      }

      /* Choix d'un client : réinitialisation propre et complète avec les données
         du client sélectionné (évite de conserver les coordonnées de l'ancien client). */
      function choisirClient(c) {
        R.client.nom = c.nom;
        R.client.reference = c.reference || '';
        R.client.adresse = c.adresse || '';
        R.client.lieu = c.ville || '';
        R.client.contact = c.contact || '';
        R.client.fonction = c.fonction || '';
        R.client.tel = c.tel || '';
        R.client.email = c.email || '';
        R.client.logo = c.logo || '';
        R.client.numeroClient = c.numeroClient || '';
        R.client.noteContacts = c.autresContacts || '';
        R.client.langue = c.langue || '';
        /* Langue déjà utilisée chez ce client : proposée d'office (l'option
           reste à cocher par le technicien, elle n'est jamais activée seule). */
        if (c.langue) {
          R.langue.code = c.langue;
          const sel = $('#langCode', panneau);
          if (sel) sel.value = c.langue;
          const resume = $('#langResume', panneau);
          if (resume) resume.textContent = texteLangue(R);
        }
        planifier();
        champ.value = c.nom;
        $$('[data-fk]', panneau).forEach(el => { el.value = getPath(R, el.dataset.fk) || ''; });
        const zoneLogo = $('#zoneApercuLogoClient', panneau);
        if (zoneLogo) {
          zoneLogo.innerHTML = c.logo
            ? `<img src="${c.logo}" style="max-height:52px;margin-top:8px;background:#fff;border:1px solid var(--bord);border-radius:6px">`
            : '<p class="small">Sans logo, la place reste vide dans le compte rendu.</p>';
        }
        const lblLogo = $('label[for="logoClient"]', panneau);
        if (lblLogo) {
          lblLogo.innerHTML = ((ICO.image && ICO.image(16)) || '') + ' ' + (c.logo ? 'Changer le logo du client' : 'Ajouter le logo du client (facultatif)');
        }
        fermerSuggestions();
        rendreEntete(); rendreTout();
        const manque = [];
        if (!c.tel) manque.push('téléphone');
        if (!c.contact) manque.push('contact');
        if (!c.email) manque.push('e-mail');
        toast(manque.length ? 'Client ' + c.nom + ' — à compléter : ' + manque.join(', ')
                            : 'Client ' + c.nom, 3200);
      }

      champ.addEventListener('input', afficherSuggestions);
      champ.addEventListener('focus', afficherSuggestions);
      champ.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') fermerSuggestions();
        if (ev.key === 'Enter' && propositions.length) { ev.preventDefault(); choisirClient(propositions[0]); }
      });
      boite.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-i]');
        if (b) choisirClient(propositions[+b.dataset.i]);
      });
      /* Un nom tapé à la main doit aussi être pris en compte tout de suite. */
      champ.addEventListener('change', () => { setPath(R, 'client.nom', champ.value.trim()); planifier(); rendreEntete(); });

      $('#logoClient', panneau).addEventListener('change', async (ev) => {
        if (!ev.target.files[0]) return;
        try {
          R.client.logo = await compresserImage(ev.target.files[0], 520, 0.92);
          const zoneLogo = $('#zoneApercuLogoClient', panneau);
          if (zoneLogo) {
            zoneLogo.innerHTML = '<img src="' + R.client.logo + '" style="max-height:52px;margin-top:8px;background:#fff;border:1px solid var(--bord);border-radius:6px">';
          }
          const lblLogo = $('label[for="logoClient"]', panneau);
          if (lblLogo) {
            lblLogo.innerHTML = ((ICO.image && ICO.image(16)) || '') + ' Changer le logo du client';
          }
          planifier(); toast('Logo du client enregistré');
        } catch (err) { toast('Image illisible'); }
      });
    });
    ouvrir();
  }

  const Ouvrir = {
    ouvrir: function (e, html, branche) {
      /* Une seule feuille à l'écran : un double appui ne doit pas superposer
         deux panneaux (le second resterait inerte). */
      document.querySelectorAll('.sheet').forEach((x) => x.remove());
      const overlay = document.createElement('div');
      overlay.className = 'sheet open';
      overlay.innerHTML = html;
      document.body.appendChild(overlay);
      const panneau = $('.panel', overlay);
      if (branche) branche(panneau);
      overlay.addEventListener('click', ev => {
        const b = ev.target.closest('[data-a]');
        if (ev.target === overlay || (b && (b.dataset.a === 'fermer' || b.dataset.a === 'ok'))) {
          overlay.remove();
          rendreTout();
        }
      });
      return panneau;
    }
  };

  /* ===================== Signature ==================================== */
  function signerClient() {
    const overlay = document.createElement('div');
    overlay.className = 'assistant';
    overlay.innerHTML = `
      <div class="assistant-bar">
        <button type="button" class="iconbtn" data-a="fermer">${(ICO.close && ICO.close(20)) || '✕'}</button>
        <div class="assistant-titre">Signature du client</div>
        <button type="button" class="btn sm" data-a="valider">Valider</button>
      </div>
      <div class="sig-client-corps">
        <div class="grid2">
          <div class="field"><label>Nom du signataire</label><input id="sigNom" value="${esc(R.signatureClient.nom || R.client.contact || '')}"></div>
          <div class="field"><label>Fonction</label><input id="sigFonction" value="${esc(R.signatureClient.fonction || R.client.fonction || '')}"></div>
        </div>
        <div class="agreement"><input type="checkbox" id="sigAccord">
          <label for="sigAccord">${esc(S.impression.mentionClient)}</label></div>
        <div class="sigwrap" style="background:#ffffff !important; background-color:#ffffff !important; color-scheme:light !important;">
          <canvas id="sigCanvas" style="background:#ffffff !important; background-color:#ffffff !important; color-scheme:light !important; touch-action:none;"></canvas>
          <div class="ph" id="sigPh" style="color:#64748b; font-weight:600;">${(ICO.signature && ICO.signature(18)) || ''} Le client signe ici, du doigt</div>
        </div>
        <div class="btnrow" style="margin-top:8px">
          <button class="btn grey" data-a="effacer">Effacer</button>
          <button class="btn grey" data-a="horodater">Horodater</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const canvas = $('#sigCanvas', overlay);
    const pad = new Pad(canvas, (aEncre) => {
      overlay.querySelector('#sigPh').style.display = aEncre ? 'none' : 'grid';
      overlay.querySelector('.sigwrap').classList.toggle('signed', aEncre);
    });
    if (R.signatureClient.dataUrl) pad.load(R.signatureClient.dataUrl);
    if (R.signatureClient.dataUrl) $('#sigAccord', overlay).checked = true;

    overlay.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'fermer') { overlay.remove(); }
      else if (b.dataset.a === 'effacer') pad.clear();
      else if (b.dataset.a === 'horodater') toast('Horodatage : ' + new Date().toLocaleString('fr-FR'));
      else if (b.dataset.a === 'valider') {
        if (!pad.hasInk) { toast('La signature est vide'); return; }
        R.signatureClient.dataUrl = pad.dataUrl();
        R.signatureClient.nom = $('#sigNom', overlay).value;
        R.signatureClient.fonction = $('#sigFonction', overlay).value;
        R.signatureClient.date = todayISO();
        R.signatureClient.heure = new Date().toTimeString().slice(0, 5);
        R.signatureClient.accord = $('#sigAccord', overlay).checked;
        R.statut = 'signé';
        if (!R.chrono.fin) { /* la signature peut précéder la fin du chrono */ }
        overlay.remove(); planifier(); rendreTout();
        toast('Signature enregistrée');
      }
    });
  }

  class Pad {
    constructor(canvas, onChange) {
      this.canvas = canvas;
      this.onChange = onChange;
      this.drawing = false;
      this.hasInk = false;
      this.points = [];
      this.couleurEncre = '#0f172a'; // Bleu-nuit / noir d'encre stylo très foncé et net
      this.ctx = canvas.getContext('2d');
      this.resize();
      window.addEventListener('resize', () => this.resize(true));

      canvas.addEventListener('pointerdown', (e) => this.down(e));
      canvas.addEventListener('pointermove', (e) => this.move(e));
      canvas.addEventListener('pointerup', (e) => this.up(e));
      canvas.addEventListener('pointercancel', (e) => this.up(e));
      canvas.addEventListener('pointerleave', (e) => this.up(e));

      // Empêche le défilement tactile ou le geste de recul pendant la signature
      canvas.addEventListener('touchstart', (e) => { e.preventDefault(); }, { passive: false });
      canvas.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
    }

    remplirFondBlanc() {
      if (!this.ctx) return;
      this.ctx.save();
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.restore();
    }

    appliquerStyle() {
      if (!this.ctx) return;
      const dpr = this.dpr || 1;
      this.lineWidth = 2.4 * dpr;
      this.ctx.lineWidth = this.lineWidth;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.strokeStyle = this.couleurEncre;
      this.ctx.fillStyle = this.couleurEncre;
    }

    resize(redessiner) {
      const data = redessiner && this.hasInk ? this.canvas.toDataURL('image/png') : null;
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      this.dpr = dpr;
      this.canvas.width = Math.max(300, Math.round((r.width || 300) * dpr));
      this.canvas.height = Math.max(150, Math.round((r.height || 210) * dpr));
      this.ctx = this.canvas.getContext('2d');
      this.remplirFondBlanc();
      this.appliquerStyle();
      if (data) {
        const self = this;
        const img = new Image();
        img.onload = () => {
          self.ctx.drawImage(img, 0, 0, self.canvas.width, self.canvas.height);
        };
        img.src = data;
      }
    }

    pt(e) {
      const r = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / (r.width || 1);
      const scaleY = this.canvas.height / (r.height || 1);
      return {
        x: (e.clientX - r.left) * scaleX,
        y: (e.clientY - r.top) * scaleY
      };
    }

    down(e) {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      if (this.canvas.setPointerCapture && e.pointerId != null) {
        try { this.canvas.setPointerCapture(e.pointerId); } catch (err) {}
      }
      this.drawing = true;
      const p = this.pt(e);
      this.points = [p];
      this.appliquerStyle();

      // Dessine un point rond au premier contact (ex. point sur un i ou accent)
      this.ctx.beginPath();
      if (typeof this.ctx.arc === 'function') {
        this.ctx.arc(p.x, p.y, this.lineWidth / 2, 0, Math.PI * 2);
        this.ctx.fill();
      } else {
        this.ctx.moveTo(p.x, p.y);
        this.ctx.lineTo(p.x + 0.1, p.y + 0.1);
        this.ctx.stroke();
      }
      this.marquer();
    }

    move(e) {
      if (!this.drawing) return;
      e.preventDefault();

      // Prise en charge des micro-points interpolés par l'écran tactile (120 Hz / 240 Hz)
      const evs = (typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length)
        ? e.getCoalescedEvents()
        : [e];

      for (let i = 0; i < evs.length; i++) {
        const p = this.pt(evs[i]);
        const prev = this.points[this.points.length - 1];
        if (prev) {
          const dx = p.x - prev.x, dy = p.y - prev.y;
          // Filtre les micro-tremblements imperceptibles (< 0.8px) pour lisser le tracé
          if (dx * dx + dy * dy < 0.64) continue;
        }

        this.points.push(p);
        const len = this.points.length;

        if (len === 2) {
          // Début de trait : ligne continue entre le point initial et le premier milieu
          const p0 = this.points[0], p1 = this.points[1];
          const midX = (p0.x + p1.x) / 2, midY = (p0.y + p1.y) / 2;
          this.ctx.beginPath();
          this.ctx.moveTo(p0.x, p0.y);
          this.ctx.lineTo(midX, midY);
          this.ctx.stroke();
        } else if (len > 2) {
          // Courbe de Bézier quadratique continue C1 :
          // démarre EXACTEMENT au milieu précédent et s'arrête au milieu courant
          // en utilisant le point précédent comme point de contrôle.
          // Aucune discontinuité, aucun espace vide entre les segments.
          const pPrev2 = this.points[len - 3];
          const pPrev1 = this.points[len - 2];
          const pCurr  = this.points[len - 1];

          const startX = (pPrev2.x + pPrev1.x) / 2;
          const startY = (pPrev2.y + pPrev1.y) / 2;
          const endX   = (pPrev1.x + pCurr.x) / 2;
          const endY   = (pPrev1.y + pCurr.y) / 2;

          this.ctx.beginPath();
          this.ctx.moveTo(startX, startY);
          this.ctx.quadraticCurveTo(pPrev1.x, pPrev1.y, endX, endY);
          this.ctx.stroke();
        }
      }
      this.marquer();
    }

    up(e) {
      if (!this.drawing) return;
      this.drawing = false;
      if (e && e.pointerId != null && this.canvas.releasePointerCapture) {
        try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      }

      const len = this.points.length;
      if (len > 2) {
        // Raccorde le dernier milieu au point final pour terminer la courbe proprement
        const pPrev = this.points[len - 2];
        const pLast = this.points[len - 1];
        const startX = (pPrev.x + pLast.x) / 2;
        const startY = (pPrev.y + pLast.y) / 2;

        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.lineTo(pLast.x, pLast.y);
        this.ctx.stroke();
      } else if (len === 2) {
        const p0 = this.points[0], p1 = this.points[1];
        this.ctx.beginPath();
        this.ctx.moveTo(p0.x, p0.y);
        this.ctx.lineTo(p1.x, p1.y);
        this.ctx.stroke();
      }
      this.points = [];
    }

    marquer() {
      if (!this.hasInk) {
        this.hasInk = true;
        if (this.onChange) this.onChange(true);
      }
    }

    dataUrl() {
      return this.canvas.toDataURL('image/png');
    }

    load(d) {
      if (!d) return;
      const self = this;
      const img = new Image();
      img.onload = function () {
        self.remplirFondBlanc();
        self.ctx.drawImage(img, 0, 0, self.canvas.width, self.canvas.height);
        self.hasInk = true;
        if (self.onChange) self.onChange(true);
      };
      img.src = d;
    }

    clear() {
      this.remplirFondBlanc();
      this.appliquerStyle();
      this.hasInk = false;
      this.points = [];
      if (this.onChange) this.onChange(false);
    }
  }

  /* ===================== Génération & envoi =========================== */
  const Cache = { pdf: null, docx: null, clePdf: '', cleDocx: '', cleTrad: '' };
  function cleCache(rapport, langue) {
    rapport = rapport || R;
    return JSON.stringify([rapport.id, rapport.maj, (S.canevas && S.canevas.nom) || '', langue || 'fr',
      (S.impression && S.impression.miseEnPageEvenements) || 'compacte']);
  }
  /* Génère le PDF : français par défaut, ou dans la langue demandée
     (suffixe : nom de fichier « …_EN.pdf » quand les deux langues cohabitent). */
  async function pdf(rapport, langue, suffixe) {
    rapport = rapport || R; langue = langue || 'fr';
    const cle = cleCache(rapport, langue);
    if (Cache.pdf && Cache.clePdf === cle) return Cache.pdf;
    toast(langue === 'fr' ? 'Mise en forme du rapport…' : 'Mise en forme de la version ' + I18N.natif(langue) + '…', 1800);
    const res = await Report.genererPDF(rapport, S, { langue: langue, suffixe: !!suffixe });
    Cache.pdf = res; Cache.clePdf = cle;
    return res;
  }
  async function docx(rapport, langue, suffixe) {
    rapport = rapport || R; langue = langue || 'fr';
    const cle = cleCache(rapport, langue);
    if (Cache.docx && Cache.cleDocx === cle) return Cache.docx;
    const res = await Report.genererDOCX(rapport, S, { langue: langue, suffixe: !!suffixe });
    Cache.docx = res; Cache.cleDocx = cle;
    return res;
  }
  function urlObjet(blob) {
    try { return URL.createObjectURL(blob); } catch (e) { return null; }
  }
  /* Dans un artefact Claude, la page ne peut pas déclencher de téléchargement elle-même :
     on passe par la capacité « downloads » (le visiteur confirme l'enregistrement).
     Ailleurs (GitHub Pages, fichier ouvert dans Chrome) : lien de téléchargement classique. */
  let capaciteTelechargement;
  function obtenirCapaciteTelechargement() {
    if (capaciteTelechargement !== undefined) return capaciteTelechargement;
    const c = (typeof window !== 'undefined') ? window.claude : null;
    capaciteTelechargement = (c && typeof c.use === 'function')
      ? c.use('downloads').catch(() => null)
      : Promise.resolve(null);
    return capaciteTelechargement;
  }
  // Les enregistrements passent l'un après l'autre (une seule confirmation ouverte à la fois)
  let fileEnregistrements = Promise.resolve();
  function telecharger(blob, nom) {
    const resultat = fileEnregistrements.then(() => obtenirCapaciteTelechargement()).then((dl) => {
      if (!dl) return telechargerLien(blob, nom);
      return dl.save({ filename: nom, data: blob }).then(() => true, (err) => {
        const code = err && err.code;
        if (code === 'declined') toast('Enregistrement de ' + nom + ' annulé');
        else toast('Enregistrement impossible ici' + (code ? ' (' + code + ')' : ''), 4000);
        return false;
      });
    }).catch(() => false);
    fileEnregistrements = resultat;
    return resultat;   // Promise<bool> : true si le fichier a été remis au visiteur
  }
  function dansUnCadre() {
    try { return window.self !== window.top; } catch (_) { return true; }
  }
  /* Ouvre la messagerie du téléphone. Dans un cadre (artefact Claude), les liens mailto:
     ne sont pas fiables : l'adresse est déjà copiée, on le rappelle simplement. */
  function ouvrirMessagerie(url) {
    if (dansUnCadre()) {
      toast('Adresse copiée : collez-la dans votre messagerie et joignez le PDF enregistré', 5000);
      return;
    }
    window.location.href = url;
  }
  function telechargerLien(blob, nom) {
    const url = urlObjet(blob);
    if (!url) { toast('Téléchargement indisponible sur ce navigateur'); return false; }
    const a = document.createElement('a');
    a.href = url; a.download = nom;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
    return true;
  }
  /* Aperçu du rapport : on dessine les pages du PDF dans l'application
     (Chrome bloque l'affichage d'un PDF dans un cadre, surtout hors connexion
     ou dans un onglet « sandbox »). Le rendu est identique au PDF final. */
  async function apercuPDF() {
    const bilingue = !!(R.langue && R.langue.active && R.langue.code);
    const panneau = Ouvrir.ouvrir(null, `<div class="panel" style="max-height:92vh">
      <div class="grab"></div><h3>Aperçu du rapport</h3>
      ${bilingue ? `<div class="btnrow" style="margin:2px 0 8px">
        <button class="btn" data-ap="fr">Français</button>
        <button class="btn ghost" data-ap="trad">${esc(I18N.natif(R.langue.code))}</button></div>` : ''}
      <p class="sub" id="apInfo">Préparation de l'aperçu…</p>
      <div id="apPages" class="apercu-zone"><p class="hint">Mise en page en cours…</p></div>
      <div class="btnrow" style="margin-top:10px">
        <button class="btn grey" data-a="fermer">Fermer</button>
        <button class="btn ghost" id="apOuvrir" hidden>Ouvrir dans un onglet</button>
        <button class="btn" id="apTel" disabled>Télécharger</button></div></div>`);

    let langueAffichee = 'fr';

    function erreurApercu(e) {
      $('#apInfo', panneau).textContent = 'Aperçu impossible : ' + (e && e.message ? e.message : e);
      $('#apPages', panneau).innerHTML = '<p class="hint">Le rapport reste téléchargeable ci-dessous.</p>';
    }

    async function dessiner() {
      const zone = $('#apPages', panneau);
      zone.innerHTML = '<p class="hint">Mise en page en cours…</p>';
      $('#apInfo', panneau).textContent = "Préparation de l'aperçu…";

      /* Correction automatique du français avant mise en page et traduction */
      if (typeof CorrecteurFR !== 'undefined' && CorrecteurFR.corrigerRapport) {
        CorrecteurFR.corrigerRapport(R);
        planifier();
      }

      let rapport = R, langue = langueAffichee;
      /* Version traduite : traduction (ou repli annoncé) avant la mise en page. */
      if (langue !== 'fr') {
        const trad = await traduireRapport(surEtatTraduction);
        if (trad.actif && trad.ok) rapport = trad.rapport;
        else { langue = 'fr'; langueAffichee = 'fr'; }
      }
      const res = (langue === 'fr') ? await pdf() : await pdf(rapport, langue, true);
      const rendu = await Report.apercu(rapport, S, { echelle: 1.5, langue: langue, suffixe: langue !== 'fr' });
      const pages = rendu.pages;
      $('#apInfo', panneau).textContent = rendu.filename + ' — ' + pages.length + ' page(s) — ' +
        (res.blob.size / 1024).toFixed(0) + ' Ko';
      zone.innerHTML = '';
      pages.forEach((c, n) => {
        const bloc = document.createElement('div');
        bloc.className = 'apercu-feuille';
        bloc.appendChild(c);
        const num = document.createElement('div');
        num.className = 'apercu-num';
        num.textContent = 'Page ' + (n + 1) + ' / ' + pages.length;
        bloc.appendChild(num);
        zone.appendChild(bloc);
      });
      $('#apTel', panneau).disabled = false;
      $('#apTel', panneau).onclick = () => { telecharger(res.blob, res.filename); toast('Rapport enregistré'); };
      const url = urlObjet(res.blob);
      if (url) {
        const ouvrir = $('#apOuvrir', panneau);
        ouvrir.hidden = false;
        ouvrir.onclick = () => {
          const fenetre = window.open(url, '_blank');
          if (!fenetre) toast('Onglet bloqué : utilisez « Télécharger » puis ouvrez le fichier', 4000);
        };
        setTimeout(() => { if (url.indexOf('blob:') === 0) URL.revokeObjectURL(url); }, 120000);
      }
      panneau.querySelectorAll('[data-ap]').forEach(function (b) {
        const actif = (b.dataset.ap === 'fr') === (langue === 'fr');
        b.className = actif ? 'btn' : 'btn ghost';
      });
    }

    panneau.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ap]');
      if (!b) return;
      langueAffichee = b.dataset.ap === 'fr' ? 'fr' : R.langue.code;
      dessiner().catch(erreurApercu);
    });

    dessiner().catch(erreurApercu);
  }

  /* ---------- Langue du client (rapport bilingue) ---------------------- */
  function texteLangue(r) {
    if (!r.langue || !r.langue.active) {
      return "Un seul rapport est créé, en français. Cochez la case si le client a besoin du rapport dans sa langue.";
    }
    const l = I18N.langue(r.langue.code);
    return 'Deux rapports sont créés : un en français et un en ' + (l ? l.natif : '?') +
      " (libellés et commentaires traduits). Numéro, dates et heures sont identiques sur les deux, et le français reste la version de référence.";
  }
  function texteEtatTraduction() {
    if (!Traduction.utilisable()) {
      return "Sur ce téléphone, la traduction automatique n'est pas disponible : les libellés du rapport seront traduits, mais les commentaires saisis resteront en français.";
    }
    return "Traduction faite par le téléphone : gratuit, et hors connexion une fois la langue téléchargée (une seule fois). La version traduite peut être relue dans l'aperçu avant l'envoi.";
  }

  /* Traduit le rapport si l'option est active. Renvoie :
     { actif:false }                          → rien à traduire
     { actif:true, ok:true, rapport, partiel} → version traduite à mettre en page
     { actif:true, ok:false, annule:true }    → le technicien a renoncé        */
  async function traduireRapport(surEtat) {
    if (!R.langue || !R.langue.active || !R.langue.code) return { actif: false };
    const code = R.langue.code;
    const nom = I18N.natif(code);
    if (surEtat) surEtat({ etape: 'debut', langue: nom });
    const res = await Traduction.rapport(R, code, surEtat);
    if (res.ok) {
      return { actif: true, ok: true, rapport: res.rapport, code: code, nb: res.nb, total: res.total, erreurs: res.erreurs };
    }
    /* Traduction automatique impossible : on demande quoi faire, sans jamais
       bloquer l'envoi du rapport français. */
    const explication = res.motif === 'indisponible'
      ? "Ce téléphone ne peut pas traduire les commentaires automatiquement."
      : "La langue n'a pas pu être préparée (le modèle se télécharge au premier usage : il faut du réseau).";
    masquerChargement();
    const poursuivre = await Dialogue.confirmer(explication + "\n\nCréer quand même le rapport en " + nom +
      " (libellés traduits, commentaires laissés en français) ?",
      { ok: 'Créer en ' + nom, annuler: 'Français seulement' });
    if (!poursuivre) return { actif: true, ok: false, annule: true, motif: res.motif };
    afficherChargement('Mise en page des documents…', 'Création de la version ' + nom + '…');
    return { actif: true, ok: true, rapport: R, code: code, partiel: true, motif: res.motif };
  }

  function destinatairesMail() {
    const to = [];
    const cc = [];

    // Ligne "À :" (Destinataires principaux : client et responsable SAV)
    if (S.mail.envoyerClient !== false && R.client && R.client.email) {
      const cl = R.client.email.trim();
      if (cl && to.indexOf(cl) === -1) to.push(cl);
    }
    const savAdr = (S.mail && S.mail.destinataireSAV && S.mail.destinataireSAV.trim()) || '';
    const envoiSAV = S.mail.envoyerSAV !== false && Boolean(savAdr);
    if (envoiSAV && to.indexOf(savAdr) === -1) {
      to.push(savAdr);
    }

    // Ligne "Cc :" (Copies conformes : technicien systématiquement + assistant SAV dès qu'un mail est envoyé au responsable SAV + adresses configurées)
    if (S.technicien && S.technicien.email) {
      const tech = S.technicien.email.trim();
      if (tech && cc.indexOf(tech) === -1 && to.indexOf(tech) === -1) cc.push(tech);
    }
    // Assistant SAV systématiquement en copie à chaque fois qu'un mail est envoyé au responsable SAV
    if (envoiSAV && S.mail && S.mail.assistantSAV) {
      const ast = S.mail.assistantSAV.trim();
      if (ast && cc.indexOf(ast) === -1 && to.indexOf(ast) === -1) cc.push(ast);
    }
    if (S.mail.destinatairesCopie) {
      S.mail.destinatairesCopie.split(/[;,]/).forEach(x => {
        const adr = x.trim();
        if (adr && cc.indexOf(adr) === -1 && to.indexOf(adr) === -1) cc.push(adr);
      });
    }

    return {
      to: to,
      cc: cc,
      toStr: to.join(', '),
      ccStr: cc.join(', ')
    };
  }

  function destinatairesClient() {
    const to = [];
    if (R.client && R.client.email) {
      const cl = R.client.email.trim();
      if (cl) to.push(cl);
    }
    return {
      to: to,
      cc: [],
      toStr: to.join(', '),
      ccStr: ''
    };
  }

  function destinatairesSAV() {
    const to = [];
    const cc = [];
    // champ vidé dans les réglages = pas d'envoi au responsable SAV (plus d'adresse imposée)
    const adrSAV = (S.mail && S.mail.destinataireSAV && S.mail.destinataireSAV.trim()) || '';
    if (adrSAV) to.push(adrSAV);
    if (S.technicien && S.technicien.email) {
      const tech = S.technicien.email.trim();
      if (tech && cc.indexOf(tech) === -1 && to.indexOf(tech) === -1) cc.push(tech);
    }
    if (S.mail && S.mail.assistantSAV) {
      const ast = S.mail.assistantSAV.trim();
      if (ast && cc.indexOf(ast) === -1 && to.indexOf(ast) === -1) cc.push(ast);
    }
    if (S.mail && S.mail.destinatairesCopie) {
      S.mail.destinatairesCopie.split(/[;,]/).forEach(x => {
        const adr = x.trim();
        if (adr && cc.indexOf(adr) === -1 && to.indexOf(adr) === -1) cc.push(adr);
      });
    }
    return {
      to: to,
      cc: cc,
      toStr: to.join(', '),
      ccStr: cc.join(', ')
    };
  }

  function urlMailto(dests, objet, corps) {
    let u = 'mailto:' + encodeURIComponent((dests && dests.to ? dests.to : []).join(','));
    const params = [];
    if (dests && dests.cc && dests.cc.length) params.push('cc=' + encodeURIComponent(dests.cc.join(',')));
    if (objet) params.push('subject=' + encodeURIComponent(objet));
    if (corps) params.push('body=' + encodeURIComponent(corps));
    if (params.length) u += '?' + params.join('&');
    return u;
  }

  function destinataires() {
    const d = destinatairesMail();
    return d.to.concat(d.cc);
  }

  /* ---------- Écran de chargement / attente traduction ---------- */
  let overlayChargementEl = null;

  function afficherChargement(titre, message) {
    if (typeof document === 'undefined') return;
    masquerChargement();
    overlayChargementEl = document.createElement('div');
    overlayChargementEl.className = 'chargement-overlay';
    overlayChargementEl.id = 'chargementOverlay';
    overlayChargementEl.innerHTML = `
      <div class="chargement-boite">
        <div class="chargement-spinner"></div>
        <div class="chargement-titre" id="chargementTitre">${esc(titre || 'Opération en cours…')}</div>
        <div class="chargement-texte" id="chargementTexte">${esc(message || 'Veuillez patienter quelques instants…')}</div>
        <div class="chargement-notice">⏳ Ne quittez pas la page et évitez de cliquer sur d'autres boutons pendant le traitement.</div>
      </div>
    `;
    document.body.appendChild(overlayChargementEl);
  }

  function majChargement(titre, message) {
    if (!overlayChargementEl) return;
    const tEl = overlayChargementEl.querySelector('#chargementTitre');
    const mEl = overlayChargementEl.querySelector('#chargementTexte');
    if (tEl && titre) tEl.textContent = titre;
    if (mEl && message) mEl.textContent = message;
  }

  function masquerChargement() {
    if (overlayChargementEl && overlayChargementEl.parentNode) {
      overlayChargementEl.parentNode.removeChild(overlayChargementEl);
    }
    overlayChargementEl = null;
    const ancien = (typeof document !== 'undefined') ? document.getElementById('chargementOverlay') : null;
    if (ancien && ancien.parentNode) ancien.parentNode.removeChild(ancien);
  }

  /* Suivi de la traduction à l'écran (téléchargement du modèle, avancement). */
  function surEtatTraduction(e) {
    if (!e) return;
    if (e.etape === 'debut') {
      majChargement('Traduction en cours…', 'Préparation de la version en ' + (e.langue || 'langue client') + '…');
      toast('Préparation de la traduction (' + (e.langue || '') + ')…', 1800);
    } else if (e.etape === 'telechargement') {
      majChargement('Téléchargement de la langue…', 'Récupération du modèle hors connexion : ' + (e.pct || 0) + ' %…');
      toast('Téléchargement de la langue : ' + (e.pct || 0) + ' %', 1400);
    } else if (e.etape === 'traduction') {
      majChargement('Traduction des commentaires…', 'Traduction automatique des annotations et pièces…');
      if (e.total && (e.fait === e.total || e.fait === 0)) {
        toast(e.fait === 0 ? 'Traduction des commentaires…' : 'Traduction terminée', 1600);
      }
    }
  }

  let enSoumission = false;

  async function soumettre() {
    if (enSoumission) return;
    enSoumission = true;

    const btnSoum = (typeof document !== 'undefined') ? document.getElementById('btnSoumettre') : null;
    const texteOrig = btnSoum ? btnSoum.innerHTML : '';
    if (btnSoum) {
      btnSoum.innerHTML = '⏳ Préparation en cours…';
      btnSoum.disabled = true;
    }

    try {
      if (!Report.nomComplet(S.technicien)) { toast('Indiquez d\'abord votre nom : il figure sur le rapport', 3200); feuilleIdentite(true); return; }
      if (!R.client.nom) { toast('Renseignez d\'abord le client'); feuilleClient(); return; }
      if (!R.signatureClient.dataUrl && !(await Dialogue.confirmer('Le client n\'a pas signé. Soumettre quand même le rapport ?', { ok: 'Soumettre' }))) return;
      if (!R.chrono.fin && R.chrono.debut && !(await Dialogue.confirmer('Le chrono n\'est pas terminé. Continuer ?', { ok: 'Continuer' }))) return;

      const avecTrad = !!(R.langue && R.langue.active && R.langue.code);
      const nomLangue = avecTrad && (typeof I18N !== 'undefined') ? I18N.natif(R.langue.code) : '';

      afficherChargement(
        avecTrad ? 'Traduction en cours…' : 'Génération du compte rendu…',
        avecTrad
          ? 'Veuillez patienter quelques instants, création des versions française et ' + nomLangue + '…'
          : 'Mise en page du document officiel…'
      );

      /* Correction automatique du français (accords, pluriels, accents) avant génération et traduction */
      if (typeof CorrecteurFR !== 'undefined' && CorrecteurFR.corrigerRapport) {
        CorrecteurFR.corrigerRapport(R);
        planifier();
        rendreTout();
      }

      /* 1. Rapport français : toujours créé, c'est la version de référence. */
      const res = await pdf();
      let resWord = null;
      try { resWord = await docx(); } catch (e) { resWord = null; }

      /* 2. Version dans la langue du client, si l'option est activée. */
      let trad = { actif: false }, resTrad = null, resWordTrad = null;
      if (avecTrad) {
        trad = await traduireRapport(surEtatTraduction);
        if (trad.actif && trad.ok) {
          majChargement('Mise en page des documents…', 'Génération de la version ' + nomLangue + '…');
          resTrad = await pdf(trad.rapport, trad.code, true);
          try { resWordTrad = await docx(trad.rapport, trad.code, true); } catch (e) { resWordTrad = null; }
        }
      }

      const lots = { fr: { pdf: res, word: resWord }, trad: (resTrad ? { code: trad.code, pdf: resTrad, word: resWordTrad } : null), partiel: !!(trad.partiel) };

      masquerChargement();
      feuilleEnvoi(lots);
    } catch (err) {
      masquerChargement();
      console.error('Erreur lors de la génération du rapport :', err);
      Dialogue.informer('Erreur lors de la préparation du rapport : ' + (err && err.message ? err.message : err));
    } finally {
      enSoumission = false;
      if (btnSoum) {
        btnSoum.innerHTML = texteOrig;
        btnSoum.disabled = false;
      }
    }
  }

  /* Fichiers joints au partage natif : uniquement les rapports PDF (le format Word n'est pas autorisé par Web Share) */
  function fichiersEnvoi(lots) {
    const PDF = 'application/pdf';
    const fichiers = [];
    if (lots && lots.fr && lots.fr.pdf && lots.fr.pdf.blob) {
      fichiers.push(new File([lots.fr.pdf.blob], lots.fr.pdf.filename, { type: PDF, lastModified: Date.now() }));
    }
    if (lots && lots.trad && lots.trad.pdf && lots.trad.pdf.blob) {
      fichiers.push(new File([lots.trad.pdf.blob], lots.trad.pdf.filename, { type: PDF, lastModified: Date.now() }));
    }
    return fichiers;
  }

  function feuilleEnvoi(lots) {
    const dests = destinatairesMail();
    const res = lots.fr.pdf, resWord = lots.fr.word;
    const t = lots.trad;
    const langueMail = t ? t.code : null;
    const nomLangue = (t && typeof I18N !== 'undefined' && I18N.natif) ? I18N.natif(t.code) : (t ? t.code.toUpperCase() : '');

    // Objet et corps final (unifié : bilingue si traduit, 100% français sinon)
    const objetFinal = t ? Report.objetMail(R, S, t.code) : Report.objetMail(R, S);
    const corpsFinal = t ? Report.corpsMailBilingue(R, S, t.code) : Report.corpsMail(R, S, null);
    const mailtoUrl = urlMailto(dests, objetFinal, corpsFinal);

    const html = `<div class="panel">
      <div class="grab"></div><h3>Envoyer le compte rendu ${t ? 'bilingue' : ''}</h3>
      <p class="sub">${t ? 'Les 2 rapports PDF (FR + ' + esc(nomLangue) + ') sont prêts pour transmission :' : 'Le rapport PDF est prêt pour transmission :'}</p>

      ${t ? `<div class="sticky-note" style="margin-bottom:12px;background:#f0fdf4;border:1.5px solid #86efac;border-left:4px solid #16a34a">
        <strong style="color:#166534">✨ Version bilingue prête : ${esc(nomLangue)} + Français</strong><br>
        <small style="color:#334155">Un seul e-mail regroupe la version ${esc(nomLangue)} pour le client et la version française pour le SAV. <strong>Les 2 fichiers PDF sont joints</strong>.</small>
      </div>` : ''}

      <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12.5px;line-height:1.5">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
          <div><strong style="color:var(--bfr-secondary)">À (Destinataires) :</strong> <span style="font-family:ui-monospace,monospace;color:#1e293b">${esc(dests.toStr || 'aucun')}</span></div>
          ${dests.toStr ? `<button type="button" class="btn sm ghost" data-copier-dest="${esc(dests.toStr)}" style="padding:2px 8px;font-size:11px;min-height:26px" title="Copier les destinataires principaux">Copier</button>` : ''}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:6px;padding-top:6px;border-top:1px dashed #cbd5e1">
          <div><strong style="color:var(--bfr-secondary)">Cc (Copies conformes) :</strong> <span style="font-family:ui-monospace,monospace;color:#1e293b">${esc(dests.ccStr || 'aucune')}</span></div>
          ${dests.ccStr ? `<button type="button" class="btn sm ghost" data-copier-dest="${esc(dests.ccStr)}" style="padding:2px 8px;font-size:11px;min-height:26px" title="Copier les adresses en copie">Copier</button>` : ''}
        </div>
      </div>

      <button class="menu-item" data-a="partager" style="background:#e0f2fe;border:2px solid var(--bfr-primary)">
        <span class="ico">${(ICO.send && ICO.send(20)) || ''}</span>
        <span><strong style="font-size:14.5px;color:var(--bfr-secondary)">Envoyer le rapport par e-mail (${t ? '2 PDF joints' : 'PDF joint'})</strong>
        <small>Outlook / Gmail — ${t ? 'Version ' + esc(nomLangue) + ' + FR' : 'PDF attaché'} &amp; adresse client copiée</small></span>
      </button>

      <div style="text-align:center;margin:6px 0 10px 0">
        <a href="${esc(mailtoUrl)}" data-a="mailto" class="small" style="color:var(--bfr-primary);text-decoration:underline;font-size:11.5px">Repli direct : ouvrir l'application e-mail avec À et Cc pré-remplis (sans pièce jointe)</a>
      </div>

      <button class="menu-item" data-a="dl"><span class="ico">${(ICO.download && ICO.download(18)) || ''}</span><span>Télécharger le PDF (${t ? 'Français de référence' : 'PDF'})</span></button>
      ${t ? `<button class="menu-item" data-a="dlt"><span class="ico">${(ICO.download && ICO.download(18)) || ''}</span><span>Télécharger le PDF (${esc(nomLangue)})</span></button>` : ''}
      <button class="menu-item" data-a="dlw"><span class="ico">${(ICO.fileText && ICO.fileText(18)) || ''}</span><span>Télécharger la version Word (Français)</span></button>
      ${(t && t.word) ? `<button class="menu-item" data-a="dlwt"><span class="ico">${(ICO.fileText && ICO.fileText(18)) || ''}</span><span>Télécharger la version Word (${esc(nomLangue)})</span></button>` : ''}
      ${photosIntervention(R).some(ph => ph.dataUrl) ? `<button class="menu-item" data-a="photos-zip"><span class="ico">${(ICO.image && ICO.image(18)) || ''}</span><span>Télécharger toutes les photos (dossier .zip)</span></button>` : ''}
      <button class="menu-item" data-a="copier"><span class="ico">${(ICO.copy && ICO.copy(18)) || ''}</span><span>Copier le texte du message</span></button>
      <button class="btn grey wide" style="margin-top:10px" data-a="fermer">Fermer</button></div>`;

    Ouvrir.ouvrir(null, html, (panneau) => {
      panneau.addEventListener('click', async (e) => {
        const btnCopierDest = e.target.closest('[data-copier-dest]');
        if (btnCopierDest) {
          const val = btnCopierDest.getAttribute('data-copier-dest');
          copier(val);
          toast('Adresse copiée : ' + val);
          return;
        }

        const b = e.target.closest('[data-a]:not([data-a="fermer"])');
        if (!b) return;
        const a = b.dataset.a;
        const fichiers = fichiersEnvoi(lots);

        if (a === 'partager' || a === 'envoyer-mail' || a === 'partager-groupe' || a === 'partager-client' || a === 'partager-sav') {
          if (dests.toStr) copier(dests.toStr);
          let peutPartager = false;
          if (navigator.canShare && fichiers.length && !dansUnCadre()) {
            try { peutPartager = navigator.canShare({ files: fichiers }); } catch (_) { peutPartager = false; }
          }
          if (peutPartager) {
            try {
              toast((t ? '2 PDF attachés' : 'PDF attaché') + ' — Adresse client copiée', 3000);
              await navigator.share({
                files: fichiers,
                title: objetFinal,
                text: corpsFinal
              });
              R.statut = 'transmis'; if (langueMail) R.langueEnvoyee = langueMail;
              planifier(); rendreTout();
              toast('Rapport transmis avec succès');
            } catch (err) {
              if (err && err.name !== 'AbortError') {
                console.warn('Erreur lors du partage :', err);
                toast('Ouverture de votre messagerie…');
                ouvrirMessagerie(mailtoUrl);
              }
            }
          } else {
            telecharger(lots.fr.pdf.blob, lots.fr.pdf.filename);
            if (lots.trad && lots.trad.pdf) telecharger(lots.trad.pdf.blob, lots.trad.pdf.filename);
            toast((t ? '2 PDF téléchargés' : 'PDF téléchargé') + ' — ouverture messagerie…', 3200);
            setTimeout(() => { ouvrirMessagerie(mailtoUrl); }, 300);
          }
        } else if (a === 'copier') {
          copier(corpsFinal);
          toast('Texte du message copié');
        } else if (a === 'copier-client') {
          copier(t ? Report.corpsMailClient(R, S, t.code) : corpsFinal);
          toast('Texte client copié');
        } else if (a === 'copier-sav') {
          copier(t ? Report.corpsMailSAV(R, S, t.code) : corpsFinal);
          toast('Texte SAV copié');
        } else if (a === 'mailto' || a === 'mailto-client' || a === 'mailto-sav') {
          telecharger(lots.fr.pdf.blob, lots.fr.pdf.filename);
          if (lots.trad && lots.trad.pdf) telecharger(lots.trad.pdf.blob, lots.trad.pdf.filename);
          toast((t ? '2 PDF téléchargés' : 'PDF téléchargé') + " : pensez à l'attacher dans votre messagerie", 3400);
          setTimeout(() => { ouvrirMessagerie(mailtoUrl); }, 300);
        } else if (a === 'dl') {
          telecharger(res.blob, res.filename);
        } else if (a === 'dlt') {
          if (t && t.pdf) telecharger(t.pdf.blob, t.pdf.filename);
        } else if (a === 'photos-zip') {
          dossierPhotos();
        } else if (a === 'dlw') {
          if (resWord) telecharger(resWord.blob, resWord.filename);
        } else if (a === 'dlwt') {
          if (t && t.word) telecharger(t.word.blob, t.word.filename);
        }
      });
    });
  }

  function copier(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(() => toast('Copié'), () => toast('Copie impossible'));
    } else toast('Copie indisponible');
  }

  /* Réduit et convertit une image choisie par le technicien (logo, signature). */
  function compresserImage(fichier, max, q) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const img = new Image();
        img.onload = () => {
          const s = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', q));
        };
        img.onerror = reject; img.src = r.result;
      };
      r.onerror = reject; r.readAsDataURL(fichier);
    });
  }

  /* ===================== Mes informations ============================= */
  /* Fiche « technicien » : elle est enregistrée dans les réglages du téléphone et
     reservie automatiquement à chaque nouvelle intervention. */
  function feuilleIdentite(premiereFois, apresEnregistrement) {
    const t = S.technicien;
    const champ = (cle, label, type, ph) => `<div class="field"><label>${esc(label)}</label>
      <input type="${type || 'text'}" data-sk="${cle}" value="${esc(t[cle.split('.')[1]] || '')}" placeholder="${esc(ph || '')}"></div>`;
    const panneau = Ouvrir.ouvrir(null, `<div class="panel">
      <div class="grab"></div><h3>${premiereFois ? 'Bienvenue' : 'Mes informations'}</h3>
      <p class="sub">${premiereFois
        ? 'Renseignez vos coordonnées une seule fois : elles sont conservées sur ce téléphone et reprises automatiquement dans tous vos rapports.'
        : 'Ces informations sont mémorisées sur ce téléphone et reprises automatiquement à chaque intervention.'}</p>

      <div class="card"><h2>Qui suis-je ?</h2>
        <div class="grid2">${champ('technicien.prenom', 'Prénom', 'text', 'Ex. Julien')}${champ('technicien.nom', 'Nom', 'text', 'Ex. DURAND')}</div>
        ${champ('technicien.fonction', 'Fonction', 'text', 'Ex. Technicien SAV')}
        <div class="field"><label>Code dans le n° de rapport</label>
          <input type="text" data-sk="technicien.code" maxlength="4" autocapitalize="characters" value="${esc(t.code || '')}" placeholder="Vide = vos initiales (${esc(codeTechnicien() || 'ex. JD')})"></div>
        <p class="hint">Exemple de numéro : <strong id="exempleNumero">${esc(numeroSuggere())}</strong>. Si un collègue a les mêmes initiales, choisissez un code différent (2 à 4 lettres ou chiffres).</p>
      </div>

      <div class="card"><h2>Comment me joindre ?</h2>
        <p class="hint">Le client et le responsable SAV retrouvent ces coordonnées en bas du rapport.</p>
        ${champ('technicien.tel', 'Téléphone', 'tel', 'Ex. 06 12 34 56 78')}
        ${champ('technicien.email', 'E-mail', 'email', 'Ex. julien.durand@bfr-systems.fr')}
      </div>

      <div class="card"><h2>Ma signature</h2>
        <p class="hint">Facultatif : une photo de votre signature (sur papier blanc) sera apposée à côté de celle du client.</p>
        <div class="filebtn"><input type="file" id="sigIdentite" accept="image/*">
          <label for="sigIdentite">${(ICO.signature && ICO.signature(16)) || ''} ${t.signature ? 'Changer ma signature' : 'Ajouter ma signature'}</label></div>
        ${t.signature ? '<img id="apercuSig" src="' + t.signature + '" style="max-height:64px;background:#fff;border:1px solid var(--bord);border-radius:6px;margin-top:8px">' : ''}
      </div>

      <div class="sticky-note">Ces informations ne partent nulle part ailleurs : elles restent dans votre téléphone (et dans les rapports que vous envoyez).</div>
      <div class="btnrow"><button class="btn grey" data-a="fermer">${premiereFois ? 'Plus tard' : 'Annuler'}</button>
        <button class="btn" data-a="ok">Enregistrer</button></div></div>`, (pan) => {
      const inp = $('#sigIdentite', pan);
      inp.addEventListener('change', async (e) => {
        if (!e.target.files[0]) return;
        try {
          t.signature = await compresserImage(e.target.files[0], 700, 0.9);
          Store.set(K.settings, S);
          toast('Signature enregistrée');
        } catch (err) { toast('Image illisible'); }
      });
      pan.addEventListener('click', (e) => {
        if (!e.target.closest('[data-a="ok"]')) return;
        const nomAvant = Report.nomComplet(t);
        ['technicien.prenom', 'technicien.nom', 'technicien.fonction', 'technicien.tel', 'technicien.email', 'technicien.code']
          .forEach(k => { const el = $('[data-sk="' + k + '"]', pan); if (el) setPath(S, k, el.value.trim()); });
        t.code = String(t.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
        if (!t.prenom && !t.nom) { toast('Indiquez au moins votre nom'); return; }
        Store.set(K.settings, S);
        /* Numéro automatique du rapport en cours (pas encore transmis) : il prend le code. */
        if (R.numeroAuto && R.statut !== 'transmis' && String(R.numero || '').indexOf(debutNumero()) !== 0) {
          R.numero = numeroSuggere(R.id);
        }
        /* Le rapport en cours suit le changement d'identité. */
        const nomApres = Report.nomComplet(t);
        if (!R.technicien || R.technicien === nomAvant) R.technicien = nomApres;
        e.target.closest('.sheet').remove();
        planifier(); rendreEntete(); rendreTout();
        toast('Bonjour ' + nomApres + ' — informations conservées', 3200);
        if (typeof apresEnregistrement === 'function') apresEnregistrement();
      });
    });
    setTimeout(() => { const p = $('#technicien\.prenom', panneau) || panneau.querySelector('[data-sk="technicien.prenom"]'); if (p && !p.value) p.focus(); }, 80);
    return panneau;
  }

  /* ===================== Dossier photos (.zip) ======================== */
  /* Toutes les photos de l'intervention, dans l'ordre du rapport :
     évènements, pièces de rechange, photos complémentaires. */
  function photosIntervention(r) {
    r = r || R;
    const out = [];
    const etat = { dom: {}, cat: {} };
    (S.domaines || []).forEach(d => { etat.dom[d.id] = d.libelle; });
    (S.categories || []).forEach(c => { etat.cat[c.id] = c.libelle; });
    (r.evenements || []).forEach((ev, k) => {
      (ev.photos || []).forEach((ph, j) => {
        if (!ph) return;
        out.push({ type: 'evenement', dataUrl: ph.dataUrl || '', numEv: k + 1, numPhoto: j + 1,
          heure: ev.heure, domaine: etat.dom[ev.domaine] || ev.domaine || '', categorie: Report.estTravail(ev) ? 'Travail réalisé' : (etat.cat[ev.categorie] || ev.categorie || ''),
          machine: ev.machineNom || '', texte: ev.texte || '', legende: ph.legende || '' });
      });
    });
    (r.pieces || []).forEach((pc, k) => {
      if (!pc || !pc.photo) return;
      const m = (typeof Report !== 'undefined' && Report.infoMachinePiece) ? Report.infoMachinePiece(pc, r) : { libelle: '' };
      out.push({ type: 'piece', dataUrl: pc.photo, numPiece: k + 1, texte: pc.denomination || pc.designation || '',
        reference: pc.reference || '', quantite: pc.quantite || 1, machine: (m && m.libelle && m.libelle !== '—') ? m.libelle : '' });
    });
    (r.photosLibres || []).forEach((ph, k) => {
      if (!ph) return;
      out.push({ type: 'libre', dataUrl: ph.dataUrl || '', numPhoto: k + 1, legende: ph.legende || '' });
    });
    return out;
  }

  /* Nom de fichier lisible partout (Windows, Mac, téléphone) : sans accents ni signes. */
  function nomFichierSur(texte, max) {
    const s = String(texte || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s.slice(0, max || 40).replace(/-+$/, '');
  }

  async function dossierPhotos() {
    sauver(true);
    if (typeof RapportDB !== 'undefined') { try { await RapportDB.restaurerPhotos(R); } catch (_) {} }
    const photos = photosIntervention(R);
    const dispo = photos.filter(ph => ph.dataUrl);
    if (!dispo.length) { toast('Aucune photo dans cette intervention'); return false; }
    if (typeof Docx === 'undefined' || !Docx.zip) { toast('Création du dossier impossible sur ce navigateur'); return false; }
    afficherChargement('Préparation du dossier photos…', dispo.length + ' photo(s)');
    try {
      const fichiers = [];
      const dejaPris = new Set();
      const unique = (chemin) => {
        let c = chemin, k = 2;
        const point = chemin.lastIndexOf('.');
        while (dejaPris.has(c.toLowerCase())) { c = chemin.slice(0, point) + '-' + (k++) + chemin.slice(point); }
        dejaPris.add(c.toLowerCase());
        return c;
      };
      const pad = (n) => ('0' + n).slice(-2);
      const lignes = [['Fichier', 'Type', 'N°', 'Heure', 'Domaine', 'Catégorie', 'Machine', 'Description', 'Référence', 'Quantité', 'Légende']];
      for (const ph of photos) {
        let chemin = '', type = '', num = '';
        const ext = /^data:image\/png/i.test(ph.dataUrl) ? '.png' : '.jpg';
        if (ph.type === 'evenement') {
          type = 'Évènement'; num = ph.numEv + (ph.numPhoto > 1 ? '.' + ph.numPhoto : '');
          chemin = '1-Evenements/E' + pad(ph.numEv) + '-' + ph.numPhoto + '_' + nomFichierSur(ph.categorie, 20) +
            (ph.texte ? '_' + nomFichierSur(ph.texte, 40) : '') + ext;
        } else if (ph.type === 'piece') {
          type = 'Pièce de rechange'; num = ph.numPiece;
          chemin = '2-Pieces/P' + pad(ph.numPiece) + '_' + nomFichierSur(ph.texte, 40) +
            (ph.reference ? '_' + nomFichierSur(ph.reference, 30) : '') + ext;
        } else {
          type = 'Photo complémentaire'; num = ph.numPhoto;
          chemin = '3-Photos-complementaires/PC' + pad(ph.numPhoto) + (ph.legende ? '_' + nomFichierSur(ph.legende, 40) : '') + ext;
        }
        chemin = unique(chemin);
        if (ph.dataUrl) fichiers.push({ nom: chemin, donnees: Docx.dataUrlToBytes(ph.dataUrl) });
        lignes.push([ph.dataUrl ? chemin : '(photo introuvable sur ce téléphone)', type, num,
          ph.heure ? Report.heureFr(ph.heure) : '', ph.domaine || '', ph.categorie || '', ph.machine || '',
          ph.texte || '', ph.reference || '', ph.quantite || '', ph.legende || '']);
      }
      /* Index ouvrable dans Excel : point-virgule et BOM UTF-8 pour les accents. */
      const csv = '\ufeff' + lignes.map(l => l.map(v => {
        const s = String(v == null ? '' : v).replace(/\r?\n/g, ' ');
        return /[;"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(';')).join('\r\n');
      fichiers.unshift({ nom: 'Liste-des-photos.csv', donnees: Docx.utf8(csv) });
      const octets = Docx.zip(fichiers);
      const nom = 'Photos_' + nomFichierSur(R.numero, 30) + '_' + nomFichierSur(R.client && R.client.nom, 30) + '_' + (R.date || todayISO()) + '.zip';
      masquerChargement();
      const ok = await telecharger(new Blob([octets], { type: 'application/zip' }), nom);
      if (ok) toast('Dossier photos enregistré : ' + dispo.length + ' photo(s)', 3200);
      return ok;
    } catch (err) {
      masquerChargement();
      console.error('Dossier photos :', err);
      toast('Création du dossier photos impossible', 4000);
      return false;
    }
  }

  /* Sauvegarde complète (tous les rapports avec leurs photos + réglages) en JSON.
     Renvoie true si le fichier a bien été remis (téléchargé / enregistré). */
  async function exporterSauvegarde() {
    sauver(true);
    let listeExport = [];
    if (typeof RapportDB !== 'undefined' && RapportDB.disponible()) {
      try { listeExport = await RapportDB.tousLesRapports(); } catch (e) { listeExport = []; }
    }
    if (!listeExport || !listeExport.length) listeExport = Store.get(K.rapports, []);
    if (R && R.id) {
      const idx = listeExport.findIndex(x => x.id === R.id);
      if (idx >= 0) listeExport[idx] = R; else listeExport.unshift(R);
    }
    if (typeof RapportDB !== 'undefined') {
      for (const rep of listeExport) await RapportDB.restaurerPhotos(rep);
      await RapportDB.restaurerPhotos(R);
    }
    const totalPhotos = listeExport.reduce((acc, rep) => {
      const evPh = (rep.evenements || []).reduce((a, e) => a + ((e.photos || []).filter(p => p && p.dataUrl).length), 0);
      const libPh = (rep.photosLibres || []).filter(p => p && p.dataUrl).length;
      const pcPh = (rep.pieces || []).filter(p => p && p.photo).length;
      return acc + evPh + libPh + pcPh;
    }, 0);
    const ok = await telecharger(
      new Blob([JSON.stringify({ version: 3, exporte: new Date().toISOString(), reglages: S, rapport: R, rapports: listeExport }, null, 1)], { type: 'application/json' }),
      'sauvegarde_rapports_' + todayISO() + '.json'
    );
    if (ok) {
      Store.set('sav3.derniereSauvegarde', new Date().toISOString());
      toast(`Sauvegarde exportée (${listeExport.length} rapport(s), ${totalPhotos} photo(s) incluses)`, 3500);
    }
    return ok;
  }

  /* Réglages d'équipe : tout ce qui est commun aux techniciens (adresses d'envoi,
     société, mise en page…), sans les informations personnelles du technicien. */
  const CLES_EQUIPE = ['societe', 'mail', 'impression', 'domaines', 'categories', 'canevas', 'numeroPrefixe'];
  function reglagesEquipe() {
    const out = { type: 'reglages-equipe-bfr', version: 1, exporte: new Date().toISOString() };
    CLES_EQUIPE.forEach(k => { if (S[k] !== undefined) out[k] = JSON.parse(JSON.stringify(S[k])); });
    return out;
  }
  function importerReglagesEquipe(texte) {
    let d;
    try { d = JSON.parse(texte); } catch (e) { return 0; }
    if (!d || typeof d !== 'object') return 0;
    // accepte aussi une sauvegarde complète (on n'en prend que la partie équipe)
    const src = d.type === 'reglages-equipe-bfr' ? d : (d.reglages && typeof d.reglages === 'object' ? d.reglages : null);
    if (!src) return 0;
    let n = 0;
    CLES_EQUIPE.forEach(k => {
      if (src[k] === undefined) return;
      S[k] = (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && S[k] && typeof S[k] === 'object')
        ? fusion(S[k], src[k]) : src[k];
      n++;
    });
    if (n) { Store.set(K.settings, S); Cache.pdf = Cache.docx = null; Cache.clePdf = Cache.cleDocx = ''; }
    return n;
  }

  /* ===================== Réglages ===================================== */
  function feuilleReglages() {
    const f = (cle, label, type, ph) => `<div class="field"><label>${esc(label)}</label>
      <input type="${type || 'text'}" data-sk="${cle}" value="${esc(getPath(S, cle) || '')}" ${ph ? `placeholder="${esc(ph)}"` : ''}></div>`;
    Ouvrir.ouvrir(null, `<div class="panel">
      <div class="grab"></div><h3>Réglages</h3>
      <p class="sub">À renseigner une fois par technicien. Ces informations n'apparaissent que dans vos rapports.</p>

      <div class="card"><h2>Technicien</h2>
        <div class="recap">
          <div><span>Nom</span><strong>${esc(Report.nomComplet(S.technicien) || 'non renseigné')}</strong></div>
          <div><span>Fonction</span><strong>${esc(S.technicien.fonction || '—')}</strong></div>
          <div><span>Téléphone</span><strong>${esc(S.technicien.tel || '—')}</strong></div>
          <div><span>E-mail</span><strong>${esc(S.technicien.email || '—')}</strong></div>
          <div><span>Signature</span><strong>${S.technicien.signature ? 'enregistrée' : 'absente'}</strong></div>
        </div>
        <button class="btn wide" data-a="identite">${(ICO.pen && ICO.pen(16)) || ''} Mes informations</button>
        <p class="small">Ces coordonnées restent dans le téléphone et servent à chaque intervention.</p>
      </div>

      <div class="card"><h2>Icône de l'application (Écran d'accueil Android)</h2>
        <p class="small">Sélectionnez l'icône installée sur votre smartphone. L'icône active est appliquée immédiatement au raccourci et à l'écran d'accueil.</p>
        <div class="icones-selecteur">
          ${((typeof window !== 'undefined' && window.BFR_ICONES_OPTIONS) || []).map(opt => {
            const actif = (S.iconeApp || 'opt1') === opt.id;
            return `
              <div class="icone-card ${actif ? 'actif' : ''}" data-icone-id="${opt.id}">
                <img src="${opt.dataUri || opt.src192}" alt="${esc(opt.titre)}">
                <div class="icone-card-info">
                  <div class="icone-card-titre">
                    <span>${esc(opt.titre)}</span>
                    ${actif ? '<span class="icone-badge-actif">Actif</span>' : ''}
                  </div>
                  <div class="icone-card-desc">${esc(opt.desc)}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="card"><h2>Société</h2>
        ${f('societe.nom', 'Raison sociale')}
        <div class="grid2">${f('societe.sigle', 'Sigle (logo texte)')}${f('societe.sigleSuffixe', 'Complément')}</div>
        ${f('societe.adresse', 'Adresse')}
        <div class="grid2">${f('societe.cpVille', 'CP / Ville')}${f('societe.tel', 'Téléphone', 'tel')}</div>
        <div class="grid2">${f('societe.email', 'E-mail société', 'email')}${f('societe.siteWeb', 'Site web')}</div>
        <div class="grid2">${f('societe.siret', 'SIRET')}${f('societe.tva', 'N° TVA')}</div>
        <div class="filebtn" style="margin-top:8px"><input type="file" id="logoInput" accept="image/*">
          <label for="logoInput">${(ICO.image && ICO.image(16)) || ''} ${S.societe.logo ? 'Changer le logo' : 'Ajouter le logo'}</label></div>
        ${S.societe.logo ? '<img src="' + S.societe.logo + '" style="max-height:56px;margin-top:8px">' : ''}
      </div>

      <div class="card"><h2>Compte rendu (modèle BFR)</h2>
        <p class="small">Le rapport suit le modèle « Compte rendu d'intervention » : en-tête au logo BFR,
        bloc client, « Votre contact », page destinataire « À {lieu}, le … » puis le corps du compte rendu.
        Variables du modèle : <code>{{Client_Name}}</code> <code>{{Mail_Client}}</code> <code>{{numero_client}}</code>
        <code>{{Logo_Client}}</code> <code>{{Date}}</code> <code>{{Name_Technicien}}</code> <code>{{Poste_Tech}}</code>
        <code>{{Mail_Tech}}</code> <code>{{Num_Tech}}</code> <code>{{Client_Adress}}</code> <code>{{Client_Contact}}</code>
        — dans l'application : nom du client, e-mail, <strong>téléphone</strong>, logo (vide si absent), date,
        technicien (mes informations), adresse et contact.</p>
        ${f('societe.lieuLettre', 'Ville de la lettre')}
        <div class="field"><label>Adresse(s) du pied de page</label>
          <textarea data-sk="societe.piedPage" rows="2" placeholder="50 allée des érables, 01150 Blyes, France">${esc(
            (S.societe && S.societe.piedPage) || [S.societe && S.societe.siege1, S.societe && S.societe.siege2].filter(Boolean).join('\n'))}</textarea></div>
        <p class="small">Imprimée sous « ${esc((S.societe && S.societe.nom) || 'BFR SYSTEMS')} » en bas de chaque page.
          Une ligne par adresse (deux au plus). Vide = 50 allée des érables, 01150 Blyes, France.</p>
      </div>

      <div class="card"><h2>Liste clients & Annuaire</h2>
        <p class="small">${Clients.base().length
          ? `La liste du classeur « COORDONNÉES CLIENTS » est embarquée dans l'application
        (${Clients.base().length} client(s)) : tapez 3 lettres dans un rapport pour voir les correspondances.`
          : `Aucune liste n'est embarquée dans cette version de l'application : importez le fichier de la liste
        (le classeur « COORDONNÉES CLIENTS » tel quel en .xlsx, un export CSV ou un JSON) — elle sera conservée dans ce téléphone et restera disponible hors connexion.`}
        Les téléphones, e-mails, logos et contacts saisis sur le terrain sont mémorisés sur ce téléphone
        (${Object.keys(Clients.memo()).length} fiche(s) enrichie(s)) et proposés la prochaine fois.</p>
        <div style="margin:10px 0">
          <button class="btn" type="button" data-a="ouvrir-annuaire" style="width:100%">${(ICO.users && ICO.users(16)) || ''} Ouvrir l'annuaire & gérer les fiches clients</button>
        </div>
        <div class="filebtn"><input type="file" id="clientsImport"
            accept=".xlsx,.csv,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/comma-separated-values,application/json">
          <label for="clientsImport">${(ICO.download && ICO.download(16)) || ''} Mettre à jour la liste (classeur Excel .xlsx, CSV ou JSON)</label></div>
        <p class="small">Le fichier remplace la liste précédente ; il est conservé dans le téléphone et reste
        disponible hors connexion. Le même bouton sert à transmettre la liste à un collègue (le fichier se
        transmet par mail, messagerie ou Bluetooth).</p>
        <div class="btnrow">
          <button class="btn grey" data-a="clients-export">Exporter la liste actuelle</button>
          <button class="btn ghost" data-a="clients-reset">Revenir à la liste d'origine</button>
        </div>
      </div>

      <div class="card"><h2>Réglages d'équipe</h2>
        <p class="small">Un seul fichier pour configurer un téléphone neuf comme les autres : adresses d'envoi
        (responsable SAV, assistant, copies), société, mise en page, canevas, domaines et catégories.
        Vos informations personnelles (nom, téléphone, signature) n'y figurent pas.</p>
        <div class="filebtn"><input type="file" id="equipeImport" accept=".json,application/json">
          <label for="equipeImport">${(ICO.download && ICO.download(16)) || ''} Importer les réglages d'équipe</label></div>
        <div class="btnrow"><button class="btn grey" type="button" data-a="equipe-export">Exporter les réglages d'équipe</button></div>
      </div>

      <div class="card"><h2>Envoi du rapport</h2>
        ${f('mail.destinataireSAV', 'E-mail du responsable SAV', 'email', 'Ex. prenom.nom@societe.fr')}
        ${f('mail.assistantSAV', 'E-mail de l\'assistant SAV (en copie systématique)', 'email', 'Ex. assistant@societe.fr')}
        <p class="small" style="margin-top:-6px;margin-bottom:10px;color:#64748b">L'assistant SAV recevra systématiquement tous les e-mails adressés au responsable SAV en copie conforme (Cc).</p>
        ${f('mail.destinatairesCopie', 'Autres copies conformes (CC)', 'email', 'Ex. direction@societe.fr, support@societe.fr')}
        <div class="agreement"><input type="checkbox" id="chkClient" ${S.mail.envoyerClient ? 'checked' : ''}><label for="chkClient">Envoyer aussi au client</label></div>
        <div class="agreement"><input type="checkbox" id="chkSAV" ${S.mail.envoyerSAV ? 'checked' : ''}><label for="chkSAV">Envoyer au responsable SAV (avec assistant SAV en copie)</label></div>
        ${f('mail.objet', 'Objet du mail')}
        <label style="font-size:12.5px;font-weight:600">Corps du mail</label>
        <textarea id="setCorps" rows="8" style="width:100%">${esc(S.mail.corps || Report.defaultCorpsMail())}</textarea>
        <p class="small">Variables : {{numero}} {{client}} {{lieu}} {{contact}} {{date}} {{machine}} {{serie}} {{technicien}} {{societe}} {{duree}}</p>
      </div>

      <div class="card"><h2>Canevas du rapport (avancé)</h2>
        <p class="small">Le canevas décrit l'ordre des sections du rapport. Types acceptés : <code>synthese</code>, <code>evenements</code> (avec <code>categories</code>), <code>texte</code> (avec <code>champ</code> : actions, aPrevoir, resumeTechnicien, objet), <code>pieces</code>, <code>photos</code>, <code>signature</code>.</p>
        <textarea id="setCanevas" rows="12" style="width:100%;font-family:ui-monospace,monospace;font-size:12px">${esc(JSON.stringify(S.canevas, null, 1))}</textarea>
      </div>

      <div class="card"><h2>Mise en page du rapport</h2>
        <div class="field"><label for="setMiseEnPage">Évènements dans le PDF et le Word</label>
          <select id="setMiseEnPage" style="width:100%">
            <option value="compacte"${(S.impression.miseEnPageEvenements || 'compacte') === 'compacte' ? ' selected' : ''}>Compacte : à la suite, selon le nombre de photos</option>
            <option value="unParPage"${S.impression.miseEnPageEvenements === 'unParPage' ? ' selected' : ''}>Une page par évènement</option>
          </select></div>
        <p class="small">Compacte : sans photo, l'évènement prend juste la place de son texte ; avec 1 photo, texte à gauche et photo à droite ; avec 2 photos ou plus, les photos côte à côte sous le texte. Un évènement n'est jamais coupé entre deux pages.</p>
      </div>

      <div class="card"><h2>Domaines et catégories (avancé)</h2>
        <label style="font-size:12.5px;font-weight:600">Domaines</label>
        <textarea id="setDomaines" rows="4" style="width:100%;font-family:ui-monospace,monospace;font-size:12px">${esc(JSON.stringify(S.domaines, null, 1))}</textarea>
        <label style="font-size:12.5px;font-weight:600">Catégories</label>
        <textarea id="setCategories" rows="8" style="width:100%;font-family:ui-monospace,monospace;font-size:12px">${esc(JSON.stringify(S.categories, null, 1))}</textarea>
        <label style="font-size:12.5px;font-weight:600">Mention de signature client</label>
        <textarea id="setMention" rows="3" style="width:100%">${esc(S.impression.mentionClient)}</textarea>
      </div>

      <div class="btnrow"><button class="btn grey" data-a="fermer">Annuler</button>
        <button class="btn" data-a="enregistrer">Enregistrer</button></div></div>`, (panneau) => {
      const compresser = compresserImage;
      $('#logoInput', panneau).addEventListener('change', async (e) => {
        if (!e.target.files[0]) return;
        S.societe.logo = await compresser(e.target.files[0], 520, 0.92);
        Store.set(K.settings, S); toast('Logo enregistré'); rendreTout();
        e.target.previousElementSibling; // rien
      });
      /* ---------- Liste clients : import / export / remise à zéro ---------- */
      $('#equipeImport', panneau).addEventListener('change', (ev) => {
        const fichier = ev.target.files && ev.target.files[0];
        if (!fichier) return;
        const lecteur = new FileReader();
        lecteur.onload = () => {
          const n = importerReglagesEquipe(lecteur.result);
          if (!n) { toast('Fichier illisible : attendu un fichier de réglages d\'équipe (.json)', 4000); return; }
          toast('Réglages d\'équipe importés', 3000);
          const feuille = ev.target.closest('.sheet');
          if (feuille) feuille.remove();
          feuilleReglages();
        };
        lecteur.onerror = () => toast('Lecture impossible');
        lecteur.readAsText(fichier, 'utf-8');
      });
      /* Classeur .xlsx (Excel ou Google Sheets), CSV ou JSON : le fichier est lu en
         octets puis reconnu par son contenu (et non par son nom ou son type, que
         certains téléphones ne transmettent pas). */
      $('#clientsImport', panneau).addEventListener('change', (ev) => {
        const champ = ev.target;
        const fichier = champ.files && champ.files[0];
        if (!fichier) return;
        const lecteur = new FileReader();
        lecteur.onload = async () => {
          let res;
          try { res = await Clients.importerFichier(lecteur.result); }
          catch (e) { res = { n: 0, erreur: 'Lecture impossible : ' + ((e && e.message) || e) }; }
          champ.value = '';
          if (!res.n) { toast(res.erreur || 'Fichier illisible', 5000); return; }
          toast((res.contacts ? res.contacts + ' contact(s) pour ' + res.clients + ' client(s)' : res.n + ' client(s)') + ' chargé(s)' +
            (res.completes ? ', adresse ou logo repris de l\'ancienne liste pour ' + res.completes : '') +
            (res.logos ? ', ' + res.logos + ' logo(s)' : '') +
            (res.techniciens ? ', ' + res.techniciens + ' technicien(s)' : '') + ' — disponible hors connexion', 5000);
          const feuille = champ.closest('.sheet');
          if (feuille) feuille.remove();
          feuilleReglages();
        };
        lecteur.onerror = () => { champ.value = ''; toast('Lecture impossible'); };
        lecteur.readAsArrayBuffer(fichier);
      });
      panneau.addEventListener('click', (e) => {
        const iconeCard = e.target.closest('[data-icone-id]');
        if (iconeCard) {
          const id = iconeCard.dataset.iconeId;
          S.iconeApp = id;
          Store.set(K.settings, S);
          appliquerIconeApp(id);

          $$('.icone-card', panneau).forEach(c => {
            const estActif = c.dataset.iconeId === id;
            c.classList.toggle('actif', estActif);
            const titreEl = $('.icone-card-titre', c);
            if (titreEl) {
              const badge = $('.icone-badge-actif', titreEl);
              if (estActif && !badge) {
                const b = document.createElement('span');
                b.className = 'icone-badge-actif';
                b.textContent = 'Actif';
                titreEl.appendChild(b);
              } else if (!estActif && badge) {
                badge.remove();
              }
            }
          });
          const opt = ((typeof window !== 'undefined' && window.BFR_ICONES_OPTIONS) || []).find(o => o.id === id);
          toast('Icône appliquée : ' + (opt ? opt.titre : id));
          return;
        }
        if (e.target.closest('[data-a="identite"]')) { e.target.closest('.sheet').remove(); feuilleIdentite(); return; }
        if (e.target.closest('[data-a="ouvrir-annuaire"]')) { e.target.closest('.sheet').remove(); feuilleAnnuaireClients(); return; }
        if (e.target.closest('[data-a="equipe-export"]')) {
          const contenu = JSON.stringify(reglagesEquipe(), null, 1);
          telecharger(new Blob([contenu], { type: 'application/json' }), 'reglages-equipe-' + todayISO() + '.json');
          toast('Réglages d\'équipe exportés : transmettez le fichier aux collègues');
          return;
        }
        if (e.target.closest('[data-a="clients-export"]')) {
          const contenu = JSON.stringify({ clients: Clients.liste(),
            techniciens: Clients.listeTechniciens().map(t => ({ nom: t.nom })) }, null, 1);
          telecharger(new Blob([contenu], { type: 'application/json' }), 'clients-bfr-' + todayISO() + '.json');
          toast('Liste exportée'); return;
        }
        if (e.target.closest('[data-a="clients-reset"]')) {
          const message = Clients.embarques().length
            ? "Revenir à la liste clients embarquée dans l'application ?"
            : "Effacer la liste clients importée dans ce téléphone ?\nVous pourrez réimporter le fichier à tout moment.";
          const feuille = e.target.closest('.sheet');
          Dialogue.confirmer(message + "\nLes données enrichies (téléphones, e-mails, logos saisis sur le terrain) sont conservées.", { ok: 'Rétablir' }).then((oui) => {
            if (!oui) return;
            Clients.revenirListeOrigine();
            toast('Liste d\'origine rétablie');
            if (feuille) feuille.remove();
            feuilleReglages();
          });
          return;
        }
        const b = e.target.closest('[data-a="enregistrer"]');
        if (!b) return;
        // l'ancien couple « siège / 2e site » est remplacé par « Adresse(s) du pied de page »
        if ($('[data-sk="societe.piedPage"]', panneau)) { S.societe.siege1 = ''; S.societe.siege2 = ''; }
        ['societe.lieuLettre', 'societe.piedPage',
         'societe.nom', 'societe.sigle', 'societe.sigleSuffixe', 'societe.adresse', 'societe.cpVille', 'societe.tel',
         'societe.email', 'societe.siteWeb', 'societe.siret', 'societe.tva',
         'mail.destinataireSAV', 'mail.assistantSAV', 'mail.destinatairesCopie', 'mail.objet'
        ].forEach(k => { const el = $('[data-sk="' + k + '"]', panneau); if (el) setPath(S, k, el.value.trim()); });
        const saisieCorps = ($('#setCorps', panneau).value || '').trim();
        S.mail.corps = (saisieCorps === Report.defaultCorpsMail().trim()) ? '' : saisieCorps;
        S.impression.mentionClient = $('#setMention', panneau).value;
        S.impression.miseEnPageEvenements = $('#setMiseEnPage', panneau).value === 'unParPage' ? 'unParPage' : 'compacte';
        S.mail.envoyerClient = $('#chkClient', panneau).checked;
        S.mail.envoyerSAV = $('#chkSAV', panneau).checked;
        try {
          const canevas = JSON.parse($('#setCanevas', panneau).value);
          const domaines = JSON.parse($('#setDomaines', panneau).value);
          const categories = JSON.parse($('#setCategories', panneau).value);
          if (!canevas || !Array.isArray(canevas.sections) || !Array.isArray(domaines) || !Array.isArray(categories)) throw new Error('format');
          S.canevas = canevas; S.domaines = domaines; S.categories = categories;
        } catch (err) { toast('JSON invalide : réglages non enregistrés'); return; }
        Store.set(K.settings, S);
        if (!R.technicien) R.technicien = Report.nomComplet(S.technicien);
        e.target.closest('.sheet').remove();
        rendreTout();
        toast('Réglages enregistrés');
      });
    });
  }

  /* ===================== Sélecteur d'icône d'application ===================== */
  function feuilleIcones() {
    const options = (typeof window !== 'undefined' && window.BFR_ICONES_OPTIONS) || [];
    const canPrompt = !!deferredInstallPrompt;
    Ouvrir.ouvrir(null, `<div class="panel">
      <div class="grab"></div><h3>Icône de l'application</h3>
      <p class="sub">Choisissez l'icône BFR affichée sur votre smartphone (écran d'accueil et navigateur) :</p>
      <div class="icones-selecteur" style="margin-bottom:14px">
        ${options.map(opt => {
          const actif = (S.iconeApp || 'opt1') === opt.id;
          return `
            <div class="icone-card ${actif ? 'actif' : ''}" data-icone-id="${opt.id}">
              <img src="${opt.dataUri || opt.src192}" alt="${esc(opt.titre)}">
              <div class="icone-card-info">
                <div class="icone-card-titre">
                  <span>${esc(opt.titre)}</span>
                  ${actif ? '<span class="icone-badge-actif">Actif</span>' : ''}
                </div>
                <div class="icone-card-desc">${esc(opt.desc)}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="sticky-note" style="margin-top:8px; border-left:4px solid #06baf2; background:rgba(6,186,242,0.08); padding:10px 12px; border-radius:6px;">
        <strong style="color:#00a5bb; font-size:13px;">✨ Prise en charge immédiate (Zéro désinstallation requise) :</strong>
        <p style="margin:5px 0 0 0; font-size:12px; line-height:1.45; color:#1e293b;">
          Chaque icône dispose de son propre profil d'installation dédié. Vous n'avez <strong>jamais besoin de désinstaller l'application</strong> pour changer d'icône :
        </p>
        <ul style="margin:6px 0 0 16px; padding:0; font-size:12px; line-height:1.45; color:#1e293b;">
          <li>Sélectionnez votre icône ci-dessus.</li>
          <li>Touchez <strong>« Installer avec cette icône »</strong> ci-dessous (ou ouvrez le menu <strong>⋮ de Chrome → "Ajouter à l'écran d'accueil"</strong>).</li>
          <li>Le nouveau raccourci est créé directement avec l'icône choisie.</li>
        </ul>
      </div>

      <button class="btn btn-primary wide" data-a="installer-pwa" style="margin-top:12px; display:${canPrompt ? 'block' : 'none'}; background:#06baf2; color:#fff; font-weight:600;">
        📲 Installer avec cette icône sur l'écran d'accueil
      </button>

      <button class="btn wide" style="margin-top:12px" data-a="fermer">Fermer</button>
    </div>`, (panneau) => {
      panneau.addEventListener('click', (e) => {
        const iconeCard = e.target.closest('[data-icone-id]');
        if (iconeCard) {
          const id = iconeCard.dataset.iconeId;
          S.iconeApp = id;
          Store.set(K.settings, S);
          appliquerIconeApp(id);

          $$('.icone-card', panneau).forEach(c => {
            const estActif = c.dataset.iconeId === id;
            c.classList.toggle('actif', estActif);
            const titreEl = $('.icone-card-titre', c);
            if (titreEl) {
              const badge = $('.icone-badge-actif', titreEl);
              if (estActif && !badge) {
                const b = document.createElement('span');
                b.className = 'icone-badge-actif';
                b.textContent = 'Actif';
                titreEl.appendChild(b);
              } else if (!estActif && badge) {
                badge.remove();
              }
            }
          });
          const opt = options.find(o => o.id === id);
          toast('Icône sélectionnée : ' + (opt ? opt.titre : id));
          return;
        }

        if (e.target.closest('[data-a="installer-pwa"]')) {
          if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            deferredInstallPrompt.userChoice.then((choice) => {
              if (choice && choice.outcome === 'accepted') {
                toast('Icône ajoutée à votre écran d\'accueil !');
              }
              deferredInstallPrompt = null;
              const btn = panneau.querySelector('[data-a="installer-pwa"]');
              if (btn) btn.style.display = 'none';
            });
          } else {
            toast('Dans Chrome : touchez ⋮ puis « Ajouter à l\'écran d\'accueil »');
          }
        }
      });
    });
  }

  /* ===================== Actualisation / Vidage du cache ============= */
  async function actualiserApp() {
    toast('Vidage du cache et recherche de la dernière version...', 2800);
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          try {
            if (reg.active) reg.active.postMessage({ action: 'viderCache' });
            await reg.unregister();
          } catch (_) {}
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const key of keys) {
          try { await caches.delete(key); } catch (_) {}
        }
      }
    } catch (_) {}
    setTimeout(() => {
      const u = new URL(window.location.href);
      u.searchParams.set('_v', Date.now().toString());
      window.location.href = u.toString();
    }, 400);
  }

  /* ===================== SMS / appel d'arrivée sur site ================
     Un contact sur un fixe (numéro géographique : 01-05, ou +33 1-5…) ne reçoit
     pas de SMS utile : on propose alors de lancer l'appel direct. Les mobiles
     (06/07/08/09) restent sur le SMS d'arrivée. */
  function nettoyerTel(numero) {
    return String(numero || '').replace(/[^\d+]/g, '');
  }

  function estNumeroGeographique(numero) {
    let n = nettoyerTel(numero);
    if (/^\+33/.test(n)) n = n.slice(3);        // +33 1 40 00 00 00
    else if (/^33\d/.test(n)) n = n.slice(2);   // 33 1 40 00 00 00 (sans +)
    else if (/^0\d/.test(n)) n = n.slice(1);    // 01 40 00 00 00
    if (!/^\d{9}$/.test(n)) return false;       // pas un numéro français : on ne juge pas
    return /^[1-5]/.test(n);                    // 1-5 = fixe, 6-9 = mobile
  }

  /* Action d'arrivée sur site : « Appeler le contact » si le fixe, SMS sinon. */
  function contactArriveeAppel() {
    const c = R.client || {};
    return estNumeroGeographique(c.tel || c.numeroClient || '');
  }
  function icoContact(sz) {
    return contactArriveeAppel()
      ? ((ICO.phone && ICO.phone(sz)) || '📞')
      : ((ICO.sms && ICO.sms(sz)) || '💬');
  }

  /* ===================== SMS d'arrivée sur site ======================== */
  function feuilleSMSArrivee() {
    if (!R.client || !R.client.nom) {
      toast('Veuillez d\'abord renseigner le client', 3000);
      feuilleClient();
      return;
    }

    const c = R.client;
    let telClient = c.tel || c.numeroClient || '';
    let texteSMS = Report.texteSMSArrivee(R, S, R.langue && R.langue.active ? R.langue.code : 'fr');
    // Un fixe ne reçoit pas de SMS utile : on propose l'appel direct.
    const faireAppel = estNumeroGeographique(telClient);

    function genererUrlSMS(numero, corps) {
      // Format standard URI RFC 5724 supporté par Android et iOS :
      return 'sms:' + encodeURIComponent(nettoyerTel(numero)) + '?body=' + encodeURIComponent(corps);
    }
    function genererUrlTel(numero) {
      return 'tel:' + encodeURIComponent(nettoyerTel(numero));
    }

    const html = `<div class="panel">
      <div class="grab"></div>
      <h3>${icoContact(20)} ${faireAppel ? 'Appeler le contact' : 'Prévenir le contact par SMS'}</h3>
      <p class="sub">${faireAppel
        ? 'Lancez un appel vers le contact sur site pour lui annoncer votre arrivée et le début de l\'intervention.'
        : 'Envoyez un SMS professionnel au contact sur site pour lui annoncer votre arrivée et le début de l\'intervention.'}</p>

      <div class="card" style="margin-bottom:10px">
        <div class="field">
          <label style="font-weight:600">Numéro de téléphone du contact</label>
          <div style="display:flex;gap:6px;align-items:center">
            <input type="tel" id="smsNumeroDest" value="${esc(telClient)}" placeholder="Ex. 06 12 34 56 78" style="flex:1">
          </div>
          <p class="small" style="margin-top:4px;color:#64748b">Contact : <strong>${esc(c.contact || 'Non renseigné')}</strong> (${esc(c.nom || 'Client')})</p>
        </div>

        ${faireAppel ? '' : `
        <div class="field" style="margin-top:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <label style="font-weight:600;margin:0">Message pré-rempli</label>
            <button type="button" class="btn ghost sm" id="btnReinitSMS" style="padding:2px 8px;font-size:11px">Réinitialiser</button>
          </div>
          <textarea id="smsTexteMessage" rows="6" style="width:100%;font-size:13px;line-height:1.4;padding:8px">${esc(texteSMS)}</textarea>
          <p class="small" style="color:#64748b;margin-top:4px">Vous pouvez ajuster le message (ex. préciser un point d'accueil ou de garde).</p>
        </div>`}
      </div>

      <div class="btnrow" style="flex-direction:column;gap:8px">
        <a id="btnLancerSMS" href="${esc(faireAppel ? genererUrlTel(telClient) : genererUrlSMS(telClient, texteSMS))}" class="btn wide" style="text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:8px;font-size:14px;padding:11px;background:var(--bleu,#06baf2);color:#fff">
          ${icoContact(18)} ${faireAppel ? 'Appeler le contact' : 'Ouvrir l\'application SMS du téléphone'}
        </a>
        <div style="display:flex;gap:8px;width:100%">
          ${faireAppel
            ? '<button type="button" class="btn sm grey" id="btnCopierNumero" style="flex:1">Copier le numéro</button>'
            : '<button type="button" class="btn sm grey" id="btnCopierSMS" style="flex:1">Copier le texte</button>'}
          <button type="button" class="btn sm grey" data-a="fermer" style="flex:1">Fermer</button>
        </div>
      </div>
    </div>`;

    Ouvrir.ouvrir(null, html, (panneau) => {
      const inpNum = $('#smsNumeroDest', panneau);
      const txtMsg = $('#smsTexteMessage', panneau);
      const btnLien = $('#btnLancerSMS', panneau);
      const btnReinit = $('#btnReinitSMS', panneau);
      const btnCopier = $('#btnCopierSMS', panneau);
      const btnCopierNum = $('#btnCopierNumero', panneau);

      /* Le bouton bascule SMS / appel dès que le numéro saisi change de nature. */
      function rendreBouton(num) {
        const appel = estNumeroGeographique(num);
        const icone = (appel ? (ICO.phone && ICO.phone(18)) : (ICO.sms && ICO.sms(18))) || (appel ? '📞' : '💬');
        const txt = appel ? 'Appeler le contact' : 'Ouvrir l\'application SMS du téléphone';
        btnLien.innerHTML = icone + ' ' + txt;
        btnLien.href = appel ? genererUrlTel(num) : genererUrlSMS(num, txtMsg ? txtMsg.value : texteSMS);
      }

      function actualiserLien() {
        const num = inpNum.value.trim();
        rendreBouton(num);
        if (num && !c.tel) {
          c.tel = num;
          planifier();
        }
      }

      inpNum.addEventListener('input', actualiserLien);
      if (txtMsg) txtMsg.addEventListener('input', actualiserLien);

      panneau.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-a="fermer"]')) {
          const sh = panneau.closest('.sheet');
          if (sh) sh.remove();
          rendreTout();
        }
      });

      btnLien.addEventListener('click', (e) => {
        const num = inpNum.value.trim();
        if (!num) {
          e.preventDefault();
          toast('Veuillez indiquer un numéro de téléphone');
          inpNum.focus();
          return;
        }
        setTimeout(() => {
          const sh = panneau.closest('.sheet');
          if (sh) sh.remove();
        }, 1200);
        toast(estNumeroGeographique(num) ? 'Ouverture du téléphone...' : 'Ouverture de l\'application SMS...');
      });

      if (btnReinit && txtMsg) {
        btnReinit.addEventListener('click', () => {
          txtMsg.value = Report.texteSMSArrivee(R, S, R.langue && R.langue.active ? R.langue.code : 'fr');
          actualiserLien();
          toast('Message réinitialisé');
        });
      }

      if (btnCopier) {
        btnCopier.addEventListener('click', () => {
          copier(txtMsg.value);
          toast('Texte du SMS copié dans le presse-papier');
        });
      }

      if (btnCopierNum) {
        btnCopierNum.addEventListener('click', () => {
          copier(nettoyerTel(inpNum.value.trim()));
          toast('Numéro copié dans le presse-papier');
        });
      }
    });
  }

  /* ===================== Annuaire clients ============================= */
  function feuilleAnnuaireClients(clientNomInitial) {
    function normTxt(t) {
      return String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
    }

    // ouvert depuis l'intervention : la fiche du contact de l'intervention
    const contactInitial = (clientNomInitial && normTxt(clientNomInitial) === normTxt(R.client.nom)) ? R.client.contact : '';
    let clientEdite = clientNomInitial ? (Clients.parNom(clientNomInitial, contactInitial) || { nom: clientNomInitial, isNouveau: true }) : null;
    let modeEdition = !!clientEdite;
    let recherche = '';
    let logoTemp = clientEdite ? (clientEdite.logo || '') : '';
    let visibles = [];          // fiches affichées : une carte = une ligne (un client, ou un contact d'un client)
    let contactOrigine = null;  // contact de la fiche ouverte, tel qu'il était avant modification

    Ouvrir.ouvrir(null, `<div class="panel" style="max-height:90vh;display:flex;flex-direction:column">
      <div id="annuaireCorps" style="display:flex;flex-direction:column;min-height:0;flex:1"></div>
    </div>`, (pan) => {
      const zoneCorps = $('#annuaireCorps', pan);

      /* Liste de l'annuaire. Le cadre (titre, recherche) est dessiné une fois ; seule
         la liste est redessinée pendant la frappe : redessiner aussi le champ de
         recherche fermait le clavier de l'iPhone à chaque lettre. */
      function afficherListe() {
        modeEdition = false;
        clientEdite = null;
        contactOrigine = null;
        zoneCorps.innerHTML = `
          <div class="grab"></div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <h3 style="margin:0">${(ICO.users && ICO.users(20)) || ''} Annuaire clients</h3>
            <button type="button" class="btn sm" data-a="nouveau-client">${(ICO.plus && ICO.plus(14)) || ''} Nouveau client</button>
          </div>
          <p class="sub" style="margin-bottom:8px">Consultez ou enrichissez les coordonnées clients. Les modifications sont conservées sur ce téléphone <strong>sans modifier votre intervention en cours</strong>.</p>

          <div style="margin-bottom:8px">
            <input type="search" id="inputRechercheAnnuaire" autocomplete="off" placeholder="Rechercher par nom, ville, contact, e-mail..." value="${esc(recherche)}" style="width:100%;font-size:16px;padding:8px 12px;border:1px solid var(--bord,#cbd5e1);border-radius:8px">
          </div>

          <div id="annuaireCompte" style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:#64748b;margin-bottom:8px"></div>

          <div id="listeCartesClients" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-right:2px"></div>

          <div class="btnrow" style="margin-top:10px">
            <button type="button" class="btn grey wide" data-a="fermer-annuaire">Fermer</button>
          </div>
        `;
        const inp = $('#inputRechercheAnnuaire', zoneCorps);
        if (inp) inp.addEventListener('input', () => { recherche = inp.value; majListe(); });
        majListe();
      }

      function majListe() {
        const tousClients = Clients.liste();
        const memo = Clients.memo();
        const q = normTxt(recherche);
        let filtres = tousClients;
        if (q.length >= 2) {
          filtres = tousClients.filter(c => {
            return normTxt(c.nom).indexOf(q) !== -1 ||
                   normTxt(c.ville).indexOf(q) !== -1 ||
                   normTxt(c.contact).indexOf(q) !== -1 ||
                   normTxt(c.email).indexOf(q) !== -1;
          });
        }
        // Tri : fiches enrichies d'abord, puis ordre alphabétique (contacts d'un même client groupés)
        filtres = filtres.map((c, i) => ({ c: c, i: i })).sort((a, b) => {
          const aMemo = !!memo[normTxt(a.c.nom)];
          const bMemo = !!memo[normTxt(b.c.nom)];
          if (aMemo && !bMemo) return -1;
          if (!aMemo && bMemo) return 1;
          return String(a.c.nom || '').localeCompare(String(b.c.nom || ''), 'fr') || (a.i - b.i);
        }).map(x => x.c);

        const nbMemo = Object.keys(memo).length;
        const afficherMax = 50;
        visibles = filtres.slice(0, afficherMax);

        const compte = $('#annuaireCompte', zoneCorps);
        if (compte) compte.innerHTML = `<span>${filtres.length} fiche(s) trouvée(s) ${filtres.length > afficherMax ? '(50 premières)' : ''}</span>
            <span>${nbMemo} fiche(s) personnalisée(s)</span>`;
        const zoneListe = $('#listeCartesClients', zoneCorps);
        if (!zoneListe) return;
        zoneListe.innerHTML = visibles.length ? visibles.map((c, idx) => {
              const estEnrichi = !!memo[normTxt(c.nom)];
              return `
                <div class="card" data-client-idx="${idx}" style="margin:0;padding:10px 12px;cursor:pointer;border:1px solid ${estEnrichi ? 'var(--bleu,#06baf2)' : 'var(--bord,#e2e8f0)'};border-radius:8px;background:#fff;transition:background 0.15s">
                  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
                    <div style="min-width:0;flex:1">
                      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                        <strong style="font-size:13.5px;color:var(--bleu-fonce,#332e72)">${esc(c.nom)}</strong>
                        ${estEnrichi ? `<span style="font-size:10px;font-weight:600;background:#e0f2fe;color:#0284c7;padding:1px 6px;border-radius:4px">Fiche enrichie</span>` : ''}
                      </div>
                      ${c.ville || c.adresse ? `<div style="font-size:12px;color:#64748b;margin-top:2px">${esc([c.ville, c.adresse].filter(Boolean).join(' — '))}</div>` : ''}
                      <div style="display:flex;gap:12px;margin-top:4px;font-size:11.5px;color:#475569;flex-wrap:wrap">
                        ${c.contact ? `<span>${(ICO.user && ICO.user(12)) || ''} ${esc(c.contact)}${c.fonction ? ' (' + esc(c.fonction) + ')' : ''}</span>` : ''}
                        ${c.tel ? `<span>📞 ${esc(c.tel)}</span>` : ''}
                        ${c.email ? `<span>✉ ${esc(c.email)}</span>` : ''}
                      </div>
                    </div>
                    <button type="button" class="btn sm grey" data-client-idx="${idx}" style="padding:4px 10px;font-size:11.5px;flex-shrink:0">Modifier</button>
                  </div>
                </div>`;
            }).join('') : `
              <div style="text-align:center;padding:24px 12px;color:#64748b">
                <p>Aucun client trouvé pour « ${esc(recherche)} »</p>
                <button type="button" class="btn sm" data-a="creer-recherche" style="margin-top:8px">${(ICO.plus && ICO.plus(14)) || ''} Créer la fiche « ${esc(recherche)} »</button>
              </div>`;
      }

      function afficherFormulaire(client, isNouveau, nouveauContact) {
        modeEdition = true;
        client = client || { nom: '', adresse: '', ville: '', contact: '', fonction: '', tel: '', email: '', logo: '', langue: '', numeroClient: '', autresContacts: '' };
        clientEdite = client;
        // le contact ouvert (pour un client à plusieurs contacts, c'est CE contact qui est modifié)
        contactOrigine = (isNouveau || nouveauContact) ? '' : (client.contact || '');
        logoTemp = client.logo || '';
        const memo = Clients.memo();
        const estDansMemo = !!memo[normTxt(client.nom)];
        const estClientActif = normTxt(R.client.nom) && normTxt(R.client.nom) === normTxt(client.nom);

        const fAnnuaire = (id, label, type, val, ph) => `
          <div class="field" style="margin-bottom:8px">
            <label style="font-size:12px;font-weight:600;margin-bottom:3px;display:block">${esc(label)}</label>
            <input type="${type || 'text'}" id="${id}" value="${esc(val || '')}" placeholder="${esc(ph || '')}" style="width:100%">
          </div>`;

        zoneCorps.innerHTML = `
          <div class="grab"></div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <h3 style="margin:0">${isNouveau ? 'Nouveau client' : (nouveauContact ? 'Nouveau contact' : 'Fiche client')}</h3>
            <button type="button" class="btn ghost sm" data-a="retour-liste">← Annuaire</button>
          </div>

          <div class="sticky-note" style="margin:6px 0 10px 0;background:#f0f9ff;border-left:4px solid var(--bleu,#06baf2);padding:6px 10px;font-size:11.5px;color:#0369a1">
            ${estClientActif
              ? `Ce client correspond à votre <strong>intervention en cours</strong> : l'enregistrement mettra à jour l'annuaire ET votre rapport.`
              : `Modifications enregistrées dans l'annuaire durable du téléphone. Votre intervention en cours (<strong>${esc(R.numero || 'N°')} — ${esc(R.client.nom || 'Sans client')}</strong>) ne sera pas modifiée.`}
          </div>

          <div style="flex:1;overflow-y:auto;padding-right:2px">
            ${fAnnuaire('annNom', 'Nom de la société / client *', 'text', client.nom, 'Ex. CLIENT EXEMPLE 1')}
            <div class="grid2">
              ${fAnnuaire('annContact', 'Contact sur site (nom)', 'text', client.contact, 'Ex. M. Rivière')}
              ${fAnnuaire('annFonction', 'Fonction du contact', 'text', client.fonction, 'Ex. Responsable maintenance')}
            </div>
            <div class="grid2">
              ${fAnnuaire('annTel', 'Téléphone ({numero_client})', 'tel', client.tel || client.numeroClient, 'Ex. 04 78 55 44 33')}
              ${fAnnuaire('annEmail', 'E-mail du client', 'email', client.email, 'Ex. contact@client.fr')}
            </div>
            ${fAnnuaire('annAdresse', 'Adresse du client', 'text', client.adresse, 'Rue, code postal, ville')}
            ${fAnnuaire('annVille', 'Ville / Lieu habituel', 'text', client.ville || client.lieu, 'Ex. Blyes')}

            <div class="field" style="margin-bottom:8px">
              <label style="font-size:12px;font-weight:600;margin-bottom:3px;display:block">Langue habituelle de correspondance</label>
              <select id="annLangue" style="width:100%;padding:8px;border:1px solid var(--bord,#cbd5e1);border-radius:6px">
                <option value="" ${!client.langue ? 'selected' : ''}>Par défaut (Français)</option>
                <option value="en" ${client.langue === 'en' ? 'selected' : ''}>Anglais (English)</option>
                <option value="de" ${client.langue === 'de' ? 'selected' : ''}>Allemand (Deutsch)</option>
                <option value="nl" ${client.langue === 'nl' ? 'selected' : ''}>Néerlandais (Nederlands)</option>
                <option value="es" ${client.langue === 'es' ? 'selected' : ''}>Espagnol (Español)</option>
                <option value="it" ${client.langue === 'it' ? 'selected' : ''}>Italien (Italiano)</option>
                <option value="pt" ${client.langue === 'pt' ? 'selected' : ''}>Portugais (Português)</option>
              </select>
            </div>

            <div class="field" style="margin-bottom:8px">
              <label style="font-size:12px;font-weight:600;margin-bottom:3px;display:block">Logo du client (facultatif)</label>
              <div class="filebtn"><input type="file" id="annLogoInput" accept="image/*">
                <label for="annLogoInput">${(ICO.image && ICO.image(16)) || ''} ${logoTemp ? 'Changer le logo' : 'Ajouter un logo'}</label></div>
              <div id="annApercuLogo" style="margin-top:6px">
                ${logoTemp ? `<img src="${logoTemp}" style="max-height:48px;background:#fff;border:1px solid var(--bord);border-radius:6px">
                  <button type="button" class="btn sm danger" data-a="supprimer-logo-annuaire" style="margin-left:8px;padding:2px 8px;font-size:11px">Retirer</button>`
                           : '<span class="small" style="color:#64748b">Sans logo</span>'}
              </div>
            </div>

            <div class="field" style="margin-bottom:8px">
              <label style="font-size:12px;font-weight:600;margin-bottom:3px;display:block">Autres contacts / Notes internes</label>
              <input type="text" id="annNotes" value="${esc(client.noteContacts || client.autresContacts || '')}" placeholder="Ex. Chef d'équipe poste matin : 06..." style="width:100%">
            </div>
          </div>

          ${(!isNouveau && !nouveauContact) ? `<button type="button" class="btn ghost sm" data-a="ajouter-contact-client" style="width:100%;margin-top:6px">${(ICO.plus && ICO.plus(14)) || ''} Ajouter un autre contact pour ce client</button>` : ''}

          <div class="btnrow" style="margin-top:10px">
            <button type="button" class="btn grey" data-a="retour-liste">Annuler</button>
            <button type="button" class="btn" data-a="enregistrer-client">Enregistrer dans l'annuaire</button>
          </div>

          ${estDansMemo ? `
            <div style="text-align:right;margin-top:8px">
              <button type="button" class="btn ghost danger sm" data-a="reinitialiser-fiche" style="font-size:11px">Réinitialiser les personnalisations locales de ce client</button>
            </div>` : ''}
        `;

        const inpLogo = $('#annLogoInput', zoneCorps);
        if (inpLogo) {
          inpLogo.addEventListener('change', async (ev) => {
            if (!ev.target.files[0]) return;
            try {
              logoTemp = await compresserImage(ev.target.files[0], 520, 0.92);
              const apercu = $('#annApercuLogo', zoneCorps);
              if (apercu) {
                apercu.innerHTML = `<img src="${logoTemp}" style="max-height:48px;background:#fff;border:1px solid var(--bord);border-radius:6px">
                  <button type="button" class="btn sm danger" data-a="supprimer-logo-annuaire" style="margin-left:8px;padding:2px 8px;font-size:11px">Retirer</button>`;
              }
            } catch (err) { toast('Image illisible'); }
          });
        }
      }

      // Gestion des clics dans l'annuaire
      zoneCorps.addEventListener('click', (ev) => {
        const btnFermer = ev.target.closest('[data-a="fermer-annuaire"]');
        if (btnFermer) { pan.closest('.sheet').remove(); return; }

        const btnRetour = ev.target.closest('[data-a="retour-liste"]');
        if (btnRetour) { afficherListe(); return; }

        const btnNouveau = ev.target.closest('[data-a="nouveau-client"]');
        if (btnNouveau) { afficherFormulaire(null, true); return; }

        const btnCreerRech = ev.target.closest('[data-a="creer-recherche"]');
        if (btnCreerRech) { afficherFormulaire({ nom: recherche.trim() }, true); return; }

        const carteClient = ev.target.closest('[data-client-idx]');
        if (carteClient) {
          // la fiche exacte de la carte (et non la première fiche portant ce nom de client)
          const c = visibles[+carteClient.dataset.clientIdx];
          if (c) afficherFormulaire(Object.assign({}, c), false);
          return;
        }

        const btnAjContact = ev.target.closest('[data-a="ajouter-contact-client"]');
        if (btnAjContact) {
          const base = Object.assign({}, clientEdite || {}, { nom: ($('#annNom', zoneCorps).value || '').trim() || (clientEdite && clientEdite.nom) || '' });
          afficherFormulaire(Object.assign(base, { contact: '', fonction: '', tel: '', email: '', numeroClient: '' }), false, true);
          return;
        }

        const btnSupprLogo = ev.target.closest('[data-a="supprimer-logo-annuaire"]');
        if (btnSupprLogo) {
          logoTemp = '';
          const apercu = $('#annApercuLogo', zoneCorps);
          if (apercu) apercu.innerHTML = '<span class="small" style="color:#64748b">Sans logo</span>';
          return;
        }

        const btnResetFiche = ev.target.closest('[data-a="reinitialiser-fiche"]');
        if (btnResetFiche) {
          const nom = ($('#annNom', zoneCorps).value || '').trim();
          Dialogue.confirmer('Supprimer les données locales enregistrées pour « ' + nom + ' » et revenir aux données d\'origine ?', { ok: 'Réinitialiser', danger: true }).then((oui) => {
            if (!oui) return;
            Clients.oublier(nom);
            toast('Fiche ' + nom + ' réinitialisée');
            afficherListe();
          });
          return;
        }

        const btnSave = ev.target.closest('[data-a="enregistrer-client"]');
        if (btnSave) {
          const nom = ($('#annNom', zoneCorps).value || '').trim();
          if (!nom) { toast('Veuillez saisir un nom de client'); $('#annNom', zoneCorps).focus(); return; }

          const adresse = ($('#annAdresse', zoneCorps).value || '').trim();
          const ville = ($('#annVille', zoneCorps).value || '').trim();
          const contact = ($('#annContact', zoneCorps).value || '').trim();
          const fonction = ($('#annFonction', zoneCorps).value || '').trim();
          const tel = ($('#annTel', zoneCorps).value || '').trim();
          const email = ($('#annEmail', zoneCorps).value || '').trim();
          const langue = ($('#annLangue', zoneCorps).value || '').trim();
          const notes = ($('#annNotes', zoneCorps).value || '').trim();

          const donnees = {
            nom: nom,
            adresse: adresse,
            lieu: ville,
            ville: ville,
            contact: contact,
            fonction: fonction,
            tel: tel,
            email: email,
            logo: logoTemp || '',
            langue: langue,
            numeroClient: tel,
            autresContacts: notes
          };

          if (!Clients.retenir(donnees, contactOrigine)) {
            toast('Enregistrement impossible : mémoire du navigateur pleine', 4000);
            return;
          }

          // Vérifier si le client édité est le client de l'intervention active
          const estActif = normTxt(R.client.nom) && normTxt(R.client.nom) === normTxt(nom);
          // … et si c'est bien le contact de l'intervention (un client peut en avoir plusieurs)
          const memeContact = !normTxt(R.client.contact) || normTxt(R.client.contact) === normTxt(contactOrigine || contact);
          if (estActif) {
            R.client.adresse = adresse;
            R.client.lieu = ville;
            R.client.logo = logoTemp || '';
            R.client.noteContacts = notes;
            if (memeContact) {
              R.client.contact = contact;
              R.client.fonction = fonction;
              R.client.tel = tel;
              R.client.email = email;
              R.client.numeroClient = tel;
            }
            if (langue) R.client.langue = langue;
            planifier(); rendreEntete(); rendreTout();
            toast('Fiche « ' + nom + ' » enregistrée (intervention en cours actualisée)');
          } else {
            toast('Fiche « ' + nom + ' » enregistrée dans l\'annuaire');
          }

          afficherListe();
        }
      });

      // Initialisation
      if (modeEdition && clientEdite) {
        afficherFormulaire(clientEdite, !!clientEdite.isNouveau);
      } else {
        afficherListe();
      }
    });
  }

  /* ===================== Menu ========================================= */
  function feuilleMenu() {
    const liste = Store.get(K.rapports, []);
    const ver = (typeof window !== 'undefined' && window.SAV_VERSION) || 'locale';
    const dateVer = (typeof window !== 'undefined' && window.SAV_DATE) || '25/09/2026';
    Ouvrir.ouvrir(null, `<div class="panel">
      <div class="grab"></div><h3>Menu</h3>
      <p class="sub">Rapport N° ${esc(R.numero || '—')} — ${esc(R.client.nom || 'client non renseigné')}</p>
      <button class="menu-item" data-a="signer"><span class="ico">${(ICO.signature && ICO.signature(18)) || ''}</span><span>Faire signer le client<small>${R.signatureClient && R.signatureClient.dataUrl ? 'Signé par ' + esc(R.signatureClient.nom || 'le client') : 'Signature tactile sur écran'}</small></span></button>
      <button class="menu-item" data-a="soumettre"><span class="ico">${(ICO.send && ICO.send(18)) || ''}</span><span>Soumettre le rapport<small>Transmission PDF par e-mail</small></span></button>
      <button class="menu-item" data-a="identite"><span class="ico">${(ICO.user && ICO.user(18)) || ''}</span><span>Mes informations<small>${esc(Report.nomComplet(S.technicien) || 'nom, téléphone, e-mail à renseigner')}</small></span></button>
      <button class="menu-item" data-a="annuaire"><span class="ico">${(ICO.users && ICO.users(18)) || (ICO.user && ICO.user(18)) || ''}</span><span>Annuaire clients<small>Consulter, modifier ou ajouter un client hors intervention</small></span></button>
      <button class="menu-item" data-a="sms-arrivee"><span class="ico">${icoContact(18)}</span><span>${contactArriveeAppel() ? 'Appeler le contact' : 'Prévenir le contact par SMS'}<small>Annoncer votre arrivée sur site au contact client</small></span></button>
      <button class="menu-item" data-a="icones"><span class="ico">${(ICO.palette && ICO.palette(18)) || (ICO.gear && ICO.gear(18)) || ''}</span><span>Icône de l'application<small>Changer l'icône sur l'écran d'accueil Android</small></span></button>
      <button class="menu-item" data-a="reglages"><span class="ico">${(ICO.gear && ICO.gear(18)) || ''}</span><span>Réglages<small>Société, envoi, canevas du rapport</small></span></button>
      <button class="menu-item" data-a="actualiser"><span class="ico">${(ICO.clock && ICO.clock(18)) || ''}</span><span>Actualiser l'application<small>Vider le cache et forcer la dernière version</small></span></button>
      <button class="menu-item" data-a="nouveau"><span class="ico">${(ICO.plus && ICO.plus(18)) || ''}</span><span>Nouvelle intervention<small>Le rapport en cours reste dans l'historique</small></span></button>
      <button class="menu-item" data-a="historique"><span class="ico">${(ICO.folder && ICO.folder(18)) || ''}</span><span>Rapports enregistrés (${liste.length})</span></button>
      <button class="menu-item" data-a="export"><span class="ico">${(ICO.package && ICO.package(18)) || ''}</span><span>Exporter la sauvegarde (JSON)</span></button>
      <button class="menu-item" data-a="import"><span class="ico">${(ICO.download && ICO.download(18)) || ''}</span><span>Importer une sauvegarde</span></button>
      <button class="menu-item" data-a="aide"><span class="ico">${(ICO.help && ICO.help(18)) || ''}</span><span>Mode d'emploi</span></button>
      ${sauvegardeEnRetard() ? `<div class="sticky-note" style="margin-top:8px;border-color:#f59e0b;background:#fffbeb"><strong>Sauvegarde conseillée</strong> — ${joursDepuisSauvegarde() === null ? 'aucune sauvegarde exportée pour l\'instant' : 'dernière il y a ' + joursDepuisSauvegarde() + ' jours'}. Les rapports et photos ne sont que dans ce téléphone : « Exporter la sauvegarde » puis rangez le fichier (Drive, e-mail…).</div>` : ''}
      <div class="sticky-note" style="margin-top:8px">${Store.ok ? 'Tout est conservé sur ce téléphone — rien n\'est envoyé sans votre accord.' : 'Stockage local indisponible : pensez à exporter votre travail.'}</div>
      <div style="text-align:center;font-size:11px;color:#64748b;margin:10px 0 4px 0;padding:6px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0">Version active : <strong>${esc(ver)}</strong> (${esc(dateVer)})</div>
      <button class="btn grey wide" style="margin-top:10px" data-a="fermer">Fermer</button></div>`, (panneau) => {
      panneau.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]:not([data-a="fermer"])');
        if (!b) return;
        const a = b.dataset.a;
        e.target.closest('.sheet').remove();
        if (a === 'signer') signerClient();
        else if (a === 'soumettre') soumettre();
        else if (a === 'identite') feuilleIdentite();
        else if (a === 'annuaire') feuilleAnnuaireClients();
        else if (a === 'sms-arrivee') feuilleSMSArrivee();
        else if (a === 'icones') feuilleIcones();
        else if (a === 'reglages') feuilleReglages();
        else if (a === 'actualiser') actualiserApp();
        else if (a === 'nouveau') {
          Dialogue.confirmer('Créer une nouvelle intervention ? Le rapport en cours reste dans l\'historique.', { ok: 'Créer' }).then((oui) => {
            if (!oui) return;
            sauver(true);
            R = nouvelleIntervention();
            R.numeroAuto = true;
            R.typeIntervention = 'sav';
            Cache.pdf = Cache.docx = null; Cache.clePdf = Cache.cleDocx = Cache.cleTrad = '';
            Store.set(K.rapport, R);
            // pas d'enregistrement en base tant que le rapport est vierge (voir rapportVierge)
            rendreTout();
            toast('Nouvelle intervention — N° ' + R.numero);
          });
        } else if (a === 'historique') feuilleHistorique();
        else if (a === 'aide') feuilleAide();
        else if (a === 'export') exporterSauvegarde();
        else if (a === 'import') {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = '.json,application/json';
          inp.onchange = () => {
            const f = inp.files[0]; if (!f) return;
            const r = new FileReader();
            r.onload = async () => {
              try {
                const d = JSON.parse(r.result);
                let nbImportes = 0;
                let nbPhotosTotal = 0;

                if (d.reglages) {
                  S = fusion(settingsDefaut, d.reglages);
                  Store.set(K.settings, S);
                }

                const listeRapports = Array.isArray(d.rapports)
                  ? d.rapports
                  : (Array.isArray(d) ? d : null);

                if (listeRapports && listeRapports.length) {
                  for (const rep of listeRapports) {
                    if (rep && (rep.id || rep.numero)) {
                      if (typeof RapportDB !== 'undefined') {
                        await RapportDB.sauverRapport(rep);
                        await RapportDB.restaurerPhotos(rep);
                      }
                      nbImportes++;
                      nbPhotosTotal += (rep.evenements || []).reduce((acc, e) => acc + ((e.photos || []).filter(p => p && p.dataUrl).length), 0);
                      nbPhotosTotal += (rep.photosLibres || []).filter(p => p && p.dataUrl).length;
                      if (rep.pieces) nbPhotosTotal += rep.pieces.filter(p => p && p.photo).length;
                    }
                  }
                  const existants = Store.get(K.rapports, []);
                  listeRapports.forEach(rep => {
                    const idx = existants.findIndex(x => x.id === rep.id);
                    if (idx >= 0) existants[idx] = rep; else existants.unshift(rep);
                  });
                  ecrireHistoriqueLocal(existants);
                }

                const rapActif = d.rapport || (!listeRapports && (d.id || d.numero || d.evenements) ? d : null);
                if (rapActif) {
                  if (typeof RapportDB !== 'undefined') {
                    await RapportDB.sauverRapport(rapActif);
                    await RapportDB.restaurerPhotos(rapActif);
                  }
                  R = fusion(nouvelleIntervention(), rapActif);
                  Store.set(K.rapport, R);
                  if (typeof RapportDB !== 'undefined') {
                    await RapportDB.sauverRapport(R);
                  }
                  nbImportes = Math.max(nbImportes, 1);
                  const phR = (R.evenements || []).reduce((acc, e) => acc + ((e.photos || []).filter(p => p && p.dataUrl).length), 0)
                    + (R.photosLibres || []).filter(p => p && p.dataUrl).length;
                  if (!listeRapports) nbPhotosTotal = phR;
                } else if (listeRapports && listeRapports.length) {
                  const premier = listeRapports[0];
                  if (typeof RapportDB !== 'undefined') {
                    await RapportDB.restaurerPhotos(premier);
                  }
                  R = fusion(nouvelleIntervention(), premier);
                  Store.set(K.rapport, R);
                  if (typeof RapportDB !== 'undefined') {
                    await RapportDB.sauverRapport(R);
                  }
                }

                Cache.pdf = Cache.docx = null; Cache.clePdf = Cache.cleDocx = Cache.cleTrad = '';
                rendreTout();
                const msg = nbPhotosTotal > 0
                  ? `Sauvegarde importée (${nbImportes} intervention(s), ${nbPhotosTotal} photo(s) rétablie(s))`
                  : `Sauvegarde importée (${nbImportes} intervention(s))`;
                toast(msg, 3500);
              } catch (err) {
                console.error(err);
                toast('Fichier invalide : impossible de lire la sauvegarde');
              }
            };
            r.readAsText(f);
          };
          inp.click();
        }
      });
    });
  }

  /* ===================== Rapports enregistrés ======================== */
  const MOIS_MENAGE = 6;
  async function feuilleHistorique() {
    /* Liste légère : seulement les résumés (numéro, client, date, nombre de photos…).
       Les photos ne sont chargées qu'à la réouverture d'un rapport. */
    let liste = null;
    if (typeof RapportDB !== 'undefined' && RapportDB.disponible()) {
      try { liste = await RapportDB.resumes(); } catch (e) { liste = null; }
    }
    if (!liste || !liste.length) {
      liste = Store.get(K.rapports, []).filter(Boolean).map(r => RapportDB.resume(r, null));
    }
    if (R && R.id && !rapportVierge(R)) {
      const resumeR = RapportDB.resume(R, null);
      resumeR.perdues = RapportDB.imagesManquantes ? RapportDB.imagesManquantes(R) : 0;
      const idx = liste.findIndex(x => x.id === R.id);
      if (idx >= 0) liste[idx] = resumeR; else liste.unshift(resumeR);
    }
    liste = liste.filter(r => r && r.id && (r.id === R.id || !r.vierge));
    liste.sort((a, b) => ((b.maj || b.cree || b.date || '') > (a.maj || a.cree || a.date || '') ? 1 : -1));

    // Ménage : rapports terminés (signés, terminés ou transmis) de plus de 6 mois
    const limite = new Date(); limite.setMonth(limite.getMonth() - MOIS_MENAGE);
    const limiteISO = limite.toISOString().slice(0, 10);
    const anciens = liste.filter(r => r.id !== R.id && ['transmis', 'signé', 'terminé'].indexOf(r.statut) !== -1
      && String(r.date || r.maj || '').slice(0, 10) < limiteISO);

    let recherche = '';
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const carte = (r) => `<div class="menu-item" style="flex-direction:column;align-items:stretch;gap:6px">
        <div style="display:flex;justify-content:space-between;gap:8px">
          <strong>${esc(r.numero || '—')} — ${esc(r.client.nom || 'client ?')}</strong>
          <span class="pill">${esc(r.statut || 'brouillon')}</span></div>
        <div class="small">${esc(Report.frDate(r.date))}${r.machine.designation ? ' • ' + esc(r.machine.designation) : ''} • ${r.nbEvenements} évènement(s)${r.nbPhotos ? ' • ' + r.nbPhotos + ' photo(s)' : ''}${r.id === R.id ? ' • <strong>en cours</strong>' : ''}</div>
        ${r.perdues ? `<div class="small" style="color:#b45309">⚠ ${r.perdues} photo(s) introuvable(s) sur ce téléphone (rapport enregistré par une ancienne version). Elles restent dans le PDF déjà envoyé.</div>` : ''}
        <div class="btnrow"><button class="btn sm grey" data-ouvrir="${esc(r.id)}">Rouvrir</button>
          <button class="btn sm danger" data-suppr="${esc(r.id)}">Supprimer</button></div></div>`;

    Ouvrir.ouvrir(null, `<div class="panel">
      <div class="grab"></div><h3>Rapports enregistrés</h3>
      <p class="sub">${liste.length} rapport(s) sur ce téléphone.</p>
      ${liste.length > 3 ? `<div class="field"><input type="search" id="histRecherche" placeholder="Rechercher : client, n°, machine, date (ex. 03/2026)" autocomplete="off"></div>` : ''}
      <div id="histListe"></div>
      ${anciens.length ? `<div class="sticky-note" style="margin-top:10px">
        <strong>${anciens.length} rapport(s) terminé(s) de plus de ${MOIS_MENAGE} mois</strong> occupent de la place sur ce téléphone.
        <div class="btnrow" style="margin-top:8px"><button class="btn sm grey" data-a="menage">Faire le ménage</button></div></div>` : ''}
      <button class="btn grey wide" data-a="fermer">Fermer</button></div>`, (panneau) => {
      const zone = $('#histListe', panneau);
      function afficher() {
        const q = norm(recherche).trim();
        const visibles = q ? liste.filter(r => norm([r.numero, r.client.nom, r.machine.designation, Report.frDate(r.date), r.statut].join(' ')).indexOf(q) !== -1) : liste;
        zone.innerHTML = visibles.map(carte).join('') ||
          (q ? '<p class="small">Aucun rapport ne correspond à « ' + esc(recherche) + ' ».</p>' : '<p class="small">Aucun rapport enregistré.</p>');
      }
      afficher();
      const champ = $('#histRecherche', panneau);
      if (champ) champ.addEventListener('input', () => { recherche = champ.value; afficher(); });

      panneau.addEventListener('click', async (e) => {
        const sup = e.target.closest('[data-suppr]');
        const ouv = e.target.closest('[data-ouvrir]');
        if (e.target.closest('[data-a="menage"]')) {
          await faireMenage(anciens);
          const feuille = panneau.closest('.sheet');
          if (feuille) feuille.remove();
          feuilleHistorique();
          return;
        }
        if (sup) {
          const id = sup.dataset.suppr;
          if (id === R.id) { toast('C\'est le rapport en cours : créez d\'abord une nouvelle intervention', 4000); return; }
          if (!(await Dialogue.confirmer('Supprimer définitivement ce rapport et ses photos ?', { ok: 'Supprimer', danger: true }))) return;
          if (typeof RapportDB !== 'undefined') await RapportDB.supprimerRapport(id);
          Store.set(K.rapports, Store.get(K.rapports, []).filter(x => x.id !== id));
          liste = liste.filter(x => x.id !== id);
          afficher();
          toast('Rapport supprimé');
        } else if (ouv) {
          const id = ouv.dataset.ouvrir;
          if (id === R.id) { panneau.closest('.sheet').remove(); return; }
          if (!(await Dialogue.confirmer('Rouvrir ce rapport ? Le rapport en cours sera conservé au préalable.', { ok: 'Rouvrir' }))) return;
          sauver(true);
          let r = null;
          if (typeof RapportDB !== 'undefined' && RapportDB.disponible()) r = await RapportDB.getRapport(id);
          if (!r) r = Store.get(K.rapports, []).find(x => x.id === id);
          if (r) {
            if (typeof RapportDB !== 'undefined') await RapportDB.restaurerPhotos(r);
            R = fusion(nouvelleIntervention(), r);
            if (r.numeroAuto === undefined) R.numeroAuto = false;
            Cache.pdf = Cache.docx = null; Cache.clePdf = Cache.cleDocx = Cache.cleTrad = '';
            Store.set(K.rapport, R);
            if (typeof RapportDB !== 'undefined') await RapportDB.sauverRapport(R);
          }
          const feuille = panneau.closest('.sheet');
          if (feuille) feuille.remove();
          rendreTout();
          const nbPerdues = RapportDB.imagesManquantes ? RapportDB.imagesManquantes(R) : 0;
          toast(nbPerdues ? 'Rapport ' + R.numero + ' chargé — ' + nbPerdues + ' photo(s) introuvable(s)' : 'Rapport ' + R.numero + ' chargé avec ses photos', nbPerdues ? 5000 : 2600);
        }
      });
    });
  }

  /* Supprime les rapports terminés anciens, seulement après une sauvegarde complète
     récente (moins de 24 h) : rien n'est perdu, tout est dans le fichier exporté. */
  async function faireMenage(anciens) {
    if (!anciens || !anciens.length) return;
    const derniere = Store.get('sav3.derniereSauvegarde', null);
    const recente = derniere && (Date.now() - new Date(derniere).getTime()) < 24 * 3600 * 1000;
    if (!recente) {
      const ok = await Dialogue.confirmer('Avant de supprimer quoi que ce soit, exportez une sauvegarde complète (tous les rapports et leurs photos). Rangez ensuite le fichier en lieu sûr (Drive, e-mail…).',
        { ok: 'Exporter la sauvegarde', annuler: 'Annuler' });
      if (!ok) return;
      const exporte = await exporterSauvegarde();
      if (!exporte) { toast('Sauvegarde non enregistrée : ménage annulé', 4000); return; }
    }
    const plusRecent = anciens.reduce((m, r) => (r.date > m ? r.date : m), '');
    const oui = await Dialogue.confirmer('Supprimer de ce téléphone ' + anciens.length + ' rapport(s) terminé(s) datant au plus tard du ' +
      Report.frDate(plusRecent) + ' ?\nIls restent dans la sauvegarde exportée et dans les PDF déjà envoyés.', { ok: 'Supprimer', danger: true });
    if (!oui) return;
    const ids = new Set(anciens.map(r => r.id));
    for (const id of ids) { if (typeof RapportDB !== 'undefined') await RapportDB.supprimerRapport(id); }
    Store.set(K.rapports, Store.get(K.rapports, []).filter(x => !ids.has(x.id)));
    toast(ids.size + ' rapport(s) supprimé(s) de ce téléphone', 3500);
  }

  function feuilleAide() {
    Ouvrir.ouvrir(null, `<div class="panel">
      <div class="grab"></div><h3>Mode d'emploi</h3>
      <p class="sub">Une fois pour toutes : Menu → <strong>Mes informations</strong> (nom, téléphone, e-mail) — ces coordonnées restent dans le téléphone et partent dans tous vos rapports.</p>
      <p class="sub">Puis quatre gestes, dans l'ordre de l'intervention.</p>
      <ol class="liste" style="font-size:14px">
        <li><strong>Démarrer</strong> — appuyez sur « Démarrer l'intervention » en haut : l'heure de début est enregistrée. Pause possible (repas, attente pièce).</li>
        <li><strong>Ajouter un évènement</strong> à chaque constat : <em>domaine</em> (mécanique / électrique / automatisme) → <em>annotation</em> écrite ou dictée → <em>photo</em> annotée au doigt → <em>catégorie</em> (sécurité, urgent, priorité haute/basse, informatif).</li>
        <li><strong>Point client</strong> — en fin d'intervention, expliquez le déroulé puis faites signer le client sur l'écran.</li>
        <li><strong>Soumettre le rapport</strong> — le PDF (et la version Word) partent par e-mail au client et au responsable SAV. Vos nom et coordonnées figurent dans le bloc de signature.</li>
      </ol>
      <div class="sep"></div>
      <p class="small"><strong>Client étranger :</strong> dans <em>Client &amp; machine</em>, cochez « Traduire le rapport dans la langue du client » et choisissez la langue (anglais, allemand, néerlandais, espagnol, italien, portugais). Le mail part alors avec <strong>deux rapports</strong> : le français et la version traduite. La langue est retenue pour ce client. Un appui sur « Préparer la langue sur ce téléphone » (au bureau, en Wi-Fi) rend la traduction disponible même hors connexion.</p>
      <p class="small">Un évènement reste modifiable à tout moment : appuyez dessus pour reprendre l'assistant.</p>
      <p class="small"><strong>Installation :</strong> dans Chrome, menu ⋮ → « Ajouter à l'écran d'accueil ». L'application fonctionne ensuite hors connexion.</p>
      <p class="small"><strong>Version de l'application :</strong> <span id="versionAppli">${self.SAV_VERSION || 'non versionnée'} (${self.SAV_DATE || '25/09/2026'})</span> — si l'application ne se met pas à jour, ce numéro (au support) dit quelle version tourne sur ce téléphone.</p>
      <button class="btn grey wide" data-a="fermer">Fermer</button></div>`);
  }

  /* ===================== Écoute globale =============================== */
  function brancher() {
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (t.closest && t.closest('.sheet, .assistant')) return;
      if (t.dataset && t.dataset.k) { setPath(R, t.dataset.k, t.value); planifier(); }
    });
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (t.closest && t.closest('.sheet, .assistant')) return;
      if (t.dataset && t.dataset.k) {
        setPath(R, t.dataset.k, t.value); planifier();
        /* Un champ texte est déjà enregistré à la frappe. Le « change » d'un texte
           arrive quand on touche ailleurs, par exemple le bouton « Soumettre » :
           redessiner l'écran à ce moment remplaçait le bouton sous le doigt et le
           premier appui était perdu. On ne redessine donc que pour les listes,
           dates et cases. */
        const texte = t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|email|tel|search|url|number)?$/.test(t.type || ''));
        if (!texte) rendreTout();
      }
    });

    document.addEventListener('click', (e) => {
      const bApercu = e.target.closest('[data-a="apercu-ev"]');
      if (bApercu) {
        e.stopPropagation();
        apercuEvenement(bApercu.dataset.id);
        return;
      }
      const bModifier = e.target.closest('[data-a="modifier-ev"]');
      if (bModifier) {
        e.stopPropagation();
        editerEvenement(bModifier.dataset.id);
        return;
      }
      const bBascule = e.target.closest('[data-a="basculer-nature"]');
      if (bBascule) {
        e.stopPropagation();
        basculerNature(bBascule.dataset.id);
        return;
      }
      const carte = e.target.closest('[data-ev]');
      if (carte) { editerEvenement(carte.dataset.ev); return; }
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'chrono-demarrer') {
        /* Pas d'intervention sans technicien identifié : son nom et son code
           figurent dans le rapport et dans son numéro. */
        if (!Report.nomComplet(S.technicien)) {
          toast('Indiquez d\'abord votre nom : il figure sur le rapport', 3200);
          feuilleIdentite(true, demarrerChrono);
        } else demarrerChrono();
      }
      else if (a === 'chrono-pause') basculerPause();
      else if (a === 'chrono-terminer') terminerChrono();
      else if (a === 'chrono-reprendre') reprendreIntervention();
      else if (a === 'chrono-oubli') feuilleOubliChrono();
      else if (a === 'chrono-ajuster') feuilleAjusterChrono();
      else if (a === 'editer-trajet') feuilleTrajet(false);
      else if (a === 'cloturer-retour-reel') feuilleTrajet(true);
      else if (a === 'ajouter-ev') ajouterEvenement();
      else if (a === 'editer-client') feuilleClient();
      else if (a === 'sms-arrivee') feuilleSMSArrivee();
      else if (a === 'ajouter-piece') feuillePiece();
      else if (a === 'voir-photo-pc') {
        const id = b.dataset.id;
        const pc = (R.pieces || []).find(p => p.id === id);
        if (pc && pc.photo) {
          afficherVisionneusePhoto(pc.photo, pc.denomination || 'Pièce de rechange', pc.reference ? 'Réf : ' + pc.reference : '');
        }
      }
      else if (a === 'editer-piece') {
        const id = b.dataset.id;
        const pc = (R.pieces || []).find(p => p.id === id);
        if (pc) feuillePiece(pc);
      }
      else if (a === 'supprimer-piece') {
        const id = b.dataset.id;
        const idx = (R.pieces || []).findIndex(p => p.id === id);
        if (idx >= 0) Dialogue.confirmer('Supprimer cette pièce de rechange ?', { ok: 'Supprimer', danger: true }).then((oui) => {
          if (!oui) return;
          const i2 = (R.pieces || []).findIndex(p => p.id === id);
          if (i2 < 0) return;
          R.pieces.splice(i2, 1);
          planifier(); rendreTout();
          toast('Pièce supprimée');
        });
      }
      else if (a === 'signer') signerClient();
      else if (a === 'effacer-signature') {
        Dialogue.confirmer('Effacer la signature du client ?', { ok: 'Effacer', danger: true }).then((oui) => {
          if (!oui) return;
          R.signatureClient = { nom: '', fonction: '', dataUrl: '', date: '', heure: '' };
          R.statut = R.chrono.fin ? 'terminé' : R.statut;
          planifier(); rendreTout();
        });
      }
      else if (a === 'soumettre') soumettre();
      else if (a === 'apercu') apercuPDF();
      else if (a === 'word') docx().then(res => { telecharger(res.blob, res.filename); toast('Version Word enregistrée'); });
      else if (a === 'photos-zip') dossierPhotos();
      else if (a === 'menu') feuilleMenu();
      else if (a === 'identite') feuilleIdentite();
      else if (a === 'photos-libres') feuillePhotosLibres();
    });

    const bAjouter = $('#btnAjouter');
    if (bAjouter) bAjouter.addEventListener('click', ajouterEvenement);

    const bAjouterPiece = $('#btnAjouterPiece');
    if (bAjouterPiece) bAjouterPiece.addEventListener('click', () => feuillePiece(null));

    const bSigner = $('#btnSigner');
    if (bSigner) bSigner.addEventListener('click', signerClient);

    const bSoumettre = $('#btnSoumettre');
    if (bSoumettre) bSoumettre.addEventListener('click', soumettre);

    const bMenu = $('#btnMenu');
    if (bMenu) bMenu.addEventListener('click', feuilleMenu);

    window.addEventListener('beforeunload', () => { if (dirty) sauver(true); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) sauver(true); });
  }

  function feuilleAjusterChrono() {
    synchroniserEntites();
    const c = R.chrono;
    const val = (iso) => iso ? new Date(iso).toISOString().slice(0, 16) : '';
    if (!Array.isArray(R.jours)) R.jours = [];

    function recalculerJour(j) {
      if (j.debut && j.fin) {
        const [hd, md] = (j.debut || '0:0').split(':').map(Number);
        const [hf, mf] = (j.fin || '0:0').split(':').map(Number);
        let ecart = (hf * 60 + mf) - (hd * 60 + md);
        if (ecart < 0) ecart += 1440;                 // journée qui passe minuit (travail de nuit)
        const min = ecart - (Number(j.pauseMinutes) || 0);
        j.dureeHeures = Math.max(0, Math.round(min * 100 / 60) / 100);
        j.dureeMs = Math.max(0, min * 60000);
      } else {
        j.dureeHeures = 0;
        j.dureeMs = 0;
      }
    }

    function rafraichirJoursDOM(pEl) {
      const zone = $('#listeJours', pEl);
      if (!zone) return;
      zone.innerHTML = (R.jours || []).map((j, idx) => {
        recalculerJour(j);
        const dh = j.dureeHeures || 0;
        const durLabel = dh > 0 ? (Math.floor(dh) + ' h ' + pad2(Math.round((dh % 1) * 60)) + ' (' + dh.toFixed(2).replace('.', ',') + ' h)') : '0 min';
        return `
        <div class="card" style="margin:0;padding:12px;background:var(--fond,#f8fafc);border:1px solid var(--bord,#e2e8f0);position:relative">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <strong style="font-size:0.95rem">Journée ${idx + 1}</strong>
            <button type="button" class="btn sm danger" data-rm-jour="${idx}" style="padding:2px 8px;font-size:0.8rem">${(ICO.trash && ICO.trash(12)) || ''} Retirer</button>
          </div>
          <div class="field" style="margin-bottom:8px"><label>Date</label>
            <input type="date" data-j-k="date" data-j-i="${idx}" value="${esc(j.date || todayISO())}"></div>
          <div class="grid2" style="margin-bottom:8px">
            <div class="field"><label>Début</label><input type="time" data-j-k="debut" data-j-i="${idx}" value="${esc(j.debut || '08:00')}"></div>
            <div class="field"><label>Fin</label><input type="time" data-j-k="fin" data-j-i="${idx}" value="${esc(j.fin || '17:00')}"></div>
          </div>
          <div class="grid2" style="margin-bottom:8px">
            <div class="field"><label>Pause (min)</label><input type="number" min="0" step="5" data-j-k="pauseMinutes" data-j-i="${idx}" value="${esc(j.pauseMinutes != null ? j.pauseMinutes : 60)}"></div>
            <div class="field"><label>Durée calculée</label><input type="text" readonly value="${esc(durLabel)}" style="background:#f1f5f9;font-weight:600"></div>
          </div>
          <div class="field"><label>Activité / Travaux réalisés</label>
            <input type="text" data-j-k="description" data-j-i="${idx}" value="${esc(j.description || '')}" placeholder="Ex. Démontage, expertise et remplacement réducteur"></div>
        </div>`;
      }).join('') || '<p class="small">Aucune journée enregistrée pour le moment. Cliquez sur « Ajouter une journée » ci-dessous.</p>';

      const totTxt = $('#totJoursTxt', pEl);
      if (totTxt) {
        const tot = duree();
        totTxt.textContent = (Report.formatDuree(tot) || '0 min') + ' (' + Report.dureeDecimale(tot) + ' h)';
      }
    }

    const multi = !!R.multiJours;

    Ouvrir.ouvrir(null, `<div class="panel">
      <div class="grab"></div><h3>Ajuster les heures</h3>
      <p class="sub">Relevé quotidien ou chrono de l'intervention.</p>
      <div class="agreement" style="margin-bottom:14px;padding:10px;background:var(--fond-alt,#f1f5f9);border-radius:8px">
        <input type="checkbox" id="ajMultiJours" ${multi ? 'checked' : ''}>
        <label for="ajMultiJours"><strong>Intervention sur plusieurs jours (multi-jours)</strong></label>
      </div>
      <div id="blocChronoUnique" ${multi ? 'hidden' : ''}>
        <div class="field"><label>Début sur site</label><input type="datetime-local" id="ajDebut" value="${val(c.debut)}"></div>
        <div class="field"><label>Fin sur site</label><input type="datetime-local" id="ajFin" value="${val(c.fin)}"></div>
        <p class="small">${(c.pauses || []).length} pause(s) enregistrée(s), déduites du temps sur site.</p>
      </div>
      <div id="blocMultiJours" ${multi ? '' : 'hidden'}>
        <p class="small">Saisissez les horaires et temps de pause pour chaque journée. Les heures cumulées sont calculées automatiquement.</p>
        ${(c.jourEnCours && c.debut) ? `<p class="small" style="color:#0369a1"><strong>Journée en cours</strong> depuis ${esc(Report.heureFr(c.debut))} : elle s'ajoutera au relevé à « Terminer » (le total ci-dessous la compte déjà).</p>` : ''}
        <div id="listeJours" style="display:flex;flex-direction:column;gap:12px;margin:12px 0"></div>
        <button type="button" class="btn sm grey" id="btnAjouterJour">+ Ajouter une journée</button>
        <div style="margin-top:14px;padding:10px 12px;background:#e0f2fe;border-radius:8px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600;color:#0369a1">Total cumulé :</span>
          <strong style="font-size:1.1rem;color:#0284c7" id="totJoursTxt">${Report.formatDuree(duree()) || '0 min'} (${Report.dureeDecimale(duree())} h)</strong>
        </div>
      </div>
      <div class="btnrow" style="margin-top:16px"><button class="btn grey" data-a="fermer">Annuler</button>
        <button class="btn" data-a="ok-ajust">Enregistrer</button></div></div>`, (panneau) => {

      rafraichirJoursDOM(panneau);

      const caseMulti = $('#ajMultiJours', panneau);
      const blocMulti = $('#blocMultiJours', panneau);
      const blocChrono = $('#blocChronoUnique', panneau);

      if (caseMulti) {
        caseMulti.addEventListener('change', () => {
          R.multiJours = !!caseMulti.checked;
          if (R.multiJours && R.jours.length === 0) {
            const j1 = {
              id: uid('j'),
              date: R.date || todayISO(),
              debut: (R.chrono && R.chrono.debut) ? Report.heureFr(R.chrono.debut) : '08:00',
              fin: (R.chrono && R.chrono.fin) ? Report.heureFr(R.chrono.fin) : '17:00',
              pauseMinutes: 60,
              description: ''
            };
            recalculerJour(j1);
            R.jours.push(j1);
          }
          if (blocMulti) blocMulti.hidden = !R.multiJours;
          if (blocChrono) blocChrono.hidden = !!R.multiJours;
          rafraichirJoursDOM(panneau);
          planifier();
        });
      }

      panneau.addEventListener('input', (e) => {
        const jk = e.target.dataset.jK, ji = e.target.dataset.jI;
        if (jk && ji !== undefined) {
          const idx = parseInt(ji, 10);
          if (R.jours && R.jours[idx]) {
            R.jours[idx][jk] = (jk === 'pauseMinutes') ? (parseFloat(e.target.value) || 0) : e.target.value;
            recalculerJour(R.jours[idx]);
            const carteJour = e.target.closest('.card');
            if (carteJour) {
              const inDuree = carteJour.querySelector('input[readonly]');
              if (inDuree) {
                const dh = R.jours[idx].dureeHeures || 0;
                inDuree.value = dh > 0 ? (Math.floor(dh) + ' h ' + pad2(Math.round((dh % 1) * 60)) + ' (' + dh.toFixed(2).replace('.', ',') + ' h)') : '0 min';
              }
            }
            const totTxt = $('#totJoursTxt', panneau);
            if (totTxt) {
              const tot = duree();
              totTxt.textContent = (Report.formatDuree(tot) || '0 min') + ' (' + Report.dureeDecimale(tot) + ' h)';
            }
            planifier();
          }
        }
      });

      panneau.addEventListener('click', (e) => {
        const btnJ = e.target.closest('#btnAjouterJour');
        if (btnJ) {
          if (!Array.isArray(R.jours)) R.jours = [];
          const derDate = R.jours.length ? R.jours[R.jours.length - 1].date : R.date;
          let prochDate = derDate || todayISO();
          try {
            const dObj = new Date(derDate || todayISO());
            dObj.setDate(dObj.getDate() + 1);
            prochDate = dObj.toISOString().slice(0, 10);
          } catch (err) {}
          const nouvJour = {
            id: uid('j'),
            date: prochDate,
            debut: '08:00',
            fin: '17:00',
            pauseMinutes: 60,
            description: ''
          };
          recalculerJour(nouvJour);
          R.jours.push(nouvJour);
          rafraichirJoursDOM(panneau);
          planifier();
          return;
        }

        const rmJ = e.target.closest('[data-rm-jour]');
        if (rmJ) {
          const idx = parseInt(rmJ.dataset.rmJour, 10);
          if (R.jours && R.jours.length > idx) {
            R.jours.splice(idx, 1);
            rafraichirJoursDOM(panneau);
            planifier();
          }
          return;
        }

        if (e.target.closest('[data-a="ok-ajust"]')) {
          if (!R.multiJours) {
            const d = $('#ajDebut', panneau).value, f = $('#ajFin', panneau).value;
            R.chrono.debut = d ? new Date(d).toISOString() : null;
            R.chrono.fin = f ? new Date(f).toISOString() : null;
          } else {
            R.jours.forEach(recalculerJour);
          }
          planifier(); rendreTout();
          e.target.closest('.sheet').remove();
          toast('Heures mises à jour');
        }
      });
    });
  }

  function feuillePhotosLibres() {
    Ouvrir.ouvrir(null, `<div class="panel">
      <div class="grab"></div><h3>Photos complémentaires</h3>
      <p class="sub">Photos qui ne sont pas rattachées à un évènement (vue d'ensemble, plaque machine…).</p>
      <div class="photos">${(R.photosLibres || []).map((p, i) => `<div class="photo">
        <img src="${p.dataUrl}" alt=""><button class="rm" data-rm="${i}">${(ICO.close && ICO.close(14)) || '✕'}</button>
        <input class="cap" value="${esc(p.legende || '')}" data-leg="${i}" placeholder="Légende"></div>`).join('') || '<p class="small">Aucune photo.</p>'}</div>
      <div class="filebtn" style="margin-top:10px"><input type="file" id="plInput" accept="image/*" capture="environment" multiple>
        <label for="plInput">${(ICO.camera && ICO.camera(16)) || ''} Ajouter des photos</label></div>
      <button class="btn grey wide" style="margin-top:10px" data-a="fermer">Fermer</button></div>`, (panneau) => {
      panneau.addEventListener('input', (e) => {
        if (e.target.dataset.leg !== undefined) { R.photosLibres[+e.target.dataset.leg].legende = e.target.value; planifier(); }
      });
      panneau.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-rm]');
        if (rm) { R.photosLibres.splice(+rm.dataset.rm, 1); planifier(); e.target.closest('.sheet').remove(); feuillePhotosLibres(); return; }
      });
      $('#plInput', panneau).addEventListener('change', async (e) => {
        const fichiers = Array.prototype.slice.call(e.target.files || []);
        for (const f of fichiers) {
          const dataUrl = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => {
              const img = new Image();
              img.onload = () => {
                const s = Math.min(1, 1600 / Math.max(img.width, img.height));
                const c = document.createElement('canvas');
                c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
                ctx.drawImage(img, 0, 0, c.width, c.height);
                resolve(c.toDataURL('image/jpeg', 0.82));
              };
              img.onerror = reject; img.src = r.result;
            };
            r.onerror = reject; r.readAsDataURL(f);
          });
          const pid = uid('phl');
          const photoItem = { id: pid, dataUrl: dataUrl, legende: '', annotations: [] };
          R.photosLibres.push(photoItem);
          if (typeof RapportDB !== 'undefined') {
            RapportDB.sauverPhoto(pid, dataUrl, 'photosLibres', (typeof R !== 'undefined' && R && R.id) || '');
          }
        }
        planifier(); e.target.closest('.sheet').remove(); feuillePhotosLibres();
      });
    });
  }

  /* ===================== Temps de route & Déplacement ================= */
  function feuilleTrajet(modeCloture) {
    if (!R.trajet || typeof R.trajet !== 'object') {
      R.trajet = {
        actif: false,
        allerDateDepart: '', allerHeureDepart: '', allerDateArrivee: '', allerHeureArrivee: '', allerDureeMinutes: 0,
        retourDateDepart: '', retourHeureDepart: '', retourDateArrivee: '', retourHeureArrivee: '', retourDureeMinutes: 0, retourEstime: true,
        retourReelDateDepart: '', retourReelHeureDepart: '', retourReelDateArrivee: '', retourReelHeureArrivee: '', retourReelDureeMinutes: 0,
        retourCloture: false, note: ''
      };
    }
    const tr = R.trajet;
    const c = R.chrono || {};
    const dateJour = R.date || todayISO();
    const heureFinChrono = (c.fin ? Report.heureFr(c.fin) : '') || '';

    let allerDateDep = tr.allerDateDepart || dateJour;
    let allerHeureDep = tr.allerHeureDepart || '';
    let allerDateArr = tr.allerDateArrivee || dateJour;
    let allerHeureArr = tr.allerHeureArrivee || (c.debut ? Report.heureFr(c.debut) : '');
    let allerMin = Number(tr.allerDureeMinutes) || 0;

    let retourDateDep = tr.retourDateDepart || dateJour;
    let retourHeureDep = tr.retourHeureDepart || heureFinChrono || '';
    let retourDateArr = tr.retourDateArrivee || dateJour;
    let retourHeureArr = tr.retourHeureArrivee || '';
    let retourMin = Number(tr.retourDureeMinutes) || allerMin || 0;

    let retourCloture = modeCloture ? true : !!tr.retourCloture;
    let retourReelDateDep = tr.retourReelDateDepart || dateJour;
    let retourReelHeureDep = tr.retourReelHeureDepart || heureFinChrono || '';
    let retourReelDateArr = tr.retourReelDateArrivee || dateJour;
    let retourReelHeureArr = tr.retourReelHeureArrivee || '';
    let retourReelMin = Number(tr.retourReelDureeMinutes) || 0;
    let note = tr.note || '';

    function calcDiff(hd, ha, dd, da) {
      if (!hd || !ha) return 0;
      const p1 = hd.split(':').map(Number);
      const p2 = ha.split(':').map(Number);
      if (isNaN(p1[0]) || isNaN(p1[1]) || isNaN(p2[0]) || isNaN(p2[1])) return 0;
      let m1 = p1[0] * 60 + p1[1];
      let m2 = p2[0] * 60 + p2[1];
      if (dd && da && dd !== da) {
        const d1 = new Date(dd).getTime();
        const d2 = new Date(da).getTime();
        if (!isNaN(d1) && !isNaN(d2)) {
          m2 += Math.round((d2 - d1) / 86400000) * 1440;
        }
      } else if (m2 < m1) {
        m2 += 1440;
      }
      return Math.max(0, m2 - m1);
    }

    function addMinutes(hd, mins) {
      if (!hd) return '';
      const p = hd.split(':').map(Number);
      if (isNaN(p[0]) || isNaN(p[1])) return '';
      const tot = (p[0] * 60 + p[1] + (Number(mins) || 0)) % 1440;
      const h = Math.floor(tot / 60);
      const m = tot % 60;
      return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
    }

    function formatMin(m) {
      if (!m && m !== 0) return '—';
      const h = Math.floor(m / 60);
      const min = m % 60;
      if (h === 0) return min + ' min';
      return h + ' h ' + ('0' + min).slice(-2);
    }

    if (!allerMin && allerHeureDep && allerHeureArr) {
      allerMin = calcDiff(allerHeureDep, allerHeureArr, allerDateDep, allerDateArr);
    }
    if (!retourMin) {
      retourMin = allerMin;
    }
    if (retourHeureDep && !retourHeureArr && retourMin) {
      retourHeureArr = addMinutes(retourHeureDep, retourMin);
    }

    const panneau = Ouvrir.ouvrir(null, `<div class="panel">
      <div class="grab"></div>
      <h3>Temps de route &amp; Déplacement</h3>
      <p class="sub">Horaires aller et retour pour le débriefing client et le suivi d'activité post-intervention.</p>

      <!-- Section ALLER -->
      <div style="background:#f8fafc;border:1px solid var(--bord);border-radius:10px;padding:12px;margin-bottom:14px">
        <div style="font-weight:700;color:var(--bfr-secondary);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
          <span>🚗 Trajet Aller (Départ &rarr; Client)</span>
          <span id="badgeDureeAller" class="pill" style="background:#e0f2fe;color:#0369a1">${formatMin(allerMin)}</span>
        </div>
        
        <div class="grid2">
          <div class="field">
            <label>Date départ aller</label>
            <input type="date" id="trAllerDateDep" value="${esc(allerDateDep)}">
          </div>
          <div class="field">
            <label>Heure départ aller</label>
            <div style="display:flex;gap:6px">
              <input type="time" id="trAllerHeureDep" value="${esc(allerHeureDep)}">
              <button type="button" class="btn sm grey" data-a="maintenant-aller-dep" style="min-width:44px;padding:2px 8px;font-size:11px" title="Maintenant">Maint.</button>
            </div>
          </div>
        </div>

        <div class="grid2">
          <div class="field">
            <label>Date arrivée sur site</label>
            <input type="date" id="trAllerDateArr" value="${esc(allerDateArr)}">
          </div>
          <div class="field">
            <label>Heure arrivée sur site</label>
            <div style="display:flex;gap:6px">
              <input type="time" id="trAllerHeureArr" value="${esc(allerHeureArr)}">
              <button type="button" class="btn sm grey" data-a="maintenant-aller-arr" style="min-width:44px;padding:2px 8px;font-size:11px" title="Maintenant">Maint.</button>
            </div>
          </div>
        </div>

        <div class="field" style="margin-top:6px">
          <label>Durée aller calculée (minutes)</label>
          <input type="number" id="trAllerMin" min="0" step="5" value="${allerMin || ''}" placeholder="Ex. 135 pour 2 h 15">
        </div>
      </div>

      <!-- Section RETOUR ESTIMÉ -->
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px;margin-bottom:14px">
        <div style="font-weight:700;color:#92400e;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
          <span>🔄 Trajet Retour (Estimé pour le débrief)</span>
          <span id="badgeDureeRetourEstime" class="pill" style="background:#fef3c7;color:#92400e">${formatMin(retourMin)}</span>
        </div>
        <p class="small" style="color:#78350f;margin-bottom:10px;line-height:1.4">
          ℹ️ En débrief chez le client avant signature, la durée retour est automatiquement calquée sur l'aller. Vous pouvez l'ajuster si nécessaire.
        </p>

        <div class="grid2">
          <div class="field">
            <label>Départ retour estimé</label>
            <input type="time" id="trRetourHeureDep" value="${esc(retourHeureDep)}">
          </div>
          <div class="field">
            <label>Durée estimée (minutes)</label>
            <input type="number" id="trRetourMin" min="0" step="5" value="${retourMin || ''}" placeholder="Identique aller">
          </div>
        </div>

        <div class="field">
          <label>Arrivée retour estimée calculée</label>
          <input type="time" id="trRetourHeureArr" value="${esc(retourHeureArr)}" readonly style="background:#f1f5f9;cursor:not-allowed">
        </div>
      </div>

      <!-- Section CLÔTURE POST-INTERVENTION -->
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <label style="font-weight:700;color:#166534;display:flex;align-items:center;gap:6px;cursor:pointer;margin:0">
            <input type="checkbox" id="trRetourCloture" ${retourCloture ? 'checked' : ''}>
            🏠 Confirmer le retour réel (post-intervention)
          </label>
          <span id="badgeClotureStatus" class="pill" style="font-size:10px;${retourCloture ? 'background:#dcfce7;color:#166534' : 'background:#f1f5f9;color:#64748b'}">${retourCloture ? 'Confirmé' : 'En attente'}</span>
        </div>
        
        <div id="blocRetourReel" style="${retourCloture ? '' : 'display:none;'}margin-top:10px">
          <div class="grid2">
            <div class="field">
              <label>Départ réel retour</label>
              <input type="time" id="trRetourReelHeureDep" value="${esc(retourReelHeureDep)}">
            </div>
            <div class="field">
              <label>Arrivée réelle retour</label>
              <div style="display:flex;gap:6px">
                <input type="time" id="trRetourReelHeureArr" value="${esc(retourReelHeureArr)}">
                <button type="button" class="btn sm grey" data-a="maintenant-reel-arr" style="min-width:44px;padding:2px 8px;font-size:11px" title="Maintenant">Maint.</button>
              </div>
            </div>
          </div>
          <div class="field">
            <label>Observations trajet (trafic, déviation…)</label>
            <input type="text" id="trNote" value="${esc(note)}" placeholder="Ex. Trafic fluide, ou 30 min de bouchon A6">
          </div>
        </div>
      </div>

      <!-- Récapitulatif dynamique -->
      <div style="background:#0f172a;color:#fff;border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:13px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="color:#94a3b8">🚗 Total route :</span>
          <strong id="trApercuRoute">${formatMin((allerMin || 0) + (retourCloture && retourReelMin ? retourReelMin : (retourMin || 0)))}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="color:#94a3b8">⏱️ Heures sur site :</span>
          <strong>${Report.formatDuree(duree()) || '0 min'}</strong>
        </div>
        <div style="border-top:1px solid #334155;padding-top:6px;margin-top:6px;display:flex;justify-content:space-between;font-size:14px;color:var(--bfr-cyan-vif)">
          <span>🏁 TOTAL MOBILISÉ :</span>
          <strong id="trApercuTotal">${formatMin(Math.round(duree() / 60000) + (allerMin || 0) + (retourCloture && retourReelMin ? retourReelMin : (retourMin || 0)))}</strong>
        </div>
      </div>

      <div class="btnrow" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>
          <button class="btn grey" data-a="fermer">Annuler</button>
          ${tr.actif ? `<button type="button" class="btn sm danger" data-a="supprimer-trajet" style="margin-left:8px">Effacer le trajet</button>` : ''}
        </div>
        <button class="btn" data-a="sauvegarder-trajet">Enregistrer le trajet</button>
      </div>
    </div>`, (pEl) => {
      const inAllerDateDep = $('#trAllerDateDep', pEl);
      const inAllerHeureDep = $('#trAllerHeureDep', pEl);
      const inAllerDateArr = $('#trAllerDateArr', pEl);
      const inAllerHeureArr = $('#trAllerHeureArr', pEl);
      const inAllerMin = $('#trAllerMin', pEl);

      const inRetHeureDep = $('#trRetourHeureDep', pEl);
      const inRetMin = $('#trRetourMin', pEl);
      const inRetHeureArr = $('#trRetourHeureArr', pEl);

      const chkCloture = $('#trRetourCloture', pEl);
      const blocReel = $('#blocRetourReel', pEl);
      const badgeCloture = $('#badgeClotureStatus', pEl);
      const inReelHeureDep = $('#trRetourReelHeureDep', pEl);
      const inReelHeureArr = $('#trRetourReelHeureArr', pEl);
      const inNote = $('#trNote', pEl);

      const bAller = $('#badgeDureeAller', pEl);
      const bRetour = $('#badgeDureeRetourEstime', pEl);
      const apRoute = $('#trApercuRoute', pEl);
      const apTotal = $('#trApercuTotal', pEl);

      function mettreAJour() {
        let aM = parseInt(inAllerMin.value, 10);
        if (isNaN(aM)) {
          aM = calcDiff(inAllerHeureDep.value, inAllerHeureArr.value, inAllerDateDep.value, inAllerDateArr.value);
          if (aM > 0) inAllerMin.value = aM;
        }
        bAller.textContent = formatMin(aM || 0);

        let rM = parseInt(inRetMin.value, 10);
        if (isNaN(rM) || rM <= 0) {
          rM = aM || 0;
          if (rM > 0) inRetMin.value = rM;
        }
        bRetour.textContent = formatMin(rM || 0);

        if (inRetHeureDep.value && rM > 0) {
          inRetHeureArr.value = addMinutes(inRetHeureDep.value, rM);
        }

        const isCloture = chkCloture.checked;
        blocReel.style.display = isCloture ? '' : 'none';
        badgeCloture.textContent = isCloture ? 'Confirmé' : 'En attente';
        badgeCloture.style.background = isCloture ? '#dcfce7' : '#f1f5f9';
        badgeCloture.style.color = isCloture ? '#166534' : '#64748b';

        let reelM = 0;
        if (isCloture) {
          reelM = calcDiff(inReelHeureDep.value, inReelHeureArr.value, inAllerDateArr.value, inAllerDateArr.value);
        }

        const routeTot = (aM || 0) + (isCloture && reelM > 0 ? reelM : (rM || 0));
        apRoute.textContent = formatMin(routeTot);
        const siteM = Math.round(duree() / 60000);
        apTotal.textContent = formatMin(siteM + routeTot);
      }

      function maintenantHeure() {
        const d = new Date();
        return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      }

      pEl.addEventListener('input', (e) => {
        if (e.target === inAllerHeureDep || e.target === inAllerHeureArr) {
          const m = calcDiff(inAllerHeureDep.value, inAllerHeureArr.value, inAllerDateDep.value, inAllerDateArr.value);
          inAllerMin.value = m || '';
          if (!inRetMin.value || inRetMin.value === '0') inRetMin.value = m || '';
        }
        mettreAJour();
      });

      chkCloture.addEventListener('change', mettreAJour);

      pEl.addEventListener('click', (e) => {
        if (e.target.closest('[data-a="maintenant-aller-dep"]')) {
          inAllerHeureDep.value = maintenantHeure();
          const m = calcDiff(inAllerHeureDep.value, inAllerHeureArr.value, inAllerDateDep.value, inAllerDateArr.value);
          if (m > 0) inAllerMin.value = m;
          mettreAJour();
          return;
        }
        if (e.target.closest('[data-a="maintenant-aller-arr"]')) {
          inAllerHeureArr.value = maintenantHeure();
          const m = calcDiff(inAllerHeureDep.value, inAllerHeureArr.value, inAllerDateDep.value, inAllerDateArr.value);
          if (m > 0) inAllerMin.value = m;
          mettreAJour();
          return;
        }
        if (e.target.closest('[data-a="maintenant-reel-arr"]')) {
          inReelHeureArr.value = maintenantHeure();
          mettreAJour();
          return;
        }
        if (e.target.closest('[data-a="supprimer-trajet"]')) {
          Dialogue.confirmer('Voulez-vous retirer le temps de route de ce rapport ?', { ok: 'Retirer', danger: true }).then((oui) => {
            if (!oui) return;
            R.trajet = {
              actif: false,
              allerDateDepart: '', allerHeureDepart: '', allerDateArrivee: '', allerHeureArrivee: '', allerDureeMinutes: 0,
              retourDateDepart: '', retourHeureDepart: '', retourDateArrivee: '', retourHeureArrivee: '', retourDureeMinutes: 0, retourEstime: true,
              retourReelDateDepart: '', retourReelHeureDepart: '', retourReelDateArrivee: '', retourReelHeureArrivee: '', retourReelDureeMinutes: 0,
              retourCloture: false, note: ''
            };
            sauver(true);
            Cache.pdf = Cache.docx = null;
            Cache.clePdf = Cache.cleDocx = Cache.cleTrad = '';
            rendreTout();
            const feuille = pEl.closest('.sheet');
            if (feuille) feuille.remove();
            toast('Temps de route retiré');
          });
          return;
        }
        if (e.target.closest('[data-a="sauvegarder-trajet"]')) {
          let aM = parseInt(inAllerMin.value, 10);
          if (isNaN(aM)) aM = calcDiff(inAllerHeureDep.value, inAllerHeureArr.value, inAllerDateDep.value, inAllerDateArr.value);
          let rM = parseInt(inRetMin.value, 10);
          if (isNaN(rM)) rM = aM;

          const isCloture = chkCloture.checked;
          let reelM = isCloture ? calcDiff(inReelHeureDep.value, inReelHeureArr.value, inAllerDateArr.value, inAllerDateArr.value) : 0;

          R.trajet = {
            actif: true,
            allerDateDepart: inAllerDateDep.value,
            allerHeureDepart: inAllerHeureDep.value,
            allerDateArrivee: inAllerDateArr.value,
            allerHeureArrivee: inAllerHeureArr.value,
            allerDureeMinutes: aM || 0,

            retourDateDepart: inAllerDateArr.value,
            retourHeureDepart: inRetHeureDep.value,
            retourDateArrivee: inAllerDateArr.value,
            retourHeureArrivee: inRetHeureArr.value,
            retourDureeMinutes: rM || 0,
            retourEstime: !isCloture,

            retourReelDateDepart: isCloture ? inAllerDateArr.value : '',
            retourReelHeureDepart: isCloture ? inReelHeureDep.value : '',
            retourReelDateArrivee: isCloture ? inAllerDateArr.value : '',
            retourReelHeureArrivee: isCloture ? inReelHeureArr.value : '',
            retourReelDureeMinutes: reelM || 0,
            retourCloture: isCloture,
            note: inNote ? inNote.value.trim() : ''
          };

          sauver(true);
          Cache.pdf = Cache.docx = null;
          Cache.clePdf = Cache.cleDocx = Cache.cleTrad = '';
          rendreTout();
          pEl.closest('.sheet').remove();
          toast(isCloture ? 'Trajet et retour réel enregistrés' : 'Temps de route enregistré (retour estimé)');
        }
      });
    });
    return panneau;
  }

  /* ===================== Démarrage ==================================== */
  function demarrer() {
    brancher();
    rendreTout();
    if (!Store.ok) setTimeout(() => toast('Mode aperçu : stockage local indisponible', 4000), 1200);
    /* Premier lancement : on demande ses coordonnées au technicien, mais sans interrompre
       une saisie déjà commencée (aucune autre feuille ouverte). */
    if (!Report.nomComplet(S.technicien)) setTimeout(() => {
      if (!document.querySelector('.sheet, .assistant')) feuilleIdentite(true);
    }, 900);
    // Pas de service worker dans un cadre (artefact Claude, aperçu) : seulement en page principale
    let pagePrincipale = true;
    try { pagePrincipale = window.self === window.top; } catch (_) { pagePrincipale = false; }
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0 && pagePrincipale) {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        try { reg.update(); } catch (_) {}
        reg.addEventListener('updatefound', () => {
          const nouveau = reg.installing;
          if (nouveau) {
            nouveau.addEventListener('statechange', () => {
              if (nouveau.state === 'installed' && navigator.serviceWorker.controller) {
                toast('Mise à jour prête : actualisation...', 2500);
                setTimeout(() => window.location.reload(), 1000);
              }
            });
          }
        });
      }).catch(() => {});

      navigator.serviceWorker.addEventListener('message', (ev) => {
        if (ev.data && ev.data.type === 'NOUVELLE_VERSION') {
          toast('Nouvelle version activée : actualisation...', 2500);
          setTimeout(() => window.location.reload(), 800);
        }
      });

      // Détection proactive et anti-cache d'une nouvelle version sur GitHub Pages
      if (typeof fetch !== 'undefined') {
        fetch('sw.js?t=' + Date.now(), { cache: 'no-store' })
          .then((rep) => rep && rep.ok ? rep.text() : '')
          .then((code) => {
            const match = code.match(/CACHE\s*=\s*'bfr-fiche-sav-([a-f0-9]+)'/);
            if (match && match[1] && window.SAV_VERSION && match[1] !== window.SAV_VERSION) {
              toast('Nouvelle version BFR détectée : mise à niveau...', 2200);
              setTimeout(() => actualiserApp(), 1200);
            }
          })
          .catch(() => {});
      }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();

  window.APP = {
    get rapport() { return R; }, get reglages() { return S; },
    sauver: sauver, planifier: planifier,
    pdf: pdf, docx: docx, rendreTout: rendreTout, toast: toast,
    destinatairesMail: destinatairesMail, destinatairesSAV: destinatairesSAV, destinatairesClient: destinatairesClient, destinataires: destinataires,
    feuilleMenu: feuilleMenu, feuilleIcones: feuilleIcones, soumettre: soumettre,
    feuilleEnvoi: feuilleEnvoi, fichiersEnvoi: fichiersEnvoi, actualiserApp: actualiserApp,
    estNumeroGeographique: estNumeroGeographique, nettoyerTel: nettoyerTel, contactArriveeAppel: contactArriveeAppel,
    apercuEvenement: apercuEvenement, feuillePiece: feuillePiece, afficherVisionneusePhoto: afficherVisionneusePhoto,
    feuilleTrajet: feuilleTrajet, feuilleAnnuaireClients: feuilleAnnuaireClients,
    feuilleClient: feuilleClient, feuilleReglages: feuilleReglages,
    feuilleSMSArrivee: feuilleSMSArrivee
  };
})();
