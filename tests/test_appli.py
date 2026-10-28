"""Tests automatiques de l'application « Fiche d'intervention SAV ».

Ils ouvrent l'application construite (docs/) dans un vrai navigateur (Chromium,
format téléphone) et rejouent les gestes du terrain : identité, intervention,
évènements avec photos, pièce, signature, rapport PDF et Word, historique…

Lancement (après `python build.py --sans-liste`) :
    pip install playwright pypdf
    python -m playwright install --with-deps chromium
    python tests/test_appli.py

Code de sortie 0 = tout est bon ; 1 = au moins un test a échoué (la GitHub
Action ne publie alors pas la nouvelle version).
"""
import asyncio
import base64
import functools
import html
import http.server
import io
import json
import os
import re
import sys
import threading
import traceback
import zipfile

from playwright.async_api import async_playwright
from pypdf import PdfReader

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.environ.get('BFR_SITE') or os.path.join(RACINE, 'docs')
PHOTOS = os.path.join(RACINE, 'tests', 'photos')
SORTIE = os.path.join(RACINE, 'tests', 'resultats')

# Clique tout seul « Confirmer » dans les boîtes de dialogue intégrées de l'appli.
AUTO_CONFIRMATION = """
setInterval(function () {
  var b = document.querySelector && document.querySelector('.dlg-fond [data-r="oui"]');
  if (b && !b.dataset.auto) { b.dataset.auto = '1'; setTimeout(function () { b.click(); }, 60); }
}, 100);
"""


# --------------------------------------------------------------------------
# Serveur web local sur docs/
# --------------------------------------------------------------------------
def demarrer_serveur():
    class Silencieux(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    gestion = functools.partial(Silencieux, directory=SITE)
    serveur = http.server.ThreadingHTTPServer(('127.0.0.1', 0), gestion)
    threading.Thread(target=serveur.serve_forever, daemon=True).start()
    return serveur, 'http://127.0.0.1:%d/' % serveur.server_address[1]


# --------------------------------------------------------------------------
# Gestes de base
# --------------------------------------------------------------------------
class Telephone:
    """Un téléphone neuf (contexte de navigateur vierge) avec l'appli ouverte."""

    def __init__(self, navigateur, adresse):
        self.navigateur, self.adresse = navigateur, adresse
        self.erreurs, self.dialogues_natifs = [], []

    async def ouvrir(self):
        self.ctx = await self.navigateur.new_context(
            viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
            locale='fr-FR', accept_downloads=True)
        await self.ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        await self.ctx.route('https://fonts.gstatic.com/**', lambda r: r.abort())
        await self.ctx.add_init_script(AUTO_CONFIRMATION)
        self.pg = await self.ctx.new_page()
        self.pg.on('pageerror', lambda e: self.erreurs.append(str(e)))
        self.pg.on('dialog', lambda d: (self.dialogues_natifs.append(d.message), asyncio.ensure_future(d.dismiss())))
        await self.pg.goto(self.adresse, wait_until='networkidle')
        return self

    async def fermer(self):
        await self.ctx.close()

    async def fermer_feuilles(self):
        await self.pg.evaluate('() => document.querySelectorAll(".sheet").forEach(s => s.remove())')

    async def identite(self, prenom='Romuald', nom='TEST'):
        pg = self.pg
        await pg.wait_for_selector('.sheet.open [data-sk="technicien.prenom"]', timeout=8000)
        await pg.fill('[data-sk="technicien.prenom"]', prenom)
        await pg.fill('[data-sk="technicien.nom"]', nom)
        await pg.click('.sheet.open [data-a="ok"]')
        await pg.wait_for_timeout(500)

    async def menu(self, action):
        await self.fermer_feuilles()
        await self.pg.click('#btnMenu')
        await self.pg.wait_for_timeout(300)
        await self.pg.click('.sheet.open [data-a="%s"]' % action)
        await self.pg.wait_for_timeout(600)

    async def client(self, nom='ACME Industrie'):
        pg = self.pg
        await self.fermer_feuilles()
        await pg.click('[data-a="editer-client"] >> nth=0')
        await pg.wait_for_timeout(400)
        await pg.fill('#cliRecherche', nom)
        for cle, val in {'client.contact': 'M. Rivière', 'client.email': 'contact@exemple.fr',
                         'machine.designation': 'Presse 120 T', 'machine.serie': 'SN-0387'}.items():
            await pg.fill('.sheet.open [data-fk="%s"]' % cle, val)
        await pg.click('.sheet.open [data-a="ok"]')
        await pg.wait_for_timeout(400)
        await self.fermer_feuilles()

    async def evenement(self, texte, photos=(), categorie=None, nature=None, resultat=None, corrige=False):
        """Ajoute un évènement. nature : 'travail' ou 'constat' (sinon celle proposée
        par l'appli ; une catégorie donnée implique un constat)."""
        pg = self.pg
        if nature is None and categorie is not None:
            nature = 'constat'
        await self.fermer_feuilles()
        await pg.click('#btnAjouter')
        await pg.wait_for_timeout(300)
        if nature:
            await pg.click('[data-nature="%s"]' % nature)
            await pg.wait_for_timeout(150)
        await pg.click('[data-domaine] >> nth=0')
        await pg.wait_for_timeout(200)
        await pg.fill('#evTexte', texte)
        await pg.click('.assistant-nav [data-a="suivant"]')
        await pg.wait_for_timeout(300)
        if photos:
            async with pg.expect_file_chooser() as fc:
                await pg.click('[data-a="photo-lib"]')
            await (await fc.value).set_files([os.path.join(PHOTOS, p) for p in photos])
            for _ in photos:   # l'éditeur d'annotation s'ouvre pour chaque photo
                await pg.wait_for_selector('[data-a="valider"]:visible', timeout=10000)
                await pg.click('[data-a="valider"]:visible')
                await pg.wait_for_timeout(500)
        await pg.click('.assistant-nav [data-a="suivant"]')
        await pg.wait_for_timeout(200)
        if resultat and await pg.query_selector('[data-resultat="%s"]' % resultat):
            await pg.click('[data-resultat="%s"]' % resultat)
            await pg.wait_for_timeout(200)
        if corrige and await pg.query_selector('#evCorrige'):
            await pg.check('#evCorrige')
            await pg.wait_for_timeout(100)
        cats = await pg.query_selector_all('[data-categorie]')
        if cats and categorie is not None:
            await cats[min(categorie, len(cats) - 1)].click()
            await pg.wait_for_timeout(200)
        if await pg.query_selector('.assistant-bar'):
            await pg.click('.assistant-bar [data-a="enregistrer"]')
        await pg.wait_for_timeout(500)

    async def images_affichees(self):
        return await self.pg.evaluate(
            '() => [...document.images].filter(i => i.src.startsWith("data:image/jpeg")).length')

    async def rapport_stocke(self):
        return await self.pg.evaluate('() => JSON.parse(localStorage["sav3.rapport"] || "{}")')

    async def telecharger(self, selecteur):
        async with self.pg.expect_download(timeout=30000) as dl:
            await self.pg.click(selecteur)
        d = await dl.value
        os.makedirs(SORTIE, exist_ok=True)
        chemin = os.path.join(SORTIE, d.suggested_filename)
        await d.save_as(chemin)
        return chemin


def verifier(condition, message):
    if not condition:
        raise AssertionError(message)


# --------------------------------------------------------------------------
# Tests
# --------------------------------------------------------------------------
async def test_identite_et_numeros(nav, adresse):
    """On ne démarre pas sans nom ; numéro = initiales-AAMMJJ-NN, unique."""
    t = await Telephone(nav, adresse).ouvrir()
    pg = t.pg
    await pg.wait_for_selector('.sheet.open', timeout=8000)
    await pg.click('.sheet.open [data-a="fermer"]')          # « Plus tard »
    await pg.wait_for_timeout(400)
    await pg.click('[data-a="chrono-demarrer"]')
    await pg.wait_for_timeout(500)
    verifier(await pg.query_selector('.sheet.open [data-sk="technicien.code"]'),
             'la fiche « Mes informations » doit s\'ouvrir avant de démarrer')
    verifier(not await pg.query_selector('[data-a="chrono-pause"]'), 'le chrono ne doit pas démarrer sans nom')
    await t.identite()
    verifier(await pg.query_selector('[data-a="chrono-pause"]'), 'le chrono doit démarrer après l\'identité')
    await pg.wait_for_timeout(1000)
    n1 = (await t.rapport_stocke()).get('numero', '')
    verifier(re.match(r'^RT-\d{6}-01$', n1), 'numéro attendu RT-AAMMJJ-01, obtenu %r' % n1)
    await t.evenement('Premier constat')
    await t.menu('nouveau')
    n2 = (await t.rapport_stocke()).get('numero', '')
    verifier(n2 == n1[:-2] + '02', 'nouvelle intervention : %r attendu, %r obtenu' % (n1[:-2] + '02', n2))
    await t.fermer()
    return t


async def test_photos_conservees(nav, adresse):
    """Les photos des rapports de l'historique reviennent à la réouverture."""
    t = await Telephone(nav, adresse).ouvrir()
    await t.identite()
    for k in range(3):
        await t.evenement('Rapport %d' % k, ['paysage-1.jpg', 'portrait.jpg'])
        if k < 2:
            await t.menu('nouveau')
    await t.pg.reload(wait_until='networkidle')
    await t.pg.wait_for_timeout(1500)
    await t.fermer_feuilles()
    verifier(await t.images_affichees() >= 2, 'photos du rapport en cours absentes après rechargement')
    for k in range(3):
        await t.menu('historique')
        boutons = await t.pg.query_selector_all('[data-ouvrir]')
        verifier(len(boutons) == 3, '3 rapports attendus dans l\'historique, %d trouvés' % len(boutons))
        await boutons[k].click()
        await t.pg.wait_for_timeout(1500)
        verifier(await t.images_affichees() >= 2, 'rapport %d rouvert sans ses photos' % k)
    # l'enregistrement en base est léger (images rangées à part)
    tailles = await t.pg.evaluate('''() => new Promise(res => {
      const q = indexedDB.open("bfr_sav_v3");
      q.onsuccess = () => { const rq = q.result.transaction(["rapports"]).objectStore("rapports").getAll();
        rq.onsuccess = () => res(rq.result.map(r => JSON.stringify(r).length)); };
    })''')
    verifier(tailles and max(tailles) < 100000, 'rapports en base trop lourds (photos non séparées) : %s' % tailles)
    # copie de secours de l'historique (localStorage) sans les photos : elle ne remplit plus les 5 Mo
    await t.pg.wait_for_timeout(1200)
    photos_locales = await t.pg.evaluate('''() => (localStorage["sav3.rapports"] || "").split("data:image/jpeg").length - 1''')
    verifier(photos_locales == 0, 'l\'historique du localStorage contient encore %d photo(s)' % photos_locales)
    await t.fermer()
    return t


async def test_rapport_pdf_et_word(nav, adresse):
    """Rapport complet : numérotation continue, mise en page selon les photos, Word valide."""
    t = await Telephone(nav, adresse).ouvrir()
    pg = t.pg
    await t.identite()
    await t.client()
    await t.evenement('Courroie détendue, sans photo.', [], 0)
    await t.evenement('Fuite sur le vérin, une photo.', ['paysage-1.jpg'], 0)
    await t.evenement('Carter fissuré, deux photos.', ['paysage-2.jpg', 'portrait.jpg'], 1)
    # pièce rattachée à la machine, avec sa photo
    await t.fermer_feuilles()
    await pg.click('#btnAjouterPiece')
    await pg.wait_for_timeout(300)
    await pg.fill('#pcDenom', 'Joint de vérin')
    await pg.fill('#pcRef', 'JV-42')
    await pg.set_input_files('#pcPhotoGal', os.path.join(PHOTOS, 'portrait.jpg'))
    await pg.wait_for_timeout(1200)
    await pg.click('[data-a="sauvegarder-piece"]')
    await pg.wait_for_timeout(500)
    verifier(await pg.query_selector('#cardPieces img'), 'la photo de la pièce n\'apparaît pas dans l\'écran')
    await pg.select_option('[data-k="travauxTermines"]', 'Partiellement')
    await pg.wait_for_timeout(1000)
    chemin_docx = await t.telecharger('[data-a="word"] >> visible=true >> nth=0')
    await pg.click('[data-a="soumettre"] >> visible=true >> nth=0')   # confirmations auto
    await pg.wait_for_selector('[data-a="dl"]', timeout=30000)
    chemin_pdf = await t.telecharger('[data-a="dl"] >> visible=true')
    # « Travaux terminés » survit à la correction automatique faite à la soumission
    await pg.wait_for_timeout(1000)
    verifier((await t.rapport_stocke()).get('travauxTermines') == 'Partiellement',
             'Travaux terminés modifié à la soumission : %r' % (await t.rapport_stocke()).get('travauxTermines'))
    await t.fermer_feuilles()
    verifier(await pg.input_value('[data-k="travauxTermines"]') == 'Partiellement',
             'la liste « Travaux terminés » ne montre plus le choix après la soumission')

    texte = '\n'.join(page.extract_text() or '' for page in PdfReader(chemin_pdf).pages)
    numeros = [int(n) for n in re.findall(r'(?m)^\s*(\d+)\. [A-ZÉÈ]', texte)]
    uniques = sorted(set(numeros))
    verifier(uniques == list(range(1, len(uniques) + 1)), 'sections non numérotées en continu : %s' % numeros)
    verifier('Machine (N° série)' in texte or 'MACHINE (N° SÉRIE)' in texte.upper(), 'colonne machine des pièces absente du PDF')
    plat = re.sub(r'\s+', ' ', texte)
    verifier(re.search(r'Travaux terminés\s*:\s*Partiellement', plat), '« Travaux terminés : Partiellement » absent du PDF')
    # pied de page : le site de Blyes seulement, pas le siège social
    verifier('01150 Blyes' in texte and 'Coulommiers' not in texte, 'pied de page du PDF : site de Blyes seul attendu')
    # photo de la pièce dans le PDF : vignette convertie en 500 px de large
    largeurs = set()
    for page in PdfReader(chemin_pdf).pages:
        xobjets = (page.get('/Resources') or {}).get('/XObject') or {}
        for ref in xobjets.values():
            o = ref.get_object()
            if o.get('/Subtype') == '/Image':
                largeurs.add(int(o.get('/Width', 0)))
    verifier(500 in largeurs, 'photo de la pièce absente du PDF (images trouvées, largeurs : %s)' % sorted(largeurs))
    nb_pages = len(PdfReader(chemin_pdf).pages)
    verifier(nb_pages <= 6, 'mise en page compacte attendue (≤ 6 pages), %d pages' % nb_pages)

    with zipfile.ZipFile(chemin_docx) as z:
        verifier(z.testzip() is None, 'fichier Word corrompu')
        rels = z.read('word/_rels/document.xml.rels').decode('utf-8')
        doc = z.read('word/document.xml').decode('utf-8')
        cibles = set(re.findall(r'Target="(media/[^"]+)"', rels))
        utilisees = set(re.findall(r'r:embed="([^"]+)"', doc))
        declarees = set(re.findall(r'Id="([^"]+)"[^>]*Target="media/', rels))
        verifier(utilisees <= declarees, 'images du Word non déclarées : %s' % (utilisees - declarees))
        verifier(len(utilisees) >= 4, 'Word : 4 photos attendues (3 d\'évènements + 1 de pièce), %d trouvées' % len(utilisees))
        verifier(all(('word/' + c) in z.namelist() for c in cibles), 'image du Word manquante dans le fichier')
        doc_texte = html.unescape(re.sub(r'<[^>]+>', '', doc))
        verifier('Travaux terminés : Partiellement' in doc_texte, '« Travaux terminés : Partiellement » absent du Word')
        pieds = ''.join(z.read(n).decode('utf-8') for n in z.namelist() if re.match(r'word/footer\d*\.xml$', n))
        verifier('01150 Blyes' in pieds and 'Coulommiers' not in pieds, 'pied de page du Word : site de Blyes seul attendu')

    # dossier .zip de toutes les photos de l'intervention
    await t.fermer_feuilles()
    chemin_zip = await t.telecharger('[data-a="photos-zip"] >> visible=true >> nth=0')
    with zipfile.ZipFile(chemin_zip) as z:
        verifier(z.testzip() is None, 'dossier photos (.zip) corrompu')
        noms = z.namelist()
        photos = [n for n in noms if n.endswith('.jpg')]
        verifier(len(photos) == 4, 'dossier photos : 4 photos attendues, %d trouvées (%s)' % (len(photos), noms))
        verifier(sum(n.startswith('1-Evenements/') for n in photos) == 3, 'photos d\'évènements mal rangées : %s' % noms)
        verifier(sum(n.startswith('2-Pieces/') for n in photos) == 1, 'photo de pièce mal rangée : %s' % noms)
        verifier('Liste-des-photos.csv' in noms, 'index des photos absent')
        index = z.read('Liste-des-photos.csv').decode('utf-8-sig')
        verifier('Joint de vérin' in index and 'JV-42' in index, 'index des photos incomplet')
    # rapport enregistré par une ancienne version (« Oui. ») : le choix est retrouvé
    await pg.evaluate('''() => { const r = JSON.parse(localStorage["sav3.rapport"]);
      r.travauxTermines = "Oui."; localStorage["sav3.rapport"] = JSON.stringify(r); }''')
    await pg.reload(wait_until='networkidle')
    await pg.wait_for_timeout(1500)
    await t.fermer_feuilles()
    verifier(await pg.input_value('[data-k="travauxTermines"]') == 'Oui', 'valeur « Oui. » d\'une ancienne version non retrouvée')
    await t.fermer()
    return t


async def test_historique_et_menage(nav, adresse):
    """Recherche dans l'historique ; ménage des rapports terminés anciens seulement."""
    t = await Telephone(nav, adresse).ouvrir()
    pg = t.pg
    await t.identite()
    await t.evenement('Rapport du jour', ['paysage-1.jpg'])
    await pg.wait_for_timeout(1200)
    await pg.evaluate('''async () => {
      for (let k = 1; k <= 3; k++) {
        const r = { id: 'ancien' + k, numero: 'RT-250101-0' + k, cree: '2025-01-0' + k + 'T08:00:00Z',
          maj: '2025-01-0' + k + 'T09:00:00Z', date: '2025-01-0' + k, statut: k < 3 ? 'terminé' : 'brouillon',
          client: { nom: 'Client ancien ' + k }, machine: { designation: 'M' + k },
          evenements: [{ id: 'e' + k, domaine: 'MECANIQUE', categorie: 'INFO', texte: 'ancien', photos: [] }],
          photosLibres: [], pieces: [] };
        await RapportDB.sauverRapport(r);
        const l = JSON.parse(localStorage['sav3.rapports'] || '[]'); l.push(r);
        localStorage['sav3.rapports'] = JSON.stringify(l);
      }
    }''')
    await t.menu('historique')
    await pg.fill('#histRecherche', 'ancien 2')
    await pg.wait_for_timeout(300)
    trouves = await pg.evaluate('() => [...document.querySelectorAll("#histListe strong")].map(e => e.textContent)')
    verifier(len(trouves) == 1 and 'Client ancien 2' in trouves[0], 'recherche incorrecte : %s' % trouves)
    await pg.fill('#histRecherche', '')
    await t.telecharger('[data-a="menage"]')            # la sauvegarde est exigée d'abord
    await pg.wait_for_timeout(2500)
    restants = await pg.evaluate('() => [...document.querySelectorAll("#histListe strong")].map(e => e.textContent)')
    verifier(not any('Client ancien 1' in r or 'Client ancien 2' in r for r in restants), 'rapports anciens non supprimés : %s' % restants)
    verifier(any('Client ancien 3' in r for r in restants), 'un brouillon ancien ne doit jamais être supprimé')
    await t.fermer()
    return t


async def test_reglages(nav, adresse):
    """Message e-mail conservé, adresse SAV non imposée, réglages d'équipe."""
    t = await Telephone(nav, adresse).ouvrir()
    pg = t.pg
    await t.identite()
    await pg.evaluate('''() => { const s = JSON.parse(localStorage["sav3.settings"]);
      s.mail.corps = "Bonjour, voici le rapport. Cordialement"; s.mail.destinataireSAV = "";
      localStorage["sav3.settings"] = JSON.stringify(s); }''')
    await pg.reload(wait_until='networkidle')
    await pg.wait_for_timeout(1000)
    reglages = await pg.evaluate('() => JSON.parse(localStorage["sav3.settings"])')
    verifier(reglages['mail']['corps'].endswith('Cordialement'), 'le message e-mail personnalisé a été effacé')
    verifier(reglages['mail']['destinataireSAV'] == '', 'une adresse SAV a été imposée')
    # export puis import des réglages d'équipe
    await t.menu('reglages')
    await pg.fill('[data-sk="mail.destinataireSAV"]', 'responsable@exemple.fr')
    await pg.click('.sheet.open [data-a="enregistrer"]')
    await pg.wait_for_timeout(500)
    await t.menu('reglages')
    chemin = await t.telecharger('[data-a="equipe-export"]')
    equipe = json.load(open(chemin, encoding='utf-8'))
    verifier('technicien' not in equipe, 'les réglages d\'équipe ne doivent pas contenir l\'identité du technicien')
    await pg.evaluate('''() => { const s = JSON.parse(localStorage["sav3.settings"]); s.mail.destinataireSAV = "";
      localStorage["sav3.settings"] = JSON.stringify(s); }''')
    await pg.reload(wait_until='networkidle')
    await pg.wait_for_timeout(1000)
    await t.menu('reglages')
    await pg.set_input_files('#equipeImport', chemin)
    await pg.wait_for_timeout(800)
    sav = await pg.evaluate('() => JSON.parse(localStorage["sav3.settings"]).mail.destinataireSAV')
    verifier(sav == 'responsable@exemple.fr', 'import des réglages d\'équipe : %r' % sav)
    # assistant d'évènement : domaine obligatoire dès l'étape 1
    await t.fermer_feuilles()
    await pg.click('#btnAjouter')
    await pg.wait_for_timeout(300)
    await pg.click('.assistant-nav [data-a="suivant"]')
    await pg.wait_for_timeout(300)
    etape = await pg.inner_text('#assistantProgres')
    verifier('1/4' in etape, 'l\'assistant ne doit pas passer à l\'étape 2 sans domaine (%s)' % etape)
    await t.fermer()
    return t


async def test_sav_et_audit(nav, adresse):
    """Travaux réalisés et constats séparés, type d'intervention, bouton de bascule."""
    t = await Telephone(nav, adresse).ouvrir()
    pg = t.pg
    await t.identite()
    await t.client()
    verifier((await t.rapport_stocke()).get('typeIntervention') == 'sav',
             'un nouveau rapport doit être de type « SAV / dépannage »')
    # assistant : en SAV, « Travail réalisé » est proposé d'office
    await pg.click('#btnAjouter')
    await pg.wait_for_timeout(300)
    verifier(await pg.query_selector('.nature.travail.on'), 'en SAV, l\'assistant doit proposer « Travail réalisé »')
    await pg.click('.assistant-bar [data-a="fermer"]')
    await pg.wait_for_timeout(300)
    verifier(len((await t.rapport_stocke()).get('evenements', [])) == 0, 'un évènement abandonné vide doit disparaître')
    # passage en « SAV + audit »
    await pg.click('[data-a="editer-client"] >> nth=0')
    await pg.wait_for_timeout(400)
    await pg.select_option('.sheet.open [data-fk="typeIntervention"]', 'mixte')
    await pg.click('.sheet.open [data-a="ok"]')
    await pg.wait_for_timeout(400)
    await t.fermer_feuilles()
    await t.evenement('Remplacement de la courroie et réglage de la tension.', ['paysage-1.jpg'],
                      nature='travail', resultat='resolu')
    await t.evenement('Vidange préventive du groupe hydraulique, prévue au planning.', [],
                      nature='travail', resultat='termine')
    await t.evenement('Capot de protection absent sur la transmission.', [], categorie=0, corrige=True)
    await t.evenement('Roulement bruyant côté moteur.', [], categorie=2)
    await t.evenement('Graissage des paliers effectué.', [], categorie=4)
    # le dernier, saisi comme « Informatif », est en fait un travail : bouton de bascule
    await pg.wait_for_timeout(1000)   # enregistrement différé (0,8 s)
    r = await t.rapport_stocke()
    graissage = [e for e in r['evenements'] if e['texte'].startswith('Graissage')][0]
    verifier(graissage.get('nature') == 'constat', 'le graissage doit d\'abord être un constat')
    await pg.click('[data-ev="%s"] [data-a="basculer-nature"]' % graissage['id'])
    await pg.wait_for_timeout(1200)
    verifier(not await pg.query_selector('.assistant'), 'le bouton de bascule ne doit pas ouvrir l\'assistant')
    r = await t.rapport_stocke()
    natures = {e['texte'].split()[0]: e.get('nature') for e in r['evenements']}
    verifier(natures.get('Graissage') == 'travail', 'bascule en travail non enregistrée : %s' % natures)
    nb_travaux = await pg.inner_text('.ev-groupe-titre.travaux .compte')
    nb_constats = await pg.inner_text('.ev-groupe-titre.constats .compte')
    verifier((nb_travaux, nb_constats) == ('3', '2'), 'listes séparées attendues 3 + 2 : %s + %s' % (nb_travaux, nb_constats))
    vidange = [e for e in r['evenements'] if e['texte'].startswith('Vidange')][0]
    verifier(vidange.get('resultat') == 'termine', 'résultat « Terminé » non enregistré : %r' % vidange.get('resultat'))
    corrige = [e for e in r['evenements'] if e['texte'].startswith('Capot')][0]
    verifier(corrige.get('corrige') is True, '« Corrigé sur place » non enregistré')
    await pg.fill('[data-k="actions"]', 'Remise en état de la transmission.')
    await pg.wait_for_timeout(300)

    chemin_docx = await t.telecharger('[data-a="word"] >> visible=true >> nth=0')
    await pg.click('[data-a="soumettre"] >> visible=true >> nth=0')
    await pg.wait_for_selector('[data-a="dl"]', timeout=30000)
    chemin_pdf = await t.telecharger('[data-a="dl"] >> visible=true')
    texte = '\n'.join(page.extract_text() or '' for page in PdfReader(chemin_pdf).pages)
    plat = re.sub(r'\s+', ' ', texte).upper()
    verifier("COMPTE RENDU D'INTERVENTION ET D'AUDIT" in plat.replace('’', "'"), 'titre « SAV + audit » absent du PDF')
    i_travaux = plat.find('. TRAVAUX RÉALISÉS')
    i_constats = plat.find('. CONSTATS — SÉCURITÉ')
    verifier(0 <= i_travaux < i_constats, 'la partie Travaux réalisés doit précéder les constats (%d, %d)' % (i_travaux, i_constats))
    verifier('REMISE EN ÉTAT DE LA TRANSMISSION' in plat[i_travaux:i_constats], 'résumé des travaux absent de leur partie')
    verifier('GRAISSAGE DES PALIERS' in plat[i_travaux:i_constats], 'le travail basculé doit être dans la partie Travaux')
    verifier('RÉSULTAT : RÉSOLU' in plat, 'résultat du travail absent du PDF')
    verifier('RÉSULTAT : TERMINÉ' in plat[i_travaux:i_constats], 'résultat « Terminé » (travail prévu) absent du PDF')
    verifier("CORRIGÉ SUR PLACE PENDANT L'INTERVENTION" in plat.replace('’', "'"), 'mention « corrigé sur place » absente du PDF')
    numeros = [int(n) for n in re.findall(r'(?m)^\s*(\d+)\. [A-ZÉÈ]', texte)]
    uniques = sorted(set(numeros))
    verifier(uniques == list(range(1, len(uniques) + 1)), 'sections non numérotées en continu : %s' % numeros)
    with zipfile.ZipFile(chemin_docx) as z:
        verifier(z.testzip() is None, 'fichier Word corrompu')
        doc = html.unescape(re.sub(r'<[^>]+>', '', z.read('word/document.xml').decode('utf-8')))
        for attendu in ("Compte rendu d'intervention et d'audit", 'Travaux réalisés', 'Résultat : Résolu', 'Résultat : Terminé',
                        "Corrigé sur place pendant l'intervention", 'Constats — Sécurité et urgences'):
            verifier(attendu in doc, 'Word : « %s » absent' % attendu)
        verifier(doc.find('Travaux réalisés') < doc.find('Constats — Sécurité'), 'Word : ordre des parties incorrect')
    # en audit, l'assistant propose « Constat »
    await t.fermer_feuilles()
    await pg.click('[data-a="editer-client"] >> nth=0')
    await pg.wait_for_timeout(400)
    await pg.select_option('.sheet.open [data-fk="typeIntervention"]', 'audit')
    await pg.click('.sheet.open [data-a="ok"]')
    await pg.wait_for_timeout(400)
    await t.fermer_feuilles()
    await pg.click('#btnAjouter')
    await pg.wait_for_timeout(300)
    verifier(await pg.query_selector('.nature.constat.on'), 'en audit, l\'assistant doit proposer « Constat »')
    await pg.click('.assistant-bar [data-a="fermer"]')
    await t.fermer()
    return t


# Faux moteur de reconnaissance vocale : le test décide de ce qui est « entendu »
# et quand le navigateur coupe la session (silence), comme sur un téléphone.
FAUX_MICRO = """
window.__recs = [];
class FauxMicro {
  constructor() { window.__recs.push(this); this.actif = false; }
  start() { if (window.__refusRelance && window.__recs.length > 1) throw new Error('refus'); this.actif = true; }
  stop() { if (!this.actif) return; this.actif = false; setTimeout(() => this.onend && this.onend(), 10); }
  abort() { this.stop(); }
  dire(morceaux) {
    const results = morceaux.map(([t, f]) => { const r = [{ transcript: t }]; r.isFinal = f; return r; });
    this.onresult && this.onresult({ results: results, resultIndex: 0 });
  }
  silence() {
    this.actif = false;
    this.onerror && this.onerror({ error: 'no-speech' });
    this.onend && this.onend();
  }
}
window.SpeechRecognition = FauxMicro; window.webkitSpeechRecognition = FauxMicro;
window.__dernier = () => window.__recs[window.__recs.length - 1];
"""


async def test_dictee(nav, adresse):
    """La dictée continue après un silence ; elle ne s'arrête qu'avec le bouton."""
    t = await Telephone(nav, adresse).ouvrir()
    pg = t.pg
    await t.identite()
    await pg.add_init_script(FAUX_MICRO)
    await pg.reload(wait_until='networkidle')
    await pg.wait_for_timeout(800)
    await t.fermer_feuilles()
    await pg.click('#btnAjouter')
    await pg.wait_for_timeout(300)
    await pg.click('[data-nature="constat"]')
    await pg.click('[data-domaine] >> nth=0')
    await pg.wait_for_timeout(300)
    await pg.click('[data-a="dictee"]')
    await pg.wait_for_timeout(200)
    verifier(await pg.query_selector('.dictee-active'), 'le témoin « À l\'écoute » doit s\'afficher')
    await pg.evaluate('() => __dernier().dire([["courroie détendue", true]])')
    # le navigateur coupe après un silence : la dictée doit repartir toute seule
    await pg.evaluate('() => __dernier().silence()')
    await pg.wait_for_timeout(400)
    nb = await pg.evaluate('() => __recs.length')
    verifier(nb == 2, 'la dictée doit être relancée après un silence (%d session(s))' % nb)
    verifier('Arrêter la dictée' in await pg.inner_text('[data-a="dictee"]'), 'le bouton doit rester sur « Arrêter la dictée »')
    await pg.evaluate('() => __dernier().dire([["traces de patinage sur la poulie", true]])')
    texte = await pg.input_value('#evTexte')
    verifier(texte.startswith('courroie détendue') and texte.endswith('traces de patinage sur la poulie'),
             'les phrases dictées avant et après la pause doivent se suivre : %r' % texte)
    # correction à la main pendant l'écoute, puis la suite de la dictée s'y ajoute
    await pg.fill('#evTexte', 'Courroie détendue (flèche 12 mm).')
    await pg.evaluate('() => __dernier().dire([["traces de patinage sur la poulie", true], ["bruit au démarrage", true]])')
    texte = await pg.input_value('#evTexte')
    verifier(texte == 'Courroie détendue (flèche 12 mm). bruit au démarrage',
             'correction à la main écrasée ou doublon : %r' % texte)
    # arrêt par le bouton : plus de relance
    await pg.click('[data-a="dictee"]')
    await pg.wait_for_timeout(400)
    verifier(await pg.evaluate('() => __recs.length') == 2, 'aucune relance après « Arrêter la dictée »')
    verifier('Dicter' in await pg.inner_text('[data-a="dictee"]'), 'le bouton doit revenir sur « Dicter »')
    verifier(not await pg.query_selector('.dictee-active'), 'le témoin d\'écoute doit disparaître')
    # relances impossibles (téléphone qui refuse) : arrêt propre, texte conservé
    await pg.click('[data-a="dictee"]')
    await pg.wait_for_timeout(200)
    await pg.evaluate('() => { window.__refusRelance = true; __dernier().silence(); }')
    await pg.wait_for_timeout(1200)
    verifier('Dicter' in await pg.inner_text('[data-a="dictee"]'), 'relance refusée : la dictée doit se mettre en pause')
    verifier((await pg.input_value('#evTexte')).startswith('Courroie détendue'), 'texte perdu après l\'échec de relance')
    # sessions qui s'arrêtent aussitôt sans rien entendre, en boucle : pause au bout de 4
    await pg.evaluate('() => { window.__refusRelance = false; }')
    await pg.click('[data-a="dictee"]')
    await pg.wait_for_timeout(100)
    for _ in range(4):
        await pg.evaluate('() => __dernier().silence()')
        await pg.wait_for_timeout(750)
    verifier('Dicter' in await pg.inner_text('[data-a="dictee"]'), 'relances en boucle : la dictée doit se mettre en pause')
    # changer d'étape arrête la dictée
    await pg.click('[data-a="dictee"]')
    await pg.wait_for_timeout(200)
    avant = await pg.evaluate('() => __recs.length')
    await pg.click('.assistant-nav [data-a="suivant"]')
    await pg.wait_for_timeout(300)
    await pg.evaluate('() => __dernier().onend && __dernier().onend()')
    await pg.wait_for_timeout(300)
    verifier(await pg.evaluate('() => __recs.length') == avant, 'la dictée doit s\'arrêter en quittant l\'étape Annotation')
    await pg.click('.assistant-bar [data-a="enregistrer"]')
    await pg.wait_for_timeout(1200)
    ev = (await t.rapport_stocke())['evenements'][0]
    verifier(ev['texte'].startswith('Courroie détendue (flèche 12 mm).'), 'texte dicté non enregistré : %r' % ev['texte'])
    await t.fermer()
    return t


DONNEES = os.path.join(RACINE, 'tests', 'donnees')


async def test_import_clients(nav, adresse):
    """Import de la liste clients : classeur .xlsx (logos, techniciens), CSV d'Excel, nettoyage."""
    t = await Telephone(nav, adresse).ouvrir()
    pg = t.pg
    await t.identite()
    # ancienne version : un .xlsx importé comme un CSV laissait une liste illisible
    await pg.evaluate('''() => localStorage.setItem("sav3.clientsListe",
      JSON.stringify([{ nom: "PK\\u0003\\u0004\\u0014", adresse: "x" }, { nom: "\\uFFFD\\u0001", adresse: "y" }]))''')
    await pg.reload(wait_until='networkidle')
    await pg.wait_for_timeout(800)
    verifier(await pg.evaluate('() => localStorage.getItem("sav3.clientsListe")') is None,
             'la liste illisible d\'une ancienne version doit être écartée')
    # 1. classeur .xlsx choisi dans les réglages
    await t.menu('reglages')
    await pg.set_input_files('#clientsImport', os.path.join(DONNEES, 'clients-exemple.xlsx'))
    await pg.wait_for_timeout(1500)
    liste = await pg.evaluate('() => Clients.base()')
    noms = [c['nom'] for c in liste]
    verifier(noms == ['FROMAGERIE DU JURA', 'LAITERIE DES ALPES', 'BISCUITERIE NORD', 'CONSERVERIE ÉTÉ'],
             'clients du classeur mal lus : %s' % noms)
    jura = liste[0]
    verifier(jura['contact'] == 'Paul MARTIN' and jura['tel'] == '06 12 34 56 78' and jura['ville'] == 'LONS-LE-SAUNIER',
             'fiche client mal découpée : %s' % {k: jura[k] for k in ('contact', 'tel', 'ville')})
    verifier(jura['logo'].startswith('data:image/png;base64,'), 'logo du classeur non repris')
    techs = await pg.evaluate('() => Clients.listeTechniciens().map(t => t.nom)')
    verifier(techs == ['Jean DUPONT', 'Marie DURAND'], 'techniciens du classeur : %s' % techs)
    # recherche « 3 lettres » dans la fiche client
    await t.fermer_feuilles()
    await pg.click('[data-a="editer-client"] >> nth=0')
    await pg.wait_for_timeout(400)
    await pg.fill('#cliRecherche', 'lai')
    await pg.wait_for_timeout(400)
    verifier('LAITERIE DES ALPES' in await pg.inner_text('.sheet.open'), 'le client importé n\'est pas proposé à la saisie')
    # collègue sur site : propositions de l'appli (plus de liste native <datalist>, noire en mode sombre)
    verifier(not await pg.query_selector('datalist'), 'il ne doit plus y avoir de <datalist> natif')
    await pg.click('#btnAjouterTechnicien')
    await pg.wait_for_timeout(300)
    await pg.click('[data-t-k="nom"][data-t-i="1"]')
    await pg.type('[data-t-k="nom"][data-t-i="1"]', 'mar')
    await pg.wait_for_timeout(300)
    props = await pg.eval_on_selector_all('.sugg-champ:not([hidden]) [data-sugg-val]', 'els => els.map(e => e.dataset.suggVal)')
    verifier(props == ['Marie DURAND'], 'propositions de collègues : %s' % props)
    await pg.click('.sugg-champ [data-sugg-val="Marie DURAND"]')
    await pg.wait_for_timeout(300)
    verifier(await pg.input_value('[data-t-k="nom"][data-t-i="1"]') == 'Marie DURAND', 'collègue choisi non inscrit dans le champ')
    verifier(not await pg.query_selector('.sugg-champ:not([hidden])'), 'la liste de propositions doit se fermer après le choix')
    await pg.click('.sheet.open [data-a="ok"]')
    await pg.wait_for_timeout(1200)
    techs = [x.get('nom') for x in (await t.rapport_stocke()).get('techniciens', [])]
    verifier('Marie DURAND' in techs, 'collègue choisi non enregistré dans le rapport : %s' % techs)
    await t.fermer_feuilles()
    # 2. même classeur sur un navigateur sans DecompressionStream (anciens iPhone)
    b64 = base64.b64encode(open(os.path.join(DONNEES, 'clients-exemple.xlsx'), 'rb').read()).decode()
    res = await pg.evaluate('''async (b64) => {
      const bin = atob(b64); const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const sauve = window.DecompressionStream; window.DecompressionStream = undefined;
      try { return await Clients.importerFichier(u.buffer); } finally { window.DecompressionStream = sauve; }
    }''', b64)
    verifier(res.get('n') == 4 and res.get('logos') == 1, 'lecture sans DecompressionStream : %s' % res)
    # 2 bis. nouvelle présentation du classeur : une ligne par contact
    await t.menu('reglages')
    await pg.set_input_files('#clientsImport', os.path.join(DONNEES, 'clients-contacts-exemple.xlsx'))
    await pg.wait_for_timeout(1500)
    liste = await pg.evaluate('() => Clients.base()')
    vus = [(c['nom'], c['contact']) for c in liste]
    verifier(vus == [('FROMAGERIE DU JURA', 'M. Paul MARTIN'), ('FROMAGERIE DU JURA', 'Mme Sophie LEROY'),
                     ('LAITERIE DES ALPES', 'Mme Julie BERNARD'), ('NOUVEAU CLIENT SA', 'M. Luc PETIT')],
             'contacts du classeur mal lus : %s' % vus)
    paul, sophie = liste[0], liste[1]
    verifier((paul['fonction'], paul['tel'], paul['email'], paul['autresContacts']) ==
             ('Responsable maintenance', '06 12 34 56 78', 'paul.martin@exemple.fr', 'Tél. 03 84 00 00 00'),
             'fiche contact mal remplie : %s' % paul)
    verifier(sophie['tel'] == '06 98 76 54 32', 'mobile mal formaté : %r' % sophie['tel'])
    # adresse et logo de l'ancienne liste repris pour un client déjà connu
    verifier(paul['adresse'].startswith('12 rue des Sapins') and paul['logo'].startswith('data:image/png'),
             'adresse/logo de l\'ancienne liste non repris : %r' % paul['adresse'])
    verifier(liste[3]['adresse'] == '', 'un nouveau client ne doit pas recevoir d\'adresse inventée')
    # les deux contacts d'un même client restent proposés, même après en avoir choisi un
    await t.fermer_feuilles()
    for passage in range(2):
        await pg.click('[data-a="editer-client"] >> nth=0')
        await pg.wait_for_timeout(400)
        await pg.fill('#cliRecherche', 'fro')
        await pg.wait_for_timeout(400)
        details = await pg.eval_on_selector_all('#cliSug .sug-detail', 'els => els.map(e => e.textContent)')
        verifier(len(details) == 2 and any('Paul MARTIN' in d for d in details) and any('Sophie LEROY' in d for d in details),
                 'passage %d : les deux contacts doivent être proposés : %s' % (passage, details))
        if passage == 0:
            await pg.click('#cliSug .suggestion >> nth=1')            # Mme Sophie LEROY
            await pg.wait_for_timeout(300)
            verifier(await pg.input_value('.sheet.open [data-fk="client.contact"]') == 'Mme Sophie LEROY',
                     'contact choisi non repris dans la fiche')
            await pg.click('.sheet.open [data-a="ok"]')
            await pg.wait_for_timeout(600)
        await t.fermer_feuilles()
    # recherche par le prénom du contact (après « Mme »)
    trouves = await pg.evaluate('() => Clients.chercher("sophie").map(c => c.contact)')
    verifier(trouves == ['Mme Sophie LEROY'], 'recherche par prénom du contact : %s' % trouves)
    # 3. CSV enregistré par Excel (séparateur « ; », encodage Windows)
    await t.menu('reglages')
    await pg.set_input_files('#clientsImport', os.path.join(DONNEES, 'clients-exemple-excel.csv'))
    await pg.wait_for_timeout(1000)
    noms = await pg.evaluate('() => Clients.base().map(c => c.nom)')
    verifier('CONSERVERIE ÉTÉ' in noms and len(noms) == 4, 'CSV Excel (accents) mal lu : %s' % noms)
    # 3 bis. mémoire du navigateur (localStorage) pleine : l'import passe quand même
    #        (la liste est rangée dans IndexedDB) et elle est retrouvée après rechargement
    await pg.evaluate('''() => {
      let i = 0;
      for (const taille of [262144, 16384, 1024, 64, 1]) {   // rempli jusqu'au dernier caractère
        const bloc = "x".repeat(taille);
        try { for (;;) localStorage.setItem("remplissage_" + (i++), bloc); } catch (e) {}
      }
      return i; }''')
    await t.menu('reglages')
    await pg.set_input_files('#clientsImport', os.path.join(DONNEES, 'clients-contacts-exemple.xlsx'))
    await pg.wait_for_timeout(1500)
    contacts = await pg.evaluate('() => Clients.base().map(c => c.contact)')
    verifier('Mme Sophie LEROY' in contacts, 'import refusé quand le localStorage est plein : %s' % contacts)
    await pg.reload(wait_until='networkidle')
    await pg.wait_for_timeout(800)
    noms = await pg.evaluate('async () => { await Clients.pret; return Clients.base().map(c => c.contact); }')
    verifier('Mme Sophie LEROY' in noms, 'liste perdue après rechargement : %s' % noms)
    await pg.evaluate('''() => Object.keys(localStorage).filter(k => k.indexOf("remplissage_") === 0)
      .forEach(k => localStorage.removeItem(k))''')
    await pg.reload(wait_until='networkidle')
    await pg.wait_for_timeout(800)
    await t.fermer_feuilles()
    # 4. un fichier qui n'est pas une liste : message, liste conservée
    await t.menu('reglages')
    await pg.set_input_files('#clientsImport', os.path.join(PHOTOS, 'portrait.jpg'))
    await pg.wait_for_timeout(1000)
    verifier(len(await pg.evaluate('() => Clients.base()')) == 4,
             'une image ne doit pas remplacer la liste clients')
    await t.fermer()
    return t


async def test_annuaire(nav, adresse):
    """Annuaire : recherche sans perdre le clavier, chaque contact modifiable sans écraser les autres."""
    t = await Telephone(nav, adresse).ouvrir()
    pg = t.pg
    await t.identite()
    await t.menu('reglages')
    await pg.set_input_files('#clientsImport', os.path.join(DONNEES, 'clients-contacts-exemple.xlsx'))
    await pg.wait_for_timeout(1500)
    await t.menu('annuaire')
    # la recherche ne redessine pas le champ (sinon le clavier de l'iPhone se ferme à chaque lettre)
    await pg.evaluate('() => { window.__champ = document.querySelector("#inputRechercheAnnuaire"); }')
    await pg.click('#inputRechercheAnnuaire')
    await pg.keyboard.type('fro')
    await pg.wait_for_timeout(300)
    meme = await pg.evaluate('() => window.__champ === document.querySelector("#inputRechercheAnnuaire")')
    verifier(meme, 'le champ de recherche de l\'annuaire est redessiné à chaque lettre')
    cartes = await pg.eval_on_selector_all('#listeCartesClients .card', 'els => els.map(e => e.textContent)')
    verifier(len(cartes) == 2, 'recherche « fro » : 2 contacts attendus, %d cartes' % len(cartes))

    async def ouvrir(contact):
        idx = await pg.evaluate('''(nom) => [...document.querySelectorAll("#listeCartesClients .card")]
          .findIndex(e => e.textContent.indexOf(nom) >= 0)''', contact)
        verifier(idx >= 0, 'carte de %s introuvable' % contact)
        await pg.click('#listeCartesClients .card >> nth=%d' % idx)
        await pg.wait_for_timeout(300)
        verifier(await pg.input_value('#annContact') == contact,
                 'la fiche ouverte n\'est pas celle de %s : %r' % (contact, await pg.input_value('#annContact')))

    async def enregistrer():
        await pg.click('[data-a="enregistrer-client"]')
        await pg.wait_for_timeout(400)

    def fiches():
        return pg.evaluate('''() => Clients.liste().filter(c => c.nom === "FROMAGERIE DU JURA")
          .map(c => ({ contact: c.contact, tel: c.tel, fonction: c.fonction, notes: c.autresContacts || "" }))''')

    # 1. le 2e contact s'ouvre bien (avant : la carte ouvrait toujours le 1er contact du client)
    await ouvrir('Mme Sophie LEROY')
    await pg.fill('#annTel', '06 00 00 00 01')
    await pg.fill('#annNotes', "Badge à demander à l'accueil")
    await enregistrer()
    # 2. modifier l'autre contact ne doit pas effacer la modification précédente
    await pg.fill('#inputRechercheAnnuaire', 'fro')
    await pg.wait_for_timeout(300)
    await ouvrir('M. Paul MARTIN')
    verifier(await pg.input_value('#annNotes') == "Badge à demander à l'accueil", 'notes du client non enregistrées')
    await pg.fill('#annFonction', 'Chef de maintenance')
    await enregistrer()
    f = {x['contact']: x for x in await fiches()}
    verifier(f.get('Mme Sophie LEROY', {}).get('tel') == '06 00 00 00 01', 'modification de Sophie perdue : %s' % f)
    verifier(f.get('M. Paul MARTIN', {}).get('fonction') == 'Chef de maintenance' and f['M. Paul MARTIN']['tel'] == '06 12 34 56 78',
             'fiche de Paul incorrecte : %s' % f.get('M. Paul MARTIN'))
    # 3. ajouter un contact à un client existant
    await pg.fill('#inputRechercheAnnuaire', 'fro')
    await pg.wait_for_timeout(300)
    await ouvrir('M. Paul MARTIN')
    await pg.click('[data-a="ajouter-contact-client"]')
    await pg.wait_for_timeout(300)
    verifier(await pg.input_value('#annContact') == '' and await pg.input_value('#annNom') == 'FROMAGERIE DU JURA',
             'le nouveau contact doit partir d\'une fiche vide du même client')
    await pg.fill('#annContact', 'M. Marc BLANC')
    await pg.fill('#annTel', '06 55 44 33 22')
    await enregistrer()
    # 4. renommer un contact : pas de doublon
    await pg.fill('#inputRechercheAnnuaire', 'fro')
    await pg.wait_for_timeout(300)
    await ouvrir('M. Paul MARTIN')
    await pg.fill('#annContact', 'M. Paul MARTIN-DUVAL')
    await enregistrer()
    contacts = sorted(x['contact'] for x in await fiches())
    verifier(contacts == ['M. Marc BLANC', 'M. Paul MARTIN-DUVAL', 'Mme Sophie LEROY'], 'contacts après modifications : %s' % contacts)
    # les propositions de la fiche client suivent l'annuaire
    trouves = await pg.evaluate('() => Clients.chercher("fro").map(c => c.contact + " " + c.tel)')
    verifier(len(trouves) == 3 and 'Mme Sophie LEROY 06 00 00 00 01' in trouves, 'propositions après annuaire : %s' % trouves)
    await t.fermer()
    return t


async def test_chrono_plusieurs_jours(nav, adresse):
    """Chrono : une journée par jour (pause du soir, reprise le lendemain, chrono oublié)."""
    from datetime import datetime
    t = await Telephone(nav, adresse).ouvrir()
    pg = t.pg
    await t.identite()
    await t.client()
    await pg.clock.install(time=datetime(2026, 10, 12, 7, 0))

    async def a(heure, action):
        await pg.clock.set_system_time(heure)
        await t.fermer_feuilles()
        await pg.click('[data-a="%s"] >> nth=0' % action)
        await pg.wait_for_timeout(500)

    async def etat():
        await pg.wait_for_timeout(1000)
        r = await t.rapport_stocke()
        return r, [(j['date'], j['debut'], j['fin'], round(j['dureeMs'] / 3600000, 2)) for j in r.get('jours', [])]

    # 0. même jour : Terminer puis Reprendre = une pause, pas de deuxième journée
    await a(datetime(2026, 10, 12, 8, 0), 'chrono-demarrer')
    await a(datetime(2026, 10, 12, 12, 0), 'chrono-terminer')
    await a(datetime(2026, 10, 12, 13, 0), 'chrono-reprendre')
    await a(datetime(2026, 10, 12, 17, 0), 'chrono-terminer')
    r, jours = await etat()
    verifier(not r.get('multiJours') and len(r['chrono']['pauses']) == 1,
             'même jour : une pause attendue, pas de nouvelle journée (%s, %s)' % (r.get('multiJours'), jours))
    duree = await pg.evaluate('() => Report.dureeTotale(JSON.parse(localStorage["sav3.rapport"]))')
    verifier(round(duree / 3600000, 2) == 8.0, 'même jour : 8 h attendues, %s' % (duree / 3600000))
    # 1. le lendemain, « Reprendre » ouvre le jour 2 ; le jour 1 rejoint le relevé
    await a(datetime(2026, 10, 13, 8, 0), 'chrono-reprendre')
    r, jours = await etat()
    verifier(r.get('multiJours') and jours == [('2026-10-12', '08:00', '17:00', 8.0)],
             'jour 1 attendu dans le relevé : %s' % jours)
    barre = await pg.inner_text('#chronoBarre')
    verifier(r['chrono'].get('jourEnCours') and 'JOUR 2' in barre.upper(), 'le jour 2 doit être en cours : %s / %r' % (r['chrono'], barre))
    # 2. pause le soir, reprise le lendemain matin : nouvelle journée automatique
    await a(datetime(2026, 10, 13, 17, 30), 'chrono-pause')
    await a(datetime(2026, 10, 14, 7, 45), 'chrono-pause')
    r, jours = await etat()
    verifier(jours[-1] == ('2026-10-13', '08:00', '17:30', 9.5), 'pause du soir : jour 2 attendu 08:00-17:30 : %s' % jours)
    verifier('JOUR 3' in (await pg.inner_text('#chronoBarre')).upper(), 'le jour 3 doit commencer à la reprise')
    await a(datetime(2026, 10, 14, 11, 45), 'chrono-terminer')
    r, jours = await etat()
    verifier(len(jours) == 3 and jours[-1] == ('2026-10-14', '07:45', '11:45', 4.0), 'jour 3 : %s' % jours)
    # 3. chrono oublié la veille : on demande la fin de journée et l'heure de reprise
    await a(datetime(2026, 10, 15, 8, 0), 'chrono-reprendre')
    await pg.clock.set_system_time(datetime(2026, 10, 16, 9, 0))
    await pg.reload(wait_until='networkidle')
    await pg.wait_for_timeout(800)
    await t.fermer_feuilles()
    verifier(await pg.query_selector('.chrono-oubli'), 'le chrono oublié la veille doit être signalé')
    await pg.click('[data-a="chrono-terminer"]')
    await pg.wait_for_selector('#oubliFin', timeout=4000)
    await pg.fill('#oubliFin', '16:00')
    await pg.fill('#oubliReprise', '08:30')
    await pg.click('[data-a="oubli-ok"]')
    await pg.wait_for_timeout(500)
    await a(datetime(2026, 10, 16, 12, 30), 'chrono-terminer')
    r, jours = await etat()
    verifier(jours[-2:] == [('2026-10-15', '08:00', '16:00', 8.0), ('2026-10-16', '08:30', '12:30', 4.0)],
             'chrono oublié : journées attendues 15/10 08:00-16:00 et 16/10 08:30-12:30 : %s' % jours)
    duree = await pg.evaluate('() => Report.dureeTotale(JSON.parse(localStorage["sav3.rapport"]))')
    verifier(round(duree / 3600000, 2) == 33.5, 'total 8 + 9,5 + 4 + 8 + 4 = 33,5 h attendu : %s' % (duree / 3600000))
    # 4. le rapport liste les 5 journées
    await t.fermer_feuilles()
    await pg.click('[data-a="soumettre"] >> visible=true >> nth=0')
    await pg.wait_for_selector('[data-a="dl"]', timeout=30000)
    chemin_pdf = await t.telecharger('[data-a="dl"] >> visible=true')
    texte = re.sub(r'\s+', ' ', '\n'.join(page.extract_text() or '' for page in PdfReader(chemin_pdf).pages))
    for d in ('12/10/2026', '13/10/2026', '14/10/2026', '15/10/2026', '16/10/2026'):
        verifier(d in texte, 'journée du %s absente du relevé du PDF' % d)
    verifier('5 Journées' in texte or '5 journées' in texte.lower(), 'nombre de journées absent du PDF')
    await t.fermer()
    return t


async def test_sms_ou_appel_arrivee(nav, adresse):
    """Numéro géographique (fixe) → « Appeler le contact » (tel:) ; mobile → SMS."""
    t = await Telephone(nav, adresse).ouvrir()
    pg = t.pg
    await t.identite()

    # 1. classification pure des numéros (fixes 01-05 et +33 1-5…, mobiles 06/07…)
    for n in ['04 78 55 44 33', '01 40 00 00 00', '+33 1 40 00 00 00', '03 88 00 00 00', '05 61 00 00 00']:
        verifier(await pg.evaluate('(n) => APP.estNumeroGeographique(n)', n),
                 'numéro géographique mal reconnu : %s' % n)
    for n in ['06 12 34 56 78', '07 88 00 00 00', '+33 6 12 34 56 78']:
        verifier(not await pg.evaluate('(n) => APP.estNumeroGeographique(n)', n),
                 'numéro mobile mal reconnu comme fixe : %s' % n)

    async def client_tel(numero):
        await t.fermer_feuilles()
        await pg.click('[data-a="editer-client"] >> nth=0')
        await pg.wait_for_timeout(400)
        await pg.fill('#cliRecherche', 'ACME Industrie')
        await pg.wait_for_timeout(300)
        await pg.fill('.sheet.open [data-fk="client.tel"]', numero)
        await pg.click('.sheet.open [data-a="ok"]')
        await pg.wait_for_timeout(400)
        await t.fermer_feuilles()

    # 2. fixe → bouton « Appeler le contact » (tel:), message SMS masqué
    await client_tel('04 78 55 44 33')
    await t.menu('sms-arrivee')
    await pg.wait_for_selector('#btnLancerSMS', timeout=5000)
    verifier((await pg.get_attribute('#btnLancerSMS', 'href')).startswith('tel:'),
             'un fixe doit ouvrir le téléphone (tel:)')
    verifier('Appeler le contact' in await pg.inner_text('#btnLancerSMS'),
             'le bouton doit proposer « Appeler le contact »')
    verifier(not await pg.query_selector('#smsTexteMessage'),
             'le message SMS doit être masqué pour un fixe')
    await t.fermer_feuilles()
    await pg.click('#btnMenu')
    await pg.wait_for_timeout(300)
    verifier('Appeler le contact' in await pg.inner_text('.sheet.open [data-a="sms-arrivee"]'),
             'le menu doit proposer « Appeler le contact » pour un fixe')
    await t.fermer_feuilles()

    # 3. mobile → SMS, et bascule en direct si on tape un fixe
    await client_tel('06 12 34 56 78')
    await t.menu('sms-arrivee')
    await pg.wait_for_selector('#smsTexteMessage', timeout=5000)
    verifier((await pg.get_attribute('#btnLancerSMS', 'href')).startswith('sms:'),
             'un mobile doit ouvrir le SMS (sms:)')
    verifier("Ouvrir l'application SMS" in await pg.inner_text('#btnLancerSMS'),
             'le bouton doit ouvrir l\'application SMS')
    await pg.fill('#smsNumeroDest', '04 78 55 44 33')
    await pg.wait_for_timeout(400)
    verifier((await pg.get_attribute('#btnLancerSMS', 'href')).startswith('tel:'),
             'le bouton doit basculer sur tel: dès qu\'un fixe est saisi')
    await t.fermer()
    return t


TESTS = [test_identite_et_numeros, test_photos_conservees, test_rapport_pdf_et_word,
         test_historique_et_menage, test_reglages, test_sav_et_audit, test_dictee, test_import_clients,
         test_annuaire, test_chrono_plusieurs_jours, test_sms_ou_appel_arrivee]
# BFR_TEST=nom_du_test : ne lancer qu'un seul test (ex. BFR_TEST=test_rapport_pdf_et_word)
if os.environ.get('BFR_TEST'):
    TESTS = [f for f in TESTS if f.__name__ == os.environ['BFR_TEST']]


async def principal():
    if not os.path.isfile(os.path.join(SITE, 'index.html')):
        print('docs/index.html absent : lancez d\'abord  python build.py --sans-liste')
        return 1
    serveur, adresse = demarrer_serveur()
    echecs = 0
    async with async_playwright() as p:
        nav = await p.chromium.launch()
        for test in TESTS:
            nom = test.__name__
            try:
                tel = await test(nav, adresse)
                problemes = []
                if tel.erreurs:
                    problemes.append('erreurs JavaScript : %s' % tel.erreurs[:3])
                if tel.dialogues_natifs:
                    problemes.append('boîtes natives (bloquées dans un artefact) : %s' % tel.dialogues_natifs[:3])
                if problemes:
                    raise AssertionError(' ; '.join(problemes))
                print('OK      %s' % nom)
            except Exception as e:
                echecs += 1
                print('ÉCHEC   %s : %s' % (nom, e))
                if not isinstance(e, AssertionError):
                    traceback.print_exc()
        await nav.close()
    serveur.shutdown()
    print('\n%d test(s), %d échec(s)' % (len(TESTS), echecs))
    return 1 if echecs else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(principal()))
