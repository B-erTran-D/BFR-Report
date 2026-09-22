/* =========================================================================
   report.js — Génération du rapport selon un canevas (PDF + Word)
   Le canevas décrit l'ordre et le contenu des sections. Par défaut :
     1. Synthèse          4. Priorité basse
     2. Sécurité & urgences 5. Informations
     3. Priorité haute    6. Travaux réalisés / à prévoir
                          7. Photos complémentaires  8. Validation client
   Dépend de : pdf.js (window.Pdf) et docx.js (window.Docx)
   ========================================================================= */
(function (global) {
  'use strict';

  const M = { margin: 34 };

  /* Couleurs du modèle « Compte rendu d'intervention » BFR :
     cyan #06BAF2 (titre et bandeaux), texte gris anthracite #58595B. */
  const CYAN = [6 / 255, 186 / 255, 242 / 255];
  const COULEURS_PDF = {
    cyan: CYAN, cyanClair: [0.906, 0.969, 0.988],
    bleu: CYAN, bleuClair: [0.906, 0.969, 0.988],
    bandeau: [0.96, 0.98, 1], bord: [0.84, 0.87, 0.91], bordFort: [0.55, 0.6, 0.66],
    texte: [0.345, 0.349, 0.365], gris: [0.5, 0.5, 0.5], blanc: [1, 1, 1]
  };

  /* Adresses du pied de page du modèle. */
  const SIEGES_BFR = [
    'Siège social et site de production n°1 – 1, rue du Jariel, ZAC Les Longs Sillons, 77120 Coulommiers, France',
    'Site de production n°2 – 50 allée des érables, 01150 Blyes, France'
  ];

  /* ===================== Outils ======================================= */
  function hexRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return [0.2, 0.25, 0.33];
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function hexDocx(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    return m ? m[1].toUpperCase() : '334155';
  }
  function hexClair(hex, melange) {
    const [r, g, b] = hexRgb(hex);
    const k = melange == null ? 0.86 : melange;
    return [r + (1 - r) * k, g + (1 - g) * k, b + (1 - b) * k];
  }
  function slug(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34) || 'client';
  }
  function pad2(n) { return ('0' + (n || 0)).slice(-2); }
  function frDate(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso);
  }
  function heureFr(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function valeur(v) { return (v === undefined || v === null || String(v).trim() === '') ? '' : String(v); }

  /* Identité du technicien : « Prénom NOM » à partir des champs des réglages.
     Si le technicien n'a rempli qu'un seul champ (ancienne saisie « nom et prénom »),
     on l'affiche tel quel plutôt que de le déformer. */
  function nomComplet(t) {
    t = t || {};
    const prenom = valeur(t.prenom).trim(), nom = valeur(t.nom).trim();
    if (prenom && nom) return prenom + ' ' + nom.toUpperCase();
    return (prenom || nom).trim();
  }
  /* Coordonnées du technicien, prêtes à être imprimées : « 06 12 34 56 78 · j@ex.fr » */
  function contactTech(t) {
    t = t || {};
    return [valeur(t.tel).trim(), valeur(t.email).trim()].filter(Boolean).join(' · ');
  }
  /* Nom du technicien tel qu'il doit apparaître dans un rapport : le nom saisi dans
     l'intervention, sinon celui mémorisé dans les réglages (identité du collègue). */
  function nomTechnicien(i, s) {
    return valeur(i && i.technicien).trim() || nomComplet(s && s.technicien);
  }

  function listeMachines(i) {
    if (i && Array.isArray(i.machines) && i.machines.length > 0) {
      const valides = i.machines.filter(m => m && (valeur(m.designation) || valeur(m.modele) || valeur(m.serie)));
      if (valides.length > 0) return valides;
    }
    if (i && i.machine && (valeur(i.machine.designation) || valeur(i.machine.modele) || valeur(i.machine.serie))) {
      return [i.machine];
    }
    return [];
  }

  function listeTechniciens(i, s) {
    if (i && Array.isArray(i.techniciens) && i.techniciens.length > 0) {
      const valides = i.techniciens.filter(t => t && valeur(t.nom));
      if (valides.length > 0) return valides;
    }
    const nom = nomTechnicien(i, s);
    const fonction = (s && s.technicien && s.technicien.fonction) || 'Technicien SAV';
    return [{ nom: nom, fonction: fonction, principal: true }];
  }

  /** Durée cumulée du chrono (pauses déduites), en millisecondes. */
  function dureeMs(chrono, maintenant) {
    if (!chrono || !chrono.debut) return 0;
    const ref = maintenant || Date.now();
    const fin = chrono.fin ? new Date(chrono.fin).getTime() : ref;
    let total = Math.max(0, fin - new Date(chrono.debut).getTime());
    (chrono.pauses || []).forEach(function (p) {
      const debutP = new Date(p.d).getTime();
      const finP = p.f ? new Date(p.f).getTime() : ref;
      total -= Math.max(0, Math.min(finP, ref) - debutP);
    });
    return Math.max(0, total);
  }

  function dureeTotale(i, maintenant) {
    if (!i) return 0;
    if (i.multiJours && Array.isArray(i.jours) && i.jours.length > 0) {
      let totalMs = 0;
      i.jours.forEach(function (j) {
        if (typeof j.dureeMs === 'number') {
          totalMs += j.dureeMs;
        } else if (typeof j.dureeHeures === 'number') {
          totalMs += Math.round(j.dureeHeures * 3600000);
        } else if (typeof j.duree === 'number') {
          totalMs += Math.round(j.duree * 3600000);
        } else if (j.debut && j.fin) {
          const p1 = j.debut.split(':').map(Number);
          const p2 = j.fin.split(':').map(Number);
          const min = (p2[0] * 60 + p2[1]) - (p1[0] * 60 + p1[1]) - (Number(j.pauseMinutes) || 0);
          if (min > 0) totalMs += min * 60000;
        }
      });
      return totalMs;
    }
    return dureeMs(i.chrono, maintenant);
  }

  function formatDuree(ms) {
    const min = Math.round(ms / 60000);
    if (!min) return '';
    const h = Math.floor(min / 60), m = min % 60;
    return (h ? h + ' h ' + ('0' + m).slice(-2) : m + ' min');
  }
  function dureeDecimale(ms) { return (Math.round(ms / 36000) / 100).toFixed(2).replace('.', ','); }

  function toJpeg(dataUrl, maxW, q) {
    return new Promise(function (resolve) {
      if (!dataUrl) return resolve(null);
      const img = new Image();
      img.onload = function () {
        const scale = Math.min(1, (maxW || 1200) / img.width);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve({ dataUrl: c.toDataURL('image/jpeg', q || 0.85), w: c.width, h: c.height });
      };
      img.onerror = function () { resolve(null); };
      img.src = dataUrl;
    });
  }

  /* ===================== Canevas par défaut =========================== */
  function canevasDefaut() {
    return {
      nom: 'Canevas standard',
      sections: [
        { id: 'synthese', type: 'synthese', titre: '1. Synthèse de l\'intervention' },
        { id: 'secu', type: 'evenements', titre: '2. Sécurité et urgences', categories: ['SECURITE', 'URGENT'] },
        { id: 'haute', type: 'evenements', titre: '3. Points de priorité haute', categories: ['HAUTE'] },
        { id: 'basse', type: 'evenements', titre: '4. Points de priorité basse', categories: ['BASSE'] },
        { id: 'info', type: 'evenements', titre: '5. Informations complémentaires', categories: ['INFO'] },
        { id: 'actions', type: 'texte', titre: '6. Travaux réalisés', champ: 'actions' },
        { id: 'prevoir', type: 'texte', titre: '7. Travaux à prévoir', champ: 'aPrevoir' },
        { id: 'pieces', type: 'pieces', titre: '8. Pièces de rechange' },
        { id: 'photos', type: 'photos', titre: '9. Photos complémentaires' },
        { id: 'signature', type: 'signature', titre: '10. Validation' }
      ]
    };
  }

  /* ===================== Données dérivées ============================= */
  function catalogue(reglages) {
    const S = reglages || {};
    const domaines = {};
    (S.domaines || []).forEach(d => { domaines[d.id] = d; });
    const categories = {};
    (S.categories || []).forEach(c => { categories[c.id] = c; });
    return { domaines: domaines, categories: categories };
  }

  function etat(intervention, reglages) {
    const { domaines, categories } = catalogue(reglages);
    const evs = (intervention.evenements || []).filter(e => e.domaine || valeur(e.texte));
    const parCategorie = {}, parDomaine = {};
    (reglages.categories || []).forEach(c => { parCategorie[c.id] = 0; });
    (reglages.domaines || []).forEach(d => { parDomaine[d.id] = 0; });
    evs.forEach(function (e) {
      parCategorie[e.categorie || 'INFO'] = (parCategorie[e.categorie || 'INFO'] || 0) + 1;
      parDomaine[e.domaine] = (parDomaine[e.domaine] || 0) + 1;
    });
    const duree = dureeTotale(intervention);
    const nbPhotos = evs.reduce(function (a, e) { return a + (e.photos || []).length; }, 0) +
      (intervention.photosLibres || []).length;
    return {
      domaines: domaines, categories: categories, evenements: evs, parCategorie: parCategorie,
      parDomaine: parDomaine, duree: duree, nbPhotos: nbPhotos,
      securite: (parCategorie.SECURITE || 0) + (parCategorie.URGENT || 0)
    };
  }

  function evenementsDe(intervention, section) {
    const cats = section.categories || [];
    return (intervention.evenements || [])
      .filter(e => (e.domaine || valeur(e.texte)) && cats.indexOf(e.categorie || 'INFO') >= 0)
      .sort((a, b) => new Date(a.heure || 0) - new Date(b.heure || 0));
  }

  /* ======================================================================
     PDF
     ====================================================================== */
  class RapportPDF {
    constructor(intervention, reglages, opts) {
      this.i = intervention;
      this.s = reglages || {};
      this.opts = opts || {};
      /* Langue du rapport : 'fr' (défaut) ou le code de la langue du client.
         Les libellés du modèle sont traduits par langues.js, à l'écriture. */
      this.langue = this.opts.langue || (intervention.langue && intervention.langue.code) || 'fr';
      this.canevas = (this.s.canevas && this.s.canevas.sections) ? this.s.canevas.sections : canevasDefaut().sections;
      this.etat = etat(intervention, reglages);
      /* Aperçu à l'écran : même mise en page, dessinée sur des canvas
         (aucune visionneuse PDF n'est nécessaire dans le navigateur). */
      this.pdf = this.opts.apercu
        ? new Pdf.Apercu({ margin: M.margin, langue: this.langue })
        : new Pdf.Doc({ margin: M.margin, langue: this.langue });
      this.M = this.pdf.margin;
      this.W = this.pdf.W;
      this.H = this.pdf.H;
      this.CW = this.pdf.contentWidth;
      this.C = COULEURS_PDF;
      this.numeroPhoto = 0;
    }

    /* Traduction d'un libellé du catalogue (domaines, catégories) : ce sont
       des libellés, pas des données du terrain. */
    L(txt) {
      return (global.I18N ? global.I18N.traduire(txt, this.langue) : txt);
    }

    /* --- structure de page (modèle « Compte rendu d'intervention ») --- */

    /* Logo de la société, en haut de page, comme dans l'en-tête du modèle. */
    logoEnTete(largeurCm) {
      const p = this.pdf;
      if (!this.logo) return 0;
      const w = (largeurCm || 10.2) * 28.35;                 // cm -> points
      const h = w * (this.logo.h / this.logo.w);
      p.image(this.logo.bytes, this.M, p.y, w, h);
      p.y += h + 14;
      return h;
    }

    /* Première page : logo, bloc client, titre, bloc « Votre contact ». */
    entetePrincipale() {
      const p = this.pdf, i = this.i, s = this.s;

      if (this.logo) {
        const w = 10.2 * 28.35;
        const h = w * (this.logo.h / this.logo.w);
        p.image(this.logo.bytes, this.M, p.y, w, h);
        p.y += h + 22;
      }

      /* Bloc client : nom, e-mail, téléphone (colonne gauche) et logo (droite),
         exactement les variables {Client_Name} {Mail_Client} {numero_client} {Logo_Client}. */
      const cli = i.client || {};
      const logoCli = this.logoClient;
      const haut = p.y;
      const largLogo = logoCli ? Math.min(150, 90 * (logoCli.w / logoCli.h)) : 0;
      const largGauche = this.CW - (largLogo ? largLogo + 16 : 0);
      let y = haut;
      if (valeur(cli.nom)) { p.text(Pdf.trunc(cli.nom, largGauche, 12, true), this.M, y + 10, { size: 12, font: 'F2', color: this.C.texte }); y += 17; }
      if (valeur(cli.email)) { p.text(Pdf.trunc(cli.email, largGauche, 10), this.M, y + 9, { size: 10, color: this.C.texte }); y += 14; }
      if (valeur(cli.tel)) { p.text(Pdf.trunc('Tél. ' + cli.tel, largGauche, 12), this.M, y + 11, { size: 12, color: this.C.texte }); y += 16; }
      if (logoCli) {
        const h = largLogo * (logoCli.h / logoCli.w);
        p.image(logoCli.bytes, this.W - this.M - largLogo, haut, largLogo, Math.min(h, 62));
        y = Math.max(y, haut + Math.min(h, 62));
      }
      p.y = y + 26;

      /* Titre du modèle : « Compte rendu d'intervention » puis la date, centrés
         en cyan BFR, comme le style « Titre » du Google Doc (36 pt). */
      const titre = "Compte rendu d'intervention";
      let taille = 30;
      while (taille > 16 && Pdf.measure(titre, taille, true) > this.CW) taille -= 1;
      p.text(titre, this.W / 2, p.y + taille, { size: taille, font: 'F2', color: CYAN, align: 'center' });
      p.y += taille + 8;
      p.text(frDate(i.date), this.W / 2, p.y + taille * 0.72, { size: taille * 0.72, font: 'F2', color: CYAN, align: 'center' });
      p.y += taille * 0.72 + 40;

      /* « Votre contact : » puis le bloc technicien
         ({Name_Technicien} {Poste_Tech} {Mail_Tech} {Num_Tech}). */
      const t = s.technicien || {};
      p.text('Votre contact :', this.M, p.y + 10, { size: 10, color: this.C.texte });
      p.y += 20;
      const yBloc = p.y;
      p.text(nomComplet(t) || '—', this.M, yBloc + 11, { size: 11.5, font: 'F2', color: this.C.texte });
      let yt = yBloc + 25;
      const self = this;
      [t.fonction, t.email, t.tel ? 'Tél. ' + t.tel : ''].filter(Boolean).forEach(function (l) {
        p.text(Pdf.trunc(String(l), self.CW, 10), self.M, yt, { size: 10, color: self.C.texte });
        yt += 14;
      });
      const colleguesP1 = (Array.isArray(i.techniciens) && i.techniciens.length > 1)
        ? i.techniciens.filter(x => x && !x.principal && valeur(x.nom))
        : [];
      if (colleguesP1.length > 0) {
        yt += 6;
        p.text(Pdf.trunc(this.L('Accompagné de') + ' : ' + colleguesP1.map(c => c.nom + (c.fonction ? ' (' + self.L(c.fonction) + ')' : '')).join(', '), self.CW, 9.5),
          self.M, yt, { size: 9.5, font: 'F2', color: self.C.texte });
        yt += 14;
      }
      p.y = yt + 20;
    }

    /* Pages suivantes : logo réduit et rappel du rapport. */
    enteteSuite() {
      const p = this.pdf, C = this.C;
      if (this.logo) {
        const w = 5.4 * 28.35;
        const h = w * (this.logo.h / this.logo.w);
        p.image(this.logo.bytes, this.M, p.y, w, h);
        p.text(Pdf.trunc('N° ' + valeur(this.i.numero) + ' — ' + valeur(this.i.client && this.i.client.nom), this.CW * 0.65, 9),
          this.W - this.M, p.y + h - 3, { size: 9, color: C.gris, align: 'right' });
        p.y += h + 8;
      } else {
        p.text(Pdf.trunc(valeur(this.s.societe.nom), this.CW / 3, 9.5, true), this.M, 26, { size: 9.5, font: 'F2', color: C.cyan });
        p.text(Pdf.trunc('N° ' + valeur(this.i.numero) + ' — ' + valeur(this.i.client && this.i.client.nom), this.CW * 0.62, 9),
          this.W - this.M, 26, { size: 9, color: C.gris, align: 'right' });
        p.y = 34;
      }
      p.line(this.M, p.y, this.W - this.M, p.y, { color: C.bord });
      p.y += 16;
    }

    /* Page 2 du modèle : destinataire, adresse, lieu et date, attention. */
    pageLettre() {
      const p = this.pdf, C = this.C, i = this.i, s = this.s, cli = i.client || {};
      const larg = this.CW * 0.62;
      p.text(Pdf.trunc(valeur(cli.nom), larg, 11.5, true), this.M, p.y + 11, { size: 11.5, font: 'F2', color: C.texte });
      p.y += 22;
      Pdf.wrap(valeur(cli.adresse) || valeur(cli.lieu), larg, 10).forEach(function (l) {
        p.text(l, this.M, p.y + 10, { size: 10, color: C.texte });
        p.y += 14;
      }, this);
      p.y += 18;
      p.text('À ' + valeur((s.societe && s.societe.lieuLettre) || 'Blyes') + ', le ' + frDate(i.date) + ',',
        this.M, p.y + 10, { size: 10, color: C.texte });
      p.y += 22;
      p.text("À l'attention de " + valeur(cli.contact) + ',', this.M, p.y + 10, { size: 10, color: C.texte });
      p.y += 26;
    }

    /* ---------- bandeaux, blocs et tableaux ---------- */

    saut(hauteur) {
      const p = this.pdf;
      if (p.y + (hauteur || 0) > p.H - this.M - 30) { p.newPage(); this.enteteSuite(); return true; }
      return false;
    }

    /* Bandeau de section du modèle : fond cyan, texte blanc (petites capitales). */
    titre(txt, sousTitre, reserver) {
      this.saut(40 + (reserver || 0));
      const p = this.pdf, y = p.y, C = this.C;
      let taille = 11.5;
      const large = this.CW - 14 - (sousTitre ? Pdf.measure(sousTitre, 8, false) + 12 : 0);
      while (taille > 7.5 && Pdf.measure(txt, taille, true) > large) taille -= 0.5;
      p.rect(this.M, y, this.CW, 18.5, { fill: CYAN });
      p.text(txt.toUpperCase(), this.M + 7, y + 12.5, { size: taille, font: 'F2', color: C.blanc });
      if (sousTitre) p.text(sousTitre, this.W - this.M - 7, y + 12.5, { size: 8, color: C.blanc, align: 'right' });
      p.y = y + 24;
    }

    kv(pairs) {
      /* Les lignes sans étiquette (compteur, n° de parc…) ne sont pas imprimées. */
      pairs = (pairs || []).filter(function (it) { return it[0] && valeur(it[1]); });
      const p = this.pdf, C = this.C, gap = 10, colW = (this.CW - gap) / 2;
      let k = 0;
      while (k < pairs.length) {
        const ligne = [];
        while (k < pairs.length && ligne.length < 2) {
          if (pairs[k][2] && ligne.length === 1) break;
          ligne.push(pairs[k]); k++;
        }
        const largeurs = ligne.length === 2 ? [colW, colW] : [ligne[0][2] ? this.CW : colW];
        let h = 0;
        ligne.forEach(function (it, idx) {
          h = Math.max(h, 11 + Pdf.wrap(valeur(it[1]) || '—', largeurs[idx] - 14, 8.6).length * 11);
        });
        this.saut(h + 2);
        const y = p.y;
        let x = this.M;
        for (let idx = 0; idx < ligne.length; idx++) {
          p.rect(x, y, largeurs[idx], h, { fill: C.bandeau, stroke: C.bord, lineWidth: 0.5 });
          p.text(ligne[idx][0], x + 7, y + 11, { size: 6.6, font: 'F2', color: C.gris });
          p.paragraph(valeur(ligne[idx][1]) || '—', x + 7, y + 12, largeurs[idx] - 14, { size: 8.6, color: C.texte });
          x += largeurs[idx] + gap;
        }
        p.y = y + h + 1;
      }
      p.y += 6;
    }

    blocTexte(titre, contenu) {
      const p = this.pdf, C = this.C;
      const texte = valeur(contenu);
      const lh = 11.4;
      const lignes = Pdf.wrap(texte || '—', this.CW - 14, 8.8);
      let idx = 0;
      while (idx < lignes.length) {
        const place = Math.floor((p.H - this.M - 16 - p.y - (idx === 0 && titre ? 16 : 4)) / lh);
        if (place < 3) { p.newPage(); this.enteteSuite(); continue; }
        const n = Math.min(place, lignes.length - idx);
        if (idx === 0 && titre) {
          p.text(titre, this.M + 6, p.y + 9, { size: 8.4, font: 'F2', color: C.gris });
          p.y += 13;
        }
        p.rect(this.M, p.y, this.CW, n * lh + 7, { stroke: C.bord, lineWidth: 0.6 });
        for (let j = 0; j < n; j++) p.text(lignes[idx + j], this.M + 7, p.y + 9 + j * lh, { size: 8.8, color: C.texte });
        p.y += n * lh + 9;
        idx += n;
      }
      p.y += 4;
    }

    /** Photos côte à côte, légende optionnelle. Numérotation continue dans le rapport. */
    async photos(liste, avecNumero) {
      const p = this.pdf, C = this.C;
      const gap = 8;
      const colW = (this.CW - gap) / 2;
      let i = 0;
      for (const item of liste) {
        if (i % 2 === 0) this.lotEnCours = [];
        this.lotEnCours.push(item);
        if (this.lotEnCours.length === 2 || i === liste.length - 1) {
          const lot = this.lotEnCours;
          const dims = lot.map(function (it) {
            const b = Pdf.dataUrlToBytes(it.dataUrl);
            return Pdf.jpegDims(b);
          });
          const hauteurs = dims.map(function (d) { return Math.min(colW * 1.2, colW * (d.h / d.w)); });
          const hMax = Math.max.apply(null, hauteurs.concat([60]));
          const legende = avecNumero || lot.some(it => valeur(it.legende));
          this.saut(hMax + (legende ? 12 : 0) + 10);
          const y = p.y;
          const self = this;
          lot.forEach(function (it, k) {
            const hauteur = hauteurs[k];
            const x = M.margin + k * (colW + gap);
            p.rect(x, y, colW, hauteur, { stroke: C.bord, lineWidth: 0.5 });
            p.image(Pdf.dataUrlToBytes(it.dataUrl), x + 1, y + 1, colW - 2, hauteur - 2);
            if (legende) {
              const texte = avecNumero ? 'Photo ' + (++self.numeroPhoto) + (it.legende ? ' — ' + it.legende : '') : (it.legende || '');
              p.text(Pdf.trunc(texte, colW, 7.2), x, y + hauteur + 9, { size: 7.2, color: C.gris });
            }
          });
          p.y = y + hMax + (legende ? 12 : 0) + 10;
        }
        i++;
      }
    }

    /** Un évènement : bandeau coloré (catégorie + domaine + heure), texte, photos. */
    async blocEvenement(ev, index) {
      const { domaines, categories } = this.etat;
      const cat = categories[ev.categorie || 'INFO'] || { libelle: 'Informatif', couleur: '#475569' };
      const dom = domaines[ev.domaine] || { libelle: '—', icone: '' };
      const p = this.pdf, C = this.C;
      const couleur = hexRgb(cat.couleur);
      const fond = hexClair(cat.couleur, 0.9);
      const texte = valeur(ev.texte) || '(aucune annotation)';
      const lh = 11.2;
      const lignes = Pdf.wrap(texte, this.CW - 16, 8.8);
      // on réserve la place du texte + de la première photo pour ne pas les séparer
      const photosEv = (ev.photos || []).filter(ph => ph.dataUrl);
      const placeTexte = Math.min(lignes.length, 6) * lh + 24;
      const placePhoto = photosEv.length ? (this.CW - 8) / 2 * 0.9 + 30 : 0;
      this.saut(placeTexte + Math.min(placePhoto, 240));
      let idx = 0;
      let premier = true;
      while (idx < lignes.length) {
        const place = Math.floor((p.H - this.M - 16 - p.y - 26) / lh);
        if (place < 2) { p.newPage(); this.enteteSuite(); continue; }
        const n = Math.min(place, lignes.length - idx);
        const y0 = p.y;
        if (premier) {
          this.saut(26 + 2 * lh);
          p.rect(this.M, p.y, this.CW, 15, { fill: fond, stroke: couleur, lineWidth: 0.5 });
          p.rect(this.M, p.y, 3, 15, { fill: couleur });
          const libDom = this.L(dom.libelle);
          const libMach = ev.machineNom ? ' — ⚙️ ' + ev.machineNom : '';
          p.text((dom.icone ? dom.icone + ' ' + libDom : libDom) + libMach, this.M + 8, p.y + 10.4, { size: 8.4, font: 'F2', color: couleur });
          p.text(this.L(cat.libelle).toUpperCase(), this.M + this.CW - 8, p.y + 10.4, { size: 8, font: 'F2', color: couleur, align: 'right' });
          p.text(heureFr(ev.heure), this.M + this.CW / 2, p.y + 10.4, { size: 7.6, color: C.gris, align: 'center' });
          p.y += 15;
        }
        p.rect(this.M, p.y, this.CW, n * lh + 6, { stroke: C.bord, lineWidth: 0.5 });
        for (let j = 0; j < n; j++) p.text(lignes[idx + j], this.M + 8, p.y + 9 + j * lh, { size: 8.8, color: C.texte });
        p.y += n * lh + 8;
        idx += n;
        premier = false;
        if (y0 === p.y) break;
      }
      if (photosEv.length) {
        await this.photos(photosEv.map(ph => ({ dataUrl: ph.dataUrl, legende: ph.legende || '' })), true);
      }
      p.y += 2;
    }

    async blocSynthese() {
      const p = this.pdf, C = this.C, i = this.i, e = this.etat;
      // bandeau de compteurs par catégorie
      const cats = (this.s.categories || []).filter(c => e.parCategorie[c.id]);
      if (cats.length) {
        const nb = cats.length;
        const caseW = (this.CW - (nb - 1) * 5) / nb;
        this.saut(30);
        const y = p.y;
        cats.forEach(function (c, k) {
          const x = this.M + k * (caseW + 5);
          p.rect(x, y, caseW, 30, { fill: hexClair(c.couleur, 0.88), stroke: hexRgb(c.couleur), lineWidth: 0.5 });
          p.text(String(e.parCategorie[c.id]), x + caseW / 2, y + 15, { size: 15, font: 'F2', color: hexRgb(c.couleur), align: 'center' });
          p.text(Pdf.trunc(this.L(c.libelle), caseW - 6, 6.6), x + caseW / 2, y + 25, { size: 6.6, color: C.gris, align: 'center' });
        }, this);
        p.y = y + 38;
      }
      // répartition par domaine + chrono
      const domaines = (this.s.domaines || []).filter(d => e.parDomaine[d.id]);
      const lignes = [];
      domaines.forEach(function (d) {
        lignes.push([d.libelle, String(e.parDomaine[d.id]) + ' évènement(s)']);
      });
      lignes.push(['Heures passées sur site', formatDuree(e.duree) ? formatDuree(e.duree) + ' (' + dureeDecimale(e.duree) + ' h)' : '—']);
      lignes.push(['Photos jointes', String(e.nbPhotos)]);
      lignes.push(['Points de sécurité / urgence', String(e.securite)]);
      this.kv(lignes.map(function (l) { return [l[0], l[1], true]; }));

      if (valeur(i.resumeTechnicien)) this.blocTexte('Synthèse du technicien', i.resumeTechnicien);
      if (valeur(i.objet)) this.blocTexte('Objet / demande du client', i.objet);
    }

    async blocPieces(pcs) {
      const p = this.pdf, C = this.C;
      if (!pcs || !pcs.length) return;
      const colDenomW = this.CW * 0.54;
      const colRefW = this.CW * 0.30;
      const colQteW = this.CW * 0.16;
      const hLigne = 18;
      const hEntete = 18;

      this.saut(hEntete + hLigne * Math.min(pcs.length, 3) + 24);
      let y = p.y;

      // En-tête du tableau
      p.rect(this.M, y, this.CW, hEntete, { fill: C.bleuClair, stroke: C.bordFort, lineWidth: 0.6 });
      p.text(this.L('Dénomination'), this.M + 6, y + 12, { size: 8.5, font: 'F2', color: C.bleu });
      p.text(this.L('Référence'), this.M + colDenomW + 6, y + 12, { size: 8.5, font: 'F2', color: C.bleu });
      p.text(this.L('Quantité'), this.M + colDenomW + colRefW + colQteW / 2, y + 12, { size: 8.5, font: 'F2', color: C.bleu, align: 'center' });

      p.line(this.M + colDenomW, y, this.M + colDenomW, y + hEntete, { color: C.bordFort, width: 0.6 });
      p.line(this.M + colDenomW + colRefW, y, this.M + colDenomW + colRefW, y + hEntete, { color: C.bordFort, width: 0.6 });

      y += hEntete;

      for (let idx = 0; idx < pcs.length; idx++) {
        const item = pcs[idx];
        if (y + hLigne > p.H - this.M - 35) {
          p.newPage();
          this.enteteSuite();
          y = p.y + 4;
          p.rect(this.M, y, this.CW, hEntete, { fill: C.bleuClair, stroke: C.bordFort, lineWidth: 0.6 });
          p.text(this.L('Dénomination'), this.M + 6, y + 12, { size: 8.5, font: 'F2', color: C.bleu });
          p.text(this.L('Référence'), this.M + colDenomW + 6, y + 12, { size: 8.5, font: 'F2', color: C.bleu });
          p.text(this.L('Quantité'), this.M + colDenomW + colRefW + colQteW / 2, y + 12, { size: 8.5, font: 'F2', color: C.bleu, align: 'center' });
          p.line(this.M + colDenomW, y, this.M + colDenomW, y + hEntete, { color: C.bordFort, width: 0.6 });
          p.line(this.M + colDenomW + colRefW, y, this.M + colDenomW + colRefW, y + hEntete, { color: C.bordFort, width: 0.6 });
          y += hEntete;
        }

        const fond = (idx % 2 === 1) ? [0.97, 0.98, 0.99] : [1, 1, 1];
        p.rect(this.M, y, this.CW, hLigne, { fill: fond, stroke: C.bord, lineWidth: 0.4 });

        const denom = valeur(item.denomination || item.designation) || '—';
        const ref = valeur(item.reference) || '—';
        const qte = String(valeur(item.quantite) || 1);

        p.text(Pdf.trunc(denom, colDenomW - 12, 8.5, false), this.M + 6, y + 12, { size: 8.5, color: C.texte });
        p.text(Pdf.trunc(ref, colRefW - 12, 8.5, false), this.M + colDenomW + 6, y + 12, { size: 8.5, font: 'F2', color: C.texte });
        p.text(qte, this.M + colDenomW + colRefW + colQteW / 2, y + 12, { size: 8.5, font: 'F2', color: C.texte, align: 'center' });

        p.line(this.M + colDenomW, y, this.M + colDenomW, y + hLigne, { color: C.bord, width: 0.4 });
        p.line(this.M + colDenomW + colRefW, y, this.M + colDenomW + colRefW, y + hLigne, { color: C.bord, width: 0.4 });

        y += hLigne;
      }

      p.y = y + 4;
      const mentionPcs = this.L('La signature du client vaut pour acceptation du devis final et validation des pièces de rechange ci-dessus.');
      p.paragraph(mentionPcs, this.M + 4, p.y, this.CW - 8, { size: 7.4, font: 'F1', color: C.gris });
      p.y += 12;
    }

    async blocJours(jours) {
      const p = this.pdf, C = this.C;
      if (!jours || !jours.length) return;
      const colDateW = this.CW * 0.18;
      const colHorairesW = this.CW * 0.22;
      const colPauseW = this.CW * 0.14;
      const colDureeW = this.CW * 0.18;
      const colDescW = this.CW * 0.28;
      const hLigne = 18;
      const hEntete = 18;

      this.saut(hEntete + hLigne * Math.min(jours.length + 1, 3) + 20);
      let y = p.y;

      const dessinerEntete = () => {
        p.rect(this.M, y, this.CW, hEntete, { fill: C.bleuClair, stroke: C.bordFort, lineWidth: 0.6 });
        p.text(this.L('Date'), this.M + 6, y + 12, { size: 8.5, font: 'F2', color: C.bleu });
        p.text(this.L('Horaires sur site'), this.M + colDateW + 6, y + 12, { size: 8.5, font: 'F2', color: C.bleu });
        p.text(this.L('Pause'), this.M + colDateW + colHorairesW + colPauseW / 2, y + 12, { size: 8.5, font: 'F2', color: C.bleu, align: 'center' });
        p.text(this.L('Durée sur site'), this.M + colDateW + colHorairesW + colPauseW + colDureeW / 2, y + 12, { size: 8.5, font: 'F2', color: C.bleu, align: 'center' });
        p.text(this.L('Activité / Travaux'), this.M + colDateW + colHorairesW + colPauseW + colDureeW + 6, y + 12, { size: 8.5, font: 'F2', color: C.bleu });

        let cx = this.M + colDateW;
        p.line(cx, y, cx, y + hEntete, { color: C.bordFort, width: 0.6 });
        cx += colHorairesW;
        p.line(cx, y, cx, y + hEntete, { color: C.bordFort, width: 0.6 });
        cx += colPauseW;
        p.line(cx, y, cx, y + hEntete, { color: C.bordFort, width: 0.6 });
        cx += colDureeW;
        p.line(cx, y, cx, y + hEntete, { color: C.bordFort, width: 0.6 });
        y += hEntete;
      };

      dessinerEntete();

      let totalH = 0;
      for (let idx = 0; idx < jours.length; idx++) {
        const item = jours[idx];
        if (y + hLigne > p.H - this.M - 35) {
          p.newPage();
          this.enteteSuite();
          y = p.y + 4;
          dessinerEntete();
        }

        const fond = (idx % 2 === 1) ? [0.97, 0.98, 0.99] : [1, 1, 1];
        p.rect(this.M, y, this.CW, hLigne, { fill: fond, stroke: C.bord, lineWidth: 0.4 });

        const dt = frDate(item.date) || '—';
        const hor = (item.debut && item.fin) ? (item.debut + ' - ' + item.fin) : (item.debut || item.fin || '—');
        const pauseTxt = item.pauseMinutes ? (item.pauseMinutes + ' min') : '—';
        const dh = typeof item.dureeHeures === 'number' ? item.dureeHeures : (typeof item.duree === 'number' ? item.duree : 0);
        totalH += dh;
        const durTxt = dh > 0 ? (Math.floor(dh) + ' h ' + pad2(Math.round((dh % 1) * 60)) + ' (' + dh.toFixed(2).replace('.', ',') + ' h)') : '—';
        const desc = valeur(item.description || item.activite) || '—';

        p.text(Pdf.trunc(dt, colDateW - 8, 8.2, false), this.M + 6, y + 12, { size: 8.2, color: C.texte });
        p.text(Pdf.trunc(hor, colHorairesW - 8, 8.2, false), this.M + colDateW + 6, y + 12, { size: 8.2, color: C.texte });
        p.text(pauseTxt, this.M + colDateW + colHorairesW + colPauseW / 2, y + 12, { size: 8.2, color: C.texte, align: 'center' });
        p.text(durTxt, this.M + colDateW + colHorairesW + colPauseW + colDureeW / 2, y + 12, { size: 8.2, font: 'F2', color: C.texte, align: 'center' });
        p.text(Pdf.trunc(desc, colDescW - 8, 8.2, false), this.M + colDateW + colHorairesW + colPauseW + colDureeW + 6, y + 12, { size: 8.2, color: C.texte });

        let cx = this.M + colDateW;
        p.line(cx, y, cx, y + hLigne, { color: C.bord, width: 0.4 });
        cx += colHorairesW;
        p.line(cx, y, cx, y + hLigne, { color: C.bord, width: 0.4 });
        cx += colPauseW;
        p.line(cx, y, cx, y + hLigne, { color: C.bord, width: 0.4 });
        cx += colDureeW;
        p.line(cx, y, cx, y + hLigne, { color: C.bord, width: 0.4 });

        y += hLigne;
      }

      // Ligne total cumulé
      p.rect(this.M, y, this.CW, hLigne, { fill: C.bleuClair, stroke: C.bordFort, lineWidth: 0.6 });
      p.text(this.L('Total cumulé'), this.M + 6, y + 12, { size: 8.5, font: 'F2', color: C.bleu });
      const totTxt = totalH > 0 ? (Math.floor(totalH) + ' h ' + pad2(Math.round((totalH % 1) * 60)) + ' (' + totalH.toFixed(2).replace('.', ',') + ' h)') : '—';
      p.text(totTxt, this.M + colDateW + colHorairesW + colPauseW + colDureeW / 2, y + 12, { size: 8.5, font: 'F2', color: C.bleu, align: 'center' });
      y += hLigne + 8;
      p.y = y;
    }

    async blocSignatures(titre) {
      const p = this.pdf, C = this.C, i = this.i, s = this.s;
      const sigClient = await toJpeg((i.signatureClient || {}).dataUrl, 900, 0.9);
      const sigTech = await toJpeg(s.technicien && s.technicien.signature, 900, 0.9);
      const pcs = (i.pieces || []).filter(p => (p.denomination || p.designation || p.reference || p.quantite));
      let mention = valeur((s.impression && s.impression.mentionClient)) ||
        "Le client reconnaît avoir pris connaissance du présent rapport, avoir reçu les explications du technicien et accepte les constats et travaux décrits.";
      if (pcs.length > 0) {
        mention += " La signature du client vaut pour acceptation du devis final et validation des pièces de rechange ci-dessus.";
      }
      const mentionTraduite = this.L(mention);
      const hT = Pdf.wrap(mentionTraduite, this.CW - 14, 8).length * 10.6 + 9;
      const hBloc = 118;
      this.saut(hT + hBloc + 26);
      const y0 = p.y;
      p.rect(this.M, y0, this.CW, hT, { fill: [1, 0.976, 0.929], stroke: [0.99, 0.9, 0.6], lineWidth: 0.5 });
      p.paragraph(mentionTraduite, this.M + 7, y0 + 2, this.CW - 14, { size: 8, color: [0.42, 0.29, 0.05] });
      const y = y0 + hT + 10;
      const colW = (this.CW - 10) / 2;
      [0, 1].forEach(function (k) {
        const x = this.M + k * (colW + 10);
        p.rect(x, y, colW, hBloc, { stroke: C.bordFort, lineWidth: 0.8 });
        p.rect(x + 0.5, y + 0.5, colW - 1, 15, { fill: C.bleuClair });
        p.text(k === 0 ? 'Le client (bon pour accord)' : 'Le technicien', x + 6, y + 10.5, { size: 8.4, font: 'F2', color: C.bleu });
        p.line(x, y + 15.5, x + colW, y + 15.5, { color: C.bordFort, width: 0.8 });
        const c = k === 0 ? (i.signatureClient || {}) : { nom: nomTechnicien(i, s), fonction: s.technicien && s.technicien.fonction, contact: contactTech(s.technicien), date: i.date, heure: heureFr(i.chrono && i.chrono.fin) };
        p.text(valeur(c.nom) || '—', x + 6, y + 29, { size: 9.4, font: 'F2', color: C.texte });
        /* Une seule ligne « fonction — téléphone · e-mail » pour ne pas empiéter sur
           la place réservée à la signature (la boîte fait 118 pt de haut). */
        const mention2 = [valeur(c.fonction), valeur(c.contact)].filter(Boolean).join(' — ');
        if (mention2) p.text(mention2, x + 6, y + 40, { size: 7.6, color: C.gris });
        p.text('Date : ' + frDate(c.date || i.date) + (c.heure ? ' à ' + c.heure : ''), x + 6, y + 51, { size: 7.6, color: C.gris });
        const sig = k === 0 ? sigClient : sigTech;
        if (sig) {
          const maxW = colW - 20, maxH = hBloc - 62;
          let w = maxW, h = w * (sig.h / sig.w);
          if (h > maxH) { h = maxH; w = h * (sig.w / sig.h); }
          p.image(Pdf.dataUrlToBytes(sig.dataUrl), x + (colW - w) / 2, y + 58, w, h);
        } else {
          p.text('Signature non recueillie', x + colW / 2, y + 74, { size: 8, color: C.gris, align: 'center' });
        }
      }, this);

      const collegues = (Array.isArray(i.techniciens) && i.techniciens.length > 1)
        ? i.techniciens.filter(t => t && !t.principal && valeur(t.nom))
        : [];
      if (collegues.length > 0) {
        const txtCol = this.L('Accompagné de') + ' : ' + collegues.map(c => c.nom + (c.fonction ? ' (' + this.L(c.fonction) + ')' : '')).join(', ');
        p.text(Pdf.trunc(txtCol, this.CW - 14, 7.8, false), this.M + 4, y + hBloc + 7, { size: 7.8, color: C.gris });
        p.y = y + hBloc + 18;
      } else {
        p.y = y + hBloc + 10;
      }
    }

    /* --- génération --- */
    async generer() {
      const p = this.pdf, i = this.i, s = this.s;
      const now = new Date();
      this.dateEdition = 'Édité le ' + now.toLocaleDateString('fr-FR') + ' à ' +
        now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

      /* Logo de la société (celui du modèle par défaut) et logo du client. */
      if (s.societe && s.societe.logo) {
        const jp = await toJpeg(s.societe.logo, 460, 0.92);
        if (jp) this.logo = { bytes: Pdf.dataUrlToBytes(jp.dataUrl), w: jp.w, h: jp.h };
      }
      if (i.client && i.client.logo) {
        const jc = await toJpeg(i.client.logo, 460, 0.92);
        if (jc) this.logoClient = { bytes: Pdf.dataUrlToBytes(jc.dataUrl), w: jc.w, h: jc.h };
      }

      /* ---- Page 1 du modèle : logo, bloc client, titre, « Votre contact » ---- */
      this.entetePrincipale();

      /* ---- Page 2 du modèle : destinataire, date, « À l'attention de » ---- */
      p.newPage();
      this.pageLettre();

      /* ---- Corps du compte rendu (sections du canevas) ---- */
      this.titre('Intervention', valeur(i.numero) ? 'N° ' + valeur(i.numero) : null, 60);

      const machines = listeMachines(i);
      const techniciens = listeTechniciens(i, s);
      const kvLignes = [];

      if (machines.length <= 1) {
        const m = machines[0] || i.machine || {};
        kvLignes.push(['Machine / équipement', valeur(m.designation) || '—', true]);
        kvLignes.push(['Modèle', [valeur(m.marque), valeur(m.modele)].filter(Boolean).join(' ') || '—']);
        kvLignes.push(['N° de série', valeur(m.serie) || '—']);
      } else {
        machines.forEach((m, idx) => {
          const tit = (this.L('Machine') + ' ' + (idx + 1)) + (valeur(m.designation) ? ' : ' + valeur(m.designation) : '');
          const det = [
            valeur(m.modele) ? this.L('Modèle') + ' : ' + valeur(m.modele) : '',
            valeur(m.serie) ? this.L('N° de série') + ' : ' + valeur(m.serie) : ''
          ].filter(Boolean).join('  |  ');
          kvLignes.push([tit, det || '—', true]);
        });
      }

      /* Compteur et n° de parc ne sont plus demandés : affichés seulement
         s'ils ont été saisis (rapports importés ou anciens brouillons). */
      if (valeur(i.machine && (i.machine.compteur || i.machine.parc))) {
        kvLignes.push([valeur(i.machine.compteur) ? 'Compteur' : '', [valeur(i.machine.compteur), valeur(i.machine.parc)].filter(Boolean).join(' — ')]);
      }

      kvLignes.push(['Objet / demande', valeur(i.objet) || '—', true]);
      kvLignes.push(['Lieu', valeur(i.client && i.client.lieu) || '—']);
      kvLignes.push(['Contact sur site', [valeur(i.client && i.client.contact), valeur(i.client && i.client.fonction)].filter(Boolean).join(' — ') || '—']);
      kvLignes.push(['Téléphone / e-mail client', [valeur(i.client && i.client.tel), valeur(i.client && i.client.email)].filter(Boolean).join(' / ') || '—']);

      if (i.multiJours && Array.isArray(i.jours) && i.jours.length > 0) {
        const datesJ = i.jours.map(j => frDate(j.date)).filter(Boolean);
        const plageDate = (datesJ.length > 1) ? (datesJ[0] + ' au ' + datesJ[datesJ.length - 1]) : (datesJ[0] || frDate(i.date));
        kvLignes.push(['Date d\'intervention', plageDate]);
        kvLignes.push(['Horaires sur site', i.jours.length + ' ' + this.L(i.jours.length > 1 ? 'Journées d\'intervention' : 'Journée')]);
      } else {
        kvLignes.push(['Date d\'intervention', frDate(i.date)]);
        kvLignes.push(['Horaires sur site', [heureFr(i.chrono && i.chrono.debut) || '—', heureFr(i.chrono && i.chrono.fin) || 'en cours'].join(' - ')]);
      }

      kvLignes.push(['Durée sur site', formatDuree(this.etat.duree) ? formatDuree(this.etat.duree) + ' (' + dureeDecimale(this.etat.duree) + ' h)' : '—']);

      if (techniciens.length <= 1) {
        kvLignes.push(['Technicien', nomTechnicien(i, s) || '—']);
      } else {
        const txtTechs = techniciens.map(t => t.nom + (t.fonction ? ' (' + this.L(t.fonction) + ')' : '') + (t.principal ? ' [' + this.L('Technicien principal') + ']' : '')).join(' · ');
        kvLignes.push(['Technicien(s) sur site', txtTechs, true]);
      }

      this.kv(kvLignes);

      if (i.multiJours && Array.isArray(i.jours) && i.jours.length > 0) {
        this.titre('Relevé des journées d\'intervention', i.jours.length + ' ' + this.L(i.jours.length > 1 ? 'Journées d\'intervention' : 'Journée'), 90);
        await this.blocJours(i.jours);
      }

      let piecesRendues = false;
      // Sections du canevas
      for (const section of this.canevas) {
        if (section.type === 'synthese') {
          this.titre(section.titre || 'Synthèse');
          await this.blocSynthese();
        } else if (section.type === 'evenements') {
          const evs = evenementsDe(i, section);
          if (!evs.length) continue;
          this.titre(section.titre || 'Évènements', evs.length + ' évènement(s)', 150);
          let idx = 0;
          for (const ev of evs) { await this.blocEvenement(ev, ++idx); }
        } else if (section.type === 'texte') {
          const contenu = valeur(i[section.champ]);
          if (!contenu) continue;
          this.titre(section.titre || 'Texte');
          this.blocTexte(null, contenu);
        } else if (section.type === 'pieces') {
          piecesRendues = true;
          const pcs = (i.pieces || []).filter(p => (p.denomination || p.designation || p.reference || p.quantite));
          if (!pcs.length) continue;
          this.titre(section.titre || 'Pièces de rechange', pcs.length + ' pièce(s)', 120);
          await this.blocPieces(pcs);
        } else if (section.type === 'photos') {
          const libres = (i.photosLibres || []).filter(ph => ph.dataUrl);
          if (!libres.length) continue;
          this.titre(section.titre || 'Photos', libres.length + ' photo(s)', 220);
          await this.photos(libres.map(ph => ({ dataUrl: ph.dataUrl, legende: valeur(ph.legende) })), true);
        } else if (section.type === 'signature') {
          if (!piecesRendues) {
            const pcs = (i.pieces || []).filter(p => (p.denomination || p.designation || p.reference || p.quantite));
            if (pcs.length) {
              this.titre('Pièces de rechange', pcs.length + ' pièce(s)', 120);
              await this.blocPieces(pcs);
              piecesRendues = true;
            }
          }
          this.titre(section.titre || 'Validation', null, 170);
          await this.blocSignatures();
        }
      }

      // pied de page du modèle : société + adresses des deux sites + n° de page
      const self = this, doc = this.pdf;
      const sieges = [(s.societe && s.societe.nom) || 'BFR SYSTEMS']
        .concat(SIEGES_BFR.map(function (l) {
          if (s.societe && s.societe.siege1 && l.indexOf('n°1') > 0) return 'Siège social et site de production n°1 – ' + s.societe.siege1;
          if (s.societe && s.societe.siege2 && l.indexOf('n°2') > 0) return 'Site de production n°2 – ' + s.societe.siege2;
          return l;
        }));
      doc.addFooters(function (d, num, total) {
        const y = d.H - 20;
        d.line(d.margin, y - 26, d.W - d.margin, y - 26, { color: COULEURS_PDF.bord, width: 0.6 });
        const largeur = d.W - 2 * d.margin - 70;
        sieges.forEach(function (ligne, k) {
          d.text(Pdf.trunc(ligne, largeur, k === 0 ? 7.4 : 6.6, k === 0), d.margin, y - 16 + k * 8.6,
            { size: k === 0 ? 7.4 : 6.6, font: k === 0 ? 'F2' : 'F1', color: COULEURS_PDF.gris });
        });
        d.text('Page ' + num + ' / ' + total, d.W - d.margin, y - 8, { size: 7, font: 'F2', color: COULEURS_PDF.gris, align: 'right' });
      });

      if (this.opts.apercu) return { apercu: doc, filename: nomFichier(this.i, 'pdf', this.opts.suffixe ? this.langue : null) };
      return { blob: doc.blob(), filename: nomFichier(this.i, 'pdf', this.opts.suffixe ? this.langue : null) };
    }
  }

  /* Nom du fichier : « Rapport_20260921_260921-01_CLIENT.pdf ». Quand le
     rapport existe en deux langues, chacune porte son code (_FR / _NL…) pour
     que le client et le SAV s'y retrouvent dans la pièce jointe. */
  function nomFichier(i, ext, langue) {
    const d = (i.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    const machNom = (i.machine && i.machine.designation) || (i.machines && i.machines[0] && i.machines[0].designation) || '';
    const morceaux = ['Rapport', d, i.numero ? slug(i.numero) : '', slug(i.client && i.client.nom),
      slug(machNom)];
    if (langue) morceaux.push(String(langue).toUpperCase());
    return morceaux.filter(Boolean).join('_') + '.' + ext;
  }

  /* ======================================================================
     WORD (.docx)
     ====================================================================== */
  class RapportWord {
    constructor(intervention, reglages, opts) {
      this.i = intervention;
      this.s = reglages || {};
      this.opts = opts || {};
      this.langue = this.opts.langue || (intervention.langue && intervention.langue.code) || 'fr';
      this.canevas = (this.s.canevas && this.s.canevas.sections) ? this.s.canevas.sections : canevasDefaut().sections;
      this.etat = etat(intervention, reglages);
      this.doc = new Docx.Doc({
        langue: this.langue,
        auteur: (this.s.societe && this.s.societe.nom) || 'Application SAV',
        /* Pied de page du modèle : nom + adresses des deux sites, et numérotation. */
        pied: [(this.s.societe && this.s.societe.nom) || 'BFR SYSTEMS']
          .concat([valeur(this.s.societe && this.s.societe.siege1) || SIEGES_BFR[0],
                   valeur(this.s.societe && this.s.societe.siege2) || SIEGES_BFR[1]])
      });
      this.doc.titreDoc = (global.I18N ? global.I18N.traduire("Compte rendu d'intervention", this.langue) : "Compte rendu d'intervention") +
        (this.langue === 'fr' ? ' N° ' : ' No. ') + valeur(intervention.numero);
      this.numeroPhoto = 0;
    }

    /* Traduction d'un libellé du catalogue (domaines, catégories). */
    L(txt) {
      return (global.I18N ? global.I18N.traduire(txt, this.langue) : txt);
    }

    async generer() {
      const d = this.doc, i = this.i, s = this.s;

      /* Logo de la société en en-tête, répété sur chaque page (comme le modèle). */
      const logo = valeur(s.societe && s.societe.logo) || valeur(global.LOGO_BFR);
      if (logo) {
        const jp = await toJpeg(logo, 1200, 0.92);
        if (jp) d.logoEntete(jp.dataUrl);
      }

      /* Bloc client du modèle : {Client_Name} {Mail_Client} {numero_client} | {Logo_Client} */
      const cli = i.client || {};
      const logoCli = cli.logo ? await toJpeg(cli.logo, 460, 0.92) : null;
      const runsBlocClient = [
        { t: valeur(cli.nom), gras: true, taille: 12 },
        { t: valeur(cli.email), taille: 10, saut: true },
        { t: valeur(cli.tel) ? 'Tél. ' + cli.tel : '', taille: 12, saut: true }
      ].filter(function (r) { return r.t; });
      if (logoCli) {
        d.image(logoCli.dataUrl, 4.5, { hauteurMaxCm: 2.2 });
      }
      d.tableau([[{ texte: runsBlocClient }, { texte: '' },
                  { texte: '' }]], { largeurs: [70, 15, 15], sansBordures: true });

      /* Titre du modèle : cyan BFR, centré */
      d.grandTitre("Compte rendu d'intervention", 30);
      d.grandTitre(frDate(i.date), 22);
      d.para('', { taille: 6, apres: 200 });

      /* « Votre contact : » + bloc technicien */
      d.para(this.L('Votre contact :'), { taille: 10, couleur: '58595B', apres: 40 });
      d.para([{ t: Report.nomComplet(s.technicien) || '—', gras: true, taille: 11.5 }], { apres: 20 });
      [(s.technicien || {}).fonction, (s.technicien || {}).email, (s.technicien || {}).tel ? 'Tél. ' + s.technicien.tel : '']
        .filter(Boolean).forEach(function (l) { d.para(l, { taille: 10, couleur: '58595B', apres: 0 }); });

      const colleguesP1Word = (Array.isArray(i.techniciens) && i.techniciens.length > 1)
        ? i.techniciens.filter(x => x && !x.principal && valeur(x.nom))
        : [];
      if (colleguesP1Word.length > 0) {
        d.para([{ t: this.L('Accompagné de') + ' : ', gras: true }, { t: colleguesP1Word.map(c => c.nom + (c.fonction ? ' (' + this.L(c.fonction) + ')' : '')).join(', ') }],
          { taille: 9.5, couleur: '58595B', avant: 20, apres: 20 });
      }

      /* Page 2 du modèle : destinataire, lieu et date, « À l'attention de » */
      d.sautDePage();
      d.para([{ t: valeur(cli.nom), gras: true, taille: 11.5 }], { apres: 20 });
      String(valeur(cli.adresse) || valeur(cli.lieu)).split('\n').forEach(function (l) {
        d.para(l, { taille: 10, couleur: '58595B', apres: 0 });
      });
      d.para('', { taille: 6, apres: 140 });
      d.para('À ' + (valeur(s.societe && s.societe.lieuLettre) || 'Blyes') + ', le ' + frDate(i.date) + ',',
        { taille: 10, couleur: '58595B', apres: 60 });
      d.para("À l'attention de " + valeur(cli.contact) + ',', { taille: 10, couleur: '58595B', apres: 200 });

      const machinesWord = listeMachines(i);
      const techniciensWord = listeTechniciens(i, s);
      const machPrincipalWord = machinesWord[0] || i.machine || {};
      const machLabelWord = machinesWord.length > 1
        ? machinesWord.map(m => m.designation).filter(Boolean).join(' ; ')
        : (valeur(machPrincipalWord.designation) || '—');
      const modLabelWord = machinesWord.length > 1
        ? machinesWord.map(m => m.modele).filter(Boolean).join(' ; ')
        : ([valeur(machPrincipalWord.marque), valeur(machPrincipalWord.modele)].filter(Boolean).join(' ') || '—');
      const numSerieLabelWord = machinesWord.length > 1
        ? machinesWord.map(m => m.serie).filter(Boolean).join(' ; ')
        : (valeur(machPrincipalWord.serie) || '—');

      const techLabelWord = techniciensWord.length > 1
        ? techniciensWord.map(t => t.nom + (t.fonction ? ' (' + this.L(t.fonction) + ')' : '')).join(' · ')
        : (nomTechnicien(i, s) || '—');

      let horLabelWord = (heureFr(i.chrono && i.chrono.debut) || '—') + ' - ' + (heureFr(i.chrono && i.chrono.fin) || 'en cours');
      if (i.multiJours && Array.isArray(i.jours) && i.jours.length > 0) {
        horLabelWord = i.jours.length + ' ' + this.L(i.jours.length > 1 ? 'Journées d\'intervention' : 'Journée');
      }

      d.bandeau('Intervention');
      d.tableau([
        [{ texte: this.L('Client'), gras: true }, { texte: valeur(i.client && i.client.nom) || '—' },
         { texte: this.L('Machine'), gras: true }, { texte: machLabelWord }],
        [{ texte: this.L('Lieu'), gras: true }, { texte: valeur(i.client && i.client.lieu) || '—' },
         { texte: this.L('Modèle'), gras: true }, { texte: modLabelWord }],
        [{ texte: this.L('Adresse client'), gras: true }, { texte: valeur(i.client && i.client.adresse) || '—' },
         { texte: this.L('N° de série'), gras: true }, { texte: numSerieLabelWord }],
        [{ texte: this.L('Contact sur site'), gras: true },
         { texte: [valeur(i.client && i.client.contact), valeur(i.client && i.client.fonction)].filter(Boolean).join(' — ') || '—' },
         { texte: this.L(techniciensWord.length > 1 ? 'Techniciens sur site' : 'Technicien'), gras: true }, { texte: techLabelWord }],
        [{ texte: this.L('Téléphone / e-mail'), gras: true },
         { texte: [valeur(i.client && i.client.tel), valeur(i.client && i.client.email)].filter(Boolean).join(' / ') || '—' },
         { texte: this.L('Horaires sur site'), gras: true },
         { texte: horLabelWord }]
      ].concat(
        /* Compteur / n° de parc : plus demandés, imprimés seulement s'ils existent. */
        valeur(i.machine && (i.machine.compteur || i.machine.parc))
          ? [[{ texte: 'Compteur / N° de parc', gras: true },
              { texte: [valeur(i.machine.compteur), valeur(i.machine.parc)].filter(Boolean).join(' — ') },
              { texte: this.L('Durée sur site'), gras: true },
              { texte: formatDuree(this.etat.duree) || '—' }]]
          : [[{ texte: this.L('Durée sur site'), gras: true },
              { texte: formatDuree(this.etat.duree) || '—' }, { texte: '' }, { texte: '' }]]
      ), { largeurs: [18, 32, 18, 32], enteteFond: 'F1F5F9' });

      // Si plusieurs machines, tableau récapitulatif détaillé des machines
      if (machinesWord.length > 1) {
        d.bandeau(this.L('Machines visitées'));
        const enteteMach = [
          { texte: this.L('Machine'), gras: true, fond: 'E8EFFA' },
          { texte: this.L('Modèle'), gras: true, fond: 'E8EFFA' },
          { texte: this.L('N° de série'), gras: true, fond: 'E8EFFA' }
        ];
        const lignesMach = machinesWord.map(m => [
          { texte: m.designation || '—' },
          { texte: m.modele || '—' },
          { texte: m.serie || '—' }
        ]);
        d.tableau([enteteMach].concat(lignesMach), { largeurs: [40, 30, 30] });
      }

      // Si intervention multi-jours, tableau récapitulatif des journées
      if (i.multiJours && Array.isArray(i.jours) && i.jours.length > 0) {
        d.bandeau(this.L('Relevé des journées d\'intervention'));
        const enteteJours = [
          { texte: this.L('Date'), gras: true, fond: 'E8EFFA' },
          { texte: this.L('Horaires sur site'), gras: true, fond: 'E8EFFA' },
          { texte: this.L('Pause'), gras: true, align: 'center', fond: 'E8EFFA' },
          { texte: this.L('Durée sur site'), gras: true, align: 'center', fond: 'E8EFFA' },
          { texte: this.L('Activité / Travaux'), gras: true, fond: 'E8EFFA' }
        ];
        let totH = 0;
        const lignesJours = i.jours.map(item => {
          const dt = frDate(item.date) || '—';
          const hor = (item.debut && item.fin) ? (item.debut + ' - ' + item.fin) : (item.debut || item.fin || '—');
          const pauseTxt = item.pauseMinutes ? (item.pauseMinutes + ' min') : '—';
          const dh = typeof item.dureeHeures === 'number' ? item.dureeHeures : (typeof item.duree === 'number' ? item.duree : 0);
          totH += dh;
          const durTxt = dh > 0 ? (Math.floor(dh) + ' h ' + pad2(Math.round((dh % 1) * 60)) + ' (' + dh.toFixed(2).replace('.', ',') + ' h)') : '—';
          const desc = valeur(item.description || item.activite) || '—';
          return [
            { texte: dt },
            { texte: hor },
            { texte: pauseTxt, align: 'center' },
            { texte: durTxt, gras: true, align: 'center' },
            { texte: desc }
          ];
        });
        const durTotTxt = totH > 0 ? (Math.floor(totH) + ' h ' + pad2(Math.round((totH % 1) * 60)) + ' (' + totH.toFixed(2).replace('.', ',') + ' h)') : '—';
        lignesJours.push([
          { texte: this.L('Total cumulé'), gras: true, fond: 'E8EFFA' },
          { texte: '', fond: 'E8EFFA' },
          { texte: '', fond: 'E8EFFA' },
          { texte: durTotTxt, gras: true, align: 'center', fond: 'E8EFFA' },
          { texte: '', fond: 'E8EFFA' }
        ]);
        d.tableau([enteteJours].concat(lignesJours), { largeurs: [18, 20, 14, 18, 30] });
      }

      let piecesRendues = false;
      for (const section of this.canevas) {
        if (section.type === 'synthese') {
          d.bandeau(section.titre || 'Synthèse');
          const lignes = (this.s.categories || []).filter(c => this.etat.parCategorie[c.id])
            .map(c => [{ texte: this.L(c.libelle) }, { texte: String(this.etat.parCategorie[c.id]), align: 'center', gras: true }]);
          if (lignes.length) d.tableau([[{ texte: 'Catégorie', gras: true }, { texte: 'Nombre', gras: true, align: 'center' }]].concat(lignes),
            { largeurs: [70, 30], enteteFond: 'E8EFFA' });
          const dom = (this.s.domaines || []).filter(x => this.etat.parDomaine[x.id])
            .map(x => this.L(x.libelle) + ' : ' + this.etat.parDomaine[x.id]);
          if (dom.length) d.para(dom.join('   •   '), { taille: 10, couleur: '334155', apres: 60 });
          d.para('Heures passées sur site : ' + (formatDuree(this.etat.duree) || '—') +
            (this.etat.duree ? ' (' + dureeDecimale(this.etat.duree) + ' h)' : '') + '   •   Photos : ' + this.etat.nbPhotos,
            { taille: 10, apres: 120 });
          if (valeur(i.resumeTechnicien)) d.para('Synthèse du technicien', { gras: true, taille: 11, apres: 40 }),
            d.para(i.resumeTechnicien, { taille: 10, apres: 120 });
          if (valeur(i.objet)) d.para('Objet / demande du client', { gras: true, taille: 11, apres: 40 }),
            d.para(i.objet, { taille: 10, apres: 120 });
        } else if (section.type === 'evenements') {
          const evs = evenementsDe(i, section);
          if (!evs.length) continue;
          d.bandeau(section.titre || 'Évènements');
          for (const ev of evs) {
            const cat = this.etat.categories[ev.categorie || 'INFO'] || { libelle: 'Informatif', couleur: '#475569' };
            const dom = this.etat.domaines[ev.domaine] || { libelle: '—' };
            const morc = [
              { t: (dom.icone ? dom.icone + ' ' : '') + this.L(dom.libelle), gras: true, taille: 11, couleur: '0B3D91' }
            ];
            if (ev.machineNom) {
              morc.push({ t: '   [⚙️ ' + ev.machineNom + ']', gras: true, taille: 10, couleur: '0284C7' });
            }
            morc.push(
              { t: '   [' + this.L(cat.libelle).toUpperCase() + ']', gras: true, taille: 10, couleur: hexDocx(cat.couleur) },
              { t: heureFr(ev.heure) ? '   ' + heureFr(ev.heure) : '', taille: 9, couleur: '94A3B8' }
            );
            d.para(morc, { avant: 160, apres: 40 });
            d.para(valeur(ev.texte) || '(aucune annotation)', { taille: 10, apres: 60, encadre: true });
            for (const ph of (ev.photos || []).filter(x => x.dataUrl)) {
              this.numeroPhoto++;
              d.image(ph.dataUrl, 13, { legende: 'Photo ' + this.numeroPhoto });
            }
          }
        } else if (section.type === 'texte') {
          const contenu = valeur(i[section.champ]);
          if (!contenu) continue;
          d.bandeau(section.titre || 'Texte');
          d.para(contenu, { taille: 10, apres: 120 });
        } else if (section.type === 'pieces') {
          piecesRendues = true;
          const pcs = (i.pieces || []).filter(p => (p.denomination || p.designation || p.reference || p.quantite));
          if (!pcs.length) continue;
          d.bandeau(section.titre || 'Pièces de rechange');
          const enteteTab = [
            { texte: this.L('Dénomination'), gras: true, fond: 'E8EFFA' },
            { texte: this.L('Référence'), gras: true, fond: 'E8EFFA' },
            { texte: this.L('Quantité'), gras: true, align: 'center', fond: 'E8EFFA' }
          ];
          const lignesTab = pcs.map(p => [
            { texte: p.denomination || p.designation || '—' },
            { texte: p.reference || '—' },
            { texte: String(p.quantite || 1), align: 'center' }
          ]);
          d.tableau([enteteTab].concat(lignesTab), { largeurs: [55, 30, 15] });
          d.para(this.L('La signature du client vaut pour acceptation du devis final et validation des pièces de rechange ci-dessus.'), { taille: 8.5, couleur: '64748B', apres: 120 });
        } else if (section.type === 'photos') {
          const libres = (i.photosLibres || []).filter(ph => ph.dataUrl);
          if (!libres.length) continue;
          d.bandeau(section.titre || 'Photos');
          libres.forEach(function (ph, k) { d.image(ph.dataUrl, 13, { legende: valeur(ph.legende) || ('Photo ' + (k + 1)) }); });
        } else if (section.type === 'signature') {
          if (!piecesRendues) {
            const pcs = (i.pieces || []).filter(p => (p.denomination || p.designation || p.reference || p.quantite));
            if (pcs.length) {
              d.bandeau('Pièces de rechange');
              const enteteTab = [
                { texte: this.L('Dénomination'), gras: true, fond: 'E8EFFA' },
                { texte: this.L('Référence'), gras: true, fond: 'E8EFFA' },
                { texte: this.L('Quantité'), gras: true, align: 'center', fond: 'E8EFFA' }
              ];
              const lignesTab = pcs.map(p => [
                { texte: p.denomination || p.designation || '—' },
                { texte: p.reference || '—' },
                { texte: String(p.quantite || 1), align: 'center' }
              ]);
              d.tableau([enteteTab].concat(lignesTab), { largeurs: [55, 30, 15] });
              d.para(this.L('La signature du client vaut pour acceptation du devis final et validation des pièces de rechange ci-dessus.'), { taille: 8.5, couleur: '64748B', apres: 120 });
              piecesRendues = true;
            }
          }
          d.bandeau(section.titre || 'Validation');
          let mention = valeur(this.s.impression && this.s.impression.mentionClient) ||
            "Le client reconnaît avoir pris connaissance du présent rapport, avoir reçu les explications du technicien et accepte les constats et travaux décrits.";
          const pcs = (i.pieces || []).filter(p => (p.denomination || p.designation || p.reference || p.quantite));
          if (pcs.length > 0) {
            mention += " La signature du client vaut pour acceptation du devis final et validation des pièces de rechange ci-dessus.";
          }
          d.para(this.L(mention), { taille: 9.5, apres: 160, encadre: true });
          const cli = i.signatureClient || {};
          const ligAccompagne = (colleguesP1Word.length > 0)
            ? [[{ texte: '' }, { texte: this.L('Accompagné de') + ' : ' + colleguesP1Word.map(c => c.nom + (c.fonction ? ' (' + this.L(c.fonction) + ')' : '')).join(', ') }]]
            : [];
          d.tableau([
            [{ texte: this.L('Le client (bon pour accord)'), gras: true, fond: 'E8EFFA' }, { texte: this.L('Le technicien'), gras: true, fond: 'E8EFFA' }],
            [{ texte: valeur(cli.nom) || '—' }, { texte: valeur(i.technicien) || valeur(s.technicien && s.technicien.nom) || '—' }],
            [{ texte: valeur(cli.fonction) || '' }, { texte: [valeur(s.technicien && s.technicien.fonction), contactTech(s.technicien)].filter(Boolean).join(' — ') }]
          ].concat(ligAccompagne).concat([
            [{ texte: 'Date : ' + frDate(cli.date || i.date) + (cli.heure ? ' à ' + cli.heure : '') },
             { texte: 'Date : ' + frDate(i.date) + (heureFr(i.chrono && i.chrono.fin) ? ' à ' + heureFr(i.chrono && i.chrono.fin) : '') }]
          ]), { largeurs: [50, 50] });
          if (cli.dataUrl) d.image(cli.dataUrl, 6, { hauteurMaxCm: 3 });
        }
      }
      return { blob: this.doc.blob(), filename: nomFichier(this.i, 'docx', this.opts.suffixe ? this.langue : null) };
    }
  }

  /* ===================== E-mails ====================================== */
  function variables(intervention, reglages) {
    const e = etat(intervention, reglages);
    const i = intervention;
    const lignes = e.evenements
      .filter(x => x.categorie === 'SECURITE' || x.categorie === 'URGENT' || x.categorie === 'HAUTE')
      .map(function (x) {
        const cat = e.categories[x.categorie] || {};
        const dom = e.domaines[x.domaine] || {};
        return '[' + (cat.libelle || x.categorie) + '] ' + (dom.libelle || '') + ' : ' + valeur(x.texte).split('\n')[0].slice(0, 180);
      });
    /* Noms des variables du modèle « Compte rendu d'intervention » BFR
       (Google Doc de référence) : {Client_Name} {Mail_Client} {numero_client}
       {Logo_Client} {Date} {Name_Technicien} {Poste_Tech} {Mail_Tech} {Num_Tech}
       {Client_Adress} {Client_Contact}. */
    const c = i.client || {}, t = reglages.technicien || {};
    const modele = {
      Client_Name: valeur(c.nom), Mail_Client: valeur(c.email),
      numero_client: valeur(c.tel),                       // téléphone du client (saisi si absent de la liste)
      Logo_Client: valeur(c.logo),                        // vide = place laissée vide dans le compte rendu
      Date: frDate(i.date),
      Name_Technicien: nomTechnicien(i, reglages), Poste_Tech: valeur(t.fonction),
      Mail_Tech: valeur(t.email), Num_Tech: valeur(t.tel),
      Client_Adress: valeur(c.adresse || c.lieu), Client_Contact: valeur(c.contact)
    };
    return Object.assign(modele, {
      numero: valeur(i.numero), affaire: valeur(i.numero),
      client: valeur(i.client && i.client.nom), contact: valeur(i.client && i.client.contact),
      lieu: valeur(i.client && (i.client.lieu || i.client.adresse)),
      date: frDate(i.date),
      machine: (function () {
        const ms = listeMachines(i);
        return ms.length > 1
          ? ms.map(m => m.designation).filter(Boolean).join(' ; ')
          : (valeur(i.machine && i.machine.designation) || '');
      })(),
      serie: valeur(i.machine && i.machine.serie),
      technicien: nomTechnicien(i, reglages),
      societe: valeur(reglages.societe && reglages.societe.nom),
      debut: heureFr(i.chrono && i.chrono.debut), fin: heureFr(i.chrono && i.chrono.fin),
      duree: formatDuree(e.duree) || '—',
      nbEvenements: String(e.evenements.length),
      nbSecurite: String(e.parCategorie.SECURITE || 0),
      nbUrgent: String(e.parCategorie.URGENT || 0),
      nbHaute: String(e.parCategorie.HAUTE || 0),
      nbBasse: String(e.parCategorie.BASSE || 0),
      nbInfo: String(e.parCategorie.INFO || 0),
      nbPhotos: String(e.nbPhotos),
      pointsCles: lignes.length ? lignes.join('\n') : 'Aucun point de sécurité ou d\'urgence relevé.',
      resume: valeur(i.resumeTechnicien), actions: valeur(i.actions), aPrevoir: valeur(i.aPrevoir)
    });
  }

  function appliquer(tpl, vars) {
    return String(tpl || '').replace(/\{\{(\w+)\}\}/g, function (m, k) { return vars[k] !== undefined ? vars[k] : m; });
  }
  function objetMail(i, s) {
    return appliquer((s.mail && s.mail.objet) || 'Rapport d\'intervention N° {{numero}} — {{client}} — {{date}}', variables(i, s));
  }
  function corpsMail(i, s, langue) {
    const corps = appliquer((s.mail && s.mail.corps) || defaultCorpsMail(), variables(i, s));
    /* Rapport envoyé en deux langues : on le dit au client, dans sa langue,
       à la fin du message (le corps du mail reste en français pour le SAV). */
    const phrase = (langue && langue !== 'fr' && global.I18N) ? global.I18N.phraseTraduction(langue) : null;
    return phrase ? corps + '\n\n' + phrase : corps;
  }
  function defaultCorpsMail() {
    return [
      'Bonjour,',
      '',
      'Veuillez trouver ci-joint le rapport d\'intervention N° {{numero}} du {{date}}, concernant {{client}} ({{lieu}}) — {{machine}}.',
      '',
      'Temps passé sur site : {{duree}} (de {{debut}} à {{fin}}).',
      '{{nbEvenements}} point(s) ont été relevés : {{nbSecurite}} sécurité, {{nbUrgent}} urgent(s), {{nbHaute}} priorité haute, {{nbBasse}} priorité basse, {{nbInfo}} informatif(s).',
      '',
      'Points clés :',
      '{{pointsCles}}',
      '',
      'Synthèse :',
      '{{resume}}',
      '',
      'Travaux réalisés :',
      '{{actions}}',
      '',
      'Restant à votre disposition pour tout complément d\'information.',
      '',
      'Cordialement,',
      '{{technicien}}',
      '{{societe}}'
    ].join('\n');
  }

  global.Report = {
    /* opts : { langue: 'en', suffixe: true } pour la version traduite. */
    genererPDF: function (i, s, opts) { return new RapportPDF(i, s, opts).generer(); },
    /* Aperçu dans l'application : renvoie un canvas par page. */
    apercu: async function (i, s, opts) {
      opts = opts || {};
      const r = await new RapportPDF(i, s, Object.assign({}, opts, { apercu: true })).generer();
      const pages = await Pdf.rendrePages(r.apercu, opts);
      return { pages: pages, doc: r.apercu, filename: r.filename };
    },
    genererDOCX: function (i, s, opts) { return new RapportWord(i, s, opts).generer(); },
    canevasDefaut: canevasDefaut,
    etat: etat, evenementsDe: evenementsDe, dureeMs: dureeMs, dureeTotale: dureeTotale, formatDuree: formatDuree,
    dureeDecimale: dureeDecimale, frDate: frDate, heureFr: heureFr, valeur: valeur, slug: slug,
    listeMachines: listeMachines, listeTechniciens: listeTechniciens,
    objetMail: objetMail, corpsMail: corpsMail, defaultCorpsMail: defaultCorpsMail, variables: variables,
    nomComplet: nomComplet, contactTech: contactTech, nomTechnicien: nomTechnicien
  };
})(window);
