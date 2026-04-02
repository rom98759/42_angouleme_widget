#!/usr/bin/env bash
set -euo pipefail

UUID="angouleme42@rcaillie"
CONFIG_DIR="$HOME/.config/angouleme42-widget"
CONFIG_PATH="$CONFIG_DIR/config.json"
TARGET_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "$SCRIPT_DIR/metadata.json" || ! -f "$SCRIPT_DIR/extension.js" || ! -f "$SCRIPT_DIR/stylesheet.css" ]]; then
  echo "Erreur: lance ce script depuis le dossier de l'extension (metadata.json, extension.js, stylesheet.css)."
  exit 1
fi

if ! command -v gnome-extensions >/dev/null 2>&1; then
  echo "Erreur: gnome-extensions est introuvable. Installe GNOME Shell Extensions CLI."
  exit 1
fi

echo "[1/4] Installation extension -> $TARGET_DIR"
mkdir -p "$HOME/.local/share/gnome-shell/extensions"
rm -rf "$TARGET_DIR"
cp -r "$SCRIPT_DIR" "$TARGET_DIR"

echo "[2/4] Preparation configuration -> $CONFIG_PATH"
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

if [[ ! -f "$CONFIG_PATH" ]]; then
  cp "$SCRIPT_DIR/config.example.json" "$CONFIG_PATH"
  echo "Config creee depuis config.example.json"
else
  echo "Config deja presente, conservee"
fi
chmod 600 "$CONFIG_PATH"

echo "[3/4] Activation extension"
gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
gnome-extensions enable "$UUID"

echo "[4/4] Verification"
gnome-extensions info "$UUID" | sed -n '1,40p'

echo
echo "Installation terminee."
echo "Edite maintenant: $CONFIG_PATH"
echo "Puis relance le script si tu mets a jour les fichiers de l'extension."
echo "Puis ouvre l'app Extensions: gnome-extensions-app"
