import sys, json, os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'file://' + os.path.join(ROOT, 'Project-Beta.html').replace(os.sep, '/') + '?seed=7'
OUT = sys.argv[1]
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1440, 'height': 880})
    pg.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    pg.goto(URL)
    pg.wait_for_timeout(600)
    pg.screenshot(path=f'{OUT}/0_menu.png')
    # --- menu solo : 4 bots, pseudos, difficultés, durée
    pg.click('[data-go="solo"]')
    pg.fill('#s-name', 'Adrien')
    pg.evaluate("(() => { const r = document.getElementById('s-nbots'); r.value = '4'; r.dispatchEvent(new Event('input')); })()")
    pg.select_option('#s-time', '15')
    pg.click('[data-all="2"]')
    pg.fill('#s-bots .botrow:nth-child(2) input', 'Jeanne')
    pg.select_option('#s-bots .botrow:nth-child(3) select', '0')
    pg.fill('#s-seed', '7')
    pg.screenshot(path=f'{OUT}/1_solo_menu.png')
    pg.click('[data-act="solostart"]')
    pg.wait_for_timeout(1500)
    st = pg.evaluate('(() => { const S = __rts.S; return {n: S.players.length, names: S.players.map(p => p.name), diff: S.players.map(p => p.diff), limit: S.timeLimit / 600}; })()')
    print('solo configuré :', st)
    assert st['n'] == 5 and st['names'][0] == 'Adrien' and st['names'][2] == 'Jeanne' and st['diff'][3] == 0 and st['diff'][4] == 2 and st['limit'] == 15, st
    # --- paramètres depuis le menu pause
    pg.click('#menubtn'); pg.wait_for_timeout(200)
    print('vitesse en pause :', pg.evaluate('(() => { const t = __rts.S.tick; return t; })()'))
    pg.screenshot(path=f'{OUT}/1b_pause.png')
    pg.click('#scr-pause [data-go="settings"]')
    pg.select_option('#o-quality', 'low'); pg.select_option('#o-fps', '30')
    pg.uncheck('#o-labels'); pg.check('#o-labels')
    pg.screenshot(path=f'{OUT}/1c_settings.png')
    pg.click('#scr-settings [data-act="back"]')
    t0 = pg.evaluate('__rts.S.tick'); pg.wait_for_timeout(600)
    assert pg.evaluate('__rts.S.tick') == t0, 'le jeu doit être en pause pendant le menu'
    pg.click('[data-act="resume"]'); pg.wait_for_timeout(700)
    assert pg.evaluate('__rts.S.tick') > t0, 'le jeu doit reprendre'
    print('réglages enregistrés :', pg.evaluate("localStorage.getItem('rts-settings')"))
    # on repart sur la partie de référence (9 bots, graine 7) pour la suite des contrôles
    pg.evaluate('__rts.solo({seed: 7})'); pg.wait_for_timeout(300)
    pg.select_option('#o-quality', 'high') if False else None
    pg.wait_for_timeout(1000)
    pg.screenshot(path=f'{OUT}/2_start.png')
    print('tick après 1,5 s :', pg.evaluate('__rts.S.tick'))

    # --- construction : choisir la scierie, cliquer sur une case à nous
    own = pg.evaluate('(() => { const S = __rts.S; const o = []; for (let c = 0; c < S.owner.length; c++) if (S.owner[c] === 0) o.push(c); return o; })()')
    centre = own[len(own)//2]
    pos = pg.evaluate(f'''(() => {{ const r = document.getElementById('map').getBoundingClientRect(); const v = __rts.view; const W = {206};
      const x = {centre} % W, y = Math.floor({centre} / W); return [r.left + v.tx + (x + .5) * v.k, r.top + v.ty + (y + .5) * v.k]; }})()''')
    print('case centrale', centre, 'à l’écran', [round(x) for x in pos])
    pg.click('.brow[data-build="0"]')
    pg.mouse.move(pos[0], pos[1]); pg.wait_for_timeout(200)
    pg.screenshot(path=f'{OUT}/3_build_ghost.png')
    g0 = pg.evaluate('__rts.S.players[0].gold')
    pg.mouse.click(pos[0], pos[1]); pg.wait_for_timeout(200)
    print('construction : or', int(g0), '->', int(pg.evaluate('__rts.S.players[0].gold')), '| bâtiments :', pg.evaluate('__rts.S.buildings.length'))
    # 2e bâtiment collé : doit être refusé
    pg.mouse.click(pos[0] + 6, pos[1]); pg.wait_for_timeout(150)
    print('toast après pose collée :', pg.inner_text('#toast'))
    pg.keyboard.press('Escape')
    # université et caserne ailleurs (si ressources)
    # --- attaque au pinceau : bord est du territoire, glisser vers l'extérieur
    edge = pg.evaluate('''(() => { const S = __rts.S, W = 206; let best = -1;
      for (let c = 0; c < S.owner.length; c++) if (S.owner[c] === 0 && S.owner[c+1] === -1 && __rts.G && true) { best = c; break; }
      return best; })()''')
    ep = pg.evaluate(f'''(() => {{ const r = document.getElementById('map').getBoundingClientRect(); const v = __rts.view; const W = 206;
      const x = {edge} % W, y = Math.floor({edge} / W); return [r.left + v.tx + (x + .5) * v.k, r.top + v.ty + (y + .5) * v.k, v.k]; }})()''')
    print('bord :', [round(x, 1) for x in ep])
    pg.click('#pct'); pg.keyboard.press('5')
    pg.mouse.move(ep[0] - 5, ep[1]); pg.mouse.down()
    for i in range(1, 16):
        pg.mouse.move(ep[0] + i * 7, ep[1] + (i % 5) * 4 - 8)
    pg.screenshot(path=f'{OUT}/4_painting.png')
    t0 = pg.evaluate('__rts.S.players[0].troops'); c0 = pg.evaluate('__rts.S.players[0].cells')
    pg.mouse.up(); pg.wait_for_timeout(300)
    print('offensive : soldats', int(t0), '->', int(pg.evaluate('__rts.S.players[0].troops')), '| ordres', pg.evaluate('__rts.S.orders.filter(o => o.p === 0).length'))
    print('toast :', pg.inner_text('#toast'))
    pg.wait_for_timeout(2500)
    print('cases', c0, '->', pg.evaluate('__rts.S.players[0].cells'))
    pg.screenshot(path=f'{OUT}/5_attacking.png')

    # --- onglets
    pg.click('#tabs button[data-t="dip"]'); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{OUT}/6_dip.png')
    # alliance : proposer au 1er bot ; avancer le temps pour la réponse
    pg.click('#tabdip button[data-propose]')
    pg.evaluate('__rts.tick(80)'); pg.wait_for_timeout(300)
    print('alliés après proposition :', pg.evaluate('__rts.S.players[0].allies'), '| propositions :', pg.evaluate('JSON.stringify(__rts.S.proposals)'))
    pg.click('#tabs button[data-t="tech"]'); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{OUT}/7_tech.png')
    pg.click('#tabs button[data-t="build"]')

    # --- avance rapide jusqu'à la fin
    pg.evaluate('__rts.tick(6000)'); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{OUT}/8_mid.png')
    pg.evaluate('__rts.tick(20000)'); pg.wait_for_timeout(500)
    print('partie terminée :', pg.evaluate('__rts.S.over'), '| vainqueur :', pg.evaluate('__rts.S.over ? __rts.S.players[__rts.S.winner].name : null'))
    pg.screenshot(path=f'{OUT}/9_end.png')
    b.close()
print('ERREURS :' if errors else 'Aucune erreur console.')
for e in errors: print(' ', e)
