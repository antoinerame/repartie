# Répartie

Des arbres de débat pour s'entraîner aux discussions politiques : ce que tu dis, ce qu'on te répond, et ce que tu réponds à ça. Claude peut les lire et les compléter tout seul grâce à un serveur MCP intégré.

## Ce qu'il y a dedans

- **Sujets → sous-parties → arbre horizontal** : chaque argument répond à son parent, coloré selon le camp (« Moi » / « En face »).
- **Fiche d'argument** : phrase choc, développement, type (fait, valeur, exemple, sophisme), solidité, sources, point à concéder.
- **Trous** : les arguments adverses sans réponse sont signalés partout et listés sur une page dédiée.
- **Entraînement** : on t'oppose un argument, tu réponds, tu compares, tu t'évalues. Les répliques ratées reviennent plus vite (répétition espacée).
- **Fiche antisèche** par sous-partie, imprimable et lisible sur téléphone.
- **Arguments réutilisables** : un même argument peut être lié dans plusieurs arbres.
- **Inverser les camps** : si tu changes d'avis, un bouton échange « Moi » et « En face ».
- **Recherche globale** (Ctrl K), **export / import JSON**, thème clair et sombre.
- **MCP** : Claude ajoute les arbres pendant vos discussions, le site se met à jour en direct.

## Installation sur un serveur (Docker)

```bash
cp .env.example .env
```

Remplis `APP_PASSWORD` (mot de passe du site) et `MCP_TOKEN` (jeton pour Claude, par exemple le résultat de `openssl rand -hex 32`), puis :

```bash
docker compose up -d --build
```

Le site écoute sur le port 3000 (modifiable avec `PORT` dans `.env`). Les données vivent dans le volume Docker `repartie-data` (un fichier SQLite).

Place-le derrière ton reverse proxy habituel (Caddy, Traefik, nginx) **en HTTPS** : le mot de passe et le jeton circulent dans les requêtes. Avec nginx, désactive la mise en tampon pour `/api/events` et `/mcp` (`proxy_buffering off;`).

Mise à jour :

```bash
docker compose up -d --build
```

## Brancher Claude

Le point d'accès MCP est `https://ton-domaine/mcp` (Streamable HTTP). Deux façons de s'authentifier :

- en-tête `Authorization: Bearer <MCP_TOKEN>` ;
- ou jeton dans l'adresse : `https://ton-domaine/mcp/<MCP_TOKEN>` (pour les clients qui ne permettent pas d'en-tête).

**claude.ai, appli bureau et mobile** : Réglages → Connecteurs → Ajouter un connecteur personnalisé, avec l'adresse `https://ton-domaine/mcp/<MCP_TOKEN>`.

**Claude Code** :

```bash
claude mcp add --transport http repartie https://ton-domaine/mcp --header "Authorization: Bearer <MCP_TOKEN>"
```

Ensuite, en discussion :

- « Enregistre dans Répartie l'arbre de ce qu'on vient de voir sur les retraites. »
- « Trouve les trous dans mon sujet Nucléaire et propose-moi des réponses. »
- « Joue l'adversaire sur la semaine de 4 jours, puis ajoute ce qu'on a découvert. »

Outils exposés : `list_topics`, `get_tree`, `search`, `find_gaps`, `create_topic`, `create_subtopic`, `add_argument`, `add_arguments`, `link_argument`, `update_argument`, `move_argument`, `delete_argument`.

## Développement local

```bash
npm install
```

```bash
npm run dev
```

L'interface est sur http://localhost:5173 (Vite), l'API et le MCP sur http://localhost:3000. Sans `APP_PASSWORD` ni `MCP_TOKEN`, tout est ouvert : à réserver au poste local.

Structure : `server/` (Express, SQLite via `node:sqlite`, MCP), `web/` (React + Vite). Node 22.13 ou plus récent.

## Sauvegarde

Réglages → Exporter tout produit un fichier JSON complet, réimportable (en ajout ou en remplacement). Tu peux aussi sauvegarder directement le volume `repartie-data`.
