const { St, Clutter, GLib, Gio } = imports.gi;
const ByteArray = imports.byteArray;
const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

let indicator;
let panelLabel;
let timer;
let menuRows = {};
let isApiRequestInFlight = false;
let apiBackoffUntilMs = 0;
let apiBackoffSeconds = 10;

const LINKS = [
    {
        label: 'Profile Intra',
        url: 'https://profile-v3.intra.42.fr/',
    },
    {
        label: 'Cluster Map',
        url: 'https://cluster-map.42angouleme.fr/',
    },
    {
        label: 'Rusty',
        url: 'https://rusty.42angouleme.fr/',
    },
    {
        label: 'Docs 42 Angouleme',
        url: 'https://docs.42angouleme.fr/',
    },
];

const EXTENSION_LABEL = '42 Angouleme Widget';
const CONFIG_DIR_NAME = 'angouleme42-widget';
const FORTY_TWO_REFRESH_INTERVAL = 5 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_SECONDS = 60;
const FORTY_TWO_TOKEN_ENDPOINT = 'https://api.intra.42.fr/oauth/token';
const API_BACKOFF_INITIAL_SECONDS = 10;
const API_BACKOFF_MAX_SECONDS = 5 * 60;
let fortyTwoCache = {
    beginAtMs: null,
    endAtMs: null,
    updatedAt: 0,
    dayKey: null,
};

function getLocalDayKey(timestampMs = Date.now()) {
    const date = new Date(timestampMs);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getStartOfLocalDayMs(timestampMs = Date.now()) {
    const date = new Date(timestampMs);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

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

function runCommandAsync(argv) {
    return new Promise((resolve) => {
        try {
            const process = Gio.Subprocess.new(
                argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            process.communicate_utf8_async(null, null, (proc, result) => {
                try {
                    const [, stdout, stderr] = proc.communicate_utf8_finish(result);
                    resolve({
                        success: proc.get_successful(),
                        status: proc.get_exit_status(),
                        stdout: (stdout || '').trim(),
                        stderr: (stderr || '').trim(),
                    });
                } catch (error) {
                    resolve({
                        success: false,
                        status: -1,
                        stdout: '',
                        stderr: error.message || String(error),
                    });
                }
            });
        } catch (error) {
            resolve({
                success: false,
                status: -1,
                stdout: '',
                stderr: error.message || String(error),
            });
        }
    });
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

function getConfigValue(config, key) {
    if (!config || !key)
        return null;

    return Object.prototype.hasOwnProperty.call(config, key) ? config[key] : null;
}

async function refreshTokenIfNeeded() {
    const config = loadConfig();
    const login = getConfigValue(config, 'fortyTwoLogin') || GLib.getenv('USER') || GLib.get_user_name();

    const currentToken = getConfigValue(config, 'access_token');
    const refreshToken = getConfigValue(config, 'refresh_token');
    const clientId = getConfigValue(config, 'client_id');
    const clientSecret = getConfigValue(config, 'client_secret');

    if (!refreshToken || !clientId || !clientSecret)
        return { token: currentToken, login };

    const now = Math.floor(Date.now() / 1000);
    const expiresAtValue = getConfigValue(config, 'expires_at');
    const createdAtValue = getConfigValue(config, 'created_at');
    const expiresInConfigValue = getConfigValue(config, 'expires_in');

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

    const result = await runCommandAsync([
        'curl',
        '-fsS',
        '--connect-timeout',
        '3',
        '--max-time',
        '8',
        '-X',
        'POST',
        FORTY_TWO_TOKEN_ENDPOINT,
        '-H',
        'Content-Type: application/x-www-form-urlencoded',
        '-d',
        'grant_type=refresh_token',
        '-d',
        `client_id=${clientId}`,
        '-d',
        `client_secret=${clientSecret}`,
        '-d',
        `refresh_token=${refreshToken}`,
    ]);

    if (!result.success || !result.stdout) {
        if (result.stderr)
            log(`${EXTENSION_LABEL}: token refresh failed (${result.status}) ${result.stderr}`);
        return { token: currentToken, login };
    }

    try {
        const data = JSON.parse(result.stdout);
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
    fortyTwoCache.updatedAt = 0;
    fortyTwoCache.dayKey = null;
}

function clearApiBackoff() {
    apiBackoffUntilMs = 0;
    apiBackoffSeconds = API_BACKOFF_INITIAL_SECONDS;
}

function registerApiFailure() {
    apiBackoffUntilMs = Date.now() + apiBackoffSeconds * 1000;
    apiBackoffSeconds = Math.min(apiBackoffSeconds * 2, API_BACKOFF_MAX_SECONDS);
}

function isInApiBackoffWindow() {
    return Date.now() < apiBackoffUntilMs;
}

function isFortyTwoCacheStale() {
    if (!fortyTwoCache.updatedAt)
        return true;

    if (fortyTwoCache.dayKey !== getLocalDayKey())
        return true;

    return Date.now() - fortyTwoCache.updatedAt > FORTY_TWO_REFRESH_INTERVAL;
}

async function updateFortyTwoCache() {
    const credentials = await refreshTokenIfNeeded();
    const token = credentials.token;
    const login = credentials.login;

    if (!token || !login) {
        clearFortyTwoCache();
        return false;
    }

    const url = `https://api.intra.42.fr/v2/users/${encodeURIComponent(login)}/locations?sort=-begin_at&per_page=1`;
    const result = await runCommandAsync([
        'curl',
        '-fsS',
        '--connect-timeout',
        '3',
        '--max-time',
        '5',
        '-H',
        `Authorization: Bearer ${token}`,
        url,
    ]);

    if (!result.success || !result.stdout) {
        if (result.stderr)
            log(`${EXTENSION_LABEL}: locations fetch failed (${result.status}) ${result.stderr}`);
        clearFortyTwoCache();
        return false;
    }

    try {
        const locations = JSON.parse(result.stdout);
        if (!locations || !locations.length) {
            clearFortyTwoCache();
            return false;
        }

        const location = locations[0];
        const beginAt = Date.parse(location.begin_at);
        const endAt = location.end_at ? Date.parse(location.end_at) : null;

        if (Number.isNaN(beginAt) || (endAt !== null && Number.isNaN(endAt))) {
            clearFortyTwoCache();
            return false;
        }

        fortyTwoCache.beginAtMs = beginAt;
        fortyTwoCache.endAtMs = endAt;
        fortyTwoCache.updatedAt = Date.now();
        fortyTwoCache.dayKey = getLocalDayKey(fortyTwoCache.updatedAt);
        return true;
    } catch (error) {
        clearFortyTwoCache();
        return false;
    }
}

function refreshDisplayFromCache() {
    const fortyTwoText = getFortyTwoText();
    panelLabel.set_text(fortyTwoText);
    refreshMenu();
}

async function refreshFortyTwoDataIfNeeded(force = false) {
    if (isApiRequestInFlight)
        return;

    if (!force && !isFortyTwoCacheStale())
        return;

    if (!force && isInApiBackoffWindow())
        return;

    isApiRequestInFlight = true;

    try {
        const success = await updateFortyTwoCache();
        if (success)
            clearApiBackoff();
        else
            registerApiFailure();
    } catch (error) {
        logError(error, `${EXTENSION_LABEL}: data refresh failed`);
        registerApiFailure();
    } finally {
        isApiRequestInFlight = false;
        if (indicator && panelLabel)
            refreshDisplayFromCache();
    }
}

function getFortyTwoText() {
    if (!fortyTwoCache.beginAtMs)
        return '42 N/A';

    const nowMs = Date.now();
    const dayStartMs = getStartOfLocalDayMs(nowMs);
    const endMs = fortyTwoCache.endAtMs === null ? nowMs : Math.min(fortyTwoCache.endAtMs, nowMs);

    if (endMs <= dayStartMs)
        return '42 N/A';

    const startMs = Math.max(fortyTwoCache.beginAtMs, dayStartMs);
    if (endMs <= startMs)
        return '42 N/A';

    return `42 ${formatDuration((endMs - startMs) / 1000)}`;
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

    const refreshItem = new PopupMenu.PopupMenuItem('⟳ Rafraîchir');
    refreshItem.connect('activate', () => {
        clearFortyTwoCache();
        clearApiBackoff();
        updateWidget();
        void refreshFortyTwoDataIfNeeded(true);
    });
    indicator.menu.addMenuItem(refreshItem);

    indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    for (const link of LINKS)
        addLinkItem(link.label, link.url);

    indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const githubItem = new PopupMenu.PopupMenuItem('GitHub');
    githubItem.connect('activate', () => openUrl('https://github.com/rom98759/42_angouleme_widget'));
    indicator.menu.addMenuItem(githubItem);
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

        refreshDisplayFromCache();
        void refreshFortyTwoDataIfNeeded(false);

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

    updateWidget();
    void refreshFortyTwoDataIfNeeded(true);

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
    isApiRequestInFlight = false;
    clearApiBackoff();
    clearFortyTwoCache();
}
