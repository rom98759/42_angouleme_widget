const { St, Clutter, GLib } = imports.gi;
const ByteArray = imports.byteArray;
const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

let indicator;
let panelLabel;
let timer;
let menuRows = {};

const LINKS = [
    {
        label: 'Cluster Map',
        url: 'https://cluster-map.42angouleme.fr/',
    },
    {
        label: 'Docs 42 Angouleme',
        url: 'https://docs.42angouleme.fr/',
    },
    {
        label: 'Rusty',
        url: 'https://rusty.42angouleme.fr/',
    },
    {
        label: 'Profile Intra',
        url: 'https://profile-v3.intra.42.fr/',
    },
];

const EXTENSION_LABEL = '42 Angouleme Widget';
const CONFIG_DIR_NAME = 'angouleme42-widget';
const FORTY_TWO_REFRESH_INTERVAL = 5 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_SECONDS = 60;
const FORTY_TWO_TOKEN_ENDPOINT = 'https://api.intra.42.fr/oauth/token';
let fortyTwoCache = {
    beginAtMs: null,
    endAtMs: null,
    updatedAt: 0,
};

function getPulse42ConfigPath() {
    return GLib.build_filenamev([
        GLib.get_home_dir(),
        '.config',
        CONFIG_DIR_NAME,
        'config.json',
    ]);
}

function getPulse42ConfigDir() {
    return GLib.build_filenamev([
        GLib.get_home_dir(),
        '.config',
        CONFIG_DIR_NAME,
    ]);
}

function getLegacyPulse42ConfigPath() {
    return GLib.build_filenamev([
        GLib.get_home_dir(),
        '.config',
        'pulse42',
        'config.json',
    ]);
}

function getLocalExtensionConfigPath() {
    try {
        const currentExtension = ExtensionUtils.getCurrentExtension();
        if (!currentExtension || !currentExtension.path)
            return null;

        return GLib.build_filenamev([currentExtension.path, 'config.json']);
    } catch (error) {
        return null;
    }
}

function runCommand(command) {
    try {
        let [ok, stdout] = GLib.spawn_command_line_sync(command);
        if (!ok || !stdout)
            return null;

        return ByteArray.toString(stdout).trim();
    } catch (error) {
        return null;
    }
}

function readJsonFile(pathParts) {
    try {
        const path = GLib.build_filenamev(pathParts);
        let [ok, contents] = GLib.file_get_contents(path);
        if (!ok || !contents)
            return null;

        return JSON.parse(ByteArray.toString(contents));
    } catch (error) {
        return null;
    }
}

function loadConfig() {
    const dedicatedConfig = readJsonFile([getPulse42ConfigPath()]);

    if (dedicatedConfig)
        return dedicatedConfig;

    const legacyPulse42Config = readJsonFile([getLegacyPulse42ConfigPath()]);

    if (legacyPulse42Config)
        return legacyPulse42Config;

    const localExtensionConfigPath = getLocalExtensionConfigPath();
    if (localExtensionConfigPath) {
        const localExtensionConfig = readJsonFile([localExtensionConfigPath]);
        if (localExtensionConfig)
            return localExtensionConfig;
    }

    const legacyConfig = readJsonFile([
        GLib.get_home_dir(),
        '.config',
        'mywidget',
        'config.json',
    ]);

    return legacyConfig || {};
}

function saveConfig(config) {
    try {
        GLib.mkdir_with_parents(getPulse42ConfigDir(), 0o700);
        const json = `${JSON.stringify(config, null, 2)}\n`;
        return GLib.file_set_contents(getPulse42ConfigPath(), json);
    } catch (error) {
        logError(error, `${EXTENSION_LABEL}: saveConfig failed`);
        return false;
    }
}

function getConfigValue(config, ...keys) {
    for (const key of keys) {
        if (config && config[key])
            return config[key];
    }

    return null;
}

function refreshTokenIfNeeded() {
    const config = loadConfig();
    const login = getConfigValue(config, 'fortyTwoLogin', 'login') || GLib.getenv('USER') || GLib.get_user_name();

    const currentToken = getConfigValue(config,
        'access_token',
        'fortyTwoToken',
        'accessToken',
        'token'
    );

    const refreshToken = getConfigValue(config, 'refresh_token', 'refreshToken');
    const clientId = getConfigValue(config, 'client_id', 'clientId');
    const clientSecret = getConfigValue(config, 'client_secret', 'clientSecret');

    if (!refreshToken || !clientId || !clientSecret)
        return { token: currentToken, login };

    const now = Math.floor(Date.now() / 1000);
    const expiresAtValue = getConfigValue(config, 'expires_at', 'expiresAt');
    const createdAtValue = getConfigValue(config, 'created_at', 'createdAt');
    const expiresInConfigValue = getConfigValue(config, 'expires_in', 'expiresIn');

    const explicitExpiresAt = Number.parseInt(String(expiresAtValue || ''), 10);
    const createdAt = Number.parseInt(String(createdAtValue || ''), 10);
    const expiresInConfig = Number.parseInt(String(expiresInConfigValue || ''), 10);

    let expiresAt = explicitExpiresAt;
    if (!Number.isFinite(expiresAt) && Number.isFinite(createdAt) && Number.isFinite(expiresInConfig) && expiresInConfig > 0) {
        expiresAt = createdAt + expiresInConfig;
        config.expires_at = expiresAt;
        saveConfig(config);
    }

    const hasValidExpiry = Number.isFinite(expiresAt);

    if (currentToken && hasValidExpiry && now < expiresAt - TOKEN_REFRESH_MARGIN_SECONDS)
        return { token: currentToken, login };

    const command = `bash -lc "curl -fsS --connect-timeout 3 --max-time 8 -X POST ${GLib.shell_quote(FORTY_TWO_TOKEN_ENDPOINT)} -H 'Content-Type: application/x-www-form-urlencoded' -d ${GLib.shell_quote('grant_type=refresh_token')} -d ${GLib.shell_quote(`client_id=${clientId}`)} -d ${GLib.shell_quote(`client_secret=${clientSecret}`)} -d ${GLib.shell_quote(`refresh_token=${refreshToken}`)}"`;
    const output = runCommand(command);

    if (!output)
        return { token: currentToken, login };

    try {
        const data = JSON.parse(output);
        if (!data || !data.access_token)
            return { token: currentToken, login };

        const expiresIn = Number.parseInt(String(data.expires_in || ''), 10);
        if (!Number.isFinite(expiresIn) || expiresIn <= 0)
            return { token: currentToken, login };

        const createdAtFromApi = Number.parseInt(String(data.created_at || ''), 10);
        const createdAtSafe = Number.isFinite(createdAtFromApi) ? createdAtFromApi : now;

        config.access_token = data.access_token;
        config.refresh_token = data.refresh_token || refreshToken;
        config.created_at = createdAtSafe;
        config.expires_in = expiresIn;
        config.expires_at = createdAtSafe + expiresIn;

        // Keep backward-compatible fields so older config consumers still work.
        config.fortyTwoToken = data.access_token;

        saveConfig(config);

        return { token: data.access_token, login };
    } catch (error) {
        return { token: currentToken, login };
    }
}

function formatDuration(seconds) {
    const totalMinutes = Math.max(0, Math.floor(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0)
        return `${hours}h${String(minutes).padStart(2, '0')}`;

    return `${minutes}m`;
}

function clearFortyTwoCache() {
    fortyTwoCache.beginAtMs = null;
    fortyTwoCache.endAtMs = null;
    fortyTwoCache.updatedAt = Date.now();
}

function updateFortyTwoCache() {
    const credentials = refreshTokenIfNeeded();
    const token = credentials.token;
    const login = credentials.login;

    if (!token || !login) {
        clearFortyTwoCache();
        return;
    }

    const url = `https://api.intra.42.fr/v2/users/${encodeURIComponent(login)}/locations?sort=-begin_at&per_page=1`;
    const command = `bash -lc "curl -fsS --connect-timeout 3 --max-time 5 -H ${GLib.shell_quote(`Authorization: Bearer ${token}`)} ${GLib.shell_quote(url)}"`;
    const output = runCommand(command);

    if (!output) {
        clearFortyTwoCache();
        return;
    }

    try {
        const locations = JSON.parse(output);
        if (!locations || !locations.length) {
            clearFortyTwoCache();
            return;
        }

        const location = locations[0];
        const beginAt = Date.parse(location.begin_at);
        const endAt = location.end_at ? Date.parse(location.end_at) : null;

        if (Number.isNaN(beginAt) || (endAt !== null && Number.isNaN(endAt))) {
            clearFortyTwoCache();
            return;
        }

        fortyTwoCache.beginAtMs = beginAt;
        fortyTwoCache.endAtMs = endAt;
        fortyTwoCache.updatedAt = Date.now();
    } catch (error) {
        clearFortyTwoCache();
    }
}

function getFortyTwoText() {
    if (!fortyTwoCache.beginAtMs)
        return '42 N/A';

    const endMs = fortyTwoCache.endAtMs === null ? Date.now() : fortyTwoCache.endAtMs;
    return `42 ${formatDuration((endMs - fortyTwoCache.beginAtMs) / 1000)}`;
}

function createDetailRow(title, value) {
    const item = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
    });

    const row = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'pulse42-menu-row',
    });

    const titleLabel = new St.Label({
        text: title,
        style_class: 'pulse42-menu-key',
    });

    const spacer = new St.Widget({
        x_expand: true,
    });

    const valueLabel = new St.Label({
        text: value,
        style_class: 'pulse42-menu-value',
    });

    row.add_child(titleLabel);
    row.add_child(spacer);
    row.add_child(valueLabel);
    item.add_child(row);

    return { item, valueLabel };
}

function openUrl(url) {
    try {
        GLib.spawn_command_line_async(`xdg-open ${GLib.shell_quote(url)}`);
    } catch (error) {
        logError(error, `Pulse 42: unable to open ${url}`);
    }
}

function addLinkItem(label, url) {
    const item = new PopupMenu.PopupMenuItem(label);
    item.connect('activate', () => openUrl(url));
    indicator.menu.addMenuItem(item);
}

function buildMenu() {
    indicator.menu.removeAll();
    menuRows = {};

    menuRows.duration = createDetailRow('Temps d\'école', '42 N/A');
    indicator.menu.addMenuItem(menuRows.duration.item);

    indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    for (const link of LINKS)
        addLinkItem(link.label, link.url);
}

function refreshMenu() {
    if (!menuRows.duration)
        return;

    menuRows.duration.valueLabel.set_text(getFortyTwoText());
}

function updateWidget() {
    try {
        if (!indicator)
            return false;

        if (!fortyTwoCache.updatedAt || Date.now() - fortyTwoCache.updatedAt > FORTY_TWO_REFRESH_INTERVAL)
            updateFortyTwoCache();

        const fortyTwoText = getFortyTwoText();
        panelLabel.set_text(fortyTwoText);
        refreshMenu();

        return true;
    } catch (error) {
        logError(error, `${EXTENSION_LABEL}: updateWidget failed`);
        if (panelLabel)
            panelLabel.set_text('42 N/A');
        return true;
    }
}

function init() { }

function enable() {
    indicator = new PanelMenu.Button(0.0, EXTENSION_LABEL);
    indicator.add_style_class_name('pulse42-indicator');

    const panelBox = new St.BoxLayout({
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'pulse42-panel-box',
    });

    panelLabel = new St.Label({
        text: 'Chargement...',
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'pulse42-panel-label',
    });

    panelBox.add_child(panelLabel);
    indicator.add_child(panelBox);

    try {
        buildMenu();
    } catch (error) {
        logError(error, `${EXTENSION_LABEL}: menu init failed`);
    }

    updateFortyTwoCache();
    updateWidget();

    Main.panel.addToStatusArea('angouleme42-indicator', indicator);
    timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, updateWidget);
}

function disable() {
    if (timer) {
        GLib.source_remove(timer);
        timer = null;
    }

    if (indicator) {
        indicator.destroy();
        indicator = null;
    }

    panelLabel = null;
    menuRows = {};
    clearFortyTwoCache();
}
