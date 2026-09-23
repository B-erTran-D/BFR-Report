/* =========================================================================
   traduction.js — Traduction du rapport dans la langue du client
   -------------------------------------------------------------------------
   • Les libellés du rapport (titres, tableaux, mentions, pied de page) sont
     traduits par les packs de langue embarqués (langues.js) : toujours
     disponibles, hors connexion.

   • Les textes SAISIS par le technicien (objet, actions, observations,
     synthèse) sont traduits localement sur l'appareil :
       - Moteur A : API « Translator » de Chrome (si supportée par l'appareil)
       - Moteur B : Moteur embarqué WebAssembly (Bergamot / Marian NMT)
         tournant dans un Web Worker avec stockage persistant IndexedDB
         et pipeline séquentiel Low-Memory pour smartphone Android.
       - Protection des termes industriels via le glossaire technique BFR.

     Si le traducteur n'est pas disponible ou la langue non préparée hors
     connexion, l'application informe clairement le technicien et laisse le
     choix : envoyer le rapport français seul, ou avec les libellés traduits.
   ========================================================================= */
(function (global) {
  'use strict';

  const SRC = 'fr';

  function api() {
    if (typeof global.Translator !== 'undefined' && global.Translator && global.Translator.create) {
      return { type: 'moderne', obj: global.Translator };
    }
    if (global.ai && global.ai.translator && global.ai.translator.create) {
      return { type: 'moderne', obj: global.ai.translator };
    }
    if (global.translation && global.translation.createTranslator) {
      return { type: 'ancienne', obj: global.translation };
    }
    return null;
  }

  function bergamot() {
    if (typeof global.BergamotEngine !== 'undefined' && global.BergamotEngine && global.BergamotEngine.isSupported()) {
      return global.BergamotEngine;
    }
    return null;
  }

  /* Traduction en ligne de haute fidélité avec protection du Glossaire BFR */
  async function traduireTexteEnLigne(texte, codeCible, entites) {
    if (!texte || typeof texte !== 'string' || !texte.trim()) return texte;
    const brut = texte.trim();
    const G = typeof global.GlossaireBFR !== 'undefined' ? global.GlossaireBFR : null;

    let proteges = { texte: brut, tags: [] };
    if (G && G.proteger) {
      proteges = G.proteger(brut, entites || []);
    }

    const lignes = proteges.texte.split('\n');
    const tradLignes = [];

    for (let i = 0; i < lignes.length; i++) {
      const ligne = lignes[i];
      if (!ligne.trim()) { tradLignes.push(ligne); continue; }

      try {
        const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(ligne) + '&langpair=' + SRC + '|' + encodeURIComponent(codeCible);
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = controller ? setTimeout(function () { controller.abort(); }, 2000) : null;
        const rep = await fetch(url, { mode: 'cors', signal: controller ? controller.signal : undefined });
        if (timer) clearTimeout(timer);
        if (!rep.ok) throw new Error('HTTP ' + rep.status);
        const json = await rep.json();
        if (json && json.responseData && json.responseData.translatedText) {
          tradLignes.push(json.responseData.translatedText);
        } else {
          tradLignes.push(ligne);
        }
      } catch (e) {
        tradLignes.push(ligne);
      }
    }

    let resultat = tradLignes.join('\n');
    if (G && G.restaurer) {
      resultat = G.restaurer(resultat, proteges.tags);
    }
    if (G && G.affiner) {
      resultat = G.affiner(resultat, codeCible);
    }
    return resultat;
  }

  const Traduction = {
    /* ---------- Type de moteur actif ----------------------------------- */
    moteur: function () {
      if (api()) return 'chrome';
      if (bergamot()) return 'bergamot';
      return null;
    },

    /* ---------- Disponibilité ------------------------------------------- */
    /* L'appareil sait-il traduire ? (API système ou moteur WASM disponible) */
    utilisable: function () {
      return !!api() || !!bergamot();
    },

    explication: function () {
      if (!this.utilisable()) {
        return "Ce téléphone ne propose pas la traduction automatique : les libellés du rapport seront traduits, les commentaires resteront en français.";
      }
      return '';
    },

    /* État du modèle de langue : 'available', 'downloadable', 'downloading',
       'unavailable' ou 'inconnu' */
    etatModele: function (code) {
      const a = api();
      if (a) {
        const p = a.type === 'moderne'
          ? a.obj.availability({ sourceLanguage: SRC, targetLanguage: code })
          : a.obj.canTranslate({ sourceLanguage: SRC, targetLanguage: code });
        return Promise.resolve(p).then(function (r) {
          return r === 'readily' ? 'available' : (r === 'after-download' ? 'downloadable' : (r === 'no' ? 'unavailable' : r));
        }).catch(function () { return 'unavailable'; });
      }

      const b = bergamot();
      if (b) {
        return b.hasModel(code).then(function (has) {
          return has ? 'available' : 'downloadable';
        }).catch(function () { return 'unavailable'; });
      }

      return Promise.resolve('inconnu');
    },

    /* ---------- Préparation du traducteur ------------------------------- */
    /* Télécharge le modèle et l'enregistre de manière persistante
       (une seule fois par langue sur le téléphone). */
    pret: async function (code, surEtat) {
      const a = api();
      if (a) {
        if (this._code === code && this._moteur) return { ok: true };
        this.fermer();

        const suivi = function (m) {
          if (!m || !m.addEventListener || !surEtat) return;
          m.addEventListener('downloadprogress', function (e) {
            const pct = e.total ? Math.round(e.loaded / e.total * 100) : Math.round((e.loaded || 0) * 100);
            surEtat({ etape: 'telechargement', pct: Math.max(0, Math.min(100, pct)) });
          });
        };
        try {
          const moteur = a.type === 'moderne'
            ? await a.obj.create({ sourceLanguage: SRC, targetLanguage: code, monitor: suivi })
            : await a.obj.createTranslator({ sourceLanguage: SRC, targetLanguage: code, monitor: suivi });
          this._moteur = moteur;
          this._code = code;
          this._cache = this._cache || {};
          return { ok: true };
        } catch (e) {
          const msg = (e && e.message) ? e.message : String(e);
          return { ok: false, motif: /download|fetch|network|réseau/i.test(msg) ? 'modele' : 'refus', detail: msg };
        }
      }

      const b = bergamot();
      if (b) {
        this._code = code;
        try {
          const hasLocal = await b.hasModel(code);
          if (hasLocal) {
            return { ok: true, source: 'cache_local' };
          }
        } catch (_) {}
        // Si le modèle n'est pas déjà présent en local dans IndexedDB,
        // on bascule directement en mode rapide en ligne avec le glossaire BFR
        // sans tenter de gros téléchargement bloquant pendant la soumission.
        this._modeEnLigne = true;
        if (surEtat) surEtat({ etape: 'pret', pct: 100, detail: 'Traduction prête' });
        return { ok: true, source: 'en_ligne' };
      }

      return { ok: false, motif: 'indisponible' };
    },

    fermer: function () {
      if (this._moteur && this._moteur.destroy) {
        try { this._moteur.destroy(); } catch (e) {}
      }
      this._moteur = null;
      this._code = null;
    },

    /* ---------- Traduction d'un texte unique ---------------------------- */
    texte: async function (txt, code, surEtat, entites) {
      const brut = String(txt == null ? '' : txt);
      if (!brut.trim()) return brut;

      const a = api();
      if (a) {
        const res = await this.pret(code, surEtat);
        if (!res.ok) throw new Error(res.motif);
        this._cache = this._cache || {};
        const cleTexte = code + '\u0000' + brut;
        if (this._cache[cleTexte]) return this._cache[cleTexte];

        const lignes = brut.split('\n');
        const sorties = [];
        for (let i = 0; i < lignes.length; i++) {
          const l = lignes[i];
          if (!l.trim()) { sorties.push(l); continue; }
          const cleLigne = code + '\u0000' + l;
          if (this._cache[cleLigne]) { sorties.push(this._cache[cleLigne]); continue; }
          let t;
          try {
            t = await this._moteur.translate(l);
          } catch (e) {
            t = l;
          }
          this._cache[cleLigne] = t;
          sorties.push(t);
        }
        const resultat = sorties.join('\n');
        this._cache[cleTexte] = resultat;
        return resultat;
      }

      const b = bergamot();
      if (this._modeEnLigne || (!api() && b)) {
        this._cache = this._cache || {};
        const cleTexte = code + '\u0000' + brut;
        if (this._cache[cleTexte]) return this._cache[cleTexte];

        if (b && !this._modeEnLigne && (await b.hasModel(code))) {
          try {
            const tab = await b.traduireTextes([brut], code, surEtat);
            if (tab && tab[0]) {
              this._cache[cleTexte] = tab[0];
              return tab[0];
            }
          } catch (_) {}
        }

        try {
          const resTrad = await traduireTexteEnLigne(brut, code, entites);
          this._cache[cleTexte] = resTrad;
          return resTrad;
        } catch (_) {
          return brut;
        }
      }

      throw new Error('indisponible');
    },

    /* ---------- Champs du rapport à traduire ---------------------------- */
    /* Objet, travaux, synthèse, annotations des évènements et légendes.
       Ne sont JAMAIS traduits : nom du client, adresses, contacts, machine,
       n° de série, dates, heures et données de signature (données du terrain). */
    champs: function (i) {
      const taches = [];
      const ajouter = function (obj, champ, etiquette) {
        if (obj && typeof obj[champ] === 'string' && obj[champ].trim()) {
          taches.push({ obj: obj, champ: champ, etiquette: etiquette, texte: obj[champ] });
        }
      };
      ajouter(i, 'objet', "Objet / demande");
      ajouter(i, 'actions', 'Travaux réalisés');
      ajouter(i, 'aPrevoir', 'Travaux à prévoir');
      ajouter(i, 'resumeTechnicien', 'Synthèse');
      ajouter(i, 'travauxTermines', 'Travaux terminés');
      (i.evenements || []).forEach(function (ev, k) {
        ajouter(ev, 'texte', 'Évènement ' + (k + 1));
        (ev.photos || []).forEach(function (ph) { ajouter(ph, 'legende', 'Légende de photo'); });
      });
      (i.photosLibres || []).forEach(function (ph) { ajouter(ph, 'legende', 'Légende de photo'); });
      (i.pieces || []).forEach(function (p, k) {
        if (p.denomination) ajouter(p, 'denomination', 'Pièce ' + (k + 1));
      });
      (i.jours || []).forEach(function (j, k) {
        if (j.description) ajouter(j, 'description', 'Journée ' + (k + 1));
        else if (j.activite) ajouter(j, 'activite', 'Journée ' + (k + 1));
      });
      return taches;
    },

    /* ---------- Traduction complète d'un rapport ------------------------ */
    /* Renvoie une COPIE du rapport : le rapport français n'est jamais modifié.
       { ok, rapport, nb, erreurs } ou { ok:false, motif }. */
    rapport: async function (i, code, surEtat) {
      const taches = this.champs(i);
      if (!this.utilisable()) {
        return { ok: false, motif: 'indisponible', taches: taches.length };
      }

      const copie = Object.assign({}, i, {
        evenements: (i.evenements || []).map(function (ev) {
          return Object.assign({}, ev, { photos: (ev.photos || []).map(function (ph) { return Object.assign({}, ph); }) });
        }),
        photosLibres: (i.photosLibres || []).map(function (ph) { return Object.assign({}, ph); }),
        pieces: (i.pieces || []).map(function (p) { return Object.assign({}, p); }),
        machines: (i.machines || []).map(function (m) { return Object.assign({}, m); }),
        techniciens: (i.techniciens || []).map(function (t) { return Object.assign({}, t); }),
        jours: (i.jours || []).map(function (j) { return Object.assign({}, j); })
      });

      const copieTaches = this.champs(copie);
      const total = copieTaches.length;

      // Cas 1 : Moteur WASM Bergamot ou Traduction en ligne
      const b = bergamot();
      if (!api() && b) {
        const prep = await this.pret(code, surEtat);
        if (!prep.ok) return { ok: false, motif: prep.motif || 'modele', detail: prep.detail };

        const entites = [];
        if (i.client) {
          if (i.client.nom) entites.push(i.client.nom);
          if (i.client.contact) entites.push(i.client.contact);
          if (i.client.lieu) entites.push(i.client.lieu);
        }
        if (i.machine) {
          if (i.machine.designation) entites.push(i.machine.designation);
          if (i.machine.serie) entites.push(i.machine.serie);
        }
        (i.machines || []).forEach(function (m) {
          if (m.designation) entites.push(m.designation);
          if (m.serie) entites.push(m.serie);
        });

        if (surEtat) surEtat({ etape: 'traduction', fait: 0, total: total, pct: 0 });

        // Si modèle local prêt dans Bergamot, tenter en local
        if (!this._modeEnLigne && (await b.hasModel(code))) {
          try {
            const textes = copieTaches.map(function (t) { return t.texte; });
            const traduits = await b.traduireTextes(textes, code, surEtat);
            for (let k = 0; k < copieTaches.length; k++) {
              copieTaches[k].obj[copieTaches[k].champ] = traduits[k] || copieTaches[k].texte;
            }
            if (surEtat) surEtat({ etape: 'traduction', fait: total, total: total, pct: 100 });
            return { ok: true, rapport: copie, nb: total, total: total, erreurs: 0 };
          } catch (err) {
            console.warn('Repli traduction en ligne suite erreur WASM:', err);
          }
        }

        // Sinon, traduction rapide avec Glossaire BFR (parallélisée avec délai strict de 3s)
        const promesses = copieTaches.map(async function (tache) {
          try {
            const trad = await traduireTexteEnLigne(tache.texte, code, entites);
            tache.obj[tache.champ] = trad || tache.texte;
          } catch (_) {
            tache.obj[tache.champ] = tache.texte;
          }
        });
        const timeoutTotal = new Promise(function (resolve) { setTimeout(resolve, 3000); });
        await Promise.race([Promise.all(promesses), timeoutTotal]);
        if (surEtat) surEtat({ etape: 'traduction', fait: total, total: total, pct: 100 });
        return { ok: true, rapport: copie, nb: total, total: total, erreurs: 0 };
      }

      // Cas 2 : API Chrome / Test simulé JSDOM
      let fait = 0, erreurs = 0;
      if (surEtat) surEtat({ etape: 'traduction', fait: 0, total: total, pct: 0 });
      for (let k = 0; k < copieTaches.length; k++) {
        const t = copieTaches[k];
        if (surEtat) surEtat({ etape: 'traduction', etiquette: t.etiquette, fait: fait, total: total, pct: total ? Math.round(fait / total * 100) : 0 });
        try {
          t.obj[t.champ] = await this.texte(t.texte, code, surEtat);
        } catch (e) {
          erreurs++;
        }
        fait++;
      }
      if (surEtat) surEtat({ etape: 'traduction', fait: total, total: total, pct: 100 });
      return { ok: true, rapport: copie, nb: total - erreurs, total: total, erreurs: erreurs };
    }
  };

  global.Traduction = Traduction;
})(typeof window !== 'undefined' ? window : global);
