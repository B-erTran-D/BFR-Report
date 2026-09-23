/* =========================================================================
   glossaire-bfr.js — Dictionnaire technique métier BFR Systems
   -------------------------------------------------------------------------
   Garantit la rigueur terminologique industrielle lors des traductions
   (ensacheuses, fardeleuses, operculeuses, convoyeurs, groupes hydrauliques).
   Évite les contre-sens des traducteurs généralistes (ex: vérin traduit par
   cric, réducteur traduit par réduction).
   ========================================================================= */
(function (global) {
  'use strict';

  /* Termes techniques industriels clés : expressions exactes */
  const TERMES = [
    {
      fr: 'courroie trapézoïdale',
      en: 'V-belt',
      nl: 'V-snaar',
      de: 'Keilriemen',
      es: 'correa trapezoidal',
      it: 'cinghia trapezoidale',
      pt: 'correia trapezoidal'
    },
    {
      fr: 'courroie crantée',
      en: 'timing belt',
      nl: 'tandriem',
      de: 'Zahnriemen',
      es: 'correa dentada',
      it: 'cinghia dentata',
      pt: 'correia dentada'
    },
    {
      fr: 'roulement à billes',
      en: 'ball bearing',
      nl: 'kogellager',
      de: 'Kugellager',
      es: 'rodamiento de bolas',
      it: 'cuscinetto a sfere',
      pt: 'rolamento de esferas'
    },
    {
      fr: 'roulement',
      en: 'bearing',
      nl: 'lager',
      de: 'Lager',
      es: 'rodamiento',
      it: 'cuscinetto',
      pt: 'rolamento'
    },
    {
      fr: 'jeu axial',
      en: 'axial play',
      nl: 'axiale speling',
      de: 'Axialspiel',
      es: 'juego axial',
      it: 'gioco assiale',
      pt: 'folga axial'
    },
    {
      fr: 'jeu radial',
      en: 'radial play',
      nl: 'radiale speling',
      de: 'Radialspiel',
      es: 'juego radial',
      it: 'gioco radiale',
      pt: 'folga radial'
    },
    {
      fr: 'joint d\'étanchéité',
      en: 'seal',
      nl: 'afdichting',
      de: 'Dichtung',
      es: 'junta de estanqueidad',
      it: 'guarnizione di tenuta',
      pt: 'vedação'
    },
    {
      fr: 'vérin pneumatique',
      en: 'pneumatic cylinder',
      nl: 'pneumatische cilinder',
      de: 'Pneumatikzylinder',
      es: 'cilindro neumático',
      it: 'cilindro pneumatico',
      pt: 'cilindro pneumático'
    },
    {
      fr: 'vérin hydraulique',
      en: 'hydraulic cylinder',
      nl: 'hydraulische cilinder',
      de: 'Hydraulikzylinder',
      es: 'cilindro hidráulico',
      it: 'cilindro idraulico',
      pt: 'cilindro hidráulico'
    },
    {
      fr: 'vérin',
      en: 'cylinder',
      nl: 'cilinder',
      de: 'Zylinder',
      es: 'cilindro',
      it: 'cilindro',
      pt: 'cilindro'
    },
    {
      fr: 'réducteur',
      en: 'gearbox',
      nl: 'tandwielkast',
      de: 'Getriebe',
      es: 'reductor',
      it: 'riduttore',
      pt: 'redutor'
    },
    {
      fr: 'motoréducteur',
      en: 'gearmotor',
      nl: 'motorreductor',
      de: 'Getriebemotor',
      es: 'motorreductor',
      it: 'motoriduttore',
      pt: 'motorredutor'
    },
    {
      fr: 'cellule photoélectrique',
      en: 'photoelectric sensor',
      nl: 'fotocel',
      de: 'Lichtschranke',
      es: 'fotocélula',
      it: 'fotocellula',
      pt: 'fotocélula'
    },
    {
      fr: 'cellule reflex',
      en: 'retro-reflective sensor',
      nl: 'retro-reflectieve fotocel',
      de: 'Reflexionslichtschranke',
      es: 'fotocélula réflex',
      it: 'fotocellula reflex',
      pt: 'fotocélula reflex'
    },
    {
      fr: 'cellule',
      en: 'optical sensor',
      nl: 'fotocel',
      de: 'Sensor',
      es: 'fotocélula',
      it: 'fotocellula',
      pt: 'fotocélula'
    },
    {
      fr: 'capteur inductif',
      en: 'inductive sensor',
      nl: 'inductieve sensor',
      de: 'Induktivsensor',
      es: 'sensor inductivo',
      it: 'sensore induttivo',
      pt: 'sensor indutivo'
    },
    {
      fr: 'fin de course',
      en: 'limit switch',
      nl: 'eindschakelaar',
      de: 'Endschalter',
      es: 'final de carrera',
      it: 'finecorsa',
      pt: 'fim de curso'
    },
    {
      fr: 'convoyeur',
      en: 'conveyor',
      nl: 'transportband',
      de: 'Förderer',
      es: 'transportador',
      it: 'trasportatore',
      pt: 'transportador'
    },
    {
      fr: 'bande transporteuse',
      en: 'conveyor belt',
      nl: 'transportband',
      de: 'Fördergurt',
      es: 'banda transportadora',
      it: 'nastro trasportatore',
      pt: 'esteira transportadora'
    },
    {
      fr: 'ensacheuse',
      en: 'bagging machine',
      nl: 'zakkenvulmachine',
      de: 'Schlauchbeutelmaschine',
      es: 'ensacadora',
      it: 'insacchettatrice',
      pt: 'ensacadeira'
    },
    {
      fr: 'fardeleuse',
      en: 'shrink bundler',
      nl: 'krimpfoliemachine',
      de: 'Bündelpackmaschine',
      es: 'fajadora',
      it: 'fardellatrice',
      pt: 'embaladora'
    },
    {
      fr: 'operculeuse',
      en: 'tray sealer',
      nl: 'traysealer',
      de: 'Schalensiegelmaschine',
      es: 'termoselladora',
      it: 'termosigillatrice',
      pt: 'seladora de bandejas'
    },
    {
      fr: 'armoire électrique',
      en: 'electrical cabinet',
      nl: 'schakelkast',
      de: 'Schaltschrank',
      es: 'armario eléctrico',
      it: 'quadro elettrico',
      pt: 'armário elétrico'
    },
    {
      fr: 'arrêt d\'urgence',
      en: 'emergency stop',
      nl: 'noodstop',
      de: 'Not-Halt',
      es: 'parada de emergencia',
      it: 'arresto di emergenza',
      pt: 'parada de emergência'
    },
    {
      fr: 'groupe hydraulique',
      en: 'hydraulic power unit',
      nl: 'hydraulisch aggregaat',
      de: 'Hydraulikaggregat',
      es: 'grupo hidráulico',
      it: 'centralina idraulica',
      pt: 'unidade hidráulica'
    },
    {
      fr: 'bac de rétention',
      en: 'retention bund',
      nl: 'opvangbak',
      de: 'Auffangwanne',
      es: 'cubeto de retención',
      it: 'vasca di contenimento',
      pt: 'bacia de contenção'
    },
    {
      fr: 'fuite d\'huile',
      en: 'oil leak',
      nl: 'olielekkage',
      de: 'Ölleckage',
      es: 'fuga de aceite',
      it: 'perdita d\'olio',
      pt: 'vazamento de óleo'
    },
    {
      fr: 'variateur de fréquence',
      en: 'frequency inverter',
      nl: 'frequentieregelaar',
      de: 'Frequenzumrichter',
      es: 'variador de frecuencia',
      it: 'inverter di frequenza',
      pt: 'inversor de frequência'
    },
    {
      fr: 'pignon',
      en: 'sprocket',
      nl: 'kettingwiel',
      de: 'Kettenrad',
      es: 'piñón',
      it: 'pignone',
      pt: 'pinhão'
    },
    {
      fr: 'chaîne de transmission',
      en: 'drive chain',
      nl: 'aandrijfketting',
      de: 'Antriebskette',
      es: 'cadena de transmisión',
      it: 'catena di trasmissione',
      pt: 'corrente de transmissão'
    }
  ];

  const GlossaireBFR = {
    termes: TERMES,

    /* -----------------------------------------------------------------------
       1. Sanctuarisation des données protégées (Noms propres, machines, réf)
       -----------------------------------------------------------------------
       Remplace les identifiants techniques et noms propres par des balises
       __BFR_TAG_X__ pour qu'aucun traducteur ne tente de les déformer. */
    proteger: function (texte, entites) {
      if (!texte || typeof texte !== 'string') return { texte: texte || '', tags: [] };
      const tags = [];
      let res = texte;

      // Liste des entités à protéger en priorité
      const cibles = (entites || []).filter(function (e) {
        return e && typeof e === 'string' && e.trim().length >= 2;
      }).sort(function (a, b) { return b.length - a.length; });

      cibles.forEach(function (nom) {
        const motif = new RegExp('\\b' + nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
        res = res.replace(motif, function (m) {
          const id = tags.length;
          tags.push(m);
          return ' __BFR_' + id + '__ ';
        });
      });

      // Protection des références de pièces type PH1204D, 6205-2RS, ISO-VG-46
      res = res.replace(/\b([A-Z0-9]{2,}[-_][A-Z0-9-_]+)\b/g, function (m) {
        const id = tags.length;
        tags.push(m);
        return ' __BFR_' + id + '__ ';
      });

      return { texte: res, tags: tags };
    },

    /* -----------------------------------------------------------------------
       2. Restauration des balises protégées
       ----------------------------------------------------------------------- */
    restaurer: function (texte, tags) {
      if (!texte) return '';
      let res = texte;
      (tags || []).forEach(function (val, idx) {
        const reg = new RegExp('\\s*__BFR_' + idx + '__\\s*', 'g');
        res = res.replace(reg, val);
      });
      return res.replace(/\s{2,}/g, ' ').trim();
    },

    /* -----------------------------------------------------------------------
       3. Post-traitement terminologique par langue cible
       -----------------------------------------------------------------------
       Ajuste les termes approximatifs produits par le traducteur automatique
       pour calquer le vocabulaire industriel exact. */
    affiner: function (texte, codeLangue) {
      if (!texte || !codeLangue || codeLangue === 'fr') return texte;
      const lang = codeLangue.toLowerCase();
      let res = texte;

      // Parcours des termes pour ajuster les faux-amis connus
      TERMES.forEach(function (t) {
        const cible = t[lang];
        if (!cible) return;
        // Si le terme anglais intermédiaire a été mal rendu, on ajuste
        if (lang === 'nl') {
          // Ex: "jack" ou "krik" traduit en "cilinder"
          res = res.replace(/\b(krik|hefboom)\b/gi, 'cilinder');
          res = res.replace(/\b(verloopstuk)\b/gi, 'tandwielkast');
        } else if (lang === 'de') {
          res = res.replace(/\b(Wagenheber)\b/gi, 'Zylinder');
          res = res.replace(/\b(Reduzierstück)\b/gi, 'Getriebe');
        }
      });

      return res;
    }
  };

  global.GlossaireBFR = GlossaireBFR;
})(typeof window !== 'undefined' ? window : global);
