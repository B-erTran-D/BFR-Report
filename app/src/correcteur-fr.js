/* =========================================================================
   correcteur-fr.js — Correction automatique du français (Accords & Orthographe)
   -------------------------------------------------------------------------
   Nettoie et fiabilise les commentaires saisis par le technicien sur le
   terrain (écran tactile mobile, dictée vocale) avant la génération des
   rapports PDF/Word et avant toute traduction en langue étrangère :
     1. Pluriels oubliés (le « s » après déterminants ou nombres)
     2. Accords des participes passés (passif : « a été remplacée »)
     3. Confusion infinitif / participe (« pour vérifier », « a changé »)
     4. Rétablissement des accents techniques SAV (vérin, étanchéité, etc.)
     5. Rétablissement des apostrophes manquantes (« d etancheite » -> « d'étanchéité »)
     6. Typographie professionnelle (majuscules de début de phrase, ponctuation)
     7. Sanctuarisation absolue des noms propres, modèles et références BFR
   ========================================================================= */
(function (global) {
  'use strict';

  /* -----------------------------------------------------------------------
     1. Dictionnaire d'accents pour les termes techniques SAV BFR
     ----------------------------------------------------------------------- */
  const ACCENTS_TECH = {
    'verin': 'vérin', 'verins': 'vérins',
    'etancheite': 'étanchéité', 'etancheites': 'étanchéités',
    'etanche': 'étanche', 'etanches': 'étanches',
    'mecanique': 'mécanique', 'mecaniques': 'mécaniques',
    'electrique': 'électrique', 'electriques': 'électriques',
    'reducteur': 'réducteur', 'reducteurs': 'réducteurs',
    'motoreducteur': 'motoréducteur', 'motoreducteurs': 'motoréducteurs',
    'trapezoidale': 'trapézoïdale', 'trapezoidales': 'trapézoïdales',
    'trapezoidal': 'trapézoïdal', 'trapezoidaux': 'trapézoïdaux',
    'crantee': 'crantée', 'crantees': 'crantées',
    'crante': 'cranté', 'crantes': 'crantés',
    'arret': 'arrêt', 'arrets': 'arrêts',
    'reglage': 'réglage', 'reglages': 'réglages',
    'debit': 'débit', 'debits': 'débits',
    'temperature': 'température', 'temperatures': 'températures',
    'securite': 'sécurité', 'securites': 'sécurités',
    'presence': 'présence',
    'defaut': 'défaut', 'defauts': 'défauts',
    'cable': 'câble', 'cables': 'câbles',
    'chaine': 'chaîne', 'chaines': 'chaînes',
    'piece': 'pièce', 'pieces': 'pièces',
    'echauffement': 'échauffement', 'echauffements': 'échauffements',
    'deteriore': 'détérioré', 'deterioree': 'détériorée',
    'deteriores': 'détériorés', 'deteriorees': 'détériorées',
    'abime': 'abîmé', 'abimee': 'abîmée',
    'abimes': 'abîmés', 'abimees': 'abîmées',
    'casse': 'cassé', 'cassee': 'cassée',
    'casses': 'cassés', 'cassees': 'cassées',
    'controle': 'contrôle', 'controles': 'contrôles',
    'reparation': 'réparation', 'reparations': 'réparations',
    'operation': 'opération', 'operations': 'opérations',
    'verification': 'vérification', 'verifications': 'vérifications',
    'precision': 'précision', 'precisions': 'précisions',
    'alignement': 'alignement',
    'evenement': 'évènement', 'evenements': 'évènements',
    'deja': 'déjà', 'apres': 'après', 'tres': 'très',
    'fleche': 'flèche', 'fleches': 'flèches',
    'prevoir': 'prévoir', 'previsibles': 'prévisibles',
    'prevu': 'prévu', 'prevue': 'prévue', 'prevus': 'prévus', 'prevues': 'prévues',
    'ete': 'été'
  };

  /* Unités de mesure et symboles techniques à ne JAMAIS altérer */
  const UNITES = new Set([
    'mm', 'cm', 'm', 'km', 'g', 'kg', 't', 'l', 'ml', 'bar', 'bars',
    '°c', 'k', 'hz', 'khz', 'v', 'a', 'w', 'kw', 'tr/min', 'rpm',
    'h', 'min', 's', 'ms', '%'
  ]);

  /* Mots invariables se terminant déjà par s, x, z */
  const INVARIABLES = new Set([
    'vis', 'corps', 'fois', 'mois', 'prix', 'gaz', 'choix', 'taux',
    'poids', 'bras', 'relais', 'châssis', 'chassis', 'accès', 'acces',
    'secours', 'emboutissage', 'engrenage', 'engrenages', 'graissage'
  ]);

  /* Noms féminins fréquents dans le SAV BFR pour accords passifs */
  const NOMS_FEMININS_SING = 'courroie|pompe|machine|pièce|piece|cellule|armoire|carte|vanne|sonde|gaine|poulie|bride|ligne|chaîne|chaine|zone|presse|vis';
  const NOMS_FEMININS_PLUR = 'vis|courroies|pompes|machines|pièces|pieces|cellules|armoires|cartes|vannes|sondes|gaines|poulies|brides|lignes|chaînes|chaines|zones|presses';
  const FEM_PLUR_SET = new Set(NOMS_FEMININS_PLUR.split('|'));

  /* Adjectifs techniques courants à accorder avec un pluriel précédent */
  const ADJECTIFS_PLURIELS = {
    'pneumatique': 'pneumatiques',
    'hydraulique': 'hydrauliques',
    'électrique': 'électriques',
    'electrique': 'électriques',
    'mécanique': 'mécaniques',
    'mecanique': 'mécaniques',
    'trapézoïdale': 'trapézoïdales',
    'trapezoidale': 'trapézoïdales',
    'crantée': 'crantées',
    'crantee': 'crantées',
    'optique': 'optiques',
    'inductif': 'inductifs',
    'inductifs': 'inductifs',
    'usé': 'usés',
    'use': 'usés',
    'neuf': 'neufs',
    'cassé': 'cassés',
    'casse': 'cassés',
    'desserré': 'desserrés',
    'desserre': 'desserrés',
    'détérioré': 'détériorés',
    'deteriore': 'détériorés',
    'abîmé': 'abîmés',
    'abime': 'abîmés',
    'défectueux': 'défectueux',
    'defectueux': 'défectueux',
    'principal': 'principaux',
    'secondaire': 'secondaires',
    'supérieur': 'supérieurs',
    'superieur': 'supérieurs',
    'inférieur': 'inférieurs',
    'inferieur': 'inférieurs',
    'latéral': 'latéraux',
    'lateral': 'latéraux'
  };

  /* Verbes d'action SAV courants */
  const VERBES_SAV = [
    'remplacer', 'changer', 'nettoyer', 'vérifier', 'resserrer', 'régler',
    'contrôler', 'lubrifier', 'graisser', 'purger', 'tester', 'réparer',
    'démonter', 'remonter', 'isoler', 'calibrer', 'aligner', 'redémarrer',
    'démarrer', 'commander', 'ajuster', 'constater', 'observer', 'sécuriser'
  ];

  const MAP_INFINITIF = {};
  const MAP_PARTICIPE = {};

  VERBES_SAV.forEach(function (v) {
    const rad = v.slice(0, -2);
    const radNoAcc = rad.replace(/[éèê]/g, 'e');
    const part = rad + 'é';

    MAP_INFINITIF[rad + 'é'] = v;
    MAP_INFINITIF[rad + 'e'] = v;
    MAP_INFINITIF[rad + 'ez'] = v;
    MAP_INFINITIF[rad + 'er'] = v;
    MAP_INFINITIF[radNoAcc + 'e'] = v;
    MAP_INFINITIF[radNoAcc + 'é'] = v;
    MAP_INFINITIF[radNoAcc + 'er'] = v;

    MAP_PARTICIPE[v] = part;
    MAP_PARTICIPE[v.replace(/[éèê]/g, 'e')] = part;
    MAP_PARTICIPE[rad + 'er'] = part;
    MAP_PARTICIPE[rad + 'e'] = part;
    MAP_PARTICIPE[radNoAcc + 'e'] = part;
    MAP_PARTICIPE[radNoAcc + 'er'] = part;
  });

  /* Mettre un mot au pluriel selon les règles du français */
  function pluraliserMot(mot) {
    const low = mot.toLowerCase();
    if (UNITES.has(low) || INVARIABLES.has(low) || low.endsWith('s') || low.endsWith('x') || low.endsWith('z')) {
      return mot;
    }
    if (low === 'nouveau' || low === 'beau') return mot + 'x';
    if (low.endsWith('eau') || low.endsWith('eu')) return mot + 'x';
    if (low.endsWith('al') && !['bancal', 'fatal', 'naval', 'final'].includes(low)) {
      return mot.slice(0, -2) + 'aux';
    }
    return mot + 's';
  }

  const CorrecteurFR = {
    /* -----------------------------------------------------------------------
       Correction principale d'un texte français
       ----------------------------------------------------------------------- */
    corrigerTexte: function (texte, entites, opts) {
      opts = opts || {};
      const estPhrase = opts.estPhrase !== false;
      if (!texte || typeof texte !== 'string') return '';
      let res = texte.trim();
      if (!res) return '';

      // 0. Sanctuarisation des identifiants propres BFR (ne jamais les toucher)
      const tags = [];
      const cibles = (entites || []).filter(function (e) {
        return e && typeof e === 'string' && e.trim().length >= 2;
      }).sort(function (a, b) { return b.length - a.length; });

      cibles.forEach(function (nom) {
        const motif = new RegExp('\\b' + nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
        res = res.replace(motif, function (m) {
          const id = tags.length;
          tags.push(m);
          return ' __BFR_PROT_' + id + '__ ';
        });
      });

      // Protéger références techniques : PH1204D-2011-0387, 6205-2RS, 120T, 1450 tr/min, etc.
      res = res.replace(/\b([A-Z0-9]{2,}[-_][A-Z0-9-_]+)\b/g, function (m) {
        const id = tags.length;
        tags.push(m);
        return ' __BFR_PROT_' + id + '__ ';
      });

      // Protéger nombres avec unités (ex: 12 mm, 0,18 mm, 81 °C, 1 450 tr/min, 15 h 00)
      res = res.replace(/\b(\d+[\d\s,\.]*\s*(?:mm|cm|m|km|g|kg|t|l|ml|bar|bars|°c|k|hz|khz|v|a|w|kw|tr\/min|rpm|h|min|s|ms|%))\b/gi, function (m) {
        const id = tags.length;
        tags.push(m);
        return ' __BFR_PROT_' + id + '__ ';
      });

      // 1. Rétablissement des apostrophes oubliées (ex: « d etancheite » -> « d'étanchéité »)
      res = res.replace(/\b([cdjlnmst]|qu)\s+([aeiouyéèêëàâîïôûùh][a-zA-ZÀ-ÿ]+)/gi, function (m, p1, p2) {
        return p1 + "'" + p2;
      });

      // 2. Confusion Infinitif après préposition (ex: « prévoir de nettoyer », « pour isoler », « d'isoler »)
      const prepRegex = /\b(pour|afin de|avant de|sans|prévoir de|prevoir de|impossible de|facile à|facile a|difficile à|difficile a|permet de|permettent de|de|à|a)\s+([a-zA-ZÀ-ÿ]+)(?![a-zA-ZÀ-ÿ])/gi;
      res = res.replace(prepRegex, function (m, prep, verbe) {
        const low = verbe.toLowerCase();
        if (MAP_INFINITIF[low]) {
          return prep + ' ' + MAP_INFINITIF[low];
        }
        return m;
      });

      const dApoRegex = /\b(d['’])([a-zA-ZÀ-ÿ]+)(?![a-zA-ZÀ-ÿ])/gi;
      res = res.replace(dApoRegex, function (m, apo, verbe) {
        const low = verbe.toLowerCase();
        if (MAP_INFINITIF[low]) {
          return apo + MAP_INFINITIF[low];
        }
        return m;
      });

      // 3. Rétablissement des accents techniques SAV BFR
      res = res.replace(/[a-zA-ZÀ-ÿ]+/g, function (mot) {
        const low = mot.toLowerCase();
        if (ACCENTS_TECH[low]) {
          const acc = ACCENTS_TECH[low];
          if (mot[0] === mot[0].toUpperCase() && mot[0] !== mot[0].toLowerCase()) {
            return acc.charAt(0).toUpperCase() + acc.slice(1);
          }
          return acc;
        }
        return mot;
      });

      // 4. Confusion Participe après auxiliaire avoir (ex: « a changer » -> « a changé »)
      const avoirRegex = /\b(a|ont|avons|avez|avait|avaient)\s+([a-zA-ZÀ-ÿ]+)(?![a-zA-ZÀ-ÿ])/gi;
      res = res.replace(avoirRegex, function (m, aux, verbe) {
        const low = verbe.toLowerCase();
        if (MAP_PARTICIPE[low]) {
          return aux + ' ' + MAP_PARTICIPE[low];
        }
        return m;
      });

      // 5. Accords passifs :
      // Féminin singulier (ex: « courroie a été remplacée », « la pompe a ete remplace » -> « la pompe a été remplacée »)
      const patAete = new RegExp('\\b((?:la|une|cette)\\s+)?(' + NOMS_FEMININS_SING + ')\\s+(?:a\\s+été|a\\s+ete|est|était|etait|sera)\\s+([a-zA-ZÀ-ÿ]+)(?![a-zA-ZÀ-ÿ])', 'gi');
      res = res.replace(patAete, function (m, det, nom, part) {
        let aux = 'a été';
        if (/est/i.test(m)) aux = 'est';
        else if (/était|etait/i.test(m)) aux = 'était';
        else if (/sera/i.test(m)) aux = 'sera';

        const partFem = part.replace(/(?:ées|ée|és|é|es|e)$/i, '') + 'ée';
        return (det || '') + nom + ' ' + aux + ' ' + partFem;
      });

      // Féminin pluriel (ex: « vis ont été resserrées », « courroies ont été changées »)
      const patOntEteFem = new RegExp('\\b((?:les|des|ces|toutes les|\\d+)\\s+)?(' + NOMS_FEMININS_PLUR + ')\\s+(?:ont\\s+été|ont\\s+ete|sont|étaient|etaient|seront)\\s+([a-zA-ZÀ-ÿ]+)(?![a-zA-ZÀ-ÿ])', 'gi');
      res = res.replace(patOntEteFem, function (m, det, nom, part) {
        let aux = 'ont été';
        if (/sont/i.test(m)) aux = 'sont';
        else if (/étaient|etaient/i.test(m)) aux = 'étaient';
        else if (/seront/i.test(m)) aux = 'seront';

        const partFemPlur = part.replace(/(?:ées|ée|és|é|es|e)$/i, '') + 'ées';
        return (det || '') + nom + ' ' + aux + ' ' + partFemPlur;
      });

      // Masculin pluriel (ex: « vérins ont été remplacés »)
      const patOntEteMasc = new RegExp('\\b((?:les|des|ces|tous les|\\d+)\\s+)?([a-zA-ZÀ-ÿ]+s)\\s+(?:ont\\s+été|ont\\s+ete|sont|étaient|etaient|seront)\\s+([a-zA-ZÀ-ÿ]+)(?![a-zA-ZÀ-ÿ])', 'gi');
      res = res.replace(patOntEteMasc, function (m, det, nom, part) {
        if (FEM_PLUR_SET.has(nom.toLowerCase())) return m;
        let aux = 'ont été';
        if (/sont/i.test(m)) aux = 'sont';
        else if (/étaient|etaient/i.test(m)) aux = 'étaient';
        else if (/seront/i.test(m)) aux = 'seront';

        const partMascPlur = part.replace(/(?:és|é|es|e)$/i, '') + 'és';
        return (det || '') + nom + ' ' + aux + ' ' + partMascPlur;
      });

      // 6. Pluriels oubliés (le « s ») après déterminants et nombres
      const DETS = '(?:les|des|ces|mes|ses|nos|vos|leurs|plusieurs|quelques|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|[2-9]|\\d{2,})';
      const ADJS_ANTEPOSES = new Set(['nouveau', 'nouveaux', 'nouvel', 'petit', 'petits', 'grand', 'grands', 'autre', 'autres', 'premier', 'premiers', 'dernier', 'derniers', 'ancien', 'anciens', 'beau', 'beaux', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix']);
      const patPlur = new RegExp('\\b(' + DETS + ')\\s+([a-zA-ZÀ-ÿ]+)(?:\\s+([a-zA-ZÀ-ÿ]+))?(?![a-zA-ZÀ-ÿ])', 'gi');

      res = res.replace(patPlur, function (m, det, w1, w2) {
        if (w2 && ADJS_ANTEPOSES.has(w1.toLowerCase())) {
          return det + ' ' + pluraliserMot(w1) + ' ' + pluraliserMot(w2);
        }
        return det + ' ' + pluraliserMot(w1) + (w2 ? ' ' + w2 : '');
      });

      // Accord des adjectifs techniques suivant un nom au pluriel (ex: « vérins pneumatiques »)
      for (const [adj, adjPlur] of Object.entries(ADJECTIFS_PLURIELS)) {
        const adjPat = new RegExp('\\b([a-zA-ZÀ-ÿ]+s)\\s+' + adj + '\\b', 'gi');
        res = res.replace(adjPat, function (m, nomPlur) {
          return nomPlur + ' ' + adjPlur;
        });
      }

      // 7. Typographie : ponctuation et majuscules
      if (estPhrase) {
        res = res.replace(/(\.|\?|\!)\s*([a-zà-ÿ])/g, function (m, punc, lettre) {
          return punc + ' ' + lettre.toUpperCase();
        });
        if (res && res[0] === res[0].toLowerCase() && res[0] !== res[0].toUpperCase()) {
          res = res.charAt(0).toUpperCase() + res.slice(1);
        }
        if (res && !res.endsWith('.') && !res.endsWith('!') && !res.endsWith('?') && !res.endsWith(';') && !res.endsWith(':')) {
          res += '.';
        }
      }

      // 8. Restauration des balises sanctuarisées
      tags.forEach(function (val, idx) {
        const reg = new RegExp('\\s*__BFR_PROT_' + idx + '__\\s*', 'g');
        res = res.replace(reg, val);
      });

      return res.replace(/\s{2,}/g, ' ').trim();
    },

    /* -----------------------------------------------------------------------
       Correction globale d'un rapport d'intervention
       -----------------------------------------------------------------------
       Applique la correction à tous les champs de texte libre du rapport
       avant génération des documents officiels et avant traduction. */
    corrigerRapport: function (rapport) {
      if (!rapport || typeof rapport !== 'object') return rapport;

      // Liste des entités à sanctuariser (ne jamais modifier)
      const entites = [];
      if (rapport.client) {
        if (rapport.client.nom) entites.push(rapport.client.nom);
        if (rapport.client.contact) entites.push(rapport.client.contact);
        if (rapport.client.lieu) entites.push(rapport.client.lieu);
      }
      if (rapport.machine) {
        if (rapport.machine.designation) entites.push(rapport.machine.designation);
        if (rapport.machine.modele) entites.push(rapport.machine.modele);
        if (rapport.machine.serie) entites.push(rapport.machine.serie);
      }
      (rapport.machines || []).forEach(function (m) {
        if (m.designation) entites.push(m.designation);
        if (m.modele) entites.push(m.modele);
        if (m.serie) entites.push(m.serie);
      });
      if (rapport.technicien) {
        if (rapport.technicien.prenom) entites.push(rapport.technicien.prenom);
        if (rapport.technicien.nom) entites.push(rapport.technicien.nom);
      }
      (rapport.techniciens || []).forEach(function (t) {
        if (t.prenom) entites.push(t.prenom);
        if (t.nom) entites.push(t.nom);
      });

      // Champs principaux du rapport
      const corriger = (txt, opts) => this.corrigerTexte(txt, entites, opts);

      if (rapport.objet) rapport.objet = corriger(rapport.objet);
      if (rapport.actions) rapport.actions = corriger(rapport.actions);
      if (rapport.aPrevoir) rapport.aPrevoir = corriger(rapport.aPrevoir);
      if (rapport.resumeTechnicien) rapport.resumeTechnicien = corriger(rapport.resumeTechnicien);
      if (rapport.travauxTermines) rapport.travauxTermines = corriger(rapport.travauxTermines);

      // Évènements et légendes de photos
      (rapport.evenements || []).forEach(function (ev) {
        if (ev.texte) ev.texte = corriger(ev.texte);
        (ev.photos || []).forEach(function (ph) {
          if (ph.legende) ph.legende = corriger(ph.legende);
        });
      });

      // Photos libres
      (rapport.photosLibres || []).forEach(function (ph) {
        if (ph.legende) ph.legende = corriger(ph.legende);
      });

      // Dénominations des pièces de rechange (labels sans forcer de point final)
      (rapport.pieces || []).forEach(function (p) {
        if (p.denomination) p.denomination = corriger(p.denomination, { estPhrase: false });
      });

      // Multi-jours
      (rapport.jours || []).forEach(function (j) {
        if (j.description) j.description = corriger(j.description);
        else if (j.activite) j.activite = corriger(j.activite);
      });

      return rapport;
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CorrecteurFR;
  }
  global.CorrecteurFR = CorrecteurFR;
})(typeof window !== 'undefined' ? window : global);
