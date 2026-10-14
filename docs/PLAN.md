# Plan de finalisation ATOM-AI : conclure le modèle, livrer le tableau de bord

Version 1 du 14/10/2026. Rédigé par rayen-audit-atom pour Rayen.
Sources : cahier des charges v9, inventaire d'ines (salon, messages 290, 292 et 293), brainstorming d'architecture avec ChatGPT.
Document confidentiel, usage interne Tukhnanutha.

**Objectif final** : le tableau de bord atom.zelqane.com est complet, fiable et démontrable en soutenance, y compris quand le GPU est éteint.
**Moyen** : le modèle est figé et qualifié sur ines-pc ; le tableau de bord est construit sur le PC Rayen ; Mahdi assure le renfort qualité et l'espace éolien côté interface.

---

## 1. Décisions d'architecture (à valider par Rayen : D1 à D6)

| # | Décision | Pourquoi |
|---|---|---|
| D1 | **Le GPU publie des instantanés immuables dans Cloudflare R2.** Le tableau de bord ne lit que R2, via le Worker. Un manifeste `latest.json` n'est réécrit qu'après vérification de l'instantané complet | Règle la section 17.1 (« service endormi ») et la tâche 56 côté affichage : le dernier état réel reste visible avec son horodatage, sans mode démo. **R2 doit être activé sur le compte Cloudflare (offre gratuite jusqu'à 10 Go, décision financière de Rayen)** |
| D2 | **Le contrat de données est figé le jour 2** (OpenAPI + JSON Schema + 3 instantanés de test) dans `atom-dashboard/contract/`, et recopié tel quel dans `pcfno3d/tests/contract/` | Les deux équipes avancent sans s'attendre ; toute modification passe par une PR validée des deux côtés |
| D3 | **Front : Vite + TypeScript + React + three.js + ECharts.** three.js est conservé (déjà en place, domaine local) ; pas de Cesium ni de deck.gl | Section 17.5 du cahier ; c'est le coût d'intégration le plus faible en 3 semaines |
| D4 | **Les calculs scientifiques ne vivent qu'en Python** (incertitude, alertes, éolien, Weibull). Le front affiche, il ne recalcule pas | Une seule source de vérité, et le critère EOL1 est évalué en Python |
| D5 | **Le modèle v7 est figé après une dernière tentative bornée** (au plus 2 jours de GPU) sur DSO1 entre 650 et 1 000 m. En cas d'échec, le résultat est présenté honnêtement (risque « critère DSO non atteint » de la section 22) | Clôt définitivement le volet modèle ; tout le temps restant va à la fiabilité et au produit |
| D6 | **Niveaux exprimés en altitude au-dessus du niveau de la mer** dans le modèle. Le mode « hauteur au-dessus du sol » est calculé à partir du relief, jamais en changeant simplement le libellé | Piège identifié par ines et par ChatGPT (120 m sol ≠ 120 m mer) |

## 2. Équipes, postes et règles

| Poste | Agent | Rôle | Dépôt |
|---|---|---|---|
| ines-pc | **ines** (coordinatrice locale, peut lancer des sous-agents Claude Code) | Modèle, fiabilité, données, alertes, éolien (calcul), publication R2, API, MCP | `rayenbenamorr/pcfno3d` |
| PC Rayen | **rayen-audit-atom** (coordination générale et front) + sous-agents | Contrat, Worker + R2, scène 3D, pages du tableau de bord, déploiement | `rayenbenamorr/atom-dashboard` |
| PC Mahdi | **mahdi-claude** | Tests E2E Playwright, mesure des FPS et des temps d'affichage, pages Éolien et Alertes du front | `atom-dashboard` (branches `agent/mahdi-claude/*`) |

**Règles communes :**
- Branches `agent/<nom>/<sujet>` ; fusion **par PR uniquement** ; relecture croisée obligatoire pour `contract/`.
- Chaque équipe développe contre les **instantanés de test du contrat**, jamais contre la branche en cours de l'autre équipe.
- Aucun secret dans le salon ni dans git. Les clés passent d'humain à humain.
- Déploiement de atom.zelqane.com : seul rayen-audit-atom déploie, depuis `origin/main`, avec annonce dans le canal `deploiement` avant et après.
- Points de synchronisation : chaque soir, chaque agent poste dans le salon (canal `general`, fil « ATOM ») ce qui est fait, ce qui bloque, et le prochain lot.
- Les tâches sont suivies dans le tableau `/api/tasks` du salon (app = `atom`).

## 3. Contrat v1 (lot 0, figé à J2)

**Points d'accès** (servis par le Worker depuis R2 ; le service Python les produit) :

| Point d'accès | Contenu |
|---|---|
| `GET /v1/meta` | Grille 500×250×12, niveaux au-dessus du niveau de la mer, domaine, repère, ancrage (signalé « supposé »), relief (lien binaire), unités |
| `GET /v1/latest` | Manifeste : `snapshot_id`, `valid_time`, `generated_at`, `published_at`, `last_observation_at`, `model_version`, `norm_version`, `data_version`, `compute_status`, `data_status` |
| `GET /v1/times?from&to` | Instantanés disponibles (paginé) |
| `GET /v1/snapshots/{id}` | Résumé, indicateurs clés, DSO de l'instant (résidu de masse, condition au sol), liens vers les ressources |
| `GET /v1/fields/{id}/{level}/{var}` | Binaire Float32 little-endian, `[j][i]` du sud au nord puis d'ouest en est, NaN sous le relief. Variables : `u v w speed sigma_u sigma_v coverage reliability status` |
| `GET /v1/profiles/{id}?x&y` | Profil vertical avec p10, p50 et p90, statut, couverture, station la plus proche |
| `GET /v1/quality/{id}` | Carte de confiance agrégée, répartition des nœuds, calibration (`calibrated: true/false`) |
| `GET /v1/alerts/{id}` | Alertes : niveau, cause, recommandation, horodatage |
| `GET /v1/stations/{id}` | Stations : position, état (active, suspecte, muette, en dérive), dernière mesure |
| `GET /v1/wind-farm/{id}` | Éoliennes, vent au moyeu, vent équivalent rotor, cisaillement, puissance [p10, p90], état ; production du parc |
| `GET /v1/windrose?x&y&hub&from&to` | Rose des vents et Weibull (k, c), avec le **nombre d'instants valides** |

**Sémantique obligatoire :**
- Direction = d'où vient le vent, `(270 − atan2(v,u)) mod 360`. Elle est **indéfinie** si la vitesse est inférieure à 0,2 m/s.
- `measured` est réservé aux nœuds d'un capteur réel. `estimated` s'applique à tout le reste.
- L'incertitude porte `method` et `calibrated`.

**Trois instantanés de test** : `normal`, `capteur_en_derive`, `gpu_eteint` (manifeste périmé).

## 4. Volet MODÈLE : ines-pc (conclure définitivement)

Ordre imposé. Chaque lot = une branche, une PR, des tests.

| Lot | Contenu | Critère de fin | Cahier |
|---|---|---|---|
| M0 | Push sur le dépôt privé (en cours), DSO3 remis à (0,9 ; 1,1), test de déterminisme + tolérance écrite | `origin/main` à jour ; test DE2 vert | tâches 2, R1, DE2 |
| M1 | **Dernière tentative DSO1 entre 650 et 1 000 m** (au plus 2 jours de GPU : raffinement par niveau ou ERA5 en entrée), puis **gel de v7 (ou v7.1)** avec tag git, sha256 des poids et `norm_stats` | Tableau DSO1 à DSO5 final sur 120 instants, archivé ; décision écrite « modèle figé » | tâches 2 et 60, D5 |
| M2 | **Module de fiabilité** : statut mesuré / estimé, indice de couverture, ensemble de N masquages, sigma u/v/w, calibration par facteur d'échelle sur la validation, classe de fiabilité | DSO6 : au moins 80 % des valeurs vraies dans l'intervalle à 80 %, corrélation erreur / sigma > 0 | L4, BF7 à BF9, tâche 3 |
| M3 | **Contrat ANEO** (Pandera) : rapport qualité JSON, quarantaine, 3 fichiers de test ; détection des stations muettes et des valeurs interpolées | DE1 vert | L2, BF2, BF3, tâche 4 |
| M4 | **Alertes** : capteur en dérive (station masquée comparée à la reconstruction), station muette, part de stations valides trop faible, résidu de masse, vent fort au moyeu, cisaillement ; 4 niveaux ; recommandations ; journal JSONL ; simulation de pannes et de dérives | AN1 : au moins 90 % de détection et moins de 5 % de fausses alertes | BF20 à BF23, tâches 23 et 24 |
| M5 | **Éolien (calcul)** : déclaration d'éoliennes, vent au moyeu, vent équivalent rotor (moyenne du cube), cisaillement, puissance avec correction de densité et intervalle, état ; Weibull et production annuelle ; évaluation EOL1 | EOL1 : écart inférieur à 5 % sur les jours de test | BF64 à BF71 |
| M6 | **Publication** : exports NetCDF + CSV avec versions (DE3) ; **publication R2 atomique** des instantanés au format du contrat ; historique (index) ; rejeu des 120 instants de test « comme en direct » | Arrêter le GPU au milieu d'une publication ne casse jamais `latest` ; HIS1 vert | BF6, BF12, BF40, tâches 5, 6 et 9 |
| M7 | **API et MCP** : fermer le mode ouvert (`auth.py:160`), quotas + journal d'accès, test HTTP « clé révoquée » ; outils MCP `simuler_panne`, `comparer_scenarios`, `alertes_actives`, `production_eolienne` | API1 et MCP1 verts | BF42, BF45, BF46 |
| M8 | **Preuves** : comparaison avec le profil logarithmique et le krigeage, E1 sur 120 instants, E2, E3, E5 (CodeCarbon) ; data card et model card ; UML (cas d'utilisation, classes, séquence) | L6, L7 et L9 livrés | tâches 7, 13, 14, 29 à 33 |

**Workflow multi-agents sur ines-pc** (ines coordonne, chaque sous-agent dans son propre worktree) :
- Vague 1, en parallèle : M0 | M3 | M7 (indépendants) ; M1 tourne sur le GPU pendant ce temps.
- Vague 2 : M2 (après le gel M1), puis M4 et M5 en parallèle (ils consomment M2).
- Vague 3 : M6 (consomme tout), puis M8.
- Pour chaque lot : un sous-agent « implémente », puis un sous-agent « vérifie » relit la PR (tests, unités, direction, relief) avant la fusion.
- Le GPU (Colab) n'est utilisé que pour M1, M2 (ensembles), M4 (évaluation AN1), M6 (rejeu et publication) et M8. Ces passages sont groupés en sessions planifiées avec Rayen, qui doit valider l'autorisation Drive.

## 5. Volet TABLEAU DE BORD : PC Rayen et PC Mahdi

| Lot | Contenu | Agent | Critère de fin | Cahier |
|---|---|---|---|---|
| F0 | Contrat v1 + 3 instantanés de test + validateurs TS ; migration vers Vite + TS + React ; CI GitHub Actions (lint, types, tests) | rayen-audit-atom | Instantanés de test validés en Python et en TS | D2, D3 |
| F1 | **Worker + R2** : lecture de `latest` et des instantanés, cache immuable, bannière « dernier état réel du … » quand le GPU est éteint ; suppression du mode démo | rayen-audit-atom (sous-agent Worker) | Instantané `gpu_eteint` affiché avec horodatage, zéro donnée fictive | 17.1, tâche 56 |
| F2 | **Scène 3D** : relief ombré avec exagération ×1 à ×10, socle, nord, échelle ; lignes de courant colorées ; hauteur au-dessus du sol par défaut à 120 m, mode altitude en option ; coupes verticale et horizontale ; clic → profil avec intervalle à 80 %, statut, fiabilité, station la plus proche ; couches stations et éoliennes ; coloration vitesse / incertitude / fiabilité avec légende chiffrée ; frise temporelle et rejeu | rayen-audit-atom (sous-agents scène et interactions) | V3D1 à V3D8 ; au moins 30 FPS sur un portable courant (V3D10) | 17.2 |
| F3 | **Pages** : Vue d'ensemble (indicateurs clés TB1, carte à 10, 100, 300 et 1 000 m avec les stations TB2, alertes TB3, séries au moyeu TB4, DSO TB5) ; **Fiabilité** (cartes vent et incertitude, répartition, panne simulée TB6) ; **Modèle** | rayen-audit-atom (sous-agent pages) | VIS1 : moins de 3 s pour afficher une reconstruction et ses indicateurs | 15.3, 17.3 |
| F4 | **Pages Éolien** (parc, éolienne, sites candidats, rose des vents, Weibull) et **Alertes** (liste, niveaux, recommandations, historique) | mahdi-claude | Affiche fidèlement `/v1/wind-farm` et `/v1/alerts` des instantanés de test | BF64 à BF69, 15.4 |
| F5 | **Qualité** : tests E2E Playwright sur les 3 instantanés de test ; mesure des FPS (5e centile), du clic → retour visuel (p95 inférieur à 150 ms), du changement d'altitude (p95 inférieur à 500 ms) ; tests des pièges (direction sur 8 cas cardinaux, NaN sous le relief, sol / mer) | mahdi-claude | Rapport de performance + CI verte | V3D10, VIS1 |
| F6 | **Intégration réelle** : branchement sur les instantanés publiés par M6, comparaison de deux instants, charte graphique (17.4), export CSV / NetCDF depuis l'interface ; vidéo de démonstration de secours | rayen-audit-atom + mahdi-claude | Scénario de la section 23 jouable de bout en bout, GPU allumé **et** éteint | 23, tâche 20 |

**Workflow multi-agents sur le PC Rayen** (je coordonne ; sous-agents en worktrees isolés) :
- F0 seul, sans parallélisme : c'est la fondation.
- Puis 3 sous-agents en parallèle : **F1** (Worker et R2), **F2** (scène 3D), **F3** (pages) ; Mahdi démarre **F4** et **F5** en même temps sur son poste.
- Chaque PR passe une revue `/code-review` et les tests E2E de Mahdi avant la fusion.
- RAM du PC Rayen limitée (7,7 Go) : au plus 3 sous-agents simultanés, pas de build lourd en parallèle.

## 6. Calendrier (J1 = jeudi 15/10)

| Jours | Modèle (ines-pc) | Tableau de bord (Rayen et Mahdi) | Point de contrôle |
|---|---|---|---|
| J1–J2 | M0, M3, M7 ; M1 sur le GPU | F0 (contrat figé J2) | **Contrat v1 signé par les deux côtés** |
| J3–J6 | fin de M1 (gel), M2 | F1, F2, F3, F4, F5 sur les instantanés de test | Démo interne J6 : instantané de test + GPU éteint |
| J7–J12 | M4, M5 | F2 et F3 terminés, F4 | Instantanés réels avec fiabilité publiés dans R2 (J12) |
| J13–J16 | M6 (publication et rejeu) | F5, début de F6 | AN1, DSO6 et EOL1 mesurés |
| J17–J19 | M8 (preuves, cartes, UML) | F6 | Scénario de la section 23 joué de bout en bout |
| J20–J21 | gel du code | gel, vidéo de secours | **Recette Rayen**, mise à jour du rapport |

## 7. Ce qui dépend de Rayen (bloquant si non tranché)

1. **Activer R2** sur le compte Cloudflare de zelqane.com (D1) et choisir où tourne le GPU de publication (Colab planifié ou serveur GPU).
2. **Valider D1 à D6**, en particulier le gel du modèle après une seule tentative (D5).
3. **Renouveler les identifiants du tunnel** (tâche 57), à faire dans Cloudflare.
4. **Fixer le seuil DSO7** et fournir la position réelle du domaine et la liste des capteurs ANEO (tâche 61). Sans cela, l'ancrage reste affiché comme « supposé ».
5. **Faire valider le cadrage** par M. Khedhri (tâche 1) ; retrouver ou démarrer le **rapport de PFE** avec Ines.
6. Accepter l'invitation GitHub (Ines) et indiquer le compte GitHub de Mahdi.
