# ECU File Skinner Pro

Application de bureau qui range automatiquement les fichiers de dump ECU bruts
dans une arborescence d'archives hiérarchique, à partir des métadonnées
détectées sur le véhicule et le calculateur.

Déposez un `.bin` (ou `.ori`, `.mod`, `.frf`, `.sgo`, `.kp`) — l'application
détecte la signature du fabricant, les identifiants HW/SW, le VIN et le
protocole, puis classe le fichier dans `Marque/Modèle/ECU/` et l'indexe dans
une base SQLite locale pour la recherche, le marquage et la comparaison.

---

## Téléchargement

Les installateurs pré-compilés pour la v1.0.0 sont disponibles sur la page
des [Releases](https://github.com/anouar1991/ECU-organizer/releases/latest) :

| Plateforme | Fichier | Taille |
|---|---|---|
| Linux (toute distribution) | `ECU.File.Skinner.Pro-1.0.0.AppImage` | 109 Mo |
| Debian / Ubuntu | `ecu-file-skinner-pro_1.0.0_amd64.deb` | 75 Mo |
| Windows 10 / 11 (x64) | `ECU.File.Skinner.Pro.Setup.1.0.0.exe` | 81 Mo |

### Installation — Linux (AppImage)

```bash
chmod +x "ECU.File.Skinner.Pro-1.0.0.AppImage"
./ECU.File.Skinner.Pro-1.0.0.AppImage
```

Aucune installation nécessaire. Au premier démarrage, l'application crée
`~/Documents/ECU_Archive/` pour les fichiers rangés et
`~/.config/ECU File Skinner Pro/` pour la base de données et les réglages.

### Installation — Debian / Ubuntu

```bash
sudo apt install ./ecu-file-skinner-pro_1.0.0_amd64.deb
ecu-file-skinner-pro     # ou via le menu des applications
```

Le paquet dépend des bibliothèques GTK / NSS / xdg-utils standard ;
`apt` les tirera automatiquement.

### Installation — Windows

1. Téléchargez `ECU.File.Skinner.Pro.Setup.1.0.0.exe`.
2. Double-cliquez pour lancer. Windows SmartScreen affichera un avertissement
   indiquant que l'éditeur est inconnu — cliquez sur **Informations
   complémentaires → Exécuter quand même**. Le binaire n'est pas signé avec
   un certificat de signature de code.
3. L'installateur fonctionne en mode utilisateur (pas besoin de droits admin)
   et ajoute un raccourci dans le menu Démarrer.

### Vérifier votre téléchargement

Sommes de contrôle SHA-256 de la v1.0.0 :

```
6a6100b3425304fb960d9249e44160f5aa996d0cb7622c0a7278e62587a9449e  ECU File Skinner Pro-1.0.0.AppImage
4cc675878c5c1566ef93470c371cc9c5ed43479c1ef1f3f479020c89c75e0cb3  ecu-file-skinner-pro_1.0.0_amd64.deb
0ba40e99b5dc228a759e01a17bbf03d1fb23085825ae1178eb64f7ae9636e04d  ECU File Skinner Pro Setup 1.0.0.exe
```

---

## Premier usage

1. **Déposez un fichier** n'importe où sur la fenêtre (ou utilisez
   *File Skinner → Sélectionner des fichiers*). L'analyseur scanne le binaire
   à la recherche de signatures de fabricant, de tokens HW/SW, du VIN et de
   marqueurs de protocole, puis remplit le panneau de métadonnées avec un
   score de confiance (0–100).
2. **Vérifiez** les champs détectés. Quelque chose à corriger ? Modifiez-les
   sur place avant de ranger.
3. **Cliquez sur « Ranger »**. Le fichier est déplacé (ou copié — réglable
   dans Paramètres) vers
   `~/Documents/ECU_Archive/<Marque>/<Modèle>/<ECU>/`, en utilisant le masque
   de nommage défini dans Paramètres (par défaut
   `[BRAND]_[MODEL]_[HW]_[STAGE].bin`).
4. **Retrouvez-le plus tard** depuis la vue *Base de données*. La barre de
   recherche globale accepte un mini-DSL : `brand:audi tag:stage1`,
   `ecu:med17 size:>2mb`, `hw:03L906022 stage:stage2`. Les expressions
   régulières sont acceptées sous la forme `/motif/i`.

### Autres vues

- **Tableau de bord** — indicateurs, top marques, top ECU, activité récente.
- **Étiquettes** — gérer les couleurs et descriptions, fusionner / renommer /
  supprimer ; créer des règles d'étiquetage intelligent qui marquent
  automatiquement les fichiers à l'import.
- **Doublons** — trouver les doublons exacts (MD5) et les quasi-doublons
  (TLSH ≤ 30).
- **Outil Checksum** — calcul du MD5 et de la somme d'octets, aperçu hexa des
  N premiers octets.
- **Comparer** — différence octet par octet entre deux fichiers, mise en
  évidence des régions modifiées, export d'un rapport HTML.
- **Paramètres** — racine de l'archive, masque de nommage, langue
  (Français / English), recherche VIN en ligne, seuil d'auto-rangement,
  mises à jour des données, export / import de la base.

Appuyez sur **Ctrl+K** n'importe où pour ouvrir la palette de commandes et
sauter vers une vue, un filtre ou une étiquette.

---

## Fonctionnalités

- **Glisser-déposer** de fichiers ECU bruts (`.bin`, `.ori`, `.mod`, `.frf`,
  `.sgo`, `.kp`)
- **Détection automatique** des signatures de fabricant (Bosch, Continental,
  Siemens, Delphi, Denso, Marelli, Visteon)
- **Extraction des HW/SW** y compris les numéros de boîtier VAG
- **Décodage VIN** — hors ligne (table WMI) et en ligne optionnel
  (NHTSA vPIC, US/EU)
- **Recherche DTC** — interroge plus de 50 000 codes depuis une base SQLite
  intégrée
- **Heuristiques de protocole** — OBD / BENCH / BOOT à partir de la taille
  du fichier et du contenu
- **Archive hiérarchique** — `Marque / Modèle / ECU / fichier.bin`
- **Masque de nommage personnalisable** — `[BRAND]_[MODEL]_[HW]_[SW]_[STAGE].bin`
  et similaires
- **Base SQLite indexée** avec un DSL de recherche global
- **Gestion des étiquettes** — couleurs, descriptions, règles d'auto-tag
- **Détecteur de doublons** — exact (MD5) et similaire (TLSH, hash sensible
  à la localité)
- **Comparateur de fichiers** — diff binaire, rapport HTML exportable
- **Palette de commandes** — Ctrl+K, recherche floue sur toutes les actions
- **i18n** — Français et English
- **Mise à jour automatique** — vérifie les nouvelles versions sur GitHub
  Releases

---

## Compiler depuis les sources

### Prérequis

- Node.js 20 ou 22 (Electron 33 embarque son propre Node 20).
- Une machine Linux peut produire les trois cibles (Linux natif, Windows via
  Wine, macOS DMG uniquement sur Mac).

### Lancer en mode dev

```bash
git clone https://github.com/anouar1991/ECU-organizer.git
cd ECU-organizer
npm install
npm start
```

`npm install` exécute automatiquement `electron-rebuild` pour que
`better-sqlite3` soit compilé contre l'ABI Node d'Electron.

### Compiler les installateurs

```bash
npm run build:linux   # AppImage + .deb dans dist/
npm run build:win     # installateur NSIS dans dist/ (nécessite wine sous Linux)
npm run build:mac     # DMG dans dist/ (uniquement sur Mac)
```

---

## Tests

Deux suites complémentaires :

```bash
# Tests unitaires / parseur (Vitest, Node natif — rapide, sans affichage)
npm test                          # 36 tests, ~2 s

# Tests UI de bout en bout (Playwright + Electron réel)
npx playwright install chromium   # une seule fois
DISPLAY=:0 npm run test:e2e                                         # avec serveur X
xvfb-run -a --server-args="-screen 0 1280x1024x24" npm run test:e2e # headless

# Débogage interactif
DISPLAY=:0 npm run test:e2e:ui      # interface de test Playwright
DISPLAY=:0 npm run test:e2e:debug   # mode PWDEBUG=1 pas-à-pas

# Autres vérifications
npm run typecheck       # tsc -p jsconfig.json
npm run lint            # ESLint, traite les warnings comme des erreurs
npm run i18n:check      # rapporte les clés de locale manquantes ou inutilisées
```

La suite Playwright lance l'application Electron réelle avec un répertoire
`userData` privé et une racine d'archive temporaire — votre base de données
et `~/Documents/ECU_Archive` ne sont jamais touchés. Les specs sont sous
`tests/e2e/*.spec.js`.

---

## Arborescence du projet

```
src/
  main/                          # processus principal Electron
    main.js                      # point d'entrée, handlers IPC
    preload.js                   # contextBridge → window.api
    ecu-parser.js                # scan des signatures binaires
    database.js                  # schéma + requêtes SQLite
    file-organizer.js            # création de dossiers + renommage
    ecu-comparator.js            # moteur de diff octet par octet
    dtc-lookup.js / vin-lookup.js
    tlsh-pool.js                 # pool de workers TLSH
    workers/tlsh-worker.js
    data-loader.js / data-updater.js
    updater-service.js           # wrapper electron-updater
  renderer/                      # UI côté navigateur (sans build)
    index.html
    styles.css
    js/
      main.js                    # bootstrap
      i18n.js / state.js / helpers.js / toast.js / modal.js
      cmd-palette.js             # palette Ctrl+K
      global-search.js / search-parser.js
      context-menu.js / global-drop.js
      views/
        skinner.js  database.js  tag-management.js  duplicates.js
        checksum.js compare.js   settings.js        dashboard.js
        database/                # panneau de détails, grille, regroupements
    locales/                     # en.json, fr.json
  shared/
    channels.js                  # constantes de noms de canaux IPC
  data/                          # jeux de données embarqués
    dtc.db                       # 50 000+ codes DTC (SQLite)
    bosch_prefix.json
    vag_prefix.json / vag_edc_signatures.json / bosch_ecu_to_make.json
    me7_regions.json / medc17_block_types.json
    wmi.csv / manifest.json
tests/                           # specs Vitest
  e2e/                           # specs Playwright + Electron
tools/i18n-check.js              # vérificateur de cohérence des locales
```

L'archive rangée de l'utilisateur se trouve par défaut sous
`~/Documents/ECU_Archive` (modifiable dans *Paramètres → Dossier racine
d'archive*).

---

## Dépannage

### `Error: The module ... was compiled against a different Node.js version (NODE_MODULE_VERSION 127 vs 130)`

`better-sqlite3` est un module natif (C++) et doit correspondre à l'ABI du
runtime qui le charge. Electron et votre Node natif ont en général des ABI
différentes. Si vous lancez `npm rebuild` ou changez de version de Node, le
binding est recompilé pour Node natif et Electron casse (ou inversement).

Correctif :

```bash
# Pour Electron (lancer l'app, lancer les tests E2E)
npx electron-rebuild -f -w better-sqlite3

# Pour Node natif (lancer Vitest / lint / typecheck)
npm rebuild better-sqlite3
```

Le drapeau `-f` force la recompilation — sans lui, `electron-rebuild` peut
être ignoré à cause d'un cache obsolète. C'est la dernière commande lancée
qui gagne ; relancez l'autre si vous changez de contexte.

### L'AppImage ne se lance pas — `permission denied`

Rendez-le exécutable d'abord :

```bash
chmod +x ECU.File.Skinner.Pro-1.0.0.AppImage
```

### AppImage sur un système sans FUSE

```bash
./ECU.File.Skinner.Pro-1.0.0.AppImage --appimage-extract-and-run
```

### Windows SmartScreen bloque l'installateur

L'installateur Windows n'est **pas signé**. Cliquez sur *Informations
complémentaires → Exécuter quand même*. Si vous préférez vérifier avant
d'exécuter, calculez le SHA-256 du `.exe` téléchargé et comparez-le à la
valeur de la section [Vérifier votre téléchargement](#vérifier-votre-téléchargement)
ci-dessus.

### Tout réinitialiser

L'application stocke sa base de données et ses réglages dans :

- Linux : `~/.config/ECU File Skinner Pro/`
- Windows : `%APPDATA%\ECU File Skinner Pro\`
- macOS : `~/Library/Application Support/ECU File Skinner Pro/`

Supprimez ce dossier pour repartir à zéro. Vos fichiers rangés sous
`~/Documents/ECU_Archive` ne sont pas touchés.

---

## Pile technique

- **Electron 33** (`contextIsolation: true`, bridge preload, renderer
  quasi-sandbox)
- **better-sqlite3** pour l'index local et la base DTC embarquée
- **TLSH** (hash sensible à la localité) pour la détection des quasi-doublons
- **magic-bytes.js** pour la détection du type de fichier
- Renderer en JS pur — pas d'étape de build, pas de bundler, pas de framework
- **Vitest** + **Playwright/Electron** pour les tests
- **electron-builder** pour le packaging, **electron-updater** pour la mise
  à jour automatique

---

## Licence

MIT — voir [LICENSE](LICENSE) si présent, ou le champ `license` dans
[`package.json`](package.json).
