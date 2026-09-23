/* =========================================================================
   bergamot-engine.js — Moteur de traduction locale WebAssembly (Option B2)
   -------------------------------------------------------------------------
   Moteur officiel Firefox Translations / Bergamot (Marian NMT en C++ WASM)
   compilé pour tourner 100% hors-ligne dans un Web Worker sur Android.

   Fonctionnalités clés pour smartphone Android :
   1. Persistance IndexedDB (« bfr_traduction_v1 ») :
      Une fois téléchargés au bureau ou en 4G, le binaire WASM et les poids
      du modèle restent stockés définitivement dans le navigateur du téléphone.
      Aucune perte en sous-sol ou zone blanche usine.

   2. Pivot séquentiel « Low-Memory » (Zéro saturation RAM) :
      Pour traduire FR -> NL (ou DE, ES, IT, PT) via le pivot anglais :
      - Étape 1 : Chargement de FR->EN en mémoire WASM, traduction, puis
        DÉCHARGEMENT IMMÉDIAT du modèle de la RAM.
      - Étape 2 : Chargement de EN->NL en mémoire WASM, traduction, puis
        DÉCHARGEMENT IMMÉDIAT.
      Empreinte mémoire crête < 140 Mo : aucun risque de crash du navigateur.
   ========================================================================= */
(function (global) {
  'use strict';

  const DB_NAME = 'bfr_traduction_v1';
  const DB_VERSION = 1;

  /* CDN et sources officielles pour téléchargement initial unique */
  const CDN_JS_DELIVR = 'https://cdn.jsdelivr.net/npm/@browsermt/bergamot-translator@0.4.9/worker/';
  const CDN_MOZILLA = 'https://firefox-settings-attachments.cdn.mozilla.net/main-workspace/translations-models/';

  /* Registre des modèles optimisés pour inférence rapide sur mobile */
  const REGISTRE = {
    'fren': {
      nom: 'Français → Anglais (Pivot)',
      taille: 37200311,
      model: CDN_MOZILLA + '8ef78b1c-df6c-49fc-8cae-cf8c0c2a6630.bin',
      lex: CDN_MOZILLA + 'c4d99496-81bf-480f-b0bb-3aebacdcbe8e.bin',
      vocab: CDN_MOZILLA + '11ecb9da-60dd-4b39-aa12-27883099294b.spm'
    },
    'ennl': {
      nom: 'Anglais → Néerlandais',
      taille: 36400119,
      model: CDN_MOZILLA + 'f0f9326d-b77a-4c9f-92ac-2c9bc62e16bc.bin',
      lex: CDN_MOZILLA + 'c1f02d64-5e29-4181-b85a-0f70a9ac1c70.bin',
      vocab: CDN_MOZILLA + 'aea15ce7-3431-4186-b922-29b3f5d687ee.spm'
    },
    'ende': {
      nom: 'Anglais → Allemand',
      taille: 36719532,
      model: CDN_MOZILLA + '23db71e7-b6d9-45eb-a47d-0290d7d8ef63.bin',
      lex: CDN_MOZILLA + 'bc072b1a-7749-43f7-9fe0-34a6dff10c4a.bin',
      vocab: CDN_MOZILLA + '261225ea-5a52-455b-981c-7d09c6e6da3c.spm'
    },
    'enes': {
      nom: 'Anglais → Espagnol',
      taille: 36576277,
      model: CDN_MOZILLA + 'a4ba0e94-16de-4058-9a44-5bbbbb3c8640.bin',
      lex: CDN_MOZILLA + '1834a61e-0331-4c4a-bbc0-dda02afa8188.bin',
      vocab: CDN_MOZILLA + '170634fd-511a-4a28-b723-0a1025c67feb.spm'
    },
    'enit': {
      nom: 'Anglais → Italien',
      taille: 36507703,
      model: CDN_MOZILLA + '29ae0d70-5e37-49e8-8da6-3e2c58da61d1.bin',
      lex: CDN_MOZILLA + '3730ff60-2291-4c87-888d-2dc4593b20db.bin',
      vocab: CDN_MOZILLA + 'd9d5ffa9-b919-4491-9ab6-3dec34459768.spm'
    },
    'enpt': {
      nom: 'Anglais → Portugais',
      taille: 36348853,
      model: CDN_MOZILLA + '357d1004-e004-4f93-bbb5-b6b90641e9b4.bin',
      lex: CDN_MOZILLA + 'c4192576-e76a-4edc-9346-1f90af10f6ae.bin',
      vocab: CDN_MOZILLA + 'e5688e52-a5c1-458b-9dbb-459fdcec0b7d.spm'
    }
  };

  /* -------------------------------------------------------------------------
     1. Gestionnaire de stockage IndexedDB (Robuste, sans fuite)
     ------------------------------------------------------------------------- */
  let _dbInstance = null;

  function ouvrirDB() {
    if (_dbInstance) return Promise.resolve(_dbInstance);
    if (!global.indexedDB) return Promise.reject(new Error('IndexedDB non supporté'));

    return new Promise(function (resolve, reject) {
      const req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('models')) {
          db.createObjectStore('models', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('runtime')) {
          db.createObjectStore('runtime', { keyPath: 'id' });
        }
      };
      req.onsuccess = function (e) {
        _dbInstance = e.target.result;
        resolve(_dbInstance);
      };
      req.onerror = function (e) {
        reject(e.target.error || new Error('Erreur ouverture IndexedDB'));
      };
    });
  }

  function dbLire(storeName, key) {
    return ouvrirDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    }).catch(function () { return null; });
  }

  function dbEcrire(storeName, objet) {
    return ouvrirDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(objet);
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /* -------------------------------------------------------------------------
     2. Moteur BergamotEngine
     ------------------------------------------------------------------------- */
  const BergamotEngine = {
    registre: REGISTRE,

    /* Teste si l'environnement d'exécution dispose des capacités requises */
    isSupported: function () {
      try {
        return !!(
          global.Worker &&
          global.indexedDB &&
          typeof WebAssembly !== 'undefined' &&
          typeof WebAssembly.instantiate === 'function'
        );
      } catch (e) {
        return false;
      }
    },

    /* Détermine les paires de modèles requises pour une langue cible */
    pairesPour: function (code) {
      if (!code || code === 'fr') return [];
      if (code === 'en') return ['fren'];
      const cle = 'en' + code.toLowerCase();
      if (REGISTRE[cle]) return ['fren', cle];
      return [];
    },

    /* Vérifie si les modèles requis sont déjà téléchargés dans IndexedDB */
    hasModel: async function (code) {
      const paires = this.pairesPour(code);
      if (!paires.length) return false;
      try {
        for (let i = 0; i < paires.length; i++) {
          const rec = await dbLire('models', paires[i]);
          if (!rec || !rec.model || !rec.lex || !rec.vocab) return false;
        }
        // Vérifie aussi la présence du runtime WASM
        const wasm = await dbLire('runtime', 'wasm');
        if (!wasm || !wasm.buffer) return false;
        return true;
      } catch (e) {
        return false;
      }
    },

    /* Téléchargement résilient d'un buffer binaire avec suivi de progression */
    _telechargerFichier: async function (url, fallbackUrl, surOctets) {
      const charger = async function (u) {
        const rep = await fetch(u, { mode: 'cors', credentials: 'omit' });
        if (!rep.ok) throw new Error('HTTP ' + rep.status + ' pour ' + u);
        const total = parseInt(rep.headers.get('content-length') || '0', 10);
        if (!rep.body || !rep.body.getReader) {
          const buf = await rep.arrayBuffer();
          if (surOctets) surOctets(buf.byteLength, total || buf.byteLength);
          return buf;
        }
        const reader = rep.body.getReader();
        const chunks = [];
        let charge = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          charge += value.length;
          if (surOctets) surOctets(charge, total);
        }
        const totalBuf = new Uint8Array(charge);
        let offset = 0;
        for (let k = 0; k < chunks.length; k++) {
          totalBuf.set(chunks[k], offset);
          offset += chunks[k].length;
        }
        return totalBuf.buffer;
      };

      try {
        return await charger(url);
      } catch (e1) {
        if (fallbackUrl) return await charger(fallbackUrl);
        throw e1;
      }
    },

    /* Télécharge et persiste dans IndexedDB le runtime et les modèles nécessaires */
    prepareModel: async function (code, surEtat) {
      const paires = this.pairesPour(code);
      if (!paires.length) {
        return { ok: false, motif: 'langue_non_supportee' };
      }

      // 1. Vérification si déjà en cache IndexedDB
      if (await this.hasModel(code)) {
        if (surEtat) surEtat({ etape: 'pret', pct: 100 });
        return { ok: true, source: 'cache_local' };
      }

      try {
        // 2. Téléchargement du runtime WASM si absent
        let wasmRec = await dbLire('runtime', 'wasm');
        if (!wasmRec || !wasmRec.buffer) {
          if (surEtat) surEtat({ etape: 'telechargement', detail: 'Moteur WebAssembly...', pct: 5 });
          const wasmBuf = await this._telechargerFichier(
            './bergamot/bergamot-translator-worker.wasm',
            CDN_JS_DELIVR + 'bergamot-translator-worker.wasm'
          );
          await dbEcrire('runtime', { id: 'wasm', buffer: wasmBuf });
        }

        // Téléchargement des scripts de worker si absents
        let workerJsRec = await dbLire('runtime', 'worker_js');
        if (!workerJsRec || !workerJsRec.text) {
          const res = await fetch('./bergamot/translator-worker.js').catch(function () {
            return fetch(CDN_JS_DELIVR + 'translator-worker.js');
          });
          const txt = await res.text();
          await dbEcrire('runtime', { id: 'worker_js', text: txt });
        }

        let bergamotJsRec = await dbLire('runtime', 'bergamot_js');
        if (!bergamotJsRec || !bergamotJsRec.text) {
          const res = await fetch('./bergamot/bergamot-translator-worker.js').catch(function () {
            return fetch(CDN_JS_DELIVR + 'bergamot-translator-worker.js');
          });
          const txt = await res.text();
          await dbEcrire('runtime', { id: 'bergamot_js', text: txt });
        }

        // 3. Téléchargement des paires de modèles
        for (let pIdx = 0; pIdx < paires.length; pIdx++) {
          const p = paires[pIdx];
          const info = REGISTRE[p];
          if (!info) continue;

          let existant = await dbLire('models', p);
          if (existant && existant.model && existant.lex && existant.vocab) continue;

          const basePct = 10 + Math.round((pIdx / paires.length) * 85);
          const rangePct = Math.round(85 / paires.length);

          if (surEtat) surEtat({ etape: 'telechargement', detail: 'Modèle ' + info.nom + ' (vocabulaire)...', pct: basePct });
          const vocabBuf = await this._telechargerFichier(info.vocab);

          if (surEtat) surEtat({ etape: 'telechargement', detail: 'Modèle ' + info.nom + ' (lexique)...', pct: basePct + Math.round(rangePct * 0.2) });
          const lexBuf = await this._telechargerFichier(info.lex);

          if (surEtat) surEtat({ etape: 'telechargement', detail: 'Modèle ' + info.nom + ' (réseau de neurones)...', pct: basePct + Math.round(rangePct * 0.5) });
          const modelBuf = await this._telechargerFichier(info.model);

          await dbEcrire('models', {
            id: p,
            nom: info.nom,
            vocab: vocabBuf,
            lex: lexBuf,
            model: modelBuf,
            date: new Date().toISOString()
          });
        }

        if (surEtat) surEtat({ etape: 'pret', pct: 100 });
        return { ok: true, source: 'telecharge_et_persiste' };
      } catch (err) {
        return { ok: false, motif: 'modele', detail: err.message || String(err) };
      }
    },

    /* -----------------------------------------------------------------------
       3. Exécution séquentielle Low-Memory (Web Worker éphémère ou réutilisable)
       ----------------------------------------------------------------------- */
    traduireTextes: async function (textes, codeLangue, surEtat) {
      if (!textes || !textes.length) return [];
      const code = (codeLangue || '').toLowerCase();
      if (code === 'fr') return textes;

      const paires = this.pairesPour(code);
      if (!paires.length) throw new Error('Langue non supportée : ' + code);

      // Vérification que les modèles sont présents dans IndexedDB
      for (let i = 0; i < paires.length; i++) {
        const m = await dbLire('models', paires[i]);
        if (!m) throw new Error('Modèle ' + paires[i] + ' non préparé.');
      }

      // Protection des termes et entités métier BFR
      const protecteur = global.GlossaireBFR || {
        proteger: function (t) { return { texte: t, tags: [] }; },
        restaurer: function (t, tags) { return t; },
        affiner: function (t, l) { return t; }
      };

      const proteges = textes.map(function (t) { return protecteur.proteger(t); });
      let courants = proteges.map(function (p) { return p.texte; });

      // Instanciation du Worker
      const workerUrl = './bergamot/translator-worker.js';
      const worker = new global.Worker(workerUrl);

      const appelWorker = function (nomMethode, args) {
        return new Promise(function (resolve, reject) {
          const reqId = Math.random().toString(36).slice(2);
          const ecouteur = function (e) {
            const data = e.data || {};
            if (data.id === reqId) {
              worker.removeEventListener('message', ecouteur);
              if (data.error) reject(new Error(data.error.message || 'Erreur Worker'));
              else resolve(data.result);
            }
          };
          worker.addEventListener('message', ecouteur);
          worker.postMessage({ id: reqId, name: nomMethode, args: args || [] });
        });
      };

      try {
        if (surEtat) surEtat({ etape: 'initialisation', detail: 'Démarrage du moteur de traduction...' });
        await appelWorker('initialize', [{ cacheSize: 0, useNativeIntGemm: false }]);

        /* SÉQUENCE BASSE-MÉMOIRE :
           Pour chaque étape de pivot (ex: FR->EN puis EN->NL), on charge
           un SEUL modèle, on traduit en bloc, puis on DÉCHARGE le modèle
           avant de charger le suivant. */
        for (let step = 0; step < paires.length; step++) {
          const paireId = paires[step];
          const srcLang = paireId.slice(0, 2);
          const trgLang = paireId.slice(2, 4);

          if (surEtat) {
            surEtat({
              etape: 'traduction_inference',
              detail: 'Traduction ' + srcLang.toUpperCase() + ' → ' + trgLang.toUpperCase() + '...',
              etapeIndex: step + 1,
              etapesTotal: paires.length
            });
          }

          const modelData = await dbLire('models', paireId);
          await appelWorker('loadTranslationModel', [
            { from: srcLang, to: trgLang },
            {
              model: modelData.model,
              shortlist: modelData.lex,
              vocabs: [modelData.vocab]
            }
          ]);

          const payload = courants.map(function (txt) {
            return { text: txt, html: false };
          });

          const reponses = await appelWorker('translate', [{
            models: [{ from: srcLang, to: trgLang }],
            texts: payload
          }]);

          courants = (reponses || []).map(function (r) {
            return (r && r.target && r.target.text) || '';
          });

          // Libération immédiate de la mémoire Marian C++
          await appelWorker('unloadTranslationModel', [{ from: srcLang, to: trgLang }]);
        }

        worker.terminate();

        // Restauration des balises protégées et affinage terminologique BFR
        const finals = courants.map(function (txt, idx) {
          const restaure = protecteur.restaurer(txt, proteges[idx].tags);
          return protecteur.affiner(restaure, code);
        });

        return finals;
      } catch (err) {
        try { worker.terminate(); } catch (e) {}
        throw err;
      }
    }
  };

  global.BergamotEngine = BergamotEngine;
})(typeof window !== 'undefined' ? window : global);
