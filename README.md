# Project Bêta — prototype v0.3

RTS web, dans l'esprit d'OpenFront : une carte de France en pixels (cases de 6 km), vous + 9 bots, conquête par zone
avec un pourcentage de puissance, bâtiments posés sur la carte, université, alliances.

## Jouer
Double-cliquer sur `Project-Beta.html` (un seul fichier, aucune installation) → menu **Solo / Multijoueur / Paramètres**.

- **Solo** : pseudo, nombre de bots (1 à 9), durée maximale (10 min à illimitée), pseudo + difficulté (facile / normal / difficile) de chaque bot, graine facultative. Le style de chaque bot (équilibré, guerrier, marchand, technologue) est indiqué.
- **Paramètres** : effets sonores (on/off, volume), qualité graphique (Détaillée / Économe pour PC modestes), 30 ou 60 images/s, noms sur la carte, plein écran. Enregistrés dans le navigateur.
- **Multijoueur** : voir ci-dessous.

## Multijoueur
**Accessible sans l'hôte** : voir `DEPLOIEMENT.md` (serveur gratuit chez Render, `render.yaml` fourni). La section ci-dessous décrit l'hébergement sur son propre PC.

### Hébergement sur son PC (connexion directe, sans compte)
Un petit serveur tourne sur le PC de l'**hôte** ; les amis s'y connectent avec leur navigateur.

1. **Hôte** : installer [Node.js](https://nodejs.org) (version LTS), puis double-cliquer sur `Lancer-serveur.bat`
   (ou `node serveur.cjs`, port 8080 par défaut, `node serveur.cjs 9000` pour un autre). La fenêtre affiche les adresses à donner.
   Le navigateur de l'hôte s'ouvre sur `http://localhost:8080`.
2. **Amis** : ouvrir l'adresse affichée (`http://<IP de l'hôte>:8080`) dans leur navigateur, ou ouvrir leur copie de
   `Project-Beta.html` et taper l'adresse dans Multijoueur → « Adresse du serveur ». Rien d'autre à installer pour eux.
3. Tout le monde clique **Multijoueur → Se connecter**. Le premier arrivé est l'hôte du salon : il règle le nombre de bots, leurs noms/difficultés,
   la durée, puis **Lance la partie**. Jusqu'à 10 joueurs au total (humains + bots).

**Réseau** : même réseau local (Wi-Fi/box) → l'adresse IP locale suffit. Par Internet → soit un VPN gratuit (Tailscale, Radmin VPN, Hamachi) avec l'IP du VPN,
soit une redirection du port TCP 8080 de la box vers le PC de l'hôte (Windows peut demander d’autoriser Node.js dans le pare-feu : accepter) puis l'IP publique de l'hôte.

**Fonctionnement** : le serveur ne simule rien, il ordonne les commandes de chacun et les rediffuse (tours de 0,2 s) ; chaque navigateur calcule la même partie
(simulation déterministe). Toutes les 10 s de jeu, les clients comparent l'empreinte de l'état ; une différence est signalée.
Un joueur qui se déconnecte est repris par une IA. Pas de pause ni d'accéléré en multijoueur ; on ne peut pas rejoindre une partie en cours.

## Commandes
| Action | Comment |
|---|---|
| Choisir la puissance | curseur en bas, ou touches **1-9** (10-90 %) et **0** (100 %) |
| Attaquer | mode ⚔ (touche **A**) : **glisser à la souris pour surligner** la zone ; au relâchement l'offensive part. Un simple clic attaque un petit disque. Taille du pinceau : **[ ]** ou ± |
| Bâtir | onglet « Bâtir » : choisir un bâtiment, puis cliquer sur son territoire (Échap pour finir) |
| Diplomatie | onglet « Diplomatie » : proposer / accepter / refuser / rompre / renouveler |
| Déplacer la carte | clic droit glissé, ou mode ✋ (**H**), ou WASD / flèches · molette = zoom |
| Temps (solo) | **Espace** pause · boutons 1×–8× · **, .** changent la vitesse |
| Menu | **Échap** (ou bouton ☰ Menu) : reprendre, paramètres, quitter |

## Règles
- **Territoire** : chaque case a un propriétaire. On conquiert par ordres d'attaque : la zone surlignée est grignotée case par case, depuis votre frontière (ou depuis un port, voir plus bas), jusqu'à épuisement des soldats engagés (le reste revient).
- **Soldats** : une seule réserve par joueur. Elle remonte toute seule (plus vite vers le milieu, plafond selon la taille du territoire et les casernes). Engager 40 % = 40 % de la réserve part dans l'offensive.
- **Combat** : le résultat n'est jamais annoncé. Une case neutre coûte peu ; une case adverse coûte d'autant plus que le défenseur a de soldats *par case*, qu'il a une forteresse à proximité, des alliés et des technologies de défense. Plus votre empire est grand, plus chaque offensive coûte. Le défenseur perd des soldats à chaque case perdue. Éliminé = plus aucune case.
- **Or** : rapporte chaque case possédée, plus Marchés et Ports. Sert à bâtir et à mobiliser des soldats (3 or l'unité).
- **Bâtiments** (au moins 3 cases entre deux) : Scierie, Mine de fer, Mine de charbon, Puits de pétrole, Station de pompage, Mine de terres rares (chacun produit sa ressource) ; **Université** (jauge de technologie) ; **Caserne** (plus de soldats) ; **Port** (débarquement sur une côte à moins de 40 cases d'un port : c'est le seul moyen d'atteindre la Corse) ; **Forteresse** (défense ×1,8 dans un rayon de 8 cases) ; **Marché** (or). Le coût de chaque exemplaire supplémentaire d'un même type augmente. Un bâtiment appartient à celui qui possède sa case.
- **Technologie** : chaque Université remplit une jauge ; 8 niveaux automatiques (or, soldats, défense, production, attaque…).
- **Alliances** : jusqu'à 3. Un allié ne peut pas vous attaquer, +6 % d'or et +10 % de recherche par allié, 15 % de ses soldats s'ajoutent à votre défense quand on vous attaque. Elles durent 6 minutes et se renouvellent dans les 90 dernières secondes. Rompre = les bots se méfient de vous 8 minutes.
- **Points de victoire — le premier à 15 PV gagne** (ou le plus de PV au bout de 45 min) :
  - +1 par **région** (13 régions) dont vous contrôlez plus de la moitié, la première fois ;
  - +1 au **premier** joueur à atteindre chaque niveau de technologie (8) ;
  - +1 par **ressource** dont vous avez le plus de bâtiments (minimum 2) (6) ;
  - +1 par **titre** : plus grand territoire, plus puissante armée, plus gros revenu (3).

> Pourquoi 15 et pas 30 : il n'existe que 13 + 8 + 6 + 3 = 30 PV en tout sur la carte ; exiger 30 reviendrait à tout rafler.
> La cible est `BALANCE.VP_TARGET` dans `src/core/config.ts`.

## Équilibrage mesuré (simulations de bots, `npm test`)
Parties 10 bots : durée médiane ≈ 22 min (13 à 38 min). Les PV du vainqueur viennent à ≈ 32 % des régions, 37 % des ressources,
18 % de la technologie, 13 % des titres. Les quatre profils de bots (équilibré, guerrier, marchand, techno) ont des PV moyens
voisins à 20 min. Le profil « équilibré » gagne plus souvent que sa part (≈ 70 % des victoires pour 40 % des joueurs).
Les paramètres sont tous dans `src/core/config.ts`.

## Développer
```
npm install
npm run build        # régénère Project-Beta.html ET serveur.cjs à la racine
npm run typecheck
npm test             # règles, invariants, déterminisme, parties complètes de bots
node tools/run_ts.mjs tests/net.test.ts    # serveur + 3 clients : états identiques, usurpation refusée, déconnexion
node tools/run_ts.mjs tests/opts.test.ts   # options solo
python3 tools/wake_check.py                # client qui se connecte avant que le serveur ne soit réveillé (nombre de bots, durée, difficulté)
node tools/run_ts.mjs tests/personas.ts 12 20     # comparer les profils de bots
node tools/run_ts.mjs tests/sweep.ts 8 35 '[["essai",{"NEUTRAL_COST":5}]]'   # comparer des réglages
python3 tools/build_grid.py <departements.geojson> <regions.geojson> <ne_50m_admin_0_countries.geojson> src/core/griddata.json
python3 tools/ui_check.py /tmp/captures       # test de l'interface dans Chromium (Playwright)
python3 tools/multi_check.py /tmp/captures    # 2 navigateurs sur le vrai serveur
```

## Structure
- `src/core/` simulation **déterministe**, sans DOM ni réseau (réutilisable telle quelle côté serveur pour le multijoueur) :
  `config.ts` (réglages) · `sim.ts` (règles, commandes, économie) · `bots.ts` (IA) · `world.ts` (grille) · `game.ts`
- Les joueurs et les bots émettent les mêmes **commandes** (`attack`, `build`, `draft`, `trade`, `propose`/`accept`/`refuse`/`break`, `recall`).
- `src/client/` rendu canvas pixelisé (`main.ts`), pictogrammes (`sprites.ts`), menu (`menu.ts`), réseau (`net.ts`), sons synthétisés (`audio.ts`), préférences (`settings.ts`).
- `server/serveur.ts` → `serveur.cjs` : relais lockstep + service du HTML (module `ws` inclus, aucune installation côté hôte à part Node).

## Données
- Départements et régions : dépôt gregoiredavid/france-geojson (contours IGN Admin Express COG 2018, noms et codes INSEE ; licence : voir les conditions d'Admin Express, Licence Ouverte Etalab).
- Pays voisins (mer / terre étrangère) : Natural Earth 1:50m, domaine public.
- Les noms de départements ne servent qu'à l'infobulle ; les régions servent aux PV.

## Limites connues
- Le déterminisme est vérifié entre Chromium/Node (moteur V8). Firefox et Safari n'ont pas été testés : en cas de différence de calcul, le jeu affiche « désynchronisation ».
- Pas de reconnexion à une partie en cours, pas de spectateur, pas de chat.
- Les commandes du multijoueur passent par le serveur (≈ 0,2 s + ping) avant d'agir.

## Pas encore fait
Flottes et conquête navale au-delà du débarquement, gisements géographiques, mobile/tactile, sauvegarde, musique.
