# 42 Angouleme Widget

![GNOME Shell](https://img.shields.io/badge/GNOME-Shell%2042-4A86CF)
![License](https://img.shields.io/badge/License-MIT-green)

Extension GNOME Shell pour afficher votre temps de présence 42 directement dans la barre, avec renouvellement OAuth automatique et raccourcis vers les outils 42 Angoulême.

**UUID :** `angouleme42@rcaillie`

## Sommaire

- [Pourquoi ce projet](#pourquoi-ce-projet)
- [Features](#features)
- [Flow technique](#flow-technique)
- [Architecture actuelle](#architecture-actuelle)
- [Installation](#installation)
- [Configuration](#configuration)
- [Recuperer les tokens OAuth](#recuperer-les-tokens-oauth)
- [Compatibilite](#compatibilite)
- [Troubles courants](#troubles-courants)
- [Debug](#debug)
- [Security](#security)
- [Roadmap](#roadmap)
- [FAQ](#faq)

## Preview

<img width="404" height="40" alt="preview widget" src="https://github.com/user-attachments/assets/1b114b3c-1150-4fe7-829e-906d7a2a7e7c" />

[Screencast from 04-02-2026 04:04:31 PM.webm](https://github.com/user-attachments/assets/5eafb606-08db-4359-b140-3a3f5d1e5f76)

## Pourquoi ce projet

Consultez votre temps de présence 42 sans ouvrir l'intranet. Le widget reste léger, discret et affiche l'information directement dans la barre GNOME.

## Fonctionnalités

- **Affichage en temps réel** : consultation du temps de présence directement dans la barre GNOME
- **Non-bloquant** : appels réseau asynchrones pour ne pas figer l'interface GNOME
- **Cache optimisé** : rafraîchissement API toutes les 5 min, tentative immédiate au démarrage
- **OAuth automatique** : renouvellement du token via `refresh_token` si les identifiants sont valides
- **Gestion des erreurs propre** : fallback vers `42 N/A` si l'API est indisponible ou la config manque
- **Backoff exponentiel** : délai adaptatif en cas d'échec réseau (10s → 20s → 40s … jusqu'à 5 min)
- **Bouton Rafraîchir** : force une tentative immédiate (contourne le backoff)
- **Menu contextuel** : accès rapide aux services 42 Angoulême
- **Stockage local sécurisé** : configuration OAuth dans `~/.config/angouleme42-widget/config.json`

## Flux technique

1. Lecture de la configuration locale au démarrage
2. Mise à jour de l'interface depuis le cache local (sans bloquer GNOME)
3. Renouvellement du token OAuth si nécessaire
4. Appel asynchrone de `/v2/users/<login>/locations?sort=-begin_at&per_page=1`
5. Application d'un backoff exponentiel en cas d'échec
6. Calcul de la durée de présence depuis `begin_at` et `end_at`
7. Affichage du résultat dans la barre et le menu GNOME

## Architecture

Le projet maintain une architecture minimaliste pour rester maintenable :

```text
extension.js    → Logique GNOME, gestion config, OAuth, appels API, UI
install.sh      → Installation locale et activation
stylesheet.css  → Style du widget
config.example.json → Modèle de configuration
```

## Installation

```bash
git clone https://github.com/rom98759/42_angouleme_widget.git
cd 42_angouleme_widget
chmod +x install.sh
./install.sh
```

Le script :

- Installe l'extension dans `~/.local/share/gnome-shell/extensions/angouleme42@rcaillie`
- Crée le dossier de configuration `~/.config/angouleme42-widget`
- Crée `~/.config/angouleme42-widget/config.json` s'il n'existe pas
- Active l'extension

Ensuite :

1. Modifiez `~/.config/angouleme42-widget/config.json` avec vos valeurs OAuth
2. Vérifiez l'état avec `gnome-extensions-app` ou `gnome-extensions info angouleme42@rcaillie`

## Configuration

Le seul fichier à maintenir :

```text
~/.config/angouleme42-widget/config.json
```

Un modèle est fourni dans le dépôt (`config.example.json`). Si vous n'avez pas encore les jetons OAuth, consultez la section [Obtenir les jetons OAuth](#recuperer-les-tokens-oauth).

Exemple minimal:

```json
{
  "login": "LOGIN_42",
  "client_id": "u-s4t2ud-XXX",
  "client_secret": "s-s4t2ud-XXX",
  "access_token": "XXX",
  "refresh_token": "XXX",
  "created_at": 1775132563,
  "expires_in": 7200
}
```

**Champs requis :**

| Clé             | Description                                        |
| --------------- | -------------------------------------------------- |
| `login`         | Identifiant 42                                     |
| `client_id`     | Identifiant client OAuth                           |
| `client_secret` | Secret client OAuth                                |
| `access_token`  | Jeton d'accès                                      |
| `refresh_token` | Jeton de renouvellement                            |
| `created_at`    | Timestamp de création du jeton (optionnel)         |
| `expires_in`    | Durée de validité du jeton en secondes (optionnel) |

**Permissions recommandées :**

```bash
chmod 700 ~/.config/angouleme42-widget
chmod 600 ~/.config/angouleme42-widget/config.json
```

## Obtenir les jetons OAuth

> [!WARNING] > **Sécurité** : Garden vos jetons confidentiels. Ne les publiez jamais sur GitHub ou dans un dépôt public.

### Créer une application 42

1. Accédez à votre profil 42 : **Paramètres → API → Créer une nouvelle application**
2. Remplissez les informations :
   - **Nom** : `Angouleme42Widget`
   - **Description** : `Widget GNOME Shell pour afficher le temps de présence 42`
   - **Type** : `Create statistics`
   - **Redirect URI** : `https://localhost:8080/callback`
3. Validez et notez vos valeurs `UID` (client_id) et `Secret` (client_secret)

### Générer les jetons d'accès

1. Ouvrez ce lien d'autorisation (remplacez `u-s4t2ud-XXX` par votre `client_id`) :

```text
https://api.intra.42.fr/oauth/authorize?client_id=u-s4t2ud-XXX&redirect_uri=https%3A%2F%2Flocalhost%3A8080%2Fcallback&response_type=code
```

2. Récupérez le `code=XXXXXX` dans l'URL de redirection :

```text
https://localhost:8080/callback?code=XXXXXX
```

3. Échangez le code contre les jetons (remplacez `XXX` et `XXXXXX`) :

```bash
curl -s -X POST "https://api.intra.42.fr/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "client_id=u-s4t2ud-XXX" \
  -d "client_secret=s-s4t2ud-XXX" \
  -d "code=XXXXXX" \
  -d "redirect_uri=https://localhost:8080/callback"
```

4. Copiez la réponse JSON dans votre configuration :

```bash
nano ~/.config/angouleme42-widget/config.json
```

L'extension calcule `expires_at` automatiquement si nécessaire (`created_at + expires_in`).

## Compatibilité

- **GNOME Shell** : 42+
- **Distributions** : Linux avec GNOME 42+
- **Paquets requis** : `gnome-extensions`

## Dépannage

| Symptôme                    | Cause probable                      | Solution                                                       |
| --------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `42 N/A` permanent          | Configuration manquante ou invalide | Vérifiez `login`, `access_token`, `refresh_token`              |
| Rien dans la barre          | Extension inactive                  | Exécutez `gnome-extensions enable angouleme42@rcaillie`        |
| Rafraîchissement impossible | Jetons expirés                      | Renouvellement OAuth échoué, consultez [Debug](#debug)         |
| API 42 indisponible         | Erreur réseau côté API              | Le widget revient à `42 N/A` et retente automatiquement        |
| Tentatives différées        | Backoff actif après erreur          | Cliquez sur « Rafraîchir » pour forcer une tentative immédiate |

Consultez [Configuration](#configuration) pour ajuster vos paramètres, ou [Debug](#debug) pour analyser les erreurs.

## Débogage

### Suivi en temps réel

```bash
journalctl -f /usr/bin/gnome-shell
```

### Commandes utiles

```bash
gnome-shell --version                           # Vérifier la version GNOME
gnome-extensions info angouleme42@rcaillie      # Infos sur l'extension
gnome-extensions disable angouleme42@rcaillie   # Désactiver
gnome-extensions enable angouleme42@rcaillie    # Activer
gnome-extensions-app                            # Interface graphique
```

### Test API manuel

```bash
curl -H "Authorization: Bearer VOTRE_TOKEN" \
"https://api.intra.42.fr/v2/users/VOTRE_LOGIN/locations?sort=-begin_at&per_page=1"
```

## Sécurité

- **Stockage local** : Les secrets OAuth ne sont conservés que localement dans `~/.config/angouleme42-widget/config.json`
- **Pas de télémétrie** : Aucun tracking ou collecte de données n'est effectuée
- **Confidentialité** : Les erreurs d'API ne sont jamais transmises à des serveurs externes

## Roadmap

- [ ] Logging d'erreurs dans un fichier local pour faciliter le debug
- [ ] Panneau de parametres GNOME
- [ ] Messages d'erreur plus explicites dans l'UI
- [ ] Afficher le delai de backoff restant dans le menu

## Contribuer

Les contributions sont bienvenues ! Avant de proposer une modification :

- Respectez le style existant du code
- Testez votre implémentation sur GNOME
- Décrivez clairement vos changements dans la PR

## FAQ

### Pourquoi vois-je `42 N/A` ?

Généralement, cela indique une configuration incomplète, un jeton invalide ou une indisponibilité de l'API 42.

**Vérifications à effectuer :**

- Confirmez que toutes les clés sont présentes : `login`, `client_id`, `client_secret`, `access_token`, `refresh_token`
- Commencez par [Configuration](#configuration) si vous n'avez pas rempli le fichier
- Consultez [Obtenir les jetons OAuth](#recuperer-les-tokens-oauth) si vous manquez d'authentifiants

### Fonctionne-t-il en dehors du campus ?

Oui, l'extension fonctionne de n'importe où, tant que :

- L'API 42 est accessible
- Vos jetons OAuth sont valides

### Puis-je l'utiliser sans jeton ?

Non. L'extension nécessite une authentification OAuth valide pour accéder à l'API 42.

## Licence

Ce projet est distribue sous licence MIT. Voir [LICENSE](LICENSE).

## GitHub

- https://github.com/rom98759/42_angouleme_widget.git
