# Carte web — Madinat Al Irfane et campus de l'IAV Hassan II

Carte interactive réalisée avec **Leaflet** dans le cadre du TP4 du cours de **Web Mapping** (3e année du cycle ingénieur, filière Sciences Géomatiques et Ingénierie Topographique, IAV Hassan II, Rabat).

La carte présente le quartier de Madinat Al Irfane et le campus de l'Institut Agronomique et Vétérinaire Hassan II. Les couches du campus sont lues directement par le navigateur depuis des fichiers GeoJSON, et les requêtes spatiales sont calculées dans le navigateur : le projet ne nécessite ni GeoServer ni aucun autre serveur cartographique.

---

## Fonctionnalités

### Navigation et fonds de carte
- Trois fonds de carte au choix : OpenStreetMap, image satellite Esri World Imagery et carte topographique OpenTopoMap.
- Une échelle graphique métrique en bas à gauche de la carte.
- Un bouton de retour (⌂) qui recentre la carte sur Madinat Al Irfane.
- Un bouton de géolocalisation (◎) qui affiche la position de l'utilisateur avec un cercle de précision.

### Interaction
- Un marqueur sur Madinat Al Irfane avec une fenêtre d'information.
- L'affichage des coordonnées d'un point lors d'un clic sur la carte.
- L'affichage en direct de la latitude, de la longitude et du niveau de zoom sous la souris.
- L'ajout de points numérotés par double-clic, regroupés dans une couche que l'on peut masquer.
- Une zone circulaire de 500 m autour de Madinat Al Irfane, activable depuis le menu des couches.

### Couches du campus IAV (GeoJSON)

| Couche | Fichier | Représentation | Zoom d'apparition |
|---|---|---|---|
| Espaces verts | `grass.geojson` | Aplat vert clair | 13 |
| Emprise du campus | `terrain.geojson` | Double contour blanc et vert foncé, nom au survol | 13 |
| Bâtiments | `iav3D.geojson` | Couleur lue dans le champ `color`, nom au survol et étiquettes à partir du zoom 18 | 15 |
| Routes et chemins | `roads.geojson` | Pointillés selon la catégorie (principale, secondaire, piste) | 16 |
| Parkings et entrée | `points_iav.geojson` | Carré bleu « P » et icône de barrière | 15 |
| Arbres et palmiers | `points_iav.geojson` | Icônes d'arbre et de palmier | 16 |

Les styles reproduisent ceux des fichiers SLD utilisés auparavant avec GeoServer. Les icônes s'agrandissent automatiquement à partir du zoom 18.

### Requêtes spatiales (constructeur de modèle)

Le bouton **« Requêtes »**, sous les boutons de zoom, ouvre un constructeur de modèle inspiré du Model Builder. L'utilisateur choisit une couche d'entrée et un filtre, puis enchaîne des étapes : chaque étape reçoit le résultat de la précédente, et un schéma résume le modèle construit.

Ces requêtes remplacent celles qui étaient auparavant envoyées au service WPS de GeoServer. Elles sont désormais calculées entièrement dans le navigateur par la bibliothèque **Turf.js**, à partir des mêmes fichiers GeoJSON.

| Opération | Rôle |
|---|---|
| Tampon | Crée une zone autour de chaque entité, à une distance choisie en mètres (de 1 à 500 m). |
| Centroïdes | Remplace chaque entité par son point central. |
| Garder les entités situées dans… | Conserve les entités entièrement contenues dans une autre couche. |
| Intersection avec… | Calcule les parties communes avec une autre couche. |
| Sélectionner dans la zone… | Sélectionne les entités d'une autre couche contenues dans le résultat précédent (par exemple dans un tampon). |
| Découper par… | Découpe le résultat par les polygones d'une autre couche. |
| Compter les entités | Donne le nombre d'entités obtenues. |
| Calculer l'emprise | Dessine le rectangle englobant et affiche ses coins. |
| Surface totale | Additionne les surfaces des polygones, en m². |
| Longueur totale | Additionne les longueurs des lignes, en m. |
| Compter, surface ou longueur par catégorie | Calcule une valeur pour chaque catégorie et l'affiche dans un graphique. |

Les filtres proposés portent sur les attributs des couches : arbres, palmiers, parkings et entrées pour les points, catégories de routes pour les voies, et groupes (formation, laboratoires, amphithéâtres, résidences, sport…) pour les bâtiments.

Les résultats géométriques s'affichent en violet sur la carte principale, dans la couche « Résultat des requêtes ». Les résultats chiffrés s'affichent dans le panneau et dans un graphique Highcharts, et le résultat complet peut être consulté au format GeoJSON. Les surfaces et les longueurs sont calculées directement en mètres sur l'ellipsoïde, sans reprojection.

---

## Structure du projet

```
carte-iav/
├── index.html          Page de la carte (HTML, CSS et JavaScript)
├── requetes.js         Constructeur de modèle et calcul des requêtes spatiales
├── requetes.css        Style du panneau des requêtes
├── README.md           Ce fichier
├── data/
│   ├── grass.geojson
│   ├── terrain.geojson
│   ├── iav3D.geojson
│   ├── roads.geojson
│   └── points_iav.geojson
└── icones/
    ├── tree.png
    ├── palm-tree.png
    └── barriere.png
```

Les noms des fichiers doivent être respectés exactement, majuscules comprises, car les serveurs en ligne distinguent les majuscules des minuscules.

---

## Préparation des données

Les fichiers GeoJSON sont exportés depuis **QGIS** :

1. Faire un clic droit sur la couche, puis choisir « Exporter » et « Sauvegarder les entités sous… ».
2. Choisir le format **GeoJSON**.
3. Choisir le système de coordonnées **EPSG:4326 (WGS 84)**, le seul que Leaflet lit directement.
4. Conserver les champs utilisés par les styles et les requêtes : `name`, `color`, `category`, `icon_name` et `group`.

Si un fichier n'est pas en EPSG:4326, la page affiche un message d'avertissement au lieu de dessiner la couche.

---

## Lancer le projet en local

La page ne fonctionne pas par simple double-clic sur `index.html` : dans ce cas, le navigateur bloque la lecture des fichiers GeoJSON et un message rouge l'indique. Il faut passer par un petit serveur local.

**Avec VS Code**

1. Installer l'extension **Live Server** (Ritwick Dey).
2. Ouvrir le dossier du projet dans VS Code.
3. Faire un clic droit sur `index.html` et choisir « Open with Live Server ».

**Avec le Terminal (macOS ou Linux)**

```bash
cd chemin/vers/carte-iav
python3 -m http.server 8000
```

Ouvrir ensuite `http://localhost:8000` dans le navigateur.

---

## Déploiement

Le projet est un site statique : il peut être publié gratuitement, par exemple sur **GitHub Pages**.

1. Créer un dépôt public sur GitHub et y envoyer le contenu du dossier, avec `index.html` à la racine.
2. Ouvrir « Settings », puis « Pages ».
3. Choisir la branche `main` et le dossier `/ (root)`, puis enregistrer.
4. La carte est publiée à l'adresse `https://<pseudo>.github.io/<nom-du-depot>/`.

Le site peut aussi être déposé sur **Netlify** en glissant le dossier complet dans la zone de dépôt du projet.

---

## Technologies

- [Leaflet 1.9.4](https://leafletjs.com) pour l'affichage de la carte et des couches.
- [Turf.js 7](https://turfjs.org) pour les calculs spatiaux des requêtes (tampons, intersections, surfaces, longueurs…).
- [Highcharts](https://www.highcharts.com) pour les graphiques des résultats.
- HTML, CSS et JavaScript, sans framework.
- QGIS pour la préparation et l'export des données.

## Sources des fonds de carte

- © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Image satellite © Esri, Maxar, Earthstar Geographics.
- Carte topographique © [OpenTopoMap](https://opentopomap.org) (CC-BY-SA).

---

## Auteur

**KANE Wiame** — Élève ingénieure en Sciences Géomatiques et Ingénierie Topographique, Institut Agronomique et Vétérinaire Hassan II, Rabat.
