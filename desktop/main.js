const { app, BrowserWindow, session, desktopCapturer, ipcMain, Menu } = require('electron');
const path = require('path');

// URL вашего задеплоенного сайта на Render — приложение просто открывает его
// в нативном окне, отдельный локальный сервер внутри Electron не нужен.
const APP_URL = 'https://mute-36sq.onrender.com';

let mainWindow = null;

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        show: false,
        autoHideMenuBar: true,
        title: 'Mute',
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    // Не даём странице переименовать окно (например, если сайт когда-нибудь
    // начнёт менять title под счётчик непрочитанных сообщений и т.п.)
    mainWindow.on('page-title-updated', (event) => {
        event.preventDefault();
    });

    Menu.setApplicationMenu(null);

    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.loadURL(APP_URL);

    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// ---------- Разрешения на микрофон/камеру ----------
// По умолчанию Electron блокирует запросы на медиа-доступ — их нужно явно разрешить,
// иначе getUserMedia() в script.js будет падать с ошибкой доступа.
function setupPermissions() {
    const allowed = ['media', 'mediaKeySystem', 'notifications', 'clipboard-read', 'clipboard-sanitized-write'];

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(allowed.includes(permission));
    });

    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        return allowed.includes(permission);
    });
}

// ---------- Демонстрация экрана ----------
// navigator.mediaDevices.getDisplayMedia() в Electron не работает "из коробки" как в Chrome —
// нужно вручную получить список источников (экраны/окна) и вернуть выбранный.
// Показываем пользователю простое окно выбора с превью.
function setupScreenShare() {
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        try {
            const sources = await desktopCapturer.getSources({
                types: ['screen', 'window'],
                thumbnailSize: { width: 300, height: 200 }
            });

            const selected = await openSourcePicker(sources);

            if (!selected) {
                callback({});
                return;
            }

            callback({
                video: selected,
                // Захват системного звука вместе с экраном — работает только на Windows.
                audio: process.platform === 'win32' ? 'loopback' : undefined
            });
        } catch (err) {
            console.error('[Демонстрация экрана] Ошибка:', err);
            callback({});
        }
    });
}

function openSourcePicker(sources) {
    return new Promise((resolve) => {
        const pickerWindow = new BrowserWindow({
            width: 720,
            height: 480,
            parent: mainWindow,
            modal: true,
            resizable: false,
            autoHideMenuBar: true,
            title: 'Выберите, что показать',
            webPreferences: {
                preload: path.join(__dirname, 'preload-picker.js'),
                contextIsolation: true,
                nodeIntegration: false
            }
        });

        pickerWindow.loadFile('picker.html');

        pickerWindow.webContents.once('did-finish-load', () => {
            const sourcesData = sources.map(s => ({
                id: s.id,
                name: s.name,
                thumbnail: s.thumbnail.toDataURL()
            }));
            pickerWindow.webContents.send('sources', sourcesData);
        });

        let settled = false;

        ipcMain.once('source-selected', (event, id) => {
            if (settled) return;
            settled = true;
            const selected = sources.find(s => s.id === id) || null;
            if (!pickerWindow.isDestroyed()) pickerWindow.close();
            resolve(selected);
        });

        pickerWindow.on('closed', () => {
            if (settled) return;
            settled = true;
            resolve(null);
        });
    });
}

app.whenReady().then(() => {
    setupPermissions();
    setupScreenShare();
    createMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
