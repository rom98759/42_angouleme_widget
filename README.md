# 42 Angouleme Widget

![GNOME Shell](https://img.shields.io/badge/GNOME-Shell%2042-4A86CF)
![License](https://img.shields.io/badge/License-MIT-green)

Extension GNOME Shell pour afficher le temps de presence 42 directement dans le panel, avec rafraichissement OAuth automatique et raccourcis utiles vers les outils 42 Angouleme.

UUID GNOME: `angouleme42@rcaillie`

## Preview

<img width="404" height="40" alt="preview widget" src="https://github.com/user-attachments/assets/1b114b3c-1150-4fe7-829e-906d7a2a7e7c" />

[Screencast from 04-02-2026 04:04:31 PM.webm](https://github.com/user-attachments/assets/5eafb606-08db-4359-b140-3a3f5d1e5f76)

## Pourquoi ce projet

Utile pour suivre ton temps de presence 42 sans ouvrir l'intra. Le widget reste leger, discret, et donne l'etat directement dans le panel GNOME.

## Features

- Affichage du temps de presence en temps reel dans le panel GNOME.
- Appels reseau non bloquants (asynchrones) pour eviter de figer GNOME Shell.
- Rafraichissement API pilote par cache (5 min) avec tentative immediate au demarrage.
- Refresh OAuth automatique via `refresh_token` si les identifiants sont valides.
- Fallback propre vers `42 N/A` si l'API est indisponible ou si la config manque.
- Backoff exponentiel en cas d'echec reseau (10s -> 20s -> 40s ... jusqu'a 5 min).
- Bouton `Rafraichir` qui force une tentative immediate (bypass backoff).
- Menu contextuel avec liens utiles vers les services 42 Angouleme.
- Stockage local de la configuration OAuth dans `~/.config/angouleme42-widget/config.json`.

## Flow technique

1. L'extension lit la config locale au demarrage.
2. L'UI se met a jour depuis le cache local, sans bloquer le thread GNOME.
3. Si besoin, elle renouvelle le token OAuth via l'endpoint 42.
4. Elle appelle `/v2/users/<login>/locations?sort=-begin_at&per_page=1` en asynchrone.
5. En cas d'echec, elle applique un backoff exponentiel avant la tentative suivante.
6. Elle calcule la duree de presence a partir de `begin_at` et `end_at`.
7. Elle affiche le resultat dans le panel et dans le menu GNOME.

## Architecture actuelle

Le projet est volontairement simple. Toute la logique est concentree dans un seul fichier principal:

```text
extension.js  -> logique GNOME, config, OAuth, API, UI
install.sh    -> installation locale et activation
stylesheet.css -> style du widget
```

## Installation

```bash
git clone https://github.com/rom98759/42_angouleme_widget.git
cd 42_angouleme_widget
chmod +x install.sh
./install.sh
```

Le script:

- installe l'extension dans `~/.local/share/gnome-shell/extensions/angouleme42@rcaillie`
- cree le dossier de config `~/.config/angouleme42-widget`
- cree `~/.config/angouleme42-widget/config.json` si absent
- active l'extension

Ensuite:

1. Edite `~/.config/angouleme42-widget/config.json`
2. Mets tes vraies valeurs OAuth
3. Verifie l'etat avec `gnome-extensions-app`

## Configuration

Le seul fichier a maintenir est:

```text
~/.config/angouleme42-widget/config.json
```

Template fourni dans le repo: `config.example.json`.

Exemple minimal:

```json
{
  "fortyTwoLogin": "LOGIN_42",
  "client_id": "u-s4t2ud-XXX",
  "client_secret": "s-s4t2ud-XXX",
  "access_token": "XXX",
  "refresh_token": "XXX",
  "created_at": 1775132563,
  "expires_in": 7200
}
```

Champs utilises par l'extension:

- `fortyTwoLogin` ou `login`
- `client_id`
- `client_secret`
- `access_token` ou `fortyTwoToken`
- `refresh_token`
- `created_at` et `expires_in` si tu veux que le calcul d'expiration soit persistant

Permissions conseillees:

```bash
chmod 700 ~/.config/angouleme42-widget
chmod 600 ~/.config/angouleme42-widget/config.json
```

## Recuperer les tokens OAuth

> [!WARNING]
> Ne partage jamais tes tokens ou secrets. Ne les mets pas sur GitHub.
> Remplace `u-s4t2ud-XXX` et `s-s4t2ud-XXX` par tes vrais client_id et client_secret.

<img width="1741" height="786" alt="image" src="https://github.com/user-attachments/assets/a8f14a1c-e4f0-4f75-8bf1-b7f901e2ee0d" />

1. Ouvre:

```text
https://api.intra.42.fr/oauth/authorize?client_id=u-s4t2ud-XXX&redirect_uri=https%3A%2F%2Flocalhost%3A8080%2Fcallback&response_type=code
```

2. Recupere `code=...` dans l'URL de callback.

3. Echange le code (REPLACE `XXX`) contre les tokens:

```bash
curl -s -X POST "https://api.intra.42.fr/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "client_id=u-s4t2ud-XXX" \
  -d "client_secret=s-s4t2ud-XXX" \
  -d "code=XXX" \
  -d "redirect_uri=https://localhost:8080/callback"
```

L'extension calcule `expires_at` automatiquement si besoin (`created_at + expires_in`).

## Compatibilite

- GNOME Shell teste: 42
- Distribution testee: environnement GNOME Linux local
- Package requis cote utilisateur: `gnome-extensions`

## Troubles courants

- `42 N/A` en permanence: verifier `fortyTwoLogin`, `access_token` et `refresh_token`.
- Rien n'apparait dans le panel: verifier que l'extension est bien active avec `gnome-extensions info angouleme42@rcaillie`.
- Rafraichissement impossible: le `client_secret` ou le `refresh_token` est probablement invalide.
- API 42 down: le widget revient volontairement sur `42 N/A` plutot que de bloquer GNOME, puis retente automatiquement avec backoff.
- Apres un echec API, une nouvelle tentative peut etre differee (jusqu'a 5 min max): utilise `Rafraichir` pour forcer un essai immediat.

## Debug

Pour suivre les erreurs GNOME Shell en direct:

```bash
journalctl -f /usr/bin/gnome-shell
```

Commandes utiles:

```bash
gnome-shell --version
gnome-extensions-app
gnome-extensions info angouleme42@rcaillie
gnome-extensions disable angouleme42@rcaillie
gnome-extensions enable angouleme42@rcaillie
```

Test API manuel:

```bash
curl -H "Authorization: Bearer XXX" \
"https://api.intra.42.fr/v2/users/LOGIN_42/locations?sort=-begin_at&per_page=1"
```

## Security

- Les secrets OAuth sont stockes uniquement en local dans `~/.config/angouleme42-widget/config.json`.
- Aucun tracking n'est ajoute par l'extension.
- Les erreurs d'API ne sont pas remontees vers un serveur externe.

## Roadmap

- [ ] Logging d'erreurs dans un fichier local pour faciliter le debug
- [ ] Panneau de parametres GNOME
- [ ] Messages d'erreur plus explicites dans l'UI
- [ ] Afficher le delai de backoff restant dans le menu

## Contribuer

PR welcome. Merci de respecter le style existant et de tester sur GNOME avant de proposer une modification.

## FAQ

### Pourquoi j'ai `42 N/A` ?

En general, la config OAuth est incomplete, le token est invalide, ou l'API 42 ne repond pas.

### Est-ce que ca marche hors campus ?

Oui, tant que l'API 42 est joignable et que ton token est valide.

### Puis-je l'utiliser sans token ?

Non. L'extension a besoin d'un acces OAuth valide pour interroger l'API 42.

## Licence

Ce projet est distribue sous licence MIT. Voir [LICENSE](LICENSE).

## GitHub

- https://github.com/rom98759/42_angouleme_widget.git
