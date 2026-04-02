# 42 Angouleme Widget

Extension GNOME Shell pour afficher le temps de presence 42 dans le panel.

UUID GNOME: `angouleme42@rcaillie`

## Preview

<img width="404" height="40" alt="image" src="https://github.com/user-attachments/assets/1b114b3c-1150-4fe7-829e-906d7a2a7e7c" />

[Screencast from 04-02-2026 04:04:31 PM.webm](https://github.com/user-attachments/assets/5eafb606-08db-4359-b140-3a3f5d1e5f76)


## Installation en 1 parcours

```bash
git clone https://github.com/rom98759/42_angouleme_widget.git
cd 42_angouleme_widget/angouleme42@rcaillie
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
3. Ouvre `gnome-extensions-app` pour verifier l'etat

## Configuration unique et propre

Un seul fichier est a maintenir:

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

Champs obligatoires pour que l'extension fonctionne:

- `fortyTwoLogin`
- `client_id`
- `client_secret`
- `access_token`
- `refresh_token`

Permissions conseillees:

```bash
chmod 700 ~/.config/angouleme42-widget
chmod 600 ~/.config/angouleme42-widget/config.json
```

## Recuperer tokens OAuth (une seule fois)

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

## Verifier / depanner

Version gnome-shell:

```bash
gnome-shell --version
```

Ouvrir la GUI Extensions:

```bash
gnome-extensions-app
```

Verifier et recharger:

```bash
gnome-extensions info angouleme42@rcaillie
gnome-extensions disable angouleme42@rcaillie
gnome-extensions enable angouleme42@rcaillie
```

Tester l'API manuellement:

```bash
curl -H "Authorization: Bearer XXX" \
"https://api.intra.42.fr/v2/users/LOGIN_42/locations?sort=-begin_at&per_page=1"
```

## GitHub

- https://github.com/rom98759/42_angouleme_widget.git
