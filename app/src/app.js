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
  const todayISO = () => new Date().toISOString().slice(0, 10);

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
  function vibrate(ms) { if (navigator.vibrate) try { navigator.vibrate(ms || 12); } catch (e) {} }
  const pad2 = (n) => ('0' + n).slice(-2);
  const ICO = (typeof window !== 'undefined' && window.ICO) || (typeof global !== 'undefined' && global.ICO) || {};

  /* ===================== Réglages ===================================== */
  const K = { settings: 'sav3.settings', rapport: 'sav3.rapport', rapports: 'sav3.rapports' };

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
      siege1: '', siege2: ''               // adresses du pied de page (celles du modèle par défaut)
    },
    technicien: { prenom: '', nom: '', fonction: 'Technicien SAV', tel: '', email: '', signature: '' },
    mail: {
      destinataireSAV: '', destinatairesCopie: '',
      objet: 'Rapport d\'intervention N° {{numero}} — {{client}} — {{date}}',
      corps: '', envoyerClient: true, envoyerSAV: true,
      messagePartage: 'Bonjour, veuillez trouver ci-joint le rapport d\'intervention N° {{numero}} du {{date}}. Cordialement.'
    },
    impression: {
      mentionClient: "Le client reconnaît avoir pris connaissance du présent rapport, avoir reçu les explications du technicien et accepte les constats et travaux décrits."
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
  if (!S.canevas) S.canevas = Report.canevasDefaut();

  /* ---------- Gestion de l'icône de l'application (Écran d'accueil) ---------- */
  function appliquerIconeApp(id) {
    if (typeof document === 'undefined') return;
    const options = (typeof window !== 'undefined' && window.BFR_ICONES_OPTIONS) || [];
    const opt = options.find(o => o.id === id) || options[0];
    if (!opt) return;

    try {
      // Mise à jour de la favicon et de l'icône tactile Apple
      const fav = document.querySelector('link[rel="icon"]');
      if (fav) fav.href = opt.src192 || opt.dataUri;
      const apple = document.querySelector('link[rel="apple-touch-icon"]');
      if (apple) apple.href = opt.src192 || opt.dataUri;

      // Mise à jour dynamique du manifest PWA pour installation Android
      const manifestData = {
        name: "BFR SAV — Compte rendu d'intervention",
        short_name: "BFR SAV",
        start_url: "./",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#332e72",
        lang: "fr",
        icons: [
          { src: opt.src192 || "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: opt.src512 || "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: opt.src512 || "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      };
      if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
        const blob = new Blob([JSON.stringify(manifestData)], { type: 'application/json' });
        let link = document.querySelector('link[rel="manifest"]');
        if (!link) {
          link = document.createElement('link');
          link.rel = 'manifest';
          document.head.appendChild(link);
        }
        link.href = URL.createObjectURL(blob);
      }
    } catch (_) {}
  }

  // Application de l'icône choisie au démarrage
  appliquerIconeApp(S.iconeApp || 'opt1');

  /* ===================== Intervention ================================= */
  function numeroSuggere() {
    const d = new Date();
    const base = d.getFullYear().toString().slice(2) + pad2(d.getMonth() + 1) + pad2(d.getDate());
    let seq = 1;
    const jour = todayISO();
    Store.get(K.rapports, []).forEach(r => { if (r.cree && r.cree.slice(0, 10) === jour) seq++; });
    return (S.numeroPrefixe ? S.numeroPrefixe.replace(/[-\s]+$/, '') + '-' : '') + base + '-' + pad2(seq);
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
      actions: '', aPrevoir: '', resumeTechnicien: '', noteInterne: '',
      travauxTermines: '', faitLe: todayISO(),
      signatureClient: { nom: '', fonction: '', dataUrl: '', date: '', heure: '' }
    };
  }

  let R = fusion(nouvelleIntervention(), Store.get(K.rapport, null) || {});
  if (!R.evenements) R.evenements = [];
  if (!Array.isArray(R.pieces)) R.pieces = [];
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

  let dirty = false, saveTimer;
  function sauver(silencieux) {
    synchroniserEntites();
    R.maj = new Date().toISOString();
    const ok = Store.set(K.rapport, R);
    const liste = Store.get(K.rapports, []);
    const i = liste.findIndex(x => x.id === R.id);
    const leger = JSON.parse(JSON.stringify(R));
    leger.photosLibres = (leger.photosLibres || []).map(p => ({ legende: p.legende, dataUrl: '' }));
    leger.evenements = (leger.evenements || []).map(e => Object.assign({}, e, { photos: (e.photos || []).map(p => ({ dataUrl: '' })) }));
    if (i >= 0) liste[i] = leger; else liste.unshift(leger);
    if (liste.length > 40) liste.length = 40;
    const ok2 = Store.set(K.rapports, liste);
    if (!ok || !ok2) { if (!silencieux) toast('Mémoire pleine : exportez la sauvegarde (Menu)', 5000); return false; }
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
  function dureeTexte() {
    const ms = duree();
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 3600) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
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
    if (!R.chrono.enPause) {
      R.chrono.enPause = true; R.chrono.debutPause = new Date().toISOString();
      toast('Pause (interruption, repas…) — le temps est déduit');
    } else {
      R.chrono.pauses.push({ d: R.chrono.debutPause, f: new Date().toISOString() });
      R.chrono.enPause = false; R.chrono.debutPause = null;
      toast('Reprise de l\'intervention');
    }
    planifier(); rendreChrono();
  }
  function terminerChrono() {
    if (R.chrono.enPause) basculerPause();
    R.chrono.fin = new Date().toISOString();
    R.statut = R.signatureClient.dataUrl ? 'signé' : 'terminé';
    R.travauxTermines = R.travauxTermines || 'Oui';
    planifier(); rendreChrono();
    toast('Intervention terminée — ' + Report.formatDuree(duree()) + ' sur site');
  }
  function rendreChrono() {
    const barre = $('#chronoBarre');
    if (!barre) return;
    if (R.multiJours && Array.isArray(R.jours) && R.jours.length > 0) {
      const tot = duree();
      barre.innerHTML = `<div class="chrono-encours">
        <div class="chrono-temps"><span class="chrono-label">Heures cumulées (${R.jours.length} jour(s))</span>
          <strong id="chronoTemps">${Report.formatDuree(tot) || '0 min'}</strong></div>
        <div class="chrono-actions"><button class="btn sm grey" data-a="chrono-ajuster">${(ICO.pen && ICO.pen(14)) || ''} Relevé jours</button></div></div>
        <p class="chrono-note">${R.jours.map(j => (Report.frDate(j.date) || j.date) + ' (' + (j.dureeHeures || 0) + ' h)').join(' • ')} • ${Report.dureeDecimale(tot)} h</p>`;
      clearInterval(tic);
      return;
    }
    const c = R.chrono;
    if (!c.debut) {
      barre.innerHTML = `<button class="btn chrono-demarrer" data-a="chrono-demarrer" style="width:100%">
        ${(ICO.play && ICO.play(16)) || ''} Démarrer l'intervention</button>
        <p class="chrono-note">L'heure de début est enregistrée automatiquement.</p>`;
    } else if (!c.fin) {
      barre.innerHTML = `<div class="chrono-encours">
        <div class="chrono-temps"><span class="chrono-label">${c.enPause ? 'En pause depuis' : 'Sur site depuis'}</span>
          <strong id="chronoTemps">${dureeTexte()}</strong></div>
        <div class="chrono-actions">
          <button class="btn sm grey" data-a="chrono-pause">${c.enPause ? (((ICO.play && ICO.play(14)) || '') + ' Reprendre') : (((ICO.pause && ICO.pause(14)) || '') + ' Pause')}</button>
          <button class="btn sm or" data-a="chrono-terminer">${(ICO.stop && ICO.stop(14)) || ''} Terminer</button>
        </div></div>
        <p class="chrono-note">Début ${Report.heureFr(c.debut)}${(c.pauses || []).length ? ' — ' + c.pauses.length + ' pause(s) déduite(s)' : ''}</p>`;
    } else {
      barre.innerHTML = `<div class="chrono-encours">
        <div class="chrono-temps"><span class="chrono-label">Temps sur site</span><strong>${Report.formatDuree(duree()) || '0 min'}</strong></div>
        <div class="chrono-actions"><button class="btn sm grey" data-a="chrono-ajuster">${(ICO.pen && ICO.pen(14)) || ''} Ajuster</button></div></div>
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
              <div><span>Contact</span><strong>${esc(c.contact || '—')}</strong></div>
              ${recapTechs}
              <div><span>Objet</span><strong>${esc(R.objet || '—')}</strong></div>
              <div><span>Langue du rapport</span><strong>${R.langue.active && R.langue.code
                ? 'français + ' + esc(I18N.natif(R.langue.code))
                : 'français'}</strong></div>
            </div>`
          : `<p class="hint">Renseignez le client et la machine : ces informations se retrouvent dans le rapport.</p>
             <button class="btn wide" data-a="editer-client">Client & machine</button>`}
      </div>`;
  }

  function carteEvenement(ev, i) {
    const cat = catDe(ev.categorie), dom = domDe(ev.domaine);
    const texte = Report.valeur(ev.texte);
    return `<div class="ev-carte" data-ev="${ev.id}" style="--c:${cat.couleur};--f:${cat.fond}">
      <div class="ev-tete">
        <span class="ev-dom">${(ICO.domaine && ICO.domaine(dom.id || dom.icone, 16)) || ''} ${esc(dom.libelle)}</span>
        ${ev.machineNom ? `<span class="pill" style="background:var(--bfr-primary-light);color:var(--bfr-secondary);font-weight:600;border:1px solid var(--bfr-primary-border)">${(ICO.gear && ICO.gear(13)) || ''} ${esc(ev.machineNom)}</span>` : ''}
        <span class="ev-cat">${(ICO.categorie && ICO.categorie(cat.id || cat.icone, 16)) || ''} ${esc(cat.libelle)}</span>
        <span class="ev-heure">${esc(Report.heureFr(ev.heure))}</span>
      </div>
      <div class="ev-corps">
        ${(ev.photos || []).length ? `<div class="ev-vignettes">${ev.photos.slice(0, 3).map(p => `<img src="${p.dataUrl}" alt="">`).join('')}</div>` : ''}
        <p class="ev-texte">${texte ? esc(texte.length > 180 ? texte.slice(0, 180) + '…' : texte) : '<em>Annotation à compléter…</em>'}</p>
      </div>
      <div class="ev-pied">
        ${(ev.photos || []).length ? `<span class="pill">${ev.photos.length} photo(s)</span>` : '<span class="pill">sans photo</span>'}
        ${!ev.texte ? '<span class="pill surv">texte manquant</span>' : ''}
        <span class="ev-modifier">Modifier ›</span>
      </div>
    </div>`;
  }

  function rendreEvenements(e) {
    const zone = $('#zoneEvenements');
    if (!zone) return;
    const evs = R.evenements.slice().sort((a, b) => new Date(a.heure || 0) - new Date(b.heure || 0));
    zone.innerHTML = `
      <div class="card">
        <h2>Évènements <span class="pill compteur-ev">0</span></h2>
        <p class="hint">Chaque constat, défaut ou information relevée sur la machine. Appuyez sur un évènement pour le compléter ou le corriger à tout moment.</p>
        ${e.securite ? `<div class="alerte-securite">${(ICO.shieldAlert && ICO.shieldAlert(18)) || ''} ${e.securite} point(s) de sécurité ou d'urgence — ils apparaîtront en tête du rapport.</div>` : ''}
        ${evs.length ? `<div class="ev-liste">${evs.map(carteEvenement).join('')}</div>`
          : `<div class="ev-vide">
               <span class="ev-vide-ico">${(ICO.fileText && ICO.fileText(36)) || ''}</span>
               <p>Aucun évènement pour l'instant.</p>
               <p class="small">Commencez par le premier constat : domaine → annotation → photo → catégorie.</p>
             </div>`}
      </div>`;
  }

  function rendreCloture(e) {
    const zone = $('#zoneCloture');
    if (!zone) return;
    const signe = !!(R.signatureClient && R.signatureClient.dataUrl);
    zone.innerHTML = `
      <div class="card">
        <h2>Compte rendu</h2>
        <div class="field"><label>Résumé / synthèse de l\'intervention</label>
          <textarea data-k="resumeTechnicien" rows="4" placeholder="Ex. Audit complet du groupe hydraulique : courroie détendue, roulement d'arbre principal en fin de vie. Remplacement de la courroie, graissage, essai en charge concluant.">${esc(R.resumeTechnicien)}</textarea></div>
        <div class="field"><label>Travaux réalisés</label>
          <textarea data-k="actions" rows="3" placeholder="Ex. Remplacement courroie XPB 2360, réglage tension, graissage des paliers…">${esc(R.actions)}</textarea></div>
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
        <div class="btnrow" style="margin-top:10px">
          <button class="btn wide ghost" data-a="ajouter-piece">${(ICO.plus && ICO.plus(16)) || ''} Ajouter pièce de rechange</button>
        </div>
      </div>

      <div class="card">
        <h2>Point client & signature</h2>
        ${signe
          ? `<div class="signe-ok">${(ICO.checkCircle && ICO.checkCircle(18)) || ''} Signé par <strong>${esc(R.signatureClient.nom || 'le client')}</strong>
               ${R.signatureClient.heure ? 'à ' + esc(R.signatureClient.heure) : ''}
               <img src="${R.signatureClient.dataUrl}" alt="signature"></div>
             <div class="btnrow" style="margin-top:8px">
               <button class="btn sm grey" data-a="signer">Refaire signer</button>
               <button class="btn sm grey" data-a="effacer-signature">Effacer</button>
             </div>`
          : `<p class="hint">En fin d'intervention : présentez le déroulé au client, puis faites-le signer directement sur l'écran.</p>
             <button class="btn wide" data-a="signer">${(ICO.signature && ICO.signature(18)) || ''} Faire signer le client</button>`}
      </div>

      <div class="card">
        <h2>Soumettre le rapport</h2>
        <p class="hint">Le rapport est mis en forme selon le canevas « ${esc((S.canevas && S.canevas.nom) || 'standard')} » : ${e.evenements.length} évènement(s), ${e.nbPhotos} photo(s), ${Report.formatDuree(e.duree) || 'durée non mesurée'}.</p>
        <button class="btn or wide" data-a="soumettre">${(ICO.send && ICO.send(18)) || ''} Soumettre le rapport</button>
        <div class="btnrow" style="margin-top:8px">
          <button class="btn ghost" data-a="apercu">${(ICO.eye && ICO.eye(18)) || ''} Aperçu PDF</button>
          <button class="btn grey" data-a="word">${(ICO.fileText && ICO.fileText(18)) || ''} Word</button>
        </div>
        <p class="small" style="margin-top:8px">Destinataires : client <strong>${esc(R.client.email || 'non renseigné')}</strong> — SAV <strong>${esc(S.mail.destinataireSAV || 'non renseigné')}</strong></p>
      </div>`;
  }

  function champSelect(cle, label, options) {
    const v = getPath(R, cle) || '';
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
            <th style="padding:7px 9px;font-size:11.5px;text-transform:uppercase">Dénomination</th>
            <th style="padding:7px 9px;font-size:11.5px;text-transform:uppercase">Référence</th>
            <th style="padding:7px 9px;font-size:11.5px;text-transform:uppercase;text-align:center">Qté</th>
            <th style="padding:7px 9px;font-size:11.5px;text-transform:uppercase;text-align:right">Action</th>
          </tr>
        </thead>
        <tbody>
          ${pcs.map((p, idx) => `
            <tr style="border-bottom:1px solid var(--bord);background:${idx % 2 === 1 ? '#fcfdff' : '#fff'}">
              <td style="padding:7px 9px"><strong>${esc(p.denomination || '—')}</strong></td>
              <td style="padding:7px 9px;font-family:ui-monospace,monospace;color:#475569">${esc(p.reference || '—')}</td>
              <td style="padding:7px 9px;text-align:center"><strong>${esc(p.quantite || 1)}</strong></td>
              <td style="padding:7px 9px;text-align:right;white-space:nowrap">
                <button type="button" class="btn sm grey" style="min-height:28px;padding:2px 7px;font-size:12px" data-a="editer-piece" data-id="${esc(p.id)}" title="Modifier">${(ICO.pen && ICO.pen(12)) || ''}</button>
                <button type="button" class="btn sm danger" style="min-height:28px;padding:2px 7px;font-size:12px;margin-left:4px" data-a="supprimer-piece" data-id="${esc(p.id)}" title="Supprimer">${(ICO.trash && ICO.trash(12)) || ''}</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
  }

  function feuillePiece(pieceExistante) {
    const edit = !!pieceExistante;
    const p = pieceExistante || { id: uid('p'), denomination: '', reference: '', quantite: 1 };
    const panneau = Ouvrir.ouvrir(null, `<div class="panel">
      <div class="grab"></div><h3>${edit ? 'Modifier la pièce' : 'Ajouter une pièce de rechange'}</h3>
      <p class="sub">Pièce neuve de remplacement utilisée ou laissée dans le stock du client.</p>

      <div class="field"><label>Dénomination / désignation</label>
        <input type="text" id="pcDenom" value="${esc(p.denomination || '')}" placeholder="Ex. Roulement SKF 6205, Courroie SPZ 1250, Vérin…"></div>

      <div class="field"><label>Référence BFR / fabricant</label>
        <input type="text" id="pcRef" value="${esc(p.reference || '')}" placeholder="Ex. 734-9021-A, BFR-8820…"></div>

      <div class="field"><label>Quantité</label>
        <input type="number" id="pcQte" min="1" step="1" value="${esc(p.quantite || 1)}"></div>

      <div class="btnrow"><button class="btn grey" data-a="fermer">Annuler</button>
        <button class="btn" data-a="sauvegarder-piece">${edit ? 'Enregistrer' : 'Ajouter la pièce'}</button></div></div>`, (pEl) => {
      setTimeout(() => { const el = $('#pcDenom', pEl); if (el) el.focus(); }, 80);
      pEl.addEventListener('click', (e) => {
        if (!e.target.closest('[data-a="sauvegarder-piece"]')) return;
        const denom = ($('#pcDenom', pEl).value || '').trim();
        const ref = ($('#pcRef', pEl).value || '').trim();
        const qteVal = parseInt($('#pcQte', pEl).value, 10);
        const qte = (!isNaN(qteVal) && qteVal > 0) ? qteVal : 1;
        if (!denom && !ref) {
          toast('Veuillez renseigner au moins la dénomination ou la référence');
          return;
        }
        if (edit) {
          p.denomination = denom;
          p.reference = ref;
          p.quantite = qte;
        } else {
          if (!Array.isArray(R.pieces)) R.pieces = [];
          R.pieces.push({ id: p.id, denomination: denom, reference: ref, quantite: qte });
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
  function ajouterEvenement() {
    synchroniserEntites();
    const machinesValides = (R.machines || []).filter(m => m && (m.designation || m.modele || m.serie));
    const ev = Assistant.nouvelEvenement({
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

  /* ===================== Client & machine ============================= */
  function feuilleClient() {
    synchroniserEntites();
    const f = (k, label, opt) => {
      opt = opt || {};
      const val = getPath(R, k) || '';
      return `<div class="field"><label>${esc(label)}</label><input type="${opt.type || 'text'}" data-fk="${k}" value="${esc(val)}" placeholder="${esc(opt.ph || '')}"${opt.list ? ' list="' + opt.list + '"' : ''}></div>`;
    };
    const dl = (id, arr) => `<datalist id="${id}">${[...new Set((arr || []).filter(Boolean))].slice(-30).map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
    const histo = Store.get(K.rapports, []);
    const nbClients = Clients.liste().length;
    const techsBFR = (Clients.listeTechniciens ? Clients.listeTechniciens() : (window.TECHNICIENS_BFR || [])).map(t => t.nom);

    const ouvrir = (e) => Ouvrir.ouvrir(e, `<div class="panel">
      <div class="grab"></div><h3>Client & machine</h3>
      <p class="sub">Ces informations figurent en tête du rapport.</p>
      ${dl('dlLieux', histo.map(r => r.client && r.client.lieu))}
      ${dl('dlMachines', histo.map(r => r.machine && r.machine.designation))}
      ${dl('dlTechsBFR', techsBFR)}
      <div class="card"><h2>Client</h2>
        <div class="field"><label>Client</label>
          <input type="text" id="cliRecherche" autocomplete="off" value="${esc(R.client.nom || '')}"
                 placeholder="${nbClients ? 'Tapez 3 lettres (ex. ENT, CFR, LAC…)' : 'Tapez 3 lettres du nom du client'}">
          <p class="small">${nbClients
            ? 'Liste BFR : ' + nbClients + " client(s) — les correspondances s'affichent dès la 3<sup>e</sup> lettre."
            : 'Aucune liste clients dans cette version : importez-la une fois dans Menu → Réglages → <em>Liste clients</em>.'}</p>
          <div class="suggestions" id="cliSug" hidden></div>
        </div>
        <div class="grid2">${f('client.contact', 'Contact sur site (nom)', { ph: 'Ex. M. Rivière' })}${f('client.fonction', 'Fonction', { ph: 'Ex. Responsable maintenance' })}</div>
        <div class="grid2">${f('client.tel', 'Téléphone du client', { type: 'tel', ph: 'Ex. 04 78 55 44 33' })}${f('client.email', 'E-mail du client', { type: 'email', ph: 'Ex. contact@client.fr' })}</div>
        ${f('client.adresse', 'Adresse du client', { ph: 'Rue, code postal, ville' })}
        ${f('client.lieu', "Lieu d'intervention", { list: 'dlLieux', ph: "Ex. Atelier 2 — ligne 4" })}
        <div class="filebtn" style="margin-top:8px"><input type="file" id="logoClient" accept="image/*">
          <label for="logoClient">${(ICO.image && ICO.image(16)) || ''} ${R.client.logo ? 'Changer le logo du client' : 'Ajouter le logo du client (facultatif)'}</label></div>
        ${R.client.logo ? '<img src="' + R.client.logo + '" style="max-height:52px;margin-top:8px;background:#fff;border:1px solid var(--bord);border-radius:6px">'
                        : '<p class="small">Sans logo, la place reste vide dans le compte rendu.</p>'}
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
                  <input type="text" data-m-k="designation" data-m-i="${idx + 1}" value="${esc(m.designation || '')}" placeholder="Ex. Ensacheuse, Convoyeur..." list="dlMachines"></div>
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
                  <input type="text" data-t-k="nom" data-t-i="${idx + 1}" value="${esc(t.nom || '')}" placeholder="Ex. Thomas BERNARD" list="dlTechsBFR"></div>
                <div class="field"><label>Fonction / Spécialité</label>
                  <input type="text" data-t-k="fonction" data-t-i="${idx + 1}" value="${esc(t.fonction || 'Technicien SAV')}" placeholder="Ex. Automaticien, Mécanicien..."></div>
              </div>`).join('')}
          </div>
          <button type="button" class="btn sm grey" id="btnAjouterTechnicien">+ Ajouter un collègue sur site</button>
        </div>
        ${f('objet', 'Objet / demande du client', { ph: 'Ex. Audit mécanique suite à des bruits anormaux' })}
      </div>
      <div class="btnrow"><button class="btn grey" data-a="fermer">Fermer</button>
        <button class="btn" data-a="ok">Valider</button></div>
    </div>`, (panneau) => {
      $$('[data-fk]', panneau).forEach(el => {
        el.addEventListener('input', () => { setPath(R, el.dataset.fk, el.value); planifier(); rendreEntete(); rendreTout(); });
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
              <input type="text" data-m-k="designation" data-m-i="${idx + 1}" value="${esc(m.designation || '')}" placeholder="Ex. Ensacheuse, Convoyeur..." list="dlMachines"></div>
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
              <input type="text" data-t-k="nom" data-t-i="${idx + 1}" value="${esc(t.nom || '')}" placeholder="Ex. Thomas BERNARD" list="dlTechsBFR"></div>
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
        propositions = Clients.chercher(q, 8);
        if (!propositions.length) { fermerSuggestions(); return; }
        boite.hidden = false;
        boite.innerHTML = propositions.map((c, i) => `<button type="button" class="suggestion" data-i="${i}">
            <span class="sug-nom">${esc(c.nom)}</span>
            <span class="sug-detail">${esc([c.ville, c.contact, c.tel].filter(Boolean).join(' · ')) || '—'}</span>
          </button>`).join('');
      }

      /* Choix d'un client : on remplit tout ce que la liste connaît, sans
         écraser ce que le technicien a déjà saisi (sauf le nom). */
      function choisirClient(c) {
        R.client.nom = c.nom;
        R.client.reference = c.reference || '';
        if (c.adresse) R.client.adresse = c.adresse;
        if (c.ville) R.client.lieu = c.ville;
        if (c.contact) R.client.contact = c.contact;
        if (c.fonction) R.client.fonction = c.fonction;
        if (c.tel) R.client.tel = c.tel;
        if (c.email) R.client.email = c.email;
        if (c.logo) R.client.logo = c.logo;
        if (c.numeroClient) R.client.numeroClient = c.numeroClient;
        R.client.noteContacts = c.autresContacts || R.client.noteContacts || '';
        /* Langue déjà utilisée chez ce client : proposée d'office (l'option
           reste à cocher par le technicien, elle n'est jamais activée seule). */
        if (c.langue) {
          R.client.langue = c.langue;
          R.langue.code = c.langue;
          const sel = $('#langCode', panneau);
          if (sel) sel.value = c.langue;
          const resume = $('#langResume', panneau);
          if (resume) resume.textContent = texteLangue(R);
        }
        planifier();
        champ.value = c.nom;
        $$('[data-fk]', panneau).forEach(el => { el.value = getPath(R, el.dataset.fk) || ''; });
        const img = $('.card img', panneau);
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
    return JSON.stringify([rapport.id, rapport.maj, (S.canevas && S.canevas.nom) || '', langue || 'fr']);
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
  function telecharger(blob, nom) {
    const url = urlObjet(blob);
    if (!url) { toast('Téléchargement indisponible sur ce navigateur'); return; }
    const a = document.createElement('a');
    a.href = url; a.download = nom;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
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
    const poursuivre = confirm(explication + "\n\nCréer quand même le rapport en " + nom +
      " (libellés traduits, commentaires laissés en français) ?\n\n« Annuler » = n'envoyer que le rapport français.");
    if (!poursuivre) return { actif: true, ok: false, annule: true, motif: res.motif };
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
    if (S.mail.envoyerSAV !== false && S.mail.destinataireSAV) {
      const sav = S.mail.destinataireSAV.trim();
      if (sav && to.indexOf(sav) === -1) to.push(sav);
    }

    // Ligne "Cc :" (Copies conformes : technicien systématiquement + adresses configurées)
    if (S.technicien && S.technicien.email) {
      const tech = S.technicien.email.trim();
      if (tech && cc.indexOf(tech) === -1 && to.indexOf(tech) === -1) cc.push(tech);
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

  function destinataires() {
    const d = destinatairesMail();
    return d.to.concat(d.cc);
  }

  /* Suivi de la traduction à l'écran (téléchargement du modèle, avancement). */
  function surEtatTraduction(e) {
    if (!e) return;
    if (e.etape === 'debut') toast('Préparation de la traduction (' + e.langue + ')…', 2200);
    else if (e.etape === 'telechargement') toast('Téléchargement de la langue : ' + (e.pct || 0) + ' %', 1400);
    else if (e.etape === 'traduction' && e.total && (e.fait === e.total || e.fait === 0)) {
      toast(e.fait === 0 ? 'Traduction des commentaires…' : 'Traduction terminée', 1600);
    }
  }

  async function soumettre() {
    if (!R.client.nom) { toast('Renseignez d\'abord le client'); feuilleClient(); return; }
    if (!R.signatureClient.dataUrl && !confirm('Le client n\'a pas signé. Soumettre quand même le rapport ?')) return;
    if (!R.chrono.fin && R.chrono.debut && !confirm('Le chrono n\'est pas terminé. Continuer ?')) return;

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
    if (R.langue && R.langue.active && R.langue.code) {
      trad = await traduireRapport(surEtatTraduction);
      if (trad.actif && trad.ok) {
        resTrad = await pdf(trad.rapport, trad.code, true);
        try { resWordTrad = await docx(trad.rapport, trad.code, true); } catch (e) { resWordTrad = null; }
      }
    }

    const lots = { fr: { pdf: res, word: resWord }, trad: (resTrad ? { code: trad.code, pdf: resTrad, word: resWordTrad } : null), partiel: !!(trad.partiel) };
    const fichiers = fichiersEnvoi(lots);
    const message = Report.valeur(S.mail.messagePartage).replace(/\{\{(\w+)\}\}/g, (m, k) => {
      const v = Report.variables(R, S);
      return v[k] !== undefined ? v[k] : m;
    });
    const langueMail = lots.trad ? lots.trad.code : null;

    if (navigator.canShare && navigator.canShare({ files: fichiers })) {
      try {
        await navigator.share({ files: fichiers, title: Report.objetMail(R, S), text: message + '\n\n' + Report.corpsMail(R, S, langueMail) });
        R.statut = 'transmis'; if (langueMail) R.langueEnvoyee = langueMail;
        planifier(); rendreTout();
        toast(langueMail ? 'Rapports transmis (français + ' + I18N.natif(langueMail) + ')' : 'Rapport transmis', 2600);
        return;
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    telecharger(res.blob, res.filename);
    feuilleEnvoi(lots);
  }

  /* Fichiers joints au mail : le rapport français, puis sa version traduite. */
  function fichiersEnvoi(lots) {
    const PDF = 'application/pdf';
    const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const fichiers = [new File([lots.fr.pdf.blob], lots.fr.pdf.filename, { type: PDF })];
    if (lots.fr.word) fichiers.push(new File([lots.fr.word.blob], lots.fr.word.filename, { type: WORD }));
    if (lots.trad) {
      fichiers.push(new File([lots.trad.pdf.blob], lots.trad.pdf.filename, { type: PDF }));
      if (lots.trad.word) fichiers.push(new File([lots.trad.word.blob], lots.trad.word.filename, { type: WORD }));
    }
    return fichiers;
  }

  function feuilleEnvoi(lots) {
    const dests = destinatairesMail();
    const res = lots.fr.pdf, resWord = lots.fr.word;
    const t = lots.trad;
    const langueMail = t ? t.code : null;

    // Construction RFC 6068 de l'URL mailto : virgule (,) comme séparateur officiel
    let mailtoUrl = 'mailto:' + encodeURIComponent(dests.to.join(','));
    const mailtoParams = [];
    if (dests.cc.length) mailtoParams.push('cc=' + encodeURIComponent(dests.cc.join(',')));
    mailtoParams.push('subject=' + encodeURIComponent(Report.objetMail(R, S)));
    mailtoParams.push('body=' + encodeURIComponent(Report.corpsMail(R, S, langueMail)));
    mailtoUrl += '?' + mailtoParams.join('&');

    Ouvrir.ouvrir(null, `<div class="panel">
      <div class="grab"></div><h3>Envoyer le rapport</h3>
      <p class="sub">Le PDF a été généré pour transmission. Choisissez votre mode d'envoi :</p>
      ${t ? `<div class="sticky-note">Deux rapports : français + ${esc(I18N.natif(t.code))}${lots.partiel ? ' (commentaires laissés en français : traduction automatique indisponible)' : ''}</div>` : ''}

      <div style="background:#f1f5f9;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12.5px;line-height:1.5">
        <div><strong style="color:var(--c-brand)">À :</strong> ${esc(dests.toStr || 'aucun destinataire direct')}</div>
        <div style="margin-top:4px"><strong style="color:var(--c-brand)">Cc :</strong> ${esc(dests.ccStr || 'aucune copie')}</div>
      </div>

      <button class="menu-item" data-a="partager" style="background:#e0f2fe;border:1px solid #bae6fd"><span class="ico">${(ICO.send && ICO.send(18)) || ''}</span><span><strong>Partager le rapport (PDF joint)</strong><small>Gmail / Outlook — PDF joint automatiquement</small></span></button>
      <button class="menu-item" data-a="mailto"><span class="ico">${(ICO.mail && ICO.mail(18)) || ''}</span><span>Ouvrir l'application e-mail<small>À, Cc, objet et corps pré-remplis</small></span></button>
      <button class="menu-item" data-a="dl"><span class="ico">${(ICO.download && ICO.download(18)) || ''}</span><span>Télécharger le PDF${t ? ' (français)' : ''}</span></button>
      ${t ? `<button class="menu-item" data-a="dlt"><span class="ico">${(ICO.download && ICO.download(18)) || ''}</span><span>Télécharger le PDF (${esc(I18N.natif(t.code))})</span></button>` : ''}
      <button class="menu-item" data-a="dlw"><span class="ico">${(ICO.fileText && ICO.fileText(18)) || ''}</span><span>Télécharger la version Word${t ? ' (français)' : ''}</span></button>
      ${t && t.word ? `<button class="menu-item" data-a="dlwt"><span class="ico">${(ICO.fileText && ICO.fileText(18)) || ''}</span><span>Télécharger la version Word (${esc(I18N.natif(t.code))})</span></button>` : ''}
      <button class="menu-item" data-a="copier"><span class="ico">${(ICO.copy && ICO.copy(18)) || ''}</span><span>Copier le texte du message</span></button>
      <button class="btn grey wide" style="margin-top:10px" data-a="fermer">Fermer</button></div>`, (panneau) => {
      panneau.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-a]:not([data-a="fermer"])');
        if (!b) return;
        const a = b.dataset.a;
        if (a === 'partager') {
          if (navigator.share) {
            try {
              await navigator.share({ files: fichiersEnvoi(lots), title: Report.objetMail(R, S), text: Report.corpsMail(R, S, langueMail) });
              R.statut = 'transmis'; if (langueMail) R.langueEnvoyee = langueMail;
              planifier(); rendreTout();
              toast('Rapport partagé avec succès');
            } catch (err) {
              if (err && err.name !== 'AbortError') toast('Partage indisponible');
            }
          } else {
            toast('Partage natif indisponible : utilisez "Ouvrir l\'application e-mail"');
          }
        } else if (a === 'mailto') {
          // Téléchargement préalable du PDF pour qu'il soit dans Téléchargements
          telecharger(res.blob, res.filename);
          toast('PDF téléchargé : pensez à l\'attacher dans votre messagerie', 3400);
          setTimeout(() => { window.location.href = mailtoUrl; }, 300);
        } else if (a === 'dl') telecharger(res.blob, res.filename);
        else if (a === 'dlt' && t) telecharger(t.pdf.blob, t.pdf.filename);
        else if (a === 'dlw' && resWord) telecharger(resWord.blob, resWord.filename);
        else if (a === 'dlwt' && t && t.word) telecharger(t.word.blob, t.word.filename);
        else if (a === 'copier') copier(Report.corpsMail(R, S, langueMail));
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
  function feuilleIdentite(premiereFois) {
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
        ['technicien.prenom', 'technicien.nom', 'technicien.fonction', 'technicien.tel', 'technicien.email']
          .forEach(k => { const el = $('[data-sk="' + k + '"]', pan); if (el) setPath(S, k, el.value.trim()); });
        if (!t.prenom && !t.nom) { toast('Indiquez au moins votre nom'); return; }
        Store.set(K.settings, S);
        /* Le rapport en cours suit le changement d'identité. */
        const nomApres = Report.nomComplet(t);
        if (!R.technicien || R.technicien === nomAvant) R.technicien = nomApres;
        e.target.closest('.sheet').remove();
        planifier(); rendreEntete(); rendreTout();
        toast('Bonjour ' + nomApres + ' — informations conservées', 3200);
      });
    });
    setTimeout(() => { const p = $('#technicien\.prenom', panneau) || panneau.querySelector('[data-sk="technicien.prenom"]'); if (p && !p.value) p.focus(); }, 80);
    return panneau;
  }

  /* ===================== Réglages ===================================== */
  function feuilleReglages() {
    const f = (cle, label, type) => `<div class="field"><label>${esc(label)}</label>
      <input type="${type || 'text'}" data-sk="${cle}" value="${esc(getPath(S, cle) || '')}"></div>`;
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
        <div class="grid2">${f('societe.lieuLettre', 'Ville de la lettre')}${f('societe.siege1', 'Adresse du siège (pied de page)')}</div>
        ${f('societe.siege2', 'Adresse du 2e site (pied de page)')}
        <p class="small">Vide = adresses du modèle : 1, rue du Jariel, 77120 Coulommiers — 50 allée des érables, 01150 Blyes.</p>
      </div>

      <div class="card"><h2>Liste clients</h2>
        <p class="small">${Clients.base().length
          ? `La liste du classeur « COORDONNÉES CLIENTS » est embarquée dans l'application
        (${Clients.base().length} client(s)) : tapez 3 lettres dans un rapport pour voir les correspondances.`
          : `Aucune liste n'est embarquée dans cette version de l'application : importez le fichier de la liste
        (export CSV du classeur ou JSON) — elle sera conservée dans ce téléphone et restera disponible hors connexion.`}
        Les téléphones, e-mails, logos et contacts saisis sur le terrain sont mémorisés sur ce téléphone
        (${Object.keys(Clients.memo()).length} fiche(s) enrichie(s)) et proposés la prochaine fois.</p>
        <div class="filebtn"><input type="file" id="clientsImport" accept=".csv,.json,text/csv,application/json">
          <label for="clientsImport">${(ICO.download && ICO.download(16)) || ''} Mettre à jour la liste (export CSV du classeur ou JSON)</label></div>
        <p class="small">Le fichier remplace la liste précédente ; il est conservé dans le téléphone et reste
        disponible hors connexion. Le même bouton sert à transmettre la liste à un collègue (le fichier se
        transmet par mail, messagerie ou Bluetooth).</p>
        <div class="btnrow">
          <button class="btn grey" data-a="clients-export">Exporter la liste actuelle</button>
          <button class="btn ghost" data-a="clients-reset">Revenir à la liste d'origine</button>
        </div>
      </div>

      <div class="card"><h2>Envoi du rapport</h2>
        ${f('mail.destinataireSAV', 'E-mail du responsable SAV', 'email')}
        ${f('mail.destinatairesCopie', 'Copie systématique (CC)', 'email')}
        <div class="agreement"><input type="checkbox" id="chkClient" ${S.mail.envoyerClient ? 'checked' : ''}><label for="chkClient">Envoyer aussi au client</label></div>
        <div class="agreement"><input type="checkbox" id="chkSAV" ${S.mail.envoyerSAV ? 'checked' : ''}><label for="chkSAV">Envoyer au responsable SAV</label></div>
        ${f('mail.objet', 'Objet du mail')}
        <label style="font-size:12.5px;font-weight:600">Corps du mail</label>
        <textarea id="setCorps" rows="8" style="width:100%">${esc(S.mail.corps || Report.defaultCorpsMail())}</textarea>
        <p class="small">Variables : {{numero}} {{client}} {{lieu}} {{contact}} {{date}} {{machine}} {{serie}} {{technicien}} {{societe}} {{debut}} {{fin}} {{duree}} {{nbEvenements}} {{nbSecurite}} {{nbUrgent}} {{nbHaute}} {{nbBasse}} {{nbInfo}} {{nbPhotos}} {{pointsCles}} {{resume}} {{actions}}</p>
      </div>

      <div class="card"><h2>Canevas du rapport (avancé)</h2>
        <p class="small">Le canevas décrit l'ordre des sections du rapport. Types acceptés : <code>synthese</code>, <code>evenements</code> (avec <code>categories</code>), <code>texte</code> (avec <code>champ</code> : actions, aPrevoir, resumeTechnicien, objet), <code>pieces</code>, <code>photos</code>, <code>signature</code>.</p>
        <textarea id="setCanevas" rows="12" style="width:100%;font-family:ui-monospace,monospace;font-size:12px">${esc(JSON.stringify(S.canevas, null, 1))}</textarea>
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
      $('#clientsImport', panneau).addEventListener('change', (ev) => {
        const fichier = ev.target.files && ev.target.files[0];
        if (!fichier) return;
        const lecteur = new FileReader();
        lecteur.onload = () => {
          const n = Clients.importer(lecteur.result);
          if (!n) { toast('Fichier illisible : attendu un CSV du classeur ou un JSON'); return; }
          toast(n + ' client(s) chargé(s) — disponible hors connexion', 3200);
          ev.target.closest('.sheet').remove();
          feuilleReglages();
        };
        lecteur.onerror = () => toast('Lecture impossible');
        lecteur.readAsText(fichier, 'utf-8');
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
        if (e.target.closest('[data-a="clients-export"]')) {
          const contenu = JSON.stringify({ clients: Clients.liste() }, null, 1);
          telecharger(new Blob([contenu], { type: 'application/json' }), 'clients-bfr-' + todayISO() + '.json');
          toast('Liste exportée'); return;
        }
        if (e.target.closest('[data-a="clients-reset"]')) {
          const message = Clients.embarques().length
            ? "Revenir à la liste clients embarquée dans l'application ?"
            : "Effacer la liste clients importée dans ce téléphone ?\nVous pourrez réimporter le fichier à tout moment.";
          if (!confirm(message + "\nLes données enrichies (téléphones, e-mails, logos saisis sur le terrain) sont conservées.")) return;
          Clients.revenirListeOrigine();
          toast('Liste d\'origine rétablie');
          e.target.closest('.sheet').remove(); feuilleReglages(); return;
        }
        const b = e.target.closest('[data-a="enregistrer"]');
        if (!b) return;
        ['societe.lieuLettre', 'societe.siege1', 'societe.siege2',
         'societe.nom', 'societe.sigle', 'societe.sigleSuffixe', 'societe.adresse', 'societe.cpVille', 'societe.tel',
         'societe.email', 'societe.siteWeb', 'societe.siret', 'societe.tva',
         'mail.destinataireSAV', 'mail.destinatairesCopie', 'mail.objet'
        ].forEach(k => { const el = $('[data-sk="' + k + '"]', panneau); if (el) setPath(S, k, el.value.trim()); });
        S.mail.corps = $('#setCorps', panneau).value;
        S.impression.mentionClient = $('#setMention', panneau).value;
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
      <div class="sticky-note" style="margin-top:4px">
        <strong>💡 Raccourci écran d'accueil Android :</strong><br>
        Une fois l'icône choisie, si le raccourci sur votre écran d'accueil ne se met pas à jour tout de suite :
        supprimez le raccourci actuel, puis touchez le menu <strong>⋮ de Chrome → "Ajouter à l'écran d'accueil"</strong> (ou "Installer l'application").
      </div>
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

  /* ===================== Menu ========================================= */
  function feuilleMenu() {
    const liste = Store.get(K.rapports, []);
    const ver = (typeof window !== 'undefined' && window.SAV_VERSION) || 'locale';
    Ouvrir.ouvrir(null, `<div class="panel">
      <div class="grab"></div><h3>Menu</h3>
      <p class="sub">Rapport N° ${esc(R.numero || '—')} — ${esc(R.client.nom || 'client non renseigné')}</p>
      <button class="menu-item" data-a="identite"><span class="ico">${(ICO.user && ICO.user(18)) || ''}</span><span>Mes informations<small>${esc(Report.nomComplet(S.technicien) || 'nom, téléphone, e-mail à renseigner')}</small></span></button>
      <button class="menu-item" data-a="icones"><span class="ico">${(ICO.palette && ICO.palette(18)) || (ICO.gear && ICO.gear(18)) || ''}</span><span>Icône de l'application<small>Changer l'icône sur l'écran d'accueil Android</small></span></button>
      <button class="menu-item" data-a="reglages"><span class="ico">${(ICO.gear && ICO.gear(18)) || ''}</span><span>Réglages<small>Société, envoi, canevas du rapport</small></span></button>
      <button class="menu-item" data-a="actualiser"><span class="ico">${(ICO.clock && ICO.clock(18)) || ''}</span><span>Actualiser l'application<small>Vider le cache et forcer la dernière version</small></span></button>
      <button class="menu-item" data-a="nouveau"><span class="ico">${(ICO.plus && ICO.plus(18)) || ''}</span><span>Nouvelle intervention<small>Le rapport en cours reste dans l'historique</small></span></button>
      <button class="menu-item" data-a="historique"><span class="ico">${(ICO.folder && ICO.folder(18)) || ''}</span><span>Rapports enregistrés (${liste.length})</span></button>
      <button class="menu-item" data-a="export"><span class="ico">${(ICO.package && ICO.package(18)) || ''}</span><span>Exporter la sauvegarde (JSON)</span></button>
      <button class="menu-item" data-a="import"><span class="ico">${(ICO.download && ICO.download(18)) || ''}</span><span>Importer une sauvegarde</span></button>
      <button class="menu-item" data-a="aide"><span class="ico">${(ICO.help && ICO.help(18)) || ''}</span><span>Mode d'emploi</span></button>
      <div class="sticky-note" style="margin-top:8px">${Store.ok ? 'Tout est conservé sur ce téléphone — rien n\'est envoyé sans votre accord.' : 'Stockage local indisponible : pensez à exporter votre travail.'}</div>
      <div style="text-align:center;font-size:11px;color:#64748b;margin:10px 0 4px 0;padding:6px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0">Version active : <strong>${esc(ver)}</strong> (23/09/2026)</div>
      <button class="btn grey wide" style="margin-top:10px" data-a="fermer">Fermer</button></div>`, (panneau) => {
      panneau.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]:not([data-a="fermer"])');
        if (!b) return;
        const a = b.dataset.a;
        e.target.closest('.sheet').remove();
        if (a === 'identite') feuilleIdentite();
        else if (a === 'icones') feuilleIcones();
        else if (a === 'reglages') feuilleReglages();
        else if (a === 'actualiser') actualiserApp();
        else if (a === 'nouveau') {
          if (!confirm('Créer une nouvelle intervention ?')) return;
          sauver(true); R = nouvelleIntervention(); Cache.pdf = Cache.docx = null; Cache.clePdf = Cache.cleDocx = Cache.cleTrad = '';
          Store.set(K.rapport, R); rendreTout(); toast('Nouvelle intervention — N° ' + R.numero);
        } else if (a === 'historique') feuilleHistorique();
        else if (a === 'aide') feuilleAide();
        else if (a === 'export') {
          telecharger(new Blob([JSON.stringify({ version: 3, exporte: new Date().toISOString(), reglages: S, rapport: R, rapports: Store.get(K.rapports, []) }, null, 1)], { type: 'application/json' }),
            'sauvegarde_rapports_' + todayISO() + '.json');
          toast('Sauvegarde exportée');
        } else if (a === 'import') {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = '.json,application/json';
          inp.onchange = () => {
            const f = inp.files[0]; if (!f) return;
            const r = new FileReader();
            r.onload = () => {
              try {
                const d = JSON.parse(r.result);
                if (d.reglages) { S = fusion(settingsDefaut, d.reglages); Store.set(K.settings, S); }
                if (Array.isArray(d.rapports)) Store.set(K.rapports, d.rapports);
                if (d.rapport) R = fusion(nouvelleIntervention(), d.rapport);
                rendreTout(); toast('Sauvegarde importée');
              } catch (err) { toast('Fichier invalide'); }
            };
            r.readAsText(f);
          };
          inp.click();
        }
      });
    });
  }

  function feuilleHistorique() {
    const liste = Store.get(K.rapports, []);
    Ouvrir.ouvrir(null, `<div class="panel">
      <div class="grab"></div><h3>Rapports enregistrés</h3>
      <p class="sub">${liste.length} rapport(s) sur ce téléphone.</p>
      ${liste.map(r => `<div class="menu-item" style="flex-direction:column;align-items:stretch;gap:6px">
        <div style="display:flex;justify-content:space-between;gap:8px">
          <strong>${esc(r.numero || '—')} — ${esc((r.client && r.client.nom) || 'client ?')}</strong>
          <span class="pill">${esc(r.statut || 'brouillon')}</span></div>
        <div class="small">${esc(Report.frDate(r.date))} • ${esc((r.machine && r.machine.designation) || '')} • ${(r.evenements || []).length} évènement(s)</div>
        <div class="btnrow"><button class="btn sm grey" data-ouvrir="${r.id}">Rouvrir</button>
          <button class="btn sm danger" data-suppr="${r.id}">Supprimer</button></div></div>`).join('') || '<p class="small">Aucun rapport enregistré.</p>'}
      <button class="btn grey wide" data-a="fermer">Fermer</button></div>`, (panneau) => {
      panneau.addEventListener('click', (e) => {
        const sup = e.target.closest('[data-suppr]');
        const ouv = e.target.closest('[data-ouvrir]');
        if (sup) {
          if (!confirm('Supprimer définitivement ce rapport ?')) return;
          Store.set(K.rapports, Store.get(K.rapports, []).filter(x => x.id !== sup.dataset.suppr));
          e.target.closest('.sheet').remove(); feuilleHistorique();
        } else if (ouv) {
          const r = Store.get(K.rapports, []).find(x => x.id === ouv.dataset.ouvrir);
          if (!r || !confirm('Rouvrir ce rapport ? Le rapport en cours sera conservé au préalable.')) return;
          sauver(true);
          R = fusion(nouvelleIntervention(), r);
          Cache.pdf = Cache.docx = null; Cache.clePdf = Cache.cleDocx = Cache.cleTrad = '';
          Store.set(K.rapport, R);
          e.target.closest('.sheet').remove(); rendreTout();
          toast('Rapport ' + R.numero + ' chargé');
        }
      });
    });
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
      <p class="small"><strong>Version de l'application :</strong> <span id="versionAppli">${self.SAV_VERSION || 'non versionnée'}</span> — si l'application ne se met pas à jour, ce numéro (au support) dit quelle version tourne sur ce téléphone.</p>
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
      if (t.dataset && t.dataset.k) { setPath(R, t.dataset.k, t.value); planifier(); rendreTout(); }
    });

    document.addEventListener('click', (e) => {
      const carte = e.target.closest('[data-ev]');
      if (carte) { editerEvenement(carte.dataset.ev); return; }
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'chrono-demarrer') demarrerChrono();
      else if (a === 'chrono-pause') basculerPause();
      else if (a === 'chrono-terminer') terminerChrono();
      else if (a === 'chrono-ajuster') feuilleAjusterChrono();
      else if (a === 'ajouter-ev') ajouterEvenement();
      else if (a === 'editer-client') feuilleClient();
      else if (a === 'ajouter-piece') feuillePiece();
      else if (a === 'editer-piece') {
        const id = b.dataset.id;
        const pc = (R.pieces || []).find(p => p.id === id);
        if (pc) feuillePiece(pc);
      }
      else if (a === 'supprimer-piece') {
        const id = b.dataset.id;
        const idx = (R.pieces || []).findIndex(p => p.id === id);
        if (idx >= 0 && confirm('Supprimer cette pièce de rechange ?')) {
          R.pieces.splice(idx, 1);
          planifier(); rendreTout();
          toast('Pièce supprimée');
        }
      }
      else if (a === 'signer') signerClient();
      else if (a === 'effacer-signature') {
        if (!confirm('Effacer la signature du client ?')) return;
        R.signatureClient = { nom: '', fonction: '', dataUrl: '', date: '', heure: '' };
        R.statut = R.chrono.fin ? 'terminé' : R.statut;
        planifier(); rendreTout();
      }
      else if (a === 'soumettre') soumettre();
      else if (a === 'apercu') apercuPDF();
      else if (a === 'word') docx().then(res => { telecharger(res.blob, res.filename); toast('Version Word enregistrée'); });
      else if (a === 'menu') feuilleMenu();
      else if (a === 'identite') feuilleIdentite();
      else if (a === 'photos-libres') feuillePhotosLibres();
    });

    $('#btnAjouter').addEventListener('click', ajouterEvenement);
    $('#btnSigner').addEventListener('click', signerClient);
    $('#btnSoumettre').addEventListener('click', soumettre);
    $('#btnMenu').addEventListener('click', feuilleMenu);

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
        const min = (hf * 60 + mf) - (hd * 60 + md) - (Number(j.pauseMinutes) || 0);
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
          R.photosLibres.push({ dataUrl: dataUrl, legende: '', annotations: [] });
        }
        planifier(); e.target.closest('.sheet').remove(); feuillePhotosLibres();
      });
    });
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
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
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
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();

  window.APP = {
    get rapport() { return R; }, get reglages() { return S; },
    pdf: pdf, docx: docx, rendreTout: rendreTout, toast: toast,
    destinatairesMail: destinatairesMail, destinataires: destinataires,
    feuilleMenu: feuilleMenu, feuilleIcones: feuilleIcones, soumettre: soumettre,
    actualiserApp: actualiserApp
  };
})();
