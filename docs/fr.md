# HomeWizard Energy

Lisez vos appareils [HomeWizard Energy](https://www.homewizard.com) dans
Gladys, en réseau local : le **compteur P1** branché sur le port P1 d'un
compteur électrique intelligent (DSMR, Pays-Bas, Belgique, Luxembourg…), la
prise **Energy Socket**, les **compteurs kWh** (mono et triphasés, Eastron
SDM230 et SDM630 compris), le compteur d'eau **Watermeter** et la batterie
**Plug-In Battery**. Puissances, index, tensions, gaz et eau, prêts pour
l'onglet énergie de Gladys, avec un widget de tableau de bord, deux
déclencheurs et trois actions de scène. Ni compte ni cloud : Gladys lit
chaque appareil directement, par l'API locale officielle de HomeWizard.

> **Développée sans le matériel : vos retours sont les bienvenus.** Cette
> intégration a été construite et testée sur de vraies réponses d'appareils
> HomeWizard enregistrées par les projets python-homewizard-energy et Home
> Assistant, et sur des appareils simulés (API v1 et v2), pas sur un vrai
> compteur. Si quelque chose ne marche pas comme décrit, dites-le sur le
> [forum Gladys](https://community.gladysassistant.com) ou dans les
> [issues](https://github.com/guim31/gladys-homewizard/issues).

## Ce qu'il vous faut

- Gladys Assistant 5.1.0 ou plus récent.
- Des appareils HomeWizard installés dans l'**application HomeWizard
  Energy**, sur le même réseau que Gladys.
- Pour chaque appareil, l'**API locale** :
  - **API v1** (tous les modèles sauf la Plug-In Battery) : dans
    l'application HomeWizard Energy, **Paramètres** → **Compteurs** → votre
    appareil → **API locale**, activée.
  - **API v2** (compteur P1, compteurs kWh et Plug-In Battery avec un
    firmware récent) : sécurisée (HTTPS), rien à activer dans l'application,
    mais chaque appareil se jumelle une fois en appuyant sur son bouton (voir
    plus bas). La Plug-In Battery n'a que celle-ci.
- Rien d'autre : ni compte HomeWizard, ni clé, ni accès à internet.

## Installation

1. Installez l'intégration depuis le catalogue de Gladys.
2. Ouvrez sa **Configuration**. Rien n'est obligatoire ; les options sont :
   - **Adresses IP des appareils HomeWizard** : seulement pour les appareils
     que la découverte automatique ne trouve pas, séparées par des virgules
     (par exemple `192.168.1.40, 192.168.1.41`). Votre box liste l'adresse de
     chaque appareil. Les noms en `.local` ne marchent pas ici : mettez
     l'adresse.
   - **Intervalle d'actualisation** : fréquence de lecture de chaque
     appareil, de 2 secondes à 1 minute (10 secondes par défaut). Les
     puissances suivent ce rythme ; index, tensions, courants, gaz et eau
     sont envoyés à Gladys au plus une fois par minute, ce qui suffit
     largement à l'onglet énergie et ménage Gladys.
   - **Langue des noms de fonctionnalités** : anglais, français, allemand ou
     espagnol (français par défaut). Les noms des fonctionnalités sont donnés
     à l'ajout d'un appareil, et les messages des actions de scène suivent
     cette langue.
3. Ouvrez l'onglet **Découverte** de l'intégration : les appareils trouvés y
   sont listés. Ajoutez ceux que vous voulez.
4. Pour utiliser l'**API v2** (conseillée sur les appareils qui la
   proposent, et seule possible pour la Plug-In Battery) : cliquez sur
   **Jumeler (API v2) : appuyez sur le bouton**, puis, dans les 75 secondes,
   appuyez sur le bouton de chaque appareil à jumeler (sur un compteur kWh,
   le bouton d'appairage Wi-Fi, 1 à 3 secondes, pas plus). Le message sous le
   bouton liste les appareils jumelés. Un compteur P1 dont l'API v1 est
   active est lu en v1 tant qu'il n'est pas jumelé.

L'action **Rechercher les appareils HomeWizard** relance une recherche et
liste ce qui a été trouvé, l'API utilisée pour chaque appareil et ce qui
bloque les autres (API locale désactivée, jumelage nécessaire, appareil qui
ne répond pas). L'action **Faire clignoter un appareil** fait clignoter le
voyant d'un appareil quelques secondes, pour le repérer parmi d'autres
identiques.

## Les appareils dans Gladys

Un appareil Gladys par appareil HomeWizard, nommé d'après son modèle et la
fin de son numéro de série (`HomeWizard P1 Meter aabbcc`). Seul ce que
l'appareil donne est publié : un compteur monophasé n'a ni L2 ni L3, un
compteur à un seul tarif pas d'index par tarif, un compteur P1 sans compteur
de gaz pas de gaz.

**Compteur P1**

- **Puissance importée** et **Puissance exportée** (W) : ce que la maison
  tire du réseau et ce qu'elle lui renvoie, jamais négatives.
- **Index import** (kWh) : l'énergie importée au total. C'est lui que
  l'onglet énergie de Gladys transforme en consommation et en coût ; la
  puissance importée est gardée pour les pointes de puissance sur
  lesquelles certains contrats sont facturés.
- **Index export** (kWh) : l'énergie renvoyée au réseau au total.
- **Index import T1**… **T4** et **Index export T1**… **T4** (kWh) : par
  tarif (jour/nuit), quand le compteur en a plusieurs.
- **Tension L1**… **L3** (V) et **Courant L1**… **L3** (A), par phase, quand
  le compteur les donne. Le courant est donné sans signe : son intensité.
- **Gaz** et **Eau** (m³) : les compteurs de gaz et d'eau reliés au compteur
  intelligent, relevés par lui environ toutes les heures.
- **Signal Wi-Fi** (%).

**Energy Socket**

- **Marche/Arrêt** : le relais, pilotable.
- **Puissance** (W), **Index d'énergie** (kWh : la consommation reprise par
  l'onglet énergie) et, sur les prises récentes, **Tension** (V) et
  **Courant** (A).
- **Verrouillage du bouton** : actif, ni le bouton de la prise ni Gladys ne
  peuvent plus l'éteindre (congélateur, box internet). Pilotable.
- **Luminosité de la LED** (0 à 100 %) : l'anneau lumineux de la prise.
- **Signal Wi-Fi** (%).

**Compteurs kWh** (HWE-KWH1, HWE-KWH3, SDM230, SDM630)

- **Puissance** (W, négative quand le circuit renvoie de l'énergie, un
  onduleur solaire par exemple) et, sur les triphasés, **Puissance L1**…
  **L3**.
- **Index import** (kWh, consommation dans l'onglet énergie) et **Index
  export** (kWh, compté comme production par Gladys : un compteur kWh sur un
  onduleur solaire).
- **Tension** et **Courant**, ou **Tension L1**… **L3** et **Courant L1**…
  **L3** sur les triphasés. **Signal Wi-Fi** (%).

**Watermeter**

- **Débit d'eau** (m³/h : 1 L/min vaut 0,06 m³/h) et **Total d'eau** (m³).
- **Signal Wi-Fi** (%). Le Watermeter ne répond que sur alimentation USB :
  sur piles, il dort et Gladys ne peut pas le lire.

**Plug-In Battery** (API v2 seulement)

- **Niveau de batterie** (%), **Puissance de charge** et **Puissance de
  décharge** (W), **Énergie chargée** et **Énergie déchargée** (kWh),
  **Cycles**, **Signal Wi-Fi** (%).

Un appareil qui ne répond pas à trois lectures de suite prend le badge
« injoignable » dans Gladys ; ses dernières valeurs restent.

## Widget de tableau de bord

**Énergie en direct** montre les échanges d'un compteur P1 avec le réseau :

- une jauge **Réseau**, signée : vers la droite quand la maison consomme sur
  le réseau, vers la gauche (en vert) quand elle lui renvoie de l'énergie ;
- des tuiles **Import** et **Export**, en direct ;
- avec un compteur kWh solaire choisi dans les réglages du widget :
  **Solaire** (la production mesurée par ce compteur) et **Maison** (ce que
  consomme la maison : import − export + production) ;
- le tarif en cours, l'index gaz, et si les compteurs répondent.

Réglages : le compteur P1 (vide : le premier trouvé) et, en option, le
compteur kWh (ou la prise) qui mesure vos panneaux solaires.

## Scènes

### Déclencheurs

- **La maison réinjecte plus de…** : la puissance renvoyée au réseau par un
  compteur P1 dépasse un seuil, choisi de 100 W à 8 kW. Usage typique : les
  panneaux solaires produisent plus que ce que la maison consomme.
- **La maison consomme plus de…** : la puissance tirée du réseau par un
  compteur P1 dépasse un seuil.

Chaque déclencheur part une fois quand la puissance passe au-dessus du
seuil, et de nouveau seulement après être redescendue de 10 % sous le seuil
(50 W au moins) : une puissance qui oscille autour du seuil ne le répète pas.
Rien ne part juste après le démarrage de Gladys ou de l'intégration. La scène
peut lire la **Puissance (W)** et le seuil atteint. Pour agir quand la
puissance redescend, utilisez la fonctionnalité **Puissance importée** ou
**Puissance exportée** dans un déclencheur « état d'un appareil ».

### Actions

- **Allumer une prise HomeWizard** et **Éteindre une prise HomeWizard** :
  elles renvoient si la prise est allumée. Refusées, avec un message, tant
  que son verrouillage du bouton est actif.
- **Faire clignoter un appareil HomeWizard** : le voyant clignote quelques
  secondes (pas sur les compteurs kWh lus par l'API v1).

### Idées de scènes

- **Surplus solaire** : « La maison réinjecte plus de… 1,5 kW » → allumer
  la prise du chauffe-eau ou de la recharge de la voiture ; « Puissance
  exportée » sous 200 W pendant 10 minutes → l'éteindre.
- **Éviter une pointe** : « La maison consomme plus de… 5 kW » → éteindre
  une prise non essentielle et envoyer un message.
- **Retrouver un appareil** : dans une scène lancée depuis le tableau de
  bord, « Faire clignoter un appareil HomeWizard ».

## Dépannage

- **Un appareil manque dans l'onglet Découverte** : lancez **Rechercher les
  appareils HomeWizard** et lisez le message. « API locale désactivée dans
  l'application » : activez-la dans l'application HomeWizard Energy.
  « Appuyez sur son bouton après Jumeler » : l'appareil ne propose que
  l'API v2, jumelez-le. Pas trouvé du tout : les appareils sont trouvés par
  le cœur de Gladys (mDNS), sur le même réseau seulement ; saisissez son
  adresse IP dans la configuration.
- **« Jeton refusé, jumelez-le à nouveau »** : le jeton de l'intégration a
  été supprimé (appareil réinitialisé, liste des utilisateurs vidée dans
  l'application). Relancez le jumelage.
- **« Certificat refusé »** : l'appareil à cette adresse ne prouve pas qu'il
  est l'appareil HomeWizard attendu ; Gladys ne lui envoie rien. Vérifiez
  l'adresse (un changement de DHCP ?) et lancez une recherche.
- **Le Watermeter ne répond pas** : il doit être alimenté par USB.
- **Les valeurs semblent en retard** : index, tensions et gaz partent une
  fois par minute ; le compteur de gaz lui-même se met à jour environ toutes
  les heures.

## Limites

- Lecture périodique seulement (pas de push) : les puissances sont aussi
  fraîches que l'intervalle d'actualisation.
- Les modes de la batterie (zéro, charge complète, veille) et les réglages
  cloud des appareils ne sont pas pilotés ; l'Energy Display n'est pas pris
  en charge.
- L'Energy Socket et le Watermeter sont lus par l'API v1 (leur API v2 est
  encore en développement chez HomeWizard).
- Compteurs externes d'un compteur P1 : un compteur de gaz et un compteur
  d'eau ; les compteurs de chaleur ne sont pas lus.
- Développée sans le matériel (voir plus haut).

HomeWizard est une marque de HomeWizard B.V. Cette intégration n'est pas
affiliée à HomeWizard.
