/* =========================================================================
   traduction.js — Traduction du rapport dans la langue du client
   -------------------------------------------------------------------------
   • Les libellés du rapport (titres, tableaux, mentions, pied de page) sont
     traduits par les packs de langue embarqués (langues.js) : toujours
     disponibles, hors connexion.

   • Les textes SAISIS par le technicien (objet, actions, observations,
     synthèse) sont traduits par le traducteur intégré du téléphone :
       - API « Translator » de Chrome (Android, Chrome 138+) : gratuite,
         aucune clé, et HORS CONNEXION une fois la langue téléchargée ;
       - repli sur l'API précédente « self.translation ».
     Si le traducteur n'est pas disponible (navigateur plus ancien, modèle
     non téléchargeable sans réseau), l'application le dit clairement et
     laisse le choix : envoyer seulement le français, ou la version traduite
     avec les libellés traduits et les commentaires en français.
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

  const Traduction = {
    /* ---------- Disponibilité ------------------------------------------- */
    /* Le téléphone sait-il traduire ? (sans rien télécharger) */
    utilisable: function () { return !!api(); },
    explication: function () {
      const a = api();
      if (!a) return "Ce téléphone ne propose pas la traduction automatique : les libellés du rapport seront traduits, les commentaires resteront en français.";
      return '';
    },

    /* État du modèle de langue : 'available', 'downloadable', 'downloading',
       'unavailable' ou 'inconnu' (API indisponible). */
    etatModele: function (code) {
      const a = api();
      if (!a) return Promise.resolve('inconnu');
      const p = a.type === 'moderne'
        ? a.obj.availability({ sourceLanguage: SRC, targetLanguage: code })
        : a.obj.canTranslate({ sourceLanguage: SRC, targetLanguage: code });
      return Promise.resolve(p).then(function (r) {
        return r === 'readily' ? 'available' : (r === 'after-download' ? 'downloadable' : (r === 'no' ? 'unavailable' : r));
      }).catch(function () { return 'unavailable'; });
    },

    /* ---------- Préparation du traducteur ------------------------------- */
    /* Crée le traducteur fr -> code ; télécharge le modèle si nécessaire
       (une seule fois par langue sur le téléphone). */
    pret: async function (code, surEtat) {
      const a = api();
      if (!a) return { ok: false, motif: 'indisponible' };
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
        /* Cas courant : pas de réseau au premier usage d'une langue. */
        return { ok: false, motif: /download|fetch|network|réseau/i.test(msg) ? 'modele' : 'refus', detail: msg };
      }
    },

    fermer: function () {
      if (this._moteur && this._moteur.destroy) { try { this._moteur.destroy(); } catch (e) {} }
      this._moteur = null;
      this._code = null;
    },

    /* ---------- Traduction d'un texte ----------------------------------- */
    /* Découpe par paragraphes (les sauts de ligne du rapport sont conservés). */
    texte: async function (txt, code, surEtat) {
      const brut = String(txt == null ? '' : txt);
      if (!brut.trim()) return brut;
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
          t = l;                       // une ligne en échec ne bloque pas le rapport
        }
        this._cache[cleLigne] = t;
        sorties.push(t);
      }
      const resultat = sorties.join('\n');
      this._cache[cleTexte] = resultat;
      return resultat;
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
      /* on retraduit les mêmes champs sur la copie */
      const copieTaches = this.champs(copie);
      const total = copieTaches.length;
      let fait = 0, erreurs = 0;
      if (surEtat) surEtat({ etape: 'traduction', fait: 0, total: total, pct: 0 });
      for (let k = 0; k < copieTaches.length; k++) {
        const t = copieTaches[k];
        if (surEtat) surEtat({ etape: 'traduction', etiquette: t.etiquette, fait: fait, total: total, pct: total ? Math.round(fait / total * 100) : 0 });
        try {
          t.obj[t.champ] = await this.texte(t.texte, code, surEtat);
        } catch (e) {
          erreurs++;                                   // texte laissé en français
        }
        fait++;
      }
      if (surEtat) surEtat({ etape: 'traduction', fait: total, total: total, pct: 100 });
      return { ok: true, rapport: copie, nb: total - erreurs, total: total, erreurs: erreurs };
    }
  };

  global.Traduction = Traduction;
})(window);
