# Test navigateur du multijoueur : 2 onglets Chromium contre le vrai serveur (hôte via http, ami via le fichier HTML + adresse saisie).
import sys, os, subprocess, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1]
PORT = 18900
srv = subprocess.Popen(['node', 'serveur.cjs', str(PORT)], cwd=ROOT, stdout=subprocess.PIPE, text=True)
time.sleep(1.0)
errors = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        def page(url):
            pg = b.new_page(viewport={'width': 1280, 'height': 800})
            pg.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
            pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
            pg.goto(url); pg.wait_for_timeout(400)
            return pg
        A = page(f'http://localhost:{PORT}/')
        B = page('file://' + os.path.join(ROOT, 'Project-Beta.html').replace(os.sep, '/'))
        # hôte : connexion sur le serveur de la page (adresse vide)
        A.click('[data-go="multi"]'); A.fill('#m-name', 'Adrien'); A.click('[data-act="connect"]'); A.wait_for_selector('#m-lobby:not([hidden])')
        # ami : fichier local + adresse tapée
        B.click('[data-go="multi"]'); B.fill('#m-name', 'Léa'); B.fill('#m-addr', f'localhost:{PORT}'); B.click('[data-act="connect"]'); B.wait_for_selector('#m-lobby:not([hidden])')
        A.wait_for_timeout(300)
        print('joueurs vus par l’hôte :', A.inner_text('#m-players').replace('\n', ' | '))
        print('hôte : bouton lancer actif =', A.evaluate("!document.getElementById('m-startbtn').disabled"), '| ami =', B.evaluate("!document.getElementById('m-startbtn').disabled"))
        # l'hôte règle 3 bots, 20 min, nomme un bot
        A.evaluate("(() => { const r = document.getElementById('m-nbots'); r.value = '3'; r.dispatchEvent(new Event('input')); })()")
        A.select_option('#m-time', '20'); A.fill('#m-bots .botrow:nth-child(1) input', 'Marianne')
        A.wait_for_timeout(600)
        print('config vue par l’ami :', B.inner_text('#m-note') or '-', '| bots :', B.evaluate("[...document.querySelectorAll('#m-bots .botrow input')].map(i => i.value || i.placeholder).join(',')"), '| temps :', B.evaluate("document.getElementById('m-time').value"))
        A.screenshot(path=f'{OUT}/m1_lobby_host.png'); B.screenshot(path=f'{OUT}/m2_lobby_friend.png')
        A.click('[data-act="mstart"]'); A.wait_for_timeout(2500)
        for n, pg in (('hôte', A), ('ami', B)):
            print(n, ': joueurs', pg.evaluate('__rts.S.players.map(p => p.name).join(",")'), '| moi', pg.evaluate('__rts.ME'), '| multi', pg.evaluate('__rts.multi'), '| tick', pg.evaluate('__rts.S.tick'))
        # l'ami construit via l'interface réseau (cmd), l'hôte doit le voir
        own = B.evaluate('(() => { const S = __rts.S, me = __rts.ME; const o = []; for (let c = 0; c < S.owner.length; c++) if (S.owner[c] === me) o.push(c); return o[o.length >> 1]; })()')
        B.evaluate(f'__rts.cmd({{type: "build", p: __rts.ME, kind: 0, cell: {own}}})')
        A.wait_for_timeout(1800)
        print('bâtiments vus par l’hôte :', A.evaluate('__rts.S.buildings.length'), '| par l’ami :', B.evaluate('__rts.S.buildings.length'))
        A.wait_for_timeout(6000)
        ha = A.evaluate('__rts.G.stateHash(__rts.S) + "@" + __rts.S.tick'); hb = B.evaluate('__rts.G.stateHash(__rts.S) + "@" + __rts.S.tick')
        print('empreintes (même tick requis) :', ha, hb)
        ta = A.evaluate('__rts.S.tick'); tb = B.evaluate('__rts.S.tick'); print('ticks', ta, tb, '(≈ 10 par seconde réelle)')
        A.screenshot(path=f'{OUT}/m3_game_host.png'); B.screenshot(path=f'{OUT}/m4_game_friend.png')
        print('barre réseau :', A.inner_text('#netbar'))
        # l'ami quitte : l'hôte voit une IA reprendre
        B.click('#menubtn'); B.click('#quitbtn'); B.click('#quitbtn'); A.wait_for_timeout(1500)
        print('après départ de l’ami : isBot =', A.evaluate('__rts.S.players[1].isBot'), '| journal :', A.evaluate('__rts.S.events.slice(-1)[0].text'))
        b.close()
finally:
    srv.terminate()
print('ERREURS :' if errors else 'Aucune erreur console.')
for e in errors: print(' ', e)
