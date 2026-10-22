/* ============================================================
   REQUÊTES SPATIALES CALCULÉES DANS LE NAVIGATEUR
   Même constructeur de modèle que la version WPS, mais sans
   aucun appel à GeoServer :
     - les couches sont lues dans les fichiers data/*.geojson ;
     - toutes les opérations sont calculées par Turf.js ;
     - les résultats s'affichent sur la carte principale,
       les valeurs dans un graphique Highcharts.
   Ce fichier doit être chargé APRÈS le script de la carte
   (il utilise les variables "map" et "controleCouches").
   ============================================================ */
(function () {
  const DOSSIER_DONNEES = "data/";
  const NOMS_COUCHES = ["points_iav", "roads", "iav3D", "grass", "terrain"];

  /* Données chargées : une FeatureCollection par couche */
  const DONNEES = {};

  // ===== MOTEUR-DEBUT =====

  /* ============================================================
     1. COUCHES, FILTRES ET OPÉRATIONS
     Les filtres CQL de la version GeoServer sont remplacés
     par de petites fonctions JavaScript sur les attributs.
     ============================================================ */

  const contient = (texte, motif) => String(texte || "").includes(motif);

  const COUCHES = {
    points_iav: {
      libelle: "Points (points_iav)", type: "point",
      filtres: [
        ["Tous les points", () => true],
        ["Arbres", (p) => p.name === "tree"],
        ["Palmiers", (p) => p.name === "palmier"],
        ["Parkings", (p) => p.icon_name === "parking"],
        ["Entrées", (p) => p.icon_name === "entrance"]
      ]
    },
    roads: {
      libelle: "Voies (roads)", type: "ligne",
      filtres: [
        ["Toutes les voies", () => true],
        ["Routes principales", (p) => contient(p.category, "Princip")],
        ["Routes secondaires", (p) => contient(p.category, "Secondaire")],
        ["Pistes", (p) => contient(p.category, "iste")]
      ]
    },
    iav3D: {
      libelle: "Bâtiments et équipements (iav3D)", type: "polygone",
      filtres: [
        ["Toutes les entités", () => true],
        ...["formation", "lab", "class", "amphi", "residence", "food", "sport", "structure"]
          .map((g) => [`Groupe ${g}`, (p) => p.group === g])
      ]
    },
    grass: {
      libelle: "Espaces verts (grass)", type: "polygone",
      filtres: [["Tous les espaces verts", () => true]]
    },
    terrain: {
      libelle: "Emprise du campus (terrain)", type: "polygone",
      filtres: [["Toute l'emprise", () => true]]
    }
  };

  /* "fin" : opération qui termine le modèle ;
     "grouper" : opération qui renvoie une valeur par catégorie */
  const OPERATIONS = {
    buffer:       { libelle: "Tampon (distance en m)",           fin: false },
    centroid:     { libelle: "Centroïdes",                       fin: false },
    inclusion:    { libelle: "Garder les entités situées dans…", fin: false, couche2: true },
    intersection: { libelle: "Intersection avec…",               fin: false, couche2: true },
    selection:    { libelle: "Sélectionner dans la zone…",       fin: false, couche2: true },
    clip:         { libelle: "Découper par…",                    fin: false, couche2: true },
    count:        { libelle: "Compter les entités",              fin: true },
    bounds:       { libelle: "Calculer l'emprise",               fin: true },
    area:         { libelle: "Surface totale (m²)",              fin: true, type: "polygone" },
    length:       { libelle: "Longueur totale (m)",              fin: true, type: "ligne" },
    countBy:      { libelle: "Compter par catégorie",            fin: true, grouper: true },
    areaBy:       { libelle: "Surface par groupe (m²)",          fin: true, grouper: true, type: "polygone" },
    lengthBy:     { libelle: "Longueur par type (m)",            fin: true, grouper: true, type: "ligne" }
  };

  /* Type de géométrie obtenu après chaque étape.
     Une intersection garde la géométrie de plus petite dimension
     (point < ligne < polygone) ; deux lignes se croisent en points. */
  const RANG = { point: 0, ligne: 1, polygone: 2 };

  function typeApres(type, etape) {
    if (etape.op === "buffer") return "polygone";
    if (etape.op === "centroid") return "point";
    if (etape.op === "selection") return COUCHES[etape.couche2].type;
    if (etape.op === "intersection") {
      const t2 = COUCHES[etape.couche2].type;
      if (type === "ligne" && t2 === "ligne") return "point";
      return RANG[t2] < RANG[type] ? t2 : type;
    }
    if (etape.op === "clip" && COUCHES[etape.couche2].type !== "polygone") return type;
    return type;
  }

  /* ============================================================
     2. OUTILS GÉOMÉTRIQUES (Turf.js)
     ============================================================ */

  const collection = (features) => turf.featureCollection(features);

  /* Une entité multiple (MultiPolygon…) découpée en parties simples */
  const parties = (f) => turf.flatten(f).features;

  /* Boîte englobante mise en cache, pour éviter les calculs inutiles */
  const cacheBoites = new WeakMap();
  function boite(f) {
    if (!cacheBoites.has(f)) cacheBoites.set(f, turf.bbox(f));
    return cacheBoites.get(f);
  }
  const chevauchent = (a, b) => !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
  const englobe = (a, b) => a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];

  /* Couche filtrée : entités qui ont une géométrie et passent le filtre */
  function filtrer(couche, indiceFiltre) {
    const test = COUCHES[couche].filtres[indiceFiltre][1];
    const donnees = DONNEES[couche] || collection([]);
    return collection(donnees.features.filter((f) => f.geometry && test(f.properties || {})));
  }

  /* La partie "a" est-elle entièrement dans la zone "z" ? */
  function dedans(a, z) {
    if (!englobe(boite(z), boite(a))) return false;
    try {
      if (a.geometry.type === "Point" && z.geometry.type === "Polygon") {
        return turf.booleanPointInPolygon(a, z);
      }
      return turf.booleanWithin(a, z);
    } catch (e) {
      return false;
    }
  }

  /* Morceaux d'une ligne situés à l'intérieur d'un polygone */
  function decouperLigne(ligne, poly) {
    let morceaux = [];
    try {
      morceaux = turf.lineSplit(ligne, poly).features;
    } catch (e) {
      morceaux = [];
    }
    if (!morceaux.length) morceaux = [ligne];
    return morceaux.filter((m) => {
      const longueur = turf.length(m);
      if (longueur === 0) return false;
      return turf.booleanPointInPolygon(turf.along(m, longueur / 2), poly);
    });
  }

  /* Géométries communes à deux entités (parties simples) */
  function geometriesCommunes(a, b) {
    const resultat = [];
    parties(a).forEach((pa) => {
      parties(b).forEach((pb) => {
        if (!chevauchent(boite(pa), boite(pb))) return;
        let seCroisent = false;
        try { seCroisent = turf.booleanIntersects(pa, pb); } catch (e) { seCroisent = false; }
        if (!seCroisent) return;

        const ta = pa.geometry.type;
        const tb = pb.geometry.type;
        if (ta === "Point") { resultat.push(pa); return; }
        if (tb === "Point") { resultat.push(pb); return; }
        if (ta === "Polygon" && tb === "Polygon") {
          try {
            const inter = turf.intersect(collection([pa, pb]));
            if (inter) resultat.push(...parties(inter).filter((p) => p.geometry.type === "Polygon"));
          } catch (e) { /* géométrie invalide : on ignore la paire */ }
          return;
        }
        if (ta === "LineString" && tb === "Polygon") { resultat.push(...decouperLigne(pa, pb)); return; }
        if (ta === "Polygon" && tb === "LineString") { resultat.push(...decouperLigne(pb, pa)); return; }
        resultat.push(...turf.lineIntersect(pa, pb).features);
      });
    });
    return resultat;
  }

  /* Regroupe des parties en entités (une par type) avec les attributs donnés */
  function entites(geometries, proprietes) {
    if (!geometries.length) return [];
    return turf.combine(collection(geometries)).features.map((f) => ({
      type: "Feature",
      properties: { ...proprietes },
      geometry: f.geometry
    }));
  }

  /* ============================================================
     3. OPÉRATIONS DU MODÈLE
     ============================================================ */

  function tampon(fc, distance) {
    return collection(fc.features.map((f) => {
      try { return turf.buffer(f, distance, { units: "meters" }); } catch (e) { return null; }
    }).filter((f) => f && f.geometry));
  }

  function centroides(fc) {
    return collection(fc.features.map((f) => turf.centroid(f, { properties: { ...f.properties } })));
  }

  /* Entités de "fc" entièrement situées dans au moins une entité de "zones" */
  function garderDans(fc, zones) {
    const partiesZones = zones.features.flatMap(parties);
    return collection(fc.features.filter((f) =>
      parties(f).every((p) => partiesZones.some((z) => dedans(p, z)))));
  }

  /* Intersection entité par entité, comme gs:IntersectionFeatureCollection */
  function intersection(fc, second) {
    const resultat = [];
    fc.features.forEach((a) => {
      second.features.forEach((b) => {
        if (!chevauchent(boite(a), boite(b))) return;
        resultat.push(...entites(geometriesCommunes(a, b), { ...b.properties, ...a.properties }));
      });
    });
    return collection(resultat);
  }

  /* Découpage par l'union des polygones de la seconde couche */
  function decouper(fc, second) {
    const polygones = second.features.flatMap(parties).filter((p) => p.geometry.type === "Polygon");
    if (!polygones.length) return collection([]);

    let zones = polygones;
    if (polygones.length > 1) {
      try { zones = parties(turf.union(collection(polygones))); } catch (e) { zones = polygones; }
    }

    const resultat = [];
    fc.features.forEach((f) => {
      const morceaux = zones
        .filter((z) => chevauchent(boite(f), boite(z)))
        .flatMap((z) => geometriesCommunes(f, z));
      resultat.push(...entites(morceaux, f.properties));
    });
    return collection(resultat);
  }

  /* Exécution complète d'un modèle.
     Renvoie { collection }, { nombre, unite } ou { emprise }. */
  function executer(m) {
    let fc = filtrer(m.couche, m.filtre);

    for (const e of m.etapes) {
      const second = () => filtrer(e.couche2, e.filtre2);
      switch (e.op) {
        case "buffer":       fc = tampon(fc, e.distance); break;
        case "centroid":     fc = centroides(fc); break;
        case "inclusion":    fc = garderDans(fc, second()); break;
        case "intersection": fc = intersection(fc, second()); break;
        case "selection":    fc = garderDans(second(), fc); break;
        case "clip":         fc = decouper(fc, second()); break;
        case "count":
        case "countBy":
          return { nombre: fc.features.length, unite: "entités" };
        case "area":
        case "areaBy":
          return { nombre: fc.features.reduce((s, f) => s + turf.area(f), 0), unite: "m²" };
        case "length":
        case "lengthBy":
          return {
            nombre: fc.features.reduce((s, f) => s + turf.length(f, { units: "meters" }), 0),
            unite: "m"
          };
        case "bounds":
          return { emprise: fc.features.length ? turf.bbox(fc) : null };
      }
    }
    return { collection: fc };
  }

  /* Une variante du modèle par catégorie de la couche de regroupement :
     la couche croisée (intersection, sélection) ou la couche d'entrée. */
  const OP_DE_BASE = { countBy: "count", areaBy: "area", lengthBy: "length" };

  function variantesParCategorie(m, op) {
    let iInter = -1;
    m.etapes.forEach((e, i) => { if (e.op === "intersection" || e.op === "selection") iInter = i; });
    const couche = iInter >= 0 ? m.etapes[iInter].couche2 : m.couche;
    return COUCHES[couche].filtres.slice(1).map(([nom], k) => {
      const etapes = m.etapes.map((e) => ({ ...e }));
      etapes[etapes.length - 1].op = OP_DE_BASE[op];
      let filtre = m.filtre;
      if (iInter >= 0) etapes[iInter].filtre2 = k + 1; else filtre = k + 1;
      return { nom: nom.replace(/^Groupe /, ""), m: { couche: m.couche, filtre, etapes } };
    });
  }

  // ===== MOTEUR-FIN =====

  /* Pour les tests hors navigateur */
  if (typeof window === "undefined") {
    module.exports = { DONNEES, COUCHES, OPERATIONS, typeApres, executer, variantesParCategorie };
    return;
  }


  /* ============================================================
     4. CHARGEMENT DES DONNÉES
     ============================================================ */

  const chargement = Promise.all(NOMS_COUCHES.map((nom) =>
    fetch(`${DOSSIER_DONNEES}${nom}.geojson`)
      .then((r) => {
        if (!r.ok) throw new Error(`erreur ${r.status}`);
        return r.json();
      })
      .then((donnees) => { DONNEES[nom] = donnees; })
      .catch(() => { DONNEES[nom] = collection([]); return nom; })
  )).then((manquants) => manquants.filter(Boolean));


  /* ============================================================
     5. PANNEAU DES REQUÊTES
     ============================================================ */

  const panneau = document.createElement("aside");
  panneau.className = "req-panneau";
  panneau.hidden = true;
  panneau.innerHTML = `
    <div class="req-entete">
      <b>Requêtes spatiales</b>
      <span>
        <button id="req-effacer" type="button">Effacer</button>
        <button id="req-fermer" type="button" title="Fermer le panneau">×</button>
      </span>
    </div>
    <p class="req-intro">Calculs faits dans le navigateur à partir des fichiers GeoJSON.</p>
    <div id="req-modele"></div>
    <h3 class="req-titre-resultat">Résultat</h3>
    <div id="req-texte" class="req-texte"></div>
    <div id="req-graphique"></div>
    <details class="req-details">
      <summary>Voir le résultat GeoJSON</summary>
      <pre id="req-geojson"></pre>
    </details>`;
  document.body.appendChild(panneau);

  /* Bouton d'ouverture, sous les boutons de zoom */
  const boutonRequetes = L.control({ position: "topleft" });
  boutonRequetes.onAdd = function () {
    const div = L.DomUtil.create("div", "leaflet-bar bouton-requetes");
    div.innerHTML = '<a href="#" role="button" title="Ouvrir les requêtes spatiales">Requêtes</a>';
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.on(div, "click", (ev) => {
      L.DomEvent.preventDefault(ev);
      panneau.hidden = !panneau.hidden;
    });
    return div;
  };
  boutonRequetes.addTo(map);

  document.getElementById("req-fermer").addEventListener("click", () => { panneau.hidden = true; });


  /* ============================================================
     6. AFFICHAGE DES RÉSULTATS SUR LA CARTE PRINCIPALE
     ============================================================ */

  const COULEUR = "#6A1B9A";

  /* Les résultats passent au-dessus des couches du campus */
  map.createPane("requetes").style.zIndex = 398;

  const resultats = L.featureGroup().addTo(map);
  if (typeof controleCouches !== "undefined") {
    controleCouches.addOverlay(resultats, "Résultat des requêtes");
  }

  let graphiqueActif = null;

  const echapper = (texte) => {
    const div = document.createElement("div");
    div.textContent = texte;
    return div.innerHTML;
  };

  function effacer() {
    resultats.clearLayers();
    if (graphiqueActif) { graphiqueActif.destroy(); graphiqueActif = null; }
    document.getElementById("req-texte").innerHTML = "";
    document.getElementById("req-texte").className = "req-texte";
    document.getElementById("req-graphique").style.display = "none";
    document.getElementById("req-geojson").textContent = "";
  }

  function afficherTexte(html, erreur = false) {
    const zone = document.getElementById("req-texte");
    zone.innerHTML = html;
    zone.className = erreur ? "req-texte erreur" : "req-texte";
  }

  function afficherCollection(fc) {
    L.geoJSON(fc, {
      pane: "requetes",
      bubblingMouseEvents: false,
      style: { color: COULEUR, weight: 3, fillColor: COULEUR, fillOpacity: 0.35 },
      pointToLayer: (f, latlng) => L.circleMarker(latlng, {
        pane: "requetes",
        bubblingMouseEvents: false,
        radius: 6, color: "#FFFFFF", weight: 1.5, fillColor: COULEUR, fillOpacity: 1
      }),
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        const nom = p.name || p.nom;
        if (nom) layer.bindPopup(`<b>${echapper(String(nom))}</b>`);
      }
    }).addTo(resultats);

    if (resultats.getLayers().length && resultats.getBounds().isValid()) {
      map.fitBounds(resultats.getBounds(), { padding: [40, 40], maxZoom: 19 });
    }
    const apercu = JSON.stringify(fc, null, 1);
    document.getElementById("req-geojson").textContent =
      apercu.length > 20000 ? apercu.slice(0, 20000) + "\n…" : apercu;
  }

  function afficherEmprise(bbox) {
    const emprise = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
    L.rectangle(emprise, {
      pane: "requetes", color: COULEUR, weight: 2, fillOpacity: 0.1, dashArray: "6 4"
    }).addTo(resultats);
    map.fitBounds(emprise, { padding: [40, 40] });
    const f = (v) => v.toFixed(5);
    return `Sud-ouest : ${f(emprise[0][0])}, ${f(emprise[0][1])}<br>`
         + `Nord-est : ${f(emprise[1][0])}, ${f(emprise[1][1])}`;
  }

  function afficherGraphique(type, titre, categories, valeurs, unite) {
    if (typeof Highcharts === "undefined") return;
    const conteneur = document.getElementById("req-graphique");
    conteneur.style.display = "block";
    if (graphiqueActif) graphiqueActif.destroy();

    const serie = type === "pie"
      ? [{ name: unite, data: categories.map((c, i) => ({ name: c, y: valeurs[i] })) }]
      : [{ name: unite, data: valeurs, colorByPoint: true }];

    graphiqueActif = Highcharts.chart("req-graphique", {
      chart: { type, height: type === "bar" ? Math.max(260, 60 + categories.length * 40) : 260 },
      title: { text: titre, style: { fontSize: "13px" } },
      xAxis: { categories },
      yAxis: { title: { text: unite } },
      legend: { enabled: false },
      credits: { enabled: false },
      tooltip: { valueDecimals: unite === "objets" ? 0 : 1 },
      plotOptions: {
        pie: { dataLabels: { enabled: true, format: "{point.name} : {point.y}" } },
        series: { dataLabels: { enabled: type !== "pie" } }
      },
      series: serie
    });
  }


  /* ============================================================
     7. CONSTRUCTEUR DE MODÈLE (à la manière d'un Model Builder)
     ============================================================ */

  const modele = {
    couche: "points_iav", filtre: 1,
    etapes: [{ op: "count", distance: 10, couche2: "grass", filtre2: 0 }]
  };

  const zoneModele = document.getElementById("req-modele");

  const options = (liste, choisi) =>
    liste.map(([valeur, texte]) =>
      `<option value="${valeur}" ${String(valeur) === String(choisi) ? "selected" : ""}>${texte}</option>`).join("");

  const optionsCouches = (choisi) =>
    options(Object.entries(COUCHES).map(([k, c]) => [k, c.libelle]), choisi);

  const optionsFiltres = (couche, choisi) =>
    options(COUCHES[couche].filtres.map(([t], i) => [i, t]), choisi);

  function libelleEtape(e) {
    const op = OPERATIONS[e.op];
    if (e.op === "buffer") return `Tampon de ${e.distance} m`;
    if (op.couche2) {
      return `${op.libelle.replace("…", "")} ${COUCHES[e.couche2].filtres[e.filtre2][0].toLowerCase()}`;
    }
    return op.libelle;
  }

  function afficherModele() {
    let type = COUCHES[modele.couche].type;
    const blocsEtapes = modele.etapes.map((e, i) => {
      const typeEntree = type;
      type = typeApres(type, e);
      const ops = Object.entries(OPERATIONS)
        .filter(([, o]) => !o.type || o.type === typeEntree)
        .map(([k, o]) => [k, o.libelle]);
      const op = OPERATIONS[e.op];
      return `
        <div class="req-etape">
          <div class="req-etape-titre">Étape ${i + 1}
            <button class="req-suppr" data-i="${i}" type="button" title="Supprimer l'étape">×</button>
          </div>
          <select data-champ="op" data-i="${i}">${options(ops, e.op)}</select>
          ${e.op === "buffer" ? `<label>Distance (m)
            <input type="number" min="1" max="500" value="${e.distance}" data-champ="distance" data-i="${i}"></label>` : ""}
          ${op.couche2 ? `
            <select data-champ="couche2" data-i="${i}">${optionsCouches(e.couche2)}</select>
            <select data-champ="filtre2" data-i="${i}">${optionsFiltres(e.couche2, e.filtre2)}</select>` : ""}
        </div>`;
    }).join("");

    const derniere = modele.etapes[modele.etapes.length - 1];
    const peutAjouter = !derniere || !OPERATIONS[derniere.op].fin;

    const schema = [
      `<span class="boite boite-donnee">${COUCHES[modele.couche].filtres[modele.filtre][0]}</span>`,
      ...modele.etapes.map((e) =>
        `<span class="boite ${OPERATIONS[e.op].fin ? "boite-resultat" : "boite-outil"}">${libelleEtape(e)}</span>`)
    ].join('<span class="fleche">↓</span>');

    zoneModele.innerHTML = `
      <div class="req-etape req-entree">
        <div class="req-etape-titre">Donnée d'entrée</div>
        <select data-champ="couche">${optionsCouches(modele.couche)}</select>
        <select data-champ="filtre">${optionsFiltres(modele.couche, modele.filtre)}</select>
      </div>
      ${blocsEtapes}
      <div class="req-actions">
        ${peutAjouter ? '<button id="req-ajouter" type="button">+ Ajouter une étape</button>' : ""}
        <button id="req-executer" class="principal" type="button">Exécuter le modèle</button>
      </div>
      <div class="req-schema">${schema}</div>`;
  }

  zoneModele.addEventListener("change", (ev) => {
    const champ = ev.target.dataset.champ;
    if (!champ) return;
    const i = ev.target.dataset.i;
    const valeur = ev.target.value;
    if (champ === "couche") {
      modele.couche = valeur; modele.filtre = 0;
    } else if (champ === "filtre") {
      modele.filtre = Number(valeur);
    } else {
      const e = modele.etapes[i];
      if (champ === "distance") e.distance = Math.min(500, Math.max(1, Number(valeur) || 1));
      else if (champ === "couche2") { e.couche2 = valeur; e.filtre2 = 0; }
      else if (champ === "filtre2") e.filtre2 = Number(valeur);
      else if (champ === "op") {
        e.op = valeur;
        if (OPERATIONS[valeur].fin) modele.etapes.length = Number(i) + 1;
      }
    }
    /* Une opération devenue impossible (surface sur des points…) devient "Compter" */
    let type = COUCHES[modele.couche].type;
    modele.etapes.forEach((e) => {
      const t = OPERATIONS[e.op].type;
      if (t && t !== type) e.op = "count";
      type = typeApres(type, e);
    });
    afficherModele();
  });

  zoneModele.addEventListener("click", async (ev) => {
    if (ev.target.classList.contains("req-suppr")) {
      modele.etapes.splice(Number(ev.target.dataset.i), 1);
      afficherModele();
    } else if (ev.target.id === "req-ajouter") {
      modele.etapes.push({ op: "count", distance: 10, couche2: "grass", filtre2: 0 });
      afficherModele();
    } else if (ev.target.id === "req-executer") {
      await executerModele();
    }
  });


  /* ============================================================
     8. EXÉCUTION DU MODÈLE
     ============================================================ */

  const arrondi = (v) => Math.round(v * 10) / 10;
  const nombreFr = (v) => v.toLocaleString("fr-FR");

  function executerParCategorie(op) {
    const variantes = variantesParCategorie(modele, op);
    if (!variantes.length) {
      afficherTexte("Cette couche n'a pas de catégories : choisissez une opération sans regroupement.", true);
      return;
    }
    const unite = op === "countBy" ? "entités" : op === "areaBy" ? "m²" : "m";
    const groupes = variantes
      .map((v) => [v.nom, arrondi(executer(v.m).nombre)])
      .filter(([, valeur]) => valeur > 0)
      .sort((a, b) => b[1] - a[1]);

    if (!groupes.length) {
      afficherTexte("Aucune catégorie ne contient d'entité.");
      return;
    }
    const categories = groupes.map((g) => g[0]);
    const valeurs = groupes.map((g) => g[1]);
    const total = arrondi(valeurs.reduce((a, b) => a + b, 0));
    const lignes = groupes.map(([c, v]) => `${c} : <b>${nombreFr(v)} ${unite}</b>`).join("<br>");
    afficherTexte(`${lignes}<br>Total : <b>${nombreFr(total)} ${unite}</b>`);

    const typeGraphique = op === "countBy" ? "column" : op === "areaBy" ? "pie" : "bar";
    afficherGraphique(typeGraphique, OPERATIONS[op].libelle, categories, valeurs,
      unite === "entités" ? "objets" : unite);
  }

  async function executerModele() {
    effacer();
    if (!modele.etapes.length) {
      afficherTexte("Ajoutez au moins une étape au modèle.", true);
      return;
    }
    if (window.location.protocol === "file:") {
      afficherTexte("La page est ouverte par double-clic : ouvrez-la avec Live Server pour lire les fichiers GeoJSON.", true);
      return;
    }

    afficherTexte("Calcul du modèle en cours…");
    const manquants = await chargement;
    /* Laisse le navigateur afficher le message avant le calcul */
    await new Promise((r) => setTimeout(r, 30));

    const op = modele.etapes[modele.etapes.length - 1].op;
    try {
      if (OPERATIONS[op].grouper) {
        executerParCategorie(op);
      } else {
        const r = executer(modele);
        if (r.collection) {
          afficherCollection(r.collection);
          afficherTexte(`Le modèle renvoie <b>${r.collection.features.length}</b> entité(s), affichées en violet sur la carte.`);
        } else if (r.emprise !== undefined) {
          if (r.emprise) afficherTexte(afficherEmprise(r.emprise));
          else afficherTexte("Aucune entité : l'emprise ne peut pas être calculée.");
        } else {
          const valeur = arrondi(r.nombre);
          afficherTexte(`Résultat du modèle : <b>${nombreFr(valeur)} ${r.unite}</b>`);
          afficherGraphique("column", "Résultat du modèle",
            [OPERATIONS[op].libelle], [valeur], r.unite === "entités" ? "objets" : r.unite);
        }
      }
      if (manquants.length) {
        document.getElementById("req-texte").insertAdjacentHTML("beforeend",
          `<br><i>Fichiers introuvables : ${manquants.map((n) => n + ".geojson").join(", ")}.</i>`);
      }
    } catch (err) {
      console.error(err);
      afficherTexte(`Erreur pendant le calcul : ${echapper(err.message)}`, true);
    }
  }

  afficherModele();
  document.getElementById("req-effacer").addEventListener("click", effacer);
})();
