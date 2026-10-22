/* ============================================================
   CARTE THÉMATIQUE IAV — version sans GeoServer
   Toutes les couches vectorielles sont lues directement par le
   navigateur depuis des fichiers GeoJSON du dossier "data/".
   Les styles reproduisent ceux des fichiers SLD de GeoServer.
   ============================================================ */

const DOSSIER_DONNEES = "data/";
const DOSSIER_ICONES = "icones/";

/* Limites du campus en EPSG:4326 */
const empriseIAV = [
  [33.97070, -6.87060],
  [33.98165, -6.86050]
];

const map = L.map("map", {
  maxZoom: 21
});

map.fitBounds(empriseIAV, {
  padding: [15, 15]
});

L.control.scale({
  imperial: false
}).addTo(map);


/* ============================================================
   FONDS DE CARTE (tuiles en ligne, sans GeoServer)
   ============================================================ */

const osm = L.tileLayer(
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 21,
    maxNativeZoom: 19,
    attribution: "© OpenStreetMap contributors"
  }
).addTo(map);

/* L'image Esri est maintenant lue directement chez Esri,
   au lieu de passer par la couche WMS "esri_rabat". */
const imageEsri = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 21,
    maxNativeZoom: 19,
    zIndex: 2,
    attribution: "Image © Esri World Imagery"
  }
).addTo(map);


/* ============================================================
   ORDRE DES COUCHES ET ZOOM D'APPARITION
   Chaque couche a son propre "pane" (calque Leaflet) :
   polygones en bas, lignes au milieu, points et noms au-dessus.
   ============================================================ */

const NIVEAUX = [
  { pane: "verts",      zIndex: 410, zoomMinimum: 13 },
  { pane: "terrain",    zIndex: 420, zoomMinimum: 13 },
  { pane: "batiments",  zIndex: 430, zoomMinimum: 15 },
  { pane: "routes",     zIndex: 440, zoomMinimum: 16 },
  { pane: "points",     zIndex: 450, zoomMinimum: 15 },
  { pane: "etiquettes", zIndex: 460, zoomMinimum: 18 }
];

NIVEAUX.forEach((niveau) => {
  map.createPane(niveau.pane).style.zIndex = niveau.zIndex;
});

function mettreAJourVisibilite() {
  const zoom = map.getZoom();
  NIVEAUX.forEach((niveau) => {
    map.getPane(niveau.pane).style.display =
      zoom >= niveau.zoomMinimum ? "" : "none";
  });
}


/* ============================================================
   OUTILS COMMUNS
   ============================================================ */

/* Nom à afficher : champ "name" (ou "nom" s'il existe) */
function nomDe(feature) {
  const p = feature.properties || {};
  const nom = p.name || p.nom;
  return nom && String(nom).trim() !== "" ? String(nom) : null;
}

/* Empêche un nom contenant des caractères HTML de casser la page */
function echapper(texte) {
  const div = document.createElement("div");
  div.textContent = texte;
  return div.innerHTML;
}

/* Survol : contour clair et nom qui suit la souris */
const STYLE_SURVOL = {
  color: "#FFFFFF",
  weight: 3,
  opacity: 1,
  fillColor: "#FFFFFF",
  fillOpacity: 0.2
};

function preparerSurvol(feature, layer) {
  const nom = nomDe(feature);
  if (!nom) return;

  layer.bindTooltip(echapper(nom), {
    sticky: true,
    direction: "top",
    offset: [0, -10],
    className: "etiquette-survol"
  });

  const styleInitial = {
    color: layer.options.color,
    weight: layer.options.weight,
    opacity: layer.options.opacity,
    fillColor: layer.options.fillColor,
    fillOpacity: layer.options.fillOpacity
  };

  layer.on("mouseover", () => layer.setStyle(STYLE_SURVOL));
  layer.on("mouseout", () => layer.setStyle(styleInitial));
}


/* ============================================================
   ESPACES VERTS (grass.sld)
   ============================================================ */

const espacesVerts = L.geoJSON(null, {
  pane: "verts",
  interactive: false,
  style: {
    color: "#B9DB92",
    weight: 0.6,
    fillColor: "#D7EDB8",
    fillOpacity: 1
  }
});


/* ============================================================
   EMPRISE DU CAMPUS (terrain.sld)
   Double trait : blanc large dessous, vert foncé fin dessus.
   ============================================================ */

const terrainFond = L.geoJSON(null, {
  pane: "terrain",
  interactive: false,
  style: {
    color: "#FFFFFF",
    weight: 4,
    opacity: 0.8,
    fill: false
  }
});

const terrainTrait = L.geoJSON(null, {
  pane: "terrain",
  style: {
    color: "#1F4A3E",
    weight: 2,
    opacity: 1,
    fillColor: "#FFFFFF",
    fillOpacity: 0          // intérieur invisible mais sensible au survol
  },
  onEachFeature: preparerSurvol
});

const terrain = L.layerGroup([terrainFond, terrainTrait]);


/* ============================================================
   BÂTIMENTS (iav3D.sld)
   Couleur lue dans le champ "color", "#" ajouté si absent.
   ============================================================ */

function couleurBatiment(feature) {
  const valeur = (feature.properties || {}).color;
  if (valeur === null || valeur === undefined || String(valeur).trim() === "") {
    return null;
  }
  const couleur = String(valeur).trim();
  return couleur.startsWith("#") ? couleur : "#" + couleur;
}

/* Noms des bâtiments, visibles seulement en zoom fort (pane "etiquettes") */
const etiquettesBatiments = L.layerGroup();

function ajouterEtiquette(feature, layer) {
  const nom = nomDe(feature);
  if (!nom || !layer.getBounds) return;

  L.marker(layer.getBounds().getCenter(), {
    pane: "etiquettes",
    interactive: false,
    keyboard: false,
    icon: L.divIcon({
      className: "etiquette-batiment",
      html: `<span>${echapper(nom)}</span>`,
      iconSize: null
    })
  }).addTo(etiquettesBatiments);
}

const batiments = L.geoJSON(null, {
  pane: "batiments",
  style: (feature) => {
    const couleur = couleurBatiment(feature);
    if (!couleur) {
      return { fillColor: "#CFD8DC", fillOpacity: 1, weight: 0 };
    }
    return {
      fillColor: couleur,
      fillOpacity: 0.92,
      color: "#FFFFFF",
      weight: 0.6,
      opacity: 0.6
    };
  },
  onEachFeature: (feature, layer) => {
    preparerSurvol(feature, layer);
    ajouterEtiquette(feature, layer);
  }
});


/* ============================================================
   ROUTES (roads.sld)
   Chaussée blanche dessous, points ronds gris par-dessus.
   ============================================================ */

const STYLES_ROUTES = {
  principale: { fond: 7,   trait: 5, couleur: "#2D3942", espace: 10 },
  secondaire: { fond: 5.5, trait: 4, couleur: "#506475", espace: 8 },
  piste:      { fond: 4,   trait: 3, couleur: "#859AAD", espace: 6 }
};

function categorieRoute(feature) {
  const categorie = String((feature.properties || {}).category || "");
  if (categorie.includes("Princip")) return "principale";
  if (categorie.includes("Secondaire")) return "secondaire";
  if (categorie.includes("iste")) return "piste";
  return null;
}

const routesFond = L.geoJSON(null, {
  pane: "routes",
  interactive: false,
  filter: (feature) => categorieRoute(feature) !== null,
  style: (feature) => ({
    color: "#FFFFFF",
    weight: STYLES_ROUTES[categorieRoute(feature)].fond,
    lineCap: "round",
    lineJoin: "round"
  })
});

const routesPoints = L.geoJSON(null, {
  pane: "routes",
  interactive: false,
  filter: (feature) => categorieRoute(feature) !== null,
  style: (feature) => {
    const s = STYLES_ROUTES[categorieRoute(feature)];
    return {
      color: s.couleur,
      weight: s.trait,
      lineCap: "round",
      dashArray: `0.1 ${s.espace}`
    };
  }
});

const routes = L.layerGroup([routesFond, routesPoints]);


/* ============================================================
   POINTS (points_iav.sld)
   Arbres, palmiers, parkings et entrée seulement.
   Grande icône à partir du zoom 18, petite en dessous.
   ============================================================ */

function typePoint(feature) {
  const p = feature.properties || {};
  if (p.name === "tree") return "arbre";
  if (p.name === "palmier") return "palmier";
  if (p.icon_name === "parking") return "parking";
  if (p.icon_name === "entrance") return "entree";
  return null;
}

function iconePoint(type, zoom) {
  const grand = zoom >= 18;

  if (type === "parking") {
    const taille = grand ? 18 : 12;
    return L.divIcon({
      className: "icone-parking" + (grand ? " grand" : ""),
      html: "P",
      iconSize: [taille, taille]
    });
  }

  const fichiers = {
    arbre: "tree.png",
    palmier: "palm-tree.png",
    entree: "entrance.png"
  };
  const taille = type === "entree" ? (grand ? 28 : 16) : (grand ? 26 : 14);

  return L.icon({
    iconUrl: DOSSIER_ICONES + fichiers[type],
    iconSize: [taille, taille],
    iconAnchor: [taille / 2, taille / 2]
  });
}

/* Arbres et palmiers à partir du zoom 16, parkings et entrée dès le zoom 15 */
function pointVisible(type, zoom) {
  return (type === "arbre" || type === "palmier") ? zoom >= 16 : zoom >= 15;
}

function mettreAJourPoint(marqueur) {
  const zoom = map.getZoom();
  marqueur.setIcon(iconePoint(marqueur.typePoint, zoom));
  marqueur.setOpacity(pointVisible(marqueur.typePoint, zoom) ? 1 : 0);
}

const points = L.geoJSON(null, {
  filter: (feature) => typePoint(feature) !== null,
  pointToLayer: (feature, latlng) => {
    const type = typePoint(feature);
    const zoom = map.getZoom();
    const marqueur = L.marker(latlng, {
      pane: "points",
      interactive: false,
      keyboard: false,
      icon: iconePoint(type, zoom),
      opacity: pointVisible(type, zoom) ? 1 : 0
    });
    marqueur.typePoint = type;
    return marqueur;
  }
});


/* ============================================================
   AJOUT À LA CARTE ET CONTRÔLE DES COUCHES
   ============================================================ */

const coucheBatiments = L.layerGroup([batiments, etiquettesBatiments]);

[espacesVerts, terrain, coucheBatiments, routes, points].forEach((couche) => {
  couche.addTo(map);
});

L.control.layers(
  {
    "Fond OpenStreetMap": osm
  },
  {
    "Image satellite (Esri)": imageEsri,
    "Espaces verts": espacesVerts,
    "Emprise du campus": terrain,
    "Bâtiments": coucheBatiments,
    "Routes et chemins": routes,
    "Points d’intérêt": points
  },
  {
    collapsed: false,
    position: "topright"
  }
).addTo(map);

map.on("zoomend", () => {
  mettreAJourVisibilite();
  points.eachLayer(mettreAJourPoint);
});

mettreAJourVisibilite();


/* ============================================================
   LÉGENDE
   ============================================================ */

const legende = L.control({
  position: "bottomright"
});

legende.onAdd = function () {
  const div = L.DomUtil.create("div", "legende");

  div.innerHTML = `
    <b>Carte thématique IAV</b><br>
    Zoom 13 : espaces verts et emprise<br>
    Zoom 15 : bâtiments, parkings, entrée<br>
    Zoom 16 : routes, arbres et palmiers<br>
    Zoom 18 : noms des bâtiments<br>
    <small>Image © Esri World Imagery</small>
  `;

  return div;
};

legende.addTo(map);


/* ============================================================
   MESSAGES D'AIDE EN CAS DE PROBLÈME
   ============================================================ */

function afficherMessage(texte) {
  let boite = document.querySelector(".message-erreur");
  if (!boite) {
    boite = document.createElement("div");
    boite.className = "message-erreur";
    document.body.appendChild(boite);
  }
  boite.innerHTML += `<p>${texte}</p>`;
}

/* Un double-clic sur index.html ne permet pas de lire les GeoJSON */
if (window.location.protocol === "file:") {
  afficherMessage(
    "La page est ouverte par double-clic : le navigateur bloque la lecture des fichiers GeoJSON. " +
    "Ouvrez-la avec Live Server (VS Code) ou depuis Netlify."
  );
}

/* Vérifie que les coordonnées sont bien en degrés (EPSG:4326) */
function semblePasEnWGS84(donnees) {
  const entite = (donnees.features || []).find((f) => f.geometry);
  if (!entite) return false;
  let c = entite.geometry.coordinates;
  while (Array.isArray(c[0])) c = c[0];
  return Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90;
}


/* ============================================================
   CHARGEMENT DES FICHIERS GEOJSON
   Chaque fichier est chargé séparément : si l'un manque,
   les autres s'affichent quand même.
   ============================================================ */

const FICHIERS = [
  { nom: "grass",      couches: [espacesVerts] },
  { nom: "terrain",    couches: [terrainFond, terrainTrait] },
  { nom: "iav3D",      couches: [batiments] },
  { nom: "roads",      couches: [routesFond, routesPoints] },
  { nom: "points_iav", couches: [points] }
];

FICHIERS.forEach((fichier) => {
  const chemin = `${DOSSIER_DONNEES}${fichier.nom}.geojson`;

  fetch(chemin)
    .then((reponse) => {
      if (!reponse.ok) throw new Error(`erreur ${reponse.status}`);
      return reponse.json();
    })
    .then((donnees) => {
      if (semblePasEnWGS84(donnees)) {
        afficherMessage(
          `${fichier.nom}.geojson n'est pas en EPSG:4326 : réexportez-le depuis QGIS en WGS 84.`
        );
        return;
      }
      fichier.couches.forEach((couche) => couche.addData(donnees));
    })
    .catch((erreur) => {
      if (window.location.protocol === "file:") return;
      console.error(`${chemin} introuvable ou illisible :`, erreur);
      afficherMessage(`Impossible de lire ${chemin} (vérifiez le nom et l'emplacement du fichier).`);
    });
});
