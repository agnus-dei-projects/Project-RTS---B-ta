# Simule un hébergeur endormi : le client (fichier local) se connecte AVANT que le serveur ne démarre, et doit réussir tout seul.
import sys, os, subprocess, time
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 18950
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1200, 'height': 800})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto('file://' + os.path.join(ROOT, 'Project-Beta.html'))
    for t in ['localhost', '192.168.1.20', 'pc-adrien', 'mon-jeu.onrender.com', 'https://mon-jeu.onrender.com/', 'http://10.0.0.2:9000', 'ex.com:8443', '']:
        print(f'{t!r:34} ->', pg.evaluate(f'__rts.netUrl({t!r})'))
    pg.click('[data-go="multi"]'); pg.fill('#m-name', 'Zoé'); pg.fill('#m-addr', f'localhost:{PORT}'); pg.click('[data-act="connect"]')
    pg.wait_for_timeout(5000)
    print('pendant l’attente :', pg.inner_text('#m-err'))
    srv = subprocess.Popen(['node', 'serveur.cjs'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT)}, stdout=subprocess.DEVNULL)
    try:
        pg.wait_for_selector('#m-lobby:not([hidden])', timeout=20000)
        print('connecté après réveil du serveur :', pg.inner_text('#m-players').split('\n')[0])
    finally:
        srv.terminate()
    b.close()
print('ERREURS :' if errors else 'Aucune erreur.', *errors)
