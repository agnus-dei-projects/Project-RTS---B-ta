# Héberger le jeu en ligne (accessible sans l'hôte)

Le serveur (`serveur.cjs`) est un petit programme Node sans dépendance. Hébergé chez Render, tes amis jouent via une adresse
du type `https://project-beta.onrender.com` : ils ouvrent le lien, **Multijoueur → Se connecter**, et le premier connecté
règle et lance la partie. Personne n'a besoin de ton PC.

## Ce que dit la documentation Render (offre gratuite, vérifié le 08/10/2026)
- Le service **s'endort après 15 min sans trafic entrant** ; le réveil prend **environ 1 minute** (la première personne attend).
- Depuis le 24/02/2026, les **messages WebSocket** d'une connexion existante comptent comme du trafic : une partie en cours ne l'endort pas.
  Le client envoie en plus un message toutes les 25 s tant qu'il est dans le salon.
- 750 heures d'instance gratuites par mois et par espace de travail ; Render peut **redémarrer** le service à tout moment (une partie en cours serait alors interrompue) ;
  pas de disque persistant (le jeu n'en a pas besoin : rien n'est sauvegardé).
- HTTPS fourni automatiquement ; le jeu passe donc en `wss://` tout seul.
- La bande passante sortante est limitée (le montant n'est pas précisé sur la page) : une partie à 10 joueurs consomme très peu (messages de quelques Ko).

Sources : https://render.com/docs/free · https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages · https://render.com/docs/blueprint-spec · https://render.com/docs/infrastructure-as-code

## Étapes (≈ 10 min, à faire une seule fois)
1. **GitHub** : crée un dépôt (privé ou public) et envoie-y le contenu du dossier `Project RTS` (le fichier `.gitignore` exclut `node_modules`).
   Sans ligne de commande : sur la page du dépôt, « Add file → Upload files », puis glisser les fichiers/dossiers.
   Les fichiers compilés `Project-Beta.html` et `serveur.cjs` **doivent** faire partie de l'envoi.
2. **Render** (https://dashboard.render.com) : crée un compte, connecte ton compte GitHub, puis **New → Blueprint**, clique **Connect** à côté du dépôt,
   garde la branche, puis **Deploy Blueprint**. Le fichier `render.yaml` du dépôt décrit tout (offre `free`, région Francfort, démarrage `node serveur.cjs`).
3. Quand le déploiement est terminé, Render affiche l'adresse du service (`https://….onrender.com`) : c'est le lien à donner à tes amis.
4. *(Facultatif mais conseillé)* **Code d'accès** : sans lui, toute personne qui trouve l'adresse peut entrer dans ton salon.
   Dans le service Render → **Environment** → ajoute la variable `ACCESS_CODE` avec le mot de passe de ton choix ; tes amis le saisissent dans
   Multijoueur → « Code d'accès ».

## Utilisation
- Amis : ouvrir le lien (ou taper `xxx.onrender.com` dans le champ Adresse d'une copie locale du HTML). Si le service dort, l'écran affiche « le serveur ne répond pas encore… »
  et réessaie tout seul pendant 90 s.
- Mettre à jour le jeu : modifier le code, `npm run build`, renvoyer `Project-Beta.html` et `serveur.cjs` sur GitHub ; Render redéploie automatiquement (`autoDeployTrigger: commit`).
- Un seul salon par serveur : une partie à la fois. Si tout le monde quitte, le salon se réinitialise.

## Empêcher l'endormissement (facultatif)
Render endort le service gratuit après 15 min sans trafic **entrant** ; une requête HTTP ou une nouvelle connexion WebSocket le remet en route. Un service externe qui appelle
`https://VOTRE-SERVICE.onrender.com/healthz` toutes les 5 à 10 minutes l'empêche donc de dormir :
- **UptimeRobot** (offre gratuite : 50 moniteurs, intervalle 5 min) : créer un moniteur « HTTP(s) » sur l'adresse `/healthz`.
- ou **cron-job.org** (gratuit, jusqu'à 1 exécution par minute) : un job GET sur la même adresse.
Attention :
- Pinger **`/healthz`** (ou `/`), jamais `/robots.txt` : quand le service dort, Render répond lui-même à `/robots.txt` sans le réveiller (source : doc Render ci-dessus).
- Éveillé 24 h/24, le service consomme ≈ 744 h sur les 750 h gratuites du mois (espace de travail entier) : un seul service gratuit permanent ; au-delà, Render suspend les services gratuits jusqu'au mois suivant.
- Render peut quand même **redémarrer** le service à tout moment : une partie en cours peut être coupée. Seule l'offre payante supprime l'endormissement par conception.
- Un service qui s'appellerait lui-même ne peut pas se réveiller : quand il dort, plus aucun code ne tourne chez lui.

## Si Render ne convient pas
Le serveur tourne partout où Node 18+ existe : `node serveur.cjs` (port via la variable `PORT`, 8080 par défaut), ou un petit VPS.
D'autres hébergeurs existent (Fly.io, Railway…) mais je n'ai pas vérifié leurs offres gratuites actuelles.
