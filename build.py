import json
import os
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'app', 'src')
APP = os.path.join(ROOT, 'app')
SITE = os.path.join(ROOT, 'docs')                 # dossier déployé par GitHub Pages
OUT_SINGLE = os.path.join(ROOT, 'CR-Intervention-SAV.html')   # fichier unique (téléphone)


# --------------------------------------------------------------------------
# Icônes PNG générées sans dépendance : fond bleu arrondi + coche blanche
# --------------------------------------------------------------------------
def png_icon(size):
    bleu, bleu2 = (11, 61, 145), (7, 42, 102)
    blanc = (255, 255, 255)
    r = size * 0.22

    def seg_dist(px, py, ax, ay, bx, by):
        vx, vy = bx - ax, by - ay
        wx, wy = px - ax, py - ay
        t = 0.0
        if vx * vx + vy * vy > 0:
            t = max(0.0, min(1.0, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
        dx, dy = wx - t * vx, wy - t * vy
        return (dx * dx + dy * dy) ** 0.5

    A = (size * 0.24, size * 0.52)
    B = (size * 0.43, size * 0.71)
    C = (size * 0.77, size * 0.30)
    ep = size * 0.072
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            cx, cy = x + 0.5, y + 0.5
            dx, dy = min(cx, size - cx), min(cy, size - cy)
            dedans = True
            if dx < r and dy < r:
                dedans = ((r - dx) ** 2 + (r - dy) ** 2) ** 0.5 <= r
            if not dedans:
                row += bytes((0, 0, 0, 0))
                continue
            t = (cx + cy) / (2 * size)
            col = tuple(int(bleu[i] + (bleu2[i] - bleu[i]) * t) for i in range(3))
            d = min(seg_dist(cx, cy, A[0], A[1], B[0], B[1]), seg_dist(cx, cy, B[0], B[1], C[0], C[1]))
            if d < ep:
                a = 1.0 if d < ep - 1 else max(0.0, (ep - d))
                col = tuple(int(col[i] + (blanc[i] - col[i]) * a) for i in range(3))
            row += bytes(col + (255,))
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
            chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def ecrire_icones(dossier):
    os.makedirs(dossier, exist_ok=True)
    for nom, taille in {'icon-192.png': 192, 'icon-512.png': 512,
                        'apple-touch-icon.png': 180, 'favicon.png': 64}.items():
        with open(os.path.join(dossier, nom), 'wb') as f:
            f.write(png_icon(taille))


# --------------------------------------------------------------------------
# Assemblage du fichier unique
# --------------------------------------------------------------------------
def lire(p):
    with open(p, 'r', encoding='utf-8') as f:
        return f.read()


# Liste clients : embarquée par défaut (usage hors connexion immédiat).
# `python3 build.py --sans-liste` produit une application SANS la liste : les
# techniciens la chargent alors depuis le classeur via ☰ → Réglages → Liste clients.
SANS_LISTE = '--sans-liste' in sys.argv


def construire_single_file(avec_pwa):
    html = lire(os.path.join(APP, 'index.html'))
    clients_data = ('' if SANS_LISTE else lire(os.path.join(SRC, 'clients-data.js')) + '\n')
    contenu = {
        'CSS': lire(os.path.join(SRC, 'style.css')),
        'LANGUES': lire(os.path.join(SRC, 'langues.js')),
        'TRADUCTION': lire(os.path.join(SRC, 'traduction.js')),
        'PDF': lire(os.path.join(SRC, 'pdf.js')),
        'DOCX': lire(os.path.join(SRC, 'docx.js')),
        'REPORT': lire(os.path.join(SRC, 'report.js')),
        'ANNOT': lire(os.path.join(SRC, 'annotate.js')),
        'WIZARD': lire(os.path.join(SRC, 'wizard.js')),
        'LOGO': lire(os.path.join(SRC, 'logo-bfr.js')),
        'CLIENTS': clients_data + lire(os.path.join(SRC, 'clients.js')),
        'APP': lire(os.path.join(SRC, 'app.js')),
    }
    for bloc, code in contenu.items():
        motif = '/*<!--%s-->*/' % bloc
        if motif not in html:
            raise SystemExit('Motif manquant dans app/index.html : %s' % motif)
        if '</script>' in code or '</style>' in code:
            raise SystemExit('Contenu incompatible avec l\'inlining : %s' % bloc)
        html = html.replace(motif, code)
    if avec_pwa:
        html = html.replace(
            '<meta name="description"',
            '<link rel="manifest" href="manifest.json">\n'
            '<link rel="icon" href="favicon.png">\n'
            '<link rel="apple-touch-icon" href="apple-touch-icon.png">\n'
            '<meta name="description"')
    return html


SW = """/* Service worker — met l'application en cache pour un usage hors connexion */
const CACHE = 'bfr-fiche-sav-v1';
const FICHIERS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './favicon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).then((rep) => {
      const copie = rep.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copie)).catch(() => {});
      return rep;
    }).catch(() => caches.match('./index.html')))
  );
});
"""

MANIFEST = {
    "name": "Fiche d'intervention S.A.V. — BFR Systems",
    "short_name": "Fiche SAV",
    "description": "Saisie, signature du client et envoi des fiches d'intervention S.A.V. Fonctionne hors connexion.",
    "lang": "fr",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "orientation": "portrait",
    "background_color": "#eef2f7",
    "theme_color": "#0b3d91",
    "icons": [
        {"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}
    ]
}


def main():
    # 1) fichier unique (livrable terrain : un seul fichier à ouvrir dans Chrome)
    with open(OUT_SINGLE, 'w', encoding='utf-8') as f:
        f.write(construire_single_file(avec_pwa=False))

    # 2) site déployable (GitHub Pages : docs/)
    os.makedirs(SITE, exist_ok=True)
    with open(os.path.join(SITE, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(construire_single_file(avec_pwa=True))
    ecrire_icones(SITE)
    with open(os.path.join(SITE, 'sw.js'), 'w', encoding='utf-8') as f:
        f.write(SW)
    with open(os.path.join(SITE, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(MANIFEST, f, ensure_ascii=False, indent=2)
    # fichier .nojekyll : GitHub Pages ne doit pas filtrer les fichiers
    open(os.path.join(SITE, '.nojekyll'), 'w').close()

    for p in (OUT_SINGLE, os.path.join(SITE, 'index.html')):
        print('%-46s %8.0f Ko' % (os.path.relpath(p, ROOT), os.path.getsize(p) / 1024))
    if SANS_LISTE:
        print('Liste clients NON embarquée : à charger dans ☰ → Réglages → Liste clients.')
    print('docs/ : ' + ' '.join(sorted(os.listdir(SITE))))


if __name__ == '__main__':
    main()
