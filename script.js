const socket = io();

const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password-input');
const avatarInput = document.getElementById('avatar-input');
const avatarInputGroup = document.getElementById('avatar-input-group');
const registerBtn = document.getElementById('register-btn');
const authTabs = document.querySelectorAll('.auth-tab');
const authError = document.getElementById('auth-error');

const roomButtons = document.querySelectorAll('.room-btn');
const connectRoomBtn = document.getElementById('connect-room-btn');
const addServerBtn = document.getElementById('add-server-btn');
const customServersList = document.getElementById('custom-servers-list');

// ---------- Локальный список "моих" серверов (создал/вошёл по коду) ----------
// Сервера больше не рассылаются всем подряд — сервер отдаёт данные только по
// конкретным кодам. Какие именно коды нужно запрашивать, хранится в этом браузере.
const MY_CUSTOM_SERVERS_KEY = 'myCustomServerCodes';
function loadMyServerCodes() {
    try {
        const raw = JSON.parse(localStorage.getItem(MY_CUSTOM_SERVERS_KEY) || '[]');
        return Array.isArray(raw) ? raw.filter(c => typeof c === 'string') : [];
    } catch (e) { return []; }
}
function saveMyServerCodes(codes) {
    try { localStorage.setItem(MY_CUSTOM_SERVERS_KEY, JSON.stringify(codes)); } catch (e) { /* ignore */ }
}
function addMyServerCode(code) {
    if (!code) return;
    const codes = loadMyServerCodes();
    if (!codes.includes(code)) {
        codes.push(code);
        saveMyServerCodes(codes);
    }
}
function removeMyServerCode(code) {
    saveMyServerCodes(loadMyServerCodes().filter(c => c !== code));
}

// Запрашиваем данные только по серверам, которые мы уже создавали/к которым уже
// подключались — остальные для нас просто не существуют в списке.
socket.emit('get my custom rooms', { codes: loadMyServerCodes() });
function requestMyServers() {
    socket.emit('get my custom rooms', { codes: loadMyServerCodes() });
}
const serverAddModal = document.getElementById('server-add-modal');
const serverCreatedModal = document.getElementById('server-created-modal');
const createServerName = document.getElementById('create-server-name');
const createServerPassword = document.getElementById('create-server-password');
const createServerError = document.getElementById('create-server-error');
const joinServerCode = document.getElementById('join-server-code');
const joinServerPassword = document.getElementById('join-server-password');
const joinServerError = document.getElementById('join-server-error');
const createdServerName = document.getElementById('created-server-name');
const createdServerCode = document.getElementById('created-server-code');
let lastCreatedServer = null;

// ---------- Аватарка создаваемого сервера (ссылка или файл) ----------
const createServerAvatarPreview = document.getElementById('create-server-avatar-preview');
const createServerAvatarUrl = document.getElementById('create-server-avatar-url');
const createServerAvatarFile = document.getElementById('create-server-avatar-file');
let pendingCreateServerAvatarFile = null;

createServerAvatarUrl?.addEventListener('input', () => {
    pendingCreateServerAvatarFile = null; // ссылку ввели последней — она и победит
    const url = createServerAvatarUrl.value.trim();
    createServerAvatarPreview.src = url;
});

createServerAvatarFile?.addEventListener('change', () => {
    const file = createServerAvatarFile.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        alert('Можно загружать только изображения');
        createServerAvatarFile.value = '';
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        alert('Файл слишком большой (максимум 8 МБ)');
        createServerAvatarFile.value = '';
        return;
    }
    pendingCreateServerAvatarFile = file; // файл выбрали последним — он и победит
    const reader = new FileReader();
    reader.onload = () => { createServerAvatarPreview.src = reader.result; };
    reader.readAsDataURL(file);
});

async function resolveServerAvatarUpload(pendingFile, urlInputValue) {
    if (pendingFile) {
        const formData = new FormData();
        formData.append('image', pendingFile);
        const res = await fetch('/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка загрузки файла');
        return data.url;
    }
    return urlInputValue.trim();
}

// ---------- Окно сервера: просмотр (гость) / редактирование (владелец) ----------
const serverInfoModal = document.getElementById('server-info-modal');
const serverInfoTitle = document.getElementById('server-info-title');
const serverInfoOwnerView = document.getElementById('server-info-owner-view');
const serverInfoGuestView = document.getElementById('server-info-guest-view');
const serverInfoAvatarPreview = document.getElementById('server-info-avatar-preview');
const serverInfoAvatarUrl = document.getElementById('server-info-avatar-url');
const serverInfoAvatarFile = document.getElementById('server-info-avatar-file');
const serverInfoAvatarPreviewGuest = document.getElementById('server-info-avatar-preview-guest');
const serverInfoNameGuest = document.getElementById('server-info-name-guest');
const serverInfoName = document.getElementById('server-info-name');
const serverInfoPassword = document.getElementById('server-info-password');
const serverInfoRemovePasswordBtn = document.getElementById('server-info-remove-password');
const serverInfoCode = document.getElementById('server-info-code');
const serverInfoError = document.getElementById('server-info-error');
const serverInfoSaveBtn = document.getElementById('server-info-save');
const serverInfoDeleteBtn = document.getElementById('server-info-delete');
const serverInfoLeaveBtn = document.getElementById('server-info-leave');
const serverInfoTabs = document.getElementById('server-info-tabs');
const serverMembersListEl = document.getElementById('server-members-list');
const serverMembersEmpty = document.getElementById('server-members-empty');
const serverMembersError = document.getElementById('server-members-error');
let pendingServerInfoAvatarFile = null;
let currentServerInfo = null; // { code, name, avatar, isOwner, isAdmin, canModerate }
let currentServerInfoRemovePassword = false;

// ---------- Вкладки в окне сервера (Настройки / Участники) ----------
// Своя, отдельная от общих настроек (switchSettingsTab), область запроса —
// см. комментарий у settingsTabButtons.
const serverInfoTabButtons = document.querySelectorAll('#server-info-tabs .settings-tab');
const serverInfoTabPanels = document.querySelectorAll('#server-info-modal .settings-tab-panel');
function switchServerInfoTab(tabName) {
    serverInfoTabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.serverTab === tabName));
    serverInfoTabPanels.forEach(panel => panel.classList.toggle('active', panel.dataset.serverTabPanel === tabName));
    // Кнопка «Сохранить» нужна только владельцу и только на вкладке «Настройки»
    if (serverInfoSaveBtn) {
        serverInfoSaveBtn.style.display = (tabName === 'general' && currentServerInfo && currentServerInfo.isOwner) ? 'block' : 'none';
    }
}
serverInfoTabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        switchServerInfoTab(btn.dataset.serverTab);
        if (btn.dataset.serverTab === 'members' && currentServerInfo) {
            showServerError(serverMembersError, '');
            socket.emit('get server members', { code: currentServerInfo.code });
        }
    });
});

// ---------- Рендер списка участников сервера (кик/повышение) ----------
function renderServerMembers(members) {
    if (!serverMembersListEl) return;
    serverMembersListEl.innerHTML = '';

    if (!members || members.length === 0) {
        if (serverMembersEmpty) serverMembersEmpty.style.display = 'block';
        return;
    }
    if (serverMembersEmpty) serverMembersEmpty.style.display = 'none';

    const meLower = ((currentUser && currentUser.username) || '').toLowerCase();
    const iAmOwner = !!(currentServerInfo && currentServerInfo.isOwner);
    const iAmModerator = !!(currentServerInfo && (currentServerInfo.isOwner || currentServerInfo.isAdmin));

    members.forEach(m => {
        const isSelf = m.username.toLowerCase() === meLower;

        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:8px; background:var(--bg-input); border-radius:8px;';

        const avatarWrap = document.createElement('div');
        avatarWrap.style.cssText = 'position:relative; flex-shrink:0;';
        const avatar = document.createElement('img');
        avatar.src = m.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(m.username)}`;
        avatar.alt = '';
        avatar.style.cssText = 'width:34px; height:34px; border-radius:50%; object-fit:cover; display:block;';
        avatarWrap.appendChild(avatar);
        const statusDot = document.createElement('span');
        statusDot.title = m.online ? 'В сети' : 'Не в сети';
        statusDot.style.cssText = `position:absolute; right:-1px; bottom:-1px; width:10px; height:10px; border-radius:50%; border:2px solid var(--bg-input); background:${m.online ? '#3ba55d' : '#6b7280'};`;
        avatarWrap.appendChild(statusDot);
        row.appendChild(avatarWrap);

        const info = document.createElement('div');
        info.style.cssText = 'flex:1; min-width:0; display:flex; flex-direction:column;';
        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        nameEl.textContent = m.username + (isSelf ? ' (вы)' : '');
        info.appendChild(nameEl);
        const subParts = [];
        if (m.isOwner) subParts.push('Создатель');
        else if (m.isAdmin) subParts.push('Модератор');
        subParts.push(m.online ? 'в сети' : 'не в сети');
        const roleEl = document.createElement('div');
        roleEl.style.cssText = 'font-size:11px; color:var(--text-faint);';
        roleEl.textContent = subParts.join(' · ');
        info.appendChild(roleEl);
        row.appendChild(info);

        if (iAmModerator && !m.isOwner && !isSelf) {
            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex; gap:6px; flex-shrink:0;';

            if (!m.isAdmin) {
                const promoteBtn = document.createElement('button');
                promoteBtn.type = 'button';
                promoteBtn.className = 'btn-secondary';
                promoteBtn.style.cssText = 'font-size:11px; padding:5px 8px; white-space:nowrap;';
                promoteBtn.textContent = 'Повысить';
                promoteBtn.addEventListener('click', () => {
                    socket.emit('set server admin', { code: currentServerInfo.code, username: m.username, makeAdmin: true });
                });
                actions.appendChild(promoteBtn);
            } else if (iAmOwner) {
                const demoteBtn = document.createElement('button');
                demoteBtn.type = 'button';
                demoteBtn.className = 'btn-secondary';
                demoteBtn.style.cssText = 'font-size:11px; padding:5px 8px; white-space:nowrap;';
                demoteBtn.textContent = 'Разжаловать';
                demoteBtn.addEventListener('click', () => {
                    socket.emit('set server admin', { code: currentServerInfo.code, username: m.username, makeAdmin: false });
                });
                actions.appendChild(demoteBtn);
            }

            // Модератор не может выгнать другого модератора — только владелец.
            if (iAmOwner || !m.isAdmin) {
                const kickBtn = document.createElement('button');
                kickBtn.type = 'button';
                kickBtn.className = 'action-btn';
                kickBtn.style.cssText = 'font-size:11px; padding:5px 8px; background:#3a1f24; color:#ff8080; white-space:nowrap;';
                kickBtn.textContent = 'Выгнать';
                kickBtn.addEventListener('click', () => {
                    if (!confirm(`Исключить «${m.username}» с сервера?`)) return;
                    socket.emit('kick server member', { code: currentServerInfo.code, username: m.username });
                });
                actions.appendChild(kickBtn);
            }

            row.appendChild(actions);
        }

        serverMembersListEl.appendChild(row);
    });
}

// Небольшое всплывающее уведомление внизу экрана
function showToast(text, ms = 4500) {
    let box = document.getElementById('toast-container');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toast-container';
        document.body.appendChild(box);
    }
    const toast = document.createElement('div');
    toast.className = 'toast fade-in';
    toast.textContent = text;
    box.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('toast-hide');
        setTimeout(() => toast.remove(), 300);
    }, ms);
}

// Настройка «показывать всех участников сервера» (Кастомизация → Список участников), хранится на устройстве.
const SHOW_OFFCALL_KEY = 'mute_show_offcall_members';
let showOffCallMembers = false;
try { showOffCallMembers = localStorage.getItem(SHOW_OFFCALL_KEY) === '1'; } catch (e) { /* ignore */ }
let lastRenderedVoiceUsers = {};

// Кэш участников серверов для автодополнения @упоминаний в чате — обновляется
// при каждом приходе списка участников, независимо от того, открыта ли вкладка
// "Участники" в окне сервера (см. mentionMembersCache ниже).
socket.on('server members list', ({ code, members } = {}) => {
    if (code) mentionMembersCache[code] = members || [];

    // Обновился список участников (кто-то зашёл/вышел в сеть) — перерисовываем боковой список.
    if (showOffCallMembers && code && code === customCodeFromRoomName(selectedRoom)) {
        updateVoiceUsersList(lastRenderedVoiceUsers);
    }

    if (!currentServerInfo || currentServerInfo.code !== code) return;
    // Свои права берём из свежего списка — так, если нас повысили/разжаловали,
    // кнопки управления появляются или пропадают сразу, без переоткрытия окна.
    const meLower = ((currentUser && currentUser.username) || '').toLowerCase();
    const me = (members || []).find(m => m.username.toLowerCase() === meLower);
    if (me) {
        currentServerInfo.isOwner = !!me.isOwner;
        currentServerInfo.isAdmin = !!me.isAdmin;
        currentServerInfo.canModerate = !!(me.isOwner || me.isAdmin);
    }
    renderServerMembers(members || []);
});

// Нам выдали или сняли права модератора — узнаём сразу, на каком бы сервере ни находились.
socket.on('server role changed', ({ code, name, isAdmin } = {}) => {
    if (!code) return;
    showToast(isAdmin
        ? `Вас назначили модератором сервера «${name || code}»`
        : `С вас сняли права модератора сервера «${name || code}»`);
    if (currentServerInfo && currentServerInfo.code === code) {
        currentServerInfo.isAdmin = !!isAdmin;
        currentServerInfo.canModerate = !!(currentServerInfo.isOwner || isAdmin);
        socket.emit('get server members', { code });
    }
});

// Пришло, когда нас выгнал создатель или модератор сервера.
socket.on('kicked from server', ({ code, name } = {}) => {
    if (!code) return;
    const btn = customServersList.querySelector(`[data-room="custom:${code}"]`);
    if (btn) btn.remove();
    removeMyServerCode(code);
    if (currentServerInfo && currentServerInfo.code === code) {
        closeModal(serverInfoModal);
    }
    alert(`Вас исключили с сервера «${name || code}».`);
});

serverInfoAvatarUrl?.addEventListener('input', () => {
    pendingServerInfoAvatarFile = null;
    const url = serverInfoAvatarUrl.value.trim();
    serverInfoAvatarPreview.src = url;
});

serverInfoAvatarFile?.addEventListener('change', () => {
    const file = serverInfoAvatarFile.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        alert('Можно загружать только изображения');
        serverInfoAvatarFile.value = '';
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        alert('Файл слишком большой (максимум 8 МБ)');
        serverInfoAvatarFile.value = '';
        return;
    }
    pendingServerInfoAvatarFile = file;
    const reader = new FileReader();
    reader.onload = () => { serverInfoAvatarPreview.src = reader.result; };
    reader.readAsDataURL(file);
});

const muteBtn = document.getElementById('mute-btn');
const deafenBtn = document.getElementById('deafen-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const logoutConfirmModal = document.getElementById('logout-confirm-modal');
const logoutCancelBtn = document.getElementById('logout-cancel-btn');
const logoutConfirmBtn = document.getElementById('logout-confirm-btn');
const closeSettings = document.getElementById('close-settings');
const micSelect = document.getElementById('mic-select');
const micMeter = document.getElementById('mic-meter');
const micMonitorCheck = document.getElementById('mic-monitor-check');
const thresholdSlider = document.getElementById('threshold-slider');
const thresholdValueDisplay = document.getElementById('threshold-value');
const thresholdIndicator = document.getElementById('threshold-indicator');

const gateEnabledCheck = document.getElementById('gate-enabled-check');
const gateHangoverSlider = document.getElementById('gate-hangover-slider');
const gateHangoverValueDisplay = document.getElementById('gate-hangover-value');
const noiseCheck = document.getElementById('noise-suppression-check');
const echoCheck = document.getElementById('echo-cancellation-check');
const agcCheck = document.getElementById('agc-check');
const screenQualitySelect = document.getElementById('screen-quality-select');
const cameraQualitySelect = document.getElementById('camera-quality-select');
const micVolumeSlider = document.getElementById('mic-volume-slider');
const micVolumeValueDisplay = document.getElementById('mic-volume-value');

const messageSoundVolumeSlider = document.getElementById('message-sound-volume-slider');
const messageSoundVolumeValueDisplay = document.getElementById('message-sound-volume-value');
const messageSoundCurrentLabel = document.getElementById('message-sound-current-label');
const messageSoundTestBtn = document.getElementById('message-sound-test-btn');
const messageSoundFileInput = document.getElementById('message-sound-file-input');
const messageSoundResetBtn = document.getElementById('message-sound-reset-btn');
const joinSoundVolumeSlider = document.getElementById('join-sound-volume-slider');
const joinSoundVolumeValueDisplay = document.getElementById('join-sound-volume-value');
const joinSoundCurrentLabel = document.getElementById('join-sound-current-label');
const joinSoundTestBtn = document.getElementById('join-sound-test-btn');
const joinSoundFileInput = document.getElementById('join-sound-file-input');
const joinSoundResetBtn = document.getElementById('join-sound-reset-btn');
const leaveSoundVolumeSlider = document.getElementById('leave-sound-volume-slider');
const leaveSoundVolumeValueDisplay = document.getElementById('leave-sound-volume-value');
const leaveSoundCurrentLabel = document.getElementById('leave-sound-current-label');
const leaveSoundTestBtn = document.getElementById('leave-sound-test-btn');
const leaveSoundFileInput = document.getElementById('leave-sound-file-input');
const leaveSoundResetBtn = document.getElementById('leave-sound-reset-btn');
const muteSoundVolumeSlider = document.getElementById('mute-sound-volume-slider');
const muteSoundVolumeValueDisplay = document.getElementById('mute-sound-volume-value');
const muteSoundCurrentLabel = document.getElementById('mute-sound-current-label');
const muteSoundTestBtn = document.getElementById('mute-sound-test-btn');
const muteSoundFileInput = document.getElementById('mute-sound-file-input');
const muteSoundResetBtn = document.getElementById('mute-sound-reset-btn');
const deafenSoundVolumeSlider = document.getElementById('deafen-sound-volume-slider');
const deafenSoundVolumeValueDisplay = document.getElementById('deafen-sound-volume-value');
const deafenSoundCurrentLabel = document.getElementById('deafen-sound-current-label');
const deafenSoundTestBtn = document.getElementById('deafen-sound-test-btn');
const deafenSoundFileInput = document.getElementById('deafen-sound-file-input');
const deafenSoundResetBtn = document.getElementById('deafen-sound-reset-btn');
const screenshareSoundVolumeSlider = document.getElementById('screenshare-sound-volume-slider');
const screenshareSoundVolumeValueDisplay = document.getElementById('screenshare-sound-volume-value');
const screenshareSoundCurrentLabel = document.getElementById('screenshare-sound-current-label');
const screenshareSoundTestBtn = document.getElementById('screenshare-sound-test-btn');
const screenshareSoundFileInput = document.getElementById('screenshare-sound-file-input');
const screenshareSoundResetBtn = document.getElementById('screenshare-sound-reset-btn');
const mentionSoundVolumeSlider = document.getElementById('mention-sound-volume-slider');
const mentionSoundVolumeValueDisplay = document.getElementById('mention-sound-volume-value');
const mentionSoundCurrentLabel = document.getElementById('mention-sound-current-label');
const mentionSoundTestBtn = document.getElementById('mention-sound-test-btn');
const mentionSoundFileInput = document.getElementById('mention-sound-file-input');
const mentionSoundResetBtn = document.getElementById('mention-sound-reset-btn');

const profileAvatarPreview = document.getElementById('profile-avatar-preview');
const profileAvatarUrlInput = document.getElementById('profile-avatar-url');
const profileAvatarFileInput = document.getElementById('profile-avatar-file');
const profileUsernameInput = document.getElementById('profile-username');
const saveProfileBtn = document.getElementById('save-profile-btn');

const imageLightbox = document.getElementById('image-lightbox');
const lightboxImage = document.getElementById('lightbox-image');
const lightboxClose = document.getElementById('lightbox-close');

const roomTitle = document.getElementById('room-title');
const roomNameDisplay = document.getElementById('room-name-display');
const voiceUsersContainer = document.getElementById('voice-users-container');

const screenBtn = document.getElementById('screen-btn');
const streamSelectModal = document.getElementById('stream-select-modal');
const shareScreenChoice = document.getElementById('share-screen-choice');
const shareCamChoice = document.getElementById('share-cam-choice');
const closeStreamModal = document.getElementById('close-stream-modal');

const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const remoteVideos = document.getElementById('remote-videos');

// ---------- Упоминания (@ник) в чате ----------
// Кэш участников сервера по коду — берётся из событий 'server members list',
// которые сервер и так рассылает всем, у кого открыт чат этого сервера
// (см. scheduleBroadcastServerMembers на бэкенде), так что список для
// автодополнения обычно уже готов к моменту, когда человек набирает "@".
const mentionMembersCache = {};

// Комнаты пользовательских серверов на клиенте называются "custom:КОД" —
// список участников есть только у таких серверов (см. customCodeFromRoom в server.js).
function customCodeFromRoomName(room) {
    const r = String(room || '');
    return r.startsWith('custom:') ? r.slice('custom:'.length).trim().toUpperCase() : null;
}

function getMentionCandidates() {
    const code = customCodeFromRoomName(selectedRoom);
    if (!code) return [];
    return mentionMembersCache[code] || [];
}

// Состояние автодополнения объявлено здесь (а не ниже, рядом с остальной логикой
// подсказок) специально: setChatEnabled ниже вызывается сразу при загрузке страницы
// и обращается к mentionState через closeMentionAutocomplete — если объявить
// let-переменную позже по файлу, это обращение попадёт во временную мёртвую зону
// (TDZ) и бросит ReferenceError, из-за которого весь остальной скрипт (вход в
// аккаунт, голосовой чат и т.д.) просто не выполнится.
const mentionAutocompleteEl = document.getElementById('mention-autocomplete');
let mentionState = { active: false, startIndex: -1, query: '', items: [], activeIndex: 0 };

function closeMentionAutocomplete() {
    mentionState = { active: false, startIndex: -1, query: '', items: [], activeIndex: 0 };
    if (mentionAutocompleteEl) {
        mentionAutocompleteEl.style.display = 'none';
        mentionAutocompleteEl.innerHTML = '';
    }
}

// Чат теперь отдельный для каждой комнаты — пока комната не выбрана, писать некуда.
function setChatEnabled(enabled) {
    messageInput.disabled = !enabled;
    messageInput.placeholder = enabled ? 'Написать в чат...' : 'Выберите сервер слева, чтобы открыть чат';
    const attachBtnEl = document.getElementById('attach-image-btn');
    if (attachBtnEl) attachBtnEl.disabled = !enabled;
    closeMentionAutocomplete();
}
setChatEnabled(false);

let myPeer = null;
let myPeerId = null;
let currentUser = { username: '', avatar: '', room: null, token: null };
let pendingAvatarFile = null; // выбранный файл аватарки, ещё не загруженный на сервер

// ---------- Своя шапка окна десктоп-приложения (Tauri) ----------
// Страница открывается и в обычном браузере, и внутри Tauri (окно без системной рамки —
// decorations:false в tauri.conf.json), поэтому шапку показываем только когда точно
// понятно, что мы внутри Tauri (появляется window.__TAURI__, т.к. в конфиге включён
// withGlobalTauri). В браузере #app-titlebar остаётся скрытым через CSS.
(function initDesktopTitlebar() {
    if (!window.__TAURI__ || !window.__TAURI__.window) return; // обычный браузер — ничего не делаем
    document.documentElement.classList.add('tauri-app');

    const tauriWindow = window.__TAURI__.window.getCurrentWindow();
    const minimizeBtn = document.getElementById('titlebar-minimize');
    const maximizeBtn = document.getElementById('titlebar-maximize');
    const closeBtn = document.getElementById('titlebar-close');

    if (minimizeBtn) minimizeBtn.addEventListener('click', () => tauriWindow.minimize());
    if (closeBtn) closeBtn.addEventListener('click', () => tauriWindow.close());
    if (maximizeBtn) maximizeBtn.addEventListener('click', () => tauriWindow.toggleMaximize());

    // Двойной клик по шапке — тоже разворачивает/восстанавливает окно (привычное поведение).
    const titlebar = document.getElementById('app-titlebar');
    if (titlebar) {
        titlebar.addEventListener('dblclick', (e) => {
            if (e.target.closest('.titlebar-btn')) return;
            tauriWindow.toggleMaximize();
        });
    }
})();

// ---------- Кастомизация: цвет темы + чёрный/белый текст ----------
// Хранится в localStorage (моментально, работает без аккаунта) и, если пользователь
// вошёл в аккаунт, дублируется на сервере — чтобы тема была одинаковой на всех устройствах.
const THEME_STORAGE_KEY = 'voicechat_theme';
const DEFAULT_THEME = { accent: '#6366f1', textMode: 'light', bgColor: '#0f1117' }; // как в исходном :root
let currentTheme = { ...DEFAULT_THEME };
let themeSaveServerTimer = null;

function clamp255(n) { return Math.max(0, Math.min(255, n)); }

function hexToRgbParts(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const int = parseInt(m[1], 16);
    return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbPartsToHex({ r, g, b }) {
    const toHex = (n) => clamp255(Math.round(n)).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Принимает "#RRGGBB", "RRGGBB", "rgb(r,g,b)" или "r, g, b" — то, что реально вводят люди.
function parseColorInput(raw) {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value) return null;

    const hexParts = hexToRgbParts(value);
    if (hexParts) return rgbPartsToHex(hexParts);

    const rgbMatch = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(value)
        || /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/.exec(value);
    if (rgbMatch) {
        const [, r, g, b] = rgbMatch;
        if ([r, g, b].every(n => Number(n) <= 255)) {
            return rgbPartsToHex({ r: Number(r), g: Number(g), b: Number(b) });
        }
    }
    return null;
}

// percent > 0 — светлее, percent < 0 — темнее (как в редакторах тем).
function shadeHex(hex, percent) {
    const parts = hexToRgbParts(hex);
    if (!parts) return hex;
    const t = percent < 0 ? 0 : 255;
    const p = Math.abs(percent) / 100;
    return rgbPartsToHex({
        r: parts.r + (t - parts.r) * p,
        g: parts.g + (t - parts.g) * p,
        b: parts.b + (t - parts.b) * p
    });
}

function hexToRgbaString(hex, alpha) {
    const parts = hexToRgbParts(hex) || hexToRgbParts(DEFAULT_THEME.accent);
    return `rgba(${parts.r}, ${parts.g}, ${parts.b}, ${alpha})`;
}

function loadThemeFromStorage() {
    try {
        const raw = localStorage.getItem(THEME_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return {
            accent: parseColorInput(parsed.accent) || DEFAULT_THEME.accent,
            textMode: parsed.textMode === 'dark' ? 'dark' : 'light',
            bgColor: parseColorInput(parsed.bgColor) || DEFAULT_THEME.bgColor
        };
    } catch (e) { return null; }
}

function saveThemeToStorage(theme) {
    try { localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme)); } catch (e) { /* ignore */ }
}

// Красит всё приложение: --accent используется во всех кнопках, ссылках, акцентах,
// подсветке активных элементов и т.д. по всему index.html через CSS-переменные.
function applyTheme(theme) {
    currentTheme = { ...DEFAULT_THEME, ...theme };
    const root = document.documentElement.style;
    const accent = currentTheme.accent;
    root.setProperty('--accent', accent);
    root.setProperty('--accent-hover', shadeHex(accent, -15));
    root.setProperty('--accent-soft', hexToRgbaString(accent, 0.15));

    const isDark = currentTheme.textMode === 'dark';
    const textColor = isDark ? '#0f1117' : '#f3f4f6';
    root.setProperty('--text', textColor);
    root.setProperty('--text-muted', hexToRgbaString(isDark ? '#0f1117' : '#f3f4f6', 0.65));
    root.setProperty('--text-faint', hexToRgbaString(isDark ? '#0f1117' : '#f3f4f6', 0.45));

    // Цвет окна: сам фон — это выбранный цвет, а карточки/панели/поля — его оттенки
    // (немного светлее для поднятых панелей, немного темнее для полей ввода),
    // чтобы вся иерархия поверхностей приложения оставалась читаемой при любом цвете.
    const bg = currentTheme.bgColor;
    const bgParts = hexToRgbParts(bg) || hexToRgbParts(DEFAULT_THEME.bgColor);
    const isLightBg = (bgParts.r * 299 + bgParts.g * 587 + bgParts.b * 114) / 1000 > 128;
    const raisedShift = isLightBg ? -4 : 4;
    const cardShift = isLightBg ? -7 : 7;
    const inputShift = isLightBg ? 4 : -3;
    const borderShift = isLightBg ? -14 : 14;
    const borderSoftShift = isLightBg ? -9 : 8;
    root.setProperty('--bg-app', bg);
    root.setProperty('--bg-raised', shadeHex(bg, raisedShift));
    root.setProperty('--bg-card', shadeHex(bg, cardShift));
    root.setProperty('--bg-input', shadeHex(bg, inputShift));
    root.setProperty('--border', shadeHex(bg, borderShift));
    root.setProperty('--border-soft', shadeHex(bg, borderSoftShift));
    // Раньше эти оттенки (кнопки, аватарки-заглушки, боковая панель серверов) были
    // зашиты в CSS напрямую и не перекрашивались вместе с окном — теперь считаем их
    // тоже от выбранного цвета, поэтому перекрашивается действительно всё.
    root.setProperty('--bg-elevated', shadeHex(bg, isLightBg ? -10 : 13));
    root.setProperty('--bg-elevated-hover', shadeHex(bg, isLightBg ? -18 : 22));
    root.setProperty('--bg-sunken', shadeHex(bg, isLightBg ? 9 : -6));
    root.setProperty('--border-strong', shadeHex(bg, isLightBg ? -30 : 28));

    // Обновляем элементы настроек кастомизации, если панель уже отрисована.
    const picker = document.getElementById('theme-color-picker');
    const hexInput = document.getElementById('theme-color-hex');
    const textToggleBtn = document.getElementById('theme-text-toggle-btn');
    if (picker) picker.value = accent;
    if (hexInput) hexInput.value = accent;
    if (textToggleBtn) textToggleBtn.innerText = isDark ? 'Сделать текст белым' : 'Сделать текст чёрным';
    document.querySelectorAll('.theme-preset-btn').forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.color || '').toLowerCase() === accent.toLowerCase());
    });

    const bgPicker = document.getElementById('theme-bg-color-picker');
    const bgHexInput = document.getElementById('theme-bg-color-hex');
    if (bgPicker) bgPicker.value = bg;
    if (bgHexInput) bgHexInput.value = bg;
}

// Сохраняет локально всегда, и на сервере — если пользователь вошёл в аккаунт
// (с небольшим дебаунсом, чтобы не долбить сервер на каждое движение цветового пикера).
// Показывает, реально ли сохранилось на аккаунте — раньше ошибка сохранения на сервере
// "проглатывалась" молча (только console.warn), и было не видно, что цвет не привязался
// к аккаунту, пока не перезайдёшь с другого устройства.
function setThemeSyncStatus(text, isError) {
    const hint = document.getElementById('theme-sync-hint');
    if (!hint) return;
    hint.textContent = text;
    hint.style.color = isError ? 'var(--danger)' : 'var(--text-faint)';
}

const THEME_SYNC_DEFAULT_HINT = 'Цвет темы сохраняется на этом устройстве и синхронизируется между устройствами, если вы вошли в аккаунт.';

function persistTheme(theme, { syncServer = true } = {}) {
    saveThemeToStorage(theme);
    if (!syncServer || !currentUser.token) return;
    if (themeSaveServerTimer) clearTimeout(themeSaveServerTimer);
    setThemeSyncStatus('Сохранение на аккаунте…', false);
    themeSaveServerTimer = setTimeout(async () => {
        try {
            const res = await fetch('/auth/theme', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUser.token}`
                },
                body: JSON.stringify({ accent: theme.accent, textMode: theme.textMode, bgColor: theme.bgColor })
            });
            if (!res.ok) {
                let message = 'Не удалось сохранить тему на аккаунте';
                try {
                    const data = await res.json();
                    if (data && data.error) message = data.error;
                } catch (e) { /* тело ответа не JSON — оставляем сообщение по умолчанию */ }
                if (res.status === 401) message = 'Сессия истекла — войдите заново, чтобы тема сохранялась на аккаунте';
                console.warn('[Внимание] Сервер отклонил сохранение темы:', message);
                setThemeSyncStatus(message, true);
                return;
            }
            setThemeSyncStatus('Сохранено на аккаунте ✓', false);
            setTimeout(() => setThemeSyncStatus(THEME_SYNC_DEFAULT_HINT, false), 2500);
        } catch (e) {
            console.warn('[Внимание] Не удалось синхронизировать тему с сервером (нет сети?):', e);
            setThemeSyncStatus('Нет соединения с сервером — тема сохранена только на этом устройстве', true);
        }
    }, 400);
}

function setThemeAccent(hex) {
    persistTheme({ ...currentTheme, accent: hex });
    applyTheme({ ...currentTheme, accent: hex });
}

function setThemeTextMode(mode) {
    persistTheme({ ...currentTheme, textMode: mode });
    applyTheme({ ...currentTheme, textMode: mode });
}

function setThemeBg(hex) {
    persistTheme({ ...currentTheme, bgColor: hex });
    applyTheme({ ...currentTheme, bgColor: hex });
}

function resetTheme() {
    persistTheme({ ...DEFAULT_THEME });
    applyTheme({ ...DEFAULT_THEME });
}

// Подтягивает актуальную тему с сервера (например, при входе на новом устройстве) и
// перезаписывает локальную копию, если на сервере что-то сохранено.
async function syncThemeFromServer() {
    if (!currentUser.token) return;
    try {
        const res = await fetch('/auth/theme', {
            headers: { 'Authorization': `Bearer ${currentUser.token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.theme && (data.theme.accent || data.theme.textMode || data.theme.bgColor)) {
            const merged = {
                accent: parseColorInput(data.theme.accent) || currentTheme.accent,
                textMode: data.theme.textMode === 'dark' ? 'dark' : (data.theme.textMode === 'light' ? 'light' : currentTheme.textMode),
                bgColor: parseColorInput(data.theme.bgColor) || currentTheme.bgColor
            };
            saveThemeToStorage(merged);
            applyTheme(merged);
        }
    } catch (e) { /* нет сети — остаёмся с локальной темой */ }
}

// Применяем сохранённую тему сразу же, до входа в приложение, чтобы не было "мигания" стандартной темой.
applyTheme(loadThemeFromStorage() || DEFAULT_THEME);

const THEME_PRESETS = ['#6366f1', '#22c55e', '#ef4444', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6', '#f3f4f6'];
function renderThemePresets() {
    const container = document.getElementById('theme-presets');
    if (!container || container.childElementCount) return;
    THEME_PRESETS.forEach(color => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-preset-btn';
        btn.style.background = color;
        btn.dataset.color = color;
        btn.title = color;
        btn.addEventListener('click', () => setThemeAccent(color));
        container.appendChild(btn);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    renderThemePresets();
    applyTheme(currentTheme); // подсветить активный пресет/поля актуальным значением

    const picker = document.getElementById('theme-color-picker');
    const hexInput = document.getElementById('theme-color-hex');
    const errorEl = document.getElementById('theme-color-error');
    const resetBtn = document.getElementById('theme-reset-btn');
    const textToggleBtn = document.getElementById('theme-text-toggle-btn');

    if (picker) {
        picker.addEventListener('input', () => {
            if (errorEl) errorEl.style.display = 'none';
            setThemeAccent(picker.value);
        });
    }
    if (hexInput) {
        const tryApplyHex = () => {
            const parsed = parseColorInput(hexInput.value);
            if (!parsed) {
                if (errorEl) {
                    errorEl.textContent = 'Введите цвет в формате #RRGGBB или rgb(r, g, b)';
                    errorEl.style.display = 'block';
                }
                return;
            }
            if (errorEl) errorEl.style.display = 'none';
            setThemeAccent(parsed);
        };
        hexInput.addEventListener('change', tryApplyHex);
        hexInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryApplyHex(); });
    }
    if (resetBtn) resetBtn.addEventListener('click', resetTheme);
    if (textToggleBtn) {
        textToggleBtn.addEventListener('click', () => {
            setThemeTextMode(currentTheme.textMode === 'dark' ? 'light' : 'dark');
        });
    }

    const bgPicker = document.getElementById('theme-bg-color-picker');
    const bgHexInput = document.getElementById('theme-bg-color-hex');
    const bgErrorEl = document.getElementById('theme-bg-color-error');
    const bgResetBtn = document.getElementById('theme-bg-reset-btn');

    if (bgPicker) {
        bgPicker.addEventListener('input', () => {
            if (bgErrorEl) bgErrorEl.style.display = 'none';
            setThemeBg(bgPicker.value);
        });
    }
    if (bgHexInput) {
        const tryApplyBgHex = () => {
            const parsed = parseColorInput(bgHexInput.value);
            if (!parsed) {
                if (bgErrorEl) {
                    bgErrorEl.textContent = 'Введите цвет в формате #RRGGBB или rgb(r, g, b)';
                    bgErrorEl.style.display = 'block';
                }
                return;
            }
            if (bgErrorEl) bgErrorEl.style.display = 'none';
            setThemeBg(parsed);
        };
        bgHexInput.addEventListener('change', tryApplyBgHex);
        bgHexInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryApplyBgHex(); });
    }
    if (bgResetBtn) bgResetBtn.addEventListener('click', () => setThemeBg(DEFAULT_THEME.bgColor));
});
let selectedRoom = null; 

let localMediaStream = null; 
let rawAudioStream = null;
let isMuted = false;
let isDeafened = false;
let activeCalls = {};
let connectedUsers = {}; 
let remoteAnalysers = {}; 
let remoteGainNodes = {}; 
// Громкость звука демонстрации по каждому собеседнику (в процентах, 0-150).
// Персистится в localStorage, чтобы настройка не сбрасывалась между заходами.
let demoVolumes = {};
try {
    const savedDemoVolumes = JSON.parse(localStorage.getItem('demoVolumes') || '{}');
    if (savedDemoVolumes && typeof savedDemoVolumes === 'object') demoVolumes = savedDemoVolumes;
} catch (e) { /* ignore */ }
let demoVolumesSaveTimer = null;
function saveDemoVolumes() {
    if (demoVolumesSaveTimer) clearTimeout(demoVolumesSaveTimer);
    demoVolumesSaveTimer = setTimeout(() => {
        demoVolumesSaveTimer = null;
        try { localStorage.setItem('demoVolumes', JSON.stringify(demoVolumes)); } catch (e) { /* ignore */ }
    }, 250);
}

let audioContext = null;
let analyserNode = null;
let gateThreshold = -45;
let micMonitorGain = null;
let micMonitorEnabled = false;

// ---------- Граф обработки своего микрофона ----------
// sourceNode — узел на "сырой" (необработанный) поток с микрофона. От него отдельно
// отходит analyserNode (для индикатора уровня и Voice Gate), поэтому анализ громкости
// продолжает работать ВСЕГДА, даже когда сам микрофон выключен Voice Gate'ом/мьютом —
// раньше анализатор слушал тот же трек, который выключался гейтом, из-за чего после
// падения громкости в тишину уровень намертво зависал на нуле и гейт больше никогда
// не открывался сам собой.
// Дальше сырой сигнал идёт через свой gain-узел громкости микрофона (micGainNode)
// в MediaStreamDestination — и уже этот, обработанный, трек (processedTrack)
// реально уходит собеседникам и включается/выключается Voice Gate'ом и кнопкой
// "Микрофон".
let sourceNode = null;
let micGainNode = null;
let destinationNode = null;
let processedTrack = null;
let micVolume = 1; // 0..2 (0%..200%), усиление своего микрофона перед отправкой

// ---------- Пункт оптимизации №5: RMS-метр громкости через AudioWorklet ----------
// Раньше уровень/RMS считался опросом AnalyserNode из setInterval в ГЛАВНОМ потоке —
// это обычный JS-код, который конкурирует за время с рендерингом интерфейса и вообще
// со всем остальным JS в вкладке. AudioWorkletProcessor считает RMS прямо в отдельном,
// приоритетном аудио-потоке (вне главного потока), и просто шлёт уже готовое число (дБ)
// через MessagePort примерно раз в 50мс — на главном потоке остаётся только обработать
// готовое значение, а не крутить сам цикл опроса и не трогать WebAudio API из JS-тика.
// Если AudioWorklet почему-то недоступен (старый браузер, небезопасный контекст без
// HTTPS и т.п.) — откатываемся на прежний способ через AnalyserNode + setInterval,
// чтобы Voice Gate и индикаторы "говорит" не переставали работать вообще.
const RMS_METER_PROCESSOR_NAME = 'mute-rms-meter';
const RMS_METER_PROCESSOR_CODE = `
class MuteRmsMeterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._sumSquares = 0;
        this._count = 0;
        // ~50мс на один отчёт, независимо от sampleRate конкретного устройства.
        this._samplesPerReport = Math.max(1, Math.round(sampleRate * 0.05));
    }
    process(inputs) {
        const input = inputs[0];
        if (input && input.length > 0) {
            const channel = input[0];
            for (let i = 0; i < channel.length; i++) {
                const s = channel[i];
                this._sumSquares += s * s;
                this._count++;
            }
            if (this._count >= this._samplesPerReport) {
                const rms = Math.sqrt(this._sumSquares / this._count);
                const db = rms > 0 ? 20 * Math.log10(rms) : -100;
                this.port.postMessage(db);
                this._sumSquares = 0;
                this._count = 0;
            }
        }
        // true — не даём браузеру решить, что процессор больше не нужен, даже если
        // на входе временная тишина.
        return true;
    }
}
registerProcessor('${RMS_METER_PROCESSOR_NAME}', MuteRmsMeterProcessor);
`;
let rmsWorkletModulePromise = null;
function ensureRmsWorkletModule(ctx) {
    if (!rmsWorkletModulePromise) {
        const blob = new Blob([RMS_METER_PROCESSOR_CODE], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        rmsWorkletModulePromise = ctx.audioWorklet.addModule(blobUrl)
            .catch(err => {
                // Не застреваем навсегда с отклонённым промисом — даём шанс попробовать
                // ещё раз при следующем вызове (например, после смены/пересоздания контекста).
                rmsWorkletModulePromise = null;
                throw err;
            });
    }
    return rmsWorkletModulePromise;
}
// Создаёт узел-метр громкости: AudioWorkletNode, если доступен, иначе — AnalyserNode
// как раньше. Помечаем узел флагом __isWorklet, чтобы код выше по стеку знал, как
// именно с ним работать (событие port.onmessage vs опрос по таймеру).
async function createLevelMeterNode(ctx) {
    if (ctx.audioWorklet) {
        try {
            await ensureRmsWorkletModule(ctx);
            const node = new AudioWorkletNode(ctx, RMS_METER_PROCESSOR_NAME);
            node.__isWorklet = true;
            return node;
        } catch (e) {
            console.warn('[AudioWorklet] Не удалось создать метр громкости, откатываемся на AnalyserNode:', e);
        }
    }
    const node = ctx.createAnalyser();
    // 256 вместо 1024 — для RMS-гейта частотное разрешение не нужно, а точности по
    // времени с запасом хватает; буфер и вычисления в 4 раза легче (см. фолбэк-цикл).
    node.fftSize = 256;
    node.smoothingTimeConstant = 0.2;
    node.__isWorklet = false;
    return node;
}

// ---------- Voice Gate: реально отключает передачу микрофона при тишине/фоновом шуме ----------
// Лёгкая реализация на AnalyserNode (без тяжёлых ML-моделей шумоподавления):
// - openThreshold — громкость, выше которой канал точно открыт;
// - closeThreshold — чуть ниже (гистерезис), чтобы гейт не "дребезжал" на границе порога;
// - hangover — короткая задержка перед закрытием, чтобы не обрезать хвосты слов.
let gateEnabled = true;
let gateOpen = true;
let gateCloseTimer = null;
const GATE_HYSTERESIS_DB = 4;
// Раньше было жёстко зашито 300 мс — теперь регулируется ползунком в настройках
// (задержка перед тем, как гейт снова закроется/перестанет передавать после того,
// как вы замолчали; ползунок называется в интерфейсе "Задержка закрытия гейта").
let gateHangoverMs = 300;

// ---------- Настройки звука: сохранение между заходами ----------
const AUDIO_SETTINGS_KEY = 'mute:audioSettings';
function loadAudioSettings() {
    try {
        const raw = localStorage.getItem(AUDIO_SETTINGS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}
function saveAudioSettings(patch) {
    try {
        const merged = Object.assign(loadAudioSettings(), patch);
        localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(merged));
    } catch (e) { /* ignore */ }
}

// ---------- Настройки видео: качество демонстрации экрана и камеры ----------
// По умолчанию 720p/30fps — компромисс между качеством картинки и нагрузкой на CPU при
// кодировании видео. Более высокие пресеты (вплоть до 1080p/60fps) доступны в настройках,
// но выбираются осознанно, а не включены по умолчанию, чтобы не грузить процессор всем
// без разбора.
const VIDEO_QUALITY_PRESETS = {
    '720p30': { width: 1280, height: 720, frameRate: 30 },
    '720p60': { width: 1280, height: 720, frameRate: 60 },
    '1080p30': { width: 1920, height: 1080, frameRate: 30 },
    '1080p60': { width: 1920, height: 1080, frameRate: 60 }
};
const VIDEO_SETTINGS_KEY = 'mute:videoSettings';
function loadVideoSettings() {
    try {
        const raw = localStorage.getItem(VIDEO_SETTINGS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}
function saveVideoSettings(patch) {
    try {
        const merged = Object.assign(loadVideoSettings(), patch);
        localStorage.setItem(VIDEO_SETTINGS_KEY, JSON.stringify(merged));
    } catch (e) { /* ignore */ }
}
function getScreenQualityPreset() {
    const saved = loadVideoSettings().screenQuality;
    return VIDEO_QUALITY_PRESETS[saved] || VIDEO_QUALITY_PRESETS['720p30'];
}
function getCameraQualityPreset() {
    const saved = loadVideoSettings().cameraQuality;
    return VIDEO_QUALITY_PRESETS[saved] || VIDEO_QUALITY_PRESETS['720p30'];
}
(function applySavedVideoSettings() {
    const saved = loadVideoSettings();
    if (screenQualitySelect) screenQualitySelect.value = saved.screenQuality || '720p30';
    if (cameraQualitySelect) cameraQualitySelect.value = saved.cameraQuality || '720p30';
})();
if (screenQualitySelect) {
    screenQualitySelect.addEventListener('change', () => {
        saveVideoSettings({ screenQuality: screenQualitySelect.value });
    });
}
if (cameraQualitySelect) {
    cameraQualitySelect.addEventListener('change', () => {
        saveVideoSettings({ cameraQuality: cameraQualitySelect.value });
    });
}

// ---------- Локальная громкость каждого собеседника (только у себя) ----------
// Хранится по нику, а не по peerId — peerId у человека новый при каждом заходе,
// а ник стабилен, поэтому громкость, выставленная один раз, не сбрасывается.
const REMOTE_VOLUME_STORAGE_KEY = 'mute:remoteVolumes';
let remoteVoiceGainNodes = {};
let remoteAudioSources = {};
let remoteDemoAudioSources = {};
function loadRemoteVolumes() {
    try {
        const raw = localStorage.getItem(REMOTE_VOLUME_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}
function getRemoteVolumePercent(username) {
    const all = loadRemoteVolumes();
    const key = username || '';
    return (key in all) ? all[key] : 100;
}
let remoteVolumeSaveTimer = null;
function saveRemoteVolume(username, percent) {
    try {
        const all = loadRemoteVolumes();
        all[username || ''] = percent;
        if (remoteVolumeSaveTimer) clearTimeout(remoteVolumeSaveTimer);
        remoteVolumeSaveTimer = setTimeout(() => {
            remoteVolumeSaveTimer = null;
            try { localStorage.setItem(REMOTE_VOLUME_STORAGE_KEY, JSON.stringify(all)); } catch (e) {}
        }, 250);
    } catch (e) { /* ignore */ }
}

(function applySavedAudioSettings() {
    const saved = loadAudioSettings();
    if (typeof saved.gateThreshold === 'number') gateThreshold = saved.gateThreshold;
    if (typeof saved.gateEnabled === 'boolean') gateEnabled = saved.gateEnabled;
    if (typeof saved.gateHangoverMs === 'number') gateHangoverMs = saved.gateHangoverMs;
    if (typeof saved.micVolume === 'number') micVolume = saved.micVolume;
    if (typeof saved.noiseSuppression === 'boolean' && noiseCheck) noiseCheck.checked = saved.noiseSuppression;
    if (typeof saved.echoCancellation === 'boolean' && echoCheck) echoCheck.checked = saved.echoCancellation;
    if (typeof saved.agc === 'boolean' && agcCheck) agcCheck.checked = saved.agc;
    if (gateEnabledCheck) gateEnabledCheck.checked = gateEnabled;
    if (gateHangoverSlider) gateHangoverSlider.value = gateHangoverMs;
    if (gateHangoverValueDisplay) gateHangoverValueDisplay.innerText = `${gateHangoverMs} мс`;
    if (thresholdSlider) thresholdSlider.value = gateThreshold;
    if (thresholdValueDisplay) thresholdValueDisplay.innerText = `${gateThreshold} дБ`;
    if (thresholdIndicator) thresholdIndicator.style.left = `${((gateThreshold + 70) / 60) * 100}%`;
    if (micVolumeSlider) micVolumeSlider.value = Math.round(micVolume * 100);
    if (micVolumeValueDisplay) micVolumeValueDisplay.innerText = `${Math.round(micVolume * 100)}%`;
    updateGateControlsDisabled();
})();

// Порог и задержка гейта имеют смысл только когда сам гейт включён — при
// выключенном чекбоксе визуально гасим эти два контрола (см. .control-group-disabled)
// и выставляем им disabled, а не просто прячем, чтобы было видно, что они есть,
// но сейчас не участвуют в работе.
function updateGateControlsDisabled() {
    const disabled = gateEnabledCheck ? !gateEnabledCheck.checked : false;
    if (thresholdSlider) thresholdSlider.disabled = disabled;
    if (gateHangoverSlider) gateHangoverSlider.disabled = disabled;
    const thresholdGroup = document.getElementById('gate-threshold-group');
    const hangoverGroup = document.getElementById('gate-hangover-group');
    if (thresholdGroup) thresholdGroup.classList.toggle('control-group-disabled', disabled);
    if (hangoverGroup) hangoverGroup.classList.toggle('control-group-disabled', disabled);
}

// ---------- Звуковые уведомления (сообщение / вход / выход из комнаты) ----------
// Все три звука сделаны из одного и того же исходного колокольчика (mp3, который
// прислал пользователь): звук нарезан, обрезана тишина, и для входа/выхода собраны
// две разные короткие мелодии из двух нот на разной высоте — вход звучит выше и
// "восходяще", выход — ниже и "нисходяще", чтобы их легко было отличить на слух.
// Звуки встроены прямо в код как base64 (data URI), поэтому работают без отдельных
// файлов и без обращения к серверу.

const NOTIFY_SOUNDS = {
    message: 'data:audio/mpeg;base64,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FgF5ysXwRE46eW0edePbHUqZtjTJNP1rCqglQPMF0ukyRgHVQNg4W5A+5ipLU1RsxsZJoL3ZDp2Z129+qxDkDZ6aO6+xNOXDo+BkyYG6GPAawB7Q3x9DGDaOG2ncpGNmJp2ZRsyS0Uiyp2NUTIh54mS7ZZVc8TDrp9YpXZGq392NJ2KoWMpqT1WMwYoNGTBI0MYDcwwOjYMSOBpww2AxGEC16BJXwXARgkAOPJgICFIKm0UKJDAICJabhgJyo6GqUrIbXf5fKAiWoccMwAoFpnf0Oc6prdTnWh2hppppCSt1b6nHfU31NoPkU1RAgKhSkQ+b5rUOc002rKa3RzXZNR6CuVGDjxWViL6j1XyqTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//uSxLsCGTWVCM6yc0IsMSCJwSowqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgoAABQhAGSgJlqGKLp2EAYNSMeAEMiNgRymMwaJIkYTFIGl4S+yL6Nig61GbvJG5uYr2BQCGBon8spF/yy2WWWVZY5fbDJllQjJllluTKGBggYMEDR0stlQ///9P/1RURUOzlRfYxRIaNGCZDs5f9URUUjt/+qOxioqoqKiodUymKMGqimKJCIwaNGDUGiQ0KCwsYNEDoNGDREYNQtEH0xBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7ksSIg9PeAJqsjLWIAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=',
    join: 'data:audio/mpeg;base64,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',
    leave: 'data:audio/mpeg;base64,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61eeLR0vDUFTKqI0iFPkyXkmUt0KkWo0FLdabukix6p0mZFddlqNByRbNcoumbGfS1nrl8cCoAKxFwlb38MHgzMLhHMR5MM4wIEI8G3qpmNg4GKoGmFAKw0YHBSDRVNPBXMSgJRutMWaVmGWlFRD6RKqMGAsuvaCS1PaRoIpoZdJqvGibFkOyUq8tFj7QoZIZpGbrAXgFOHJMlLSeg5kswU77IIvQRe60XWmhQqQUvRPO8hhETiD1qqWpS6SBPG45xFRZRwdQnImSkOSVmRME0UbunqPoPTLy1XUy02m7JpNU6CnSRstSVVBa92UtO6tqaC0UvrRSNJF5MEIXQbVai1BSpmdKzlrUhUhA4rGYTEYjLRkUrHCX4YjC5gEGIHioEVMShowKHwcFHhVyJJzFdYYtZr6z0nVCqyno9NT+WkarVDzFzv1kjP2q13CeS/t//uSxOkDFqGXCk6mM0MtPWCB1MppTcCPCbmaeuZsPW0/Riml7S1pmmIepjhR11jThf3+TjXKyqeHn/eqV+PUasqq6avU0p94BNkAmOPGgqPNme27L/HOmtm/PeCcfWAj3Yp9RJPHs533flRWb97xefv47+W+Zr1lN2pq1vOI48KTymzYjVZTtAYZkAahGa7OZDQC/R7NYgiCW4xAwEiZLwzACqzWHEYC/4Yi7XXEIpUNXUiEyFTBNvVcinKVxisTKoZFTPWDQyJSwpLPySrMEST0KRpWMSzJEjMioZPImqatlZslSRMljSrOVLZSuMYIk8q45UpxjaFImTJYImliZMl9Ik2Y1pCoTKsylaE4JhCYJtlLxikiTQzQweyinGNxrcIlxTipKWDR0MqCpdrxxEmyiT2NSjnlOXjFbY+M0OInoY0ixaVsynkq2tjkpSqXuOLNFWrVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7ksTvAxel+v4uPNHLUMHcgaylkFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=',
    mute: 'data:audio/wav;base64,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2QDbANwA3ADdAN0A3QDcANwA2wDZANgA1gDTANEAzgDLAMcAxADAALwAtwCyAK4AqACjAJ0AlwCRAIsAhQB+AHgAcQBqAGIAWwBUAEwARQA9ADUALQAlAB4AFgAOAAYA///3/+//5//f/9j/0P/I/8H/uf+y/6v/pP+d/5b/kP+J/4P/ff93/3L/bP9n/2L/Xf9Z/1T/UP9M/0n/Rv9D/0D/Pf87/zn/N/82/zX/NP80/zP/M/80/zT/Nf82/zj/Of87/z3/QP9D/0b/Sf9M/1D/VP9Y/13/Yf9m/2v/cP92/3v/gf+H/43/k/+a/6D/p/+t/7T/u//C/8n/0P/X/9//5v/t//T//P8CAAkAEAAYAB8AJgAtADQAOwBBAEgATwBVAFsAYgBoAG4AcwB5AH4AgwCIAI0AkgCWAJoAngCiAKYAqQCsAK8AsQC0ALYAuAC5ALsAvAC8AL0AvQC9AL0AvQC8ALsAugC5ALcAtQCzALAArgCrAKgApAChAJ0AmQCVAJEAjACIAIMAfgB4AHMAbgBoAGIAXABWAFAASgBEAD4ANwAxACoAJAAdABYAEAAJAAIA/f/2/+//6f/i/9z/1f/P/8n/w/+9/7f/sf+r/6X/oP+a/5X/kP+L/4b/gv99/3n/df9x/27/av9n/2T/Yf9f/1z/Wv9Y/1b/Vf9U/1P/Uv9R/1H/Uf9R/1H/Uv9T/1T/Vf9W/1j/Wv9c/1//Yf9k/2f/av9t/3H/df95/33/gf+F/4r/jv+T/5j/nf+i/6j/rf+z/7j/vv/E/8r/0P/V/9v/4f/o/+7/9P/6/wAABQALABEAFwAdACMAKQAvADQAOgA/AEUASgBQAFUAWgBfAGMAaABsAHEAdQB5AH0AgACEAIcAigCNAJAAkwCVAJcAmQCbAJ0AngCfAKAAoQChAKIAogCiAKEAoQCgAJ8AngCdAJsAmgCYAJYAkwCRAI4AiwCIAIUAggB+AHsAdwBzAG8AawBmAGIAXQBYAFQATwBKAEUAQAA6ADUAMAAqACUAHwAaABQADwAJAAQA///5//T/7v/p/+P/3v/Z/9P/zv/J/8T/v/+6/7b/sf+s/6j/pP+f/5v/l/+U/5D/jP+J/4b/g/+A/33/e/95/3b/dP9z/3H/b/9u/23/bP9s/2v/a/9r/2v/a/9r/2z/bf9u/2//cP9y/3T/df94/3r/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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    deafen: 'data:audio/wav;base64,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Y/9k/2T/ZP9k/2X/Zf9l/2X/Zf9m/2b/Zv9m/2f/Z/9n/2f/aP9o/2j/aP9p/2n/af9p/2n/av9q/2r/av9r/2v/a/9r/2v/bP9s/2z/bP9t/23/bf9t/23/bv9u/27/bv+RAJEAkQCRAJEAkACQAJAAkACPAI8AjwCPAI8AjgCOAI4AjgCNAI0AjQCNAI0AjACMAIwAjACMAIsAiwCLAIsAiwCKAIoAigCKAIkAiQCJAIkAiQCIAIgAiACIAIgAhwCHAHn/ef95/3r/ev96/3r/ev97/3v/e/97/3v/fP98/3z/fP98/33/ff99/33/ff9+/37/fv9+/37/f/9//3//f/9//4D/gP+A/4D/gP+B/4H/gf+B/4H/gv+C/4L/gv+C/34AfQB9AH0AfQB9AHwAfAB8AHwAfAB7AHsAewB7AHsAewB6AHoAegB6AHoAeQB5AHkAeQB5AHgAeAB4AHgAeAB4AHcAdwB3AHcAdwB2AHYAdgB2AHYAdgB1AHUAdQB1AHUAdQCM/4z/jP+M/4z/jf+N/43/jf+N/43/jv+O/47/jv+O/47/j/+P/4//j/+P/4//kP+Q/5D/kP+Q/5H/kf+R/5H/kf+R/5L/kv+S/5L/kv+S/5P/k/+T/5P/k/+T/5T/lP+U/2wAbABsAGwAawBrAGsAawBrAGsAagBqAGoAagBqAGoAaQBpAGkAaQBpAGkAaABoAGgAaABoAGgAZwBnAGcAZwBnAGcAZwBmAGYAZgBmAGYAZgBlAGUAZQBlAGUAZQBlAGQAnP+c/5z/nP+c/53/nf+d/53/nf+d/53/nv+e/57/nv+e/57/nv+f/5//n/+f/5//n/+f/6D/oP+g/6D/oP+g/6H/of+h/6H/of+h/6H/ov+i/6L/ov+i/6L/ov+j/6P/o/9dAF0AXQBdAFwAXABcAFwAXABcAFwAXABbAFsAWwBbAFsAWwBbAFoAWgBaAFoAWgBaAFoAWQBZAFkAWQBZAFkAWQBZAFgAWABYAFgAWABYAFgAVwBXAFcAVwBXAFcAVwBXAKr/qv+q/6r/qv+q/6r/q/+r/6v/q/+r/6v/q/+r/6z/rP+s/6z/rP+s/6z/rP+t/63/rf+t/63/rf+t/63/rv+u/67/rv+u/67/rv+u/6//r/+v/6//r/+v/6//r/+w/7D/UABQAFAAUABQAFAATwBPAE8ATwBPAE8ATwBPAE4ATgBOAE4ATgBOAE4ATgBOAE0ATQBNAE0ATQBNAE0ATQBMAEwATABMAEwATABMAEwATABLAEsASwBLAEsASwBLAEsASwC2/7b/tv+2/7b/tv+2/7b/tv+3/7f/t/+3/7f/t/+3/7f/t/+4/7j/uP+4/7j/uP+4/7j/uP+5/7n/uf+5/7n/uf+5/7n/uf+6/7r/uv+6/7r/uv+6/7r/uv+7/7v/u/9FAEUARQBFAEUARQBFAEQARABEAEQARABEAEQARABEAEQAQwBDAEMAQwBDAEMAQwBDAEMAQgBCAEIAQgBCAEIAQgBCAEIAQgBBAEEAQQBBAEEAQQBBAEEAQQBBAEAAQABAAEAAwP/A/8D/wP/A/8D/wP/B/8H/wf/B/8H/wf/B/8H/wf/B/8L/wv/C/8L/wv/C/8L/wv/C/8L/wv/D/8P/w//D/8P/w//D/8P/w//D/8T/xP/E/8T/xP/E/8T/xP/E/8T/xP87ADsAOwA7ADsAOwA7ADsAOwA7ADsAOgA6ADoAOgA6ADoAOgA6ADoAOgA6ADoAOQA5ADkAOQA5ADkAOQA5ADkAOQA5ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADcANwA3AMn/yf/J/8n/yf/J/8n/yf/J/8r/yv/K/8r/yv/K/8r/yv/K/8r/yv/K/8v/y//L/8v/y//L/8v/y//L/8v/y//L/8z/zP/M/8z/zP/M/8z/zP/M/8z/zP/M/8z/zf/N/zMAMwAzADMAMwAzADMAMwAzADMAMwAyADIAMgAyADIAMgAyADIAMgAyADIAMgAyADEAMQAxADEAMQAxADEAMQAxADEAMQAxADEAMAAwADAAMAAwADAAMAAwADAAMAAwADAA0P/Q/9H/0f/R/9H/0f/R/9H/0f/R/9H/0f/R/9H/0f/S/9L/0v/S/9L/0v/S/9L/0v/S/9L/0v/S/9L/0//T/9P/0//T/9P/0//T/9P/0//T/9P/0//T/9P/1P/U/9T/1P8AACgAUQB6AKMAzAD1AB4BRgFvAZgBwQHqARMCPAJkAo0CtgLfAggDMQNaA4MDqwPUA/0DJgRPBHgEoQTJBPIEGwVEBW0FlgW/BegFEAY5BmIGiwa0Bt0GBgcuB1cHgAepB9IH+wckCE0IdQieCMcI8AgZCUIJawmTCbwJ5QkOCjcKYAqJCrIK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8v7y/vP+8/7z/vT+9P71/vX+9f72/vb+9/73/vf++P74/gcBBwEHAQYBBgEFAQUBBQEEAQQBAwEDAQMBAgECAQEBAQEBAQABAAEAAf8A/wD+AP4A/gD9AP0A/AD8APwA+wD7APsA+gD6APkA+QD5APgA+AD4APcA9wD2APYA9gD1APUA9QD0APQA8wDzAPMA8gDyAPIA8QDxAPEA8ADwAO8A7wDvAO4A7gDuAO0A7QDtAOwAFP8V/xX/Ff8W/xb/Fv8X/xf/F/8Y/xj/GP8Z/xn/Gf8a/xr/G/8b/xv/HP8c/xz/Hf8d/x3/Hv8e/x7/H/8f/x//IP8g/yD/If8h/yH/Iv8i/yL/I/8j/yP/JP8k/yT/Jf8l/yX/Jv8m/yb/J/8n/yf/KP8o/yj/Kf8p/yn/Kv8q/yr/K/8r/yv/LP8s/yz/Lf8t/9MA0wDSANIA0gDRANEA0QDQANAA0ADPAM8AzwDOAM4AzgDNAM0AzQDNAMwAzADMAMsAywDLAMoAygDKAMkAyQDJAMkAyADIAMgAxwDHAMcAxgDGAMYAxgDFAMUAxQDEAMQAxADDAMMAwwDDAMIAwgDCAMEAwQDBAMAAwADAAMAAvwC/AL8AvgC+AL4AvgC9AL0AQ/9E/0T/RP9E/0X/Rf9F/0b/Rv9G/0b/R/9H/0f/SP9I/0j/SP9J/0n/Sf9J/0r/Sv9K/0v/S/9L/0v/TP9M/0z/TP9N/03/Tf9O/07/Tv9O/0//T/9P/0//UP9Q/1D/Uf9R/1H/Uf9S/1L/Uv9S/1P/U/9T/1P/VP9U/1T/VP9V/1X/Vf9V/1b/Vv9W/1f/V/9X/6kAqACoAKgAqACnAKcApwCnAKYApgCmAKYApQClAKUApQCkAKQApACkAKMAowCjAKMAogCiAKIAogChAKEAoQChAKAAoACgAKAAoACfAJ8AnwCfAJ4AngCeAJ4AnQCdAJ0AnQCcAJwAnACcAJsAmwCbAJsAmwCaAJoAmgCaAJkAmQCZAJkAmACYAJgAmACXAJcAaf9p/2n/av9q/2r/av9r/2v/a/9r/2v/bP9s/2z/bP9t/23/bf9t/23/bv9u/27/bv9v/2//b/9v/2//cP9w/3D/cP9x/3H/cf9x/3H/cv9y/3L/cv9z/3P/c/9z/3P/dP90/3T/dP90/3X/df91/3X/df92/3b/dv92/3f/d/93/3f/d/94/3j/eP94/3j/ef95/4cAhwCHAIYAhgCGAIYAhgCFAIUAhQCFAIUAhACEAIQAhACEAIMAgwCDAIMAgwCCAIIAggCCAIIAgQCBAIEAgQCBAIAAgACAAIAAgAB/AH8AfwB/AH8AfgB+AH4AfgB+AH4AfQB9AH0AfQB9AHwAfAB8AHwAfAB7AHsAewB7AHsAewB6AHoAegB6AHoAeQB5AHkAh/+H/4j/iP+I/4j/iP+I/4n/if+J/4n/if+K/4r/iv+K/4r/iv+L/4v/i/+L/4v/i/+M/4z/jP+M/4z/jf+N/43/jf+N/43/jv+O/47/jv+O/47/j/+P/4//j/+P/4//kP+Q/5D/kP+Q/5H/kf+R/5H/kf+R/5L/kv+S/5L/kv+S/5P/k/+T/5P/k/+T/5T/lP9sAGwAbABsAGwAawBrAGsAawBrAGsAagBqAGoAagBqAGoAaQBpAGkAaQBpAGkAaABoAGgAaABoAGgAZwBnAGcAZwBnAGcAZwBmAGYAZgBmAGYAZgBlAGUAZQBlAGUAZQBlAGQAZABkAGQAZABkAGMAYwBjAGMAYwBjAGMAYgBiAGIAYgBiAGIAYgBhAGEAYQBhAGEAn/+f/6D/oP+g/6D/oP+g/6H/of+h/6H/of+h/6H/ov+i/6L/ov+i/6L/ov+j/6P/o/+j/6P/o/+j/6T/pP+k/6T/pP+k/6T/pP+l/6X/pf+l/6X/pf+l/6b/pv+m/6b/pv+m/6b/p/+n/6f/p/+n/6f/p/+n/6j/qP+o/6j/qP+o/6j/qf+p/6n/qf+p/6n/qf+p/1YAVgBWAFYAVgBWAFYAVQBVAFUAVQBVAFUAVQBVAFQAVABUAFQAVABUAFQAVABTAFMAUwBTAFMAUwBTAFMAUgBSAFIAUgBSAFIAUgBSAFEAUQBRAFEAUQBRAFEAUQBQAFAAUABQAFAAUABQAFAATwBPAE8ATwBPAE8ATwBPAE4ATgBOAE4ATgBOAE4ATgBOAE0As/+z/7P/s/+z/7P/s/+0/7T/tP+0/7T/tP+0/7T/tP+1/7X/tf+1/7X/tf+1/7X/tf+2/7b/tv+2/7b/tv+2/7b/tv+3/7f/t/+3/7f/t/+3/7f/t/+4/7j/uP+4/7j/uP+4/7j/uP+5/7n/uf+5/7n/uf+5/7n/uf+6/7r/uv+6/7r/uv+6/7r/uv+7/7v/u/+7/0UARQBFAEUARQBFAEQARABEAEQARABEAEQARABEAEQAQwBDAEMAQwBDAEMAQwBDAEMAQgBCAEIAQgBCAEIAQgBCAEIAQgBBAEEAQQBBAEEAQQBBAEEAQQBBAEAAQABAAEAAQABAAEAAQABAAEAAQAA/AD8APwA/AD8APwA/AD8APwA/AD4APgA+AD4APgA+AD4Awv/C/8L/wv/D/8P/w//D/8P/w//D/8P/w//D/8T/xP/E/8T/xP/E/8T/xP/E/8T/xP/F/8X/xf/F/8X/xf/F/8X/xf/F/8X/xv/G/8b/xv/G/8b/xv/G/8b/xv/G/8b/x//H/8f/x//H/8f/x//H/8f/x//H/8j/yP/I/8j/yP/I/8j/yP/I/8j/yP/I/8n/yf83ADcANwA3ADcANwA3ADcANwA3ADYANgA2ADYANgA2ADYANgA2ADYANgA2ADUANQA1ADUANQA1ADUANQA1ADUANQA1ADQANAA0ADQANAA0ADQANAA0ADQANAA0ADQAMwAzADMAMwAzADMAMwAzADMAMwAzADMAMwAyADIAMgAyADIAMgAyADIAMgAyADIAMgAyADEAz//P/8//z//P/8//z//P/8//z//P/8//0P/Q/9D/0P/Q/9D/0P/Q/9D/0P/Q/9D/0P/Q/9H/0f/R/9H/0f/R/9H/0f/R/9H/0f/R/9H/0f/S/9L/0v/S/9L/0v/S/9L/0v/S/9L/0v/S/9L/0//T/9P/0//T/9P/0//T/9P/0//T/9P/0//T/9P/1P/U/9T/1P8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    screenshare: 'data:audio/wav;base64,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AwEBAfoA8ADhANAAuwCjAIkAbABOAC8ADwDw/9D/sv+U/3j/X/9I/zT/I/8W/wz/Bv8F/wf/Df8X/yX/Nv9K/2H/ev+V/7L/0f/w/w4ALABKAGcAggCbALEAxQDVAOMA7ADyAPQA8gDsAOIA1gDFALIAnACDAGkATQAwABIA9f/X/7r/nv+D/2v/Vf9C/zL/Jf8c/xb/FP8W/xv/JP8w/0D/Uv9o/3//mf+0/9D/7f8JACYAQwBeAHcAjwClALcAxwDUAN0A4wDlAOMA3gDWAMoAuwCpAJUAfgBlAEsAMAAUAPj/3P/B/6b/jv92/2L/T/9A/zP/Kv8k/yL/I/8o/zD/O/9K/1v/bv+E/5z/tv/Q/+v/BgAhADwAVQBuAIQAmACqALkAxgDPANUA1wDWANIAygC/ALIAoQCOAHkAYgBJADAAFgD8/+L/yP+v/5f/gf9t/1z/Tf9B/zj/Mv8w/zD/NP87/0b/U/9j/3X/if+g/7f/0P/q/wIAHAA1AE4AZAB6AI0AngCtALkAwgDHAMoAyQDGAL8AtQCpAJkAiAB0AF8ASAAwABcA///m/87/tv+g/4v/eP9n/1n/Tv9F/z//PP89/0D/Rv9Q/1z/av97/47/o/+5/9D/6P8AABgALwBGAFwAcACDAJMAoQCsALUAuwC+AL4AugC0AKsAoACSAIIAbwBbAEYALwAYAAEA6v/T/73/qP+U/4L/cv9l/1n/Uf9L/0j/SP9L/1H/Wf9k/3L/gf+T/6b/u//R/+f//v8UACoAQABUAGcAeQCJAJYAoQCpAK8AsgCyALAAqgCiAJgAiwB8AGsAWABEAC8AGQADAO7/2f/D/6//nf+M/3z/b/9l/1z/V/9T/1P/Vv9b/2L/bP95/4f/mP+q/73/0f/m//z/EAAlADoATQBfAHAAfwCMAJYAngCkAKcAqAClAKEAmQCQAIQAdgBmAFUAQgAuABoABQDy/93/yf+2/6X/lP+G/3n/b/9n/2H/Xv9d/1//ZP9r/3T/gP+N/5z/rf+//9L/5v/6/w0AIQA0AEYAWABnAHYAggCMAJQAmgCdAJ4AnACYAJEAiAB9AHAAYgBSAEAALgAbAAcA9f/h/8//vf+s/53/j/+D/3n/cf9r/2j/Z/9p/23/c/97/4b/kv+g/7D/wf/T/+X/+P8KAB0ALwBAAFAAYABtAHkAgwCKAJAA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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    mention: 'data:audio/wav;base64,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FAA9AGMAhgCkALwAzgDYANsA1QDJALUAmwB7AFcAMAAIAOD/uP+T/3L/Vv9A/zH/Kf8p/zD/Pv9U/3D/kP+1/9z/AwArAFIAdgCVAK8AwwDQANYA1ADKALoAowCGAGQAPwAYAPH/yv+k/4L/ZP9M/zr/MP8s/zD/PP9O/2f/hf+n/83/9P8aAEEAZQCGAKIAuADHANAA0QDLAL0AqQCPAHAATQAnAAAA2v+1/5L/c/9Z/0X/OP8x/zL/O/9K/2D/e/+b/7//5P8KADAAVQB2AJQArAC+AMkAzQDKAL8ArgCXAHsAWgA2ABAA6//F/6L/gv9m/1D/QP83/zb/O/9H/1r/cv+Q/7H/1v/7/yAARQBnAIUAnwCzAMEAyADHAMAAsgCeAIQAZQBDAB8A+//V/7L/kf90/1z/Sv8//zr/PP9F/1X/a/+G/6X/yP/s/xAANQBXAHcAkgCoALgAwQDEAMAAtQCjAIwAcABQAC0ACQDl/8H/oP+C/2n/VP9H/z//P/9F/1L/Zf99/5r/u//e/wEAJQBIAGgAhQCcAK4AugDAAL4AtgCoAJMAeQBbADoAFwD0/9H/r/+Q/3X/YP9P/0X/Qv9G/0//YP92/5D/r//Q//T/FgA5AFkAdwCQAKQAsgC6ALwAtgCqAJkAggBmAEcAJQACAOD/vv+f/4P/a/9Z/03/R/9H/0//XP9v/4f/pP/E/+b/BwAqAEsAaQCDAJkAqgC0ALgAtQCsAJ0AiQBvAFIAMgAQAO//zf+t/5D/d/9j/1X/TP9K/0//Wf9q/4D/mv+4/9j/+v8bADwAWwB3AI4AoACtALMAswCtAKEAjwB4AFwAPgAdAP3/2/+7/57/g/9u/13/U/9O/1D/WP9m/3n/kf+t/8z/7f8NAC4ATQBpAIIAlgClAK0AsACsAKMAkwB/AGYASQAqAAkA6f/J/6v/kP95/2f/Wv9T/1L/WP9j/3T/iv+j/8H/4P8AACAAPwBcAHYAiwCcAKcArACrAKQAlwCFAG4AUwA2ABYA9//X/7n/nf+F/3H/Yv9Z/1b/WP9h/2//g/+b/7b/1P/z/xIAMgBPAGkAgACTAKAApwCoAKQAmgCKAHUAXQBBACIAAwDl/8b/qv+R/3v/a/9f/1r/Wv9g/2z/ff+T/6z/yf/n/wUAJABCAF0AdQCJAJgAoQClAKMAmwCOAHwAZQBLAC4A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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
};

const notifyAudioCache = {};

// ---------- Настройки звука уведомлений: громкость + свой файл (для каждого типа) ----------
// Хранится отдельно от NOTIFY_SETTINGS_KEY звука микрофона/видео, чтобы не смешивать
// разные по смыслу настройки в одном объекте. custom*Sound — data URI (base64),
// который пользователь загрузил сам, вместо встроенного звука.
// Изначально свой звук можно было загрузить только для сообщений — теперь то же самое
// доступно и для звуков входа/выхода из голосового канала.
const NOTIFY_SETTINGS_KEY = 'mute:notifySettings';

// Описание каждого настраиваемого типа звука: под каким ключом хранить громкость,
// свой файл и его имя в localStorage, и какая громкость по умолчанию.
const CUSTOM_SOUND_TYPES = {
    message: { volumeKey: 'messageVolume', customKey: 'customMessageSound', nameKey: 'customMessageSoundName', defaultVolume: 0.5 },
    join: { volumeKey: 'joinVolume', customKey: 'customJoinSound', nameKey: 'customJoinSoundName', defaultVolume: 0.6 },
    leave: { volumeKey: 'leaveVolume', customKey: 'customLeaveSound', nameKey: 'customLeaveSoundName', defaultVolume: 0.6 },
    mute: { volumeKey: 'muteVolume', customKey: 'customMuteSound', nameKey: 'customMuteSoundName', defaultVolume: 0.5 },
    deafen: { volumeKey: 'deafenVolume', customKey: 'customDeafenSound', nameKey: 'customDeafenSoundName', defaultVolume: 0.5 },
    screenshare: { volumeKey: 'screenshareVolume', customKey: 'customScreenshareSound', nameKey: 'customScreenshareSoundName', defaultVolume: 0.5 },
    mention: { volumeKey: 'mentionVolume', customKey: 'customMentionSound', nameKey: 'customMentionSoundName', defaultVolume: 0.7 }
};

function loadNotifySettings() {
    try {
        const raw = localStorage.getItem(NOTIFY_SETTINGS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}
function saveNotifySettings(patch) {
    try {
        const merged = Object.assign(loadNotifySettings(), patch);
        localStorage.setItem(NOTIFY_SETTINGS_KEY, JSON.stringify(merged));
        return true;
    } catch (e) {
        // Скорее всего переполнение localStorage (обычно лимит ~5 МБ) —
        // такое бывает, если загрузить слишком длинный/тяжёлый аудиофайл.
        console.warn('[Звук] Не удалось сохранить настройки уведомлений:', e);
        return false;
    }
}
function getSoundVolume(key) {
    const cfg = CUSTOM_SOUND_TYPES[key];
    if (!cfg) return 0.6;
    const saved = loadNotifySettings()[cfg.volumeKey];
    return typeof saved === 'number' ? saved : cfg.defaultVolume;
}
function getCustomSound(key) {
    const cfg = CUSTOM_SOUND_TYPES[key];
    if (!cfg) return null;
    return loadNotifySettings()[cfg.customKey] || null;
}

function getNotifyAudio(key) {
    // Источник может смениться в рантайме (загрузили свой файл или сбросили на
    // стандартный) — поэтому кэш не просто "разово заполнили и забыли", а сверяем
    // src при каждом обращении.
    const src = getCustomSound(key) || NOTIFY_SOUNDS[key];
    const cached = notifyAudioCache[key];
    if (!cached || cached.src !== src) {
        const audio = new Audio(src);
        audio.preload = 'auto';
        notifyAudioCache[key] = audio;
    }
    return notifyAudioCache[key];
}

// Проигрывает звук уведомления. Клонируем элемент, чтобы звуки могли накладываться
// друг на друга (например, если несколько человек заходят подряд).
function playNotifySound(key, volume = 0.6) {
    try {
        const base = getNotifyAudio(key);
        const instance = base.cloneNode(true);
        instance.volume = volume;
        instance.play().catch(() => {});
    } catch (e) {
        console.warn('[Звук] Не удалось воспроизвести звук уведомления:', e);
    }
}

// Новое сообщение в чате
function playMessageSound() {
    playNotifySound('message', getSoundVolume('message'));
}

// Кто-то зашёл в комнату
function playJoinSound() {
    playNotifySound('join', getSoundVolume('join'));
}

// Кто-то вышел из комнаты
function playLeaveSound() {
    playNotifySound('leave', getSoundVolume('leave'));
}

// Свой или чужой мьют микрофона включился/выключился. Раньше звук генерировался
// на лету осциллятором (Web Audio) и не мог быть заменён своим файлом — теперь
// это обычный настраиваемый звук уведомления, как сообщения/вход/выход.
function playMuteSound() {
    playNotifySound('mute', getSoundVolume('mute'));
}

// Свой или чужой дефен (выключение наушников) включился/выключился.
function playDeafenSound() {
    playNotifySound('deafen', getSoundVolume('deafen'));
}

// Старт/остановка демонстрации экрана или веб-камеры.
function playScreenShareSound() {
    playNotifySound('screenshare', getSoundVolume('screenshare'));
}

// Кто-то упомянул нас через @ник в чате — отдельный, более заметный звук,
// проигрывается ВМЕСТО обычного звука сообщения (см. обработчик 'chat message').
function playMentionSound() {
    playNotifySound('mention', getSoundVolume('mention'));
}

// ---------- UI настроек звука (громкость + свой файл) — общая логика для всех типов ----------
function setupCustomSoundControls(key, els) {
    const cfg = CUSTOM_SOUND_TYPES[key];
    if (!cfg) return;

    function refreshLabel() {
        if (!els.label) return;
        const name = loadNotifySettings()[cfg.nameKey];
        els.label.textContent = name ? `Свой: ${name}` : 'Стандартный';
        if (els.label) els.label.title = name ? `Свой звук: ${name}` : 'Стандартный звук';
    }

    (function applySaved() {
        const percent = Math.round(getSoundVolume(key) * 100);
        if (els.slider) els.slider.value = percent;
        if (els.valueDisplay) els.valueDisplay.innerText = `${percent}%`;
        refreshLabel();
    })();

    if (els.slider) {
        els.slider.addEventListener('input', () => {
            const percent = Number(els.slider.value);
            if (els.valueDisplay) els.valueDisplay.innerText = `${percent}%`;
            saveNotifySettings({ [cfg.volumeKey]: percent / 100 });
        });
    }

    if (els.testBtn) {
        els.testBtn.addEventListener('click', () => playNotifySound(key, getSoundVolume(key)));
    }

    if (els.fileInput) {
        els.fileInput.addEventListener('change', () => {
            const file = els.fileInput.files && els.fileInput.files[0];
            if (!file) return;
            // Ограничение размера — звук хранится как base64 в localStorage (лимит там
            // обычно порядка 5 МБ на весь домен), поэтому даём разумный потолок в 2 МБ
            // на сам аудиофайл, чтобы не забить хранилище одним звуком уведомления.
            const MAX_SIZE = 2 * 1024 * 1024;
            if (file.size > MAX_SIZE) {
                alert('Файл слишком большой (максимум 2 МБ). Выберите более короткий звук.');
                els.fileInput.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                const ok = saveNotifySettings({ [cfg.customKey]: dataUrl, [cfg.nameKey]: file.name });
                if (!ok) {
                    alert('Не удалось сохранить звук — возможно, он слишком большой для локального хранилища браузера.');
                    return;
                }
                delete notifyAudioCache[key]; // пересоздаём Audio с новым src при следующем проигрывании
                refreshLabel();
                playNotifySound(key, getSoundVolume(key));
            };
            reader.onerror = () => alert('Не удалось прочитать файл.');
            reader.readAsDataURL(file);
            els.fileInput.value = '';
        });
    }

    if (els.resetBtn) {
        els.resetBtn.addEventListener('click', () => {
            const settings = loadNotifySettings();
            delete settings[cfg.customKey];
            delete settings[cfg.nameKey];
            try { localStorage.setItem(NOTIFY_SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
            delete notifyAudioCache[key];
            refreshLabel();
            playNotifySound(key, getSoundVolume(key));
        });
    }
}

setupCustomSoundControls('message', {
    slider: messageSoundVolumeSlider,
    valueDisplay: messageSoundVolumeValueDisplay,
    label: messageSoundCurrentLabel,
    testBtn: messageSoundTestBtn,
    fileInput: messageSoundFileInput,
    resetBtn: messageSoundResetBtn
});

setupCustomSoundControls('join', {
    slider: joinSoundVolumeSlider,
    valueDisplay: joinSoundVolumeValueDisplay,
    label: joinSoundCurrentLabel,
    testBtn: joinSoundTestBtn,
    fileInput: joinSoundFileInput,
    resetBtn: joinSoundResetBtn
});

setupCustomSoundControls('leave', {
    slider: leaveSoundVolumeSlider,
    valueDisplay: leaveSoundVolumeValueDisplay,
    label: leaveSoundCurrentLabel,
    testBtn: leaveSoundTestBtn,
    fileInput: leaveSoundFileInput,
    resetBtn: leaveSoundResetBtn
});

setupCustomSoundControls('mute', {
    slider: muteSoundVolumeSlider,
    valueDisplay: muteSoundVolumeValueDisplay,
    label: muteSoundCurrentLabel,
    testBtn: muteSoundTestBtn,
    fileInput: muteSoundFileInput,
    resetBtn: muteSoundResetBtn
});

setupCustomSoundControls('deafen', {
    slider: deafenSoundVolumeSlider,
    valueDisplay: deafenSoundVolumeValueDisplay,
    label: deafenSoundCurrentLabel,
    testBtn: deafenSoundTestBtn,
    fileInput: deafenSoundFileInput,
    resetBtn: deafenSoundResetBtn
});

setupCustomSoundControls('screenshare', {
    slider: screenshareSoundVolumeSlider,
    valueDisplay: screenshareSoundVolumeValueDisplay,
    label: screenshareSoundCurrentLabel,
    testBtn: screenshareSoundTestBtn,
    fileInput: screenshareSoundFileInput,
    resetBtn: screenshareSoundResetBtn
});

setupCustomSoundControls('mention', {
    slider: mentionSoundVolumeSlider,
    valueDisplay: mentionSoundVolumeValueDisplay,
    label: mentionSoundCurrentLabel,
    testBtn: mentionSoundTestBtn,
    fileInput: mentionSoundFileInput,
    resetBtn: mentionSoundResetBtn
});

// "Заглушка" видеотрека: добавляется в каждый звонок с самого начала (вместе с аудио),
// чтобы видео-канал в WebRTC-соединении уже существовал у всех участников.
// Включение демонстрации — это просто подмена трека (replaceTrack), БЕЗ пересоздания
// звонка, поэтому чужие соединения никогда не рвутся и метаданные не путаются.
let placeholderVideoTrack = null;

// То же самое, но для звука демонстрации: отдельный (второй) аудиотрек в потоке.
// По умолчанию — полная тишина; когда включается демонстрация со звуком (захват экрана
// с audio:true), этот трек подменяется на реальный звук демонстрации через replaceTrack.
let placeholderDemoAudioTrack = null;
let currentDemoAudioTrack = null; // текущий трек в "слоте" звука демонстрации (плейсхолдер или реальный)

function createSilentAudioTrack() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    const destination = audioContext.createMediaStreamDestination();
    return destination.stream.getAudioTracks()[0];
}

// Кто из участников сейчас реально показывает демонстрацию (по peerId).
// Не путать с наличием видеотрека в потоке — он есть всегда (либо реальный, либо заглушка).
const sharingPeers = new Set();

// Последний полученный MediaStream от каждого собеседника — нужен, чтобы можно было
// показать/скрыть видео-плитку в любой момент, не дожидаясь нового события 'stream'.
let remoteStreamsByPeer = {};

function createPlaceholderVideoTrack() {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 2, 2);
    const stream = canvas.captureStream(1);
    return stream.getVideoTracks()[0];
}

const PROFILE_STORAGE_KEY = 'voicechat_profile';

function saveProfileToStorage() {
    try {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({
            username: currentUser.username,
            avatar: currentUser.avatar,
            token: currentUser.token || null
        }));
    } catch (e) {
        console.warn('[Внимание] Не удалось сохранить профиль локально:', e);
    }
}

function loadProfileFromStorage() {
    try {
        const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function clearProfileStorage() {
    try { localStorage.removeItem(PROFILE_STORAGE_KEY); } catch (e) { /* ignore */ }
}

// ---------- Вход: вкладки "Вход" / "Регистрация", пароль ----------
let authMode = 'login'; // 'login' | 'register'

function showAuthError(message) {
    authError.textContent = message;
    authError.style.display = message ? 'block' : 'none';
}

function setAuthMode(mode) {
    authMode = mode;
    authTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === mode));
    avatarInputGroup.style.display = mode === 'register' ? 'block' : 'none';
    passwordInput.setAttribute('autocomplete', mode === 'register' ? 'new-password' : 'current-password');
    registerBtn.textContent = mode === 'register' ? 'Зарегистрироваться' : 'Войти';
    showAuthError('');
}

authTabs.forEach(tab => {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.tab));
});

// Общая точка входа после успешной регистрации/логина — сохраняет токен и профиль,
// заполняет поля и заходит в приложение.
async function applyAuthSuccess(data) {
    currentUser.username = data.username;
    currentUser.avatar = data.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(data.username)}`;
    currentUser.token = data.token || null;
    usernameInput.value = currentUser.username;
    avatarInput.value = currentUser.avatar;

    saveProfileToStorage();

    // Тема с сервера (если уже сохранялась под этим аккаунтом) главнее локальной —
    // это то, что синхронизирует цвет между устройствами при входе в тот же аккаунт.
    if (data.theme && (data.theme.accent || data.theme.textMode || data.theme.bgColor)) {
        const merged = {
            accent: parseColorInput(data.theme.accent) || currentTheme.accent,
            textMode: data.theme.textMode === 'dark' ? 'dark' : (data.theme.textMode === 'light' ? 'light' : currentTheme.textMode),
            bgColor: parseColorInput(data.theme.bgColor) || currentTheme.bgColor
        };
        saveThemeToStorage(merged);
        applyTheme(merged);
    }

    await completeLogin();
}

// Основная кнопка: в зависимости от вкладки либо логинит по паролю, либо регистрирует.
registerBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    showAuthError('');

    if (!username) {
        showAuthError('Введите ник');
        return;
    }
    if (!password) {
        showAuthError('Введите пароль');
        return;
    }

    registerBtn.disabled = true;
    const originalLabel = registerBtn.textContent;
    registerBtn.textContent = authMode === 'register' ? 'Регистрируем...' : 'Входим...';

    try {
        const endpoint = authMode === 'register' ? '/auth/register' : '/auth/login';
        const body = authMode === 'register'
            ? { username, password, avatar: avatarInput.value.trim() }
            : { username, password };

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();

        if (!res.ok) {
            showAuthError(data.error || 'Что-то пошло не так');
            return;
        }

        await applyAuthSuccess(data);
    } catch (e) {
        console.error('[Ошибка] Вход/регистрация:', e);
        showAuthError('Не удалось связаться с сервером');
    } finally {
        registerBtn.disabled = false;
        registerBtn.textContent = originalLabel;
    }
});

// Сервер сообщает, что выбранный ник уже занят — либо зарегистрированным аккаунтом,
// либо другим человеком, который прямо сейчас подключён под этим же именем — и подставил другой.
socket.on('username protected', ({ requested, assignedUsername }) => {
    currentUser.username = assignedUsername;
    saveProfileToStorage();

    if (usernameInput) usernameInput.value = assignedUsername;
    if (profileUsernameInput) profileUsernameInput.value = assignedUsername;

    const localWrapName = document.querySelector('#local-video-wrap .video-username');
    if (localWrapName) {
        localWrapName.innerText = `${assignedUsername} (Вы)`;
        localWrapName.style.color = getUserColor(assignedUsername);
    }

    alert(`Ник «${requested}» уже занят (аккаунтом или другим участником, который сейчас онлайн). Вам временно присвоен ник «${assignedUsername}». Если это ваш аккаунт — войдите через вкладку «Вход».`);
});

// ---------- Восстановление после разрыва соединения ----------
// socket.io-client сам переподключается при обрыве (сон ноутбука, разрыв Wi-Fi,
// сворачивание/фоновый режим приложения), но при новом подключении сервер выдаёт
// НОВЫЙ socket.id — это фактически новое соединение с нуля, без socket.data (ника)
// и без членства в комнате (rooms[room][id] сервер уже удалил при разрыве прежнего
// сокета). Раньше клиент после такого разрыва не переотправлял ни 'register user',
// ни 'join room' — сам он продолжал считать себя "в комнате" (currentUser.room не
// сбрасывался), но для сервера и всех остальных участников фактически исчезал:
// переставал приходить в 'room users', никто не получал от него 'mute state',
// а сам он переставал получать обновления о других — в том числе не видел, кто из
// уже присутствующих в муте/дефене. Теперь при восстановлении соединения заново
// регистрируемся и, если были в голосовом канале, заново в него заходим.
let hasConnectedBefore = false;
socket.on('connect', () => {
    if (!hasConnectedBefore) {
        hasConnectedBefore = true;
        return; // первое подключение — обычная инициализация и так идёт по остальному коду
    }
    console.log('[Соединение] Восстановлено после разрыва — заново регистрируемся на сервере.');

    // Новый сокет на сервере «чистый»: он не в голосовой комнате и не в комнате чата
    // (та, из которой приходят обновления списка участников и сообщения). Поэтому после
    // обрыва (фоновая вкладка, сон ноутбука, прокси Render) восстанавливаем всё сами.
    const restoreSubscriptions = () => {
        if (currentUser.room) {
            socket.emit('join room', { room: currentUser.room, peerId: myPeerId, micMuted: isMuted, deafened: isDeafened });
        }
        if (selectedRoom) {
            // заодно перезагрузит историю чата — подтянет пропущенные сообщения
            socket.emit('select chat room', { room: selectedRoom });
            socket.emit('get room users', selectedRoom);
        }
    };

    if (myPeerId) {
        // Ждём подтверждения регистрации (ник на сервере уже выставлен), и только потом входим в канал.
        // Таймаут — на случай, если ответ потерялся: всё равно восстанавливаемся.
        socket.timeout(5000).emit('register user', {
            username: currentUser.username,
            avatar: currentUser.avatar,
            peerId: myPeerId,
            token: currentUser.token || null
        }, () => {
            requestMyServers();
            restoreSubscriptions();
        });
    } else {
        restoreSubscriptions();
    }
});

// Сам вход в приложение — вынесено отдельно, чтобы можно было вызвать
// как по клику "Войти в чат", так и автоматически при повторном открытии
// сайта (профиль уже сохранён в браузере, повторно логиниться не нужно).
async function completeLogin() {
    loginContainer.style.display = 'none';
    appContainer.style.display = 'flex';

    await initMediaStream();
    await loadMicrophones();

    if (!placeholderVideoTrack) {
        placeholderVideoTrack = createPlaceholderVideoTrack();
    }
    if (!localMediaStream.getVideoTracks().includes(placeholderVideoTrack)) {
        localMediaStream.addTrack(placeholderVideoTrack);
    }

    if (!placeholderDemoAudioTrack) {
        placeholderDemoAudioTrack = createSilentAudioTrack();
    }
    currentDemoAudioTrack = placeholderDemoAudioTrack;
    if (!localMediaStream.getAudioTracks().includes(placeholderDemoAudioTrack)) {
        localMediaStream.addTrack(placeholderDemoAudioTrack);
    }

    initPeer();              
}

function initPeer() {
    if (myPeer) return;
    myPeer = new Peer();

    myPeer.on('open', (id) => {
        myPeerId = id;
        console.log('[Peer] Мой Peer ID:', id);
        // После подтверждения регистрации сервер уже знает, кто мы (и вошли ли в аккаунт) —
        // только теперь можно получить полный список своих серверов, общий для всех устройств.
        socket.timeout(5000).emit('register user', {
            username: currentUser.username,
            avatar: currentUser.avatar,
            peerId: id,
            token: currentUser.token || null
        }, () => requestMyServers());
    });

    myPeer.on('call', (call) => {
        console.log('[Звонок] Входящий звонок от:', call.peer);
        call.answer(localMediaStream);
        // ВАЖНО: обновлять connectedUsers по call.metadata можно только здесь, на
        // ПРИНИМАЮЩЕЙ стороне — тут call.metadata реально описывает того, кто звонит
        // (call.peer). На звонящей стороне (см. myPeer.call(...) ниже) в metadata
        // кладутся СВОИ СОБСТВЕННЫЕ username/avatar, чтобы представиться собеседнику —
        // если применить тот же код там, мы припишем звонящему (то есть себе) данные
        // собеседнику, которому звоним. Раньше это обновление жило внутри общей
        // handleIncomingCall(), вызываемой с обеих сторон, — поэтому у того из двух
        // участников, кто оказывался звонящим (кто именно — зависит от сравнения их
        // PeerJS ID, который выдаётся заново при каждом полном перезаходе), собеседник
        // отображался под ЕГО СОБСТВЕННЫМ ником и аватаркой.
        if (call.metadata && call.metadata.username) {
            const prev = connectedUsers[call.peer] || {};
            connectedUsers[call.peer] = { ...prev, username: call.metadata.username, avatar: call.metadata.avatar };
            updateVoiceUsersList();
        }
        handleIncomingCall(call);
    });

    myPeer.on('error', (err) => {
        console.error('[Ошибка] PeerJS:', err);
    });

    // PeerJS общается со своим сигнальным сервером через отдельное WebSocket-соединение
    // (независимо от socket.io) — оно тоже может отвалиться (сон ноутбука, сворачивание
    // окна, разрыв сети) и тогда исходящие/входящие звонки перестают устанавливаться,
    // хотя text-чат и socket.io продолжают работать как ни в чём не бывало. 'disconnected'
    // не разрушает сам Peer-объект (id остаётся прежним) — reconnect() просто поднимает
    // сигнальное соединение заново.
    myPeer.on('disconnected', () => {
        console.warn('[Peer] Сигнальное соединение потеряно, пробуем восстановить…');
        if (!myPeer.destroyed) {
            myPeer.reconnect();
        }
    });
}

async function initMediaStream(deviceId = null) {
    try {
        // Запоминаем старый ИСХОДЯЩИЙ трек (тот, что реально уходит собеседникам) ДО его
        // остановки — он понадобится, чтобы найти нужный сендер в активных звонках и
        // точечно его заменить. Это трек из графа обработки (processedTrack), а не сырой
        // трек микрофона — именно он лежит в localMediaStream и передаётся по WebRTC.
        const oldOutputTrack = processedTrack;

        if (rawAudioStream) {
            rawAudioStream.getTracks().forEach(t => t.stop());
        }

        const constraints = {
            audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                echoCancellation: echoCheck.checked,
                noiseSuppression: noiseCheck.checked,
                autoGainControl: agcCheck.checked
            },
            video: false
        };

        rawAudioStream = await navigator.mediaDevices.getUserMedia(constraints);

        // Строим граф обработки: сырой сигнал -> шумоподавление -> громкость микрофона ->
        // processedTrack. Сырой сигнал одновременно уходит в analyserNode (индикатор
        // уровня и Voice Gate), поэтому он "живой" независимо от того, включена ли
        // сейчас передача собеседникам.
        await setupAudioAnalyzer(rawAudioStream);
        const newOutputTrack = processedTrack;

        if (!localMediaStream) {
            localMediaStream = new MediaStream();
        } else if (oldOutputTrack && localMediaStream.getAudioTracks().includes(oldOutputTrack)) {
            // Убираем именно старый трек микрофона, а не вообще все аудиотреки —
            // иначе заодно слетал бы и слот звука демонстрации экрана.
            localMediaStream.removeTrack(oldOutputTrack);
        }

        localMediaStream.addTrack(newOutputTrack);
        applyGateToMicTrack();

        // Раньше новый трек оставался только в localMediaStream, а во ВСЕ уже
        // установленные звонки продолжал уходить старый (уже остановленный) трек —
        // из-за этого при смене микрофона/настроек звука собеседники переставали
        // вас слышать, хотя локально всё выглядело нормально. Теперь подменяем трек
        // во всех активных соединениях так же, как это уже делается для видео.
        replaceMicTrackForAllPeers(newOutputTrack, oldOutputTrack);

        if (activeVideoStream) {
            activeVideoStream.getVideoTracks().forEach(track => {
                if (!localMediaStream.getVideoTracks().includes(track)) {
                    localMediaStream.addTrack(track);
                }
            });
        }
    } catch (e) {
        console.error('[Ошибка] Доступ к микрофону:', e);
        alert('Не удалось получить доступ к микрофону. Проверьте разрешения.');
    }
}

// Полностью отключает и обнуляет предыдущий граф обработки перед пересборкой
// (смена микрофона/профиля шумоподавления) — иначе старые узлы и исходящий
// трек продолжали бы висеть в памяти и в звонках.
function teardownAudioGraph() {
    if (sourceNode) { try { sourceNode.disconnect(); } catch (e) { /* ignore */ } }
    if (micGainNode) { try { micGainNode.disconnect(); } catch (e) { /* ignore */ } }
    micGainNode = null;
    if (destinationNode) { try { destinationNode.disconnect(); } catch (e) { /* ignore */ } }
    destinationNode = null;
    if (processedTrack) { try { processedTrack.stop(); } catch (e) { /* ignore */ } }
    processedTrack = null;
    if (analyserNode) {
        // У AudioWorkletNode обязательно отвязываем обработчик сообщений — иначе старый
        // узел, даже отключённый от графа, может успеть прислать ещё пару "хвостовых"
        // сообщений и лишний раз дёрнуть UI закрытой над ним замыканием.
        if (analyserNode.port) { try { analyserNode.port.onmessage = null; } catch (e) { /* ignore */ } }
        try { analyserNode.disconnect(); } catch (e) { /* ignore */ }
    }
    analyserNode = null;
    sourceNode = null;
}

async function setupAudioAnalyzer(stream) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    // AudioContext может создаться в состоянии 'suspended' (политики автозапуска
    // браузера/Electron) — тогда метр громкости не получает свежие данные, и
    // Voice Gate выглядит "мёртвым": уровень и порог не реагируют вообще ни на
    // что. Раньше resume() вызывался только при включении самопрослушивания —
    // теперь будим контекст сразу же, при каждой попытке его использовать.
    if (audioContext.state === 'suspended') {
        audioContext.resume().catch((e) => console.warn('[AudioContext] resume() не удался:', e));
    }

    teardownAudioGraph();
    try {
        sourceNode = audioContext.createMediaStreamSource(stream);

        // Анализатор уровня/Voice Gate — сидит прямо на сыром источнике, до всякого
        // выключения передачи, поэтому индикатор и порог срабатывания продолжают
        // "видеть" микрофон даже когда сам гейт закрыт.
        analyserNode = await createLevelMeterNode(audioContext);
        sourceNode.connect(analyserNode);

        micGainNode = audioContext.createGain();
        micGainNode.gain.value = micVolume;
        sourceNode.connect(micGainNode);

        destinationNode = audioContext.createMediaStreamDestination();
        micGainNode.connect(destinationNode);
        processedTrack = destinationNode.stream.getAudioTracks()[0];

        // Самопрослушивание микрофона ("Слышать себя"): подключаем к уже обработанному
        // сигналу (после громкости микрофона) — так слышно именно то, что реально
        // уходит собеседникам. Узел усиления живёт постоянно, чтобы включённость
        // самопрослушивания не сбрасывалась при пересборке графа.
        if (!micMonitorGain) {
            micMonitorGain = audioContext.createGain();
            micMonitorGain.gain.value = micMonitorEnabled ? 1 : 0;
            micMonitorGain.connect(audioContext.destination);
        }
        micGainNode.connect(micMonitorGain);

        if (analyserNode.__isWorklet) {
            processAudioLevel(analyserNode);
        } else {
            processAudioLevelFallback(analyserNode);
        }
    } catch (e) {
        console.error('[Ошибка] Аудиоанализатор:', e);
    }
}

// Включает/выключает реальную передачу микрофона (не UI-индикатор), учитывая
// ручной мьют/дефен и состояние Voice Gate. Не трогает трек демонстрации звука.
// Также приглушает самопрослушивание ("Слышать себя") синхронно с гейтом —
// раньше micMonitorGain брал звук ДО гейта и был слышен всегда, даже когда
// микрофон реально отключён для собеседников, что вводило в заблуждение при
// проверке порога срабатывания.
function applyGateToMicTrack() {
    if (!localMediaStream) return;
    const shouldTransmit = !isMuted && !isDeafened && (!gateEnabled || gateOpen);
    localMediaStream.getAudioTracks().forEach(track => {
        if (track !== currentDemoAudioTrack) {
            track.enabled = shouldTransmit;
        }
    });
    if (micMonitorGain) {
        micMonitorGain.gain.value = (micMonitorEnabled && shouldTransmit) ? 1 : 0;
    }
}

// RMS в дБFS по временной области — честная громкость сигнала, в отличие от простого
// среднего по частотным бинам (которое из-за квантования в байт легко "залипает" в
// нуле на тихом звуке и делает порог срабатывания малочувствительным/дёрганым).
function getRmsDb(analyser, floatBuffer) {
    analyser.getFloatTimeDomainData(floatBuffer);
    let sumSquares = 0;
    for (let i = 0; i < floatBuffer.length; i++) {
        sumSquares += floatBuffer[i] * floatBuffer[i];
    }
    const rms = Math.sqrt(sumSquares / floatBuffer.length);
    return rms > 0 ? 20 * Math.log10(rms) : -100;
}

// Основной путь: AudioWorkletNode сам присылает готовое значение в дБ через порт
// примерно раз в 50мс — здесь просто реагируем на уже посчитанные данные, никакого
// собственного цикла опроса на главном потоке не крутится вообще.
function processAudioLevel(node) {
    const localNode = node;
    // Элементы UI не пересоздаются на каждое сообщение — ищем их в DOM один раз, а не
    // при каждом отчёте от воркла.
    const gateDebugStatus = document.getElementById('gate-debug-status');
    let myAvatarElem = document.getElementById(`avatar-${myPeerId}`);

    let messageCount = 0;
    let lastIsSpeaking = null;

    localNode.port.onmessage = (event) => {
        if (analyserNode !== localNode) {
            // граф пересобран (смена мика/профиля) — старый узел больше не актуален
            localNode.port.onmessage = null;
            return;
        }
        const volumeDb = event.data;
        messageCount++;
        // Полоску уровня и дебаг-текст обновляем через отчёт (то есть ~раз в 100мс) —
        // глазом разницы с каждым отчётом (~50мс) не видно, а лишних стилевых
        // пересчётов вдвое меньше. Саму логику гейта ниже это не касается — она
        // считается на каждом отчёте, чтобы отклик оставался быстрым.
        if (messageCount % 2 === 0) {
            let meterPercent = Math.max(0, Math.min(100, ((volumeDb + 70) / 60) * 100));
            micMeter.style.width = `${meterPercent}%`;

            if (gateDebugStatus && gateDebugStatus.offsetParent !== null) {
                const ctxState = audioContext ? audioContext.state : 'нет контекста';
                const gateState = !gateEnabled ? 'выключен' : (gateOpen ? 'открыт' : 'закрыт');
                gateDebugStatus.innerText = `Уровень: ${volumeDb.toFixed(1)} дБ · Гейт: ${gateState} · Аудио-контекст: ${ctxState}`;
            }
        }

        // Гистерезис + hangover: открываем канал сразу при превышении порога,
        // закрываем только после короткой задержки ниже порога — так не режет слова.
        if (volumeDb > gateThreshold) {
            gateOpen = true;
            if (gateCloseTimer) {
                clearTimeout(gateCloseTimer);
                gateCloseTimer = null;
            }
        } else if (volumeDb < gateThreshold - GATE_HYSTERESIS_DB && gateOpen && !gateCloseTimer) {
            gateCloseTimer = setTimeout(() => {
                gateOpen = false;
                gateCloseTimer = null;
                applyGateToMicTrack();
            }, gateHangoverMs);
        }

        const isSpeaking = !isMuted && !isDeafened && (!gateEnabled || gateOpen);
        if (isSpeaking !== lastIsSpeaking) {
            lastIsSpeaking = isSpeaking;
            applyGateToMicTrack();
            if (!myAvatarElem || !myAvatarElem.isConnected) myAvatarElem = document.getElementById(`avatar-${myPeerId}`);
            if (myAvatarElem) myAvatarElem.classList.toggle('speaking', isSpeaking);
        }
    };
}

// Запасной путь — используется только если AudioWorklet недоступен в этом браузере/
// контексте. Прежний способ: опрос AnalyserNode из setInterval в главном потоке.
function processAudioLevelFallback(node) {
    const localAnalyser = node;
    const dataArray = new Float32Array(localAnalyser.fftSize);

    const gateDebugStatus = document.getElementById('gate-debug-status');
    let myAvatarElem = document.getElementById(`avatar-${myPeerId}`);

    const intervalId = setInterval(check, 50);
    let tickCount = 0;
    let lastIsSpeaking = null;

    function check() {
        if (analyserNode !== localAnalyser) {
            clearInterval(intervalId);
            return;
        }
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().catch(() => { /* попробуем снова на следующем тике */ });
        }
        let volumeDb = getRmsDb(localAnalyser, dataArray);
        tickCount++;
        const shouldRedraw = (tickCount % 2 === 0);

        if (shouldRedraw) {
            let meterPercent = Math.max(0, Math.min(100, ((volumeDb + 70) / 60) * 100));
            micMeter.style.width = `${meterPercent}%`;

            if (gateDebugStatus && gateDebugStatus.offsetParent !== null) {
                const ctxState = audioContext ? audioContext.state : 'нет контекста';
                const gateState = !gateEnabled ? 'выключен' : (gateOpen ? 'открыт' : 'закрыт');
                gateDebugStatus.innerText = `Уровень: ${volumeDb.toFixed(1)} дБ · Гейт: ${gateState} · Аудио-контекст: ${ctxState}`;
            }
        }

        if (volumeDb > gateThreshold) {
            gateOpen = true;
            if (gateCloseTimer) {
                clearTimeout(gateCloseTimer);
                gateCloseTimer = null;
            }
        } else if (volumeDb < gateThreshold - GATE_HYSTERESIS_DB && gateOpen && !gateCloseTimer) {
            gateCloseTimer = setTimeout(() => {
                gateOpen = false;
                gateCloseTimer = null;
                applyGateToMicTrack();
            }, gateHangoverMs);
        }

        const isSpeaking = !isMuted && !isDeafened && (!gateEnabled || gateOpen);
        if (isSpeaking !== lastIsSpeaking) {
            lastIsSpeaking = isSpeaking;
            applyGateToMicTrack();
            if (!myAvatarElem || !myAvatarElem.isConnected) myAvatarElem = document.getElementById(`avatar-${myPeerId}`);
            if (myAvatarElem) myAvatarElem.classList.toggle('speaking', isSpeaking);
        }
    }
    check();
}

async function setupRemoteAudioAnalyzer(stream, peerId) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    try {
        const micTrack = stream.getAudioTracks()[0];
        if (!micTrack) return;
        const micStream = new MediaStream([micTrack]);

        const source = audioContext.createMediaStreamSource(micStream);
        remoteAudioSources[peerId] = source;

        const remoteAnalyser = await createLevelMeterNode(audioContext);
        source.connect(remoteAnalyser);
        remoteAnalysers[peerId] = remoteAnalyser;

        const username = (connectedUsers[peerId] && connectedUsers[peerId].username) || '';
        const voiceGain = audioContext.createGain();
        voiceGain.gain.value = isDeafened ? 0 : getRemoteVolumePercent(username) / 100;
        source.connect(voiceGain);
        voiceGain.connect(audioContext.destination);
        remoteVoiceGainNodes[peerId] = voiceGain;

        if (remoteAnalyser.__isWorklet) {
            processRemoteAudioLevel(peerId, remoteAnalyser);
        } else {
            processRemoteAudioLevelFallback(peerId, remoteAnalyser);
        }
    } catch (e) {
        console.error('[Ошибка] Удалённый аудиоанализатор:', e);
    }
}

// Звук демонстрации — отдельный (второй) аудиотрек в потоке собеседника.
// Слышен ТОЛЬКО когда его видео открыто в полноэкранном режиме — громкость
// регулируется через отдельный gain-узел, а не через сам <audio>-элемент
// (его держим заглушенным, чтобы не проигрывать звук в обход регулировки громкости).
function setupRemoteDemoAudio(stream, peerId) {
    const demoTrack = stream.getAudioTracks()[1];
    if (!demoTrack) return;

    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    try {
        const demoStream = new MediaStream([demoTrack]);

        const source = audioContext.createMediaStreamSource(demoStream);
        remoteDemoAudioSources[peerId] = source;
        const gainNode = audioContext.createGain();
        const initialVolume = demoVolumes[peerId] ?? 100;
        gainNode.gain.value = isDeafened ? 0 : (initialVolume / 100);
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);

        remoteGainNodes[peerId] = gainNode;
        refreshDemoAudioGains();
    } catch (e) {
        console.error('[Ошибка] Звук демонстрации:', e);
    }
}

// Определяет, чей video-wrapper сейчас на полном экране (или null, если никто)
function getFullscreenPeerId() {
    const el = document.fullscreenElement;
    if (!el || !el.id || !el.id.startsWith('video-')) return null;
    return el.id.slice('video-'.length);
}

// Громкость звука демонстрации у каждого собеседника управляется ползунком
// (см. setupDemoVolumeControl) и запоминается в demoVolumes — раньше звук
// демки был слышен только в полноэкранном режиме, теперь он всегда играет
// с той громкостью, которую выставил слушатель (по умолчанию 100%).
// Дефен по-прежнему полностью глушит всё входящее аудио, включая демку.
function refreshDemoAudioGains() {
    Object.keys(remoteGainNodes).forEach(id => {
        if (!remoteGainNodes[id]) return;
        const volumePercent = demoVolumes[id] ?? 100;
        remoteGainNodes[id].gain.value = isDeafened ? 0 : (volumePercent / 100);
    });
}

// Вешает обработчики на кнопку-иконку громкости и слайдер конкретного участника:
// клик по иконке открывает/закрывает всплывающий ползунок, а перетаскивание
// слайдера сразу меняет громкость его демонстрации через gain-узел (без влияния
// на то, что слышат остальные, и без изменения громкости его микрофона).
function setupDemoVolumeControl(peerId) {
    const btn = document.getElementById(`demo-vol-btn-${peerId}`);
    const popup = document.getElementById(`demo-vol-popup-${peerId}`);
    const slider = document.getElementById(`demo-vol-slider-${peerId}`);
    const valueLabel = document.getElementById(`demo-vol-value-${peerId}`);
    if (!btn || !popup || !slider) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = popup.classList.toggle('show');
        btn.classList.toggle('popup-open', isOpen);
    });

    slider.addEventListener('input', (e) => {
        e.stopPropagation();
        const percent = parseInt(e.target.value, 10);
        demoVolumes[peerId] = percent;
        if (valueLabel) valueLabel.innerText = `${percent}%`;
        if (remoteGainNodes[peerId]) {
            remoteGainNodes[peerId].gain.value = isDeafened ? 0 : (percent / 100);
        }
        saveDemoVolumes();
    });

    // Клик по слайдеру/попапу не должен закрывать его и не должен запускать
    // фулскрин (клик по видео-обёртке используется под другие действия).
    popup.addEventListener('click', (e) => e.stopPropagation());

    // Закрываем попап при клике вне его.
    document.addEventListener('click', (e) => {
        if (!popup.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
            popup.classList.remove('show');
            btn.classList.remove('popup-open');
        }
    });
}

// Основной путь: узел сам шлёт готовое значение в дБ через порт — никакого собственного
// опроса на главном потоке.
function processRemoteAudioLevel(peerId, node) {
    const localNode = node;
    let avatarElem = document.getElementById(`avatar-${peerId}`);
    let lastIsSpeaking = null;

    localNode.port.onmessage = (event) => {
        if (remoteAnalysers[peerId] !== localNode) {
            localNode.port.onmessage = null;
            return;
        }
        const volumeDb = event.data;
        const isSpeaking = volumeDb > gateThreshold && !isDeafened;

        if (isSpeaking !== lastIsSpeaking) {
            lastIsSpeaking = isSpeaking;
            if (!avatarElem || !avatarElem.isConnected) avatarElem = document.getElementById(`avatar-${peerId}`);
            if (avatarElem) avatarElem.classList.toggle('speaking', isSpeaking);
        }
    };
}

// Запасной путь — используется только если AudioWorklet недоступен в этом браузере/
// контексте. Прежний способ: опрос AnalyserNode из setInterval.
function processRemoteAudioLevelFallback(peerId, node) {
    const analyser = node;
    const dataArray = new Float32Array(analyser.fftSize);

    let avatarElem = document.getElementById(`avatar-${peerId}`);
    let lastIsSpeaking = null;

    const intervalId = setInterval(checkRemote, 50);

    function checkRemote() {
        if (remoteAnalysers[peerId] !== analyser) {
            clearInterval(intervalId);
            return;
        }
        let volumeDb = getRmsDb(analyser, dataArray);
        const isSpeaking = volumeDb > gateThreshold && !isDeafened;

        if (isSpeaking !== lastIsSpeaking) {
            lastIsSpeaking = isSpeaking;
            if (!avatarElem || !avatarElem.isConnected) avatarElem = document.getElementById(`avatar-${peerId}`);
            if (avatarElem) avatarElem.classList.toggle('speaking', isSpeaking);
        }
    }
    checkRemote();
}

function selectRoomButton(btn) {
    const roomName = btn.getAttribute('data-room');
    const displayName = btn.getAttribute('data-display-name') || roomName;
    roomButtons.forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.custom-room-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const roomChanged = selectedRoom !== roomName;
    selectedRoom = roomName;

    if (currentUser.room === roomName) {
        connectRoomBtn.innerText = 'Покинуть ГС';
        connectRoomBtn.className = 'btn-primary btn-danger';
        roomTitle.innerText = `Канал: ${displayName}`;
    } else {
        connectRoomBtn.innerText = 'Подключиться';
        connectRoomBtn.className = 'btn-primary';
        roomTitle.innerText = `Канал: ${displayName} (Просмотр)`;
    }
    connectRoomBtn.style.display = 'inline-block';
    socket.emit('get room users', roomName);

    // Чат — свой для каждого сервера. Переключаем его только если реально сменили комнату,
    // чтобы повторный клик (открывающий настройки сервера) не дёргал историю чата заново.
    if (roomChanged) {
        setChatEnabled(true);
        closeMentionAutocomplete();
        socket.emit('select chat room', { room: roomName });
        // Список участников для автодополнения @упоминаний — сервер и так пришлёт его
        // сам через ~250 мс после 'select chat room', но запрашиваем явно, чтобы
        // подсказки были готовы, даже если человек начнёт печатать "@" сразу же.
        const mentionCode = customCodeFromRoomName(roomName);
        if (mentionCode) socket.emit('get server members', { code: mentionCode });
    }
}

roomButtons.forEach(btn => btn.addEventListener('click', () => selectRoomButton(btn)));

function connectToSelectedRoom() {
    if (!selectedRoom) return;

    if (currentUser.room === selectedRoom) {
        leaveVoiceChannel();
        return;
    }

    if (currentUser.room) leaveVoiceChannel();
    currentUser.room = selectedRoom;
    const activeBtn = document.querySelector(`[data-room="${CSS.escape(selectedRoom)}"]`);
    const displayName = activeBtn?.getAttribute('data-display-name') || selectedRoom;
    roomNameDisplay.innerHTML = `${ROOM_IN_ICON_SVG}<span>${escapeHtml(displayName)}</span>`;
    roomTitle.innerText = `Канал: ${displayName}`;
    connectRoomBtn.innerText = 'Покинуть ГС';
    connectRoomBtn.className = 'btn-primary btn-danger';
    screenBtn.disabled = false;
    screenBtn.title = '';

    socket.emit('join room', { room: selectedRoom, peerId: myPeerId, micMuted: isMuted, deafened: isDeafened });
    if (audioContext && audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    playJoinSound();
    broadcastMuteState();
}

connectRoomBtn.addEventListener('click', connectToSelectedRoom);

function openModal(modal) { if (modal) modal.style.display = 'flex'; }
function closeModal(modal) { if (modal) modal.style.display = 'none'; }
function showServerError(el, text) {
    if (!el) return;
    el.innerText = text || '';
    el.style.display = text ? 'block' : 'none';
}

// ---------- Окно «Добавить сервер»: вкладки «Создать» / «Войти по коду» ----------
const serverAddTabButtons = document.querySelectorAll('#server-add-tabs .settings-tab');
const serverAddTabPanels = document.querySelectorAll('#server-add-modal .settings-tab-panel');
let currentServerAddTab = 'create';
function switchServerAddTab(tabName) {
    currentServerAddTab = tabName;
    serverAddTabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.addTab === tabName));
    serverAddTabPanels.forEach(panel => panel.classList.toggle('active', panel.dataset.addTabPanel === tabName));
    showServerError(createServerError, '');
    showServerError(joinServerError, '');
    // Фокус на первом поле нужной вкладки — можно сразу печатать
    setTimeout(() => (tabName === 'join' ? joinServerCode : createServerName)?.focus(), 0);
}
serverAddTabButtons.forEach(btn => btn.addEventListener('click', () => switchServerAddTab(btn.dataset.addTab)));

function openServerAddModal(tabName = 'create') {
    createServerName.value = '';
    createServerPassword.value = '';
    createServerAvatarUrl.value = '';
    createServerAvatarFile.value = '';
    pendingCreateServerAvatarFile = null;
    createServerAvatarPreview.src = '';
    joinServerCode.value = '';
    joinServerPassword.value = '';
    openModal(serverAddModal);
    switchServerAddTab(tabName);
}

addServerBtn?.addEventListener('click', () => openServerAddModal('create'));
document.getElementById('close-server-add')?.addEventListener('click', () => closeModal(serverAddModal));

// Enter в полях — отправить форму текущей вкладки
[createServerName, createServerPassword].forEach(el => el?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('create-server-submit')?.click();
}));
[joinServerCode, joinServerPassword].forEach(el => el?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('join-server-submit')?.click();
}));
// Escape закрывает окно
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && serverAddModal.style.display === 'flex') closeModal(serverAddModal);
});

document.getElementById('close-created-server')?.addEventListener('click', () => closeModal(serverCreatedModal));

socket.on('custom rooms list', (rooms) => {
    if (!Array.isArray(rooms)) return;
    customServersList.innerHTML = '';
    for (const room of rooms) {
        addCustomServerButton(room);
        addMyServerCode(room.code); // запоминаем и локально — список с сервера общий для устройств
    }
    // Пересборка списка не должна сбрасывать подсветку открытого сервера
    if (selectedRoom) {
        const sel = customServersList.querySelector(`[data-room="${CSS.escape(selectedRoom)}"]`);
        if (sel) sel.classList.add('active');
    }
});

function addCustomServerButton(data) {
    if (!customServersList || !data?.code) return;
    const old = customServersList.querySelector(`[data-room="custom:${data.code}"]`);
    if (old) old.remove();
    const btn = document.createElement('div');
    btn.className = 'server-icon custom-server-icon custom-room-btn';
    btn.dataset.room = `custom:${data.code}`;
    btn.dataset.displayName = data.name || data.code;
    btn.dataset.avatar = data.avatar || '';
    btn.title = `${data.name || 'Сервер'}\nКод: ${data.code}`;
    if (data.avatar) {
        btn.style.backgroundImage = `url('${data.avatar}')`;
        btn.style.backgroundSize = 'cover';
        btn.style.backgroundPosition = 'center';
    } else {
        btn.innerText = (data.name || data.code).slice(0, 2).toUpperCase();
    }
    if (data.hasPassword) {
        const lock = document.createElement('span');
        lock.className = 'lock-dot';
        lock.innerText = '🔒';
        btn.appendChild(lock);
    }
    btn.addEventListener('click', () => {
        // Первый клик — просто заходим на сервер (выбираем канал), как в обычные комнаты.
        // Настройки/код открываются только вторым кликом — когда сервер уже выбран.
        if (selectedRoom === btn.getAttribute('data-room')) {
            openServerInfo(data.code);
        } else {
            selectRoomButton(btn);
        }
    });
    customServersList.appendChild(btn);
    return btn;
}

// ---------- Логика окна сервера (просмотр/редактирование) ----------
function openServerInfo(code) {
    showServerError(serverInfoError, '');
    socket.emit('get custom room info', { code });
}

socket.on('custom room info', (data) => {
    if (!data || !data.code) return;
    currentServerInfo = data;
    currentServerInfoRemovePassword = false;
    pendingServerInfoAvatarFile = null;
    serverInfoAvatarFile.value = '';
    showServerError(serverInfoError, '');
    showServerError(serverMembersError, '');

    serverInfoTitle.innerText = data.isOwner ? 'Управление сервером' : 'Сервер';
    serverInfoCode.innerText = data.code;

    // Вкладка "Участники" теперь видна всем, кто открыл сервер — кнопки
    // "Выгнать"/"Повысить" в ней всё равно показываются только создателю и
    // модераторам (см. renderServerMembers).
    if (serverInfoTabs) serverInfoTabs.style.display = 'flex';
    if (serverMembersListEl) serverMembersListEl.innerHTML = '';
    if (serverMembersEmpty) serverMembersEmpty.style.display = 'none';
    switchServerInfoTab('general');
    socket.emit('get server members', { code: data.code });

    if (data.isOwner) {
        serverInfoOwnerView.style.display = 'flex';
        serverInfoGuestView.style.display = 'none';
        serverInfoSaveBtn.style.display = 'block';
        serverInfoDeleteBtn.style.display = 'block';
        serverInfoLeaveBtn.style.display = 'none';
        serverInfoPassword.placeholder = 'Пароль';
        serverInfoName.value = data.name || '';
        serverInfoAvatarUrl.value = data.avatar || '';
        serverInfoAvatarPreview.src = data.avatar || '';
        serverInfoPassword.value = '';
        serverInfoRemovePasswordBtn.style.display = data.hasPassword ? 'block' : 'none';
    } else {
        serverInfoOwnerView.style.display = 'none';
        serverInfoGuestView.style.display = 'flex';
        serverInfoSaveBtn.style.display = 'none';
        serverInfoDeleteBtn.style.display = 'none';
        serverInfoLeaveBtn.style.display = 'block';
        serverInfoNameGuest.innerText = data.name || data.code;
        serverInfoAvatarPreviewGuest.src = data.avatar || '';
    }

    openModal(serverInfoModal);
});

serverInfoRemovePasswordBtn?.addEventListener('click', () => {
    currentServerInfoRemovePassword = true;
    serverInfoPassword.value = '';
    serverInfoPassword.placeholder = 'Пароль будет удалён';
    serverInfoRemovePasswordBtn.style.display = 'none';
});

document.getElementById('server-info-delete')?.addEventListener('click', () => {
    if (!currentServerInfo) return;
    const sure = confirm(`Удалить сервер «${currentServerInfo.name || currentServerInfo.code}» навсегда? Это действие необратимо, все участники потеряют к нему доступ.`);
    if (!sure) return;
    socket.emit('delete custom room', { code: currentServerInfo.code });
});

document.getElementById('server-info-leave')?.addEventListener('click', () => {
    if (!currentServerInfo) return;
    const btn = customServersList.querySelector(`[data-room="custom:${currentServerInfo.code}"]`);
    if (btn) btn.remove();
    removeMyServerCode(currentServerInfo.code);
    socket.emit('leave custom room', { code: currentServerInfo.code });
    closeModal(serverInfoModal);
});

serverInfoSaveBtn?.addEventListener('click', async () => {
    if (!currentServerInfo) return;
    showServerError(serverInfoError, '');
    const name = serverInfoName.value.trim();
    if (name.length < 2) return showServerError(serverInfoError, 'Введите название сервера.');

    serverInfoSaveBtn.disabled = true;
    serverInfoSaveBtn.innerText = 'Сохранение...';
    try {
        const avatar = await resolveServerAvatarUpload(pendingServerInfoAvatarFile, serverInfoAvatarUrl.value);
        socket.emit('update custom room', {
            code: currentServerInfo.code,
            name,
            avatar,
            password: serverInfoPassword.value,
            removePassword: currentServerInfoRemovePassword
        });
    } catch (err) {
        showServerError(serverInfoError, err.message || 'Не удалось загрузить фото сервера.');
        serverInfoSaveBtn.disabled = false;
        serverInfoSaveBtn.innerText = 'Сохранить изменения';
    }
});

socket.on('custom room updated', (data) => {
    if (!data || !data.code) return;
    // Обновляем иконку, только если этот сервер уже есть у нас в списке — иначе
    // чужое редактирование сервера, которым мы не пользуемся, не должно "подсовывать"
    // его нам в сайдбар.
    const existing = customServersList.querySelector(`[data-room="custom:${data.code}"]`);
    if (existing) addCustomServerButton(data);
    if (currentServerInfo && currentServerInfo.code === data.code) {
        serverInfoSaveBtn.disabled = false;
        serverInfoSaveBtn.innerText = 'Сохранить изменения';
        closeModal(serverInfoModal);
    }
});

socket.on('custom room deleted', ({ code } = {}) => {
    if (!code) return;
    const btn = customServersList.querySelector(`[data-room="custom:${code}"]`);
    if (btn) btn.remove();
    removeMyServerCode(code);
    if (currentServerInfo && currentServerInfo.code === code) {
        closeModal(serverInfoModal);
    }
});

document.getElementById('close-server-info')?.addEventListener('click', () => closeModal(serverInfoModal));

serverInfoCode?.addEventListener('click', async () => {
    const code = serverInfoCode.innerText.trim();
    if (!code) return;
    try {
        await navigator.clipboard.writeText(code);
        const old = serverInfoCode.innerText;
        serverInfoCode.innerText = 'СКОПИРОВАНО!';
        setTimeout(() => { serverInfoCode.innerText = old; }, 900);
    } catch (_) {
        const area = document.createElement('textarea');
        area.value = code;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
    }
});

document.getElementById('create-server-submit')?.addEventListener('click', async () => {
    showServerError(createServerError, '');
    const name = createServerName.value.trim();
    if (name.length < 2) return showServerError(createServerError, 'Введите название сервера.');

    const submitBtn = document.getElementById('create-server-submit');
    submitBtn.disabled = true;
    submitBtn.innerText = 'Создание...';
    try {
        const avatar = await resolveServerAvatarUpload(pendingCreateServerAvatarFile, createServerAvatarUrl.value);
        socket.emit('create custom room', { name, password: createServerPassword.value, avatar });
    } catch (err) {
        showServerError(createServerError, err.message || 'Не удалось загрузить фото сервера.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Создать';
    }
});

document.getElementById('join-server-submit')?.addEventListener('click', () => {
    showServerError(joinServerError, '');
    const code = joinServerCode.value.trim().toUpperCase();
    if (code.length !== 6) return showServerError(joinServerError, 'Код должен содержать 6 символов.');
    socket.emit('join custom room', { code, password: joinServerPassword.value });
});

joinServerCode?.addEventListener('input', () => {
    joinServerCode.value = joinServerCode.value.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();
});

createdServerCode?.addEventListener('click', async () => {
    const code = createdServerCode.innerText.trim();
    if (!code) return;
    try {
        await navigator.clipboard.writeText(code);
        const old = createdServerCode.innerText;
        createdServerCode.innerText = 'СКОПИРОВАНО!';
        setTimeout(() => { createdServerCode.innerText = old; }, 900);
    } catch (_) {
        const area = document.createElement('textarea');
        area.value = code;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
    }
});

document.getElementById('join-created-server')?.addEventListener('click', () => {
    if (!lastCreatedServer) return;
    closeModal(serverCreatedModal);
    const btn = addCustomServerButton(lastCreatedServer);
    selectRoomButton(btn);
    connectToSelectedRoom();
});

socket.on('custom room created', (data) => {
    lastCreatedServer = data;
    addMyServerCode(data.code);
    addCustomServerButton(data);
    closeModal(serverAddModal);
    createdServerName.innerText = data.name;
    createdServerCode.innerText = data.code;
    openModal(serverCreatedModal);
});

socket.on('custom room joined', (data) => {
    addMyServerCode(data.code);
    closeModal(serverAddModal);
    const btn = addCustomServerButton(data);
    selectRoomButton(btn);
    connectToSelectedRoom();
});

socket.on('custom room error', (message) => {
    let target = createServerError;
    if (serverInfoModal.style.display === 'flex') {
        // Ошибки кика/повышения относятся к вкладке "Участники" — показываем их там,
        // а не в скрытой в этот момент вкладке "Настройки".
        const membersTabActive = document.querySelector('#server-info-tabs .settings-tab[data-server-tab="members"]')?.classList.contains('active');
        target = membersTabActive ? serverMembersError : serverInfoError;
        serverInfoSaveBtn.disabled = false;
        serverInfoSaveBtn.innerText = 'Сохранить изменения';
    } else if (serverAddModal.style.display === 'flex') {
        target = currentServerAddTab === 'join' ? joinServerError : createServerError;
    }
    showServerError(target, message);
});

function leaveVoiceChannel() {
    if (activeVideoStream) {
        stopVideoStream();
    }
    cleanupCalls();
    socket.emit('leave voice');

    // Звук собственного выхода из комнаты
    playLeaveSound();
    currentUser.room = null;
    roomTitle.innerText = `Канал: ${selectedRoom} (Просмотр)`;
    roomNameDisplay.innerHTML = `${ROOM_OUT_ICON_SVG}<span>Вы не в звонке</span>`;
    connectRoomBtn.innerText = 'Подключиться';
    connectRoomBtn.className = 'btn-primary';
    screenBtn.disabled = true;
    screenBtn.title = 'Сначала подключитесь к голосовому каналу';
    connectedUsers = {};
    updateVoiceUsersList();
    socket.emit('get room users', selectedRoom);
}

function cleanupCalls() {
    for (const peerId in activeCalls) {
        try { activeCalls[peerId].close(); } catch (e) {}
        cleanupRemoteAudio(peerId);
    }
    activeCalls = {};
    remoteStreamsByPeer = {};
    sharingPeers.clear();
    remoteVideos.innerHTML = '';
}

socket.on('room users', (usersInRoom, room) => {
    // Сервер шлёт список и участникам канала, и тем, кто просто смотрит сервер (см. broadcastRoomUsers).
    // `room` — какой именно канал обновился: обновления чужих каналов игнорируем.
    const inVoiceRoom = room ? room === currentUser.room : currentUser.room === selectedRoom;
    if (room && !inVoiceRoom && room !== selectedRoom) return;

    if (!inVoiceRoom) {
        // Только смотрим канал (в звонке нас в нём нет) — просто перерисовываем список.
        // Если мы сидим в голосе другого канала, его состояние (connectedUsers) не трогаем.
        if (!currentUser.room) connectedUsers = usersInRoom;
        updateVoiceUsersList(usersInRoom);
        return;
    }

    connectedUsers = usersInRoom;

    for (let peerId in usersInRoom) {
        if (usersInRoom[peerId] && usersInRoom[peerId].sharing) {
            sharingPeers.add(peerId);
        } else {
            sharingPeers.delete(peerId);
        }
    }

    // Раньше здесь полностью перезаписывалась своя запись без micMuted/deafened —
    // из-за этого свой же значок мьюта "слетал" каждый раз, когда кто угодно
    // заходил в канал или выходил из него (сервер рассылает 'room users' всем).
    // Состояние мьюта/дефена у нас уже есть локально (isMuted/isDeafened) — берём его оттуда.
    connectedUsers[myPeerId] = {
        username: currentUser.username,
        avatar: currentUser.avatar,
        micMuted: isMuted,
        deafened: isDeafened
    };
    // Список рисуем, только если сейчас открыт именно этот канал (иначе смотрим другой).
    if (!room || room === selectedRoom) updateVoiceUsersList();

    for (let peerId in usersInRoom) {
        // ВАЖНО: раньше звонок инициировали ОБЕ стороны одновременно (каждый, у кого
        // ещё нет activeCalls[peerId], звонит другому) — при входе/повторном входе в
        // канал это почти всегда означало ДВЕ параллельные PeerJS-связи между одной
        // и той же парой людей. У обеих сторон они регистрировались под одним и тем
        // же ключом (peerId) в activeCalls, а звуковой <audio>-элемент и узлы
        // анализатора/громкости тоже общие по id. Когда позже закрывалась "лишняя"
        // (более старая/более медленная) из двух связей, её обработчик 'close' удалял
        // этот общий <audio>-элемент и узлы — даже если ВТОРАЯ, актуальная связь
        // всё ещё была жива и по ней продолжали идти данные. Из-за этого после
        // выхода и повторного захода в канал человека переставали слышать без
        // видимой ошибки. Теперь звонок инициирует только одна сторона —
        // детерминированно, по сравнению peerId — а вторая всегда просто отвечает
        // через myPeer.on('call'), так что на каждую пару гарантированно ровно одна
        // связь.
        if (peerId !== myPeerId && !activeCalls[peerId] && myPeerId < peerId) {
            const call = myPeer.call(peerId, localMediaStream, {
                metadata: { username: currentUser.username, avatar: currentUser.avatar }
            });
            handleIncomingCall(call);
        }
        renderRemoteVideoState(peerId);
    }
});

// Кто-то другой включил/выключил мьют или дефен — обновляем его значки и
// проигрываем соответствующий сигнал (тот же, что слышит сам переключивший),
// чтобы это было слышно всем участникам комнаты, а не только ему одному.
socket.on('mute state', ({ peerId, micMuted, deafened }) => {
    if (!connectedUsers[peerId]) connectedUsers[peerId] = {};
    const prevMicMuted = !!connectedUsers[peerId].micMuted;
    const prevDeafened = !!connectedUsers[peerId].deafened;

    connectedUsers[peerId].micMuted = micMuted;
    connectedUsers[peerId].deafened = deafened;
    setUserStatusBadges(peerId, micMuted, deafened);

    if (deafened !== prevDeafened) {
        playDeafenSound();
    } else if (micMuted !== prevMicMuted) {
        playMuteSound();
    }
});

// Кто-то другой включил/выключил демонстрацию экрана — обновляем видео-плитку
// и проигрываем сигнал демонстрации, слышный всем участникам комнаты.
socket.on('video state', ({ peerId, sharing }) => {
    if (sharing) {
        sharingPeers.add(peerId);
    } else {
        sharingPeers.delete(peerId);
    }
    renderRemoteVideoState(peerId);
    playScreenShareSound();
});

function cleanupRemoteAudio(peerId) {
    const keepAlive = remoteAudioKeepAlive[peerId];
    if (keepAlive) {
        try { keepAlive.pause(); keepAlive.srcObject = null; keepAlive.remove(); } catch (e) {}
        delete remoteAudioKeepAlive[peerId];
    }
    const source = remoteAudioSources[peerId];
    if (source) { try { source.disconnect(); } catch (e) {} }
    delete remoteAudioSources[peerId];

    const demoSource = remoteDemoAudioSources[peerId];
    if (demoSource) { try { demoSource.disconnect(); } catch (e) {} }
    delete remoteDemoAudioSources[peerId];

    const analyser = remoteAnalysers[peerId];
    if (analyser) {
        if (analyser.port) { try { analyser.port.onmessage = null; } catch (e) {} }
        try { analyser.disconnect(); } catch (e) {}
    }
    delete remoteAnalysers[peerId];

    const gain = remoteGainNodes[peerId];
    if (gain) { try { gain.disconnect(); } catch (e) {} }
    delete remoteGainNodes[peerId];

    const voiceGain = remoteVoiceGainNodes[peerId];
    if (voiceGain) { try { voiceGain.disconnect(); } catch (e) {} }
    delete remoteVoiceGainNodes[peerId];
}

// Скрытые <audio>-элементы для входящих потоков. Chromium/WebView2 отдаёт в Web Audio
// (createMediaStreamSource) ТИШИНУ для удалённого WebRTC-потока, пока этот поток не
// подключён к какому-нибудь медиа-элементу. Из-за этого собеседника не было слышно, а
// индикатор "говорит" (он считается по тому же аудиографу) не загорался. Элемент заглушён
// (muted) — реальный звук по-прежнему идёт через gain-узлы, чтобы работали громкость и дефен.
const remoteAudioKeepAlive = {};

function attachRemoteStream(stream, peerId) {
    let el = remoteAudioKeepAlive[peerId];
    if (!el) {
        el = document.createElement('audio');
        el.autoplay = true;
        el.muted = true;
        el.setAttribute('playsinline', '');
        el.style.display = 'none';
        document.body.appendChild(el);
        remoteAudioKeepAlive[peerId] = el;
    }
    if (el.srcObject !== stream) el.srcObject = stream;
    el.play().catch(() => { /* автозапуск заглушённого элемента обычно разрешён */ });

    if (audioContext && audioContext.state === 'suspended') audioContext.resume().catch(() => {});

    // Событие 'stream' PeerJS может прийти несколько раз (по разу на трек), поэтому
    // каждый узел создаём только один раз — иначе звук удваивался бы.
    const tracks = stream.getAudioTracks();
    if (tracks[0] && !remoteAudioSources[peerId]) setupRemoteAudioAnalyzer(stream, peerId);
    if (tracks[1] && !remoteDemoAudioSources[peerId]) setupRemoteDemoAudio(stream, peerId);
}

function handleIncomingCall(call) {
    if (call.peer === myPeerId) return;
    activeCalls[call.peer] = call;

    call.on('stream', (remoteStream) => {
        const prev = remoteStreamsByPeer[call.peer];
        if (prev && prev !== remoteStream) cleanupRemoteAudio(call.peer);
        remoteStreamsByPeer[call.peer] = remoteStream;

        attachRemoteStream(remoteStream, call.peer);
        // Второй аудиотрек (звук демонстрации) может добавиться позже первого события.
        if (!remoteStream.__muteTrackWatch) {
            remoteStream.__muteTrackWatch = true;
            remoteStream.addEventListener('addtrack', () => attachRemoteStream(remoteStream, call.peer));
        }
        renderRemoteVideoState(call.peer);
    });

    call.on('close', () => {
        const wrap = document.getElementById(`video-${call.peer}`);
        if (wrap) wrap.remove();
        delete activeCalls[call.peer];
        cleanupRemoteAudio(call.peer);
        delete remoteStreamsByPeer[call.peer];
        sharingPeers.delete(call.peer);
    });
}

// Показывает или скрывает видео-плитку конкретного участника в зависимости от того,
// шарит ли он сейчас (sharingPeers), не завязываясь на факт наличия видеотрека
// в потоке — он присутствует всегда (либо реальный, либо чёрная заглушка).
function renderRemoteVideoState(peerId) {
    const remoteStream = remoteStreamsByPeer[peerId];
    let wrap = document.getElementById(`video-${peerId}`);

    if (!remoteStream || !sharingPeers.has(peerId)) {
        if (wrap) wrap.remove();
        return;
    }

    const userInfo = connectedUsers[peerId] || { username: 'Участник' };

    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = `video-${peerId}`;
        wrap.className = 'video-wrapper fade-in';
        wrap.innerHTML = `
            <span class="video-username" style="color:${getUserColor(userInfo.username)}">${userInfo.username}</span>
            <button class="fullscreen-btn" onclick="toggleFullscreen(this)">На весь экран</button>
            <button class="demo-volume-btn" id="demo-vol-btn-${peerId}" title="Громкость демонстрации">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
            </button>
            <div class="demo-volume-popup" id="demo-vol-popup-${peerId}">
                <span>Громкость демки: <span id="demo-vol-value-${peerId}">${demoVolumes[peerId] ?? 100}%</span></span>
                <input type="range" id="demo-vol-slider-${peerId}" min="0" max="150" step="5" value="${demoVolumes[peerId] ?? 100}">
            </div>
            <video autoplay playsinline></video>
        `;
        remoteVideos.appendChild(wrap);
        setupDemoVolumeControl(peerId);
    } else {
        const nameSpan = wrap.querySelector('.video-username');
        if (nameSpan) {
            nameSpan.innerText = userInfo.username;
            nameSpan.style.color = getUserColor(userInfo.username);
        }
    }

    const videoEl = wrap.querySelector('video');
    if (videoEl.srcObject !== remoteStream) {
        videoEl.srcObject = remoteStream;
        videoEl.play().catch(err => console.log("[Внимание] Автоплей заблокирован:", err));
    }
}

socket.on('user connected', ({ username, avatar, peerId }) => {
    const isNewcomer = !connectedUsers[peerId];
    // Раньше здесь запись полностью перезаписывалась заново собранным объектом
    // без micMuted/deafened — а событие 'room users' (с уже верным статусом мута)
    // приходит непосредственно ПЕРЕД этим событием, и его тут же затирало.
    // Из-за этого человек, зашедший в канал уже в муте, первое время (а то и
    // насовсем, если никто больше не переключал мьют) отображался как НЕ в муте.
    // Теперь просто дополняем существующую запись, а не заменяем её целиком.
    const prev = connectedUsers[peerId] || {};
    connectedUsers[peerId] = { ...prev, username, avatar };
    if (currentUser.room === selectedRoom) updateVoiceUsersList();

    // Звук входа — только если мы сами сейчас в голосовом канале и зашёл не мы сами
    if (isNewcomer && peerId !== myPeerId && currentUser.room) {
        playJoinSound();
    }
});

socket.on('user disconnected', (peerId) => {
    const wasPresent = !!connectedUsers[peerId];
    delete connectedUsers[peerId];
    cleanupRemoteAudio(peerId);
    delete remoteStreamsByPeer[peerId];
    sharingPeers.delete(peerId);
    if (currentUser.room === selectedRoom) updateVoiceUsersList();

    // Звук выхода — только если мы сами сейчас в голосовом канале
    if (wasPresent && peerId !== myPeerId && currentUser.room) {
        playLeaveSound();
    }

    if (activeCalls[peerId]) {
        activeCalls[peerId].close();
        delete activeCalls[peerId];
    }
    const el = document.getElementById(`video-${peerId}`);
    if (el) el.remove();
});

// Иконки для значков статуса — те же, что и на самих кнопках mute/deafen
const MIC_OFF_ICON_SVG = `<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="2" width="6" height="12" rx="3"></rect>
    <path d="M5 10a7 7 0 0 0 14 0"></path>
    <line x1="12" y1="19" x2="12" y2="22"></line>
    <line x1="8" y1="22" x2="16" y2="22"></line>
    <line x1="3" y1="3" x2="21" y2="21"></line>
</svg>`;

const DEAFEN_OFF_ICON_SVG = `<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 14v-2a8 8 0 0 1 16 0v2"></path>
    <rect x="2" y="14" width="5" height="7" rx="2"></rect>
    <rect x="17" y="14" width="5" height="7" rx="2"></rect>
    <line x1="3" y1="3" x2="21" y2="21"></line>
</svg>`;

// Иконки для индикатора "в каком канале мы сейчас находимся" (замена эмодзи 🔊)
const ROOM_IN_ICON_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`;
const ROOM_OUT_ICON_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;

// Настройка «показывать всех участников сервера» (Кастомизация → Список участников).
// Хранится на этом устройстве.

function buildOffCallRows(users) {
    const code = customCodeFromRoomName(selectedRoom);
    if (!code) return [];
    const members = mentionMembersCache[code];
    if (!members || !members.length) return [];

    const inCall = new Set(Object.values(users || {})
        .map(u => String(u && u.username || '').toLowerCase())
        .filter(Boolean));
    const rest = members.filter(m => m && m.username && !inCall.has(m.username.toLowerCase()));
    rest.sort((a, b) => {
        if (!!a.online !== !!b.online) return a.online ? -1 : 1;
        return a.username.localeCompare(b.username, 'ru');
    });

    return rest.map(m => {
        const row = document.createElement('div');
        row.className = 'voice-user-row offcall' + (m.online ? '' : ' offline');
        row.innerHTML = `
            <div class="user-avatar-wrap">
                <img src="${m.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(m.username)}`}" class="user-avatar" alt="">
                <span class="presence-dot${m.online ? ' online' : ''}" title="${m.online ? 'В сети' : 'Не в сети'}"></span>
            </div>
            <span class="voice-user-name" title="${escapeHtml(m.username)}" style="color:${getUserColor(m.username)}">${escapeHtml(m.username)}</span>
            <span class="offcall-sub">${m.online ? 'в сети' : 'не в сети'}</span>
        `;
        return row;
    });
}

function updateVoiceUsersList(users = connectedUsers) {
    lastRenderedVoiceUsers = users;
    voiceUsersContainer.innerHTML = '';
    for (let id in users) {
        let user = users[id];
        let row = document.createElement('div');
        row.className = 'voice-user-row';
        row.innerHTML = `
            <div class="user-avatar-wrap">
                <img src="${user.avatar || 'https://api.dicebear.com/7.x/identicon/svg?seed=def'}" class="user-avatar" id="avatar-${id}" alt="">
                <span class="status-badge mic-mute-badge${(user.micMuted || user.deafened) ? ' visible' : ''}" id="mic-badge-${id}" title="Микрофон выключен">${MIC_OFF_ICON_SVG}</span>
                <span class="status-badge deafen-badge${user.deafened ? ' visible' : ''}" id="deafen-badge-${id}" title="Наушники выключены">${DEAFEN_OFF_ICON_SVG}</span>
            </div>
            <span class="voice-user-name" title="${escapeHtml(user.username || 'Участник')}" style="color:${getUserColor(user.username)}">${escapeHtml(user.username || 'Участник')}</span>
        `;
        // Громкость каждого собеседника можно менять только у себя — по клику на его
        // строку в списке. На себя самого это не вешаем (собственную громкость менять
        // не через что — её регулирует "Громкость своего микрофона" в настройках).
        if (id !== myPeerId) {
            row.classList.add('clickable');
            row.title = 'Нажать, чтобы изменить громкость только для себя';
            row.addEventListener('click', () => openUserVolumePopover(id, row, user.username || 'Участник'));
        }
        voiceUsersContainer.appendChild(row);
    }

    // Остальные участники сервера — в том же списке, ниже тех, кто в звонке.
    if (showOffCallMembers) {
        const offRows = buildOffCallRows(users);
        if (offRows.length) {
            const divider = document.createElement('div');
            divider.className = 'voice-offcall-divider';
            divider.textContent = `Не в звонке — ${offRows.length}`;
            voiceUsersContainer.appendChild(divider);
            offRows.forEach(r => voiceUsersContainer.appendChild(r));
        }
    }
}

// Переключатель в настройках кастомизации
(function initOffCallMembersSetting() {
    const check = document.getElementById('show-offcall-members-check');
    if (!check) return;
    check.checked = showOffCallMembers;
    check.addEventListener('change', () => {
        showOffCallMembers = check.checked;
        try { localStorage.setItem(SHOW_OFFCALL_KEY, showOffCallMembers ? '1' : '0'); } catch (e) { /* ignore */ }
        const code = customCodeFromRoomName(selectedRoom);
        if (showOffCallMembers && code) socket.emit('get server members', { code });
        updateVoiceUsersList(lastRenderedVoiceUsers);
    });
})();

// ---------- Попап громкости конкретного собеседника (только локально, у себя) ----------
function closeUserVolumePopover() {
    const existing = document.getElementById('user-volume-popover');
    if (existing) existing.remove();
    document.removeEventListener('mousedown', onDocMouseDownForVolumePopover, true);
}

function onDocMouseDownForVolumePopover(e) {
    const pop = document.getElementById('user-volume-popover');
    if (pop && !pop.contains(e.target)) closeUserVolumePopover();
}

function openUserVolumePopover(peerId, anchorEl, username) {
    closeUserVolumePopover();

    const percent = getRemoteVolumePercent(username);
    const pop = document.createElement('div');
    pop.id = 'user-volume-popover';
    pop.className = 'user-volume-popover fade-in';
    pop.innerHTML = `
        <div class="user-volume-popover-title">Громкость: <span style="color:${getUserColor(username)}">${escapeHtml(username)}</span></div>
        <input type="range" id="user-volume-range" min="0" max="200" step="5" value="${percent}">
        <div class="user-volume-popover-value">${percent}%</div>
        <span class="profile-hint">Меняется только у вас — собеседник об этом не узнает</span>
    `;
    document.body.appendChild(pop);

    const anchorRect = anchorEl.getBoundingClientRect();
    const popWidth = 220;
    pop.style.left = `${Math.max(8, Math.min(anchorRect.left, window.innerWidth - popWidth - 8))}px`;
    pop.style.top = `${Math.min(anchorRect.bottom + 6, window.innerHeight - 110)}px`;

    const rangeInput = pop.querySelector('#user-volume-range');
    const valueLabel = pop.querySelector('.user-volume-popover-value');
    rangeInput.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        valueLabel.innerText = `${val}%`;
        saveRemoteVolume(username, val);
        if (remoteVoiceGainNodes[peerId] && !isDeafened) {
            remoteVoiceGainNodes[peerId].gain.value = val / 100;
        }
    });
    rangeInput.addEventListener('click', (e) => e.stopPropagation());

    setTimeout(() => document.addEventListener('mousedown', onDocMouseDownForVolumePopover, true), 0);
}

// Обновляет значки конкретного участника без перерисовки всего списка.
// При дефене микрофон тоже фактически выключен, поэтому значок мьюта показываем и в этом случае.
function setUserStatusBadges(peerId, micMuted, deafened) {
    const micBadge = document.getElementById(`mic-badge-${peerId}`);
    if (micBadge) micBadge.classList.toggle('visible', !!micMuted || !!deafened);
    const deafenBadge = document.getElementById(`deafen-badge-${peerId}`);
    if (deafenBadge) deafenBadge.classList.toggle('visible', !!deafened);
}

let activeVideoStream = null;

screenBtn.addEventListener('click', () => {
    if (!currentUser.room) {
        alert('Сначала подключитесь к голосовому каналу');
        return;
    }
    if (!activeVideoStream) {
        streamSelectModal.style.display = 'flex';
    } else {
        stopVideoStream();
    }
});

closeStreamModal.addEventListener('click', () => {
    streamSelectModal.style.display = 'none';
});

shareScreenChoice.addEventListener('click', async () => {
    streamSelectModal.style.display = 'none';
    try {
        // Разрешение/FPS берутся из настроек (по умолчанию 720p/30 — компромисс с
        // нагрузкой на CPU; можно поднять вплоть до 1080p/60 в настройках видео).
        const preset = getScreenQualityPreset();
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.frameRate } },
            audio: true
        });
        startVideoStream(stream);
    } catch (e) { console.error(e); }
});

shareCamChoice.addEventListener('click', async () => {
    streamSelectModal.style.display = 'none';
    try {
        // То же самое: пресет из настроек видео (по умолчанию 720p/30, можно поднять до
        // 1080p/60).
        const preset = getCameraQualityPreset();
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.frameRate } },
            audio: false
        });
        startVideoStream(stream);
    } catch (e) { console.error(e); }
});

function startVideoStream(stream) {
    activeVideoStream = stream;
    showLocalVideo(activeVideoStream);

    const realTrack = activeVideoStream.getVideoTracks()[0];
    realTrack.onended = () => stopVideoStream();

    // Меняем в локальном потоке заглушку на реальный трек — это важно для тех,
    // кто присоединится к комнате ПОЗЖЕ: им звонок уйдёт уже с реальным видео.
    if (localMediaStream.getVideoTracks().includes(placeholderVideoTrack)) {
        localMediaStream.removeTrack(placeholderVideoTrack);
    }
    if (!localMediaStream.getVideoTracks().includes(realTrack)) {
        localMediaStream.addTrack(realTrack);
    }

    // А для тех, кто УЖЕ в звонке — просто подменяем трек в существующем
    // соединении, без его пересоздания.
    replaceVideoTrackForAllPeers(realTrack);

    // Если демонстрация экрана захвачена со звуком (системный аудиовывод) — передаём
    // его отдельным аудиотреком, подменяя тем же способом "слот" звука демонстрации.
    const demoAudioTrack = activeVideoStream.getAudioTracks()[0];
    if (demoAudioTrack) {
        demoAudioTrack.onended = () => {
            if (localMediaStream.getAudioTracks().includes(demoAudioTrack)) {
                localMediaStream.removeTrack(demoAudioTrack);
            }
            if (!localMediaStream.getAudioTracks().includes(placeholderDemoAudioTrack)) {
                localMediaStream.addTrack(placeholderDemoAudioTrack);
            }
            replaceDemoAudioTrackForAllPeers(placeholderDemoAudioTrack);
        };

        if (localMediaStream.getAudioTracks().includes(currentDemoAudioTrack)) {
            localMediaStream.removeTrack(currentDemoAudioTrack);
        }
        localMediaStream.addTrack(demoAudioTrack);
        replaceDemoAudioTrackForAllPeers(demoAudioTrack);
    }

    screenBtn.innerText = 'Остановить трансляцию';
    screenBtn.className = 'btn-primary btn-danger';

    playScreenShareSound();
    socket.emit('video state', { sharing: true });
}

function showLocalVideo(stream) {
    let wrap = document.getElementById('local-video-wrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'local-video-wrap';
        wrap.className = 'video-wrapper fade-in';
        wrap.innerHTML = `
            <span class="video-username" style="color:${getUserColor(currentUser.username)}">${currentUser.username} (Вы)</span>
            <button class="fullscreen-btn" onclick="toggleFullscreen(this)">На весь экран</button>
            <video autoplay muted playsinline></video>
        `;
        remoteVideos.prepend(wrap);
    }
    const videoEl = wrap.querySelector('video');
    videoEl.srcObject = stream;
}

function stopVideoStream() {
    if (activeVideoStream) {
        activeVideoStream.getTracks().forEach(t => t.stop());
        activeVideoStream.getVideoTracks().forEach(t => {
            if (localMediaStream.getVideoTracks().includes(t)) {
                localMediaStream.removeTrack(t);
            }
        });
        activeVideoStream.getAudioTracks().forEach(t => {
            if (localMediaStream.getAudioTracks().includes(t)) {
                localMediaStream.removeTrack(t);
            }
        });
    }
    activeVideoStream = null;

    if (!localMediaStream.getVideoTracks().includes(placeholderVideoTrack)) {
        localMediaStream.addTrack(placeholderVideoTrack);
    }
    if (!localMediaStream.getAudioTracks().includes(placeholderDemoAudioTrack)) {
        localMediaStream.addTrack(placeholderDemoAudioTrack);
    }

    replaceVideoTrackForAllPeers(placeholderVideoTrack);
    replaceDemoAudioTrackForAllPeers(placeholderDemoAudioTrack);

    const localWrap = document.getElementById('local-video-wrap');
    if (localWrap) localWrap.remove();

    screenBtn.innerText = 'Демонстрация / Вебка';
    screenBtn.className = 'btn-primary';

    playScreenShareSound();
    socket.emit('video state', { sharing: false });
}

function replaceVideoTrackForAllPeers(track) {
    for (let peerId in activeCalls) {
        const call = activeCalls[peerId];
        if (call && call.peerConnection) {
            const senders = call.peerConnection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                videoSender.replaceTrack(track).catch(err => console.warn('[Внимание] Ошибка замены видеотрека:', err));
            }
        }
    }
}

// Как и со звуком демонстрации: аудиотреков в соединении два (микрофон + демо),
// поэтому ищем сендер именно по ССЫЛКЕ на СТАРЫЙ трек микрофона, а не просто
// по kind === 'audio' — иначе можно случайно подменить звук демонстрации.
function replaceMicTrackForAllPeers(newTrack, oldTrack) {
    if (!oldTrack) return;
    for (let peerId in activeCalls) {
        const call = activeCalls[peerId];
        if (call && call.peerConnection) {
            const senders = call.peerConnection.getSenders();
            const micSender = senders.find(s => s.track === oldTrack);
            if (micSender) {
                micSender.replaceTrack(newTrack).catch(err => console.warn('[Внимание] Ошибка замены трека микрофона:', err));
            }
        }
    }
}

// В отличие от видео, аудиотреков в соединении два (микрофон + звук демонстрации),
// поэтому ищем сендер именно по ССЫЛКЕ на текущий трек в "слоте" демо-звука,
// а не просто по kind === 'audio' (иначе рискуем случайно подменить микрофон).
function replaceDemoAudioTrackForAllPeers(newTrack) {
    const previousTrack = currentDemoAudioTrack;
    for (let peerId in activeCalls) {
        const call = activeCalls[peerId];
        if (call && call.peerConnection) {
            const senders = call.peerConnection.getSenders();
            const demoSender = senders.find(s => s.track === previousTrack);
            if (demoSender) {
                demoSender.replaceTrack(newTrack).catch(err => console.warn('[Внимание] Ошибка замены звука демонстрации:', err));
            }
        }
    }
    currentDemoAudioTrack = newTrack;
}

settingsBtn.addEventListener('click', () => {
    profileUsernameInput.value = currentUser.username;
    profileAvatarUrlInput.value = currentUser.avatar;
    profileAvatarPreview.src = currentUser.avatar;
    pendingAvatarFile = null;
    switchSettingsTab('profile');
    settingsModal.style.display = 'flex';
});

// ---------- Вкладки в окне настроек ----------
// Запрос ограничен контейнером #settings-tabs/#settings-modal, а не всем документом —
// иначе он захватил бы и вкладки окна сервера ("Настройки"/"Участники"), которые
// используют те же CSS-классы для одинакового вида, но переключаются отдельно.
const settingsTabButtons = document.querySelectorAll('#settings-tabs .settings-tab');
const settingsTabPanels = document.querySelectorAll('#settings-modal .settings-tab-panel');
const settingsSectionTitle = document.getElementById('settings-section-title');
function switchSettingsTab(tabName) {
    settingsTabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
    settingsTabPanels.forEach(panel => panel.classList.toggle('active', panel.dataset.tabPanel === tabName));
    // Заголовок справа повторяет название выбранного раздела
    const activeBtn = Array.from(settingsTabButtons).find(btn => btn.dataset.tab === tabName);
    if (settingsSectionTitle && activeBtn) settingsSectionTitle.innerText = activeBtn.innerText.trim();
}
settingsTabButtons.forEach(btn => {
    btn.addEventListener('click', () => switchSettingsTab(btn.dataset.tab));
});

closeSettings.addEventListener('click', () => {
    settingsModal.style.display = 'none';
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsModal.style.display === 'flex') settingsModal.style.display = 'none';
});

window.addEventListener('click', (event) => {
    if (event.target === settingsModal) {
        settingsModal.style.display = 'none';
    }
});

window.toggleFullscreen = function(btn) {
    const wrapper = btn.closest('.video-wrapper');

    if (!document.fullscreenElement) {
        wrapper.requestFullscreen().then(() => {
            refreshDemoAudioGains();
        }).catch(err => alert(err.message));
    } else {
        document.exitFullscreen().then(() => {
            refreshDemoAudioGains();
        });
    }
};

// Подстраховка от повторного 'suspended' у AudioContext (браузер/Electron может
// приостановить его снова, например при сворачивании окна) — на любой клик
// пробуем разбудить, иначе Voice Gate и индикатор уровня молча перестанут
// реагировать на звук без какой-либо видимой ошибки.
document.addEventListener('click', () => {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
    }
});

// Пока вкладка/окно свёрнуты, гейт (см. check() в processAudioLevel) сам
// периодически пытается разбудить AudioContext через setInterval. Но как
// только пользователь возвращается в приложение — будим контекст сразу же,
// не дожидаясь ближайшего тика, чтобы микрофон включался без задержки.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
    }
    if (!document.hidden) resyncRoomUsers();
});
window.addEventListener('focus', resyncRoomUsers);
window.addEventListener('online', resyncRoomUsers);

// ---------- Актуальность списка участников, когда вкладка неактивна ----------
// Основной механизм — push с сервера (см. broadcastRoomUsers): события приходят по
// WebSocket и обрабатываются даже в фоне, никакого опроса по таймеру (он в фоне
// всё равно троттлится браузером и только грузил бы CPU/сеть).
// Страховка от пропущенных событий (вкладку могли «заморозить», сокет — переподключиться):
// при возврате в окно один раз запрашиваем свежий снимок. Это один маленький запрос.
let lastRoomUsersResync = 0;
function resyncRoomUsers() {
    if (!socket.connected) return;
    const now = Date.now();
    if (now - lastRoomUsersResync < 1000) return; // focus + visibilitychange приходят вместе
    lastRoomUsersResync = now;
    if (selectedRoom) socket.emit('get room users', selectedRoom);
    if (currentUser.room && currentUser.room !== selectedRoom) socket.emit('get room users', currentUser.room);
}

// Просим браузер не замораживать вкладку в фоне (Chrome/Edge замораживают скрытые вкладки
// после ~5 минут без звука — и тогда сокет перестаёт обрабатывать события). Web Lock
// ничего не считает и не потребляет CPU — это просто флаг «страница занята».
try {
    if (navigator.locks && navigator.locks.request) {
        navigator.locks.request('mute-keep-alive', () => new Promise(() => {})).catch(() => {});
    }
} catch (e) {}

document.addEventListener('fullscreenchange', () => {
    refreshDemoAudioGains();
});

// Сообщает остальным участникам комнаты раздельный статус: выключен ли у нас
// микрофон (мьют) и выключены ли у нас наушники (дефен) — это два разных значка.
function broadcastMuteState() {
    if (currentUser.room) {
        socket.emit('mute state', { micMuted: isMuted, deafened: isDeafened });
    }
    if (myPeerId) {
        if (!connectedUsers[myPeerId]) {
            connectedUsers[myPeerId] = { username: currentUser.username, avatar: currentUser.avatar };
        }
        connectedUsers[myPeerId].micMuted = isMuted;
        connectedUsers[myPeerId].deafened = isDeafened;
        setUserStatusBadges(myPeerId, isMuted, isDeafened);
    }
}

muteBtn.addEventListener('click', () => {
    if (isDeafened) return;
    isMuted = !isMuted;
    applyGateToMicTrack();
    muteBtn.classList.toggle('active', isMuted);
    playMuteSound();
    broadcastMuteState();
});

deafenBtn.addEventListener('click', () => {
    isDeafened = !isDeafened;
    applyGateToMicTrack();

    refreshDemoAudioGains();

    // Голос собеседников тоже идёт через gain-узлы (см. setupRemoteAudioAnalyzer) — при
    // дефене обнуляем их, при отмене дефена возвращаем именно ту громкость, которую
    // пользователь выставил каждому индивидуально, а не единую 100%.
    Object.keys(remoteVoiceGainNodes).forEach(peerId => {
        const username = (connectedUsers[peerId] && connectedUsers[peerId].username) || '';
        remoteVoiceGainNodes[peerId].gain.value = isDeafened ? 0 : getRemoteVolumePercent(username) / 100;
    });

    deafenBtn.classList.toggle('active', isDeafened);
    
    muteBtn.classList.toggle('active', isDeafened || isMuted);
    muteBtn.disabled = isDeafened;
    playDeafenSound();
    broadcastMuteState();
});

// ---------- Язык интерфейса (подготовка под будущие переводы) ----------
// Сейчас переводов нет: выбор просто сохраняется, а интерфейс остаётся на русском.
// Чтобы добавить язык — заполнить словарь I18N и помечать элементы атрибутом data-i18n="ключ"
// (applyI18n подставит перевод, а если ключа нет — оставит исходный русский текст).
const LANGUAGE_KEY = 'mute_ui_language';
const SUPPORTED_LANGUAGES = ['ru', 'en'];
const I18N = { ru: {}, en: {} };
let uiLanguage = 'ru';
try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (SUPPORTED_LANGUAGES.includes(saved)) uiLanguage = saved;
} catch (e) { /* ignore */ }

function t(key, fallback) {
    const dict = I18N[uiLanguage] || {};
    return dict[key] !== undefined ? dict[key] : (fallback !== undefined ? fallback : key);
}

function applyI18n() {
    document.documentElement.lang = uiLanguage;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const dict = I18N[uiLanguage] || {};
        const key = el.dataset.i18n;
        if (dict[key] !== undefined) el.textContent = dict[key];
    });
}

(function initLanguageSetting() {
    applyI18n();
    const select = document.getElementById('ui-language-select');
    if (!select) return;
    select.value = uiLanguage;
    select.addEventListener('change', () => {
        uiLanguage = SUPPORTED_LANGUAGES.includes(select.value) ? select.value : 'ru';
        try { localStorage.setItem(LANGUAGE_KEY, uiLanguage); } catch (e) { /* ignore */ }
        applyI18n();
    });
})();

// ---------- Спец. возможности: горячие клавиши ----------
// Комбинации хранятся на устройстве. В приложении (Tauri) они регистрируются глобально —
// работают и при свёрнутом окне; в браузере — только пока вкладка в фокусе.
const KEYBINDS_KEY = 'mute_keybinds_v1';
const KEYBIND_ACTIONS = [
    { id: 'mute', label: 'Включить / выключить микрофон' },
    { id: 'deafen', label: 'Включить / выключить наушники' },
    { id: 'leave', label: 'Покинуть звонок' }
];
let keybinds = { mute: '', deafen: '', leave: '', global: true };
try {
    const raw = localStorage.getItem(KEYBINDS_KEY);
    if (raw) keybinds = { ...keybinds, ...JSON.parse(raw) };
} catch (e) { /* ignore */ }
const keybindGlobalOk = {};   // какие действия реально зарегистрированы глобально
let keybindRecording = null;  // id действия, для которого сейчас ждём комбинацию

function saveKeybinds() {
    try { localStorage.setItem(KEYBINDS_KEY, JSON.stringify(keybinds)); } catch (e) { /* ignore */ }
}

function runKeybindAction(id) {
    if (id === 'mute') { if (!muteBtn.disabled) muteBtn.click(); }
    else if (id === 'deafen') deafenBtn.click();
    else if (id === 'leave') { if (currentUser.room) leaveVoiceChannel(); }
}

function keyEventToCombo(e) {
    if (/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code)) return null; // только модификатор
    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    const key = e.code.replace(/^Key/, '').replace(/^Digit/, '');
    return [...mods, key].join('+');
}

function prettyCombo(combo) {
    return combo.replace('Control', 'Ctrl').replace('Super', 'Win').replace(/\+Arrow/, '+');
}

function showKeybindError(text) {
    const el = document.getElementById('keybind-error');
    if (!el) return;
    el.textContent = text || '';
    el.style.display = text ? 'block' : 'none';
}

function renderKeybindList() {
    const list = document.getElementById('keybind-list');
    if (!list) return;
    list.innerHTML = '';
    KEYBIND_ACTIONS.forEach(a => {
        const row = document.createElement('div');
        row.className = 'keybind-row';
        const label = document.createElement('span');
        label.className = 'keybind-label';
        label.textContent = a.label;

        const controls = document.createElement('div');
        controls.className = 'keybind-controls';
        const btn = document.createElement('button');
        btn.type = 'button';
        const combo = keybinds[a.id];
        const recording = keybindRecording === a.id;
        btn.className = 'keybind-btn' + (combo ? '' : ' empty') + (recording ? ' recording' : '');
        btn.textContent = recording ? 'Нажмите комбинацию…' : (combo ? prettyCombo(combo) : 'Не задано');
        btn.addEventListener('click', () => startKeybindRecording(a.id));
        controls.appendChild(btn);

        if (combo && !recording) {
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'keybind-clear';
            clear.title = 'Убрать';
            clear.textContent = '✕';
            clear.addEventListener('click', () => {
                keybinds[a.id] = '';
                saveKeybinds();
                showKeybindError('');
                renderKeybindList();
                syncGlobalShortcuts();
            });
            controls.appendChild(clear);
        }
        row.appendChild(label);
        row.appendChild(controls);
        list.appendChild(row);
    });
}

function stopKeybindRecording() {
    keybindRecording = null;
    renderKeybindList();
    syncGlobalShortcuts();
}

async function startKeybindRecording(id) {
    showKeybindError('');
    keybindRecording = id;
    renderKeybindList();
    // Пока ждём комбинацию, снимаем глобальные привязки — чтобы нажатие не сработало как действие.
    const gs = window.__TAURI__ && window.__TAURI__.globalShortcut;
    if (gs) { try { await gs.unregisterAll(); } catch (e) { /* ignore */ } }
    KEYBIND_ACTIONS.forEach(a => { keybindGlobalOk[a.id] = false; });
}

// capture-фаза: перехватываем нажатие раньше остальных обработчиков (в т.ч. Esc, закрывающего настройки)
document.addEventListener('keydown', (e) => {
    if (!keybindRecording) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code === 'Escape') { stopKeybindRecording(); return; }
    const combo = keyEventToCombo(e);
    if (!combo) return; // пока зажат только Ctrl/Shift/Alt — ждём основную клавишу

    // Без Ctrl/Alt/Win допускаем только клавиши, которые ничего не печатают (F1–F24, Insert, Home и т.п.),
    // иначе обычная буква перестала бы вводиться в чате.
    const hasMainMod = e.ctrlKey || e.altKey || e.metaKey;
    const nonPrinting = /^(F\d{1,2}|Insert|Home|End|PageUp|PageDown|Pause|ScrollLock|PrintScreen|Numpad\w+)$/.test(e.code);
    if (!hasMainMod && !nonPrinting) {
        showKeybindError('Добавьте Ctrl или Alt (или выберите F-клавишу), иначе клавиша перестанет печататься.');
        return;
    }

    KEYBIND_ACTIONS.forEach(a => { if (keybinds[a.id] === combo) keybinds[a.id] = ''; }); // без дублей
    keybinds[keybindRecording] = combo;
    saveKeybinds();
    showKeybindError('');
    stopKeybindRecording();
}, true);

// Обычный (в пределах окна) обработчик — для браузера и как запасной вариант.
document.addEventListener('keydown', (e) => {
    if (keybindRecording || e.repeat) return;
    const combo = keyEventToCombo(e);
    if (!combo) return;
    const action = KEYBIND_ACTIONS.find(a => keybinds[a.id] && keybinds[a.id] === combo && !keybindGlobalOk[a.id]);
    if (!action) return;
    e.preventDefault();
    runKeybindAction(action.id);
});

// Глобальные комбинации (только в приложении Tauri, плагин global-shortcut).
async function syncGlobalShortcuts() {
    const gs = window.__TAURI__ && window.__TAURI__.globalShortcut;
    KEYBIND_ACTIONS.forEach(a => { keybindGlobalOk[a.id] = false; });
    if (!gs) return;
    try { await gs.unregisterAll(); } catch (e) { /* ignore */ }
    if (!keybinds.global || keybindRecording) return;
    const failed = [];
    for (const a of KEYBIND_ACTIONS) {
        const combo = keybinds[a.id];
        if (!combo) continue;
        try {
            await gs.register(combo, (ev) => {
                if (!ev || ev.state === 'Pressed') runKeybindAction(a.id);
            });
            keybindGlobalOk[a.id] = true;
        } catch (e) {
            console.warn('[Горячие клавиши] Не удалось зарегистрировать', combo, e);
            failed.push(prettyCombo(combo));
        }
    }
    showKeybindError(failed.length ? `Не удалось занять глобально: ${failed.join(', ')}. Работает только при открытом окне.` : '');
}

(function initKeybindsUI() {
    renderKeybindList();
    const isTauri = !!(window.__TAURI__ && window.__TAURI__.globalShortcut);
    const group = document.getElementById('keybind-global-group');
    const check = document.getElementById('keybind-global-check');
    const hint = document.getElementById('keybind-hint');
    if (isTauri && group && check) {
        group.style.display = 'block';
        check.checked = !!keybinds.global;
        check.addEventListener('change', () => {
            keybinds.global = check.checked;
            saveKeybinds();
            syncGlobalShortcuts();
        });
    } else if (hint) {
        hint.textContent += ' В браузере комбинации работают, пока вкладка открыта и в фокусе.';
    }
    syncGlobalShortcuts();
})();

async function loadMicrophones() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter(d => d.kind === 'audioinput');
        micSelect.innerHTML = '';
        mics.forEach((mic, i) => {
            const opt = document.createElement('option');
            opt.value = mic.deviceId;
            opt.innerText = mic.label || `Микрофон ${i + 1}`;
            micSelect.appendChild(opt);
        });

        // Если поток уже захвачен (initMediaStream вызывается раньше загрузки
        // списка, чтобы сначала получить разрешение на микрофон), отражаем в
        // селекте реально используемое устройство, а не первое в списке.
        const activeTrack = rawAudioStream && rawAudioStream.getAudioTracks()[0];
        const activeDeviceId = activeTrack && activeTrack.getSettings().deviceId;
        if (activeDeviceId && mics.some(m => m.deviceId === activeDeviceId)) {
            micSelect.value = activeDeviceId;
        }
    } catch (e) { console.error(e); }
}

micSelect.addEventListener('change', (e) => initMediaStream(e.target.value));

// Список устройств может измениться уже после старта (подключили гарнитуру,
// отключили USB-микрофон и т.п.) — обновляем список, не трогая текущий поток.
navigator.mediaDevices.addEventListener('devicechange', () => {
    loadMicrophones().catch(() => {});
});
noiseCheck.addEventListener('change', () => {
    saveAudioSettings({ noiseSuppression: noiseCheck.checked });
    initMediaStream(micSelect.value);
});

// "Слышать себя": просто крутим громкость постоянного gain-узла — не нужно
// пересоздавать поток или трогать анализатор/индикатор уровня.
micMonitorCheck.addEventListener('change', () => {
    micMonitorEnabled = micMonitorCheck.checked;
    applyGateToMicTrack();
    if (micMonitorEnabled && audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
    }
});
echoCheck.addEventListener('change', () => {
    saveAudioSettings({ echoCancellation: echoCheck.checked });
    initMediaStream(micSelect.value);
});
agcCheck.addEventListener('change', () => {
    saveAudioSettings({ agc: agcCheck.checked });
    initMediaStream(micSelect.value);
});

// Громкость своего микрофона — просто крутим gain уже существующего узла,
// без пересборки графа и без обрыва звонков.
if (micVolumeSlider) {
    micVolumeSlider.addEventListener('input', (e) => {
        const percent = parseInt(e.target.value, 10);
        micVolume = percent / 100;
        if (micVolumeValueDisplay) micVolumeValueDisplay.innerText = `${percent}%`;
        if (micGainNode) micGainNode.gain.value = micVolume;
        saveAudioSettings({ micVolume });
    });
}

thresholdSlider.addEventListener('input', (e) => {
    gateThreshold = parseInt(e.target.value, 10);
    thresholdValueDisplay.innerText = `${gateThreshold} дБ`;
    let posPercent = ((gateThreshold + 70) / 60) * 100;
    thresholdIndicator.style.left = `${posPercent}%`;
    saveAudioSettings({ gateThreshold });
});

if (gateHangoverSlider) {
    gateHangoverSlider.addEventListener('input', (e) => {
        gateHangoverMs = parseInt(e.target.value, 10);
        if (gateHangoverValueDisplay) gateHangoverValueDisplay.innerText = `${gateHangoverMs} мс`;
        saveAudioSettings({ gateHangoverMs });
    });
}

gateEnabledCheck.addEventListener('change', (e) => {
    gateEnabled = e.target.checked;
    if (!gateEnabled) {
        // Гейт выключен — считаем канал всегда "открытым" по громкости,
        // передача теперь зависит только от ручного мьюта/дефена.
        if (gateCloseTimer) {
            clearTimeout(gateCloseTimer);
            gateCloseTimer = null;
        }
        gateOpen = true;
    }
    updateGateControlsDisabled();
    applyGateToMicTrack();
    saveAudioSettings({ gateEnabled });
});

// ---------- Уникальный цвет ника ----------
// Стабильный хэш из имени -> HSL-цвет. У одного и того же ника всегда один и тот же
// цвет (на всех устройствах и после перезахода), у разных ников — заметно разные цвета.
function hashStringToInt(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function getUserColor(name) {
    const safeName = name || 'Участник';
    const hash = hashStringToInt(safeName);
    const hue = hash % 360;
    // Насыщенность/светлота подобраны так, чтобы цвет было хорошо видно на тёмном фоне
    return `hsl(${hue}, 70%, 65%)`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Разделитель даты вставляется перед первым сообщением нового дня. lastMessageDateKey
// хранит дату последнего отрисованного сообщения — сбрасывается при полной
// перезагрузке истории (иначе после переоткрытия чата разделители перестанут
// появляться повторно для тех же дат).
let lastMessageDateKey = null;
const MONTHS_RU_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// Сколько сообщений держим в DOM одновременно. Без этого лимита долгая
// активная сессия чата (особенно с картинками — каждая держит в памяти
// раскодированный битмап) постепенно раздувает потребление ОЗУ, пока вкладку
// не приходится перезагружать. В базе (Neon Postgres) история не трогается —
// это чисто ограничение того, что отрисовано на экране прямо сейчас.
const MAX_RENDERED_MESSAGES = 200;
function trimRenderedMessages() {
    // Считаем только сами сообщения, разделители дат в лимит не входят.
    while (messagesDiv.querySelectorAll('.chat-message').length > MAX_RENDERED_MESSAGES) {
        const first = messagesDiv.firstElementChild;
        if (!first) break;
        first.remove();
    }
    // Разделитель даты, оставшийся без единого сообщения под собой (например,
    // после того как все сообщения этого дня выше были обрезаны), больше не нужен.
    while (messagesDiv.firstElementChild && messagesDiv.firstElementChild.classList.contains('chat-date-separator')) {
        messagesDiv.firstElementChild.remove();
    }
}

function formatMessageTime(date) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

function formatDateSeparator(date) {
    const now = new Date();
    const day = date.getDate();
    const month = MONTHS_RU_GENITIVE[date.getMonth()];
    // Год добавляем только если сообщение не из текущего года — чтобы не загромождать
    // разделитель лишними цифрами для обычной, самой частой ситуации.
    return date.getFullYear() === now.getFullYear() ? `${day} ${month}` : `${day} ${month} ${date.getFullYear()}`;
}

function dateKeyOf(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function maybeInsertDateSeparator(date) {
    const key = dateKeyOf(date);
    if (key === lastMessageDateKey) return;
    lastMessageDateKey = key;
    const sep = document.createElement('div');
    sep.className = 'chat-date-separator';
    sep.textContent = formatDateSeparator(date);
    messagesDiv.appendChild(sep);
}

// Экранирование спецсимволов регулярных выражений в нике (ники не ограничены
// по составу символов на сервере, так что подстраховываемся).
function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Находит вхождения "@ник" в тексте сообщения, где ник — реальный участник
// сервера из переданного списка. Возвращает массив {index, length, username}
// с позициями в ИСХОДНОМ (неэкранированном) тексте.
function findMentionMatches(text, members) {
    if (!text || !members || !members.length) return [];
    const names = [...new Set(members.map(m => m && m.username).filter(Boolean))]
        .sort((a, b) => b.length - a.length) // сначала длинные ники — иначе короткий "hu" мог бы "съесть" часть "huie"
        .map(escapeRegExp);
    if (!names.length) return [];

    // Перед "@" (или перед "wh@") не должно быть буквы/цифры/другого "@" (чтобы не путать с email),
    // а после ника не должно идти продолжение слова (иначе "@huie" не должен
    // матчиться как "@hu" из-за более раннего варианта в списке).
    // Необязательный префикс "wh" — шёпот: wh@ник.
    const pattern = new RegExp(`(^|[^\\wа-яА-ЯёЁ@])(wh)?@(${names.join('|')})(?![\\wа-яА-ЯёЁ])`, 'giu');
    const matches = [];
    let m;
    while ((m = pattern.exec(text))) {
        const whisper = !!m[2];
        matches.push({
            index: m.index + m[1].length,
            length: (whisper ? 2 : 0) + 1 + m[3].length,
            username: m[3],
            whisper
        });
        if (m.index === pattern.lastIndex) pattern.lastIndex++; // защита от зацикливания на пустом совпадении
    }
    return matches;
}

// "f@" — отметить всех участников сервера. Ищется отдельно от ников, поэтому работает
// и когда список участников ещё не загружен.
function findEveryoneMatches(text) {
    if (!text) return [];
    const pattern = /(^|[^\wа-яА-ЯёЁ@])f@(?![\wа-яА-ЯёЁ@])/giu;
    const out = [];
    let m;
    while ((m = pattern.exec(text))) {
        out.push({ index: m.index + m[1].length, length: 2, everyone: true });
    }
    return out;
}

// Собирает HTML текста сообщения с подсвеченными @упоминаниями. Текст всё
// равно полностью экранируется — подсветка добавляется поверх escapeHtml.
function renderMessageTextWithMentions(text, members, myUsername) {
    const tokens = [...findMentionMatches(text, members), ...findEveryoneMatches(text)]
        .sort((a, b) => a.index - b.index);
    if (!tokens.length) return escapeHtml(text);

    const meLower = (myUsername || '').toLowerCase();
    let html = '';
    let lastIndex = 0;
    tokens.forEach((tok) => {
        if (tok.index < lastIndex) return; // токены не должны пересекаться
        html += escapeHtml(text.slice(lastIndex, tok.index));
        if (tok.everyone) {
            html += `<span class="mention mention-all">f@</span>`;
        } else {
            const isMe = tok.username.toLowerCase() === meLower;
            html += `<span class="mention${isMe ? ' mention-me' : ''}${tok.whisper ? ' mention-whisper' : ''}">${tok.whisper ? 'wh' : ''}@${escapeHtml(tok.username)}</span>`;
        }
        lastIndex = tok.index + tok.length;
    });
    html += escapeHtml(text.slice(lastIndex));
    return html;
}

function renderChatMessage({ username, user, avatar, text, image_url, created_at, whisper_to }) {
    const name = username || user || 'Участник';
    // created_at приходит с сервера как Date.now() (мс) — если вдруг отсутствует или же
    // после парсинга получилась невалидная дата (например, у старых записей в БД, ещё
    // до фикса с BIGINT-как-строкой), подстраховываемся текущим временем, чтобы не
    // сломать рендер и не показать "NaN:NaN".
    let date = created_at ? new Date(created_at) : new Date();
    if (isNaN(date.getTime())) date = new Date();

    maybeInsertDateSeparator(date);

    const msg = document.createElement('div');
    msg.className = 'chat-message fade-in';

    let html = `<strong class="msg-sender" style="color:${getUserColor(name)}">${escapeHtml(name)}:</strong> `;
    if (Array.isArray(whisper_to) && whisper_to.length) {
        msg.classList.add('chat-whisper');
        const meLowerW = (currentUser.username || '').toLowerCase();
        const iAmSender = name.toLowerCase() === meLowerW;
        const others = whisper_to.filter(n => String(n).toLowerCase() !== name.toLowerCase());
        const label = iAmSender
            ? `шёпот → ${others.map(escapeHtml).join(', ')}`
            : 'шепчет вам';
        html += `<span class="whisper-tag" title="Это сообщение видят только отмеченные участники">${label}</span> `;
    }
    if (text) html += `<span class="msg-text">${renderMessageTextWithMentions(text, getMentionCandidates(), currentUser.username)}</span>`;
    if (image_url) {
        html += `<div class="chat-image-wrap"><img src="${image_url}" class="chat-image" alt="Изображение" onclick="openImageLightbox('${image_url}')"></div>`;
    }
    html += `<span class="msg-time">${formatMessageTime(date)}</span>`;
    msg.innerHTML = html;
    messagesDiv.appendChild(msg);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    trimRenderedMessages();
}

socket.on('chat history', (data) => {
    // Пришла история чата другой комнаты, чем та, что сейчас открыта (например,
    // ответ на уже неактуальный запрос) — игнорируем, чтобы не подмешать чужой чат.
    const room = data && data.room;
    const history = (data && data.messages) || [];
    if (room && room !== selectedRoom) return;

    messagesDiv.innerHTML = '';
    lastMessageDateKey = null; // заново расставляем разделители дат для свежезагруженной истории
    history.forEach(renderChatMessage);
});

socket.on('chat message', (payload) => {
    // Показываем только сообщения текущей открытой комнаты.
    if (payload.room && payload.room !== selectedRoom) return;
    renderChatMessage(payload);

    // Звук — только для чужих сообщений, свои же мы и так видим, что отправили
    const senderName = payload.username || payload.user;
    // Сравниваем без учёта регистра и пробелов — иначе при малейшем расхождении ника
    // собственное сообщение считалось бы чужим и проигрывало звук. Свои сообщения
    // (в том числе отправленные с другого устройства с тем же аккаунтом) — без звука и тостов.
    const normName = (n) => String(n || '').trim().toLowerCase();
    const isOwnMessage = !!normName(currentUser.username) && normName(senderName) === normName(currentUser.username);
    if (!isOwnMessage) {
        // Если в сообщении упомянули нас по нику — играем отдельный, более заметный
        // звук упоминания ВМЕСТО обычного звука сообщения (чтобы не звучало дважды),
        // и показываем тост, чтобы не пропустить упоминание среди прочих сообщений.
        const mentions = findMentionMatches(payload.text || '', getMentionCandidates());
        const meLower = (currentUser.username || '').toLowerCase();
        const iAmMentioned = !!meLower && mentions.some(m => m.username.toLowerCase() === meLower);
        const isWhisper = Array.isArray(payload.whisper_to) && payload.whisper_to.length > 0;
        // "f@" отмечает всех, но не в шёпоте (шёпот видят только его адресаты)
        const everyoneMentioned = !isWhisper && findEveryoneMatches(payload.text || '').length > 0;

        if (isWhisper) {
            playMentionSound();
            showToast(`${senderName} прошептал(а) вам`);
        } else if (iAmMentioned) {
            playMentionSound();
            showToast(`${senderName} упомянул(а) вас в чате`);
        } else if (everyoneMentioned) {
            playMentionSound();
            showToast(`${senderName} отметил(а) всех участников`);
        } else {
            playMessageSound();
        }
    }
});

// Сервер сообщает, почему сообщение не ушло (например, неверный ник после wh@)
socket.on('chat notice', (text) => { if (text) showToast(String(text)); });

// ---------- Автодополнение @упоминаний в поле ввода чата ----------
// (mentionAutocompleteEl, mentionState и closeMentionAutocomplete объявлены выше,
// рядом с setChatEnabled — см. комментарий там про порядок объявления.)

function renderMentionAutocomplete() {
    if (!mentionAutocompleteEl) return;
    mentionAutocompleteEl.innerHTML = '';
    mentionState.items.forEach((m, idx) => {
        const row = document.createElement('div');
        row.className = 'mention-item' + (idx === mentionState.activeIndex ? ' active' : '');

        const avatar = document.createElement('img');
        avatar.className = 'mention-avatar';
        avatar.src = m.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(m.username)}`;
        avatar.alt = '';
        row.appendChild(avatar);

        const nameEl = document.createElement('span');
        nameEl.className = 'mention-name';
        nameEl.style.color = getUserColor(m.username);
        nameEl.textContent = m.username;
        row.appendChild(nameEl);

        const dot = document.createElement('span');
        dot.className = 'mention-status-dot';
        dot.style.background = m.online ? '#3ba55d' : '#6b7280';
        dot.title = m.online ? 'В сети' : 'Не в сети';
        row.appendChild(dot);

        // mousedown, а не click — срабатывает раньше blur поля ввода,
        // иначе список бы закрывался (и терял выбор) до обработки клика.
        row.addEventListener('mousedown', (e) => {
            e.preventDefault();
            applyMention(idx);
        });

        mentionAutocompleteEl.appendChild(row);
    });
    mentionAutocompleteEl.style.display = mentionState.items.length ? 'block' : 'none';
}

// Смотрит на текст перед курсором: если там набирается "@ник" — ищет среди
// участников текущего сервера подходящие варианты (по началу ника) и
// показывает подсказку. Иначе — скрывает её.
function updateMentionAutocomplete() {
    const value = messageInput.value;
    const cursor = messageInput.selectionStart ?? value.length;
    const beforeCursor = value.slice(0, cursor);

    // "@" в начале строки или после пробела/переноса, дальше — без пробелов до курсора.
    // Допускается префикс "wh" (шёпот): wh@ник. "f@" — команда "отметить всех", подсказок ников для неё нет.
    const match = beforeCursor.match(/(^|\s)(wh|f)?@([^\s@]{0,32})$/iu);
    if (!match) { closeMentionAutocomplete(); return; }
    if ((match[2] || '').toLowerCase() === 'f') { closeMentionAutocomplete(); return; }

    const query = match[3];
    const startIndex = cursor - query.length - 1; // позиция символа '@'
    const candidates = getMentionCandidates();
    if (!candidates.length) { closeMentionAutocomplete(); return; }

    const lowerQuery = query.toLowerCase();
    const meLower = (currentUser.username || '').toLowerCase();
    const items = candidates
        .filter(m => m && m.username && m.username.toLowerCase() !== meLower)
        .filter(m => m.username.toLowerCase().startsWith(lowerQuery))
        .sort((a, b) => {
            if (a.online !== b.online) return a.online ? -1 : 1;
            return a.username.localeCompare(b.username, 'ru');
        })
        .slice(0, 8);

    if (!items.length) { closeMentionAutocomplete(); return; }

    const activeIndex = mentionState.active && mentionState.startIndex === startIndex
        ? Math.min(mentionState.activeIndex, items.length - 1)
        : 0;
    mentionState = { active: true, startIndex, query, items, activeIndex };
    renderMentionAutocomplete();
}

// Подставляет выбранный ник вместо набранного "@запроса" и ставит курсор сразу после него.
function applyMention(idx) {
    const item = mentionState.items[idx];
    if (!item) { closeMentionAutocomplete(); return; }

    const value = messageInput.value;
    const before = value.slice(0, mentionState.startIndex);
    const after = value.slice(mentionState.startIndex + 1 + mentionState.query.length);
    const insertion = `@${item.username} `;

    messageInput.value = before + insertion + after;
    const newCursor = (before + insertion).length;
    closeMentionAutocomplete();
    messageInput.focus();
    messageInput.setSelectionRange(newCursor, newCursor);
}

messageInput.addEventListener('input', updateMentionAutocomplete);
messageInput.addEventListener('click', updateMentionAutocomplete);
messageInput.addEventListener('blur', () => {
    // Небольшая задержка, чтобы клик по подсказке (mousedown) успел обработаться раньше закрытия.
    setTimeout(closeMentionAutocomplete, 150);
});

messageInput.addEventListener('keydown', (e) => {
    e.stopPropagation();

    if (mentionState.active) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            mentionState.activeIndex = (mentionState.activeIndex + 1) % mentionState.items.length;
            renderMentionAutocomplete();
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            mentionState.activeIndex = (mentionState.activeIndex - 1 + mentionState.items.length) % mentionState.items.length;
            renderMentionAutocomplete();
            return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            applyMention(mentionState.activeIndex);
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closeMentionAutocomplete();
            return;
        }
    }

    if (e.key === 'Enter' && messageInput.value.trim() && !messageInput.disabled) {
        socket.emit('chat message', { text: messageInput.value.trim() });
        messageInput.value = '';
        closeMentionAutocomplete();
    }
});

const attachBtn = document.getElementById('attach-image-btn');
const attachInput = document.getElementById('attach-image-input');

if (attachBtn && attachInput) {
    attachBtn.addEventListener('click', () => attachInput.click());

    attachInput.addEventListener('change', async () => {
        const file = attachInput.files[0];
        attachInput.value = '';
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('Можно прикреплять только изображения');
            return;
        }
        if (file.size > 8 * 1024 * 1024) {
            alert('Файл слишком большой (максимум 8 МБ)');
            return;
        }

        attachBtn.disabled = true;
        try {
            const formData = new FormData();
            formData.append('image', file);
            const res = await fetch('/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');
            socket.emit('chat message', { text: '', imageUrl: data.url });
        } catch (err) {
            console.error('[Ошибка] Загрузка изображения:', err);
            alert('Не удалось загрузить изображение');
        } finally {
            attachBtn.disabled = false;
        }
    });
}

// Полноэкранный просмотр фото из чата
window.openImageLightbox = function(url) {
    lightboxImage.src = url;
    imageLightbox.style.display = 'flex';
};

function closeImageLightbox() {
    imageLightbox.style.display = 'none';
    lightboxImage.src = '';
}

lightboxClose.addEventListener('click', closeImageLightbox);
imageLightbox.addEventListener('click', (e) => {
    if (e.target === imageLightbox) closeImageLightbox();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && imageLightbox.style.display === 'flex') closeImageLightbox();
});

// Своя модалка подтверждения выхода вместо нативного confirm(). Помимо более приятного
// вида, это чинит баг в Electron-приложении: браузерный (синхронный) confirm() блокирует
// рендер-процесс, и последующий location.reload() иногда происходит в состоянии, из которого
// окно не возвращает фокус клавиатуре/мыши — поля ника и пароля после этого визуально есть,
// но недоступны для ввода/клика. Обычный DOM-модал такой проблемы не вызывает.
const logoutBtn = document.getElementById('logout-btn');

function openLogoutConfirm() {
    logoutConfirmModal.style.display = 'flex';
}

function closeLogoutConfirm() {
    logoutConfirmModal.style.display = 'none';
}

logoutBtn.addEventListener('click', openLogoutConfirm);
logoutCancelBtn.addEventListener('click', closeLogoutConfirm);
logoutConfirmModal.addEventListener('click', (e) => {
    if (e.target === logoutConfirmModal) closeLogoutConfirm();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && logoutConfirmModal.style.display === 'flex') closeLogoutConfirm();
});

logoutConfirmBtn.addEventListener('click', () => {
    closeLogoutConfirm();
    clearProfileStorage();
    location.reload();
});

// Автовход: если профиль уже сохранён в этом браузере — сразу пропускаем экран регистрации.
(async () => {
    const stored = loadProfileFromStorage();
    if (stored && stored.username) {
        currentUser.username = stored.username;
        currentUser.avatar = stored.avatar || '';
        currentUser.token = stored.token || null;
        usernameInput.value = currentUser.username;
        avatarInput.value = currentUser.avatar;
        await completeLogin();
        syncThemeFromServer(); // подтягиваем тему, если её поменяли на другом устройстве
    }
})();

// ---------- Профиль: смена ника и аватарки (ссылкой или файлом) ----------

profileAvatarUrlInput.addEventListener('input', () => {
    pendingAvatarFile = null; // ссылку ввели последней — она и победит
    const url = profileAvatarUrlInput.value.trim();
    if (url) profileAvatarPreview.src = url;
});

profileAvatarFileInput.addEventListener('change', () => {
    const file = profileAvatarFileInput.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('Можно загружать только изображения');
        profileAvatarFileInput.value = '';
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        alert('Файл слишком большой (максимум 8 МБ)');
        profileAvatarFileInput.value = '';
        return;
    }

    pendingAvatarFile = file; // файл выбрали последним — он и победит
    const reader = new FileReader();
    reader.onload = () => { profileAvatarPreview.src = reader.result; };
    reader.readAsDataURL(file);
});

saveProfileBtn.addEventListener('click', async () => {
    const newUsername = profileUsernameInput.value.trim();
    if (!newUsername) {
        alert('Введите никнейм');
        return;
    }

    saveProfileBtn.disabled = true;
    saveProfileBtn.innerText = 'Сохранение...';
    try {
        let newAvatar = currentUser.avatar;

        if (pendingAvatarFile) {
            const formData = new FormData();
            formData.append('image', pendingAvatarFile);
            const res = await fetch('/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Ошибка загрузки файла');
            newAvatar = data.url;
        } else if (profileAvatarUrlInput.value.trim()) {
            newAvatar = profileAvatarUrlInput.value.trim();
        }

        // Если это зарегистрированный аккаунт (есть токен) — сначала сохраняем ник/аватарку
        // на сервере. Он же проверит, не занят ли новый ник, и перевыпустит токен.
        if (currentUser.token) {
            const res = await fetch('/auth/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUser.token}`
                },
                body: JSON.stringify({ username: newUsername, avatar: newAvatar })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Не удалось сохранить профиль на сервере');

            currentUser.token = data.token;
            currentUser.username = data.username;
            currentUser.avatar = data.avatar || newAvatar;
        } else {
            currentUser.username = newUsername;
            currentUser.avatar = newAvatar;
        }

        pendingAvatarFile = null;
        saveProfileToStorage();

        // Обновляем себя локально сразу, не дожидаясь ответа сервера
        if (myPeerId) {
            connectedUsers[myPeerId] = { username: currentUser.username, avatar: currentUser.avatar };
        }
        updateVoiceUsersList();

        const localWrapName = document.querySelector('#local-video-wrap .video-username');
        if (localWrapName) {
            localWrapName.innerText = `${currentUser.username} (Вы)`;
            localWrapName.style.color = getUserColor(currentUser.username);
        }

        socket.emit('update profile', {
            username: currentUser.username,
            avatar: currentUser.avatar,
            token: currentUser.token || null
        });

        settingsModal.style.display = 'none';
    } catch (err) {
        console.error('[Ошибка] Сохранение профиля:', err);
        alert(err.message || 'Не удалось сохранить профиль');
    } finally {
        saveProfileBtn.disabled = false;
        saveProfileBtn.innerText = 'Сохранить профиль';
    }
});
// ---------- Изменение размера панелей перетаскиванием (как в Discord) ----------
function makeColumnResizable(resizerEl, targetEl, { min, max, storageKey, invert = false }) {
    if (!resizerEl || !targetEl) return;

    // Восстанавливаем сохранённую ширину
    const saved = localStorage.getItem(storageKey);
    if (saved) {
        const w = Math.min(max, Math.max(min, parseInt(saved, 10)));
        if (!Number.isNaN(w)) targetEl.style.width = w + 'px';
    }

    let startX = 0;
    let startWidth = 0;

    function onMouseMove(e) {
        const delta = e.clientX - startX;
        const rawWidth = invert ? startWidth - delta : startWidth + delta;
        const newWidth = Math.min(max, Math.max(min, rawWidth));
        targetEl.style.width = newWidth + 'px';
    }

    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.classList.remove('resizing-col');
        resizerEl.classList.remove('resizing');
        localStorage.setItem(storageKey, parseInt(targetEl.style.width, 10));
    }

    resizerEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startWidth = targetEl.getBoundingClientRect().width;
        document.body.classList.add('resizing-col');
        resizerEl.classList.add('resizing');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

makeColumnResizable(
    document.getElementById('sidebar-resizer'),
    document.getElementById('sidebar'),
    { min: 180, max: 420, storageKey: 'mute:sidebarWidth' }
);

makeColumnResizable(
    document.getElementById('chat-resizer'),
    document.getElementById('chat-panel'),
    { min: 260, max: 640, storageKey: 'mute:chatWidth', invert: true }
);

// ---------- Запрет копирования всего, кроме текста сообщений и полей ввода ----------
document.addEventListener('copy', (e) => {
    const target = e.target;
    const isAllowed = target && (
        target.closest('.msg-text') ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA'
    );
    if (!isAllowed) {
        e.preventDefault();
    }
});
