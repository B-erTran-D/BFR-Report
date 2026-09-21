/* =========================================================================
   wizard.js — Assistant « Ajouter un évènement » en 4 étapes
     1. Domaine   : Mécanique / Électrique / Automatisme
     2. Annotation: texte écrit ou dicté (+ relecture vocale)
     3. Photo     : prise de vue puis annotation au doigt
     4. Catégorie : Sécurité / Urgent / Priorité haute / basse / Informatif
   L'évènement est enregistré dès la première étape et reste modifiable :
   on peut rouvrir l'assistant à tout moment, rien n'est perdu.
   ========================================================================= */
(function (global) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  class Assistant {
    constructor(evenement, ctx) {
      this.ev = evenement;
      this.ctx = ctx || {};
      this.S = this.ctx.reglages || {};
      /* Réouverture : on revient directement sur l'annotation si le domaine est déjà
         choisi (c'est ce qu'on corrige le plus souvent) ; « ← Retour » ramène au domaine. */
      this.etape = evenement.domaine ? 2 : 1;
      this.reconnaissance = null;
      this.ecoute = false;
      this.ouvrir();
    }

    domaines() { return this.S.domaines || []; }
    categories() { return this.S.categories || []; }

    ouvrir() {
      const overlay = document.createElement('div');
      overlay.className = 'assistant';
      overlay.innerHTML = `
        <div class="assistant-bar">
          <button type="button" class="iconbtn" data-a="fermer">✕</button>
          <div class="assistant-titre">Évènement</div>
          <button type="button" class="btn sm" data-a="enregistrer">Enregistrer</button>
        </div>
        <div class="assistant-progres" id="assistantProgres"></div>
        <div class="assistant-corps" id="assistantCorps"></div>
        <div class="assistant-nav" id="assistantNav"></div>`;
      document.body.appendChild(overlay);
      this.overlay = overlay;
      this.corps = overlay.querySelector('#assistantCorps');

      overlay.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]');
        if (b) {
          const a = b.dataset.a;
          if (a === 'fermer') this.fermer();
          else if (a === 'enregistrer') this.enregistrer();
          else if (a === 'suivant') this.aller(this.etape + 1);
          else if (a === 'retour') this.aller(this.etape - 1);
          else if (a === 'supprimer') this.supprimer();
          else if (a === 'photo') this.prendrePhoto();
          else if (a === 'photo-lib') this.photoBibliotheque();
          else if (a === 'dictee') this.basculerDictee();
          else if (a === 'relire') this.relire();
          return;
        }
        const d = e.target.closest('[data-domaine]');
        if (d) {
          this.ev.domaine = d.dataset.domaine;
          if (!this.ev.heure) this.ev.heure = new Date().toISOString();
          this.maj(); this.aller(2);
          return;
        }
        const c = e.target.closest('[data-categorie]');
        if (c) {
          this.ev.categorie = c.dataset.categorie;
          this.ev.heure = this.ev.heure || new Date().toISOString();
          this.maj();
          this.toast('Évènement enregistré');
          this.fermer();
          return;
        }
        const p = e.target.closest('[data-annot]');
        if (p) {
          const photo = this.ev.photos[+p.dataset.annot];
          const self = this;
          Annotation.ouvrir(photo, {
            fin: function (valide) {
              if (valide) { self.maj(); }
              self.rendre();
            }
          });
          return;
        }
        const rm = e.target.closest('[data-retirer-photo]');
        if (rm) { this.ev.photos.splice(+rm.dataset.retirerPhoto, 1); this.maj(); this.rendre(); return; }
      });

      // saisie de texte : sauvegarde à chaque frappe (rien n'est perdu)
      overlay.addEventListener('input', (e) => {
        if (e.target.id === 'evTexte') {
          this.ev.texte = e.target.value;
          this.maj();
        }
      });

      this.rendre();
    }

    toast(msg) { if (this.ctx.toast) this.ctx.toast(msg); }

    maj() { if (this.ctx.onMaj) this.ctx.onMaj(this.ev); }

    enregistrer() {
      if (!this.ev.domaine) { this.aller(1); this.toast('Choisissez d\'abord le domaine'); return; }
      if (!this.ev.categorie) this.ev.categorie = 'INFO';
      this.ev.heure = this.ev.heure || new Date().toISOString();
      this.maj();
      this.toast('Évènement enregistré');
      this.fermer();
    }

    supprimer() {
      if (!confirm('Supprimer cet évènement ?')) return;
      if (this.ctx.onSupprimer) this.ctx.onSupprimer(this.ev);
      this.fermer();
    }

    fermer() {
      this.arreterDictee();
      this.overlay.remove();
      if (this.ctx.onFermer) this.ctx.onFermer(this.ev);
    }

    aller(n) {
      if (n < 1 || n > 4) return;
      if (n === 3 && !this.ev.domaine) { this.toast('Choisissez d\'abord le domaine'); return; }
      this.etape = n;
      this.rendre();
    }

    /* ---------- rendu ---------- */
    rendre() {
      this.overlay.querySelector('#assistantProgres').innerHTML = [1, 2, 3, 4].map(function (i) {
        const cls = ['pas'];
        if (i < this.etape) cls.push('fait');
        if (i === this.etape) cls.push('actif');
        return `<span class="${cls.join(' ')}"></span>`;
      }, this).join('') + `<span class="pas-libelle">Étape ${this.etape}/4 — ${
        ['Domaine', 'Annotation', 'Photo', 'Catégorie'][this.etape - 1]}</span>`;

      const rendus = { 1: () => this.etapeDomaine(), 2: () => this.etapeAnnotation(), 3: () => this.etapePhoto(), 4: () => this.etapeCategorie() };
      this.corps.innerHTML = rendus[this.etape]();

      const nav = [];
      if (this.etape > 1) nav.push('<button class="btn grey" data-a="retour">← Retour</button>');
      if (this.etape < 4) nav.push('<button class="btn" data-a="suivant">Suivant →</button>');
      else nav.push('<button class="btn or" data-a="enregistrer">✔ Terminer</button>');
      if (this.ev.domaine) nav.push('<button class="btn danger" data-a="supprimer">Supprimer</button>');
      this.overlay.querySelector('#assistantNav').innerHTML = nav.join('');
      this.corps.scrollTop = 0;
    }

    etapeDomaine() {
      const d = this.domaineCourant();
      return `<p class="assistant-question">Sur quel domaine porte cet évènement ?</p>
        <div class="domaines">
          ${this.domaines().map(function (x) {
            return `<button type="button" class="domaine${(d && d.id === x.id) ? ' on' : ''}" data-domaine="${esc(x.id)}">
              <span class="ico">${esc(x.icone || '🔧')}</span><span class="lib">${esc(x.libelle)}</span></button>`;
          }).join('')}
        </div>
        ${d ? `<p class="assistant-note">Domaine choisi : <strong>${esc(d.libelle)}</strong></p>` : ''}`;
    }

    etapeAnnotation() {
      const ev = this.ev;
      const dispo = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      return `<p class="assistant-question">Que constatez-vous ?</p>
        <p class="assistant-note">Écrivez, ou dictez à voix haute : le texte est ajouté automatiquement.</p>
        <textarea id="evTexte" class="ev-texte" rows="7" placeholder="Ex. Courroie d'entraînement détendue : flèche mesurée 12 mm pour 8 mm maximum. Traces de patinage et gomme sur la poulie. Bruit caractéristique au démarrage.">${esc(ev.texte || '')}</textarea>
        <div class="btnrow" style="margin-top:10px">
          <button class="btn ${this.ecoute ? 'or' : 'ghost'}" data-a="dictee">${this.ecoute ? '⏹️ Arrêter la dictée' : '🎤 Dicter'}</button>
          <button class="btn ghost" data-a="relire" ${ev.texte ? '' : 'disabled'}>🔊 Relire</button>
        </div>
        ${dispo ? '' : '<p class="assistant-note">Dictée indisponible sur ce navigateur : utilisez le micro du clavier (bouton 🎤 de votre clavier Android).</p>'}`;
    }

    etapePhoto() {
      const ev = this.ev;
      return `<p class="assistant-question">Ajouter une photo</p>
        <p class="assistant-note">Prenez la photo puis annotez-la au doigt (flèche, cercle, texte) pour montrer précisément la zone concernée.</p>
        <div class="btnrow">
          <button class="btn" data-a="photo">📷 Prendre une photo</button>
          <button class="btn ghost" data-a="photo-lib">🖼️ Galerie</button>
        </div>
        <input type="file" id="evPhotoInput" accept="image/*" capture="environment" hidden>
        <input type="file" id="evPhotoLib" accept="image/*" multiple hidden>
        <div class="ev-photos">
          ${(ev.photos || []).map(function (p, i) {
            return `<div class="ev-photo">
              <img src="${p.dataUrl}" alt="photo ${i + 1}">
              <button type="button" class="ev-photo-annot" data-annot="${i}">✏️ Annoter</button>
              <button type="button" class="ev-photo-rm" data-retirer-photo="${i}">✕</button>
              ${(p.annotations && p.annotations.length) ? '<span class="ev-photo-badge">annotée</span>' : ''}
            </div>`;
          }).join('') || '<p class="assistant-note">Aucune photo pour l\'instant — vous pouvez continuer sans photo.</p>'}
        </div>`;
    }

    etapeCategorie() {
      const cats = this.categories(), choisi = this.ev.categorie;
      return `<p class="assistant-question">Comment qualifier cet évènement ?</p>
        <p class="assistant-note">Cette catégorie détermine la place de l'évènement dans le rapport : les problèmes de sécurité et les urgences apparaissent en premier.</p>
        <div class="categories">
          ${cats.map(function (c) {
            return `<button type="button" class="categorie${choisi === c.id ? ' on' : ''}" data-categorie="${esc(c.id)}"
              style="--c:${c.couleur};--f:${c.fond}">
              <span class="ico">${esc(c.icone || '•')}</span>
              <span class="lib">${esc(c.libelle)}</span>
              <span class="fleche">${choisi === c.id ? '✔' : '›'}</span></button>`;
          }).join('')}
        </div>
        <div class="ev-recap">
          <div class="ev-recap-ligne"><span>Domaine</span><strong>${esc(this.libelleDomaine())}</strong></div>
          <div class="ev-recap-ligne"><span>Annotation</span><strong>${this.ev.texte ? this.ev.texte.length + ' caractère(s)' : 'vide'}</strong></div>
          <div class="ev-recap-ligne"><span>Photos</span><strong>${(this.ev.photos || []).length}</strong></div>
        </div>`;
    }

    domaineCourant() { return this.domaines().find(x => x.id === this.ev.domaine); }
    libelleDomaine() { const d = this.domaineCourant(); return d ? d.libelle : '—'; }

    /* ---------- photo ---------- */
    prendrePhoto() { this.choisirFichier('#evPhotoInput', false); }
    photoBibliotheque() { this.choisirFichier('#evPhotoLib', true); }

    choisirFichier(selecteur, multiple) {
      const input = this.overlay.querySelector(selecteur);
      input.multiple = multiple;
      input.value = '';
      const self = this;
      input.onchange = async function () {
        const fichiers = Array.prototype.slice.call(input.files || []);
        if (!fichiers.length) return;
        for (const f of fichiers) {
          if ((self.ev.photos || []).length >= 4) { self.toast('4 photos maximum par évènement'); break; }
          try {
            const dataUrl = await self.compresser(f, 1600, 0.82);
            const photo = { id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6), dataUrl: dataUrl, annotations: [] };
            self.ev.photos = self.ev.photos || [];
            self.ev.photos.push(photo);
            self.maj();
            // on enchaîne directement sur l'annotation de la photo qui vient d'être prise
            await new Promise(function (resolve) {
              Annotation.ouvrir(photo, { fin: function (valide) { if (valide) self.maj(); resolve(); } });
            });
          } catch (e) { self.toast('Photo ignorée (format non pris en charge)'); }
        }
        self.rendre();
      };
      input.click();
    }

    compresser(file, maxDim, q) {
      return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () {
          const img = new Image();
          img.onload = function () {
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * scale);
            c.height = Math.round(img.height * scale);
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0, c.width, c.height);
            resolve(c.toDataURL('image/jpeg', q));
          };
          img.onerror = reject;
          img.src = reader.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    /* ---------- dictée / relecture ---------- */
    basculerDictee() {
      if (this.ecoute) { this.arreterDictee(); this.rendre(); return; }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { this.toast('Dictée non disponible : utilisez le micro du clavier'); return; }
      const rec = new SR();
      rec.lang = 'fr-FR';
      rec.continuous = true;
      rec.interimResults = true;
      const self = this;
      const champ = this.corps.querySelector('#evTexte');
      let base = (self.ev.texte || '') ? self.ev.texte.replace(/\s+$/, '') + ' ' : '';
      rec.onresult = function (e) {
        let final = '', provisoire = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += t; else provisoire += t;
        }
        if (final) base += final;
        self.ev.texte = base + provisoire;
        if (champ) { champ.value = self.ev.texte; champ.scrollTop = champ.scrollHeight; }
        self.maj();
      };
      rec.onerror = function () { self.arreterDictee(); self.rendre(); };
      rec.onend = function () { if (self.ecoute) { self.ecoute = false; self.rendre(); } };
      try { rec.start(); } catch (e) { self.toast('Micro indisponible'); return; }
      this.reconnaissance = rec;
      this.ecoute = true;
      this.toast('Dictée en cours… parlez');
      this.rendre();
      const champApres = this.corps.querySelector('#evTexte');
      if (champApres) champApres.focus();
    }

    arreterDictee() {
      if (this.reconnaissance) { try { this.reconnaissance.stop(); } catch (e) {} }
      this.reconnaissance = null;
      this.ecoute = false;
    }

    relire() {
      if (!this.ev.texte) { this.toast('Rien à relire'); return; }
      if (!('speechSynthesis' in window)) { this.toast('Relecture vocale indisponible'); return; }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(this.ev.texte);
      u.lang = 'fr-FR';
      u.rate = 1;
      window.speechSynthesis.speak(u);
      this.toast('Relecture vocale…');
    }
  }

  global.Assistant = {
    ouvrir: function (evenement, ctx) { return new Assistant(evenement, ctx); },
    nouvelEvenement: function () {
      return { id: 'e' + Date.now() + Math.random().toString(36).slice(2, 6), domaine: '', texte: '', photos: [], categorie: '', heure: new Date().toISOString() };
    }
  };
})(window);
