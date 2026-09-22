/* =========================================================================
   clients.js — Liste clients BFR et recherche pendant la saisie
   -------------------------------------------------------------------------
   - La liste de référence est embarquée dans l'application (clients-data.js,
     généré depuis le classeur « COORDONNÉES CLIENTS » par outils/extraire_clients.py).
     Elle est donc disponible HORS CONNEXION.
   - Le technicien tape 3 ou 4 lettres : l'application propose les
     correspondances (nom + ville + contact).
   - Tout ce qui est saisi et qui manque au classeur (téléphone du client,
     e-mail, logo, contact, corrections) est mémorisé dans le téléphone et
     reproposé aux interventions suivantes.
   ========================================================================= */
(function (global) {
  'use strict';

  const CLE_MEMO = 'sav3.clients';

  function norm(txt) {
    return String(txt == null ? '' : txt)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // accents
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '');                        // espaces, _, ., -, etc.
  }
  function joli(txt) {
    return String(txt == null ? '' : txt).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const CLIENTS_EMBARQUES = Array.isArray(global.CLIENTS_BFR) ? global.CLIENTS_BFR.slice() : [];

  const Clients = {
    /* ---------- Lecture ---------------------------------------------------- */
    base: function () {
      return Array.isArray(global.CLIENTS_BFR) ? global.CLIENTS_BFR : [];
    },
    embarques: function () { return CLIENTS_EMBARQUES; },
    utiliseListeImportee: function () { return this.base() !== CLIENTS_EMBARQUES; },
    memo: function () {
      try { return JSON.parse(global.localStorage.getItem(CLE_MEMO) || '{}') || {}; } catch (e) { return {}; }
    },
    /* Liste de référence + tout ce que les techniciens ont saisi en plus.
       Les données locales complètent la liste (et non l'inverse). */
    liste: function () {
      const memo = this.memo();
      const vus = {};
      const out = [];
      this.base().forEach(c => {
        const cle = norm(c.nom);
        const dejaVu = vus[cle] || 0;
        vus[cle] = dejaVu + 1;
        out.push(Object.assign({}, c, memo[cle] || {}));
      });
      /* Clients saisis sur le terrain et absents du classeur : on les garde. */
      Object.keys(memo).forEach(k => {
        const m = memo[k];
        if (!m || !m.nom || vus[k]) return;
        if (Clients.base().some(c => norm(c.nom) === k)) return;
        vus[k] = 1;
        out.push(Object.assign({ contact: '', fonction: '', tel: '', adresse: '', ville: '', logo: '' }, m));
      });
      return out;
    },
    /* ---------- Recherche « 3 ou 4 lettres » ------------------------------- */
    /* Classement : d'abord les noms qui COMMENCENT par la saisie, puis ceux
       qui la contiennent ; à égalité, le nom le plus court est proposé avant.
       Si la saisie contient un espace (« Cremo Si »), on cherche aussi sur les
       mots suivants. */
    chercher: function (saisie, limite) {
      const q = norm(saisie);
      limite = limite || 8;
      if (q.length < 3) return [];                  // les propositions commencent à 3 lettres
      const large = q.length >= 4;                  // avant 4 lettres : seulement le début du nom
      const trouves = [];
      this.liste().forEach(c => {
        const n = norm(c.nom);
        const motsNom = String(c.nom || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean).map(norm);
        let score = -1;
        if (n.indexOf(q) === 0) score = 0;                                  // commence par
        else if (motsNom.some(m => m.indexOf(q) === 0)) score = 1;          // un mot commence par
        else if (large && n.indexOf(q) > 0) score = 2;                      // contient le nom
        else if (large && norm(c.ville).indexOf(q) === 0) score = 3;        // ville
        else if (large && norm(c.contact).indexOf(q) === 0) score = 4;      // contact
        if (score >= 0) trouves.push({ score: score, c: c });
      });
      trouves.sort((a, b) => a.score - b.score || norm(a.c.nom).length - norm(b.c.nom).length ||
                             String(a.c.nom).localeCompare(String(b.c.nom), 'fr'));
      return trouves.slice(0, limite).map(x => x.c);
    },
    /* Recherche exacte par nom (pour retrouver les données mémorisées). */
    parNom: function (nom) {
      const n = norm(nom);
      if (!n) return null;
      const candidats = this.liste().filter(c => norm(c.nom) === n || norm(c.reference) === n);
      if (!candidats.length) return this.memo()[n] || null;
      return candidats[0];
    },
    /* ---------- Mémorisation ---------------------------------------------- */
    /* Ce que le technicien a saisi et qui n'est pas au classeur (tél., e-mail,
       logo, contact…) est conservé dans le téléphone pour la prochaine fois. */
    retenir: function (client) {
      if (!client || !client.nom) return;
      const memo = this.memo();
      const cle = norm(client.nom);
      const avant = memo[cle] || {};
      const apres = {
        nom: joli(client.nom), ville: client.lieu || client.ville || avant.ville || '',
        adresse: client.adresse || avant.adresse || '', contact: client.contact || avant.contact || '',
        fonction: client.fonction || avant.fonction || '', tel: client.tel || avant.tel || '',
        email: client.email || avant.email || '', logo: client.logo || avant.logo || '',
        numeroClient: client.numeroClient || avant.numeroClient || '',
        /* Langue retenue pour ce client : le rapport bilingue est reproposé
           à l'intervention suivante (le technicien garde la main). */
        langue: client.langue || avant.langue || '',
        maj: new Date().toISOString()
      };
      memo[cle] = apres;
      try {
        global.localStorage.setItem(CLE_MEMO, JSON.stringify(memo));
        return true;
      } catch (e) { return false; }
    },
    oublier: function (nom) {
      const memo = this.memo();
      delete memo[norm(nom)];
      try { global.localStorage.setItem(CLE_MEMO, JSON.stringify(memo)); } catch (e) {}
    },
    /* ---------- Remplacement complet de la liste (import CSV/JSON) --------- */
    /* Le technicien peut charger la dernière version du classeur sans
       reconstruire l'application : le contenu est conservé dans le téléphone. */
    importer: function (texte, surMesure, aUnProbleme) {
      const lignes = this.analyser(texte);
      if (!lignes.length) { if (aUnProbleme) aUnProbleme(); return 0; }
      try {
        global.localStorage.setItem('sav3.clientsListe', JSON.stringify(lignes));
        global.CLIENTS_BFR = lignes;              // prise en compte immédiate
      } catch (e) { return 0; }
      if (surMesure) surMesure(lignes.length);
      return lignes.length;
    },
    listeImportee: function () {
      try { return JSON.parse(global.localStorage.getItem('sav3.clientsListe') || 'null'); } catch (e) { return null; }
    },
    /* Analyse d'un CSV (export du classeur) ou d'un tableau JSON. */
    analyser: function (texte) {
      texte = String(texte || '').trim();
      if (!texte) return [];
      if (texte[0] === '[' || texte[0] === '{') {
        try {
          const d = JSON.parse(texte);
          const arr = Array.isArray(d) ? d : (d.clients || []);
          return arr.map(c => ({
            nom: joli(c.nom || c.Client || ''), reference: c.reference || '',
            adresse: String(c.adresse || '').trim(), ville: c.ville || '',
            contact: c.contact || '', fonction: c.fonction || '', tel: c.tel || '',
            email: c.email || '', logo: c.logo || '', autresContacts: c.autresContacts || '',
            /* Téléphone du client ({numero_client}) : il est saisi sur le terrain,
               il doit donc survivre à un export puis import sur un autre téléphone. */
            numeroClient: c.numeroClient || ''
          })).filter(c => c.nom);
        } catch (e) { return []; }
      }
      const lignes = this.decouperCSV(texte);
      const out = [];
      lignes.forEach(cols => {
        const nom = joli((cols[0] || '').trim());
        const adresse = (cols[1] || '').replace(/\r/g, '').trim();
        const contactBrut = (cols[2] || '').trim();
        const logo = (cols[3] || '').trim();
        if (!nom || /^client$/i.test(nom) || /^coordonn/i.test(nom) || /^technicien/i.test(nom)) return;
        if (!adresse && !contactBrut && !logo) return;
        const pc = this.decouperContact(contactBrut);
        out.push({
          nom: nom, reference: (cols[0] || '').trim(), adresse: adresse,
          ville: this.ville(adresse), contact: pc.contact, fonction: pc.fonction,
          tel: pc.tel, autresContacts: pc.autres, logo: logo
        });
      });
      return out;
    },
    decouperCSV: function (texte) {
      const lignes = [];
      let champ = '', ligne = [], dansGuillemets = false, i = 0;
      while (i < texte.length) {
        const c = texte[i];
        if (dansGuillemets) {
          if (c === '"' && texte[i + 1] === '"') { champ += '"'; i += 2; continue; }
          if (c === '"') { dansGuillemets = false; i++; continue; }
          champ += c; i++; continue;
        }
        if (c === '"') { dansGuillemets = true; i++; continue; }
        if (c === ',' || c === ';' || c === '\t') { ligne.push(champ); champ = ''; i++; continue; }
        if (c === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; i++; continue; }
        champ += c; i++;
      }
      if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
      return lignes;
    },
    ville: function (adresse) {
      const l = String(adresse || '').split('\n').map(x => x.trim()).filter(Boolean);
      if (!l.length) return '';
      const d = l[l.length - 1].replace(/^(?:\d{4,6}|[A-Z]\d[A-Z]\s?\d[A-Z]\d)\s*/i, '').trim();
      return d || l[l.length - 1];
    },
    /* Découpage du champ « Contact » du classeur : nom seul d'un côté,
       fonction et téléphone de l'autre (mêmes règles que le script Python). */
    decouperContact: function (brut) {
      brut = String(brut || '').replace(/\r/g, '');
      if (!brut.trim()) return { contact: '', fonction: '', tel: '', autres: '' };
      const t = brut.match(/(?:\+\d{1,3}[\s.\-/]*)?(?:\(?\d[\d\s.\-/]{7,}\d\)?)/g) || [];
      const tels = t.map(x => x.trim().replace(/\s+/g, ' ')).filter(x => (x.match(/\d/g) || []).length >= 9);
      const reste = brut.replace(/(?:\+\d{1,3}[\s.\-/]*)?(?:\(?\d[\d\s.\-/]{7,}\d\)?)/g, ' ')
        .replace(/[ \t]{2,}/g, ' ').replace(/\n/g, ' | ').replace(/([A-Za-zÀ-ÿ])-\s+/g, '$1 - ');
      const morceaux = reste.split(/\s+[-–—]\s+|\s*\|\s*|\s*:\s*|\s+\/\s+/).map(x => x.replace(/^[\s\-–:;,]+|[\s\-–:;,]+$/g, '')).filter(Boolean);
      let contact = morceaux[0] || '';
      let queue = morceaux.slice(1).join(' ');
      let autres = '';
      const m = queue.match(/\s+(?:ou|et)\s+(?=(?:M\.|Mr|Mme|Mlle)\b)/i);
      if (m) { autres = queue.slice(m.index + m[0].length).trim(); queue = queue.slice(0, m.index).trim(); }
      let fonction = queue.replace(/[\s.]+$/, '').replace(/(?:\s*\d[\d,.\-/\s]*)+$/, '').trim();
      const MOTS = ['respons', 'mainten', 'technic', 'chef', 'directeur', 'dirigeant', 'gérant', 'service',
        'magasin', 'approvision', 'adjoint', 'condition', 'production', 'qualit', 'achat', 'secteur',
        'atelier', 'usine', 'exploit', 'travaux', 'groupe', 'bureau', 'conducteur'];
      const estNom = /^(M\.|Mr|Mme|Mlle)\b/i.test(fonction) ||
        (fonction && !MOTS.some(x => fonction.toLowerCase().indexOf(x) >= 0) &&
         fonction.split(/\s+/).length <= 4 && fonction.split(/\s+/).filter(w => /^[A-ZÀ-Ý]/.test(w)).length >= 2);
      if (estNom) { autres = (fonction + (autres ? ' / ' + autres : '')).trim(); fonction = ''; }
      const mobile = tels.find(x => /^(06|07|\+?33\s?[67])/.test(x.replace(/\D/g, '').replace(/^33/, '0')));
      const tel = mobile || tels[0] || '';
      const restants = tels.filter(x => x !== tel);
      autres = [autres, restants.join(' / ')].filter(Boolean).join(' / ');
      return { contact: contact, fonction: fonction, tel: tel, autres: autres };
    }
  };

  /* Liste importée par le technicien : elle remplace la liste embarquée. */
  const listeImportee = Clients.listeImportee && (function () {
    try { return JSON.parse(global.localStorage.getItem('sav3.clientsListe') || 'null'); } catch (e) { return null; }
  })();
  if (Array.isArray(listeImportee) && listeImportee.length) {
    global.CLIENTS_BFR = listeImportee;
  }

  Clients.revenirListeOrigine = function () {
    try { global.localStorage.removeItem('sav3.clientsListe'); } catch (e) {}
    global.CLIENTS_BFR = CLIENTS_EMBARQUES;
  };
  const listeSauvee = (function () {
    try { return JSON.parse(global.localStorage.getItem('sav3.clientsListe') || 'null'); } catch (e) { return null; }
  })();
  if (Array.isArray(listeSauvee) && listeSauvee.length) global.CLIENTS_BFR = listeSauvee;

  global.Clients = Clients;
})(window);
