# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for the HomeWizard Energy devices
(P1 Meter, Energy Socket, kWh meters, Watermeter, Plug-In Battery), read over
their official local API (v1 HTTP, v2 HTTPS with a token): a Node.js service
(Node 22+, ESM, no build step) that runs in its own sandboxed Docker container
and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/devices.test.js          # one file
node --test --test-name-pattern "plug"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (registerHandlers + shutdown)
src/app.js                        every SDK handler, wired to the hub (the tests use it too)
src/hub.js                        HomeWizardHub: discovery, polling, states, commands, pairing, triggers
src/devices.js                    HomeWizard device -> Gladys device: features, names, values, commands
src/discovery.js                  mDNS records relayed by the core -> devices to read
src/homewizard/client.js          HTTP/HTTPS client of the local API v1/v2, certificate check, errors
src/homewizard/model.js           product families, v1 -> v2 value names (python-homewizard-energy)
src/homewizard/cacert.js          the HomeWizard CA (v2 device certificates)
src/triggers.js                   grid power thresholds (scene triggers), re-arm margin
src/scenes.js                     scene action handlers (manifest `scene_actions`)
src/widgets.js                    dashboard widget handlers (manifest `widgets`)
src/texts.js                      connection status, action reports and errors, four languages
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/store.js                      /data/homewizard-state.json (devices, tokens; atomic writes, mode 600)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/{en,fr,de,es}.md             user documentation, re-hosted by Gladys (en and fr mandatory)
test/                             node --test, against the SDK's fake Gladys and fake HomeWizard devices
test/fixtures/homewizard/         real answers (python-homewizard-energy, Home Assistant), v1 and v2
test/fixtures/tls/                TEST CA and device certificates (tests and fake device only)
tools/fake-homewizard.mjs         a simulated HomeWizard device, v1 HTTP and v2 HTTPS (dev, tests, Docker)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is in four languages (English, French, German with
  "du", Spanish with "usted"): manifest texts, action and widget messages,
  feature names, and `docs/{en,fr,de,es}.md` with the same sections.
  `test/i18n.test.js` checks them.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

---

# Notes du mainteneur (guim31)

Ce qui suit complète les règles du template ci-dessus. Ce sont des faits vérifiés dans le code du
cœur Gladys ou payés sur les intégrations déjà publiées par guim31. Ils ne se lisent pas dans le
code de ce dépôt. Compléter ce fichier quand un nouveau piège est découvert.

## Travailler sur ce dépôt

- Mêmes étapes que la CI, dans le même ordre : `npm ci`, `npm run format:check`, `npm run lint`,
  `npm test`. Prettier contrôle **aussi le Markdown** : lancer `npm run format` après avoir
  modifié ce fichier, le README ou la documentation, sinon la CI tombe.
- Une session de code n'a **ni instance Gladys ni appareil réel**. La suite de tests, le lint et
  le validateur du store sont les seules vérifications possibles : le test réel se fait ailleurs.
  Le dire, plutôt que de conclure que « ça marche ».
- **Tout le code de démonstration du template disparaît** : station météo, prise, lampe, caméra,
  capteur de mouvement, `src/weather.js`, leurs tests, leurs entrées du manifeste et de la
  documentation. Il ne reste que ce que l'intégration fait vraiment.
- **Publier n'est jamais le travail d'une session de code** : ni Release, ni tag, ni topic, ni
  version modifiée à la main. L'orchestrateur s'en charge une fois la PR fusionnée. Les workflows
  sont ceux du template : ne pas les modifier.
- Le dépôt est **public** : aucun secret, aucune adresse ni détail d'infrastructure privée, ni
  ici, ni dans les tests, ni dans les captures.

## Pièges du cœur Gladys

**Appareils et fonctionnalités**

- **Polling** : le planificateur n'interroge un appareil que si `should_poll: true` **et**
  `poll_frequency` vaut une valeur de la liste fixe, **en millisecondes** (1000, 2000, 10000,
  15000, 30000, 60000). Le template publie `poll_frequency: 300` sans `should_poll` : c'est faux,
  le cœur répond 400 à la découverte. Pour une cadence hors liste, publier `should_poll: false` et
  pousser les états depuis le conteneur, en gardant un `onPoll` de repli.
  Le cœur 5.2.0 ne sonde rien sans `should_poll: true` (GladysAssistant/Gladys#3198, correctif
  #3199), et les appareils **déjà créés** sans `should_poll` ne seront jamais sondés, même après
  correction : ne jamais compter sur le seul `onPoll`. Ici, minuteur interne du hub, prouvé par
  `test/logs.test.js` (« without any poll from Gladys »).
- **Logs** : au niveau info, le cycle de vie seulement (démarrage, appareil trouvé / perdu /
  revenu, jumelage). Pas de ligne par lecture ni par état ; une erreur qui se répète à chaque
  lecture (certificat, découverte, publication refusée, `/data`) est écrite une fois, puis une fois
  au rétablissement (`test/logs.test.js`). Le reste en debug (`LOG_LEVEL=debug`).
- **`min` et `max` sont NOT NULL** dans `t_device_feature`, y compris pour `text/text` : sans eux,
  « Ajouter à Gladys » échoue en HTTP 422. Mettre 0/0, comme Zigbee2MQTT.
- Un état publié sur une fonctionnalité **pas encore ajoutée** dans Gladys reçoit un 200 puis est
  jeté (simple ligne de log) : republier les états dans `onDeviceCreated`.
- `level-sensor/decimal` n'existe pas côté serveur. `light-sensor/binary` n'a pas de libellé dans
  le front (pastille vide) : préférer `input/binary`. Un `text/text` reçoit `{ text }`, jamais
  vide, sinon l'état est ignoré.
- **Détecteur d'ouverture (`opening-sensor`) : 0 = ouvert, 1 = fermé** (`OPENING_SENSOR_STATE`), à
  l'inverse de l'intuition et des autres détecteurs (mouvement, fuite, fumée : 1 = détecté). Une
  porte ouverte publiée à 1 s'affiche « Fermé » et fausse scènes et historique. Le figer par un test.
- **Un `external_id` de fonctionnalité ne change jamais d'appareil** d'une version à l'autre. UniFi
  1.5.2 avait sorti les ports PoE dans un appareil dédié, la 1.6.0 les a remis dans la passerelle avec
  les mêmes identifiants : ceux qui avaient ajouté l'appareil dédié ne peuvent plus « Mettre à jour » la
  passerelle (409 `external_id must be unique`). Pour regrouper, garder l'appareil existant
  (`gladys.getDevices()`) ou changer d'identifiant.
- Les **noms de fonctionnalités sont figés à la création**. Et quand une fonctionnalité est seule
  de son type sur l'appareil, le tableau de bord affiche le libellé générique du type à la place
  du nom publié.
- **Aucune commande d'appareil ne permet un choix multiple** : un `text/select` n'a qu'un choix
  actif.
- Un changement de structure fait proposer « Mettre à jour » dans l'onglet Découverte
  (`structure_changed`). Un changement des seules `supported_options` ne le déclenche pas.
- **Jauge** : l'aiguille se place par `(value - min) / (max - min)` des bornes de la
  fonctionnalité. `gauge_min`/`gauge_max` ne pilotent que les couleurs, et le cœur n'applique
  jamais `min`/`max` en écriture : ce sont des bornes d'affichage. Une valeur signée exige des
  bornes symétriques.
- Le cœur plafonne à **300 états par minute** et réévalue les scènes à chaque état : ne publier
  que les changements.
- Une intégration `device` ne reçoit pas la langue de l'utilisateur, une action de scène non
  plus (un widget, si) : prévoir un champ de config `language` si des textes partent du
  conteneur. Le superviseur injecte `TZ`, le fuseau de Gladys. La sandbox est limitée à 256 Mo.

**Formulaires de configuration et actions**

- Les champs `number` sont rendus **sans `step`** : le navigateur n'accepte alors que `min + k`.
  Min et défaut **entiers** seulement ; une valeur décimale passe par un `select` ou par un
  `string` parsé (virgule acceptée).
- Un champ `secret` dans les `fields` d'une **action** est impossible à remplir, et une action
  n'applique **aucun `default`** tout en exigeant les champs `required` (422). Issues
  GladysAssistant/Gladys#3154 et #3155.

**Widgets, déclencheurs, actions de scène (SDK ≥ 0.14, Gladys ≥ 5.1)**

- **Cibler la dernière version publiée du cœur, pas `master`** : la spec de `master` décrit des
  fonctions non publiées. Les boutons de widget qui ouvrent un formulaire (#3168, commit 3feb2cf8)
  sont absents de la 5.1.4 mais **livrés dans la 5.2.0** (sortie le 12/10/2026) : `gladys_version`
  `>=5.2.0` si on s'en sert, ou un bouton direct en repli. Vérifier par `git tag --contains`.

- Un réglage de widget ne propose en liste que les **appareils** de l'intégration
  (`source: "devices"`, seule source dynamique).
- Budget du cœur : **8 composants par widget, dont 2 textes au plus**, appliqué **avant** la
  résolution des références ; un contenu amputé reste en cache jusqu'au TTL. Appeler
  `requestWidgetRefresh` à la création d'un appareil. `validateWidgetContent` est exporté pour les
  tests, mais ne vérifie pas que les `external_id` liés existent : les croiser avec `buildDevice`.
- Une ligne de `status` exige un `value` (nombre ou texte ≤ 40).
- Le cœur **jette un bouton dont la clé d'action est déjà prise** : clés numérotées.
- Le vocabulaire des widgets n'a ni liste ni curseur, **par choix** du cœur. Seul un bouton
  `device_feature` numérique a un état actif natif.
- **En mode sombre, le style `primary` d'un bouton de widget ne se voit pas** (#3153) : signaler
  un choix courant par l'icône (`check-circle`), jamais par le style.
- Dans une grille `card-list`, la `date` s'affiche **à la place** du sous-titre.
- `onWidgetAction` fait recharger le widget dès la résolution, alors que `requestWidgetRefresh`
  est plafonné à un appel toutes les 10 s. Un toast d'action est tronqué à 200 caractères.
- Le cœur met le contenu d'un widget en cache par (réglages, langue, unités) : pré-localiser
  d'après `language` est correct.
- Les filtres de scène ne font qu'égalité et appartenance : un seuil reste le travail d'un capteur.
- **Les clés de widgets, de déclencheurs et d'actions sont figées une fois publiées.**
- `gladys_version` `>=5.1.0` dès qu'il y a widgets, déclencheurs ou actions de scène.

## Store

- Validateur officiel, depuis la racine : `npx -y github:GladysAssistant/integration-store .`
  (schéma, `description` **100 caractères au plus par langue**, documentation de 300 caractères
  au moins, image Docker, cover de **150 Ko au plus**). Il demande Node ≥ 24 mais tourne sous
  Node 22 avec un avertissement.
- L'indexeur lit le manifeste de la **dernière release**, pas celui de `main` : une correction du
  manifeste (catégorie, description…) n'atteint le store qu'avec une release.
- L'indexeur rejette **en silence** : la raison n'apparaît que dans `rejected.json`, à côté de
  `https://integration-store-storage.gladysassistant.com/index.json`.
- **Image de base** : `FROM public.ecr.aws/docker/library/node:…` (miroir officiel ECR Public, même
  empreinte) et non `node:…` de Docker Hub, qui refuse en 429 les pulls anonymes des runners GitHub
  dès qu'il y a plusieurs builds à la fois. Un échec 429 dans le job « Docker build » n'est pas un bug
  du code. Même parade dans `.github/workflows/build.yml` (posée par l'orchestrateur, ne pas la
  retirer) : QEMU et BuildKit tirés de `mirror.gcr.io`.
- La règle `data/` du `.gitignore` du template (pour le volume `/data`) exclut aussi `src/data/` :
  l'ancrer en `/data/`, dans `.prettierignore` aussi.

### Langues (depuis le 11/10/2026)

Tout texte montré à l'utilisateur existe en **`en`, `fr`, `de` et `es`** : manifeste, contenu des widgets, messages,
noms de fonctionnalités. L'allemand **tutoie** (« du »), l'espagnol **vouvoie** (« usted ») : décision de Guilhem,
appliquée à ses 21 intégrations. `test/i18n.test.js` doit échouer sur une langue manquante, un texte vide ou trop
long, et sur un « Sie »/« Ihr… » de politesse en allemand. Le store exige `docs/en.md` et `docs/fr.md`
(`DOCS_LANGUAGES`) et publie aussi `docs/de.md` et `docs/es.md` quand ils existent
(`DOCS_OPTIONAL_LANGUAGES` d'integration-store) : écrire les quatre, avec les mêmes sections.

## Choix par défaut de Guilhem (12/10/2026)

- Langue par défaut des noms de fonctionnalités et des textes produits par le conteneur : **`fr`**.
- Fichier `LICENSE` Apache-2.0 (texte complet) à la racine.
- `transports` : `local` seul quand le cloud n'est qu'une option annexe.
- Docs `en`, `fr`, `de`, `es` avec les mêmes sections.
- Chauffe, ouverture, sécurité : ne rien rendre pilotable « comme un thermostat » ou par un assistant
  vocal quand une erreur serait dangereuse (leçon d'OctoPrint).

## HomeWizard (gladys-homewizard)

**API locale** (références : python-homewizard-energy, Apache-2.0, l'intégration `homewizard` de Home
Assistant, api-documentation.homewizard.com)

- **v1** : HTTP port 80, sans authentification, à activer par appareil dans l'application
  (« API locale »). `GET /api` (modèle, série, firmware), `GET /api/v1/data`, `GET`/`PUT
/api/v1/state` (prise : `power_on`, `switch_lock`, `brightness` 0-255), `PUT /api/v1/identify`
  (pas sur les compteurs kWh). API coupée : **403** sur tout, `/api` compris.
- **v2** : HTTPS port 443, en-têtes `Authorization: Bearer <jeton>` et `X-Api-Version: 2`. Jeton :
  `POST /api/user {"name":"local/gladys"}` répond 403 `user:creation-not-enabled` jusqu'à l'appui
  sur le bouton, puis le jeton pendant 30 s (redemander avec le même nom remplace l'ancien). Sans
  jeton, `GET /api` répond **401** : c'est le test « a une API v2 ». `GET /api/measurement`,
  `GET /api/system` (`wifi_rssi_db`), `PUT /api/system/identify`.
- **Certificat v2** : signé par la CA HomeWizard (« Appliance Access CA », auto-signée, valable
  jusqu'en 2031, dans `src/homewizard/cacert.js`), nom commun `appliance/<id>/<série>` où `<id>`
  n'est **pas** le type de produit (`p1dongle`, `energysocket`, `energymeter`, `watermeter`,
  `battery`). Le nom d'hôte n'est jamais vérifié (c'est une IP) : `checkServerIdentity` compare le
  CN au nom attendu. Le jeton n'est envoyé qu'après cette vérification (test « rogue »).
- **v2 selon les produits** (doc officielle, octobre 2026) : P1, compteurs kWh, Plug-In Battery
  (v2 seule). Energy Socket, Watermeter, Energy Display : v2 « en développement », v1 seule.
- Les noms v1 et v2 diffèrent (`total_power_import_kwh` / `energy_import_kwh`…) :
  `normalizeMeasurement` ramène tout aux noms v2. Vieux firmware P1 : pas de total, seulement
  `_t1`/`_t2` (on additionne), gaz dans `total_gas_m3` au lieu de la liste `external`. Le courant
  par phase du P1 est **signé** (sens) : publié en valeur absolue.
- mDNS : `_hwenergy._tcp` (v1, TXT `api_enabled`, `serial`, `product_type`) et `_homewizard._tcp`
  (v2, TXT `serial`, `product_type`, `id`). Un appareil annoncé seulement en v2 n'a peut-être pas
  de v1 : ne pas l'y lire (`versionOf`). Watermeter sur piles : dort, ne répond pas.

**Gladys**

- Couples énergie choisis d'après le cœur v5.1.0/v5.2.0 (`ENERGY_INDEX_FEATURE_TYPES`,
  `PRODUCTION_INDEX_FEATURE_TYPES`, `addEnergyFeatures`) : seuls `energy-sensor/index|energy`,
  `switch/energy` (consommation) et `energy-production-sensor/index` (production) sont dérivés en
  consommation/coût. Le P1 publie donc son index d'import total en `energy-sensor/index` ; les
  index par tarif et l'export en `grid-sensor/*` (affichés, jamais recomptés). La puissance
  importée du P1 est son `energy-sensor/power` : le cœur 5.2 y lit les pointes d'un compteur
  (`getMeterPowerFeature`, tarifs à la puissance). L'export d'un compteur kWh est de la production.
- `grid-sensor`, `battery-storage`, `volume-sensor`, `child-lock` existent dès la 5.1.0 :
  `gladys_version >=5.1.0`.
- Débit du Watermeter : seul `water-valve/flow` porte le libellé « Débit d'eau », en m³/h (pas
  d'unité L/min dans Gladys) : ×0,06.
- Rythme : `should_poll: false`, minuteur interne (2 s à 1 min, 10 s par défaut). Les fonctions
  « lentes » (index, tensions, courants, gaz, eau, Wi-Fi, cycles) partent au plus une fois par
  minute, plus un battement de 30 min (`publishChangedStates`) : un P1 triphasé lu toutes les 10 s
  reste vers 25 états/minute.
- Fonctionnalités : une clé n'apparaît que si l'appareil donne la valeur, et une clé vue une fois
  est gardée (`mergeKeys`, `/data`) pour que la structure ne clignote pas ; un compteur de gaz qui
  apparaît plus tard ajoute sa fonction (« Mettre à jour » dans Découverte).
- Déclencheurs à seuil : une échelle fixe (100 W à 8 kW) en `select` obligatoire, un événement par
  marche franchie vers le haut, réarmement à 10 % sous la marche (50 W minimum), rien à la première
  lecture ni juste après une perte de contact (modèle de gladys-brother). Le cœur convertit les
  valeurs d'événement selon le type du champ (`coerceSceneValue`) : un nombre convient pour un
  `select` à valeurs texte.

**Choix de conception**

- Jumelage v2 par l'action « Jumeler » (fenêtre de 75 s, essai toutes les 2 s, `timeout_seconds` 90) : pas de champ secret dans une action (Gladys#3154). Une adresse saisie qui ne répond qu'en
  v2 reste « non identifiée » jusqu'au jumelage, qui donne son numéro de série.
- Un P1 avec v1 active est lu en v1 tant qu'il n'est pas jumelé ; une fois jumelé, en v2. Un jeton
  refusé (401) est oublié et la v1 reprend si elle est active.
- Injoignable après 3 lectures sans réponse : badge `unreachable`, statut de connexion ; les
  valeurs restent.
- **Budget d'états** commun à tous les appareils : 240 par minute (`stateBudget`), les valeurs
  lentes d'abord, les puissances qui ne tiennent pas attendent la lecture suivante ; la création
  d'un appareil et la resynchronisation passent outre. Le dédoublonnage et le battement de 30 min
  sont faits par le hub (`record.sent`) en plus du SDK, pour savoir combien d'états partent vraiment.
- Une v1 vue coupée (403) est redemandée toutes les 5 min (`v1TurnedBackOn`) : une adresse saisie
  n'a pas d'annonce mDNS pour dire qu'elle est revenue.
- Jumelage d'une adresse saisie (numéro de série inconnu) : le nom du certificat qui a donné le
  jeton devient l'identité exigée pour la suite, et `/api` doit annoncer ce même appareil.
- Les minuteurs démarrent même si une publication échoue au démarrage (`start`, `finally`) ; une
  structure que Gladys n'a pas reçue est republiée après la lecture suivante (`devicesDirty`).
- Faux appareil : `tools/fake-homewizard.mjs` (v1 HTTP, v2 HTTPS avec certificats de test de
  `test/fixtures/tls`, bouton). Les tests ouvrent de vrais serveurs sur 127.0.0.1 (ports libres).
  Pour régénérer un certificat de test : `openssl req -newkey … -subj "/CN=appliance\/p1dongle\/…"`
  (les `/` du CN s'échappent).

**Vérification Docker** (faite le 13/10/2026, à refaire après un changement du client ou du hub)

```bash
sg docker -c 'docker build -t gladys-test-homewizard:dev .'
sg docker -c 'docker network create gladys-test-homewizard'
sg docker -c 'docker run -d --name gladys-test-homewizard-fake --network gladys-test-homewizard \
  -v $PWD/tools:/fake/tools:ro -v $PWD/test/fixtures:/fake/test/fixtures:ro -w /fake \
  public.ecr.aws/docker/library/node:24-alpine \
  node tools/fake-homewizard.mjs --model HWE-P1 --api both --serial 5c2fafa00001 --tls p1'
sg docker -c 'docker run --rm --network gladys-test-homewizard --cap-drop ALL \
  --security-opt no-new-privileges --read-only --memory 256m --pids-limit 256 \
  -v gladys-test-homewizard-data:/data \
  -v $PWD/tools/docker-check.mjs:/app/tools/docker-check.mjs:ro \
  -v $PWD/test/fixtures/tls/test-ca.pem:/app/tools/test-ca.pem:ro \
  -e FAKE_HOST=<IP du faux> gladys-test-homewizard:dev node tools/docker-check.mjs'
```

Puis tout supprimer (`docker rm -f`, `docker network rm`, `docker volume rm`, `docker rmi`). Le faux
tourne en root (ports 80 et 443, comme un vrai appareil) ; l'intégration, elle, dans le bac à sable.
