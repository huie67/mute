const socket = io();
// ---------- Устройство вывода звука ----------
// Голоса идут через общий AudioContext, уведомления и плейлист — через <audio>. Выбранное
// устройство применяем и к контексту (setSinkId), и к каждому медиа-элементу перед play().
var OUTPUT_DEVICE_KEY = 'mute_output_device';
var outputDeviceId = '';
try { outputDeviceId = localStorage.getItem(OUTPUT_DEVICE_KEY) || ''; } catch (e) {}
function applySinkToContext(ctx) {
    if (ctx && typeof ctx.setSinkId === 'function') {
        try { ctx.setSinkId(outputDeviceId || '').catch(() => {}); } catch (e) {}
    }
}
function applySinkToElement(el) {
    if (el && typeof el.setSinkId === 'function' && (el.__muteSink || '') !== outputDeviceId) {
        el.__muteSink = outputDeviceId;
        try { el.setSinkId(outputDeviceId || '').catch(() => {}); } catch (e) {}
    }
}
(function () {
    const Base = window.AudioContext || window.webkitAudioContext;
    if (Base && !Base.__muteSink) {
        class MuteAudioContext extends Base {
            constructor(...a) { super(...a); if (outputDeviceId) applySinkToContext(this); }
        }
        MuteAudioContext.__muteSink = true;
        window.AudioContext = MuteAudioContext;
    }
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) {
        applySinkToElement(this);
        return origPlay.apply(this, a);
    };
})();


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

                // «В ЧС»: выгнать и закрыть возможность вернуться на сервер.
                const banBtn = document.createElement('button');
                banBtn.type = 'button';
                banBtn.className = 'action-btn';
                banBtn.style.cssText = 'font-size:11px; padding:5px 8px; background:#3a1f24; color:#ff8080; white-space:nowrap;';
                banBtn.textContent = 'В ЧС';
                banBtn.title = 'Добавить в чёрный список: выгнать и не пускать обратно';
                banBtn.addEventListener('click', () => {
                    if (!confirm(`Добавить «${m.username}» в чёрный список? Он будет исключён и не сможет зайти на сервер, пока вы не уберёте его из списка.`)) return;
                    socket.emit('ban server member', { code: currentServerInfo.code, username: m.username });
                });
                actions.appendChild(banBtn);
            }

            row.appendChild(actions);
        }

        serverMembersListEl.appendChild(row);
    });
}

// ---------- Чёрный список сервера ----------
const serverBansSection = document.getElementById('server-bans-section');
const serverBansListEl = document.getElementById('server-bans-list');
const serverBansEmpty = document.getElementById('server-bans-empty');
let lastBansRequestAt = 0;

// Список запрашиваем только у владельца/модераторов (сервер всем остальным и не ответит).
function requestServerBans() {
    if (!currentServerInfo || !currentServerInfo.canModerate && !currentServerInfo.isOwner && !currentServerInfo.isAdmin) {
        if (serverBansSection) serverBansSection.style.display = 'none';
        return;
    }
    const now = Date.now();
    if (now - lastBansRequestAt < 2000) return;
    lastBansRequestAt = now;
    socket.emit('get server bans', { code: currentServerInfo.code });
}

function renderServerBans(bans) {
    if (!serverBansSection || !serverBansListEl) return;
    serverBansSection.style.display = 'block';
    serverBansListEl.innerHTML = '';
    if (serverBansEmpty) serverBansEmpty.style.display = bans.length ? 'none' : 'block';
    bans.forEach(b => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:8px; background:var(--bg-input); border-radius:8px;';
        const info = document.createElement('div');
        info.style.cssText = 'flex:1; min-width:0;';
        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        nameEl.textContent = b.username;
        info.appendChild(nameEl);
        const sub = document.createElement('div');
        sub.style.cssText = 'font-size:11px; color:var(--text-faint);';
        const when = b.bannedAt ? new Date(b.bannedAt).toLocaleDateString() : '';
        sub.textContent = [b.bannedBy ? `добавил(а): ${b.bannedBy}` : '', when].filter(Boolean).join(' · ');
        info.appendChild(sub);
        row.appendChild(info);
        const unbanBtn = document.createElement('button');
        unbanBtn.type = 'button';
        unbanBtn.className = 'btn-secondary';
        unbanBtn.style.cssText = 'font-size:11px; padding:5px 8px; white-space:nowrap;';
        unbanBtn.textContent = 'Убрать из ЧС';
        unbanBtn.addEventListener('click', () => {
            socket.emit('unban server member', { code: currentServerInfo.code, username: b.username });
        });
        row.appendChild(unbanBtn);
        serverBansListEl.appendChild(row);
    });
}

socket.on('server bans list', ({ code, bans } = {}) => {
    if (!currentServerInfo || currentServerInfo.code !== code) return;
    renderServerBans(Array.isArray(bans) ? bans : []);
});

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

// Баннер "переподключение" — в отличие от showToast() не исчезает сам по себе,
// висит ровно пока соединение реально не в порядке (см. socket 'disconnect'/'connect' ниже).
const connectionBanner = document.getElementById('connection-status-banner');
const connectionBannerText = document.getElementById('connection-status-text');
function setConnectionBanner(visible, text) {
    if (!connectionBanner) return;
    if (text && connectionBannerText) connectionBannerText.textContent = text;
    connectionBanner.classList.toggle('visible', !!visible);
}

// Режим низкой производительности: пользовательская настройка (хранится на устройстве)
// + фактическая видимость окна. Активен ТОЛЬКО когда оба условия верны — включена
// настройка И окно сейчас свёрнуто/скрыто (document.visibilityState === 'hidden').
// В Tauri сворачивание окна тоже даёт 'hidden' — это тот же WebView2, что и вкладка
// браузера, отдельного API дёргать не нужно.
const LOW_PERF_MODE_KEY = 'mute_low_perf_mode';
let lowPerfModeEnabled = false;
try { lowPerfModeEnabled = localStorage.getItem(LOW_PERF_MODE_KEY) === '1'; } catch (e) { /* ignore */ }

// «Окно неактивно» — это не только visibilityState === 'hidden'. В WebView2 (Tauri)
// при сворачивании окна кнопкой в своей шапке visibilitychange приходит не всегда, из-за
// чего режим раньше просто не срабатывал. Поэтому считаем окно неактивным, если оно
// скрыто ИЛИ потеряло фокус (свернули, переключились в другое приложение) ИЛИ Tauri
// сообщил, что окно свёрнуто.
let windowHasFocus = (typeof document.hasFocus === 'function') ? document.hasFocus() : true;
let windowMinimized = false;

function windowIsInactive() {
    return document.visibilityState === 'hidden' || !windowHasFocus || windowMinimized;
}

function lowPerfActive() {
    return lowPerfModeEnabled && windowIsInactive();
}

// Только визуальный слой: ставит/убирает CSS-класс, который глушит анимации и
// переходы (см. правило .low-perf-active в index.html). Никак не влияет на
// WebRTC-звонок, микрофон, Voice Gate, сокет — они продолжают работать в фоне,
// иначе звонок бы "замолкал" при простом сворачивании окна, что не нужно.
// ---------- Лёгкий интерфейс ----------
// Постоянно (независимо от окна): без размытия, анимаций, переходов и теней.
// Раньше часть этого делал режим низкой производительности — теперь он отвечает только
// за «окно неактивно», а оформление вынесено сюда.
const LIGHT_UI_KEY = 'mute_light_ui';
let lightUiEnabled = false;
try { lightUiEnabled = localStorage.getItem(LIGHT_UI_KEY) === '1'; } catch (e) { /* ignore */ }
document.documentElement.classList.toggle('light-ui', lightUiEnabled);

function applyLowPerfState() {
    document.documentElement.classList.toggle('low-perf-active', lowPerfActive());
    applyRemoteMeterRate();
}

// Как часто метры ЧУЖИХ голосов (только свечение "говорит") шлют отчёты главному потоку:
//  - окно активно                              → как обычно, каждые 50 мс;
//  - окно неактивно, режим низкой произв. выкл → урезано до раза в секунду;
//  - окно неактивно, режим низкой произв. вкл  → метры полностью выключены.
// Звук собеседников и гейт собственного микрофона от этого не зависят.
function remoteMeterReportMs() {
    if (!windowIsInactive()) return 50;
    return lowPerfModeEnabled ? 0 : 1000;
}
function sendRemoteMeterRate(node) {
    if (node && node.__isWorklet && node.port) {
        try { node.port.postMessage({ reportMs: remoteMeterReportMs() }); } catch (e) { /* ignore */ }
    }
}
function applyRemoteMeterRate() {
    // Вызывается и на загрузке, до объявления remoteAnalysers (let) — поэтому try.
    try {
        for (const id in remoteAnalysers) sendRemoteMeterRate(remoteAnalysers[id]);
    } catch (e) { /* ещё не инициализировано */ }
}

document.addEventListener('visibilitychange', applyLowPerfState);
window.addEventListener('blur', () => { windowHasFocus = false; applyLowPerfState(); });
window.addEventListener('focus', () => { windowHasFocus = true; windowMinimized = false; applyLowPerfState(); });
applyLowPerfState();

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
    if (showOffCallMembers && code && code === customCodeFromRoomName(currentUser.room || selectedRoom)) {
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
    requestServerBans();
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

// Пришло, когда нас выгнал создатель или модератор сервера — ИЛИ когда сервер
// отказался пустить в чат при переподключении, потому что нас там больше нет
// (см. проверку членства в 'select chat room' на сервере).
socket.on('kicked from server', ({ code, name } = {}) => {
    if (!code) return;
    const roomName = `custom:${code}`;
    const btn = customServersList.querySelector(`[data-room="${roomName}"]`);
    if (btn) btn.remove();
    removeMyServerCode(code);
    if (currentServerInfo && currentServerInfo.code === code) {
        closeModal(serverInfoModal);
    }

    // ВАЖНО: если этот сервер был сейчас открыт (в чате и/или в голосовом канале),
    // сбрасываем это состояние локально. Раньше selectedRoom/currentUser.room
    // просто оставались указывать на удалённый сервер — при следующем
    // переподключении сокета клиент сам заново запрашивал 'select chat room'
    // для того же roomName, из-за чего кик "не держался" (см. серверную часть).
    if (selectedRoom === roomName) {
        selectedRoom = null;
        saveLastRoom(null);
        setChatEnabled(false);
        roomTitle.innerText = 'Выберите канал';
        connectRoomBtn.style.display = 'none';
        document.querySelectorAll('.custom-room-btn').forEach(b => b.classList.remove('active'));
    }
    if (currentUser.room === roomName) {
        socket.emit('leave voice');
        currentUser.room = null;
        cleanupCalls();
        connectedUsers = {};
        updateVoiceUsersList();
        renderCallHeader();
        renderPreviewUsers(); // сбрасывает заголовок "Ваш звонок" обратно, если он был показан
        setConnectRoomButtonState(false);
        screenBtn.disabled = true;
        screenBtn.title = 'Сначала подключитесь к голосовому каналу';
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

const playlistWidget = document.getElementById('playlist-widget');
const playlistWidgetInfo = document.getElementById('playlist-widget-info');
const playlistTrackNameEl = document.getElementById('playlist-track-name');
const playlistTrackSubEl = document.getElementById('playlist-track-sub');
const playlistPrevBtn = document.getElementById('playlist-prev-btn');
const playlistPlayPauseBtn = document.getElementById('playlist-playpause-btn');
const playlistNextBtn = document.getElementById('playlist-next-btn');
const playlistFileInput = document.getElementById('playlist-file-input');
const playlistFolderSelect = document.getElementById('playlist-folder-select');
const playlistFolderNewBtn = document.getElementById('playlist-folder-new-btn');
const playlistFolderDeleteBtn = document.getElementById('playlist-folder-delete-btn');
const playlistSettingsList = document.getElementById('playlist-settings-list');
const playlistEmptyHint = document.getElementById('playlist-empty-hint');
const playlistShuffleCheck = document.getElementById('playlist-shuffle-check');
const listenSessionBar = document.getElementById('listen-session-bar');
const listenSessionBarText = document.getElementById('listen-session-bar-text');
const listenSessionBarStop = document.getElementById('listen-session-bar-stop');
const listenSessionTrackName = document.getElementById('listen-session-track-name');
const listenSessionSeekRow = document.getElementById('listen-session-seek-row');
const listenSessionSeek = document.getElementById('listen-session-seek');
const listenSessionTimeCurrent = document.getElementById('listen-session-time-current');
const listenSessionTimeDuration = document.getElementById('listen-session-time-duration');
const listenSessionVolumeRow = document.getElementById('listen-session-volume-row');
const listenSessionVolume = document.getElementById('listen-session-volume');
const playlistSeekRow = document.getElementById('playlist-seek-row');
const playlistSeek = document.getElementById('playlist-seek');
const playlistTimeCurrent = document.getElementById('playlist-time-current');
const playlistTimeDuration = document.getElementById('playlist-time-duration');
const playlistVolumeBtn = document.getElementById('playlist-volume-btn');

// Обновляет видимую заливку кастомного таймлайна (Chrome/Edge рисуют её через CSS-переменную --fill,
// у Firefox заливка идёт нативно через ::-moz-range-progress)
function updateSeekFill(input) {
    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max) || 100;
    const val = parseFloat(input.value) || 0;
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', pct + '%');
}
[listenSessionSeek, playlistSeek].forEach(el => {
    if (el) el.addEventListener('input', () => updateSeekFill(el));
});

// Форматирует секунды в "м:сс" для меток времени плейлиста
function formatPlaylistTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}
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

const lowPerfModeCheck = document.getElementById('low-perf-mode-check');
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

// Кэш истории каналов в памяти ОТКЛЮЧЁН: раньше недавно открытые каналы держались в оперативной памяти,
// чтобы открываться мгновенно. Теперь канал каждый раз загружается с сервера, а в памяти остаётся
// только открытый. Чтобы вернуть кэш, поставьте число комнат больше нуля (например, 5).
const CHAT_HISTORY_CACHE_MAX_ROOMS = 0;
const CHAT_HISTORY_CACHE_MAX_MESSAGES = 100;
const chatHistoryCache = new Map();

// Непрочитанные сообщения: считаем только входящие сообщения чужих пользователей.
// Ограничиваем объём, чтобы состояние уведомлений не могло бесконечно расти.
const UNREAD_MAX_MESSAGES_PER_ROOM = 100;
const unreadByRoom = new Map();
const unreadStorageKey = 'muteUnreadMessages';

function loadUnreadState() {
    try {
        const raw = JSON.parse(localStorage.getItem(unreadStorageKey) || '{}');
        if (!raw || typeof raw !== 'object') return;
        for (const [room, value] of Object.entries(raw)) {
            const ids = Array.isArray(value) ? value.map(String).slice(-UNREAD_MAX_MESSAGES_PER_ROOM) : [];
            if (ids.length) unreadByRoom.set(room, ids);
        }
    } catch (_) {}
}

function saveUnreadState() {
    try {
        const out = {};
        unreadByRoom.forEach((ids, room) => { out[room] = ids.slice(-UNREAD_MAX_MESSAGES_PER_ROOM); });
        localStorage.setItem(unreadStorageKey, JSON.stringify(out));
    } catch (_) {}
}

function unreadCount(room) {
    return (unreadByRoom.get(String(room || '')) || []).length;
}

function updateUnreadBadge(room) {
    const key = String(room || '');
    if (!key) return;
    const buttons = document.querySelectorAll(`[data-room="${CSS.escape(key)}"]`);
    const count = unreadCount(key);
    buttons.forEach(btn => {
        let badge = btn.querySelector('.unread-count-badge');
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'unread-count-badge';
                btn.appendChild(badge);
            }
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.title = `${count} непрочитанных сообщений`;
        } else if (badge) {
            badge.remove();
        }
    });
}

function markRoomRead(room) {
    const key = String(room || '');
    if (!key) return;
    unreadByRoom.delete(key);
    saveUnreadState();
    updateUnreadBadge(key);
}

function addUnreadMessage(room, payload) {
    const key = String(room || '');
    if (!key || !payload?.id) return;
    const ids = unreadByRoom.get(key) || [];
    const id = String(payload.id);
    if (!ids.includes(id)) ids.push(id);
    if (ids.length > UNREAD_MAX_MESSAGES_PER_ROOM) ids.splice(0, ids.length - UNREAD_MAX_MESSAGES_PER_ROOM);
    unreadByRoom.set(key, ids);
    saveUnreadState();
    updateUnreadBadge(key);
}

function getUnreadIds(room) {
    return new Set((unreadByRoom.get(String(room || '')) || []).map(String));
}

// Снимок непрочитанных на момент открытия канала из кэша (см. selectRoomButton):
// { ids: Set, at: время открытия }. Время нужно, чтобы при перерисовке чата свежей
// историей подсветка продолжила гаснуть с того же места, а не вспыхнула заново.
const unreadSnapshotByRoom = new Map();
// Состояние, которое читают функции ниже по файлу (объявлено здесь заранее, чтобы
// не попасть во временную мёртвую зону — см. комментарий у mentionAutocompleteEl).
let previewUsers = {};          // участники просматриваемого канала, пока мы в звонке другого
let chatBulkRender = false;     // идёт пакетная отрисовка истории — не скроллим на каждом сообщении
let chatPinnedToBottom = true;  // человек сейчас у конца чата (обновляется по событию scroll)
let chatScrollAnchor = null;    // удерживаемая позиция чата (см. holdChatAnchor)
// Где человек остановился в каждом канале: { комната: { id последнего прочитанного сообщения, atBottom } }.
// Нужно, чтобы при возврате в канал чат вставал на последнее прочитанное, а не куда попало.
const CHAT_READ_POS_KEY = 'mute:chatReadPosition';
const CHAT_READ_POS_MAX_ROOMS = 50;
let chatRenderedRoom = null;       // чей чат сейчас отрисован в messagesDiv
let chatMemoryReleased = false;    // лента очищена ради экономии памяти (вкладка была неактивна), история загрузится при возврате
let chatReadPositionByRoom = {};
try {
    const rawPos = JSON.parse(localStorage.getItem(CHAT_READ_POS_KEY) || '{}');
    if (rawPos && typeof rawPos === 'object' && !Array.isArray(rawPos)) chatReadPositionByRoom = rawPos;
} catch (e) { /* ignore */ }
const UNREAD_FLASH_MS = 1000; // должно совпадать с длительностью unread-flash в index.html

loadUnreadState();

// В кэше аватар не нужен (лента его не рисует), а у старых сообщений он мог быть
// большой data-URL — не держим его в памяти ×100 сообщений ×каждый канал.
function slimCachedMessage(m) {
    if (!m || typeof m !== 'object' || !m.avatar) return m;
    const { avatar, ...rest } = m;
    return rest;
}

// Подпись набора сообщений (id + реакции): по ней видно, изменилась ли история.
function chatHistorySignature(list) {
    return (list || []).map(m => `${m.id}:${m.reactions ? JSON.stringify(m.reactions) : ''}`).join('|');
}

// Полная очистка ленты с освобождением картинок: пустой src заставляет браузер сразу
// выбросить декодированные кадры (особенно GIF), а не ждать сборщика мусора.
function clearChatMessages() {
    messagesDiv.querySelectorAll('img').forEach(img => { img.removeAttribute('src'); });
    messagesDiv.innerHTML = '';
}

function getCachedChatHistory(room) {
    if (CHAT_HISTORY_CACHE_MAX_ROOMS <= 0) return null;
    const key = String(room || '');
    const cached = chatHistoryCache.get(key);
    if (!cached) return null;
    // LRU: недавно использованный канал переносим в конец Map.
    chatHistoryCache.delete(key);
    chatHistoryCache.set(key, cached);
    return cached.messages;
}

function setCachedChatHistory(room, messages) {
    if (CHAT_HISTORY_CACHE_MAX_ROOMS <= 0) return;
    const key = String(room || '');
    if (!key || !Array.isArray(messages)) return;
    chatHistoryCache.delete(key);
    chatHistoryCache.set(key, {
        messages: messages.slice(-CHAT_HISTORY_CACHE_MAX_MESSAGES).map(slimCachedMessage)
    });
    while (chatHistoryCache.size > CHAT_HISTORY_CACHE_MAX_ROOMS) {
        const oldestKey = chatHistoryCache.keys().next().value;
        if (oldestKey === undefined) break;
        chatHistoryCache.delete(oldestKey);
    }
}

function appendMessageToChatCache(room, payload) {
    const key = String(room || '');
    if (!key || !payload) return;
    const cached = chatHistoryCache.get(key);
    if (!cached) return;
    const id = payload.id != null ? String(payload.id) : null;
    if (id && cached.messages.some(m => String(m.id) === id)) return;
    cached.messages.push(slimCachedMessage(payload));
    if (cached.messages.length > CHAT_HISTORY_CACHE_MAX_MESSAGES) {
        cached.messages.splice(0, cached.messages.length - CHAT_HISTORY_CACHE_MAX_MESSAGES);
    }
    chatHistoryCache.delete(key);
    chatHistoryCache.set(key, cached);
}

function removeMessageFromChatCache(room, id) {
    const key = String(room || '');
    const cached = chatHistoryCache.get(key);
    if (!cached) return;
    cached.messages = cached.messages.filter(m => String(m.id) !== String(id));
}

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
// Сообщение, на которое сейчас готовим ответ: { id, room, username, preview } (объявлено здесь
// же по той же причине — setChatEnabled вызывается при загрузке, см. комментарий выше).
let replyTarget = null;

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
    ['attach-file-btn', 'emoji-btn', 'gif-btn'].forEach(id => {
        const b = document.getElementById(id);
        if (b) b.disabled = !enabled;
    });
    if (!enabled && typeof clearReply === 'function') clearReply();
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

    // Native-события окна: точнее, чем blur/visibilitychange в WebView2.
    const refreshWindowActivity = async () => {
        try {
            windowMinimized = await tauriWindow.isMinimized();
            windowHasFocus = await tauriWindow.isFocused();
        } catch (e) { /* ignore */ }
        applyLowPerfState();
    };
    try { tauriWindow.onFocusChanged(({ payload }) => { windowHasFocus = !!payload; if (payload) windowMinimized = false; applyLowPerfState(); }); } catch (e) { /* ignore */ }
    try { tauriWindow.onResized(refreshWindowActivity); } catch (e) { /* ignore */ }

    if (minimizeBtn) minimizeBtn.addEventListener('click', () => { windowMinimized = true; applyLowPerfState(); tauriWindow.minimize(); });
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

// ---------- Иконка приложения в цвет темы ----------
// Значок микрофона (app-icon.png — одноцветный силуэт) перекрашивается в акцентный цвет
// (или вместо него берётся иконка, загруженная пользователем — см. importCustomIcon):
// во вкладке браузера — через favicon, в десктопном приложении — иконка окна и кнопка на
// панели задач (команда set_app_icon). Иконка самого .exe остаётся
// прежней (зашита при сборке), а у ярлыков иконка переписывается — см. syncShortcutIcon.
// (var, а не let: applyTheme может сработать раньше, чем выполнится эта строка.)
var appIconBaseImage = null;
var appIconTimer = null;
function loadAppIconBase() {
    return new Promise((resolve) => {
        if (appIconBaseImage) return resolve(appIconBaseImage);
        const img = new Image();
        img.onload = () => { appIconBaseImage = img; resolve(img); };
        img.onerror = () => resolve(null);
        img.src = '/app-icon.png';
    });
}
// Своя иконка пользователя (PNG 256x256 в виде data-URL). Если задана — используется вместо
// иконки в цвет темы: и для вкладки/окна/панели задач, и для ярлыков.
var CUSTOM_ICON_KEY = 'mute_custom_app_icon';
var customIconImage = null;
var customIconImageSrc = null;
function getCustomAppIcon() {
    try { return localStorage.getItem(CUSTOM_ICON_KEY) || null; } catch (e) { return null; }
}
function loadCustomIconImage(src) {
    return new Promise((resolve) => {
        if (customIconImage && customIconImageSrc === src) return resolve(customIconImage);
        const img = new Image();
        img.onload = () => { customIconImage = img; customIconImageSrc = src; resolve(img); };
        img.onerror = () => resolve(null);
        img.src = src;
    });
}
// Подпись текущей иконки: по ней решаем, нужно ли заново переписывать ярлыки.
function appIconSignature(color) {
    const c = getCustomAppIcon();
    if (!c) return color;
    let h = 0;
    for (let i = 0; i < c.length; i += 7) h = (h * 31 + c.charCodeAt(i)) | 0;
    return 'custom:' + c.length + ':' + h;
}
async function renderTintedAppIcon(color, size) {
    const custom = getCustomAppIcon();
    if (custom) {
        const img = await loadCustomIconImage(custom);
        if (img) {
            const cv = document.createElement('canvas');
            cv.width = cv.height = size;
            const ctx = cv.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, size, size);
            return cv;
        }
    }
    const base = await loadAppIconBase();
    if (!base) return null;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.drawImage(base, 0, 0, size, size);
    ctx.globalCompositeOperation = 'source-in'; // красим только сам силуэт, прозрачность сохраняется
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    return cv;
}
// Читает выбранную картинку и приводит к квадрату 256x256 (с прозрачными полями, без обрезки).
async function importCustomIcon(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw new Error('файл больше 5 МБ');
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('не удалось прочитать картинку'));
            i.src = url;
        });
        const w = img.naturalWidth || 256, h = img.naturalHeight || 256;
        const k = Math.min(256 / w, 256 / h);
        const dw = Math.round(w * k), dh = Math.round(h * k);
        const cv = document.createElement('canvas');
        cv.width = cv.height = 256;
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, Math.round((256 - dw) / 2), Math.round((256 - dh) / 2), dw, dh);
        localStorage.setItem(CUSTOM_ICON_KEY, cv.toDataURL('image/png'));
        customIconImage = null;
        customIconImageSrc = null;
    } finally {
        URL.revokeObjectURL(url);
    }
}
async function refreshIconPreview() {
    const img = document.getElementById('custom-icon-preview');
    const label = document.getElementById('custom-icon-state');
    const resetBtn = document.getElementById('custom-icon-reset-btn');
    const custom = !!getCustomAppIcon();
    if (label) label.textContent = custom ? 'Своя иконка.' : 'Иконка в цвет темы.';
    if (resetBtn) resetBtn.style.display = custom ? '' : 'none';
    if (img) {
        const cv = await renderTintedAppIcon((typeof currentTheme !== 'undefined' && currentTheme.accent) || '#6366f1', 96);
        if (cv) img.src = cv.toDataURL('image/png');
    }
}
async function updateAppIcon(color) {
    try {
        const small = await renderTintedAppIcon(color, 64);
        if (!small) return;
        let link = document.getElementById('app-favicon');
        if (!link) {
            link = document.createElement('link');
            link.id = 'app-favicon';
            link.rel = 'icon';
            document.head.appendChild(link);
        }
        link.type = 'image/png';
        link.href = small.toDataURL('image/png');
        refreshIconPreview();

        const t = window.__TAURI__;
        if (t && t.core && typeof t.core.invoke === 'function') {
            const big = await renderTintedAppIcon(color, 128);
            if (!big) return;
            const rgba = big.getContext('2d').getImageData(0, 0, 128, 128).data;
            await t.core.invoke('set_app_icon', { rgba: Array.from(rgba), width: 128, height: 128 });
            syncShortcutIcon(color);
        }
    } catch (e) { console.warn('[icon]', e); }
}
// Иконка ярлыков (рабочий стол, «Пуск», панель задач) — переписываем у существующих .lnk,
// удалять и создавать их заново не нужно. Только Windows-приложение; для того же цвета
// повторно не делаем (чтобы не гонять PowerShell при каждом запуске).
function setShortcutIconStatus(text, isError) {
    const el = document.getElementById('shortcut-icon-status');
    if (!el) return;
    el.textContent = text;
    el.style.display = text ? '' : 'none';
    el.style.color = isError ? 'var(--danger)' : 'var(--text-muted)';
}
// force=true — по кнопке: игнорируем запомненный цвет, а если ярлыков нет совсем — создаём
// ярлык на рабочем столе. Возвращает число обновлённых ярлыков или null при ошибке.
async function syncShortcutIcon(color, force) {
    const key = 'mute_shortcut_icon_color';
    try {
        const t = window.__TAURI__;
        if (!t || !t.core) return null;
        let prev = null;
        try { prev = localStorage.getItem(key); } catch (e) {}
        const sig = appIconSignature(color);
        if (!force && prev === sig) return null;
        const cv = await renderTintedAppIcon(color, 256);
        if (!cv) throw new Error('не удалось нарисовать иконку');
        const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
        if (!blob) throw new Error('не удалось сохранить PNG');
        const png = Array.from(new Uint8Array(await blob.arrayBuffer()));
        const res = await t.core.invoke('update_shortcut_icon', { png, create: !!force });
        const n = Array.isArray(res) ? res[0] : Number(res) || 0;
        const log = Array.isArray(res) ? String(res[1] || '') : '';
        if (n > 0) { try { localStorage.setItem(key, sig); } catch (e) {} } // 0 ярлыков — попробуем снова
        const msg = n > 0
            ? `Иконка обновлена у ярлыков: ${n}. Если на панели задач осталась старая — нажмите «Перезапустить Проводник».`
            : 'Ярлыки приложения не найдены. Нажмите «Обновить иконку ярлыков» в настройках → Кастомизация, чтобы создать ярлык на рабочем столе.';
        setShortcutIconStatus(msg + (force && log ? '\n\n' + log.trim() : ''), n === 0);
        if (force || n === 0 || prev) showToast(msg, 7000);
        return n;
    } catch (e) {
        console.warn('[shortcut-icon]', e);
        const m = 'Не удалось обновить иконку ярлыков: ' + (e && e.message ? e.message : String(e));
        setShortcutIconStatus(m, true);
        if (force) showToast(m, 7000);
        return null;
    }
}
document.addEventListener('DOMContentLoaded', () => {
    const upd = document.getElementById('shortcut-icon-update-btn');
    const rst = document.getElementById('shortcut-icon-explorer-btn');
    const pick = document.getElementById('custom-icon-upload-btn');
    const file = document.getElementById('custom-icon-file');
    const reset = document.getElementById('custom-icon-reset-btn');
    refreshIconPreview();
    if (pick && file) pick.addEventListener('click', () => file.click());
    if (file) file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        file.value = '';
        if (!f) return;
        try {
            await importCustomIcon(f);
        } catch (e) {
            const m = 'Не удалось загрузить иконку: ' + (e && e.message ? e.message : String(e));
            setShortcutIconStatus(m, true);
            showToast(m, 6000);
            return;
        }
        setShortcutIconStatus('Иконка загружена, применяю…', false);
        await updateAppIcon(currentTheme.accent);
        await refreshIconPreview();
        if (!(window.__TAURI__ && window.__TAURI__.core)) setShortcutIconStatus('Иконка вкладки обновлена.', false);
    });
    if (reset) reset.addEventListener('click', async () => {
        try { localStorage.removeItem(CUSTOM_ICON_KEY); } catch (e) {}
        customIconImage = null;
        customIconImageSrc = null;
        setShortcutIconStatus('Вернул иконку в цвет темы, применяю…', false);
        await updateAppIcon(currentTheme.accent);
        await refreshIconPreview();
        if (!(window.__TAURI__ && window.__TAURI__.core)) setShortcutIconStatus('', false);
    });
    if (upd) upd.addEventListener('click', async () => {
        upd.disabled = true;
        setShortcutIconStatus('Обновляю…', false);
        await syncShortcutIcon(currentTheme.accent, true);
        upd.disabled = false;
    });
    if (rst) rst.addEventListener('click', async () => {
        if (!confirm('Проводник перезапустится: на пару секунд пропадут панель задач и рабочий стол. Окна программ не закроются. Продолжить?')) return;
        try { await window.__TAURI__.core.invoke('restart_explorer'); } catch (e) { showToast('Не удалось перезапустить Проводник: ' + e, 6000); }
    });
});

// ---------- Автообновление приложения (Tauri updater) ----------
var appUpdateInfo = null;
var appUpdateBusy = false;
var APP_AUTO_UPDATE_KEY = 'mute_auto_update';
function isAutoUpdateOn() {
    try { return localStorage.getItem(APP_AUTO_UPDATE_KEY) !== '0'; } catch (e) { return true; }
}
function setUpdateStatus(text, isError) {
    const el = document.getElementById('app-update-status');
    if (!el) return;
    el.textContent = text;
    el.style.display = text ? '' : 'none';
    el.style.color = isError ? 'var(--danger)' : 'var(--text-muted)';
}
function isInCallNow() {
    try {
        return !!(typeof currentUser !== 'undefined' && currentUser && currentUser.room) ||
               (typeof activeCalls !== 'undefined' && Object.keys(activeCalls).length > 0);
    } catch (e) { return false; }
}
async function installAppUpdate() {
    const t = window.__TAURI__;
    if (!t || !t.core || appUpdateBusy) return;
    appUpdateBusy = true;
    const btn = document.getElementById('app-update-install-btn');
    if (btn) btn.disabled = true;
    setUpdateStatus('Устанавливаю ' + (appUpdateInfo ? appUpdateInfo.version : '') + '…', false);
    showToast('Устанавливаю обновление…', 6000);
    try {
        await t.core.invoke('install_update');
    } catch (e) {
        appUpdateBusy = false;
        if (btn) btn.disabled = false;
        const m = 'Не удалось установить обновление: ' + (e && e.message ? e.message : String(e));
        setUpdateStatus(m, true);
        showToast(m, 7000);
    }
}
async function checkAppUpdate(manual) {
    const t = window.__TAURI__;
    if (!t || !t.core || appUpdateBusy) return null;
    const checkBtn = document.getElementById('app-update-check-btn');
    const installBtn = document.getElementById('app-update-install-btn');
    if (manual) { if (checkBtn) checkBtn.disabled = true; setUpdateStatus('Проверяю…', false); }
    try {
        const r = await t.core.invoke('check_update');
        if (!r) {
            appUpdateInfo = null;
            if (installBtn) installBtn.style.display = 'none';
            if (manual) setUpdateStatus('У вас последняя версия.', false);
            return null;
        }
        appUpdateInfo = { version: r[0], current: r[1], notes: r[2] };
        if (installBtn) installBtn.style.display = '';
        setUpdateStatus('Доступна версия ' + r[0] + ' (у вас ' + r[1] + ').' + (r[2] ? '\n' + r[2] : ''), false);
        if (!manual && isAutoUpdateOn()) {
            if (isInCallNow()) showToast('Доступна версия ' + r[0] + ' — обновлюсь после звонка.', 6000);
            else installAppUpdate();
        } else if (!manual) {
            showToast('Доступна версия ' + r[0] + '. Настройки → Кастомизация.', 7000);
        }
        return appUpdateInfo;
    } catch (e) {
        console.warn('[update]', e);
        if (manual) setUpdateStatus('Не удалось проверить обновления: ' + (e && e.message ? e.message : String(e)), true);
        return null;
    } finally {
        if (manual && checkBtn) checkBtn.disabled = false;
    }
}
document.addEventListener('DOMContentLoaded', () => {
    const t = window.__TAURI__;
    if (!t || !t.core) return;
    const ver = document.getElementById('app-update-version');
    const auto = document.getElementById('auto-update-check');
    const checkBtn = document.getElementById('app-update-check-btn');
    const installBtn = document.getElementById('app-update-install-btn');
    t.core.invoke('app_version').then((v) => { if (ver) ver.textContent = 'Версия: ' + v; }).catch(() => {});
    if (auto) {
        auto.checked = isAutoUpdateOn();
        auto.addEventListener('change', () => {
            try { localStorage.setItem(APP_AUTO_UPDATE_KEY, auto.checked ? '1' : '0'); } catch (e) {}
        });
    }
    if (checkBtn) checkBtn.addEventListener('click', () => checkAppUpdate(true));
    if (installBtn) installBtn.addEventListener('click', () => installAppUpdate());
    setTimeout(() => checkAppUpdate(false), 8000);          // после запуска
    setInterval(() => { if (!appUpdateBusy) checkAppUpdate(false); }, 30 * 60 * 1000); // и раз в 30 минут
});


// ---------- Автообновление страницы после деплоя ----------
// Сервер отдаёт идентификатор версии клиента (/api/app-version). Если он изменился с момента загрузки
// страницы — перезагружаем её, но не во время звонка и не пока в поле сообщения набран текст.
var pageBuildId = null;
var pageReloadNotified = false;
function canReloadPageNow() {
    try {
        if (typeof isInCallNow === 'function' && isInCallNow()) return false;
        const input = document.getElementById('message-input');
        if (input && String(input.value || '').trim()) return false;
    } catch (e) {}
    return true;
}
async function checkPageVersion() {
    try {
        const r = await fetch('/api/app-version', { cache: 'no-store' });
        if (!r.ok) return;
        const { build } = await r.json();
        if (!build) return;
        if (pageBuildId === null) { pageBuildId = build; return; }
        if (build === pageBuildId) return;
        if (!canReloadPageNow()) {
            if (!pageReloadNotified) {
                pageReloadNotified = true;
                showToast('Вышла новая версия — обновлю после звонка.', 7000);
            }
            return;
        }
        // защита от цикла перезагрузок
        const last = Number(sessionStorage.getItem('mute_last_auto_reload') || 0);
        if (Date.now() - last < 30000) return;
        sessionStorage.setItem('mute_last_auto_reload', String(Date.now()));
        showToast('Обновляю страницу…', 2000);
        setTimeout(() => location.reload(), 1500);
    } catch (e) { /* сервер недоступен (идёт деплой) — проверим позже */ }
}
checkPageVersion();
setInterval(checkPageVersion, 60 * 1000);
window.addEventListener('focus', checkPageVersion);
socket.on('connect', () => setTimeout(checkPageVersion, 1500)); // после деплоя сокет переподключается


// ---------- Доступ приложения к микрофону (как разрешение в браузере, но только для Mute) ----------
// Это переключатель внутри приложения: когда доступ забран, микрофон физически отпускается
// (индикатор записи в системе гаснет), а в звонке вместо голоса идёт тишина. Системное разрешение
// Windows/браузера при этом не трогается — его по-прежнему можно менять в настройках системы.
var APP_MIC_KEY = 'mute_app_mic_allowed';
var appMicSilentTrack = null;
function appMicAllowed() {
    try { return localStorage.getItem(APP_MIC_KEY) !== '0'; } catch (e) { return true; }
}
async function releaseMicForApp() {
    if (appMicSilentTrack && !rawAudioStream && !processedTrack) return; // уже отпущен
    const old = processedTrack;
    if (rawAudioStream) { rawAudioStream.getTracks().forEach(t => t.stop()); rawAudioStream = null; }
    teardownAudioGraph(); // останавливает и processedTrack
    const silent = createSilentAudioTrack();
    if (!localMediaStream) localMediaStream = new MediaStream();
    if (old && localMediaStream.getAudioTracks().includes(old)) localMediaStream.removeTrack(old);
    localMediaStream.addTrack(silent);
    appMicSilentTrack = silent;
    replaceMicTrackForAllPeers(silent, old);
    applyGateToMicTrack();
}
async function refreshAppMicState() {
    const check = document.getElementById('app-mic-allowed');
    const label = document.getElementById('app-mic-state');
    const btn = document.getElementById('app-mic-request-btn');
    const allowed = appMicAllowed();
    if (check) check.checked = allowed;
    if (btn) btn.disabled = !allowed;
    if (!label) return;
    if (!allowed) { label.textContent = 'Доступ забран.'; return; }
    let sys = '';
    try {
        const st = await navigator.permissions.query({ name: 'microphone' });
        sys = st.state === 'granted' ? ' Система: разрешено.'
            : st.state === 'denied' ? ' Система: запрещено (Windows → Конфиденциальность → Микрофон).'
            : ' Система: ещё не запрашивалось.';
        st.onchange = () => refreshAppMicState();
    } catch (e) { /* permissions API недоступен */ }
    label.textContent = 'Доступ выдан.' + sys;
}
document.addEventListener('DOMContentLoaded', () => {
    const check = document.getElementById('app-mic-allowed');
    const btn = document.getElementById('app-mic-request-btn');
    refreshAppMicState();
    if (check) check.addEventListener('change', async () => {
        try { localStorage.setItem(APP_MIC_KEY, check.checked ? '1' : '0'); } catch (e) {}
        if (check.checked) {
            await initMediaStream(micSelect.value || null);
            showToast('Доступ к микрофону выдан.', 3500);
        } else {
            await releaseMicForApp();
            showToast('Доступ к микрофону забран.', 3500);
        }
        refreshAppMicState();
    });
    if (btn) btn.addEventListener('click', async () => {
        try {
            const st = await navigator.mediaDevices.getUserMedia({ audio: true });
            st.getTracks().forEach(t => t.stop());
            await loadMicrophones();
            showToast('Система разрешила микрофон.', 3500);
        } catch (e) {
            showToast('Система не дала доступ. Windows → Конфиденциальность → Микрофон.', 7000);
        }
        refreshAppMicState();
    });
});


// ---------- Выбор устройства вывода ----------
async function loadOutputDevices() {
    const sel = document.getElementById('output-select');
    if (!sel) return;
    if (typeof HTMLMediaElement.prototype.setSinkId !== 'function') {
        sel.innerHTML = '<option>Не поддерживается</option>';
        sel.disabled = true;
        return;
    }
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        sel.innerHTML = '';
        sel.appendChild(new Option('По умолчанию', ''));
        devices.filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
            .forEach((d, i) => sel.appendChild(new Option(d.label || ('Устройство ' + (i + 1)), d.deviceId)));
        sel.value = Array.from(sel.options).some(o => o.value === outputDeviceId) ? outputDeviceId : '';
    } catch (e) { console.warn(e); }
}
function applyOutputDeviceEverywhere() {
    if (typeof audioContext !== 'undefined') applySinkToContext(audioContext);
    document.querySelectorAll('audio, video').forEach(applySinkToElement);
    try { Object.values(notifyAudioCache || {}).forEach(applySinkToElement); } catch (e) {}
    try { applySinkToElement(playlistAudio); } catch (e) {}
    try { applySinkToElement(listenGuestAudio); } catch (e) {}
}
document.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('output-select');
    loadOutputDevices();
    if (sel) sel.addEventListener('change', () => {
        outputDeviceId = sel.value;
        try { localStorage.setItem(OUTPUT_DEVICE_KEY, outputDeviceId); } catch (e) {}
        applyOutputDeviceEverywhere();
        showToast('Устройство вывода изменено.', 2500);
    });
    if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', () => loadOutputDevices());
});

// ---------- Поиск по настройкам ----------
document.addEventListener('DOMContentLoaded', function () {
    const input = document.getElementById('settings-search');
    const box = document.getElementById('settings-search-results');
    const sidebar = document.querySelector('.settings-sidebar');
    if (!input || !box || !sidebar) return;
    const norm = (x) => String(x || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
    const tabNames = {};
    settingsTabButtons.forEach(b => { tabNames[b.dataset.tab] = ((b.querySelector('span') || b).textContent || '').trim(); });
    function collect() {
        const out = [];
        document.querySelectorAll('#settings-modal .settings-section').forEach(sec => {
            if (getComputedStyle(sec).display === 'none') return;
            const panel = sec.closest('.settings-tab-panel');
            if (!panel) return;
            const title = settingsSectionLabel(sec);
            out.push({ sec, tab: panel.dataset.tabPanel, title, tText: norm(title), text: norm(sec.textContent) });
        });
        return out;
    }
    function go(it) {
        input.value = '';
        run();
        switchSettingsTab(it.tab);
        setTimeout(() => {
            it.sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
            it.sec.classList.remove('flash-section');
            void it.sec.offsetWidth;
            it.sec.classList.add('flash-section');
            setTimeout(() => it.sec.classList.remove('flash-section'), 1000);
        }, 60);
    }
    function run() {
        const q = norm(input.value);
        sidebar.classList.toggle('searching', !!q);
        box.textContent = '';
        if (!q) return;
        const words = q.split(' ');
        const res = collect()
            .map(it => ({ it, score: words.every(w => it.tText.includes(w)) ? 2 : (words.every(w => it.text.includes(w)) ? 1 : 0) }))
            .filter(r => r.score)
            .sort((a, b) => b.score - a.score);
        if (!res.length) {
            const d = document.createElement('div');
            d.className = 'settings-search-empty';
            d.textContent = 'Ничего не найдено';
            box.appendChild(d);
            return;
        }
        res.forEach(({ it }) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'settings-search-item';
            const t = document.createElement('span');
            t.textContent = it.title || tabNames[it.tab];
            const g = document.createElement('small');
            g.textContent = tabNames[it.tab];
            b.append(t, g);
            b.addEventListener('click', () => go(it));
            box.appendChild(b);
        });
    }
    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { input.value = ''; run(); e.stopPropagation(); }
        else if (e.key === 'Enter') { const f = box.querySelector('.settings-search-item'); if (f) f.click(); }
    });
});

// ---------- Экспорт / импорт настроек ----------
// В файл попадают только настройки интерфейса и звука. Профиль, серверы, плейлист (он лежит
// в IndexedDB) и служебные значения конкретного компьютера не выгружаются.
function isExportableSettingKey(k) {
    if (k === 'voicechat_theme' || k === 'demoVolumes') return true;
    if (!/^mute[_:]/.test(k)) return false;
    return !/^(mute:chatReadPosition|mute_shortcut_icon_color|mute_output_device|mute:playlist\w*)$/.test(k);
}
document.addEventListener('DOMContentLoaded', () => {
    const exp = document.getElementById('settings-export-btn');
    const imp = document.getElementById('settings-import-btn');
    const file = document.getElementById('settings-import-file');
    if (exp) exp.addEventListener('click', () => {
        const data = {};
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (isExportableSettingKey(k)) data[k] = localStorage.getItem(k);
            }
        } catch (e) {}
        const blob = new Blob([JSON.stringify({ app: 'mute', version: 1, exported: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'mute-settings-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        showToast('Настройки сохранены в файл.', 3500);
    });
    if (imp && file) {
        imp.addEventListener('click', () => file.click());
        file.addEventListener('change', async () => {
            const f = file.files && file.files[0];
            file.value = '';
            if (!f) return;
            try {
                const obj = JSON.parse(await f.text());
                if (!obj || obj.app !== 'mute' || typeof obj.data !== 'object' || !obj.data) throw new Error('это не файл настроек Mute');
                const entries = Object.entries(obj.data).filter(([k, v]) => isExportableSettingKey(k) && typeof v === 'string');
                if (!entries.length) throw new Error('в файле нет настроек');
                if (!confirm('Загрузить настройки (' + entries.length + ')? Текущие будут заменены, страница перезагрузится.')) return;
                entries.forEach(([k, v]) => localStorage.setItem(k, v));
                showToast('Настройки загружены, перезагружаю…', 2500);
                setTimeout(() => location.reload(), 1200);
            } catch (e) {
                showToast('Не удалось загрузить настройки: ' + (e && e.message ? e.message : e), 6000);
            }
        });
    }
});

// ---------- Закрытие в трей (только десктоп) ----------
document.addEventListener('DOMContentLoaded', () => {
    const t = window.__TAURI__;
    if (!t || !t.core) return;
    const check = document.getElementById('close-to-tray-check');
    let on = true;
    try { on = localStorage.getItem('mute_close_to_tray') !== '0'; } catch (e) {}
    if (check) check.checked = on;
    t.core.invoke('set_close_to_tray', { enabled: on }).catch(() => {});
    if (check) check.addEventListener('change', () => {
        try { localStorage.setItem('mute_close_to_tray', check.checked ? '1' : '0'); } catch (e) {}
        t.core.invoke('set_close_to_tray', { enabled: check.checked }).catch(() => {});
    });
});

// Выбор цвета отдаёт десятки значений в секунду — обновляем иконку, когда выбор «устоялся».
function scheduleAppIconUpdate(color) {
    clearTimeout(appIconTimer);
    appIconTimer = setTimeout(() => updateAppIcon(color), 300);
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
    scheduleAppIconUpdate(accent);

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
    // Поле ввода — мягкий оттенок цвета окна: на тёмной теме чуть светлее фона, но темнее карточки-секции
    // (раньше было темнее фона — «чёрное», потом светлее карточки — не отличалось от блока);
    // на светлой — чуть светлее фона. Всё считается от выбранного цвета окна.
    const inputShift = isLightBg ? 4 : 7;
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
    // Оверлей перекрашивается вместе с приложением
    if (typeof window.muteOverlayThemeChanged === 'function') window.muteOverlayThemeChanged();
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
            const res = await authFetch('/auth/theme', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
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
        const res = await authFetch('/auth/theme');
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

// Запоминаем последний открытый канал/сервер, чтобы после обновления страницы (F5)
// снова открылась та же вкладка, а не пустой экран без выбранного канала.
const LAST_ROOM_KEY = 'lastSelectedRoom';
function saveLastRoom(room) {
    try {
        if (room) localStorage.setItem(LAST_ROOM_KEY, room);
        else localStorage.removeItem(LAST_ROOM_KEY);
    } catch (e) { /* ignore */ }
}
function loadLastRoom() {
    try { return localStorage.getItem(LAST_ROOM_KEY); } catch (e) { return null; }
}
// Восстанавливаем только один раз за загрузку страницы — как только пользователь
// сам кликнет по какому-то каналу, автоматическое восстановление больше не нужно.
let lastRoomRestored = false;
function tryRestoreLastRoom() {
    if (lastRoomRestored || selectedRoom) return;
    const room = loadLastRoom();
    if (!room) return;
    const btn = document.querySelector(`[data-room="${CSS.escape(room)}"]`);
    if (!btn) return;
    lastRoomRestored = true;
    selectRoomButton(btn);
}

let localMediaStream = null; 
let rawAudioStream = null;
let isMuted = false;
let isDeafened = false;
let activeCalls = {};
let connectedUsers = {};
// Только что вышедшие участники: пока метка жива, запоздавшие события ('mute state', входящий
// звонок) НЕ имеют права снова добавить человека в список — раньше они «воскрешали» ушедшего.
const recentlyLeftPeers = new Map(); // peerId -> время метки
function markPeerLeft(peerId) { if (peerId) recentlyLeftPeers.set(peerId, Date.now()); }
function clearPeerLeft(peerId) { recentlyLeftPeers.delete(peerId); }
function isPeerRecentlyLeft(peerId) {
    const t = recentlyLeftPeers.get(peerId);
    if (t === undefined) return false;
    if (Date.now() - t > 20000) { recentlyLeftPeers.delete(peerId); return false; }
    return true;
}
const roomUserCounts = {}; 
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

// ---------- Изменение голоса («Девчачий голос») ----------
// Между громкостью микрофона (micGainNode) и исходящим треком стоит узел voiceOutNode.
// Когда изменение голоса выключено, micGainNode подключён к нему напрямую; когда включено —
// сигнал идёт через AudioWorklet-питчшифтер (поднимает высоту голоса в реальном времени)
// и пару фильтров (срезаем «грудные» низы, чуть подсвечиваем верха), и уже потом уходит
// собеседникам и в самопрослушивание. Анализатор уровня/Voice Gate сидит на сыром
// источнике и от эффекта не зависит.
// Питчшифтер — классическая схема «две линии задержки с плавным кроссфейдом»: точка чтения
// движется по кольцевому буферу быстрее точки записи (ratio > 1 → выше по тону), а две
// точки, сдвинутые на полокна, перекрываются окном Ханна, чтобы не было щелчков на стыках.
const VOICE_CHANGER_PROCESSOR_NAME = 'mute-voice-changer';
const VOICE_CHANGER_PROCESSOR_CODE = `
class MuteVoiceChangerProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [{ name: 'ratio', defaultValue: 1.335, minValue: 0.5, maxValue: 2.5, automationRate: 'k-rate' }];
    }
    constructor() {
        super();
        this._size = 16384;                 // степень двойки, с запасом больше окна
        this._mask = this._size - 1;
        this._buf = new Float32Array(this._size);
        this._w = 0;                        // позиция записи
        this._win = Math.max(64, Math.min(this._size / 2 - 8, Math.round(sampleRate * 0.045)));
        this._phase = 0;                    // 0..1, положение первой линии задержки
    }
    process(inputs, outputs, parameters) {
        const output = outputs[0];
        if (!output || !output.length) return true;
        const out = output[0];
        const inp = inputs[0] && inputs[0][0];
        const ratio = parameters.ratio[0];
        const win = this._win, buf = this._buf, mask = this._mask;
        const step = (ratio - 1) / win;
        let w = this._w, phase = this._phase;
        for (let i = 0; i < out.length; i++) {
            buf[w] = inp ? inp[i] : 0;

            let p2 = phase + 0.5;
            if (p2 >= 1) p2 -= 1;
            const g1 = 0.5 - 0.5 * Math.cos(6.283185307179586 * phase);
            const g2 = 0.5 - 0.5 * Math.cos(6.283185307179586 * p2);

            const pos1 = w - (phase * win + 1);
            const i1 = Math.floor(pos1), f1 = pos1 - i1;
            const s1 = buf[i1 & mask] + (buf[(i1 + 1) & mask] - buf[i1 & mask]) * f1;

            const pos2 = w - (p2 * win + 1);
            const i2 = Math.floor(pos2), f2 = pos2 - i2;
            const s2 = buf[i2 & mask] + (buf[(i2 + 1) & mask] - buf[i2 & mask]) * f2;

            out[i] = s1 * g1 + s2 * g2;

            w = (w + 1) & mask;
            phase -= step;
            if (phase < 0) phase += 1;
            else if (phase >= 1) phase -= 1;
        }
        // Остальные каналы (если вход стерео) просто копируем — дальше всё равно моно.
        for (let c = 1; c < output.length; c++) output[c].set(out);
        this._w = w;
        this._phase = phase;
        return true;
    }
}
registerProcessor('${VOICE_CHANGER_PROCESSOR_NAME}', MuteVoiceChangerProcessor);
`;
const VOICE_CHANGER_DEFAULT_SEMITONES = 5;   // «девчачий» голос по умолчанию
const VOICE_CHANGER_MIN_SEMITONES = -10;
const VOICE_CHANGER_MAX_SEMITONES = 10;
let voiceChangerEnabled = false;
let voiceChangerSemitones = VOICE_CHANGER_DEFAULT_SEMITONES;
let voiceOutNode = null;        // выход «после эффекта» → исходящий трек и самопрослушивание
let voiceChain = null;          // { node, highpass, shelf } пока эффект включён
let voiceChangerApplyId = 0;    // защита от гонок при быстром переключении
let voiceChangerModulePromise = null;

function semitonesToRatio(st) { return Math.pow(2, st / 12); }

function ensureVoiceChangerModule(ctx) {
    if (!voiceChangerModulePromise) {
        const blob = new Blob([VOICE_CHANGER_PROCESSOR_CODE], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        voiceChangerModulePromise = ctx.audioWorklet.addModule(blobUrl).catch(err => {
            voiceChangerModulePromise = null;
            throw err;
        });
    }
    return voiceChangerModulePromise;
}

function disposeVoiceChain() {
    if (!voiceChain) return;
    Object.values(voiceChain).forEach(n => { try { n.disconnect(); } catch (e) { /* ignore */ } });
    voiceChain = null;
}

// Собирает маршрут micGainNode → (эффект) → voiceOutNode под текущую настройку.
// Можно вызывать в любой момент, в том числе посреди звонка: трек и его подключение
// к собеседникам не пересоздаются, меняется только путь сигнала внутри графа.
async function applyVoiceChanger() {
    const myId = ++voiceChangerApplyId;
    const ctx = audioContext, inNode = micGainNode, outNode = voiceOutNode;
    if (!ctx || !inNode || !outNode) return;

    disposeVoiceChain();
    try { inNode.disconnect(); } catch (e) { /* ignore */ }

    if (voiceChangerEnabled && ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        try {
            await ensureVoiceChangerModule(ctx);
            if (myId !== voiceChangerApplyId || micGainNode !== inNode) return; // пришёл более свежий вызов
            const node = new AudioWorkletNode(ctx, VOICE_CHANGER_PROCESSOR_NAME, {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [1]
            });
            node.parameters.get('ratio').value = semitonesToRatio(voiceChangerSemitones);

            const highpass = ctx.createBiquadFilter();
            highpass.type = 'highpass';
            highpass.frequency.value = 130;
            const shelf = ctx.createBiquadFilter();
            shelf.type = 'highshelf';
            shelf.frequency.value = 3200;
            shelf.gain.value = 3;
            // Кроссфейд двух линий задержки чуть «проседает» по громкости (около -3 дБ) —
            // компенсируем, чтобы с эффектом голос не звучал тише, чем без него.
            const makeup = ctx.createGain();
            makeup.gain.value = 1.3;

            inNode.connect(node);
            node.connect(highpass);
            highpass.connect(shelf);
            shelf.connect(makeup);
            makeup.connect(outNode);
            voiceChain = { node, highpass, shelf, makeup };
            return;
        } catch (e) {
            console.warn('[Голос] Не удалось включить изменение голоса, отправляем как есть:', e);
        }
    }
    if (myId !== voiceChangerApplyId || micGainNode !== inNode) return;
    try { inNode.connect(outNode); } catch (e) { /* ignore */ }
}


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
        this._off = false;
        // Команда с главного потока: { reportMs } — как часто слать отчёт; 0 — совсем не
        // считать и не слать. Используется ТОЛЬКО для метров чужих участников (они нужны
        // лишь для свечения "говорит"); метр собственного микрофона (гейт) не трогается.
        this.port.onmessage = (e) => {
            const ms = e.data && e.data.reportMs;
            if (typeof ms !== 'number') return;
            this._off = ms <= 0;
            if (ms > 0) this._samplesPerReport = Math.max(1, Math.round(sampleRate * ms / 1000));
            this._sumSquares = 0;
            this._count = 0;
        };
    }
    process(inputs) {
        if (this._off) return true; // метр выключен — вообще ничего не считаем
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
let micLastLevelAt = Date.now(); // когда метр уровня микрофона присылал данные в последний раз (для самовосстановления)
const GATE_HYSTERESIS_DB = 4;
// Раньше было жёстко зашито 300 мс — теперь регулируется ползунком в настройках
// (задержка перед тем, как гейт снова закроется/перестанет передавать после того,
// как вы замолчали; ползунок называется в интерфейсе "Задержка закрытия гейта").
let gateHangoverMs = 300;

// ---------- Рация (push-to-talk) ----------
// Включена: микрофон передаёт звук только пока удерживается назначенная клавиша
// (Voice Gate при этом не участвует). Небольшая задержка после отпускания — чтобы
// не обрезать конец слова.
const netQualityByPeer = {};   // peerId -> { level, title } (см. «Качество связи» ниже)
// Своя точка качества связи — пинг до сервера (объявлено здесь, рядом с netQualityByPeer, чтобы
// строка списка участников могла обратиться к ним в любой момент без TDZ).
const SELF_PING_TITLE_WAIT = 'Ваш пинг до сервера: измеряется…';
let selfNetQuality = { level: 'unknown', title: SELF_PING_TITLE_WAIT };
const selfPingSamples = [];
let selfPollScheduled = false;
let pttEnabled = false;
let pttHeld = false;
let pttReleaseTimer = null;
const PTT_RELEASE_DELAY_MS = 250;

// Единое правило «микрофон сейчас передаёт»: учитывает мьют/дефен, рацию и гейт.
// Модератор забрал у нас доступ к микрофону (см. событие 'mic access changed').
var micAccessRevoked = false;
function micShouldTransmit() {
    if (micAccessRevoked || !appMicAllowed() || isMuted || isDeafened) return false;
    if (pttEnabled) return pttHeld;
    return !gateEnabled || gateOpen;
}

function pttSet(down) {
    if (!pttEnabled) return;
    if (down) {
        if (pttReleaseTimer) { clearTimeout(pttReleaseTimer); pttReleaseTimer = null; }
        if (!pttHeld) { pttHeld = true; applyGateToMicTrack(); }
    } else {
        if (!pttHeld || pttReleaseTimer) return;
        pttReleaseTimer = setTimeout(() => {
            pttReleaseTimer = null;
            pttHeld = false;
            applyGateToMicTrack();
        }, PTT_RELEASE_DELAY_MS);
    }
}

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
// кодировании видео. Более высокие пресеты (вплоть до 4K/30 и 2K/60) доступны в настройках,
// но выбираются осознанно, а не включены по умолчанию, чтобы не грузить процессор всем
// без разбора.
const VIDEO_QUALITY_PRESETS = {
    '720p30': { width: 1280, height: 720, frameRate: 30 },
    '720p60': { width: 1280, height: 720, frameRate: 60 },
    '1080p30': { width: 1920, height: 1080, frameRate: 30 },
    '1080p60': { width: 1920, height: 1080, frameRate: 60 },
    '1440p30': { width: 2560, height: 1440, frameRate: 30 },
    '1440p60': { width: 2560, height: 1440, frameRate: 60 },
    '2160p30': { width: 3840, height: 2160, frameRate: 30 }
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
// Значения держим в памяти: раньше gain считался из localStorage, а запись туда шла с отложкой
// 250 мс — из-за этого громкость собеседника менялась с задержкой (и «догоняла» только когда
// перестаёшь двигать ползунок). Теперь память обновляется мгновенно, на диск пишем позже.
let remoteVolumesCache = null;
function loadRemoteVolumes() {
    if (remoteVolumesCache) return remoteVolumesCache;
    try {
        const raw = localStorage.getItem(REMOTE_VOLUME_STORAGE_KEY);
        remoteVolumesCache = raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { remoteVolumesCache = {}; }
    return remoteVolumesCache;
}
function getRemoteVolumePercent(username) {
    const all = loadRemoteVolumes();
    const key = username || '';
    return (key in all) ? all[key] : 100;
}
let remoteVolumeSaveTimer = null;
function saveRemoteVolume(username, percent) {
    const all = loadRemoteVolumes();
    all[username || ''] = percent; // сразу в память — gain читает отсюда
    if (remoteVolumeSaveTimer) clearTimeout(remoteVolumeSaveTimer);
    remoteVolumeSaveTimer = setTimeout(() => {
        remoteVolumeSaveTimer = null;
        try { localStorage.setItem(REMOTE_VOLUME_STORAGE_KEY, JSON.stringify(all)); } catch (e) {}
    }, 250);
}

// Заглушить участника только для себя (хранится на устройстве по нику).
const REMOTE_MUTE_STORAGE_KEY = 'mute:remoteMuted';
function loadRemoteMutes() {
    try { return JSON.parse(localStorage.getItem(REMOTE_MUTE_STORAGE_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function isRemoteLocallyMuted(username) {
    return !!loadRemoteMutes()[username || ''];
}
function setRemoteLocallyMuted(username, muted) {
    try {
        const all = loadRemoteMutes();
        if (muted) all[username || ''] = true; else delete all[username || ''];
        localStorage.setItem(REMOTE_MUTE_STORAGE_KEY, JSON.stringify(all));
    } catch (e) { /* ignore */ }
}
// Итоговая громкость голоса участника: 0 при дефене или локальном мьюте, иначе выставленная.
function remoteGainValue(username) {
    return (isDeafened || isRemoteLocallyMuted(username) || isUserMicRevoked(username)) ? 0 : getRemoteVolumePercent(username) / 100;
}
// Участнику забрали микрофон — его звук не воспроизводим (на случай, если его клиент всё равно шлёт аудио).
function isUserMicRevoked(username) {
    if (!username || typeof connectedUsers === 'undefined') return false;
    return Object.values(connectedUsers || {}).some(u => u && u.username === username && u.micRevoked);
}

(function applySavedAudioSettings() {
    const saved = loadAudioSettings();
    if (typeof saved.gateThreshold === 'number') gateThreshold = saved.gateThreshold;
    if (typeof saved.gateEnabled === 'boolean') gateEnabled = saved.gateEnabled;
    if (typeof saved.gateHangoverMs === 'number') gateHangoverMs = saved.gateHangoverMs;
    if (typeof saved.pttEnabled === 'boolean') pttEnabled = saved.pttEnabled;
    if (typeof saved.micVolume === 'number') micVolume = saved.micVolume;
    if (typeof saved.noiseSuppression === 'boolean' && noiseCheck) noiseCheck.checked = saved.noiseSuppression;
    if (typeof saved.echoCancellation === 'boolean' && echoCheck) echoCheck.checked = saved.echoCancellation;
    if (typeof saved.agc === 'boolean' && agcCheck) agcCheck.checked = saved.agc;
    if (typeof saved.voiceChangerEnabled === 'boolean') voiceChangerEnabled = saved.voiceChangerEnabled;
    if (typeof saved.voiceChangerSemitones === 'number') {
        voiceChangerSemitones = Math.min(VOICE_CHANGER_MAX_SEMITONES, Math.max(VOICE_CHANGER_MIN_SEMITONES, Math.round(saved.voiceChangerSemitones)));
    }
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
    const disabled = (gateEnabledCheck ? !gateEnabledCheck.checked : false) || pttEnabled;
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

// Встроенные звуки — собственный набор в духе современных мессенджеров (синтезированы, не записи):
// мягкие «капли» с быстрым скольжением высоты, пары нот вверх/вниз для входа/выхода и включения/выключения,
// колокольчик для упоминания и демонстрации. Для мьюта, дефена и демонстрации есть отдельные звуки на
// «включить» и «выключить» (unmute/undeafen/screenshareEnd); их громкость, свой файл и включение по
// каналам общие с основным звуком (см. SOUND_ALIAS).
//
// Звуки лежат ОТДЕЛЬНЫМИ файлами в папке /sounds (MP3, около 185 КБ всего), а не вшиты в скрипт строками
// base64 (это было ~1.2 МБ внутри script.js, которые браузер разбирал при каждой загрузке). Файлы
// скачиваются один раз и кэшируются надолго; при замене файла поднимите SOUNDS_VERSION, чтобы
// браузеры взяли новую версию. Звук начала созвона — мелодия около 10 секунд (три повтора фразы).
const SOUNDS_VERSION = 1;
const soundUrl = (name) => `/sounds/${name}.mp3?v=${SOUNDS_VERSION}`;
const NOTIFY_SOUNDS = {
    message: soundUrl('message'),
    mention: soundUrl('mention'),
    join: soundUrl('join'),
    leave: soundUrl('leave'),
    mute: soundUrl('mute'),
    unmute: soundUrl('unmute'),
    deafen: soundUrl('deafen'),
    undeafen: soundUrl('undeafen'),
    screenshare: soundUrl('screenshare'),
    screenshareEnd: soundUrl('screenshareEnd'),
    callstart: soundUrl('callstart')
};

const notifyAudioCache = {};
const activeNotifyAudio = {};
// Отдельно отслеживаем предпросмотр из настроек, чтобы кнопка могла остановить
// именно свой тестовый звук, не затрагивая реальные уведомления приложения.
const activePreviewAudio = {};

function trackNotifyAudio(key, audio) {
    if (!activeNotifyAudio[key]) activeNotifyAudio[key] = new Set();
    activeNotifyAudio[key].add(audio);
    const cleanup = () => activeNotifyAudio[key]?.delete(audio);
    audio.addEventListener('ended', cleanup, { once: true });
    audio.addEventListener('error', cleanup, { once: true });
}

function stopNotifySound(key) {
    const set = activeNotifyAudio[key];
    if (!set) return;
    for (const audio of Array.from(set)) {
        try { audio.pause(); audio.currentTime = 0; } catch (e) {}
        set.delete(audio);
    }
}


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
    mention: { volumeKey: 'mentionVolume', customKey: 'customMentionSound', nameKey: 'customMentionSoundName', defaultVolume: 0.7 },
    callstart: { volumeKey: 'callstartVolume', customKey: 'customCallstartSound', nameKey: 'customCallstartSoundName', defaultVolume: 0.4 }
};

// ---------- Звук начала созвона: включение/выключение отдельно по каждому каналу ----------
// Хранится отдельно от общих настроек громкости — это список каналов (room id),
// для которых пользователь явно ОТКЛЮЧИЛ звук начала созвона. Отсутствие канала
// в списке значит "звук включён" (поведение по умолчанию).
// Для каждого уведомительного звука можно отдельно отключать конкретные голосовые каналы.
// Отсутствие канала в списке означает, что звук включён (так сохраняется старое поведение).
const SOUND_CHANNELS_KEY = 'mute:soundDisabledChannels';
const LEGACY_CALLSTART_CHANNELS_KEY = 'mute:callstartDisabledChannels';

function loadSoundDisabledChannels() {
    try {
        const raw = localStorage.getItem(SOUND_CHANNELS_KEY);
        const data = raw ? JSON.parse(raw) : {};
        if (data && typeof data === 'object' && !Array.isArray(data)) return data;
        return {};
    } catch (e) { return {}; }
}

function migrateLegacyCallstartChannels() {
    try {
        const data = loadSoundDisabledChannels();
        if (Array.isArray(data.callstart)) return;
        const legacyRaw = localStorage.getItem(LEGACY_CALLSTART_CHANNELS_KEY);
        const legacy = legacyRaw ? JSON.parse(legacyRaw) : [];
        if (Array.isArray(legacy) && legacy.length) {
            data.callstart = legacy;
            saveSoundDisabledChannels(data);
        }
    } catch (e) {}
}

migrateLegacyCallstartChannels();

function saveSoundDisabledChannels(data) {
    try { localStorage.setItem(SOUND_CHANNELS_KEY, JSON.stringify(data)); } catch (e) {}
}

function isSoundEnabledForChannel(key, roomId) {
    if (!roomId) return true;
    const data = loadSoundDisabledChannels();
    return !Array.isArray(data[key]) || !data[key].includes(roomId);
}

function setSoundEnabledForChannel(key, roomId, enabled) {
    if (!roomId) return;
    const data = loadSoundDisabledChannels();
    const list = Array.isArray(data[key]) ? data[key].slice() : [];
    const idx = list.indexOf(roomId);
    if (enabled && idx !== -1) list.splice(idx, 1);
    else if (!enabled && idx === -1) list.push(roomId);
    data[key] = list;
    saveSoundDisabledChannels(data);
}

// Совместимость со старой настройкой только для звука начала созвона.
function isCallstartEnabledForChannel(roomId) {
    return isSoundEnabledForChannel('callstart', roomId);
}
function setCallstartEnabledForChannel(roomId, enabled) {
    setSoundEnabledForChannel('callstart', roomId, enabled);
}

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

// Пары «включить/выключить»: у второго звука свой встроенный файл, а настройки общие с основным.
const SOUND_ALIAS = { unmute: 'mute', undeafen: 'deafen', screenshareEnd: 'screenshare' };

function getNotifyAudio(key) {
    // Источник может смениться в рантайме (загрузили свой файл или сбросили на
    // стандартный) — поэтому кэш не просто "разово заполнили и забыли", а сверяем
    // src при каждом обращении.
    // свой файл, загруженный для основного звука, играет в обоих состояниях
    const src = getCustomSound(SOUND_ALIAS[key] || key) || NOTIFY_SOUNDS[key];
    const cached = notifyAudioCache[key];
    if (!cached || cached.src !== src) {
        const audio = new Audio(src);
        audio.preload = 'auto';
        notifyAudioCache[key] = audio;
    }
    return notifyAudioCache[key];
}

// Прогрев: когда браузер свободен, в фоне подгружаем все встроенные звуки (около 185 КБ, дальше они
// берутся из кэша). Так загрузка страницы не ждёт звуки, а первое воспроизведение всё равно мгновенное.
(function warmUpNotifySounds() {
    const run = () => Object.keys(NOTIFY_SOUNDS).forEach((k) => { try { getNotifyAudio(k); } catch (e) { /* не критично */ } });
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 });
    else setTimeout(run, 2000);
})();

// ---------- Подсветка на панели задач ----------
// Когда окно не в фокусе, а пришло сообщение / упоминание / шёпот / начался созвон / кто-то
// зашёл в канал — мигает кнопка приложения на панели задач (в десктопном приложении) или
// меняется заголовок вкладки (в браузере). Гаснет само, как только вернётесь в окно.
// Подсветка идёт вместе со звуком, поэтому подчиняется тем же настройкам звука каналов.
const TASKBAR_FLASH_KEYS = new Set(['message', 'mention', 'callstart', 'join']);
const BASE_PAGE_TITLE = document.title || 'Mute';
let titleFlashOn = false;
function flashTaskbar() {
    if (document.hasFocus() && !document.hidden) return;
    const t = window.__TAURI__;
    if (t && t.core && typeof t.core.invoke === 'function') {
        t.core.invoke('flash_window').catch(e => console.warn('[flash]', e));
        return;
    }
    if (!titleFlashOn) {
        titleFlashOn = true;
        document.title = `🔴 ${BASE_PAGE_TITLE}`;
    }
}
function clearTitleFlash() {
    if (!titleFlashOn) return;
    titleFlashOn = false;
    document.title = BASE_PAGE_TITLE;
}
window.addEventListener('focus', clearTitleFlash);
document.addEventListener('visibilitychange', () => { if (!document.hidden) clearTitleFlash(); });

// Проигрывает звук уведомления. Клонируем элемент, чтобы звуки могли накладываться
// друг на друга (например, если несколько человек заходят подряд).
function playNotifySound(key, volume = 0.6, roomId = null) {
    const baseKey = SOUND_ALIAS[key] || key;
    if (roomId && !isSoundEnabledForChannel(baseKey, roomId)) return null;
    // Событие, о котором сообщает звук, заодно подсвечивает окно на панели задач.
    if (TASKBAR_FLASH_KEYS.has(baseKey)) flashTaskbar();
    try {
        const base = getNotifyAudio(key);
        const instance = base.cloneNode(true);
        instance.volume = volume;
        trackNotifyAudio(key, instance);
        instance.play().catch(() => {});
        return instance;
    } catch (e) {
        console.warn('[Звук] Не удалось воспроизвести звук уведомления:', e);
        return null;
    }
}

// Новое сообщение в чате
function playMessageSound(room = selectedRoom) {
    playNotifySound('message', getSoundVolume('message'), room);
}

// Кто-то зашёл в комнату
function playJoinSound() {
    playNotifySound('join', getSoundVolume('join'), currentUser.room || selectedRoom);
}

// Кто-то вышел из комнаты
function playLeaveSound() {
    playNotifySound('leave', getSoundVolume('leave'), currentUser.room || selectedRoom);
}

// Звук входа/выхода ЧУЖОГО участника. Один и тот же вход/выход может прийти сразу
// несколькими путями ('room users' с разницей списков и отдельные 'user connected'/
// 'user disconnected'), поэтому одинаковый звук для того же человека в пределах пары
// секунд не повторяем.
const recentPresenceSounds = {};
function playPresenceSound(kind, peerId) {
    const key = `${kind}:${peerId}`;
    const now = Date.now();
    if (recentPresenceSounds[key] && now - recentPresenceSounds[key] < 2500) return;
    recentPresenceSounds[key] = now;
    if (kind === 'join') playJoinSound(); else playLeaveSound();
}

// Свой или чужой мьют микрофона включился/выключился. Раньше звук генерировался
// на лету осциллятором (Web Audio) и не мог быть заменён своим файлом — теперь
// это обычный настраиваемый звук уведомления, как сообщения/вход/выход.
function playMuteSound(on = true) {
    playNotifySound(on ? 'mute' : 'unmute', getSoundVolume('mute'), currentUser.room || selectedRoom);
}

// Свой или чужой дефен (выключение наушников) включился/выключился.
function playDeafenSound(on = true) {
    playNotifySound(on ? 'deafen' : 'undeafen', getSoundVolume('deafen'), currentUser.room || selectedRoom);
}

// Старт/остановка демонстрации экрана или веб-камеры.
function playScreenShareSound(on = true) {
    playNotifySound(on ? 'screenshare' : 'screenshareEnd', getSoundVolume('screenshare'), currentUser.room || selectedRoom);
}

// Кто-то упомянул нас через @ник в чате — отдельный, более заметный звук,
// проигрывается ВМЕСТО обычного звука сообщения (см. обработчик 'chat message').
function playMentionSound(room = selectedRoom) {
    playNotifySound('mention', getSoundVolume('mention'), room);
}

// Мелодия начала созвона — рингтон для участника, которому начинают звонить.
// Вызывающий её не слышит; звук включается отдельно для каждого канала.
// Настройка «Не беспокоить в звонке» (Спец. возможности): пока человек разговаривает в
// голосовом канале с кем-то, мелодия начала другого созвона не играет. Хранится на устройстве.
const CALLSTART_QUIET_IN_CALL_KEY = 'mute:callstartQuietInCall';
let callstartQuietInCall = false;
try { callstartQuietInCall = localStorage.getItem(CALLSTART_QUIET_IN_CALL_KEY) === '1'; } catch (e) { /* ignore */ }

// «В гс с кем-то» — мы в голосовом канале и там есть хотя бы один другой участник.
function isInCallWithSomeone() {
    if (!currentUser.room) return false;
    return Object.keys(connectedUsers || {}).some(peerId => peerId !== myPeerId);
}

function playCallstartSound(roomId) {
    if (!roomId || !isCallstartEnabledForChannel(roomId)) return;
    if (callstartQuietInCall && isInCallWithSomeone()) return;
    // Это рингтон для того, кому уже звонят: вызывающий сам его не слышит.
    playNotifySound('callstart', getSoundVolume('callstart'), roomId);
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
        const setPreviewState = (playing) => {
            if (playing) {
                els.testBtn.title = 'Остановить';
                els.testBtn.setAttribute('aria-label', 'Остановить');
                els.testBtn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"></rect></svg>';
            } else {
                els.testBtn.title = 'Проверить';
                els.testBtn.setAttribute('aria-label', 'Проверить');
                els.testBtn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
            }
        };

        els.testBtn.addEventListener('click', () => {
            const current = activePreviewAudio[key];
            if (current && !current.paused && !current.ended) {
                try { current.pause(); current.currentTime = 0; } catch (e) {}
                delete activePreviewAudio[key];
                setPreviewState(false);
                return;
            }

            const audio = playNotifySound(key, getSoundVolume(key));
            if (!audio) return;
            activePreviewAudio[key] = audio;
            setPreviewState(true);

            const finish = () => {
                if (activePreviewAudio[key] === audio) {
                    delete activePreviewAudio[key];
                    setPreviewState(false);
                }
            };
            audio.addEventListener('ended', finish, { once: true });
            audio.addEventListener('error', finish, { once: true });
        });
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

const callstartSoundVolumeSlider = document.getElementById('callstart-sound-volume-slider');
const callstartSoundVolumeValueDisplay = document.getElementById('callstart-sound-volume-value');
const callstartSoundCurrentLabel = document.getElementById('callstart-sound-current-label');
const callstartSoundTestBtn = document.getElementById('callstart-sound-test-btn');
const callstartSoundFileInput = document.getElementById('callstart-sound-file-input');
const callstartSoundResetBtn = document.getElementById('callstart-sound-reset-btn');
setupCustomSoundControls('callstart', {
    slider: callstartSoundVolumeSlider,
    valueDisplay: callstartSoundVolumeValueDisplay,
    label: callstartSoundCurrentLabel,
    testBtn: callstartSoundTestBtn,
    fileInput: callstartSoundFileInput,
    resetBtn: callstartSoundResetBtn
});

// ---------- Списки каналов для каждого уведомительного звука ----------
// Каждый звук получает компактную кнопку со стрелкой. Список по умолчанию скрыт,
// а состояние чекбоксов хранится локально отдельно для каждого типа звука.
const soundChannelKeys = Object.keys(CUSTOM_SOUND_TYPES);

function renderSoundChannelLists() {
    const buttons = Array.from(document.querySelectorAll('.custom-room-btn[data-room]'));
    document.querySelectorAll('.sound-channel-wrap').forEach(wrap => {
        const key = wrap.dataset.soundKey;
        const list = wrap.querySelector('.sound-channel-list');
        if (!list || !key) return;
        list.innerHTML = '';
        if (!buttons.length) {
            const empty = document.createElement('span');
            empty.className = 'profile-hint';
            empty.textContent = 'Каналов пока нет.';
            list.appendChild(empty);
            return;
        }
        const seen = new Set();
        buttons.forEach(btn => {
            const roomId = btn.dataset.room;
            if (!roomId || seen.has(roomId)) return;
            seen.add(roomId);
            const row = document.createElement('label');
            row.className = 'sound-channel-row checkbox-label';
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.checked = isSoundEnabledForChannel(key, roomId);
            check.addEventListener('change', () => setSoundEnabledForChannel(key, roomId, check.checked));
            const text = document.createElement('span');
            text.textContent = btn.dataset.displayName || roomId;
            row.append(check, text);
            list.appendChild(row);
        });
    });
}

function setupSoundChannelLists() {
    document.querySelectorAll('.sound-row').forEach(row => {
        const testBtn = row.querySelector('[id$="-sound-test-btn"]');
        if (!testBtn) return;
        const match = testBtn.id.match(/^([a-z]+)-sound-test-btn$/);
        const key = match?.[1];
        if (!key || !CUSTOM_SOUND_TYPES[key] || row.querySelector('.sound-channel-wrap')) return;

        // Удаляем старую встроенную разметку callstart из предыдущей версии.
        row.querySelectorAll('.callstart-channels-wrap').forEach(el => el.remove());

        const top = row.querySelector('.sound-row-top');
        if (top) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'sound-channel-toggle';
            toggle.title = 'Показать каналы';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
            top.appendChild(toggle);

            const wrap = document.createElement('div');
            wrap.className = 'sound-channel-wrap';
            wrap.dataset.soundKey = key;
            wrap.hidden = true;
            wrap.innerHTML = '<div class="sound-channel-title">Каналы для этого звука</div><div class="sound-channel-list"></div>';
            row.appendChild(wrap);
            toggle.addEventListener('click', () => {
                const open = wrap.hidden;
                wrap.hidden = !open;
                toggle.setAttribute('aria-expanded', String(open));
                toggle.title = open ? 'Скрыть каналы' : 'Показать каналы';
                toggle.innerHTML = open
                    ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"></polyline></svg>'
                    : '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
            });
        }
    });
    renderSoundChannelLists();
}

setupSoundChannelLists();

// ---------- Свой плейлист ----------
// Личный, локальный (не синхронизируется между устройствами/участниками) плейлист:
// виджет с названием трека и управлением — над кнопками мьюта/наушников/настроек,
// а добавление и удаление треков — в настройках, вкладка "Плейлист".
// Сами аудиофайлы (могут весить по несколько МБ) хранятся в IndexedDB — localStorage
// для этого не годится (лимит браузера обычно ~5 МБ на весь домен). В localStorage
// лежат только лёгкие метаданные (id/название/порядок), чтобы список треков и
// текущий трек мгновенно восстанавливались при перезагрузке страницы.
const PLAYLIST_DB_NAME = 'mutePlaylistDB';
const PLAYLIST_DB_STORE = 'tracks';
const PLAYLIST_META_KEY = 'mute:playlistMeta';
const PLAYLIST_MAX_TRACK_SIZE = 20 * 1024 * 1024; // 20 МБ на трек

let playlistDbPromise = null;
function openPlaylistDb() {
    if (!window.indexedDB) return Promise.reject(new Error('IndexedDB недоступен'));
    if (playlistDbPromise) return playlistDbPromise;
    playlistDbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(PLAYLIST_DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(PLAYLIST_DB_STORE)) {
                db.createObjectStore(PLAYLIST_DB_STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return playlistDbPromise;
}
async function playlistDbPut(id, blob) {
    const db = await openPlaylistDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(PLAYLIST_DB_STORE, 'readwrite');
        tx.objectStore(PLAYLIST_DB_STORE).put({ id, blob });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
async function playlistDbGet(id) {
    const db = await openPlaylistDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(PLAYLIST_DB_STORE, 'readonly');
        const req = tx.objectStore(PLAYLIST_DB_STORE).get(id);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error);
    });
}
async function playlistDbDelete(id) {
    const db = await openPlaylistDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(PLAYLIST_DB_STORE, 'readwrite');
        tx.objectStore(PLAYLIST_DB_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function loadPlaylistMeta() {
    try {
        const raw = localStorage.getItem(PLAYLIST_META_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}
function savePlaylistMeta(list) {
    try { localStorage.setItem(PLAYLIST_META_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}

const PLAYLIST_FOLDERS_KEY = 'mute:playlistFolders';
const PLAYLIST_ACTIVE_FOLDER_KEY = 'mute:playlistActiveFolder';
function loadPlaylistFolders() {
    try {
        const raw = JSON.parse(localStorage.getItem(PLAYLIST_FOLDERS_KEY) || '[]');
        return Array.isArray(raw) && raw.length ? raw : [{ id: 'folder_default', name: 'Моя музыка' }];
    } catch (e) {
        return [{ id: 'folder_default', name: 'Моя музыка' }];
    }
}
function savePlaylistFolders() {
    try { localStorage.setItem(PLAYLIST_FOLDERS_KEY, JSON.stringify(playlistFolders)); } catch (e) {}
}
let playlistFolders = loadPlaylistFolders();
let playlistActiveFolderId = localStorage.getItem(PLAYLIST_ACTIVE_FOLDER_KEY) || playlistFolders[0].id;
if (!playlistFolders.some(f => f.id === playlistActiveFolderId)) playlistActiveFolderId = playlistFolders[0].id;

let playlistTracks = loadPlaylistMeta(); // все треки; folderId определяет папку
let playlistCurrentIndex = -1;
function migratePlaylistFolders() {
    let changed = false;
    playlistTracks.forEach(t => {
        if (!t.folderId) { t.folderId = playlistFolders[0].id; changed = true; }
    });
    if (changed) savePlaylistMeta(playlistTracks);
    savePlaylistFolders();
}
migratePlaylistFolders();

function getActivePlaylistTracks() {
    return playlistTracks.filter(t => t.folderId === playlistActiveFolderId);
}
const playlistAudio = new Audio();
let playlistCurrentObjectUrl = null;
let playlistTrackLoading = false;

// Случайный порядок воспроизведения плейлиста — настройка хранится локально
const PLAYLIST_SHUFFLE_KEY = 'mute_playlist_shuffle';
function loadPlaylistShuffle() {
    try { return localStorage.getItem(PLAYLIST_SHUFFLE_KEY) === '1'; } catch (e) { return false; }
}
function savePlaylistShuffle(value) {
    try { localStorage.setItem(PLAYLIST_SHUFFLE_KEY, value ? '1' : '0'); } catch (e) { /* ignore */ }
}
let playlistShuffle = loadPlaylistShuffle();
if (playlistShuffleCheck) playlistShuffleCheck.checked = playlistShuffle;
if (playlistShuffleCheck) {
    playlistShuffleCheck.addEventListener('change', () => {
        playlistShuffle = playlistShuffleCheck.checked;
        savePlaylistShuffle(playlistShuffle);
    });
}
// Возвращает случайный индекс трека, отличный от текущего (если треков больше одного)
function getRandomPlaylistIndex() {
    if (getActivePlaylistTracks().length <= 1) return 0;
    let idx;
    do {
        idx = Math.floor(Math.random() * getActivePlaylistTracks().length);
    } while (idx === playlistCurrentIndex);
    return idx;
}

// Личная громкость музыки (плейлиста и совместного прослушивания) — у каждого своя,
// хранится только на этом устройстве и никогда не передаётся собеседнику.
const PLAYLIST_VOLUME_KEY = 'mute_playlist_volume';
// HTMLMediaElement.volume ограничен 1.0, поэтому ползунок 100–150% ничего не менял, а линейная
// шкала на слух почти не отличается между соседними значениями. Теперь 0–100% и кривая громкости
// (квадрат), как в системных микшерах: каждый шаг ползунка заметно слышен.
function playlistVolumeToGain(percent) {
    const p = Math.min(100, Math.max(0, Number(percent) || 0)) / 100;
    return p * p;
}
function loadPlaylistVolumePercent() {
    try {
        const raw = localStorage.getItem(PLAYLIST_VOLUME_KEY);
        const n = raw === null ? 70 : parseInt(raw, 10);
        return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 70;
    } catch (e) { return 70; }
}
function setPlaylistVolumePercent(percent) {
    const clamped = Math.min(100, Math.max(0, percent));
    playlistAudio.volume = playlistVolumeToGain(clamped);
    listenGuestAudioVolumeSafeSet(clamped);
    try { localStorage.setItem(PLAYLIST_VOLUME_KEY, String(clamped)); } catch (e) { /* ignore */ }
    if (playlistVolumeRangeEl) playlistVolumeRangeEl.value = clamped;
    if (listenSessionVolume) listenSessionVolume.value = clamped;
}
// listenGuestAudio объявлен чуть ниже по файлу — обёртка на случай вызова раньше инициализации
function listenGuestAudioVolumeSafeSet(percent) {
    if (typeof listenGuestAudio !== 'undefined' && listenGuestAudio) {
        listenGuestAudio.volume = playlistVolumeToGain(percent);
    }
}
let playlistVolumePercent = loadPlaylistVolumePercent();
playlistAudio.volume = playlistVolumeToGain(playlistVolumePercent);
let playlistVolumeRangeEl = null; // ссылка на ползунок внутри попапа громкости плейлиста, пока он открыт

function stripExt(name) {
    const idx = String(name || '').lastIndexOf('.');
    return idx > 0 ? name.slice(0, idx) : name;
}

function updatePlaylistWidget() {
    const hasTracks = getActivePlaylistTracks().length > 0;
    playlistWidget.classList.toggle('has-tracks', hasTracks);
    const current = getActivePlaylistTracks()[playlistCurrentIndex];
    if (current) {
        playlistTrackNameEl.textContent = stripExt(current.name);
        const folderNow = playlistFolders.find(f => f.id === playlistActiveFolderId);
        playlistTrackSubEl.textContent = `${folderNow ? folderNow.name : 'Плейлист'} · ${playlistCurrentIndex + 1} из ${getActivePlaylistTracks().length}`;
    } else {
        playlistTrackNameEl.textContent = 'Нет трека';
        playlistTrackSubEl.textContent = hasTracks ? 'Выберите трек' : 'Плейлист пуст';
    }
    const isPlaying = !playlistAudio.paused && !!current;
    playlistPlayPauseBtn.classList.toggle('is-playing', isPlaying);
    const noTracks = !hasTracks;
    playlistPrevBtn.disabled = noTracks;
    playlistNextBtn.disabled = noTracks;
    playlistPlayPauseBtn.disabled = noTracks;
}

const PL_ICON = {
    chevron: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
    plus: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>',
    edit: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
    trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>',
    play: '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"></polygon></svg>',
    x: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>',
    grip: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.6"></circle><circle cx="15" cy="6" r="1.6"></circle><circle cx="9" cy="12" r="1.6"></circle><circle cx="15" cy="12" r="1.6"></circle><circle cx="9" cy="18" r="1.6"></circle><circle cx="15" cy="18" r="1.6"></circle></svg>'
};
let playlistDragTrackId = null;
let playlistAddTargetFolderId = null; // в какой плейлист добавляем выбранные файлы

function playlistTrackIndexInFolder(folderId, trackId) {
    return playlistTracks.filter(t => t.folderId === folderId).findIndex(t => t.id === trackId);
}

// Переключает «текущий» плейлист (тот, из которого играют и который показывает виджет).
function switchPlaylistFolder(folderId) {
    if (folderId === playlistActiveFolderId || !playlistFolders.some(f => f.id === folderId)) return;
    playlistActiveFolderId = folderId;
    localStorage.setItem(PLAYLIST_ACTIVE_FOLDER_KEY, playlistActiveFolderId);
    playlistCurrentIndex = -1;
    playlistAudio.pause();
    playlistAudio.removeAttribute('src');
    if (playlistCurrentObjectUrl) { URL.revokeObjectURL(playlistCurrentObjectUrl); playlistCurrentObjectUrl = null; }
}

// Нажатие на трек в любом плейлисте: делаем его текущим и играем
function playTrackFromFolder(folderId, trackId) {
    switchPlaylistFolder(folderId);
    const idx = playlistTrackIndexInFolder(folderId, trackId);
    if (idx !== -1) playPlaylistTrack(idx);
}

function movePlaylistTrackToFolder(trackId, folderId) {
    const track = playlistTracks.find(t => t.id === trackId);
    if (!track || track.folderId === folderId || !playlistFolders.some(f => f.id === folderId)) return;
    // запоминаем, какой трек играет, чтобы индекс остался верным после переноса
    const curId = (getActivePlaylistTracks()[playlistCurrentIndex] || {}).id;
    track.folderId = folderId;
    savePlaylistMeta(playlistTracks);
    if (curId) {
        if (curId === trackId && folderId !== playlistActiveFolderId) {
            playlistAudio.pause();
            playlistAudio.removeAttribute('src');
            if (playlistCurrentObjectUrl) { URL.revokeObjectURL(playlistCurrentObjectUrl); playlistCurrentObjectUrl = null; }
            playlistCurrentIndex = -1;
        } else {
            playlistCurrentIndex = playlistTrackIndexInFolder(playlistActiveFolderId, curId);
        }
    }
    const f = playlistFolders.find(x => x.id === folderId);
    if (f) f.collapsed = false;
    savePlaylistFolders();
    refreshPlaylistUi();
}

function buildPlaylistTrackRow(track, folder, index) {
    const isCurrentFolder = folder.id === playlistActiveFolderId;
    const row = document.createElement('div');
    row.className = 'sp-row pl-row' + (isCurrentFolder && index === playlistCurrentIndex ? ' playing' : '');

    const grip = document.createElement('span');
    grip.className = 'sp-grip';
    grip.title = 'Перетащите в другой плейлист';
    grip.draggable = true;
    grip.innerHTML = PL_ICON.grip;
    grip.addEventListener('dragstart', (e) => {
        playlistDragTrackId = track.id;
        row.classList.add('dragging');
        if (e.dataTransfer) { e.dataTransfer.setData('text/plain', track.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setDragImage(row, 16, 16); }
    });
    grip.addEventListener('dragend', () => {
        playlistDragTrackId = null;
        row.classList.remove('dragging');
        document.querySelectorAll('.sp-section.drop-target').forEach(el => el.classList.remove('drop-target'));
    });

    const play = document.createElement('button');
    play.className = 'sp-play';
    play.type = 'button';
    play.title = 'Играть';
    play.innerHTML = PL_ICON.play;
    play.addEventListener('click', () => playTrackFromFolder(folder.id, track.id));

    const nameWrap = document.createElement('div');
    nameWrap.className = 'sp-name-wrap';
    const name = document.createElement('div');
    name.className = 'sp-name-static';
    name.textContent = stripExt(track.name);
    name.title = stripExt(track.name);
    nameWrap.appendChild(name);

    const remove = document.createElement('button');
    remove.className = 'sp-del';
    remove.type = 'button';
    remove.title = 'Удалить трек';
    remove.innerHTML = PL_ICON.trash;
    remove.addEventListener('click', () => removePlaylistTrack(track.id));

    row.append(grip, play, nameWrap, remove);
    return row;
}

// Список: каждый плейлист — раздел, который сворачивается (как в саундпаде)
function renderPlaylistSettingsList() {
    if (!playlistSettingsList) return;
    playlistSettingsList.innerHTML = '';
    playlistFolders.forEach((folder) => {
        const tracks = playlistTracks.filter(t => t.folderId === folder.id);
        const isActiveFolder = folder.id === playlistActiveFolderId;

        const sec = document.createElement('div');
        sec.className = 'sp-section' + (folder.collapsed ? ' collapsed' : '');
        sec.dataset.folder = folder.id;

        const head = document.createElement('div');
        head.className = 'sp-sec-head';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'sp-sec-toggle';
        toggle.title = folder.collapsed ? 'Развернуть плейлист' : 'Свернуть плейлист';
        toggle.innerHTML = PL_ICON.chevron;
        const nm = document.createElement('span'); nm.className = 'sp-sec-name'; nm.textContent = folder.name;
        const cnt = document.createElement('span'); cnt.className = 'sp-sec-count'; cnt.textContent = String(tracks.length);
        toggle.append(nm, cnt);
        if (isActiveFolder) {
            const tag = document.createElement('span');
            tag.className = 'pl-active-tag';
            tag.textContent = 'Текущий';
            toggle.appendChild(tag);
        }
        toggle.addEventListener('click', () => { folder.collapsed = !folder.collapsed; savePlaylistFolders(); renderPlaylistSettingsList(); });

        const addBtn = document.createElement('button');
        addBtn.type = 'button'; addBtn.className = 'sp-sec-btn'; addBtn.title = 'Добавить треки в этот плейлист';
        addBtn.innerHTML = PL_ICON.plus + '<span>Треки</span>';
        addBtn.addEventListener('click', () => {
            playlistAddTargetFolderId = folder.id;
            if (folder.collapsed) { folder.collapsed = false; savePlaylistFolders(); }
            if (playlistFileInput) playlistFileInput.click();
        });
        const renBtn = document.createElement('button');
        renBtn.type = 'button'; renBtn.className = 'sp-sec-btn'; renBtn.title = 'Переименовать плейлист';
        renBtn.innerHTML = PL_ICON.edit;
        renBtn.addEventListener('click', () => renamePlaylistFolder(folder.id));
        const delBtn = document.createElement('button');
        delBtn.type = 'button'; delBtn.className = 'sp-sec-btn danger'; delBtn.title = 'Удалить плейлист';
        delBtn.innerHTML = PL_ICON.trash;
        delBtn.disabled = playlistFolders.length <= 1;
        delBtn.addEventListener('click', () => deletePlaylistFolder(folder.id));
        head.append(toggle, addBtn, renBtn, delBtn);

        const body = document.createElement('div');
        body.className = 'sp-sec-body';
        if (!tracks.length) {
            const empty = document.createElement('div');
            empty.className = 'sp-sec-empty';
            empty.textContent = 'Пусто. Нажмите «Треки», чтобы добавить файлы, или перетащите сюда трек из другого плейлиста.';
            body.appendChild(empty);
        }
        tracks.forEach((track, i) => body.appendChild(buildPlaylistTrackRow(track, folder, i)));

        sec.addEventListener('dragover', (e) => { if (playlistDragTrackId) { e.preventDefault(); sec.classList.add('drop-target'); } });
        sec.addEventListener('dragleave', (e) => { if (!sec.contains(e.relatedTarget)) sec.classList.remove('drop-target'); });
        sec.addEventListener('drop', (e) => {
            e.preventDefault();
            sec.classList.remove('drop-target');
            const id = playlistDragTrackId;
            playlistDragTrackId = null;
            if (id) movePlaylistTrackToFolder(id, folder.id);
        });

        sec.append(head, body);
        playlistSettingsList.appendChild(sec);
    });
}

function renamePlaylistFolder(folderId) {
    const folder = playlistFolders.find(f => f.id === folderId);
    if (!folder) return;
    const clean = String(prompt('Новое название плейлиста:', folder.name) || '').trim().slice(0, 40);
    if (!clean || clean === folder.name) return;
    if (playlistFolders.some(f => f.id !== folderId && f.name.toLowerCase() === clean.toLowerCase())) {
        alert('Плейлист с таким названием уже существует.');
        return;
    }
    folder.name = clean;
    savePlaylistFolders();
    refreshPlaylistUi();
}

function renderPlaylistFolders() {
    if (!playlistFolderSelect) return;
    playlistFolderSelect.innerHTML = '';
    playlistFolders.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.name;
        option.selected = folder.id === playlistActiveFolderId;
        playlistFolderSelect.appendChild(option);
    });
    if (playlistFolderDeleteBtn) playlistFolderDeleteBtn.disabled = playlistFolders.length <= 1;
}

function createPlaylistFolder() {
    const name = prompt('Название нового плейлиста:');
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) return;
    if (playlistFolders.some(f => f.name.toLowerCase() === clean.toLowerCase())) {
        alert('Плейлист с таким названием уже существует.');
        return;
    }
    // Новый плейлист просто появляется в списке; текущая музыка не прерывается
    playlistFolders.push({ id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: clean, collapsed: false });
    savePlaylistFolders();
    refreshPlaylistUi();
}

function deletePlaylistFolder(folderId) {
    if (playlistFolders.length <= 1) {
        alert('Нельзя удалить последний плейлист.');
        return;
    }
    const folder = playlistFolders.find(f => f.id === folderId);
    if (!folder || !confirm(`Удалить плейлист «${folder.name}» вместе со всеми его треками?`)) return;
    const wasActive = folder.id === playlistActiveFolderId;
    const ids = new Set(playlistTracks.filter(t => t.folderId === folder.id).map(t => t.id));
    playlistTracks = playlistTracks.filter(t => t.folderId !== folder.id);
    ids.forEach(id => playlistDbDelete(id).catch(() => {}));
    playlistFolders = playlistFolders.filter(f => f.id !== folder.id);
    if (wasActive) {
        playlistActiveFolderId = playlistFolders[0].id;
        localStorage.setItem(PLAYLIST_ACTIVE_FOLDER_KEY, playlistActiveFolderId);
        playlistCurrentIndex = -1;
        playlistAudio.pause();
        playlistAudio.removeAttribute('src');
        if (playlistCurrentObjectUrl) { URL.revokeObjectURL(playlistCurrentObjectUrl); playlistCurrentObjectUrl = null; }
    }
    savePlaylistFolders();
    savePlaylistMeta(playlistTracks);
    refreshPlaylistUi();
}

if (playlistFolderSelect) {
    playlistFolderSelect.addEventListener('change', () => {
        playlistActiveFolderId = playlistFolderSelect.value;
        localStorage.setItem(PLAYLIST_ACTIVE_FOLDER_KEY, playlistActiveFolderId);
        playlistCurrentIndex = -1;
        playlistAudio.pause();
        playlistAudio.removeAttribute('src');
        if (playlistCurrentObjectUrl) { URL.revokeObjectURL(playlistCurrentObjectUrl); playlistCurrentObjectUrl = null; }
        refreshPlaylistUi();
    });
}
if (playlistFolderNewBtn) playlistFolderNewBtn.addEventListener('click', createPlaylistFolder);

function refreshPlaylistUi() {
    renderPlaylistFolders();
    updatePlaylistWidget();
    renderPlaylistSettingsList();
}

async function playPlaylistTrack(index) {
    if (index < 0 || index >= getActivePlaylistTracks().length) return;
    // Новый трек получает новый номер, чтобы старые состояния/файлы не могли вернуть воспроизведение назад.
    if (listenSession && listenSession.role === 'host') listenTrackGeneration++;
    const track = getActivePlaylistTracks()[index];
    playlistTrackLoading = true;
    try {
        const blob = await playlistDbGet(track.id);
        if (!blob) {
            alert('Не удалось загрузить этот трек — возможно, он был удалён в другом окне.');
            return;
        }
        if (playlistCurrentObjectUrl) URL.revokeObjectURL(playlistCurrentObjectUrl);
        playlistCurrentObjectUrl = URL.createObjectURL(blob);
        // Сбрасываем ползунок и таймер сразу, до загрузки метаданных нового трека,
        // чтобы он не "застревал" на позиции предыдущего трека.
        isDraggingListenerSeek = false;
        playlistSeek.value = '0';
        playlistSeek.max = '1000';
        updateSeekFill(playlistSeek);
        playlistTimeCurrent.textContent = formatPlaylistTime(0);
        playlistTimeDuration.textContent = formatPlaylistTime(0);
        playlistAudio.src = playlistCurrentObjectUrl;
        playlistAudio.currentTime = 0;
        playlistCurrentIndex = index;
        await playlistAudio.play();
        if (listenSession && listenSession.role === 'host') sendCurrentTrackToListenGuest();
    } catch (e) {
        console.warn('[Плейлист] Не удалось воспроизвести трек:', e);
    } finally {
        playlistTrackLoading = false;
    }
    refreshPlaylistUi();
}

function togglePlaylistPlayPause() {
    if (!getActivePlaylistTracks().length) return;
    if (playlistCurrentIndex === -1) {
        playPlaylistTrack(0);
        return;
    }
    if (playlistAudio.paused) {
        playlistAudio.play().catch(() => {});
    } else {
        playlistAudio.pause();
    }
    refreshPlaylistUi();
}

function playlistPrevTrack() {
    if (!getActivePlaylistTracks().length) return;
    if (playlistShuffle) {
        playPlaylistTrack(getRandomPlaylistIndex());
        return;
    }
    const idx = playlistCurrentIndex <= 0 ? getActivePlaylistTracks().length - 1 : playlistCurrentIndex - 1;
    playPlaylistTrack(idx);
}
function playlistNextTrack() {
    if (!getActivePlaylistTracks().length) return;
    if (playlistShuffle) {
        playPlaylistTrack(getRandomPlaylistIndex());
        return;
    }
    const idx = playlistCurrentIndex === -1 || playlistCurrentIndex >= getActivePlaylistTracks().length - 1 ? 0 : playlistCurrentIndex + 1;
    playPlaylistTrack(idx);
}

playlistAudio.addEventListener('play', refreshPlaylistUi);
playlistAudio.addEventListener('pause', refreshPlaylistUi);
playlistAudio.addEventListener('ended', () => playlistNextTrack());

// Если мы сейчас хост совместного прослушивания — держим собеседника в курсе
// пуска/паузы своего плейлиста (смена самого трека шлётся отдельно, из playPlaylistTrack).
playlistAudio.addEventListener('play', () => { if (!playlistTrackLoading && listenSession && listenSession.role === 'host') sendListenStateToGuest(); });
playlistAudio.addEventListener('pause', () => { if (!playlistTrackLoading && listenSession && listenSession.role === 'host') sendListenStateToGuest(); });
playlistAudio.addEventListener('seeked', () => { if (listenSession && listenSession.role === 'host') sendListenStateToGuest(); });

playlistPlayPauseBtn.addEventListener('click', togglePlaylistPlayPause);
playlistPrevBtn.addEventListener('click', playlistPrevTrack);
playlistNextBtn.addEventListener('click', playlistNextTrack);

// ---------- Перемотка своего плейлиста (владелец плейлиста всегда может перематывать;
// если сейчас идёт совместное прослушивание и мы хост — перемотка сама уедет
// собеседнику через событие 'seeked' на playlistAudio, см. блок совместного прослушивания) ----------
playlistAudio.addEventListener('loadedmetadata', () => {
    playlistSeek.max = String(Math.max(1, Math.floor(playlistAudio.duration * 10) || 1));
    playlistTimeDuration.textContent = formatPlaylistTime(playlistAudio.duration);
    updateSeekFill(playlistSeek);
});
playlistAudio.addEventListener('timeupdate', () => {
    if (isDraggingListenerSeek) return;
    playlistSeek.value = String(Math.floor((playlistAudio.currentTime || 0) * 10));
    playlistTimeCurrent.textContent = formatPlaylistTime(playlistAudio.currentTime);
    updateSeekFill(playlistSeek);
});
playlistSeek.addEventListener('mousedown', () => { isDraggingListenerSeek = true; });
playlistSeek.addEventListener('touchstart', () => { isDraggingListenerSeek = true; }, { passive: true });
playlistSeek.addEventListener('input', () => {
    const t = parseInt(playlistSeek.value, 10) / 10;
    playlistTimeCurrent.textContent = formatPlaylistTime(t);
    if (playlistCurrentIndex !== -1 && isFinite(playlistAudio.duration)) {
        playlistAudio.currentTime = t;
    }
});
function stopDraggingPlaylistSeek() { isDraggingListenerSeek = false; }
playlistSeek.addEventListener('mouseup', stopDraggingPlaylistSeek);
playlistSeek.addEventListener('touchend', stopDraggingPlaylistSeek);
playlistSeek.addEventListener('change', stopDraggingPlaylistSeek);

// ---------- Громкость своей музыки (плейлист + совместное прослушивание) — попап, как у собеседников ----------
function closePlaylistVolumePopover() {
    const existing = document.getElementById('playlist-volume-popover');
    if (existing) existing.remove();
    playlistVolumeRangeEl = null;
    document.removeEventListener('mousedown', onDocMouseDownForPlaylistVolumePopover, true);
}
function onDocMouseDownForPlaylistVolumePopover(e) {
    const pop = document.getElementById('playlist-volume-popover');
    if (pop && !pop.contains(e.target) && e.target !== playlistVolumeBtn) closePlaylistVolumePopover();
}
playlistVolumeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (document.getElementById('playlist-volume-popover')) { closePlaylistVolumePopover(); return; }
    const pop = document.createElement('div');
    pop.id = 'playlist-volume-popover';
    pop.className = 'user-volume-popover fade-in';
    pop.innerHTML = `
        <div class="user-volume-popover-title">Громкость музыки</div>
        <input type="range" id="playlist-volume-range" min="0" max="100" step="1" value="${playlistVolumePercent}">
        <div class="user-volume-popover-value">${playlistVolumePercent}%</div>
        <span class="profile-hint">Только у вас — на плейлист и совместное прослушивание</span>
    `;
    document.body.appendChild(pop);
    const anchorRect = playlistVolumeBtn.getBoundingClientRect();
    const popWidth = 220;
    pop.style.left = `${Math.max(8, Math.min(anchorRect.left, window.innerWidth - popWidth - 8))}px`;
    pop.style.bottom = `${window.innerHeight - anchorRect.top + 8}px`;
    playlistVolumeRangeEl = pop.querySelector('#playlist-volume-range');
    const valueLabel = pop.querySelector('.user-volume-popover-value');
    playlistVolumeRangeEl.addEventListener('input', (ev) => {
        const val = parseInt(ev.target.value, 10);
        valueLabel.textContent = `${val}%`;
        playlistVolumePercent = val;
        setPlaylistVolumePercent(val);
    });
    playlistVolumeRangeEl.addEventListener('click', (ev) => ev.stopPropagation());
    setTimeout(() => document.addEventListener('mousedown', onDocMouseDownForPlaylistVolumePopover, true), 0);
});
playlistWidgetInfo.addEventListener('click', () => {
    switchSettingsTab('playlist');
    settingsModal.style.display = 'flex';
});

async function addPlaylistTracks(files, targetFolderId) {
    const folderId = (targetFolderId && playlistFolders.some(f => f.id === targetFolderId)) ? targetFolderId : playlistActiveFolderId;
    for (const file of Array.from(files || [])) {
        if (file.size > PLAYLIST_MAX_TRACK_SIZE) {
            alert(`Файл «${file.name}» слишком большой (максимум 20 МБ).`);
            continue;
        }
        const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        try {
            await playlistDbPut(id, file);
            playlistTracks.push({
                id,
                name: file.name,
                addedAt: Date.now(),
                folderId
            });
            savePlaylistMeta(playlistTracks);
        } catch (e) {
            console.warn('[Плейлист] Не удалось сохранить трек:', e);
            alert(`Не удалось сохранить трек «${file.name}».`);
        }
    }
    refreshPlaylistUi();
}

async function removePlaylistTrack(id) {
    const anyTrack = playlistTracks.find(t => t.id === id);
    if (!anyTrack) return;
    if (anyTrack.folderId !== playlistActiveFolderId) {
        // трек из другого (не текущего) плейлиста: текущее воспроизведение не затрагиваем
        playlistTracks = playlistTracks.filter(t => t.id !== id);
        savePlaylistMeta(playlistTracks);
        try { await playlistDbDelete(id); } catch (e) { /* ignore */ }
        refreshPlaylistUi();
        return;
    }
    const activeTracks = getActivePlaylistTracks();
    const index = activeTracks.findIndex(t => t.id === id);
    if (index === -1) return;
    const isCurrent = index === playlistCurrentIndex;
    if (isCurrent) {
        playlistAudio.pause();
        playlistAudio.removeAttribute('src');
        if (playlistCurrentObjectUrl) { URL.revokeObjectURL(playlistCurrentObjectUrl); playlistCurrentObjectUrl = null; }
        playlistCurrentIndex = -1;
    } else if (index < playlistCurrentIndex) {
        playlistCurrentIndex -= 1;
    }
    playlistTracks = playlistTracks.filter(t => t.id !== id);
    savePlaylistMeta(playlistTracks);
    try { await playlistDbDelete(id); } catch (e) { /* ignore */ }
    refreshPlaylistUi();
}

playlistFileInput.addEventListener('change', () => {
    if (playlistFileInput.files && playlistFileInput.files.length) {
        addPlaylistTracks(playlistFileInput.files, playlistAddTargetFolderId);
    }
    playlistAddTargetFolderId = null;
    playlistFileInput.value = '';
});

refreshPlaylistUi();

// ==================== Совместное прослушивание плейлиста (2 человека) ====================
// Идея: приглашение/ответ/завершение идут через сервер (ретрансляция по peerId внутри
// голосовой комнаты — см. 'listen invite' и т.п. в server.js). А сама синхронизация
// (какой трек, играет/пауза, текущее время) и передача самого файла трека — НАПРЯМУЮ
// между двумя клиентами через отдельный PeerJS DataConnection, без участия сервера.
// Инициатор приглашения становится "хостом" (его плейлист — источник истины),
// принявший приглашение — "гостем" (просто зеркалит то, что играет у хоста).

let listenSession = null; // { peerId, username, role: 'host' | 'guest', conn }
let pendingIncomingListenInvite = null; // { peerId, username }
let pendingOutgoingListenInviteTo = null; // peerId, кому только что отправили приглашение
let listenInviteTimeoutId = null;
let listenSyncIntervalId = null;
const listenGuestAudio = new Audio(); // отдельный аудио-элемент гостя, не трогает свой плейлист
listenGuestAudio.volume = playlistVolumeToGain(playlistVolumePercent);
let listenGuestObjectUrl = null;
let listenGuestTrackMeta = null; // ждём бинарные данные трека после метаданных
let listenTrackGeneration = 0; // защищает гостя от запоздавших данных старого трека
let isDraggingListenerSeek = false; // хост сейчас тянет ползунок перемотки — не перетираем его значение

function closeListenInviteBanner() {
    const el = document.getElementById('listen-invite-banner');
    if (el) el.remove();
    if (listenInviteTimeoutId) { clearTimeout(listenInviteTimeoutId); listenInviteTimeoutId = null; }
}

function showListenInviteBanner(peerId, username) {
    closeListenInviteBanner();
    pendingIncomingListenInvite = { peerId, username };
    const banner = document.createElement('div');
    banner.id = 'listen-invite-banner';
    banner.className = 'fade-in';
    banner.innerHTML = `
        <div class="listen-invite-text">🎧 <b style="color:${getUserColor(username)}">${escapeHtml(username)}</b> предлагает послушать музыку вместе</div>
        <div class="listen-invite-actions">
            <button class="listen-invite-decline" type="button">Отклонить</button>
            <button class="listen-invite-accept" type="button">Принять</button>
        </div>
    `;
    document.body.appendChild(banner);
    banner.querySelector('.listen-invite-accept').addEventListener('click', () => acceptListenInvite());
    banner.querySelector('.listen-invite-decline').addEventListener('click', () => declineListenInvite());

    // Приглашение "протухает" через 30 секунд, если не ответили
    listenInviteTimeoutId = setTimeout(() => {
        if (pendingIncomingListenInvite && pendingIncomingListenInvite.peerId === peerId) {
            declineListenInvite();
        }
    }, 30000);
}

function acceptListenInvite() {
    if (!pendingIncomingListenInvite) return;
    const { peerId, username } = pendingIncomingListenInvite;
    pendingIncomingListenInvite = null;
    closeListenInviteBanner();

    socket.emit('listen invite response', { toPeerId: peerId, accepted: true });

    // Свою локальную музыку на время сессии останавливаем, чтобы не играли две дорожки разом
    if (!playlistAudio.paused) playlistAudio.pause();

    if (!myPeer) return;
    try {
        const conn = myPeer.connect(peerId, { label: 'listen-sync', reliable: true, serialization: 'binary' });
        conn.on('open', () => setupListenSession(conn, 'guest', peerId, username));
        conn.on('error', (e) => {
            console.warn('[Совместное прослушивание] Ошибка соединения:', e);
            showToast('Не удалось подключиться к собеседнику для совместного прослушивания.');
        });
    } catch (e) {
        console.warn('[Совместное прослушивание] Не удалось создать соединение:', e);
    }
}

function declineListenInvite() {
    if (!pendingIncomingListenInvite) { closeListenInviteBanner(); return; }
    const { peerId } = pendingIncomingListenInvite;
    pendingIncomingListenInvite = null;
    closeListenInviteBanner();
    socket.emit('listen invite response', { toPeerId: peerId, accepted: false });
}

function sendListenInvite(peerId, username) {
    if (listenSession) {
        showToast('Вы уже слушаете музыку вместе с кем-то — сначала завершите текущую сессию.');
        return;
    }
    pendingOutgoingListenInviteTo = peerId;
    socket.emit('listen invite', { toPeerId: peerId });
    showToast(`Приглашение отправлено: ${username}`);
    setTimeout(() => {
        if (pendingOutgoingListenInviteTo === peerId) pendingOutgoingListenInviteTo = null;
    }, 30000);
}

// Вызывается, когда PeerJS сообщает о входящем DataConnection — принимаем только
// ожидаемое соединение для совместного прослушивания (остальное не трогаем).
function handleIncomingListenDataConnection(conn) {
    if (conn.label !== 'listen-sync') return;
    if (pendingOutgoingListenInviteTo !== conn.peer) {
        // Соединение не от того, кого мы приглашали (либо мы никого не приглашали) — не принимаем.
        try { conn.close(); } catch (e) {}
        return;
    }
    const peerId = conn.peer;
    pendingOutgoingListenInviteTo = null;
    const username = (connectedUsers[peerId] && connectedUsers[peerId].username) || 'Собеседник';
    conn.on('open', () => setupListenSession(conn, 'host', peerId, username));
}

function refreshListenSessionUi() {
    if (!listenSession) {
        listenSessionBar.classList.remove('active');
        listenSessionSeekRow.classList.remove('visible');
        listenSessionVolumeRow.classList.remove('visible');
        if (playlistWidget) playlistWidget.classList.remove('hidden-by-listen');
        return;
    }
    listenSessionBar.classList.add('active');
    listenSessionBarText.innerHTML = listenSession.role === 'host'
        ? `с <b style="color:${getUserColor(listenSession.username)}">${escapeHtml(listenSession.username)}</b> — перематываете вы`
        : `с <b style="color:${getUserColor(listenSession.username)}">${escapeHtml(listenSession.username)}</b> — перематывает собеседник`;

    // Своя перемотка (у хоста) и своя громкость уже есть в обычном виджете плейлиста —
    // гостю же нужен отдельный (только для чтения) прогресс и своя громкость здесь.
    const isGuest = listenSession.role === 'guest';
    listenSessionSeekRow.classList.toggle('visible', isGuest);
    listenSessionVolumeRow.classList.toggle('visible', isGuest);
    listenSessionTrackName.style.display = isGuest ? '' : 'none';
    if (isGuest) listenSessionVolume.value = String(Math.min(100, playlistVolumePercent));

    // Пока вам транслируют чужой плейлист (вы гость), свой модуль управления
    // треками не нужен — прячем, чтобы не путал и не мешал.
    if (playlistWidget) playlistWidget.classList.toggle('hidden-by-listen', isGuest);
}

function setupListenSession(conn, role, peerId, username) {
    if (listenSession) {
        try { listenSession.conn.close(); } catch (e) {}
    }
    listenSession = { peerId, username, role, conn };
    refreshListenSessionUi();
    showToast(role === 'host'
        ? `${username} присоединился к совместному прослушиванию`
        : `Вы слушаете музыку вместе с ${username}`);

    conn.on('data', (msg) => handleListenSyncMessage(msg));
    conn.on('close', () => endListenSession(true));
    conn.on('error', () => endListenSession(true));

    if (role === 'host') {
        // Гость только что подключился — сразу шлём ему текущий трек, если он есть
        if (playlistCurrentIndex !== -1) {
            sendCurrentTrackToListenGuest();
        }
        startListenHostSyncLoop();
    }
}

async function sendCurrentTrackToListenGuest() {
    if (!listenSession || listenSession.role !== 'host') return;
    const track = getActivePlaylistTracks()[playlistCurrentIndex];
    if (!track) return;
    const sessionAtStart = listenSession;
    const generation = ++listenTrackGeneration;
    try {
        const blob = await playlistDbGet(track.id);
        if (!blob || listenSession !== sessionAtStart || listenTrackGeneration !== generation) return;
        const buffer = await blob.arrayBuffer();
        if (listenSession !== sessionAtStart || listenTrackGeneration !== generation) return;
        listenSession.conn.send({
            type: 'track-meta',
            generation,
            name: track.name,
            mime: blob.type || 'audio/mpeg',
            currentTime: playlistAudio.currentTime || 0,
            playing: !playlistAudio.paused
        });
        listenSession.conn.send({ type: 'track-data', generation, buffer });
    } catch (e) {
        console.warn('[Совместное прослушивание] Не удалось отправить трек собеседнику:', e);
    }
}

function sendListenStateToGuest() {
    if (!listenSession || listenSession.role !== 'host') return;
    listenSession.conn.send({
        type: 'state',
        generation: listenTrackGeneration,
        playing: !playlistAudio.paused,
        currentTime: playlistAudio.currentTime || 0
    });
}

function startListenHostSyncLoop() {
    if (listenSyncIntervalId) clearInterval(listenSyncIntervalId);
    // Раз в 4 секунды подстраховочно шлём текущее время — на случай рассинхрона у гостя
    listenSyncIntervalId = setInterval(() => {
        if (listenSession && listenSession.role === 'host' && !playlistAudio.paused) {
            sendListenStateToGuest();
        }
    }, 4000);
}

function handleListenSyncMessage(msg) {
    if (!listenSession || listenSession.role !== 'guest') return;

    // Новый формат трека: метаданные и бинарные данные имеют один generation.
    if (msg && typeof msg === 'object' && msg.type === 'track-meta') {
        listenGuestTrackMeta = msg;
        return;
    }

    if (msg && typeof msg === 'object' && msg.type === 'track-data') {
        const meta = listenGuestTrackMeta;
        if (!meta || meta.generation !== msg.generation) return;
        listenGuestTrackMeta = null;
        try {
            const blob = new Blob([msg.buffer], { type: meta.mime || 'audio/mpeg' });
            if (listenGuestObjectUrl) URL.revokeObjectURL(listenGuestObjectUrl);
            listenGuestObjectUrl = URL.createObjectURL(blob);
            listenGuestAudio.src = listenGuestObjectUrl;
            const applyState = () => {
                listenGuestAudio.currentTime = Number(meta.currentTime) || 0;
                if (meta.playing) listenGuestAudio.play().catch(() => {});
                else listenGuestAudio.pause();
            };
            if (listenGuestAudio.readyState >= 1) applyState();
            else listenGuestAudio.addEventListener('loadedmetadata', applyState, { once: true });
            listenSessionTrackName.textContent = stripExt(meta.name);
        } catch (e) {
            console.warn('[Совместное прослушивание] Не удалось воспроизвести полученный трек:', e);
        }
        return;
    }

    // Совместимость со старыми клиентами: обычный ArrayBuffer после track-meta.
    const isBinary = msg instanceof ArrayBuffer || msg instanceof Uint8Array || msg instanceof Blob;
    if (isBinary) {
        if (!listenGuestTrackMeta) return;
        const meta = listenGuestTrackMeta;
        listenGuestTrackMeta = null;
        try {
            const blob = msg instanceof Blob ? msg : new Blob([msg], { type: meta.mime || 'audio/mpeg' });
            if (listenGuestObjectUrl) URL.revokeObjectURL(listenGuestObjectUrl);
            listenGuestObjectUrl = URL.createObjectURL(blob);
            listenGuestAudio.src = listenGuestObjectUrl;
            const applyState = () => {
                listenGuestAudio.currentTime = Number(meta.currentTime) || 0;
                if (meta.playing) listenGuestAudio.play().catch(() => {});
                else listenGuestAudio.pause();
            };
            if (listenGuestAudio.readyState >= 1) applyState();
            else listenGuestAudio.addEventListener('loadedmetadata', applyState, { once: true });
            listenSessionTrackName.textContent = stripExt(meta.name);
        } catch (e) {
            console.warn('[Совместное прослушивание] Не удалось воспроизвести полученный трек:', e);
        }
        return;
    }

    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'state') {
        // Состояние старого трека не должно перематывать новый трек назад.
        if (msg.generation && listenGuestTrackMeta && msg.generation !== listenGuestTrackMeta.generation) return;
        if (msg.playing && listenGuestAudio.paused) listenGuestAudio.play().catch(() => {});
        if (!msg.playing && !listenGuestAudio.paused) listenGuestAudio.pause();
        if (typeof msg.currentTime === 'number' && Math.abs(listenGuestAudio.currentTime - msg.currentTime) > 1.5) {
            listenGuestAudio.currentTime = msg.currentTime;
        }
        return;
    }
}
function endListenSession(silent) {
    if (!listenSession) return;
    const wasHost = listenSession.role === 'host';
    const peerId = listenSession.peerId;
    try { listenSession.conn.close(); } catch (e) {}
    listenSession = null;
    listenGuestTrackMeta = null;
    listenTrackGeneration++;
    if (listenSyncIntervalId) { clearInterval(listenSyncIntervalId); listenSyncIntervalId = null; }

    listenGuestAudio.pause();
    listenGuestAudio.removeAttribute('src');
    if (listenGuestObjectUrl) { URL.revokeObjectURL(listenGuestObjectUrl); listenGuestObjectUrl = null; }
    listenSessionTrackName.textContent = 'Нет трека';
    listenSessionSeek.value = '0';
    updateSeekFill(listenSessionSeek);
    listenSessionTimeCurrent.textContent = '0:00';
    listenSessionTimeDuration.textContent = '0:00';

    refreshListenSessionUi();

    if (!silent) {
        socket.emit('listen session end', { toPeerId: peerId });
        showToast('Совместное прослушивание завершено');
    } else {
        showToast('Собеседник вышел из совместного прослушивания');
    }
}

listenSessionBarStop.addEventListener('click', () => endListenSession(false));

// Прогресс воспроизведения у гостя — только для чтения (перематывает исключительно хост)
listenGuestAudio.addEventListener('loadedmetadata', () => {
    listenSessionSeek.max = String(Math.max(1, Math.floor(listenGuestAudio.duration * 10) || 1));
    listenSessionTimeDuration.textContent = formatPlaylistTime(listenGuestAudio.duration);
    updateSeekFill(listenSessionSeek);
});
listenGuestAudio.addEventListener('timeupdate', () => {
    listenSessionSeek.value = String(Math.floor((listenGuestAudio.currentTime || 0) * 10));
    updateSeekFill(listenSessionSeek);
    listenSessionTimeCurrent.textContent = formatPlaylistTime(listenGuestAudio.currentTime);
});

// Громкость гостя у себя — своя, не влияет на хоста и наоборот
listenSessionVolume.addEventListener('input', () => {
    const val = parseInt(listenSessionVolume.value, 10);
    playlistVolumePercent = val;
    setPlaylistVolumePercent(val);
});

socket.on('listen invite', ({ fromPeerId, fromUsername, toPeerId } = {}) => {
    if (toPeerId !== myPeerId) return;
    if (listenSession) {
        // Уже в сессии — сразу вежливо отклоняем, не показывая баннер
        socket.emit('listen invite response', { toPeerId: fromPeerId, accepted: false });
        return;
    }
    showListenInviteBanner(fromPeerId, fromUsername || 'Участник');
});

socket.on('listen invite response', ({ fromPeerId, fromUsername, toPeerId, accepted } = {}) => {
    if (toPeerId !== myPeerId) return;
    if (pendingOutgoingListenInviteTo !== fromPeerId) return;
    if (!accepted) {
        pendingOutgoingListenInviteTo = null;
        showToast(`${fromUsername || 'Собеседник'} отклонил приглашение`);
    }
    // Если accepted === true, ждём входящий PeerJS DataConnection
    // (см. handleIncomingListenDataConnection) — именно он завершает установку сессии.
});

socket.on('listen session end', ({ fromPeerId, toPeerId } = {}) => {
    if (toPeerId !== myPeerId) return;
    if (listenSession && listenSession.peerId === fromPeerId) {
        endListenSession(true);
    }
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

// ---------- Продление сессии (автовход) ----------
// Токен аккаунта живёт 30 дней и хранится в профиле. Чтобы не приходилось перезаходить:
//  • при запуске/обновлении страницы токен тихо продлевается на сервере (/auth/refresh);
//  • то же раз в несколько часов и при возврате в окно;
//  • если запрос с токеном вернул 401, один раз продлеваем и повторяем запрос.
// Результат: 'ok' — продлён; 'invalid' — сервер токен не признаёт (нужен пароль);
// 'offline' — сервер недоступен (остаёмся на прежнем токене и пробуем позже).
let lastTokenRefreshAt = 0;
let tokenRefreshPromise = null;
async function refreshAuthToken() {
    if (!currentUser.token) return 'invalid';
    if (tokenRefreshPromise) return tokenRefreshPromise;
    tokenRefreshPromise = (async () => {
        try {
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
            const res = await fetch('/auth/refresh', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${currentUser.token}` },
                signal: ctrl ? ctrl.signal : undefined
            });
            if (timer) clearTimeout(timer);
            if (res.status === 401) return 'invalid';
            if (!res.ok) return 'offline';
            const data = await res.json();
            if (!data || !data.token) return 'offline';
            currentUser.token = data.token;
            if (data.username) currentUser.username = data.username;
            if (data.avatar) currentUser.avatar = data.avatar;
            lastTokenRefreshAt = Date.now();
            saveProfileToStorage();
            return 'ok';
        } catch (e) {
            return 'offline';
        } finally {
            tokenRefreshPromise = null;
        }
    })();
    return tokenRefreshPromise;
}

// fetch с токеном: при 401 продлевает сессию и повторяет запрос один раз
async function authFetch(url, options = {}) {
    const withToken = () => ({
        ...options,
        headers: { ...(options.headers || {}), 'Authorization': `Bearer ${currentUser.token}` }
    });
    let res = await fetch(url, withToken());
    if (res.status === 401 && currentUser.token) {
        const r = await refreshAuthToken();
        if (r === 'ok') res = await fetch(url, withToken());
        else if (r === 'invalid') notifySessionExpired();
    }
    return res;
}

let sessionExpiredNotified = false;
function notifySessionExpired() {
    if (sessionExpiredNotified) return;
    sessionExpiredNotified = true;
    showToast('Сессия истекла — войдите заново (Настройки → Профиль → Выйти).', 8000);
}

// Каждые 6 часов и при возврате в окно (если прошло больше часа) — тихо продлеваем сессию
setInterval(() => { if (currentUser.token) refreshAuthToken(); }, 6 * 60 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentUser.token && Date.now() - lastTokenRefreshAt > 60 * 60 * 1000) refreshAuthToken();
});

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
let wasEverDisconnected = false; // отличаем "первое подключение" от "реконнект после обрыва"

// Сам разрыв socket.io: сон ноутбука, обрыв Wi-Fi, сворачивание в фон, а также рестарт/
// деплой сервера (Render убивает старый процесс — все сокеты на нём рвутся разом).
// Показываем баннер сразу — иначе выглядит так, будто приложение "просто перестало
// отвечать", хотя socket.io-client уже в фоне сам пытается переподключиться.
socket.on('disconnect', (reason) => {
    console.warn('[Соединение] Разрыв:', reason);
    wasEverDisconnected = true;
    // 'io client disconnect' — это наш собственный вызов socket.disconnect() (например, logout),
    // баннер тут не нужен: мы сами закрыли соединение и ничего восстанавливать не будем.
    if (reason === 'io client disconnect') return;
    setConnectionBanner(true, 'Соединение потеряно — переподключаемся…');
});

// На каждую попытку реконнекта socket.io обновляем текст баннера, чтобы было видно,
// что клиент не завис, а реально пытается достучаться до сервера.
socket.io.on('reconnect_attempt', (attempt) => {
    setConnectionBanner(true, `Переподключение… (попытка ${attempt})`);
});

socket.on('connect', () => {
    if (!hasConnectedBefore) {
        hasConnectedBefore = true;
        return; // первое подключение — обычная инициализация и так идёт по остальному коду
    }
    console.log('[Соединение] Восстановлено после разрыва — заново регистрируемся на сервере.');
    setConnectionBanner(true, 'Соединение восстановлено — синхронизируем комнату…');

    // Новый сокет на сервере «чистый»: он не в голосовой комнате и не в комнате чата
    // (та, из которой приходят обновления списка участников и сообщения). Поэтому после
    // обрыва (фоновая вкладка, сон ноутбука, прокси Render) восстанавливаем всё сами.
    const restoreSubscriptions = () => {
        if (currentUser.room) {
            socket.emit('join room', { room: currentUser.room, peerId: myPeerId, micMuted: isMuted, deafened: isDeafened, auto: true });
        }
        if (selectedRoom) {
            // заодно перезагрузит историю чата — подтянет пропущенные сообщения
            socket.emit('select chat room', { room: selectedRoom });
            socket.emit('get room users', selectedRoom);
        }
        // Сигнальное WebSocket-соединение PeerJS — отдельное от socket.io и от этого
        // разрыва не лечится автоматически. Если оно тоже отвалилось, поднимаем его,
        // иначе после реконнекта чат работает, а входящие/исходящие звонки — нет.
        if (myPeer && !myPeer.destroyed && myPeer.disconnected) {
            try { myPeer.reconnect(); } catch (e) { /* ignore */ }
        }
        // Баннер прячем не сразу по факту TCP-коннекта, а только теперь, когда
        // реально отправлены все запросы на восстановление комнаты/чата/звонков.
        setConnectionBanner(false);
        if (wasEverDisconnected) showToast('Соединение восстановлено', 3000);
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

    await initPeer();
    syncMyGifsFromServer(); // коллекция GIF из аккаунта (в фоне, без ожидания)
}

// Список ICE-серверов (STUN + TURN) для установки соединения между собеседниками.
// БЕЗ ЭТОГО у new Peer() используются только серверы по умолчанию из PeerJS
// (google-STUN + один бесплатный общий TURN на peerjs.com), которых для part
// прямого P2P-соединения вроде между двумя друзьями в одной сети — достаточно,
// но если третий человек сидит за более строгим NAT/firewall (мобильный интернет,
// корпоративная/учебная сеть, некоторые роутеры) и прямое соединение невозможно,
// а единственный бесплатный TURN-сервер PeerJS перегружен или недоступен —
// его WebRTC-соединение с остальными вообще не устанавливается: он никого не
// слышит, его не слышно и не видно демку (потому что медиапоток просто никогда
// не доходит), а связанные с этим соединением ползунки громкости не действуют
// (не на что влиять — аудиоузлы создаются только после реального прихода потока).
// Добавляем несколько независимых STUN/TURN-серверов, чтобы у браузера было
// больше путей для установления соединения.
// Запасной вариант, если свой аккаунт на dashboard.metered.ca не настроен на сервере
// (не заданы METERED_APP_NAME/METERED_API_KEY в .env) или запрос к /api/ice-servers
// не удался (сеть, сервер недоступен и т.п.) — общедоступный бесплатный
// Open Relay Project TURN, независимый от инфраструктуры PeerJS.
const FALLBACK_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:global.relay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:global.relay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
];

// Список ICE-серверов (STUN + TURN) для установки соединения между собеседниками.
// Берём его с бэкенда (/api/ice-servers), который при настроенном своём аккаунте
// dashboard.metered.ca отдаёт свежие TURN-креды из твоего проекта — это надёжнее
// общего бесплатного openrelayproject, который часто перегружен/недоступен.
// Если бэкенд не настроен или недоступен — используем FALLBACK_ICE_SERVERS.
async function loadIceServersConfig() {
    try {
        const res = await fetch('/api/ice-servers');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data && data.configured && Array.isArray(data.iceServers) && data.iceServers.length) {
            console.log('[ICE] Используются TURN/STUN-серверы из dashboard.metered.ca:',
                data.iceServers.map(s => Array.isArray(s.urls) ? s.urls.join(',') : s.urls).join(' | '));
            // Публичный STUN добавляем на всякий случай — он бесплатный и не расходует трафик TURN.
            const hasGoogleStun = data.iceServers.some(s => String(s.urls).includes('stun.l.google.com'));
            const servers = hasGoogleStun ? data.iceServers : [...data.iceServers, { urls: 'stun:stun.l.google.com:19302' }];
            return { iceServers: servers, sdpSemantics: 'unified-plan', iceCandidatePoolSize: 2 };
        }
        console.warn('[ICE] Причина от сервера:', data && data.reason, data && data.env);
        console.warn('[ICE] Сервер сообщил, что Metered НЕ настроен (нет METERED_APP_NAME / METERED_API_KEY, ' +
            'либо запрос к Metered упал — смотри логи сервера). Используем общий openrelayproject — ' +
            'он часто не работает, и участники из разных сетей могут не слышать друг друга.');
    } catch (err) {
        console.warn('[ICE] Не удалось получить ICE-серверы с сервера, используем запасной список:', err);
    }
    return { iceServers: FALLBACK_ICE_SERVERS, sdpSemantics: 'unified-plan', iceCandidatePoolSize: 2 };
}

async function initPeer() {
    if (myPeer) return;
    const iceConfig = await loadIceServersConfig();
    if (myPeer) return; // на случай повторного вызова, пока ждали ответ сервера
    myPeer = new Peer({ config: iceConfig });

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
        call.answer(localMediaStream, { sdpTransform: enableOpusDtx });
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
        if (call.metadata && call.metadata.username && !isPeerRecentlyLeft(call.peer)) {
            const prev = connectedUsers[call.peer] || {};
            connectedUsers[call.peer] = { ...prev, username: call.metadata.username, avatar: call.metadata.avatar };
            updateVoiceUsersList();
        }
        handleIncomingCall(call);
    });

    // Входящий DataConnection — используется только для совместного прослушивания
    // плейлиста (см. handleIncomingListenDataConnection ниже).
    myPeer.on('connection', (conn) => {
        handleIncomingListenDataConnection(conn);
    });

    myPeer.on('error', (err) => {
        console.error('[Ошибка] PeerJS:', err);

        // Собеседник в этот момент не зарегистрирован на сигнальном сервере PeerJS
        // (переподключается, вкладка засыпает и т.п.). Заготовка звонка при этом остаётся
        // в activeCalls в состоянии ICE "new" НАВСЕГДА — браузер не считает это ошибкой,
        // 'failed' никогда не наступает, и 'room users' больше не пытается перезвонить.
        // Убираем такой звонок сразу и планируем повтор.
        if (err && err.type === 'peer-unavailable') {
            const m = /peer\s+(\S+)/i.exec(String(err.message || ''));
            const pid = m && m[1];
            const stuck = pid && activeCalls[pid];
            if (stuck && !isIceConnected(stuck.peerConnection)) {
                stuck.__recovered = true;
                try { stuck.close(); } catch (e) {}
                if (activeCalls[pid] === stuck) delete activeCalls[pid];
                scheduleCallRetry(pid);
            }
        }

        // Сигнальное соединение PeerJS отвалилось — без него не проходят ни входящие, ни исходящие звонки.
        if (err && ['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
            setTimeout(() => {
                if (myPeer && !myPeer.destroyed && myPeer.disconnected) {
                    console.warn('[Peer] Повторная попытка подключиться к сигнальному серверу…');
                    try { myPeer.reconnect(); } catch (e) {}
                }
            }, 3000);
        }
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

async function initMediaStream(deviceId = null, silent = false) {
    // Пользователь сам забрал у приложения доступ к микрофону (Настройки → Микрофон → Доступ к микрофону).
    if (!appMicAllowed()) { await releaseMicForApp(); return; }
    try {
        // Запоминаем старый ИСХОДЯЩИЙ трек (тот, что реально уходит собеседникам) ДО его
        // остановки — он понадобится, чтобы найти нужный сендер в активных звонках и
        // точечно его заменить. Это трек из графа обработки (processedTrack), а не сырой
        // трек микрофона — именно он лежит в localMediaStream и передаётся по WebRTC.
        const oldOutputTrack = processedTrack || appMicSilentTrack; // после возврата доступа заменяем «тихий» трек

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
        // Если система/драйвер оборвал трек (переподключили гарнитуру, сон ноутбука, устройство
        // забрало другое приложение) — сразу пересобираем микрофон, а не молчим до перезапуска.
        rawAudioStream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => scheduleMicRecover('трек микрофона завершён')));

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
        if (appMicSilentTrack) { try { appMicSilentTrack.stop(); } catch (e) {} appMicSilentTrack = null; }

        if (activeVideoStream) {
            activeVideoStream.getVideoTracks().forEach(track => {
                if (!localMediaStream.getVideoTracks().includes(track)) {
                    localMediaStream.addTrack(track);
                }
            });
        }
    } catch (e) {
        console.error('[Ошибка] Доступ к микрофону:', e);
        if (!silent) alert('Не удалось получить доступ к микрофону. Проверьте разрешения.');
    }
}

// Полностью отключает и обнуляет предыдущий граф обработки перед пересборкой
// (смена микрофона/профиля шумоподавления) — иначе старые узлы и исходящий
// трек продолжали бы висеть в памяти и в звонках.
function teardownAudioGraph() {
    if (sourceNode) { try { sourceNode.disconnect(); } catch (e) { /* ignore */ } }
    disposeVoiceChain();
    if (micGainNode) { try { micGainNode.disconnect(); } catch (e) { /* ignore */ } }
    micGainNode = null;
    if (voiceOutNode) { try { voiceOutNode.disconnect(); } catch (e) { /* ignore */ } }
    voiceOutNode = null;
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
    micLastLevelAt = Date.now();
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
        // Всё, что уходит собеседникам (и в самопрослушивание), проходит через voiceOutNode —
        // между ним и micGainNode при необходимости включается изменение голоса.
        voiceOutNode = audioContext.createGain();
        voiceOutNode.connect(destinationNode);
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
        voiceOutNode.connect(micMonitorGain);

        await applyVoiceChanger();

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
    const micTransmit = micShouldTransmit();
    // Пока играет звук саундпада, исходящий трек должен быть открыт, даже если гейт/рация закрыты
    const shouldTransmit = micTransmit || (typeof soundpadTransmitActive === 'function' && soundpadTransmitActive());
    localMediaStream.getAudioTracks().forEach(track => {
        if (track !== currentDemoAudioTrack) {
            track.enabled = shouldTransmit;
        }
    });
    if (micMonitorGain) {
        micMonitorGain.gain.value = (micMonitorEnabled && micTransmit) ? 1 : 0;
    }
}

// Расходится ли реальное состояние исходящего трека с тем, что должно быть (по гейту/рации/мьюту).
// Таймер закрытия гейта выключает трек сам, а обработчики уровня сравнивали только свой запомненный
// lastIsSpeaking — если речь начиналась в промежутке между срабатыванием таймера и следующим замером,
// они видели «ничего не изменилось» и трек оставался выключенным на всю фразу. Эта проверка
// на каждом замере страхует от такого «залипания».
function gateTrackNeedsSync() {
    if (!localMediaStream) return false;
    const want = micShouldTransmit() || (typeof soundpadTransmitActive === 'function' && soundpadTransmitActive());
    const tracks = localMediaStream.getAudioTracks();
    for (let i = 0; i < tracks.length; i++) {
        if (tracks[i] !== currentDemoAudioTrack && tracks[i].enabled !== want) return true;
    }
    return false;
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
        micLastLevelAt = Date.now();
        messageCount++;
        // Полоску уровня и дебаг-текст обновляем через отчёт (то есть ~раз в 100мс) —
        // глазом разницы с каждым отчётом (~50мс) не видно, а лишних стилевых
        // пересчётов вдвое меньше. Саму логику гейта ниже это не касается — она
        // считается на каждом отчёте, чтобы отклик оставался быстрым.
        // В режиме низкой производительности (окно свёрнуто) полоску/текст вообще
        // не трогаем — их всё равно никто не видит.
        if (messageCount % 2 === 0 && !lowPerfActive()) {
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

        const isSpeaking = micShouldTransmit();
        if (isSpeaking !== lastIsSpeaking) {
            lastIsSpeaking = isSpeaking;
            applyGateToMicTrack(); // функциональная часть — работает всегда, даже в низкой производительности
            if (!lowPerfActive()) {
                if (!myAvatarElem || !myAvatarElem.isConnected) myAvatarElem = document.getElementById(`avatar-${myPeerId}`);
                if (myAvatarElem) myAvatarElem.classList.toggle('speaking', isSpeaking);
            }
        } else if (gateTrackNeedsSync()) {
            applyGateToMicTrack();
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
        micLastLevelAt = Date.now();
        tickCount++;
        const shouldRedraw = (tickCount % 2 === 0) && !lowPerfActive();

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

        const isSpeaking = micShouldTransmit();
        if (isSpeaking !== lastIsSpeaking) {
            lastIsSpeaking = isSpeaking;
            applyGateToMicTrack(); // функциональная часть — работает всегда, даже в низкой производительности
            if (!lowPerfActive()) {
                if (!myAvatarElem || !myAvatarElem.isConnected) myAvatarElem = document.getElementById(`avatar-${myPeerId}`);
                if (myAvatarElem) myAvatarElem.classList.toggle('speaking', isSpeaking);
            }
        } else if (gateTrackNeedsSync()) {
            applyGateToMicTrack();
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
        sendRemoteMeterRate(remoteAnalyser);

        const username = (connectedUsers[peerId] && connectedUsers[peerId].username) || '';
        const voiceGain = audioContext.createGain();
        voiceGain.gain.value = remoteGainValue(username);
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
        if (lowPerfActive()) return; // индикатор говорящего у собеседника — чисто визуальный, никто его сейчас не видит
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
    let fallbackTick = 0;

    function checkRemote() {
        if (remoteAnalysers[peerId] !== analyser) {
            clearInterval(intervalId);
            return;
        }
        if (lowPerfActive()) return; // индикатор говорящего у собеседника — чисто визуальный, никто его сейчас не видит
        // Окно неактивно, но режим низкой производительности выключен — урезаем до раза в секунду
        if (windowIsInactive() && (++fallbackTick % 20) !== 0) return;
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

// Подключиться: трубка с «волнами» (входящий/идущий звонок).
const CONNECT_PHONE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path><path d="M14.05 2a9 9 0 0 1 8 7.94"></path><path d="M14.05 6A5 5 0 0 1 18 10"></path></svg>`;
// Покинуть: классическая «положенная» трубка (завершить звонок).
const DISCONNECT_PHONE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path transform="translate(12 12.5) rotate(135) scale(0.78) translate(-12 -12)" d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`;
function setConnectRoomButtonState(connected) {
    if (!connectRoomBtn) return;
    connectRoomBtn.innerHTML = connected ? DISCONNECT_PHONE_SVG : CONNECT_PHONE_SVG;
    connectRoomBtn.className = connected ? 'btn-primary btn-danger call-action-btn' : 'btn-primary call-action-btn';
    connectRoomBtn.setAttribute('aria-label', connected ? 'Покинуть голосовой канал' : 'Подключиться к голосовому каналу');
    connectRoomBtn.title = connected ? 'Покинуть голосовой канал' : 'Подключиться к голосовому каналу';
}

setConnectRoomButtonState(false);

let roomSwitchTimer = null;
let lastRoomSwitchAt = 0;
function selectRoomButton(btn) {
    const roomName = btn.getAttribute('data-room');
    const displayName = btn.getAttribute('data-display-name') || roomName;
    roomButtons.forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.custom-room-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const previousRoom = selectedRoom;
    const roomChanged = selectedRoom !== roomName;
    selectedRoom = roomName;
    saveLastRoom(roomName);

    if (currentUser.room === roomName) {
        setConnectRoomButtonState(true);
        roomTitle.innerText = `Канал: ${displayName}`;
    } else {
        setConnectRoomButtonState(false);
        roomTitle.innerText = `Канал: ${displayName} (Просмотр)`;
    }
    connectRoomBtn.style.display = 'inline-block';
    // Звонок не зависит от открытого канала: основной список остаётся списком звонка,
    // а новый просматриваемый канал (если он не наш звонок) показывается отдельным блоком.
    if (roomChanged) previewUsers = {};
    renderPreviewUsers();
    socket.emit('get room users', roomName);

    // Чат — свой для каждого сервера. Переключаем его только если реально сменили комнату,
    // чтобы повторный клик (открывающий настройки сервера) не дёргал историю чата заново.
    if (roomChanged) {
        // Пока в ленте ещё чат прежнего канала — запоминаем, докуда человек дочитал.
        rememberChatReadPosition(previousRoom);
        setChatEnabled(true);
        closeMentionAutocomplete();

        // Сначала мгновенно показываем локальную историю, если этот канал уже
        // открывался. Сервер всё равно проверит членство и пришлёт свежую историю
        // в фоне — поэтому кэш не влияет на безопасность и актуальность данных.
        const cachedHistory = getCachedChatHistory(roomName);
        if (cachedHistory) {
            clearChatMessages();
            lastMessageDateKey = null;
            // См. комментарий у socket.on('chat history') — один и тот же защитный
            // try/catch на сообщение нужен и здесь, иначе быстрый локальный рендер
            // из кэша мог так же обрываться после первого сообщения.
            renderChatBatch(cachedHistory, '❌ Не удалось отрисовать сообщение из кэша:');
            chatRenderedRoom = roomName;
            markUnreadMessagesInChat(roomName);
            // Нет новых сообщений — встаём на последнее прочитанное в этом канале.
            if (!messagesDiv.querySelector('.unread-divider')) {
                restoreChatPosition(chatReadPositionByRoom[roomName]);
            }
            // Свежая история с сервера перерисует чат целиком — запоминаем, что было
            // непрочитанным, чтобы разделитель «Непрочитанные» не пропал при перерисовке.
            unreadSnapshotByRoom.set(String(roomName), { ids: getUnreadIds(roomName), at: Date.now() });
            markRoomRead(roomName);
        } else {
            unreadSnapshotByRoom.delete(String(roomName)); // старый снимок не должен гасить вспышку
            // Кэша каналов нет — не оставляем в ленте чат прежнего канала, пока история нового грузится с сервера
            clearChatMessages();
            lastMessageDateKey = null;
            chatRenderedRoom = null;
        }

        // Запрос к серверу чуть откладываем: при быстром листании каналов уходит только
        // запрос последнего, а не пять подряд (каждый — с загрузкой истории и перерисовкой).
        // Первый переход после паузы отправляем сразу (без задержки); только при быстром
        // листании подряд откладываем, чтобы ушёл запрос лишь последнего канала.
        const sendRoomSelect = () => {
            if (selectedRoom !== roomName) return;
            socket.emit('select chat room', { room: roomName });
            // Список участников для автодополнения @упоминаний — запрашиваем явно,
            // чтобы подсказки были готовы, даже если человек начнёт печатать "@" сразу же.
            const mentionCode = customCodeFromRoomName(roomName);
            if (mentionCode) socket.emit('get server members', { code: mentionCode });
        };
        clearTimeout(roomSwitchTimer);
        const sinceLast = Date.now() - lastRoomSwitchAt;
        lastRoomSwitchAt = Date.now();
        if (sinceLast > 400) sendRoomSelect();
        else roomSwitchTimer = setTimeout(sendRoomSelect, 120);
    }
}

roomButtons.forEach(btn => btn.addEventListener('click', () => selectRoomButton(btn)));

// Название канала по его id (сервер мог быть переименован — берём из иконки в рейле).
function roomDisplayName(room) {
    if (!room) return '';
    const btn = document.querySelector(`[data-room="${CSS.escape(String(room))}"]`);
    return btn?.getAttribute('data-display-name') || String(room);
}

// Строка «в каком канале вы в звонке» в боковой панели. Звонок живёт независимо от того,
// какой канал открыт в чате, поэтому здесь есть «Выйти», а по клику на название можно
// вернуться в канал звонка.
function renderCallHeader() {
    if (!currentUser.room) {
        roomNameDisplay.classList.remove('in-call');
        roomNameDisplay.innerHTML = `${ROOM_OUT_ICON_SVG}<span>Вы не в звонке</span>`;
        return;
    }
    roomNameDisplay.classList.add('in-call');
    roomNameDisplay.innerHTML = `${ROOM_IN_ICON_SVG}<span class="call-room-name" title="Перейти в канал звонка">${escapeHtml(roomDisplayName(currentUser.room))}</span><button type="button" class="call-leave-mini" title="Покинуть звонок">Выйти</button>`;
}

roomNameDisplay.addEventListener('click', (e) => {
    if (!currentUser.room) return;
    if (e.target.closest('.call-leave-mini')) {
        leaveVoiceChannel();
        return;
    }
    if (e.target.closest('.call-room-name') && currentUser.room !== selectedRoom) {
        const btn = document.querySelector(`.custom-room-btn[data-room="${CSS.escape(String(currentUser.room))}"]`);
        if (btn) selectRoomButton(btn);
    }
});

function connectToSelectedRoom() {
    if (!selectedRoom) return;
    // При входе в войс не оставляем уже проигрывающуюся мелодию созвона/превью.
    stopNotifySound('callstart');

    if (currentUser.room === selectedRoom) {
        leaveVoiceChannel();
        return;
    }

    if (currentUser.room) leaveVoiceChannel();
    currentUser.room = selectedRoom;
    const displayName = roomDisplayName(selectedRoom);
    renderCallHeader();
    roomTitle.innerText = `Канал: ${displayName}`;
    setConnectRoomButtonState(true);
    // Мы теперь в звонке именно этого канала — отдельный «просмотр» не нужен.
    previewUsers = {};
    renderPreviewUsers();
    screenBtn.disabled = false;
    screenBtn.title = '';

    socket.emit('join room', { room: selectedRoom, peerId: myPeerId, micMuted: isMuted, deafened: isDeafened });
    if (audioContext && audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    playJoinSound();
    // Собственный звук начала созвона не проигрываем при исходящем подключении:
    // пользователь сам инициировал звонок и не должен слышать локальный рингтон.
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

    // Сервер убрали на другом устройстве этого же аккаунта (вышли с него) — закрываем
    // его и здесь, если он был сейчас открыт, чтобы не остаться в «пустом» канале.
    if (selectedRoom && selectedRoom.startsWith('custom:') && !rooms.some(r => `custom:${r.code}` === selectedRoom)) {
        const gone = selectedRoom;
        if (currentUser.room === gone) leaveVoiceChannel();
        selectedRoom = null;
        saveLastRoom(null);
        setChatEnabled(false);
        roomTitle.innerText = 'Выберите канал';
        connectRoomBtn.style.display = 'none';
        document.querySelectorAll('.custom-room-btn').forEach(b => b.classList.remove('active'));
    }

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
    if (typeof renderSoundChannelLists === 'function') renderSoundChannelLists();
    // Список серверов только что отрисован — самое время открыть тот канал,
    // который был открыт до обновления страницы (если он ещё существует).
    tryRestoreLastRoom();
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
    // Иконки пересоздаются (список серверов пришёл заново, сервер переименовали) —
    // без этого кружок непрочитанных пропадал, хотя сами данные ещё лежат в unreadByRoom.
    updateUnreadBadge(btn.dataset.room);
    if (currentUser.room === btn.dataset.room) renderCallHeader();
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
    // Если мы сейчас в голосовом канале этого сервера — сначала выходим из звонка,
    // иначе локально звонок продолжит «висеть», а у остальных мы останемся в списке.
    const leftRoomName = `custom:${currentServerInfo.code}`;
    if (currentUser.room === leftRoomName) leaveVoiceChannel();
    if (selectedRoom === leftRoomName) {
        selectedRoom = null;
        saveLastRoom(null);
        setChatEnabled(false);
        roomTitle.innerText = 'Выберите канал';
        connectRoomBtn.style.display = 'none';
    }
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

// Этот же аккаунт зашёл в голосовой канал с другого устройства/вкладки — работает только
// последнее подключение, поэтому здесь выходим из звонка.
socket.on('voice session taken', () => {
    if (currentUser.room) leaveVoiceChannel();
    showToast('Вы зашли в голосовой канал с другого устройства — здесь звонок завершён');
});

function leaveVoiceChannel() {
    if (activeVideoStream) {
        stopVideoStream();
    }
    if (listenSession) endListenSession(false);
    cleanupCalls();
    socket.emit('leave voice');

    // Звук собственного выхода из комнаты
    playLeaveSound();
    currentUser.room = null;
    roomTitle.innerText = `Канал: ${roomDisplayName(selectedRoom)} (Просмотр)`;
    renderCallHeader();
    previewUsers = {};
    renderPreviewUsers();
    setConnectRoomButtonState(false);
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

// Кто-то начал созвон (пустой голосовой канал стал занят). Сервер шлёт это событие всем
// участникам сервера, независимо от того, какой чат у них сейчас открыт. Сам звонящий
// и те, кто уже в этом звонке, его не получают. Рингтон остановится, как только
// человек нажмёт «Подключиться» (connectToSelectedRoom → stopNotifySound('callstart')).
socket.on('call started', ({ room } = {}) => {
    if (!room || currentUser.room === room) return;
    playCallstartSound(room);
});

socket.on('room users', (usersInRoom, room) => {
    const nextRoomUserCount = Object.keys(usersInRoom || {}).length;
    if (room) roomUserCounts[room] = nextRoomUserCount;

    // Рингтон начала созвона здесь больше НЕ играет: этот список приходит только тем,
    // у кого открыт именно этот канал, а звонок должен быть слышен и когда человек сидит
    // в другом чате. Теперь рингтон запускает отдельное событие 'call started' (см. выше).
    // Сервер шлёт список и участникам канала, и тем, кто просто смотрит сервер (см. broadcastRoomUsers).
    // `room` — какой именно канал обновился: обновления чужих каналов игнорируем.
    const inVoiceRoom = room ? room === currentUser.room : currentUser.room === selectedRoom;
    if (room && !inVoiceRoom && room !== selectedRoom) return;

    if (!inVoiceRoom) {
        if (!currentUser.room) {
            // Не в звонке — основной список показывает просматриваемый канал.
            connectedUsers = usersInRoom;
            updateVoiceUsersList(usersInRoom);
        } else {
            // Мы в звонке ДРУГОГО канала: основной список (наш звонок) не трогаем,
            // а просматриваемый канал показываем отдельным блоком ниже.
            previewUsers = usersInRoom || {};
            renderPreviewUsers();
        }
        return;
    }

    // Кто зашёл/вышел — определяем по разнице со старым списком. Раньше звук входа
    // решался в 'user connected' по "нет ли человека в connectedUsers", но сервер
    // шлёт 'room users' (где новичок уже есть) РАНЬШЕ 'user connected', поэтому
    // человек всегда считался "уже был" и звук входа не играл вообще.
    const prevPeerIds = Object.keys(connectedUsers || {});
    const wasAlreadyInCall = prevPeerIds.includes(myPeerId);
    connectedUsers = usersInRoom;
    Object.keys(usersInRoom || {}).forEach(clearPeerLeft);
    if (currentUser.room && wasAlreadyInCall) {
        const nextPeerIds = Object.keys(usersInRoom || {});
        nextPeerIds.forEach(id => {
            if (id !== myPeerId && !prevPeerIds.includes(id)) playPresenceSound('join', id);
        });
        prevPeerIds.forEach(id => {
            if (id !== myPeerId && !nextPeerIds.includes(id)) playPresenceSound('leave', id);
        });
    }

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
        deafened: isDeafened,
        micRevoked: micAccessRevoked
    };
    // Громкость пересчитываем заново: у тех, кому забрали микрофон, звук обнуляется, у кого вернули — восстанавливается.
    Object.keys(remoteVoiceGainNodes).forEach(pid => {
        const un = (connectedUsers[pid] && connectedUsers[pid].username) || '';
        if (remoteVoiceGainNodes[pid]) remoteVoiceGainNodes[pid].gain.value = remoteGainValue(un);
    });
    // Список звонка рисуем всегда — он не зависит от того, какой канал открыт в чате.
    updateVoiceUsersList();

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
            startCall(peerId);
        }
        renderRemoteVideoState(peerId);
    }
});

// Страховка от «призраков»: раз в 15 с, пока мы в звонке, запрашиваем у сервера актуальный
// список. Любая запись, которой там нет, исчезнет, даже если какое-то событие потерялось.
setInterval(() => {
    if (currentUser && currentUser.room && socket && socket.connected) {
        socket.emit('get room users', currentUser.room);
    }
}, 15000);

// Кто-то другой включил/выключил мьют или дефен — обновляем его значки и
// проигрываем соответствующий сигнал (тот же, что слышит сам переключивший),
// чтобы это было слышно всем участникам комнаты, а не только ему одному.
socket.on('mute state', ({ peerId, micMuted, deafened }) => {
    // Неизвестного/ушедшего участника не создаём заново пустой записью: актуальный статус мьюта
    // всё равно приходит в 'room users'. Раньше опоздавшее событие оставляло «призрак» в списке.
    if (!connectedUsers[peerId] || isPeerRecentlyLeft(peerId)) return;
    const prevMicMuted = !!connectedUsers[peerId].micMuted;
    const prevDeafened = !!connectedUsers[peerId].deafened;

    connectedUsers[peerId].micMuted = micMuted;
    connectedUsers[peerId].deafened = deafened;
    setUserStatusBadges(peerId, micMuted, deafened);

    if (deafened !== prevDeafened) {
        playDeafenSound(deafened);
    } else if (micMuted !== prevMicMuted) {
        playMuteSound(micMuted);
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
    playScreenShareSound(!!sharing);
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

// Сколько раз подряд уже пытались перезвонить конкретному собеседнику после
// неудачного ICE-соединения — чтобы не долбить бесконечно, если человек правда
// недоступен (закрыл вкладку и т.п.), а не просто временный сбой сети/TURN.
const callRetryCount = {};
const MAX_CALL_RETRIES = 8;
// Если за это время соединение так и не стало 'connected' — считаем звонок неудачным, не дожидаясь,
// пока браузер сам объявит 'failed' (а он может не объявить никогда — см. peer-unavailable).
const CALL_CONNECT_TIMEOUT_MS = 15000;

function isIceConnected(pc) {
    return !!pc && (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed');
}

// Исходящий звонок. Звонит только сторона с меньшим peerId (см. 'room users').
// ---------- Настройка Opus в SDP: DTX + пакеты по 40 мс ----------
// В mesh-звонке (каждый с каждым) свой голос кодируется и шифруется отдельно для КАЖДОГО
// собеседника. Два флага в SDP снижают эту нагрузку:
//  1) usedtx=1 — Opus DTX: в паузах кодирование и отправка тишины пропускаются (раньше
//     тишина при закрытом гейте кодировалась и слалась непрерывно; заодно перестаёт зря
//     кодироваться "пустая" дорожка звука демонстрации);
//  2) ptime/maxptime/minptime = 40 мс — вместо 50 пакетов в секунду на собеседника
//     уходит 25: вдвое меньше шифрований и сетевых отправок. Цена — примерно +20 мс к
//     задержке голоса и чуть больше потеряется звука при потере одного пакета.
// Параметры записываются в собственное SDP каждой стороны (offer и answer): отправитель
// читает их из SDP принимающего. Моно Chrome и так использует по
// умолчанию. Битрейт ограничен через maxaveragebitrate (OPUS_MAX_BITRATE). При любой ошибке разбора возвращаем SDP без изменений.
const OPUS_PTIME_MS = 40; // 20 — вернуть стандартные пакеты
const OPUS_MAX_BITRATE = 32000; // бит/с для голоса; 0 — не ограничивать (по умолчанию Chrome ~32 кбит/с)
function enableOpusDtx(sdp) {
    try {
        const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
        const parts = sdp.split(eol + 'm=');
        for (let i = 0; i < parts.length; i++) {
            const isFirst = i === 0;
            let section = isFirst ? parts[i] : 'm=' + parts[i];
            if (!section.startsWith('m=audio')) continue;
            const rtpmap = section.match(/a=rtpmap:(\d+) opus\/48000[^\r\n]*/i);
            if (!rtpmap) continue;
            const pt = rtpmap[1];

            // fmtp: usedtx=1 и minptime под нужный размер пакета
            const fmtpRe = new RegExp('a=fmtp:' + pt + ' ([^\\r\\n]*)');
            const setParam = (params, key, val) => {
                const re = new RegExp('(^|;)' + key + '=[^;]*');
                return re.test(params) ? params.replace(re, '$1' + key + '=' + val) : params + ';' + key + '=' + val;
            };
            if (fmtpRe.test(section)) {
                section = section.replace(fmtpRe, (m, params) => {
                    let p = setParam(params, 'usedtx', 1);
                    if (OPUS_PTIME_MS > 20) p = setParam(p, 'minptime', OPUS_PTIME_MS);
                    if (OPUS_MAX_BITRATE > 0) p = setParam(p, 'maxaveragebitrate', OPUS_MAX_BITRATE);
                    return 'a=fmtp:' + pt + ' ' + p;
                });
            } else {
                const p = 'usedtx=1' + (OPUS_PTIME_MS > 20 ? ';minptime=' + OPUS_PTIME_MS : '')
                    + (OPUS_MAX_BITRATE > 0 ? ';maxaveragebitrate=' + OPUS_MAX_BITRATE : '');
                section = section.replace(rtpmap[0], rtpmap[0] + eol + 'a=fmtp:' + pt + ' ' + p);
            }

            // ptime/maxptime — размер пакета (старые значения, если были, заменяем)
            if (OPUS_PTIME_MS > 20) {
                section = section.replace(/a=(max)?ptime:\d+(\r?\n)?/g, '');
                const fm = section.match(fmtpRe);
                section = section.replace(fm[0], fm[0] + eol + 'a=ptime:' + OPUS_PTIME_MS + eol + 'a=maxptime:' + OPUS_PTIME_MS);
            }
            parts[i] = isFirst ? section : section.slice(2);
        }
        return parts.join(eol + 'm=');
    } catch (e) {
        return sdp;
    }
}

function startCall(peerId) {
    if (!myPeer || myPeer.destroyed || !localMediaStream) { scheduleCallRetry(peerId); return; }
    const call = myPeer.call(peerId, localMediaStream, {
        metadata: { username: currentUser.username, avatar: currentUser.avatar },
        sdpTransform: enableOpusDtx
    });
    // PeerJS возвращает undefined, если сигнальное соединение сейчас разорвано.
    if (!call) { scheduleCallRetry(peerId); return; }
    handleIncomingCall(call);
}

function scheduleCallRetry(peerId) {
    // Перезваниваем только та сторона, что и должна звонить этой паре
    // (детерминированно, по сравнению peerId — см. 'room users'), иначе
    // опять получим двойное соединение.
    if (!(myPeerId < peerId) || !currentUser.room) return;
    const attempts = (callRetryCount[peerId] || 0) + 1;
    callRetryCount[peerId] = attempts;
    if (attempts > MAX_CALL_RETRIES) {
        console.warn(`[ICE] Исчерпан лимит попыток дозвониться до ${peerId}`);
        return;
    }
    setTimeout(() => {
        if (activeCalls[peerId] || !currentUser.room || !connectedUsers[peerId]) return;
        startCall(peerId);
    }, Math.min(1000 * attempts, 8000));
}

// После установления связи пишем в консоль, ЧЕРЕЗ ЧТО именно она идёт:
// host/srflx — напрямую, relay — через TURN. Если у кого-то relay не встречается
// никогда, а связь с другой сетью не поднимается — TURN не работает.
async function logSelectedCandidatePair(pc, peerId) {
    try {
        const stats = await pc.getStats();
        let pair = null;
        stats.forEach(r => {
            if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
        });
        if (!pair) {
            stats.forEach(r => {
                if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r;
            });
        }
        if (!pair) return;
        const local = stats.get(pair.localCandidateId) || {};
        const remote = stats.get(pair.remoteCandidateId) || {};
        console.log(`[ICE] Связь с ${peerId} установлена: у меня=${local.candidateType}/${local.protocol}, ` +
            `у собеседника=${remote.candidateType}/${remote.protocol}` +
            (local.candidateType === 'relay' || remote.candidateType === 'relay' ? '  (через TURN)' : ''));
    } catch (e) { /* ignore */ }
}

// Раньше, если ICE-соединение для конкретного звонка не устанавливалось (или
// обрывалось из-за временных проблем с TURN/сетью), звонок так и оставался
// висеть в activeCalls "навечно" — событие 'room users' видело, что запись уже
// есть, и никогда не пробовало перезвонить. Из-за этого часть участников
// оказывалась отрезанной друг от друга (например, 3 человека слышат друг друга,
// а ещё двое — только друг друга). Теперь при провале ICE (или если связь не
// поднялась за CALL_CONNECT_TIMEOUT_MS) звонок закрывается и, если мы —
// инициирующая сторона для этой пары, пробуем позвонить снова.
function watchCallConnection(call, peerId) {
    const pc = call.peerConnection;
    if (!pc) return;

    // Диагностика: показывает, КАКОЙ именно сервер (STUN/TURN) не ответил и почему.
    pc.addEventListener('icecandidateerror', (e) => {
        console.warn(`[ICE candidate error] с ${peerId}: url=${e.url} код=${e.errorCode} текст="${e.errorText}"`);
    });

    const recover = async (reason) => {
        if (call.__recovered) return;
        // Уже есть ДРУГОЙ (новый) звонок с этим человеком — старый таймер не должен его трогать.
        // Раньше запоздавший таймер старого звонка удалял запись НОВОГО звонка из activeCalls
        // и его аудио-узлы, из-за чего возникали дубли соединений и пропадал звук.
        if (activeCalls[peerId] && activeCalls[peerId] !== call) return;
        if (isIceConnected(pc)) return;
        call.__recovered = true;

        try {
            const stats = await pc.getStats();
            const cands = [];
            stats.forEach(r => {
                if (r.type === 'local-candidate' || r.type === 'remote-candidate') {
                    cands.push(`${r.type}:${r.candidateType}${r.protocol ? '/' + r.protocol : ''}`);
                }
            });
            console.warn(`[ICE] Кандидаты для ${peerId}:`, cands.join(', ') || '(нет ни одного)');
        } catch (e) { /* ignore */ }
        console.warn(`[ICE] Соединение с ${peerId} не поднялось (${reason}, state=${pc.iceConnectionState}), переустанавливаем звонок`);

        // Повторная проверка после await: за это время могли создать новый звонок.
        if (activeCalls[peerId] && activeCalls[peerId] !== call) return;
        try { call.close(); } catch (e) {}
        if (activeCalls[peerId] === call) delete activeCalls[peerId];
        cleanupRemoteAudio(peerId);
        delete remoteStreamsByPeer[peerId];
        const el = document.getElementById(`video-${peerId}`);
        if (el) el.remove();

        scheduleCallRetry(peerId);
    };

    // Сторожевой таймер: связь должна подняться за разумное время.
    setTimeout(() => recover('таймаут установки связи'), CALL_CONNECT_TIMEOUT_MS);

    pc.addEventListener('iceconnectionstatechange', () => {
        const state = pc.iceConnectionState;
        console.log(`[ICE] Состояние соединения с ${peerId}:`, state);
        if (state === 'failed' || state === 'disconnected') {
            // Даём немного времени на самовосстановление (ICE restart браузера).
            setTimeout(() => recover(`ICE ${state}`), 4000);
        } else if (state === 'connected' || state === 'completed') {
            callRetryCount[peerId] = 0;
            logSelectedCandidatePair(pc, peerId);
        }
    });
}

function handleIncomingCall(call) {
    if (call.peer === myPeerId) return;
    activeCalls[call.peer] = call;
    watchCallConnection(call, call.peer);

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
        // Если этот звонок уже заменён новым — его закрытие не должно ломать новый
        // (иначе пропадали <audio>-элемент и узлы громкости живого соединения).
        if (activeCalls[call.peer] && activeCalls[call.peer] !== call) return;
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
                <input type="range" id="demo-vol-slider-${peerId}" min="0" max="150" step="1" value="${demoVolumes[peerId] ?? 100}">
            </div>
            <video autoplay playsinline muted></video>
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
    // ВАЖНО: элемент обязан быть заглушён. В потоке демонстрирующего два аудиотрека (голос и звук
    // демки), и незаглушённое <video> проигрывало их напрямую на полной громкости, в обход
    // ползунков: громкость человека (пока он показывает экран) и громкость демки ничего не меняли,
    // голос ещё и звучал дважды. Реальный звук идёт только через gain-узлы (см. attachRemoteStream).
    videoEl.muted = true;
    if (videoEl.srcObject !== remoteStream) {
        videoEl.srcObject = remoteStream;
        videoEl.play().catch(err => console.log("[Внимание] Автоплей заблокирован:", err));
    }
}

socket.on('user connected', ({ username, avatar, peerId }) => {
    // Раньше здесь запись полностью перезаписывалась заново собранным объектом
    // без micMuted/deafened — а событие 'room users' (с уже верным статусом мута)
    // приходит непосредственно ПЕРЕД этим событием, и его тут же затирало.
    // Из-за этого человек, зашедший в канал уже в муте, первое время (а то и
    // насовсем, если никто больше не переключал мьют) отображался как НЕ в муте.
    // Теперь просто дополняем существующую запись, а не заменяем её целиком.
    clearPeerLeft(peerId);
    const prev = connectedUsers[peerId] || {};
    connectedUsers[peerId] = { ...prev, username, avatar };
    if (currentUser.room) updateVoiceUsersList();

    // Звук входа здесь НЕ играем: 'user connected' приходит и при быстром
    // переподключении того же человека (тот же peerId, новый сокет) — это не
    // новый вход. Звук входа определяется по разнице списков в 'room users'.
});

socket.on('user disconnected', (peerId) => {
    markPeerLeft(peerId);
    const wasPresent = !!connectedUsers[peerId];
    delete connectedUsers[peerId];
    cleanupRemoteAudio(peerId);
    delete remoteStreamsByPeer[peerId];
    sharingPeers.delete(peerId);
    if (currentUser.room) updateVoiceUsersList();
    if (listenSession && listenSession.peerId === peerId) endListenSession(true);

    // Звук выхода — только если мы сами сейчас в голосовом канале
    if (wasPresent && peerId !== myPeerId && currentUser.room) {
        playPresenceSound('leave', peerId);
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
    // Основной список — это звонок (если мы в нём), иначе просматриваемый канал.
    const code = customCodeFromRoomName(currentUser.room || selectedRoom);
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

// Строка участника. interactive=false — для блока «просмотр» (мы в этом канале не
// в звонке): без id (чтобы не дублировать id строк основного списка) и без громкости.
function buildVoiceUserRow(id, user, interactive = true) {
    const row = document.createElement('div');
    row.className = 'voice-user-row' + (interactive && id !== myPeerId && isRemoteLocallyMuted(user.username) ? ' local-muted' : '');
    const ids = (kind) => interactive ? `id="${kind}-${id}"` : '';
    const nq = (interactive && id !== myPeerId) ? netQualityByPeer[id] : null;
    let netQualityHtml = (interactive && id !== myPeerId)
        ? `<span class="net-quality q-${nq ? nq.level : 'unknown'}" id="netq-${id}" title="${nq ? escapeHtml(nq.title) : 'Качество связи: измеряется…'}"></span>`
        : '';
    // Своя точка: к себе WebRTC-соединения нет, поэтому показываем пинг до сервера.
    if (interactive && id === myPeerId) {
        netQualityHtml = `<span class="net-quality self q-${selfNetQuality.level}" id="netq-self" title="${escapeHtml(selfNetQuality.title)}"></span>`;
        scheduleSelfNetQualityPoll();
    }
    row.innerHTML = `
        <div class="user-avatar-wrap">
            <img src="${user.avatar || 'https://api.dicebear.com/7.x/identicon/svg?seed=def'}" class="user-avatar" ${ids('avatar')} alt="">
            <span class="status-badge mic-mute-badge${(user.micMuted && !user.deafened) ? ' visible' : ''}" ${ids('mic-badge')} title="Микрофон выключен">${MIC_OFF_ICON_SVG}</span>
            <span class="status-badge deafen-badge${user.deafened ? ' visible' : ''}" ${ids('deafen-badge')} title="Наушники выключены">${DEAFEN_OFF_ICON_SVG}</span>
        </div>
        <span class="voice-user-name" title="${escapeHtml(user.username || 'Участник')}" style="color:${getUserColor(user.username)}">${escapeHtml(user.username || 'Участник')}</span>
        ${user.micRevoked ? '<span class="mic-revoked-tag" title="Модератор отключил этому участнику микрофон">без микрофона</span>' : ''}
        ${netQualityHtml}
    `;
    // Громкость каждого собеседника можно менять только у себя — по клику на его
    // строку в списке. На себя самого это не вешаем.
    if (interactive && id !== myPeerId) {
        row.classList.add('clickable');
        row.title = 'Нажать: громкость и заглушение только для себя';
        row.addEventListener('click', () => openUserVolumePopover(id, row, user.username || 'Участник'));
    }
    return row;
}

// Участники голосового канала, который мы ПРОСМАТРИВАЕМ, пока сидим в звонке другого.
// ВАЖНО: раньше этот блок прятался целиком, если в просматриваемом канале никого
// не было — тогда на экране оставался только основной список (voice-users-container),
// а он всегда показывает именно ВАШ звонок, а не просматриваемый канал. Из-за этого
// казалось, будто при переходе в другой канал там "те же люди, что и в своём" —
// на самом деле это и были участники своего звонка, просто блок "Просмотр" с
// (пустым) списком другого канала был не виден. Теперь блок всегда показывается,
// пока открыт чужой канал, и заголовок над основным списком тоже меняется, чтобы
// не путать "свой звонок" с "просматриваемым каналом".
function renderPreviewUsers() {
    const wrap = document.getElementById('voice-preview');
    const title = document.getElementById('voice-preview-title');
    const cont = document.getElementById('voice-preview-container');
    const heading = document.getElementById('voice-users-heading');
    if (!wrap || !title || !cont) return;
    const ids = Object.keys(previewUsers || {});
    const viewingElsewhere = !!currentUser.room && !!selectedRoom && currentUser.room !== selectedRoom;

    if (heading) heading.textContent = viewingElsewhere ? 'Ваш звонок' : 'Участники канала';

    if (!viewingElsewhere) { wrap.style.display = 'none'; cont.innerHTML = ''; return; }

    title.textContent = `Просмотр: ${roomDisplayName(selectedRoom)} — ${ids.length}`;
    cont.innerHTML = '';
    if (ids.length) {
        ids.forEach(id => cont.appendChild(buildVoiceUserRow(id, previewUsers[id], false)));
    } else {
        const empty = document.createElement('div');
        empty.className = 'voice-preview-empty';
        empty.textContent = 'Никого нет в голосовом канале';
        cont.appendChild(empty);
    }
    wrap.style.display = '';
}

function updateVoiceUsersList(users = connectedUsers) {
    lastRenderedVoiceUsers = users;
    voiceUsersContainer.innerHTML = '';
    for (let id in users) {
        voiceUsersContainer.appendChild(buildVoiceUserRow(id, users[id], true));
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

// ---------- Масштаб интерфейса (только десктоп-приложение) ----------
// Используем настоящий масштаб страницы WebView2 (как Ctrl +/−), а не CSS zoom: так
// правильно работают всплывающие окна, перетаскивание разделителей и размеры в vh/vw.
// Значение хранится на устройстве и применяется при каждом запуске.
const UI_SCALE_KEY = 'mute_ui_scale';
const UI_SCALE_MIN = 50, UI_SCALE_MAX = 200, UI_SCALE_DEFAULT = 100;

function loadUiScale() {
    try {
        const n = parseInt(localStorage.getItem(UI_SCALE_KEY), 10);
        if (Number.isFinite(n)) return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, n));
    } catch (e) { /* ignore */ }
    return UI_SCALE_DEFAULT;
}

// Возвращает Promise<string|null>: null — применилось, строка — текст причины, почему нет.
function applyUiScale(percent) {
    const t = window.__TAURI__;
    const invoke = t && t.core && t.core.invoke;
    if (typeof invoke !== 'function') {
        return Promise.resolve('API Tauri недоступен.');
    }
    return Promise.resolve()
        .then(() => invoke('set_ui_scale', { percent }))
        .then(() => null)
        .catch(e => { console.warn('[ui-scale]', e); return String((e && e.message) || e); });
}

(function initUiScaleSetting() {
    const range = document.getElementById('ui-scale-range');
    const label = document.getElementById('ui-scale-value');
    const resetBtn = document.getElementById('ui-scale-reset-btn');
    if (!range) return;
    const saved = loadUiScale();
    range.value = saved;
    if (label) label.textContent = saved + '%';
    const errEl = document.getElementById('ui-scale-error');
    const show = (reason) => {
        if (!errEl) return;
        errEl.textContent = reason ? ('Не удалось применить масштаб: ' + reason + ' Пересоберите приложение (npm run tauri build) и установите заново.') : '';
        errEl.style.display = reason ? '' : 'none';
    };
    if (saved !== UI_SCALE_DEFAULT) applyUiScale(saved).then(show);

    // Пока тянем ползунок — меняем только цифру: если масштабировать на лету,
    // ползунок «убегает» из-под курсора. Применяем при отпускании.
    range.addEventListener('input', () => { if (label) label.textContent = range.value + '%'; });
    range.addEventListener('change', () => {
        const v = parseInt(range.value, 10) || UI_SCALE_DEFAULT;
        try { localStorage.setItem(UI_SCALE_KEY, String(v)); } catch (e) { /* ignore */ }
        applyUiScale(v).then(show);
    });
    if (resetBtn) resetBtn.addEventListener('click', () => {
        range.value = UI_SCALE_DEFAULT;
        if (label) label.textContent = UI_SCALE_DEFAULT + '%';
        try { localStorage.removeItem(UI_SCALE_KEY); } catch (e) { /* ignore */ }
        applyUiScale(UI_SCALE_DEFAULT).then(show);
    });
})();

// Переключатель в настройках кастомизации
(function initOffCallMembersSetting() {
    const check = document.getElementById('show-offcall-members-check');
    if (!check) return;
    check.checked = showOffCallMembers;
    check.addEventListener('change', () => {
        showOffCallMembers = check.checked;
        try { localStorage.setItem(SHOW_OFFCALL_KEY, showOffCallMembers ? '1' : '0'); } catch (e) { /* ignore */ }
        const code = customCodeFromRoomName(currentUser.room || selectedRoom);
        if (showOffCallMembers && code) socket.emit('get server members', { code });
        updateVoiceUsersList(lastRenderedVoiceUsers);
    });
})();

// Переключатель «Не беспокоить в звонке» в Спец. возможностях
(function initCallstartQuietInCallSetting() {
    const check = document.getElementById('callstart-quiet-in-call-check');
    if (!check) return;
    check.checked = callstartQuietInCall;
    check.addEventListener('change', () => {
        callstartQuietInCall = check.checked;
        try { localStorage.setItem(CALLSTART_QUIET_IN_CALL_KEY, callstartQuietInCall ? '1' : '0'); } catch (e) { /* ignore */ }
        // Если уже играет чужой рингтон, а мы сейчас в звонке — сразу его глушим.
        if (callstartQuietInCall && isInCallWithSomeone()) stopNotifySound('callstart');
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
    // Модератору (создателю сервера или админу) в звонке сервера доступно управление чужим микрофоном.
    const roomCode = customCodeFromRoomName(currentUser.room);
    const canModMic = !!(currentServerInfo && currentServerInfo.canModerate && roomCode &&
        String(currentServerInfo.code).toUpperCase() === String(roomCode).toUpperCase());
    const micRevoked = !!(connectedUsers[peerId] && connectedUsers[peerId].micRevoked);
    const pop = document.createElement('div');
    pop.id = 'user-volume-popover';
    pop.className = 'user-volume-popover fade-in';
    pop.innerHTML = `
        <div class="user-volume-popover-title">Громкость: <span style="color:${getUserColor(username)}">${escapeHtml(username)}</span></div>
        <input type="range" id="user-volume-range" min="0" max="500" step="1" value="${percent}">
        <div class="user-volume-popover-value">${percent}%</div>
        <span class="profile-hint">Меняется только у вас — собеседник об этом не узнает</span>
        <button type="button" class="listen-invite-btn" id="user-local-mute-btn"></button>
        ${canModMic ? `<div class="user-volume-popover-divider"></div>
        <button type="button" class="listen-invite-btn${micRevoked ? ' is-active' : ''}" id="user-mic-access-btn"><span>${micRevoked ? 'Вернуть доступ к микрофону' : 'Забрать доступ к микрофону'}</span></button>` : ''}
        <div class="user-volume-popover-divider"></div>
        <button type="button" class="listen-invite-btn${listenSession && listenSession.peerId === peerId ? ' is-active' : ''}" id="listen-invite-popover-btn">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
            <span>${listenSession && listenSession.peerId === peerId ? 'Завершить совместное прослушивание' : 'Слушать музыку вместе'}</span>
        </button>
    `;
    document.body.appendChild(pop);

    const micAccessBtn = pop.querySelector('#user-mic-access-btn');
    if (micAccessBtn) micAccessBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeUserVolumePopover();
        socket.emit('set mic access', { username, allowed: micRevoked });
    });

    pop.querySelector('#listen-invite-popover-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        closeUserVolumePopover();
        if (listenSession && listenSession.peerId === peerId) {
            endListenSession(false);
        } else if (!playlistTracks.length) {
            alert('Сначала добавьте хотя бы один трек в свой плейлист (Настройки → Плейлист).');
        } else {
            sendListenInvite(peerId, username);
        }
    });

    const anchorRect = anchorEl.getBoundingClientRect();
    const popWidth = 220;
    pop.style.left = `${Math.max(8, Math.min(anchorRect.left, window.innerWidth - popWidth - 8))}px`;
    pop.style.top = `${Math.min(anchorRect.bottom + 6, window.innerHeight - 110)}px`;

    const localMuteBtn = pop.querySelector('#user-local-mute-btn');
    const refreshLocalMuteBtn = () => {
        const m = isRemoteLocallyMuted(username);
        localMuteBtn.classList.toggle('is-active', m);
        localMuteBtn.innerHTML = `<span>${m ? 'Включить звук участника' : 'Заглушить для себя'}</span>`;
    };
    refreshLocalMuteBtn();
    localMuteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setRemoteLocallyMuted(username, !isRemoteLocallyMuted(username));
        if (remoteVoiceGainNodes[peerId]) remoteVoiceGainNodes[peerId].gain.value = remoteGainValue(username);
        const av = document.getElementById(`avatar-${peerId}`);
        const rowEl = av && av.closest('.voice-user-row');
        if (rowEl) rowEl.classList.toggle('local-muted', isRemoteLocallyMuted(username));
        refreshLocalMuteBtn();
    });

    const rangeInput = pop.querySelector('#user-volume-range');
    const valueLabel = pop.querySelector('.user-volume-popover-value');
    rangeInput.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        valueLabel.innerText = `${val}%`;
        saveRemoteVolume(username, val);
        if (remoteVoiceGainNodes[peerId]) {
            remoteVoiceGainNodes[peerId].gain.value = remoteGainValue(username);
        }
    });
    rangeInput.addEventListener('click', (e) => e.stopPropagation());

    setTimeout(() => document.addEventListener('mousedown', onDocMouseDownForVolumePopover, true), 0);
}

// ---------- Качество связи с участниками ----------
// Раз в несколько секунд читаем статистику WebRTC каждого соединения: пинг (RTT) и долю
// потерянных аудиопакетов за последний интервал. Показываем цветной точкой у ника.
const NET_QUALITY_KEY = 'mute_show_net_quality';
const NET_QUALITY_POLL_MS = 4000;
let showNetQuality = true;
try { showNetQuality = localStorage.getItem(NET_QUALITY_KEY) !== '0'; } catch (e) { /* ignore */ }
document.documentElement.classList.toggle('no-net-quality', !showNetQuality);
const netQualityPrev = {};     // peerId -> { lost, recv }
let netQualityBusy = false;
// Своя точка: пинг до сервера (socket.io с подтверждением). Берём медиану трёх последних замеров,
// чтобы одиночный скачок не перекрашивал точку.

function scheduleSelfNetQualityPoll() {
    // Строку со своей точкой только что нарисовали — не ждём следующего тика опроса.
    if (selfPollScheduled || selfPingSamples.length) return;
    selfPollScheduled = true;
    setTimeout(() => { selfPollScheduled = false; pollNetQuality(); }, 600);
}

function measureServerPing() {
    return new Promise((resolve) => {
        if (!socket.connected) return resolve(null);
        const t0 = performance.now();
        socket.timeout(3000).emit('net ping', (err) => resolve(err ? null : performance.now() - t0));
    });
}

async function updateSelfNetQuality() {
    const ms = await measureServerPing();
    if (ms == null) {
        selfPingSamples.length = 0;
        selfNetQuality = { level: 'bad', title: 'Нет связи с сервером' };
    } else {
        selfPingSamples.push(ms);
        if (selfPingSamples.length > 3) selfPingSamples.shift();
        const sorted = [...selfPingSamples].sort((a, b) => a - b);
        const med = sorted[Math.floor(sorted.length / 2)];
        selfNetQuality = { level: netQualityLevel(med, 0), title: `Ваш пинг до сервера: ${Math.round(med)} мс` };
    }
    const el = document.getElementById('netq-self');
    if (el) {
        el.className = `net-quality self q-${selfNetQuality.level}`;
        el.title = selfNetQuality.title;
    }
}

function netQualityLevel(rttMs, lossPct) {
    if (rttMs == null) return 'unknown';
    if (rttMs < 150 && lossPct < 3) return 'good';
    if (rttMs < 300 && lossPct < 10) return 'ok';
    return 'bad';
}

async function pollNetQuality() {
    if (netQualityBusy || !showNetQuality || !currentUser.room || windowIsInactive()) return;
    netQualityBusy = true;
    try {
        const peerIds = Object.keys(activeCalls);
        for (const peerId of peerIds) {
            const call = activeCalls[peerId];
            const pc = call && call.peerConnection;
            if (!pc) continue;
            let rtt = null, lost = 0, recv = 0, jitter = null;
            try {
                const stats = await pc.getStats();
                stats.forEach(r => {
                    if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && typeof r.currentRoundTripTime === 'number') {
                        rtt = r.currentRoundTripTime * 1000;
                    }
                    if (r.type === 'inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio')) {
                        lost += r.packetsLost || 0;
                        recv += r.packetsReceived || 0;
                        if (typeof r.jitter === 'number') jitter = r.jitter * 1000;
                    }
                });
            } catch (e) { continue; }
            const prev = netQualityPrev[peerId];
            netQualityPrev[peerId] = { lost, recv };
            let lossPct = 0;
            if (prev) {
                const dLost = Math.max(0, lost - prev.lost);
                const dRecv = Math.max(0, recv - prev.recv);
                lossPct = (dLost + dRecv) > 0 ? (100 * dLost) / (dLost + dRecv) : 0;
            }
            const level = netQualityLevel(rtt, lossPct);
            const title = rtt == null
                ? 'Качество связи: нет данных'
                : `Пинг ${Math.round(rtt)} мс · потери ${lossPct.toFixed(1)}%` + (jitter != null ? ` · джиттер ${Math.round(jitter)} мс` : '');
            netQualityByPeer[peerId] = { level, title };
            const el = document.getElementById(`netq-${peerId}`);
            if (el) {
                el.className = `net-quality q-${level}`;
                el.title = title;
            }
        }
        await updateSelfNetQuality();
        // забываем тех, с кем звонка уже нет
        Object.keys(netQualityByPeer).forEach(id => {
            if (!activeCalls[id]) { delete netQualityByPeer[id]; delete netQualityPrev[id]; }
        });
    } finally {
        netQualityBusy = false;
    }
}
setInterval(pollNetQuality, NET_QUALITY_POLL_MS);

// Обновляет значки конкретного участника без перерисовки всего списка.
// При дефене показываем ТОЛЬКО значок наушников: микрофон и так подразумевается выключенным,
// два значка сразу (микрофон + наушники) только загромождали аватарку.
function setUserStatusBadges(peerId, micMuted, deafened) {
    const micBadge = document.getElementById(`mic-badge-${peerId}`);
    if (micBadge) micBadge.classList.toggle('visible', !!micMuted && !deafened);
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
        // Разрешение/FPS берутся из настроек (от 720p30 до 4K30/2K60).
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
        // То же самое: пресет из настроек видео (разрешение и FPS берутся из настроек видео).
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

    playScreenShareSound(true);
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

    playScreenShareSound(false);
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
    if (tabName === 'sound' && typeof renderSoundChannelLists === 'function') renderSoundChannelLists();
    if (tabName === 'mic' && typeof loadOutputDevices === 'function') loadOutputDevices();
    renderSettingsSubtopics(tabName);
}
// Подтемы: под выбранным пунктом появляется список его секций, клик по подтеме прокручивает к секции.
function settingsSectionLabel(sec) {
    const t = sec.querySelector('.settings-section-title');
    return t ? t.textContent.replace(/\s+/g, ' ').trim() : '';
}
function renderSettingsSubtopics(tabName) {
    settingsTabButtons.forEach(btn => {
        let list = btn.nextElementSibling;
        if (!list || !list.classList.contains('settings-subtopics')) {
            list = document.createElement('div');
            list.className = 'settings-subtopics';
            btn.insertAdjacentElement('afterend', list);
        }
        list.textContent = '';
        if (btn.dataset.tab !== tabName) { list.classList.remove('open'); return; }
        const panel = document.querySelector('#settings-modal .settings-tab-panel[data-tab-panel="' + tabName + '"]');
        if (!panel) return;
        panel.querySelectorAll('.settings-section').forEach(sec => {
            if (getComputedStyle(sec).display === 'none') return; // например, пункты только для десктопа в браузере
            const label = settingsSectionLabel(sec);
            if (!label) return;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'settings-subtopic';
            b.textContent = label;
            b.addEventListener('click', () => {
                sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
                sec.classList.remove('flash-section');
                void sec.offsetWidth;
                sec.classList.add('flash-section');
                setTimeout(() => sec.classList.remove('flash-section'), 1000);
            });
            list.appendChild(b);
        });
        list.classList.toggle('open', list.children.length > 0);
    });
}
settingsTabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.classList.contains('active')) {
            // повторный клик по открытому пункту сворачивает / разворачивает подтемы
            const list = btn.nextElementSibling;
            if (list && list.classList.contains('settings-subtopics') && list.children.length) list.classList.toggle('open');
        } else {
            switchSettingsTab(btn.dataset.tab);
        }
    });
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
// GIF-анимации во всём интерфейсе Mute: при неактивном/скрытом окне временно заменяем GIF на 1x1 placeholder.
// Это касается сообщений, аватарок и GIF-иконок каналов/серверов. Размеры не меняются.
const GIF_PAUSE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
let gifsPaused = false;
function isGifUrl(src) { return typeof src === 'string' && /\.gif(?:[?#]|$)/i.test(src); }
function pauseGifElement(img) {
    if (!(img instanceof HTMLImageElement) || img.dataset.gifSrc) return;
    const src = img.getAttribute('src');
    if (!src || src === GIF_PAUSE_PLACEHOLDER || !isGifUrl(src)) return;
    img.dataset.gifSrc = src; img.src = GIF_PAUSE_PLACEHOLDER;
}
function resumeGifElement(img) { const src = img.dataset.gifSrc; if (!src) return; img.src = src; delete img.dataset.gifSrc; }
function pauseBackgroundGifElement(el) {
    if (!(el instanceof HTMLElement) || el.dataset.gifBgSrc) return;
    const bg = el.style.backgroundImage || '';
    const match = bg.match(/^url\([\"']?(.*?)[\"']?\)$/i);
    if (!match || !isGifUrl(match[1])) return;
    el.dataset.gifBgSrc = match[1]; el.style.backgroundImage = `url(\"${GIF_PAUSE_PLACEHOLDER}\")`;
}
function resumeBackgroundGifElement(el) {
    const src = el.dataset.gifBgSrc; if (!src) return;
    el.style.backgroundImage = `url(\"${src.replace(/\"/g, '\\\"')}\")`; delete el.dataset.gifBgSrc;
}
function pauseAllGifs() {
    if (gifsPaused) return; gifsPaused = true;
    document.querySelectorAll('img').forEach(pauseGifElement);
    document.querySelectorAll('[style*=\"background-image\"]').forEach(pauseBackgroundGifElement);
}
function resumeAllGifs() {
    if (!gifsPaused) return; gifsPaused = false;
    document.querySelectorAll('img[data-gif-src]').forEach(resumeGifElement);
    document.querySelectorAll('[data-gif-bg-src]').forEach(resumeBackgroundGifElement);
}
function syncGifActivity() { if (document.hidden || !document.hasFocus()) pauseAllGifs(); else resumeAllGifs(); }
const gifPauseObserver = new MutationObserver((mutations) => {
    if (!gifsPaused) return;
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('img')) pauseGifElement(node);
        node.querySelectorAll?.('img').forEach(pauseGifElement);
        if (node instanceof HTMLElement) pauseBackgroundGifElement(node);
        node.querySelectorAll?.('[style*=\"background-image\"]').forEach(pauseBackgroundGifElement);
    }
});
gifPauseObserver.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioContext && audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    if (!document.hidden) resyncRoomUsers(); syncGifActivity();
});
window.addEventListener('blur', pauseAllGifs);
window.addEventListener('focus', () => { resumeAllGifs(); resyncRoomUsers(); });
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
    if (micAccessRevoked && isMuted) {
        showToast('Модератор отключил вам микрофон — включить его нельзя.', 4000);
        return;
    }
    isMuted = !isMuted;
    applyGateToMicTrack();
    muteBtn.classList.toggle('active', isMuted);
    playMuteSound(isMuted);
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
        remoteVoiceGainNodes[peerId].gain.value = remoteGainValue(username);
    });

    deafenBtn.classList.toggle('active', isDeafened);
    
    muteBtn.classList.toggle('active', isDeafened || isMuted);
    muteBtn.disabled = isDeafened;
    playDeafenSound(isDeafened);
    broadcastMuteState();
});

// Модератор забрал / вернул нам доступ к микрофону (или сервер сообщает текущее состояние при входе в канал).
socket.on('mic access changed', ({ allowed, initial } = {}) => {
    const wasRevoked = micAccessRevoked;
    micAccessRevoked = !allowed;
    if (micAccessRevoked) {
        isMuted = true;
        muteBtn.classList.add('active');
        applyGateToMicTrack();
        broadcastMuteState();
        if (!wasRevoked) {
            playMuteSound();
            showToast('Модератор отключил вам микрофон.', 5000);
        }
    } else if (wasRevoked && !initial) {
        showToast('Вам вернули доступ к микрофону — можете включить его.', 5000);
    }
    if (myPeerId && connectedUsers[myPeerId]) {
        connectedUsers[myPeerId].micRevoked = micAccessRevoked;
        updateVoiceUsersList();
    }
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
    { id: 'leave', label: 'Покинуть звонок' },
    { id: 'playpause', label: 'Плеер: старт / пауза' },
    { id: 'prevtrack', label: 'Плеер: предыдущий трек' },
    { id: 'nexttrack', label: 'Плеер: следующий трек' },
    { id: 'voicechanger', label: 'Изменение голоса' },
    { id: 'overlayedit', label: 'Оверлей: режим настройки' },
    { id: 'ptt', label: 'Рация: удерживайте, чтобы говорить' },
    { id: 'spstop', label: 'Саундпад: остановить все звуки' }
];
let keybinds = { mute: '', deafen: '', leave: '', playpause: '', prevtrack: '', nexttrack: '', voicechanger: '', overlayedit: '', ptt: '', spstop: '', global: true };
try {
    const raw = localStorage.getItem(KEYBINDS_KEY);
    if (raw) keybinds = { ...keybinds, ...JSON.parse(raw) };
} catch (e) { /* ignore */ }
const keybindGlobalOk = {};   // какие действия реально зарегистрированы глобально
let keybindRecording = null;  // id действия, для которого сейчас ждём комбинацию

function saveKeybinds() {
    try { localStorage.setItem(KEYBINDS_KEY, JSON.stringify(keybinds)); } catch (e) { /* ignore */ }
    updatePttKeyHint();
}

function updatePttKeyHint() {
    const el = document.getElementById('ptt-key-hint');
    if (!el) return;
    el.textContent = keybinds.ptt ? ` Сейчас: ${prettyCombo(keybinds.ptt)}.` : ' Клавиша пока не назначена.';
}

function runKeybindAction(id) {
    if (typeof id === 'string' && id.startsWith('sp:')) { spPlayToggle(id.slice(3)); return; }
    if (id === 'spstop') { spStopAll(); return; }
    if (id === 'mute') { if (!muteBtn.disabled) muteBtn.click(); }
    else if (id === 'deafen') deafenBtn.click();
    else if (id === 'leave') { if (currentUser.room) leaveVoiceChannel(); }
    else if (id === 'playpause') togglePlaylistPlayPause();
    else if (id === 'prevtrack') playlistPrevTrack();
    else if (id === 'nexttrack') playlistNextTrack();
    else if (id === 'ptt') pttSet(true);
    else if (id === 'overlayedit') { if (typeof window.muteOverlayToggleEdit === 'function') window.muteOverlayToggleEdit(); }
    else if (id === 'voicechanger') {
        const check = document.getElementById('voice-changer-check');
        if (check && !check.disabled) {
            check.checked = !check.checked;
            check.dispatchEvent(new Event('change'));
        }
    }
}

function keyEventToCombo(e) {
    // У синтетических keydown (например, когда Chrome подставляет значение автозаполнения
    // в поле ввода) поля e.code нет вообще — раньше это ронуло .replace() ниже.
    if (!e || typeof e.code !== 'string' || !e.code) return null;
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
    KEYBIND_ACTIONS.filter(a => !a.hidden).forEach(a => {
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
            clear.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
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
    if (typeof renderSoundpad === 'function') renderSoundpad();
    syncGlobalShortcuts();
}

async function startKeybindRecording(id) {
    showKeybindError('');
    keybindRecording = id;
    renderKeybindList();
    if (typeof renderSoundpad === 'function') renderSoundpad();
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

// Отпускание клавиши рации в обычном (оконном) режиме — в браузере и когда глобальная
// привязка не сработала.
document.addEventListener('keyup', (e) => {
    const combo = keybinds.ptt;
    if (!combo || keybindGlobalOk.ptt || typeof e.code !== 'string') return;
    const main = combo.split('+').pop();
    const code = e.code.replace(/^Key/, '').replace(/^Digit/, '');
    const isMod = /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code);
    if (code === main || (isMod && combo.includes('+'))) pttSet(false);
});
window.addEventListener('blur', () => { if (!keybindGlobalOk.ptt) pttSet(false); });

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
                if (a.id === 'ptt') {
                    // Рации нужны и нажатие, и отпускание клавиши.
                    if (!ev || ev.state === 'Pressed') pttSet(true);
                    else if (ev.state === 'Released') pttSet(false);
                    return;
                }
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

// ---------- Самовосстановление микрофона ----------
// Раньше, если микрофонный трек обрывался или метр уровня «замирал» (сон/пробуждение, смена
// устройства, приостановленный AudioContext), гейт оставался закрытым и человека не было слышно,
// хотя он говорит и индикатор «в сети» горит. Теперь раз в 2 секунды проверяем:
//  1) AudioContext запущен (иначе будим);
//  2) микрофонный трек жив (иначе пересобираем микрофон);
//  3) метр уровня присылает данные (иначе открываем гейт, чтобы голос шёл, и пересобираем).
let micRecovering = false;
let micLastRecoverAt = 0;
function scheduleMicRecover(reason) {
    if (micRecovering || !appMicAllowed() || micAccessRevoked) return;
    if (Date.now() - micLastRecoverAt < 5000) return;
    micRecovering = true;
    micLastRecoverAt = Date.now();
    console.warn('[Микрофон] Восстановление:', reason);
    setTimeout(async () => {
        try {
            const sel = micSelect && micSelect.value ? micSelect.value : null;
            await initMediaStream(sel, true);
            const t = rawAudioStream && rawAudioStream.getAudioTracks()[0];
            if (!t || t.readyState === 'ended') await initMediaStream(null, true); // выбранного устройства уже нет — берём по умолчанию
        } catch (e) {
            console.warn('[Микрофон] Не удалось восстановить:', e);
        } finally {
            micLastLevelAt = Date.now();
            micRecovering = false;
            applyGateToMicTrack();
        }
    }, 300);
}
function micWatchdogTick() {
    if (!rawAudioStream || !appMicAllowed() || micAccessRevoked) return;
    if (audioContext && audioContext.state !== 'running' && audioContext.state !== 'closed') {
        audioContext.resume().catch(() => {});
    }
    const t = rawAudioStream.getAudioTracks()[0];
    if (!t || t.readyState === 'ended') { scheduleMicRecover('микрофонный трек не активен'); return; }
    // В свёрнутом окне отчёты метра могут приходить реже — по ним не судим (проверим при возврате в окно)
    if (!document.hidden && audioContext && audioContext.state === 'running' && Date.now() - micLastLevelAt > 2500) {
        // метр молчит — не оставляем гейт закрытым наглухо
        if (!gateOpen) { gateOpen = true; applyGateToMicTrack(); }
        scheduleMicRecover('метр уровня не присылает данные');
    }
}
setInterval(micWatchdogTick, 2000);
window.addEventListener('focus', micWatchdogTick);
document.addEventListener('visibilitychange', () => { if (!document.hidden) micWatchdogTick(); });
window.addEventListener('online', micWatchdogTick);


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
if (lowPerfModeCheck) {
    lowPerfModeCheck.checked = lowPerfModeEnabled;
    lowPerfModeCheck.addEventListener('change', () => {
        lowPerfModeEnabled = lowPerfModeCheck.checked;
        try { localStorage.setItem(LOW_PERF_MODE_KEY, lowPerfModeEnabled ? '1' : '0'); } catch (e) { /* ignore */ }
        applyLowPerfState(); // применится сразу, если окно как раз сейчас свёрнуто
    });
}

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

// Настройка «Рация (push-to-talk)» на вкладке микрофона.
(function initPttSetting() {
    const check = document.getElementById('ptt-enabled-check');
    updatePttKeyHint();
    if (!check) return;
    check.checked = pttEnabled;
    check.addEventListener('change', () => {
        pttEnabled = check.checked;
        pttHeld = false;
        if (pttReleaseTimer) { clearTimeout(pttReleaseTimer); pttReleaseTimer = null; }
        if (pttEnabled && gateCloseTimer) { clearTimeout(gateCloseTimer); gateCloseTimer = null; }
        saveAudioSettings({ pttEnabled });
        updateGateControlsDisabled();
        applyGateToMicTrack();
    });
})();

// Переключатели «Лёгкий интерфейс» и «Качество связи» в кастомизации.
(function initLightUiAndNetQuality() {
    const lightCheck = document.getElementById('light-ui-check');
    if (lightCheck) {
        lightCheck.checked = lightUiEnabled;
        lightCheck.addEventListener('change', () => {
            lightUiEnabled = lightCheck.checked;
            try { localStorage.setItem(LIGHT_UI_KEY, lightUiEnabled ? '1' : '0'); } catch (e) { /* ignore */ }
            document.documentElement.classList.toggle('light-ui', lightUiEnabled);
        });
    }
    const nqCheck = document.getElementById('net-quality-check');
    if (nqCheck) {
        nqCheck.checked = showNetQuality;
        nqCheck.addEventListener('change', () => {
            showNetQuality = nqCheck.checked;
            try { localStorage.setItem(NET_QUALITY_KEY, showNetQuality ? '1' : '0'); } catch (e) { /* ignore */ }
            document.documentElement.classList.toggle('no-net-quality', !showNetQuality);
            if (showNetQuality) pollNetQuality();
        });
    }
})();

// Изменение голоса («Девчачий голос»): включение и высота. Работает на лету, без
// пересборки микрофона и без обрыва звонка.
(function initVoiceChangerControls() {
    const check = document.getElementById('voice-changer-check');
    const slider = document.getElementById('voice-changer-pitch-slider');
    const valueEl = document.getElementById('voice-changer-pitch-value');
    const group = document.getElementById('voice-changer-pitch-group');
    const hint = document.getElementById('voice-changer-hint');
    if (!check || !slider) return;

    const supported = typeof AudioWorkletNode !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
    slider.min = VOICE_CHANGER_MIN_SEMITONES;
    slider.max = VOICE_CHANGER_MAX_SEMITONES;
    slider.value = voiceChangerSemitones;
    check.checked = voiceChangerEnabled && supported;
    const refresh = () => {
        if (valueEl) valueEl.innerText = voiceChangerSemitones > 0 ? `+${voiceChangerSemitones}` : `${voiceChangerSemitones}`;
        if (group) group.classList.toggle('control-group-disabled', !check.checked);
        slider.disabled = !check.checked;
    };
    refresh();

    if (!supported) {
        check.disabled = true;
        if (hint) hint.innerText = 'Изменение голоса не поддерживается в этом браузере (нужен AudioWorklet и HTTPS).';
        return;
    }

    check.addEventListener('change', () => {
        voiceChangerEnabled = check.checked;
        saveAudioSettings({ voiceChangerEnabled });
        refresh();
        if (audioContext && audioContext.state === 'suspended') audioContext.resume().catch(() => {});
        applyVoiceChanger();
    });
    slider.addEventListener('input', () => {
        voiceChangerSemitones = parseInt(slider.value, 10);
        saveAudioSettings({ voiceChangerSemitones });
        refresh();
        if (voiceChain && voiceChain.node) {
            voiceChain.node.parameters.get('ratio').value = semitonesToRatio(voiceChangerSemitones);
        }
    });
})();


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

// ---------- Ответы, реакции, смайлики и файлы в чате ----------
const RECENT_EMOJI_KEY = 'mute:recentEmoji';
const RECENT_EMOJI_MAX = 24;
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'];
const MAX_CLIENT_FILE_MB = 10; // должно совпадать с MAX_FILE_MB на сервере (по умолчанию 10)
const EMOJI_CATEGORIES = [
    { icon: '😀', list: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 👾 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾' },
    { icon: '👍', list: '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤏 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦵 🦶 👂 👃 👀 👁️ 👅 👄 🧠 🙋 🙆 🙅 🙇 🤦 🤷 🙎 🙍 💁 🤰 👶 🧒 👦 👧 🧑 👨 👩 🧓 👴 👵' },
    { icon: '❤️', list: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 💤 ✨ ⭐ 🌟 🔥 🎉 🎊 🎈 🎁 🏆 🥇 🥈 🥉 🎮 🎧 🎤 🎵 🎶 🎬 🎯 🎲 🧩' },
    { icon: '🐶', list: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦉 🐺 🐴 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🐙 🦀 🐠 🐬 🐳 🦈 🐘 🦒 🐑 🐓 🌸 🌹 🌻 🌲 🌴 🍀 🍄 🌈 ☀️ 🌙 ⛅ ☁️ ❄️ ⚡ 🌊 🌍' },
    { icon: '🍕', list: '🍏 🍎 🍌 🍉 🍇 🍓 🍒 🍑 🍍 🥝 🍅 🥑 🥕 🌽 🥔 🍞 🧀 🍳 🥓 🍔 🍟 🍕 🌭 🌮 🍝 🍣 🍜 🍩 🍪 🎂 🍰 🍫 🍬 🍭 🍦 ☕ 🍵 🥛 🍺 🍻 🥂 🍷 🍸 🥃 🥤' },
    { icon: '⚽', list: '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🥊 🎸 🎹 🥁 🎻 📱 💻 ⌨️ 🖥️ 🖱️ 📷 🎥 📺 💡 🔋 🔑 🔒 🔔 📎 📌 ✏️ 📝 📚 💰 💳 🚀 ✈️ 🚗 🚲 ⏰ 🏠 💊 🧸' },
    { icon: '✅', list: '✅ ❌ ⚠️ ❓ ❗ ➕ ➖ ✔️ ✖️ ➡️ ⬅️ ⬆️ ⬇️ 🔄 🔊 🔇 🆗 🆒 🆕 🔞 💬 ♻️ ❤️‍🔥 🚫 ⭕ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪' }
].map(c => ({ icon: c.icon, items: c.list.split(/\s+/).filter(Boolean) }));

function loadRecentEmoji() {
    try {
        const raw = JSON.parse(localStorage.getItem(RECENT_EMOJI_KEY) || '[]');
        return Array.isArray(raw) ? raw.filter(e => typeof e === 'string').slice(0, RECENT_EMOJI_MAX) : [];
    } catch (e) { return []; }
}
function rememberRecentEmoji(emoji) {
    try {
        const list = [emoji, ...loadRecentEmoji().filter(e => e !== emoji)].slice(0, RECENT_EMOJI_MAX);
        localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(list));
    } catch (e) { /* ignore */ }
}

// --- Выбор смайликов (один общий всплывающий блок) ---
let emojiPickerEl = null;
let emojiPickerState = null; // { onPick, closeOnPick, anchor, tab }

function ensureEmojiPicker() {
    if (emojiPickerEl) return emojiPickerEl;
    emojiPickerEl = document.createElement('div');
    emojiPickerEl.className = 'emoji-picker';
    emojiPickerEl.innerHTML = '<div class="emoji-sections"></div><div class="emoji-quick"></div><div class="emoji-tabs"></div><div class="emoji-grid"></div>';
    document.body.appendChild(emojiPickerEl);
    emojiPickerEl.addEventListener('mousedown', (e) => { if (!e.target.closest('.gif-link-input')) e.preventDefault(); }); // не уводим фокус из поля чата (кроме поля для ссылки на GIF)
    emojiPickerEl.addEventListener('click', (e) => {
        // Раздел GIF: убрать из коллекции / добавить свой / отправить
        const gifDel = e.target.closest('.my-gif-del');
        if (gifDel) { e.stopPropagation(); removeMyGif(gifDel.closest('.my-gif').dataset.id); return; }
        const gifItem = e.target.closest('.my-gif');
        if (gifItem && emojiPickerState) {
            const g = myGifs.find((x) => x.id === gifItem.dataset.id);
            if (g) { closeEmojiPicker(); sendMyGif(g); }
            return;
        }
        const cell = e.target.closest('.emoji-cell');
        if (cell && emojiPickerState) {
            const emoji = cell.dataset.emoji;
            rememberRecentEmoji(emoji);
            const { onPick, closeOnPick } = emojiPickerState;
            const keepOpen = e.shiftKey || !closeOnPick;
            if (!keepOpen) closeEmojiPicker();
            else renderEmojiGrid();
            onPick(emoji);
            return;
        }
        const sec = e.target.closest('.emoji-section');
        if (sec && emojiPickerState) {
            if (sec.dataset.section === 'gif') {
                emojiPickerState.tab = gifTabIndex();
            } else {
                const last = emojiPickerState.lastEmojiTab;
                emojiPickerState.tab = (typeof last === 'number') ? last : (loadRecentEmoji().length ? 0 : 1);
            }
            renderEmojiGrid();
            positionEmojiPicker(); // высота окна в разделах разная — держим его у кнопки
            return;
        }
        const tab = e.target.closest('.emoji-tab');
        if (tab && emojiPickerState) {
            emojiPickerState.tab = Number(tab.dataset.tab);
            renderEmojiGrid();
        }
    });
    document.addEventListener('mousedown', (e) => {
        if (!emojiPickerEl.classList.contains('open')) return;
        if (emojiPickerEl.contains(e.target)) return;
        if (emojiPickerState && emojiPickerState.anchor && emojiPickerState.anchor.contains(e.target)) return;
        closeEmojiPicker();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && emojiPickerEl.classList.contains('open')) closeEmojiPicker();
    });
    window.addEventListener('blur', () => closeEmojiPicker());
    messagesDiv.addEventListener('scroll', () => closeEmojiPicker(), { passive: true });
    return emojiPickerEl;
}

function closeEmojiPicker() {
    if (emojiPickerEl) emojiPickerEl.classList.remove('open');
    emojiPickerState = null;
    gifAddMode = null;
    updateEmojiBtnIcon();
}

function renderEmojiGrid() {
    if (!emojiPickerEl || !emojiPickerState) return;
    const mkCell = (emoji) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'emoji-cell';
        b.dataset.emoji = emoji;
        b.textContent = emoji;
        return b;
    };
    const quick = emojiPickerEl.querySelector('.emoji-quick');
    quick.innerHTML = '';
    quick.style.display = emojiPickerState.quick ? 'flex' : 'none';
    if (emojiPickerState.quick) QUICK_REACTIONS.forEach(e => quick.appendChild(mkCell(e)));

    // Вкладка 0 — недавние, дальше — категории, в конце (только в чате, не у реакций) — «GIF».
    const gifTab = gifTabIndex();
    const isGifTab = !!emojiPickerState.allowGif && emojiPickerState.tab === gifTab;
    if (!isGifTab) emojiPickerState.lastEmojiTab = emojiPickerState.tab;

    // Верхний переключатель разделов «Смайлики | GIF» (только в чате; у реакций GIF нет).
    const sections = emojiPickerEl.querySelector('.emoji-sections');
    sections.innerHTML = '';
    sections.style.display = emojiPickerState.allowGif ? 'flex' : 'none';
    if (emojiPickerState.allowGif) {
        [['emoji', 'Смайлики'], ['gif', 'GIF']].forEach(([key, label]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'emoji-section' + ((key === 'gif') === isGifTab ? ' active' : '');
            b.dataset.section = key;
            b.textContent = label;
            sections.appendChild(b);
        });
    }

    // Вкладка 0 — недавние, дальше — категории. В разделе GIF ряд категорий не нужен.
    const tabs = emojiPickerEl.querySelector('.emoji-tabs');
    tabs.innerHTML = '';
    tabs.style.display = isGifTab ? 'none' : 'flex';
    if (!isGifTab) {
        ['🕘', ...EMOJI_CATEGORIES.map(c => c.icon)].forEach((icon, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'emoji-tab' + (i === emojiPickerState.tab ? ' active' : '');
            b.dataset.tab = String(i);
            b.textContent = icon;
            tabs.appendChild(b);
        });
    }

    const grid = emojiPickerEl.querySelector('.emoji-grid');
    grid.innerHTML = '';
    grid.classList.toggle('gif-mode', isGifTab);
    updateEmojiBtnIcon();
    if (isGifTab) { renderMyGifGrid(grid); return; }
    const items = emojiPickerState.tab === 0 ? loadRecentEmoji() : EMOJI_CATEGORIES[emojiPickerState.tab - 1].items;
    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'emoji-empty';
        empty.textContent = 'Пока пусто — выберите смайлик из других вкладок';
        grid.appendChild(empty);
    } else {
        items.forEach(e => grid.appendChild(mkCell(e)));
    }
}

// quick — ряд быстрых реакций сверху; closeOnPick — закрывать после выбора (Shift — оставить).
function openEmojiPicker({ anchor, onPick, quick = false, closeOnPick = true, allowGif = false, startTab = null }) {
    ensureEmojiPicker();
    if (emojiPickerEl.classList.contains('open') && emojiPickerState && emojiPickerState.anchor === anchor) {
        closeEmojiPicker();
        return;
    }
    const hasRecent = loadRecentEmoji().length > 0;
    emojiPickerState = { onPick, closeOnPick, anchor, quick, allowGif, tab: startTab !== null ? startTab : (hasRecent ? 0 : 1) };
    renderEmojiGrid();
    emojiPickerEl.classList.add('open');
    positionEmojiPicker();
}

function positionEmojiPicker() {
    if (!emojiPickerEl || !emojiPickerState || !emojiPickerState.anchor) return;
    const r = emojiPickerState.anchor.getBoundingClientRect();
    const w = emojiPickerEl.offsetWidth || 328;
    const h = emojiPickerEl.offsetHeight || 330;
    let left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    let top = r.top - h - 6;
    if (top < 8) top = Math.min(r.bottom + 6, window.innerHeight - h - 8);
    emojiPickerEl.style.left = `${left}px`;
    emojiPickerEl.style.top = `${Math.max(8, top)}px`;
}

function insertEmojiIntoInput(emoji) {
    if (messageInput.disabled) return;
    const start = messageInput.selectionStart ?? messageInput.value.length;
    const end = messageInput.selectionEnd ?? start;
    messageInput.setRangeText(emoji, start, end, 'end');
    messageInput.focus();
    messageInput.dispatchEvent(new Event('input', { bubbles: true }));
}

const emojiBtn = document.getElementById('emoji-btn');
if (emojiBtn) {
    emojiBtn.addEventListener('click', () => {
        openEmojiPicker({ anchor: emojiBtn, onPick: insertEmojiIntoInput, quick: false, closeOnPick: true, allowGif: true });
    });
}

// Отдельная кнопка GIF: то же окно, но сразу на разделе GIF (раздел остаётся и в окне смайликов)
const gifBtn = document.getElementById('gif-btn');
if (gifBtn) {
    gifBtn.addEventListener('click', () => {
        openEmojiPicker({ anchor: gifBtn, onPick: insertEmojiIntoInput, quick: false, closeOnPick: true, allowGif: true, startTab: gifTabIndex() });
    });
}

// --- Ответы на сообщения ---

function messagePreviewText(m) {
    const t = String((m && m.text) || '').replace(/\s+/g, ' ').trim();
    if (t) return t.length > 120 ? t.slice(0, 120) + '…' : t;
    if (m && m.hasImage) return '📷 Фото';
    if (m && m.fileName) return `📎 ${m.fileName}`;
    return '';
}

function setReplyTarget(target) {
    replyTarget = target;
    const bar = document.getElementById('reply-bar');
    const textEl = document.getElementById('reply-bar-text');
    if (!bar || !textEl) return;
    textEl.textContent = '';
    if (!target) { bar.classList.remove('visible'); return; }
    const label = document.createElement('span');
    label.textContent = 'Ответ для ';
    const who = document.createElement('b');
    who.textContent = target.username;
    textEl.append(label, who, document.createTextNode(`: ${target.preview}`));
    bar.classList.add('visible');
    messageInput.focus();
}
function clearReply() { setReplyTarget(null); }

// Добавляет к исходящему сообщению id цитируемого и сбрасывает ответ.
function withReply(payload) {
    if (replyTarget && replyTarget.room === selectedRoom) payload.replyTo = replyTarget.id;
    clearReply();
    return payload;
}

document.getElementById('reply-bar-cancel')?.addEventListener('click', clearReply);
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && replyTarget && !mentionState.active) clearReply();
});

function jumpToMessage(id) {
    const part = messagesDiv.querySelector(`.msg-part[data-id="${CSS.escape(String(id))}"]`);
    if (!part) { showToast('Исходное сообщение далеко выше — в ленте его уже нет'); return; }
    chatScrollAnchor = null;
    part.scrollIntoView({ block: 'center', behavior: 'smooth' });
    part.classList.remove('msg-jump-flash');
    void part.offsetWidth; // перезапуск анимации
    part.classList.add('msg-jump-flash');
    setTimeout(() => part.classList.remove('msg-jump-flash'), 1700);
}

// --- Реакции ---
function normChatName(n) { return String(n || '').trim().toLowerCase(); }

function renderReactions(part, reactions) {
    const box = part.querySelector(':scope > .msg-reactions');
    if (!box) return;
    box.innerHTML = '';
    const me = normChatName(currentUser.username);
    Object.entries(reactions || {}).forEach(([emoji, users]) => {
        if (!Array.isArray(users) || !users.length) return;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'reaction-chip' + (users.some(u => normChatName(u) === me) ? ' mine' : '');
        chip.dataset.emoji = emoji;
        const shown = users.slice(0, 10).join(', ') + (users.length > 10 ? ` и ещё ${users.length - 10}` : '');
        chip.title = shown;
        const em = document.createElement('span');
        em.className = 'rc-emoji';
        em.textContent = emoji;
        const cnt = document.createElement('span');
        cnt.className = 'rc-count';
        cnt.textContent = String(users.length);
        chip.append(em, cnt);
        box.appendChild(chip);
    });
    if (part._msg) part._msg.reactions = reactions || {};
}

function toggleReaction(messageId, emoji) {
    if (messageId == null || !emoji) return;
    // Показываем реакцию сразу, не дожидаясь сервера; настоящее состояние придёт
    // событием 'message reactions' и перерисует её (или откатит, если сервер отказал).
    const part = messagesDiv.querySelector(`.msg-part[data-id="${CSS.escape(String(messageId))}"]`);
    if (part && part._msg) {
        const me = normChatName(currentUser.username);
        const next = {};
        Object.entries(part._msg.reactions || {}).forEach(([e, users]) => { next[e] = Array.isArray(users) ? users.slice() : []; });
        const users = next[emoji] || [];
        const has = users.some(u => normChatName(u) === me);
        next[emoji] = has ? users.filter(u => normChatName(u) !== me) : [...users, currentUser.username];
        if (!next[emoji].length) delete next[emoji];
        renderReactions(part, next);
    }
    socket.emit('toggle reaction', { id: messageId, emoji });
}

function updateCachedReactions(room, id, reactions) {
    const cached = chatHistoryCache.get(String(room || ''));
    if (!cached) return;
    const m = cached.messages.find(x => String(x.id) === String(id));
    if (m) m.reactions = reactions;
}

socket.on('message reactions', ({ id, room, reactions } = {}) => {
    if (id == null) return;
    const r = room || selectedRoom;
    updateCachedReactions(r, id, reactions || {});
    if (r !== selectedRoom) return;
    const part = messagesDiv.querySelector(`.msg-part[data-id="${CSS.escape(String(id))}"]`);
    if (part) renderReactions(part, reactions || {});
});

// --- Клики по сообщениям (одним обработчиком на всю ленту) ---
const HOVER_NONE = window.matchMedia ? window.matchMedia('(hover: none)') : { matches: false };
messagesDiv.addEventListener('click', (e) => {
    // Скачивание файла. В десктопном приложении (WebView2) ссылка с target=_blank и
    // скачивание «молча» не срабатывают — просим приложение открыть ссылку в браузере
    // по умолчанию, который и скачает файл (сервер отдаёт его под настоящим именем).
    const fileLink = e.target.closest('a.chat-file');
    if (fileLink && window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
        e.preventDefault();
        window.__TAURI__.core.invoke('open_download', { url: fileLink.href })
            .catch(err => { console.warn('[download]', err); showToast('Не удалось начать скачивание'); });
        return;
    }

    const part = e.target.closest('.msg-part');
    if (!part) return;

    const quote = e.target.closest('.msg-reply-quote');
    if (quote && !quote.classList.contains('rq-deleted')) {
        jumpToMessage(quote.dataset.replyId);
        return;
    }

    const chip = e.target.closest('.reaction-chip');
    if (chip) { toggleReaction(part.dataset.id, chip.dataset.emoji); return; }

    const chatImg = e.target.closest('img.chat-image');
    if (chatImg) { openImageLightbox(chatImg.currentSrc || chatImg.src); return; }

    const reactBtn = e.target.closest('.msg-act-react');
    if (reactBtn) {
        const id = part.dataset.id;
        openEmojiPicker({ anchor: reactBtn, quick: true, closeOnPick: true, onPick: (emoji) => toggleReaction(id, emoji) });
        return;
    }

    const replyBtn = e.target.closest('.msg-act-reply');
    if (replyBtn) {
        const m = part._msg;
        if (!m) return;
        setReplyTarget({ id: m.id, room: selectedRoom, username: m.username, preview: messagePreviewText(m) });
        return;
    }

    // На сенсорных экранах нет наведения — панель действий открывается касанием по сообщению.
    if (HOVER_NONE.matches && !e.target.closest('a, button, img')) {
        const wasOpen = part.classList.contains('actions-open');
        messagesDiv.querySelectorAll('.msg-part.actions-open').forEach(p => p.classList.remove('actions-open'));
        if (!wasOpen) part.classList.add('actions-open');
    }
});

// --- Файлы и фото: загрузка с прогрессом ---
const activeUploads = new Set(); // XMLHttpRequest текущих загрузок
let uploadCancelRequested = false;
const MAX_ATTACHMENTS_PER_MESSAGE = 10; // должно совпадать с MAX_ATTACHMENTS на сервере
const UPLOAD_PARALLEL = 3;               // сколько файлов грузим одновременно
const MAX_CLIENT_IMAGE_MB = 8;

function formatFileSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '';
    if (n < 1024) return `${n} Б`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} КБ`;
    return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

function setUploadStatus(name, pct) {
    const box = document.getElementById('upload-status');
    if (!box) return;
    if (name == null) { box.classList.remove('visible'); return; }
    box.classList.add('visible');
    document.getElementById('upload-status-name').textContent = name;
    document.getElementById('upload-status-fill').style.width = `${pct}%`;
    document.getElementById('upload-status-pct').textContent = `${Math.round(pct)}%`;
}

function postFormWithProgress(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        activeUploads.add(xhr);
        xhr.open('POST', url);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress((e.loaded / e.total) * 100); };
        xhr.onload = () => {
            activeUploads.delete(xhr);
            let data = {};
            try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
            if (xhr.status >= 200 && xhr.status < 300) resolve(data);
            else reject(new Error(data.error || `Ошибка загрузки (${xhr.status})`));
        };
        xhr.onerror = () => { activeUploads.delete(xhr); reject(new Error('Нет связи с сервером')); };
        xhr.onabort = () => { activeUploads.delete(xhr); reject(new Error('cancelled')); };
        xhr.send(formData);
    });
}

function isChatImageFile(file) {
    return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type);
}

function sendChatPayloadAndStick(payload) {
    const stick = chatPinnedToBottom || isChatNearBottom();
    socket.emit('chat message', withReply(payload));
    if (stick) {
        scrollChatToBottom();
        holdChatAnchor({ type: 'bottom' });
    }
}

function setAttachButtonsDisabled(disabled) {
    ['attach-file-btn'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = disabled; });
}

// Фото и любые файлы — одним потоком: выбранное (или перетащенное) грузится параллельно
// и уходит ОДНИМ сообщением со всеми вложениями.
let chatUploadBusy = false;
async function sendChatFiles(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length || messageInput.disabled) return;
    if (chatUploadBusy) { showToast('Подождите — предыдущие файлы ещё загружаются'); return; }

    const jobs = [];
    for (const file of files) {
        if (file.size === 0) { showToast(`«${file.name}» пустой`); continue; }
        if (file.size > MAX_CLIENT_FILE_MB * 1024 * 1024) {
            showToast(`«${file.name}» слишком большой (максимум ${MAX_CLIENT_FILE_MB} МБ)`);
            continue;
        }
        // Фото крупнее лимита для картинок отправляем как обычный файл, а не отбрасываем.
        const asImage = isChatImageFile(file) && file.size <= MAX_CLIENT_IMAGE_MB * 1024 * 1024;
        jobs.push({ file, asImage, loaded: 0, result: null });
    }
    if (jobs.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        showToast(`В одном сообщении не больше ${MAX_ATTACHMENTS_PER_MESSAGE} вложений — лишние пропущены`);
        jobs.length = MAX_ATTACHMENTS_PER_MESSAGE;
    }
    if (!jobs.length) return;

    chatUploadBusy = true;
    uploadCancelRequested = false;
    setAttachButtonsDisabled(true);

    const totalBytes = jobs.reduce((n, j) => n + j.file.size, 0);
    const label = jobs.length === 1 ? jobs[0].file.name : `Файлов: ${jobs.length}`;
    const refresh = () => {
        const loaded = jobs.reduce((n, j) => n + j.loaded, 0);
        setUploadStatus(label, totalBytes ? (loaded / totalBytes) * 100 : 0);
    };
    refresh();

    let next = 0;
    const worker = async () => {
        while (!uploadCancelRequested) {
            const job = jobs[next++];
            if (!job) return;
            const onP = (p) => { job.loaded = job.file.size * (p / 100); refresh(); };
            try {
                const formData = new FormData();
                if (job.asImage) {
                    formData.append('image', job.file);
                    const data = await postFormWithProgress('/upload', formData, onP);
                    job.result = { kind: 'image', url: data.url, name: job.file.name, size: job.file.size };
                } else {
                    formData.append('name', job.file.name); // до файла: имя в UTF-8 без «кракозябр»
                    formData.append('file', job.file);
                    const data = await postFormWithProgress('/upload-file', formData, onP);
                    job.result = { kind: 'file', url: data.url, name: data.name, size: data.size };
                }
                job.loaded = job.file.size;
                refresh();
            } catch (err) {
                if (err.message === 'cancelled') { uploadCancelRequested = true; return; }
                console.error('[Ошибка] Загрузка вложения:', err);
                showToast(`Не удалось загрузить «${job.file.name}»: ${err.message}`);
            }
        }
    };

    try {
        await Promise.all(Array.from({ length: Math.min(UPLOAD_PARALLEL, jobs.length) }, worker));
        if (!uploadCancelRequested) {
            const attachments = jobs.map(j => j.result).filter(Boolean);
            if (attachments.length) sendChatPayloadAndStick({ text: '', attachments });
        }
    } finally {
        activeUploads.clear();
        chatUploadBusy = false;
        setUploadStatus(null);
        setAttachButtonsDisabled(messageInput.disabled);
    }
}

document.getElementById('upload-status-cancel')?.addEventListener('click', () => {
    uploadCancelRequested = true;
    activeUploads.forEach(x => x.abort());
});

(function initChatAttachments() {
    const fileBtn = document.getElementById('attach-file-btn');
    const fileInput = document.getElementById('attach-file-input');

    if (fileBtn && fileInput) {
        fileBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => { const f = Array.from(fileInput.files); fileInput.value = ''; sendChatFiles(f); });
    }

    // Вставка из буфера (скриншот, скопированный файл) — только если в буфере нет текста.
    messageInput.addEventListener('paste', (e) => {
        const cd = e.clipboardData;
        if (!cd || !cd.files || !cd.files.length) return;
        if (cd.getData('text/plain')) return;
        e.preventDefault();
        sendChatFiles(Array.from(cd.files));
    });

    // Перетаскивание: файлы можно бросить в ЛЮБОЕ место окна — они уйдут в открытый чат.
    // Обработчики на window ещё и не дают браузеру открыть брошенный файл вместо приложения.
    const overlay = document.createElement('div');
    overlay.id = 'drop-overlay';
    overlay.innerHTML = '<div class="drop-card"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg><span>Отпустите, чтобы отправить в чат</span></div>';
    document.body.appendChild(overlay);

    const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
    const modalOpen = () => Array.from(document.querySelectorAll('.modal-overlay')).some(m => getComputedStyle(m).display !== 'none');
    let depth = 0;
    let dropAllowed = false;
    const hideOverlay = () => { depth = 0; overlay.classList.remove('visible'); };

    window.addEventListener('dragenter', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        if (depth === 0) dropAllowed = !messageInput.disabled && !modalOpen();
        depth++;
        if (dropAllowed) overlay.classList.add('visible');
    });
    window.addEventListener('dragover', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = dropAllowed ? 'copy' : 'none';
    });
    window.addEventListener('dragleave', (e) => {
        if (!hasFiles(e)) return;
        depth = Math.max(0, depth - 1);
        if (!depth) overlay.classList.remove('visible');
    });
    window.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        const dropped = Array.from(e.dataTransfer.files || []);
        hideOverlay();
        if (modalOpen()) return;
        if (messageInput.disabled) { showToast('Сначала откройте чат сервера, потом перетащите файлы'); return; }
        sendChatFiles(dropped);
    });
    // Если перетаскивание оборвали (Esc, ушли за окно) — убираем подсказку.
    window.addEventListener('dragend', hideOverlay);
    window.addEventListener('blur', hideOverlay);
})();

// Ссылка на скачивание идёт через наш сервер (/download) — так файл сохраняется под своим именем.
function fileDownloadHref(url, name) {
    return `/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name || 'file')}`;
}

const FILE_ICON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
const DOWNLOAD_ICON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
const REPLY_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>';
const REACT_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>';
const TRASH_ICON_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';

// Сообщение из одних смайликов (до 6 штук) показываем крупно.
const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u200D\uFE0F\u20E3\u{1F3FB}-\u{1F3FF}]|\s)+$/u;
function isEmojiOnlyText(text) {
    const t = String(text || '').trim();
    if (!t || t.length > 40 || !EMOJI_ONLY_RE.test(t)) return false;
    const count = (t.match(/\p{Extended_Pictographic}|\p{Regional_Indicator}{2}/gu) || []).length;
    return count >= 1 && count <= 6;
}

function buildReplyQuoteHtml(reply, replyTo) {
    if (!reply && replyTo == null) return '';
    if (!reply || reply.deleted) {
        return '<div class="msg-reply-quote rq-deleted"><span class="rq-text">Исходное сообщение удалено</span></div>';
    }
    const preview = messagePreviewText({ text: reply.text, hasImage: reply.has_image, fileName: reply.file_name });
    return `<div class="msg-reply-quote" data-reply-id="${Number(reply.id)}" title="Перейти к сообщению">` +
        `<span class="rq-author" style="color:${getUserColor(reply.username)}">${escapeHtml(reply.username || 'Участник')}</span>` +
        `<span class="rq-text">${escapeHtml(preview)}</span></div>`;
}

function buildFileCardHtml(url, name, size) {
    if (!url) return '';
    const sizeText = formatFileSize(size);
    return `<a class="chat-file" href="${fileDownloadHref(url, name)}" target="_blank" rel="noopener noreferrer" title="Скачать ${escapeHtml(name || 'файл')}">` +
        `<span class="cf-icon">${FILE_ICON_SVG}</span>` +
        `<span class="cf-meta"><span class="cf-name">${escapeHtml(name || 'Файл')}</span>${sizeText ? `<span class="cf-size">${sizeText}</span>` : ''}</span>` +
        `<span class="cf-dl">${DOWNLOAD_ICON_SVG}</span></a>`;
}

// Список вложений сообщения: новый формат (attachments) или старые поля image_url / file_*.
function normalizeAttachments({ image_url, file_url, file_name, file_size, attachments }) {
    if (Array.isArray(attachments) && attachments.length) return attachments.filter(a => a && a.url);
    const list = [];
    if (image_url) list.push({ kind: 'image', url: image_url });
    if (file_url) list.push({ kind: 'file', url: file_url, name: file_name, size: file_size });
    return list;
}

// Фото — сверху (одно крупно или сеткой), файлы — карточками ниже. Клик по фото открывает
// просмотр (обработчик на всей ленте, см. messagesDiv 'click').
function buildAttachmentsHtml(list) {
    const images = list.filter(a => a.kind === 'image');
    const files = list.filter(a => a.kind !== 'image');
    const img = (a) => `<img src="${escapeHtml(a.url)}" class="chat-image" alt="Изображение" loading="lazy" decoding="async">`;
    let html = '';
    if (images.length === 1) {
        html += `<div class="chat-image-wrap">${img(images[0])}</div>`;
    } else if (images.length > 1) {
        html += `<div class="chat-gallery gallery-${Math.min(images.length, 4)}">` +
            images.map(a => `<div class="chat-gallery-cell">${img(a)}</div>`).join('') + '</div>';
    }
    files.forEach(a => { html += buildFileCardHtml(a.url, a.name, a.size); });
    return html;
}

function buildMessageActionsHtml({ id, canInteract, isMine }) {
    let html = '<div class="msg-actions">';
    if (canInteract) {
        html += `<button type="button" class="msg-act-react" title="Добавить реакцию">${REACT_ICON_SVG}</button>`;
        html += `<button type="button" class="msg-act-reply" title="Ответить">${REPLY_ICON_SVG}</button>`;
    }
    if (isMine) {
        html += `<button type="button" class="msg-delete-btn" title="Удалить сообщение" onclick="deleteMyMessage(${JSON.stringify(id)})">${TRASH_ICON_SVG}</button>`;
    }
    return html + '</div>';
}

// Аватарка автора сообщения (как .msg-avatar в оверлее): круг 30 px слева от блока сообщений.
// Запасной вариант — тот же идентикон, что и в автодополнении упоминаний; если картинка не
// загрузилась (нет сети) — буква ника на цветном фоне. Элемент вставляется только в начало
// блока (.chat-message), вне .msg-part, поэтому удаление/объединение сообщений не затрагивает.
function buildChatAvatarEl(name, avatarUrl) {
    const wrap = document.createElement('span');
    wrap.className = 'msg-avatar';
    wrap.setAttribute('aria-hidden', 'true');
    const initial = (String(name || '?').trim().charAt(0) || '?').toUpperCase();
    const showInitial = () => {
        wrap.textContent = initial;
        wrap.style.background = getUserColor(name);
    };
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.draggable = false;
    img.src = avatarUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(name || '')}`;
    img.addEventListener('error', () => { img.remove(); showInitial(); }, { once: true });
    wrap.appendChild(img);
    return wrap;
}

function renderChatMessage({ id, username, user, avatar, text, image_url, file_url, file_name, file_size, attachments, reply, reply_to, reactions, created_at, whisper_to, cid, pending }) {
    const name = username || user || 'Участник';
    // Прилипать к низу нужно, только если человек и так смотрит на конец чата (или это
    // его собственное сообщение). Измеряем ДО добавления сообщения — после него
    // scrollHeight уже вырастет. Раньше чат прыгал вниз при каждом новом сообщении,
    // даже если человек читал историю выше.
    // Своё сообщение тоже НЕ тянет вниз, если человек в этот момент читает историю выше.
    const wasAtBottom = chatPinnedToBottom || isChatNearBottom();
    // created_at приходит с сервера как Date.now() (мс) — если вдруг отсутствует или же
    // после парсинга получилась невалидная дата (например, у старых записей в БД, ещё
    // до фикса с BIGINT-как-строкой), подстраховываемся текущим временем, чтобы не
    // сломать рендер и не показать "NaN:NaN".
    let date = created_at ? new Date(created_at) : new Date();
    if (isNaN(date.getTime())) date = new Date();

    maybeInsertDateSeparator(date);

    // Сравниваем без учёта регистра/пробелов, как и в остальных местах, где мы
    // определяем "это моё сообщение" — иначе из-за малейшего расхождения регистра
    // кнопка удаления могла бы не появиться у собственного же сообщения.
    const normNameForDelete = (n) => String(n || '').trim().toLowerCase();
    const isMine = (id != null || !!pending) && !!normNameForDelete(currentUser.username) && normNameForDelete(name) === normNameForDelete(currentUser.username);
    const isWhisper = Array.isArray(whisper_to) && whisper_to.length > 0;

    // Объединение сообщений: подряд идущие сообщения одного автора в пределах одной
    // минуты (11:11, 11:11, 11:11) складываются в один блок — ник и время показываются
    // один раз. Как только минута сменилась (11:12) или написал кто-то другой —
    // начинается новый блок со своим ником и временем.
    const minuteKey = `${dateKeyOf(date)}-${date.getHours()}-${date.getMinutes()}`;
    const whisperKey = isWhisper ? whisper_to.map(n => String(n).toLowerCase()).sort().join(',') : '';
    const groupKey = `${normNameForDelete(name)}|${minuteKey}|${whisperKey}`;
    const lastEl = messagesDiv.lastElementChild;
    const joinGroup = !!(lastEl && lastEl.classList.contains('chat-message') && lastEl.dataset.groupKey === groupKey);

    // Каждое сообщение — отдельная часть (.msg-part) со своим id: удаляется по отдельности.
    const part = document.createElement('div');
    part.className = 'msg-part';
    if (id != null) part.dataset.id = id;

    // Ответ: цитата над сообщением (в объединённом блоке — у каждого сообщения своя).
    let html = buildReplyQuoteHtml(reply, reply_to);
    if (!joinGroup) {
        html += `<strong class="msg-sender" style="color:${getUserColor(name)}">${escapeHtml(name)}:</strong> `;
        if (isWhisper) {
            const meLowerW = (currentUser.username || '').toLowerCase();
            const iAmSender = name.toLowerCase() === meLowerW;
            const others = whisper_to.filter(n => String(n).toLowerCase() !== name.toLowerCase());
            const label = iAmSender
                ? `шёпот → ${others.map(escapeHtml).join(', ')}`
                : 'шепчет вам';
            html += `<span class="whisper-tag" title="Это сообщение видят только отмеченные участники">${label}</span> `;
        }
    }
    if (text) html += `<span class="msg-text${isEmojiOnlyText(text) ? ' jumbo' : ''}">${renderMessageTextWithMentions(text, getMentionCandidates(), currentUser.username)}</span>`;
    // loading="lazy" + decoding="async" (см. buildAttachmentsHtml) — картинка декодируется
    // только когда реально прокручена в область видимости: в активном чате с историей фото
    // это заметно снижает нагрузку на GPU.
    const atts = normalizeAttachments({ image_url, file_url, file_name, file_size, attachments });
    html += buildAttachmentsHtml(atts);
    // Реакции — прямо под сообщением, а время уже под ними (если реакций нет — время
    // остаётся в строке сообщения, см. CSS у .msg-reactions). На шёпот реагировать и
    // отвечать нельзя — сервер такие запросы всё равно отклонит.
    const canInteract = id != null && !isWhisper;
    html += '<div class="msg-reactions"></div>';
    // Время — только у первого сообщения блока (у остальных та же минута).
    if (!joinGroup) html += `<span class="msg-time">${formatMessageTime(date)}</span>`;
    if (id != null) html += buildMessageActionsHtml({ id, canInteract, isMine });
    part.innerHTML = html;
    const firstFileAtt = atts.find(a => a.kind !== 'image');
    part._msg = { id, username: name, text: text || '', hasImage: atts.some(a => a.kind === 'image'), fileName: firstFileAtt ? (firstFileAtt.name || null) : null, reactions: reactions || {} };
    // Своё сообщение, показанное сразу, не дожидаясь сервера: см. renderPendingMessage.
    if (pending) {
        part.classList.add('pending');
        if (cid) part.dataset.cid = cid;
    }
    renderReactions(part, reactions || {});

    let msg;
    if (joinGroup) {
        msg = lastEl;
        part.classList.add('fade-in');
        msg.appendChild(part);
    } else {
        msg = document.createElement('div');
        msg.className = 'chat-message fade-in';
        msg.dataset.groupKey = groupKey;
        if (isMine) msg.classList.add('own-message');
        if (isWhisper) msg.classList.add('chat-whisper');
        msg.appendChild(buildChatAvatarEl(name, avatar));
        msg.appendChild(part);
        messagesDiv.appendChild(msg);
    }
    // Если окно уже неактивно, не запускаем GIF, добавленный в фоне.
    // ВАЖНО: раньше здесь стояли имена chatGifsPaused / isChatGif, которых нигде нет —
    // на КАЖДОМ сообщении бросался ReferenceError. Он обрывал и renderChatMessage (после
    // него не срабатывали ни прокрутка вниз, ни trimRenderedMessages), и обработчик
    // 'chat message' целиком, поэтому в открытом чате не играл звук нового сообщения.
    // Настоящее состояние паузы GIF — gifsPaused (см. блок GIF ниже по файлу).
    if (gifsPaused) part.querySelectorAll('img').forEach(pauseGifElement);
    // При пакетной отрисовке истории (chatBulkRender) позицию выставляет вызывающий код —
    // либо вниз, либо на последнее прочитанное сообщение.
    if (!chatBulkRender && wasAtBottom) {
        scrollChatToBottom();
        holdChatAnchor({ type: 'bottom' });
    }
    trimRenderedMessages();
}

// Удаление собственного сообщения: сервер сам проверяет владение по нику (ID сокета
// не хватило бы — после перезахода/другого устройства id меняется), поэтому здесь
// достаточно отправить id и дождаться подтверждающего события 'delete message'.
window.deleteMyMessage = function(id) {
    if (id == null) return;
    if (!confirm('Удалить это сообщение?')) return;
    socket.emit('delete message', { id, room: selectedRoom });
};

// Удаляет одно сообщение из объединённого блока. Если это последнее сообщение блока —
// убираем весь блок. Если удалили первое, а другие остались — ник (и метку шёпота) и
// время переносим на следующее сообщение, чтобы блок не остался без автора и времени.
function removeMessagePart(part) {
    const group = part.closest('.chat-message');
    if (!group) { part.remove(); return; }
    const parts = group.querySelectorAll(':scope > .msg-part');
    if (parts.length <= 1) { group.remove(); return; }
    if (parts[0] === part) {
        const next = parts[1];
        const frag = document.createDocumentFragment();
        part.querySelectorAll(':scope > .msg-sender, :scope > .whisper-tag').forEach(n => {
            frag.appendChild(n);
            frag.appendChild(document.createTextNode(' '));
        });
        // Ник — после цитаты (если у следующего сообщения она есть), время — после реакций.
        const nextQuote = next.querySelector(':scope > .msg-reply-quote');
        next.insertBefore(frag, nextQuote ? nextQuote.nextSibling : next.firstChild);
        const time = part.querySelector(':scope > .msg-time');
        if (time) next.insertBefore(time, next.querySelector(':scope > .msg-actions'));
    }
    part.remove();
}

// ---------- Мгновенный показ своих сообщений ----------
// Своё текстовое сообщение рисуем сразу при нажатии Enter (чуть бледнее), а когда сервер
// пришлёт то же сообщение с тем же cid — просто «подтверждаем» его на месте: ставим
// настоящий id и панель действий. Без этого автор ждал полный круг до сервера и обратно.
let clientMsgSeq = 0;
function makeClientMessageId() {
    clientMsgSeq++;
    return `c${Date.now().toString(36)}${clientMsgSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function renderPendingMessage({ cid, text, replyTarget: rt }) {
    renderChatMessage({
        id: null,
        username: currentUser.username,
        avatar: currentUser.avatar,
        text,
        created_at: Date.now(),
        reactions: {},
        reply_to: rt ? rt.id : null,
        reply: rt ? { id: rt.id, deleted: false, username: rt.username, text: rt.preview, has_image: false, file_name: null } : null,
        cid,
        pending: true
    });
    // Если сервер так и не ответил (сообщение отклонено) — не оставляем «призрак» в ленте.
    setTimeout(() => {
        const part = messagesDiv.querySelector(`.msg-part.pending[data-cid="${CSS.escape(cid)}"]`);
        if (!part) return;
        removeMessagePart(part);
        showToast('Сообщение не отправлено — проверьте соединение');
    }, 15000);
}

function confirmPendingMessage(part, payload) {
    part.classList.remove('pending');
    delete part.dataset.cid;
    if (payload.id != null) part.dataset.id = payload.id;
    if (part._msg) part._msg.id = payload.id;
    if (payload.id != null && !part.querySelector(':scope > .msg-actions')) {
        part.insertAdjacentHTML('beforeend', buildMessageActionsHtml({ id: payload.id, canInteract: true, isMine: true }));
    }
}

socket.on('delete message', ({ id, room }) => {
    if (room && room !== selectedRoom) return;
    if (id == null) return;
    removeMessageFromChatCache(room || selectedRoom, id);
    const el = messagesDiv.querySelector(`.msg-part[data-id="${CSS.escape(String(id))}"]`);
    if (el) removeMessagePart(el);
});

// ---------- Позиция прокрутки чата ----------
// chatBulkRender — идёт пакетная отрисовка истории: не скроллим на каждом сообщении.
// Якорь позиции: картинки грузятся уже после отрисовки и меняют высоту чата, из-за чего
// позиция «уезжала». Пока человек сам не начал скроллить, при каждой загрузке
// картинки возвращаем чат на нужное место (но не дольше нескольких секунд).
const CHAT_ANCHOR_HOLD_MS = 3000;

function isChatNearBottom(threshold = 120) {
    return messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight <= threshold;
}
// Флаг обновляем только на реальной прокрутке: когда картинка догрузилась и чат «вырос»,
// scroll не срабатывает — и человек, который был внизу, по-прежнему считается «внизу».
messagesDiv.addEventListener('scroll', () => { chatPinnedToBottom = isChatNearBottom(); }, { passive: true });
function scrollChatToBottom() {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    chatPinnedToBottom = true;
}
// Ставит чат так, чтобы элемент (разделитель «Непрочитанные») был примерно на трети
// высоты: сверху виден кусочек уже прочитанного, ниже — новое.
function scrollChatToElement(el) {
    if (!el || !el.isConnected) return;
    const top = el.getBoundingClientRect().top - messagesDiv.getBoundingClientRect().top + messagesDiv.scrollTop;
    messagesDiv.scrollTop = Math.max(0, top - Math.round(messagesDiv.clientHeight * 0.3));
    chatPinnedToBottom = isChatNearBottom();
}
function holdChatAnchor(anchor) {
    chatScrollAnchor = Object.assign({ until: Date.now() + CHAT_ANCHOR_HOLD_MS }, anchor);
    // Сразу после отрисовки браузер ещё дорассчитывает высоты (шрифты, переносы,
    // картинки) — повторяем прокрутку на следующих кадрах, пока человек сам не тронул чат.
    requestAnimationFrame(() => {
        applyChatAnchor();
        requestAnimationFrame(applyChatAnchor);
    });
}
function applyChatAnchor() {
    const a = chatScrollAnchor;
    if (!a || Date.now() > a.until) { chatScrollAnchor = null; return; }
    if (a.type === 'bottom') scrollChatToBottom();
    else if (a.type === 'element') scrollChatToElement(a.el);
    else if (a.type === 'read') scrollChatToReadMessage(a.el);
}

// ---------- Последнее прочитанное сообщение ----------
// Ставит чат так, чтобы сообщение el было у нижнего края — ровно как человек его оставил.
function scrollChatToReadMessage(el) {
    if (!el || !el.isConnected) return;
    const boxTop = messagesDiv.getBoundingClientRect().top;
    const elBottom = el.getBoundingClientRect().bottom - boxTop + messagesDiv.scrollTop;
    messagesDiv.scrollTop = Math.max(0, elBottom - messagesDiv.clientHeight + 12);
    chatPinnedToBottom = isChatNearBottom();
}

// Что человек успел прочитать: у конца чата — «всё», иначе — самое нижнее сообщение,
// которое уже показалось на экране.
function computeChatReadPosition() {
    const parts = messagesDiv.querySelectorAll('.msg-part[data-id]');
    if (!parts.length) return null;
    if (chatPinnedToBottom || isChatNearBottom()) {
        return { id: String(parts[parts.length - 1].dataset.id), atBottom: true };
    }
    const viewBottom = messagesDiv.getBoundingClientRect().bottom;
    let found = null;
    for (const part of parts) {
        if (part.getBoundingClientRect().top < viewBottom - 8) found = part;
        else break;
    }
    return found ? { id: String(found.dataset.id), atBottom: false } : null;
}

// Запоминаем позицию, пока в messagesDiv ещё чат ЭТОЙ комнаты (до переключения/закрытия).
function rememberChatReadPosition(room) {
    if (!room || chatRenderedRoom !== room) return;
    const pos = computeChatReadPosition();
    if (!pos) return;
    delete chatReadPositionByRoom[room];
    chatReadPositionByRoom[room] = pos;
    const keys = Object.keys(chatReadPositionByRoom);
    if (keys.length > CHAT_READ_POS_MAX_ROOMS) {
        keys.slice(0, keys.length - CHAT_READ_POS_MAX_ROOMS).forEach(k => delete chatReadPositionByRoom[k]);
    }
    try { localStorage.setItem(CHAT_READ_POS_KEY, JSON.stringify(chatReadPositionByRoom)); } catch (e) { /* ignore */ }
}

// Возвращает чат на сохранённую позицию. false — сообщения уже нет в ленте (осталось внизу).
function restoreChatPosition(pos) {
    if (!pos) return false;
    if (pos.atBottom) {
        scrollChatToBottom();
        holdChatAnchor({ type: 'bottom' });
        return true;
    }
    const el = messagesDiv.querySelector(`.msg-part[data-id="${CSS.escape(String(pos.id))}"]`);
    if (!el) return false;
    scrollChatToReadMessage(el);
    holdChatAnchor({ type: 'read', el });
    return true;
}

window.addEventListener('pagehide', () => rememberChatReadPosition(chatRenderedRoom));
document.addEventListener('visibilitychange', () => {
    if (document.hidden) rememberChatReadPosition(chatRenderedRoom);
});
messagesDiv.addEventListener('load', applyChatAnchor, true); // load у <img> не всплывает — ловим в capture
['wheel', 'touchstart', 'mousedown', 'keydown'].forEach(ev =>
    messagesDiv.addEventListener(ev, () => { chatScrollAnchor = null; }, { passive: true }));

// Отрисовывает пачку сообщений (история / кэш). Каждое — в своём try/catch, см.
// комментарий у socket.on('chat history'). По умолчанию после пачки — прокрутка вниз;
// если есть непрочитанные, markUnreadMessagesInChat потом переставит чат на них.
function renderChatBatch(list, errLabel) {
    chatBulkRender = true;
    try {
        (list || []).forEach((msg) => {
            try {
                renderChatMessage(msg);
            } catch (err) {
                console.error(errLabel, err, msg);
            }
        });
    } finally {
        chatBulkRender = false;
    }
    scrollChatToBottom();
    holdChatAnchor({ type: 'bottom' });
}

function markUnreadMessagesInChat(room) {
    const ids = getUnreadIds(room);
    const snapshot = unreadSnapshotByRoom.get(String(room || ''));
    if (snapshot) snapshot.ids.forEach(id => ids.add(id));
    if (!ids.size) return;
    // Сколько уже прошло с момента первой отрисовки (если чат перерисовывается
    // свежей историей сразу после показа из кэша) — вспышка должна быть одна.
    const elapsed = snapshot ? Date.now() - snapshot.at : 0;
    const flash = elapsed < UNREAD_FLASH_MS;
    const parts = Array.from(messagesDiv.querySelectorAll('.msg-part[data-id]'));
    let firstUnread = null;
    parts.forEach(part => {
        if (ids.has(String(part.dataset.id))) {
            if (!firstUnread) firstUnread = part;
            if (!flash) return; // вспышка уже отыграла — сообщение выглядит как обычное
            part.classList.add('unread-message');
            // Отрицательная задержка «перематывает» анимацию на уже прошедшее время.
            if (elapsed > 0) part.style.animationDelay = `-${elapsed}ms`;
            // Убираем класс после окончания, чтобы не оставлять лишнего в DOM.
            setTimeout(() => part.classList.remove('unread-message'), UNREAD_FLASH_MS - elapsed + 50);
        }
    });
    if (firstUnread && !messagesDiv.querySelector('.unread-divider')) {
        const divider = document.createElement('div');
        divider.className = 'unread-divider';
        divider.textContent = 'Непрочитанные';
        firstUnread.parentElement?.before(divider);
    }
    // Заходим в канал — показываем место, где закончилось прочитанное, а не конец чата:
    // разделитель «Непрочитанные» встаёт примерно на трети высоты, а прямо над ним
    // виден последний прочитанный кусок. Если над разделителем читать нечего (непрочитано
    // всё, что есть в ленте) — прыгать некуда, остаёмся внизу.
    const marker = messagesDiv.querySelector('.unread-divider');
    if (firstUnread && marker) {
        const firstMsg = messagesDiv.querySelector('.chat-message');
        const hasReadAbove = !!firstMsg && !!(firstMsg.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (hasReadAbove) {
            scrollChatToElement(marker);
            holdChatAnchor({ type: 'element', el: marker });
        } else {
            scrollChatToBottom();
            holdChatAnchor({ type: 'bottom' });
        }
    }
}

socket.on('chat history', (data) => {
    // Пришла история чата другой комнаты, чем та, что сейчас открыта (например,
    // ответ на уже неактуальный запрос) — игнорируем, чтобы не подмешать чужой чат.
    const room = data && data.room;
    const history = (data && data.messages) || [];
    if (room && room !== selectedRoom) return;

    const targetRoom = room || selectedRoom;
    if (replyTarget && replyTarget.room !== targetRoom) clearReply();
    // Если этот же канал уже показан (свежая история пришла после кэша или после
    // переподключения) — запоминаем, где человек сейчас, и возвращаем его туда же,
    // а не бросаем в конец чата.
    const liveView = chatRenderedRoom === targetRoom ? computeChatReadPosition() : null;

    // Лента уже показывает ровно эти же сообщения (из кэша) — не перерисовываем её заново:
    // полная перерисовка при каждом переключении канала — главный источник лишней нагрузки.
    const prevCached = chatHistoryCache.get(String(targetRoom || ''));
    if (chatRenderedRoom === targetRoom && prevCached &&
        chatHistorySignature(prevCached.messages) === chatHistorySignature(history)) {
        setCachedChatHistory(targetRoom, history);
        unreadSnapshotByRoom.delete(String(targetRoom || ''));
        markRoomRead(targetRoom);
        return;
    }

    setCachedChatHistory(room || selectedRoom, history);
    clearChatMessages();
    lastMessageDateKey = null; // заново расставляем разделители дат для свежезагруженной истории
    // Каждое сообщение рендерим в своём try/catch: раньше одно "плохое" сообщение
    // (например, повреждённые данные шёпота или неожиданный формат строки из БД)
    // бросало исключение прямо внутри forEach — а forEach на исключении молча
    // останавливается и больше не вызывает колбэк для оставшихся элементов.
    // Из-за этого при повторном заходе в канал (когда история приходит не из кэша,
    // а заново с сервера) в чате оставалось только первое сообщение, всё
    // остальное просто не успевало отрисоваться, и код ниже (снятие пометки
    // непрочитанного) тоже не выполнялся. Изоляция ошибки на уровне одного
    // сообщения гарантирует, что вся остальная история и кружок непрочитанных
    // отрисуются, даже если какое-то одно сообщение не смогло отрендериться.
    renderChatBatch(history, '❌ Не удалось отрисовать сообщение истории:');
    chatRenderedRoom = targetRoom;
    markUnreadMessagesInChat(targetRoom);
    unreadSnapshotByRoom.delete(String(targetRoom || ''));
    markRoomRead(targetRoom);
    if (liveView) {
        restoreChatPosition(liveView);
    } else if (!messagesDiv.querySelector('.unread-divider')) {
        restoreChatPosition(chatReadPositionByRoom[targetRoom]);
    }
});

// Решает, какой звук/тост показать для чужого сообщения. Работает и для открытого
// канала, и для остальных серверов пользователя (там сообщение только копит кружок
// непрочитанных и играет звук, но в ленту не рендерится).
function notifyIncomingMessage(payload, room, senderName) {
    const isCurrent = room === selectedRoom;
    const code = customCodeFromRoomName(room);
    const cachedMembers = (code && mentionMembersCache[code]) || [];
    // Для неоткрытого сервера список участников мог ещё не загружаться — добавляем
    // самих себя, иначе @упоминание не распознается и прозвучит обычный звук.
    const candidates = isCurrent
        ? getMentionCandidates()
        : [...cachedMembers, { username: currentUser.username }];
    const mentions = findMentionMatches(payload.text || '', candidates);
    const meLower = (currentUser.username || '').toLowerCase();
    const iAmMentioned = !!meLower && mentions.some(m => m.username.toLowerCase() === meLower);
    const isWhisper = Array.isArray(payload.whisper_to) && payload.whisper_to.length > 0;
    // "f@" отмечает всех, но не в шёпоте (шёпот видят только его адресаты)
    const everyoneMentioned = !isWhisper && findEveryoneMatches(payload.text || '').length > 0;

    // В тосте про чужой сервер добавляем его название, иначе непонятно, откуда сообщение.
    let where = '';
    if (!isCurrent) {
        const btn = document.querySelector(`[data-room="${CSS.escape(String(room))}"]`);
        const name = btn?.getAttribute('data-display-name');
        if (name) where = ` (${name})`;
    }

    if (isWhisper) {
        playMentionSound(room);
        showToast(`${senderName} прошептал(а) вам${where}`);
    } else if (iAmMentioned) {
        playMentionSound(room);
        showToast(`${senderName} упомянул(а) вас в чате${where}`);
    } else if (everyoneMentioned) {
        playMentionSound(room);
        showToast(`${senderName} отметил(а) всех участников${where}`);
    } else {
        playMessageSound(room);
    }

    // Оверлей поверх игр: показываем сообщение на несколько секунд (если включено в настройках).
    try {
        if (typeof window.muteOverlayMessage === 'function') {
            const kind = isWhisper ? 'dm' : ((iAmMentioned || everyoneMentioned) ? 'mention' : 'msg');
            window.muteOverlayMessage(payload, kind, senderName);
        }
    } catch (e) { /* оверлей не должен ломать уведомления */ }
}

socket.on('chat message', (payload) => {
    const room = payload.room || selectedRoom;
    const senderName = payload.username || payload.user;
    const normName = (n) => String(n || '').trim().toLowerCase();
    const isOwnMessage = !!normName(currentUser.username) && normName(senderName) === normName(currentUser.username);

    // Сообщение другого сервера: не рендерим в ленту, но копим кружок непрочитанных
    // и проигрываем звук (сервер присылает такие сообщения всем участникам сервера,
    // даже если они сейчас смотрят другой канал или сидят в войсе другого сервера).
    if (room !== selectedRoom) {
        if (isOwnMessage) return;
        appendMessageToChatCache(room, payload);
        addUnreadMessage(room, payload);
        notifyIncomingMessage(payload, room, senderName);
        return;
    }

    // Лента очищена ради памяти (вкладка неактивна): сообщение не рисуем, оно придёт вместе с историей
    // при возврате; но непрочитанное и звук учитываем, как для любого неоткрытого канала.
    if (chatMemoryReleased) {
        if (isOwnMessage) return;
        addUnreadMessage(room, payload);
        notifyIncomingMessage(payload, room, senderName);
        return;
    }

    // Это эхо нашего же сообщения, уже показанного сразу? Тогда просто подтверждаем его.
    if (isOwnMessage && payload.cid) {
        const pend = messagesDiv.querySelector(`.msg-part.pending[data-cid="${CSS.escape(String(payload.cid))}"]`);
        if (pend) {
            appendMessageToChatCache(room, payload);
            confirmPendingMessage(pend, payload);
            return;
        }
    }

    appendMessageToChatCache(room, payload);
    try {
        renderChatMessage(payload);
    } catch (err) {
        // Сбой отрисовки одного сообщения не должен отключать звук уведомления.
        console.error('❌ Не удалось отрисовать новое сообщение:', err, payload);
    }

    // Звук — только для чужих сообщений, свои же мы и так видим, что отправили.
    if (!isOwnMessage) notifyIncomingMessage(payload, room, senderName);
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
    autosizeMessageInput();
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

// Поле ввода — textarea: растёт по мере набора, Enter отправляет, Shift+Enter — новая строка.
function autosizeMessageInput() {
    messageInput.style.height = 'auto';
    const borders = messageInput.offsetHeight - messageInput.clientHeight;
    messageInput.style.height = `${messageInput.scrollHeight + borders}px`;
}
messageInput.addEventListener('input', autosizeMessageInput);
window.addEventListener('resize', autosizeMessageInput);

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

    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) e.preventDefault(); // не вставлять перенос строки при отправке
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && messageInput.value.trim() && !messageInput.disabled) {
        // Позицию меряем ДО отправки: вниз прокручиваем, только если человек и так
        // находится у конца чата. Если он читает историю выше — не трогаем прокрутку.
        const stickToBottom = chatPinnedToBottom || isChatNearBottom();
        const text = messageInput.value.trim();
        const cid = makeClientMessageId();
        const rt = (replyTarget && replyTarget.room === selectedRoom) ? replyTarget : null; // withReply его сбросит
        socket.emit('chat message', withReply({ text, cid }));
        // Шёпот (wh@) сервер может отклонить — его мгновенно не рисуем, ждём ответ сервера.
        if (!/wh@/i.test(text)) {
            try { renderPendingMessage({ cid, text, replyTarget: rt }); }
            catch (err) { console.error('❌ Не удалось показать сообщение сразу:', err); }
        }
        messageInput.value = '';
        autosizeMessageInput();
        closeMentionAutocomplete();
        if (stickToBottom) {
            scrollChatToBottom();
            holdChatAnchor({ type: 'bottom' });
        }
    }
});
// Раньше здесь был обработчик 'input', который прокручивал чат вниз уже при первом
// набранном символе. Теперь набор текста прокрутку не меняет — только отправка (см. выше).

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
    saveLastRoom(null);
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
        // Автовход: перед запуском продлеваем токен. Если сервер его больше не признаёт (например,
        // истёк срок или аккаунт удалён), честно показываем экран входа с ником, а не делаем вид,
        // что вы в аккаунте, при том что часть настроек без токена не работает.
        if (currentUser.token) {
            const refreshed = await refreshAuthToken();
            if (refreshed === 'invalid') {
                currentUser.token = null;
                clearProfileStorage();
                setAuthMode('login');
                showAuthError('Сессия истекла — войдите заново.');
                passwordInput.focus();
                return;
            }
        }
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
            const res = await authFetch('/auth/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
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

// Пока нет ни демонстраций, ни видео участников — всё место справа отдаём чату.
(function syncVideoArea() {
    const mc = document.querySelector('.main-content');
    if (!mc || !remoteVideos) return;
    const update = () => mc.classList.toggle('has-videos', remoteVideos.children.length > 0);
    new MutationObserver(update).observe(remoteVideos, { childList: true });
    update();
})();

makeColumnResizable(
    document.getElementById('chat-resizer'),
    document.getElementById('chat-panel'),
    { min: 260, max: 640, storageKey: 'mute:chatWidth', invert: true }
);


// ---------- Оверлей поверх игр (только десктоп) ----------
// Отдельное прозрачное окно (см. overlay.html и lib.rs). Здесь мы только собираем состояние —
// кто в звонке, кто говорит, что играет — и шлём его окну оверлея событием.
document.addEventListener('DOMContentLoaded', () => {
    const t = window.__TAURI__;
    if (!t || !t.core || !t.event) return;
    const check = document.getElementById('overlay-enable-check');
    const editBtn = document.getElementById('overlay-edit-btn');
    const KEY = 'mute_overlay_enabled';
    const GAME_KEY = 'mute_overlay_game_only';
    const gameCheck = document.getElementById('overlay-game-only-check');
    let gameOnly = true;
    try { gameOnly = localStorage.getItem(GAME_KEY) !== '0'; } catch (e) {}
    const sendGameOnly = () => t.core.invoke('overlay_set_game_only', { enabled: gameOnly }).catch(() => {});
    sendGameOnly();
    if (gameCheck) {
        gameCheck.checked = gameOnly;
        gameCheck.addEventListener('change', () => {
            gameOnly = gameCheck.checked;
            try { localStorage.setItem(GAME_KEY, gameOnly ? '1' : '0'); } catch (e) {}
            sendGameOnly();
        });
    }
    let enabled = false;
    let editing = false;
    try { enabled = localStorage.getItem(KEY) === '1'; } catch (e) {}

    function collectState() {
        const users = [];
        const inCall = !!(currentUser && currentUser.room);
        if (inCall) {
            voiceUsersContainer.querySelectorAll('.voice-user-row:not(.offcall)').forEach((row) => {
                const img = row.querySelector('.user-avatar');
                const nameEl = row.querySelector('.voice-user-name');
                users.push({
                    id: img && img.id ? img.id : '',
                    name: nameEl ? nameEl.textContent.trim() : 'Участник',
                    color: nameEl && nameEl.style ? nameEl.style.color : '',
                    avatar: img ? img.src : '',
                    speaking: !!(img && img.classList.contains('speaking')),
                    muted: !!row.querySelector('.mic-mute-badge.visible'),
                    deafened: !!row.querySelector('.deafen-badge.visible')
                });
            });
        }
        let title = '', playing = false, pos = 0, dur = 0;
        const guest = typeof listenSession !== 'undefined' && listenSession && listenSession.role === 'guest';
        if (guest) {
            title = listenSessionTrackName.textContent.trim();
            playing = !!(typeof listenGuestAudio !== 'undefined' && listenGuestAudio && !listenGuestAudio.paused);
            if (typeof listenGuestAudio !== 'undefined' && listenGuestAudio) {
                pos = listenGuestAudio.currentTime || 0;
                dur = isFinite(listenGuestAudio.duration) ? listenGuestAudio.duration : 0;
            }
        } else {
            const name = playlistTrackNameEl.textContent.trim();
            title = name && name !== 'Нет трека' ? name : '';
            playing = !playlistAudio.paused;
            pos = playlistAudio.currentTime || 0;
            dur = isFinite(playlistAudio.duration) ? playlistAudio.duration : 0;
        }
        const demo = blockVisible('video') ? pickDemo() : null;
        const theme = (typeof currentTheme !== 'undefined' && currentTheme) ? { accent: currentTheme.accent, bg: currentTheme.bgColor, textMode: currentTheme.textMode } : null;
        return { inCall, users, theme, music: { title, playing, pos: Math.round(pos * 10) / 10, dur: Math.round(dur) }, demo: { available: !!demo, name: demo ? demo.name : '' } };
    }

    let lastJson = '';
    function pushState(force) {
        if (!enabled) return;
        const state = collectState();
        const json = JSON.stringify(state);
        if (!force && json === lastJson) return;
        lastJson = json;
        t.event.emit('overlay-state', state).catch(() => {});
    }
    let timer = null;
    window.muteOverlayThemeChanged = () => schedulePush();
    function schedulePush() {
        if (!enabled || timer) return;
        timer = setTimeout(() => { timer = null; checkRtcSource(); pushState(false); }, 60);
    }

    // Следим за списком участников (класс .speaking, бейджи мьюта, вход/выход) и за плеером.
    new MutationObserver(schedulePush).observe(voiceUsersContainer, {
        subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'src']
    });
    new MutationObserver(schedulePush).observe(remoteVideos, { childList: true });
    [playlistTrackNameEl, listenSessionTrackName].forEach((el) => {
        if (el) new MutationObserver(schedulePush).observe(el, { subtree: true, childList: true, characterData: true });
    });
    ['play', 'pause', 'ended', 'emptied', 'seeked', 'loadedmetadata', 'durationchange'].forEach((ev) => {
        playlistAudio.addEventListener(ev, schedulePush);
        if (typeof listenGuestAudio !== 'undefined' && listenGuestAudio) listenGuestAudio.addEventListener(ev, schedulePush);
    });

    // Пока играет музыка — раз в 5 с уточняем позицию (между этим оверлей считает время сам)
    setInterval(() => { if (enabled && (!playlistAudio.paused || (typeof listenGuestAudio !== 'undefined' && listenGuestAudio && !listenGuestAudio.paused))) pushState(true); }, 5000);

    function setEditUi() {
        if (!editBtn) return;
        editBtn.textContent = editing ? 'Закончить настройку' : 'Настроить оверлей';
        editBtn.disabled = !enabled;
    }

    async function setEditing(on) {
        if (!enabled) return;
        try {
            await t.core.invoke('overlay_set_edit', { enabled: on });
            editing = on;
            t.event.emit('overlay-edit', on).catch(() => {});
        } catch (e) {
            editing = false;
            showToast('Оверлей: ' + e, 5000);
        }
        setEditUi();
    }

    async function setEnabled(on) {
        enabled = on;
        try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
        if (on) {
            try { await t.core.invoke('overlay_open'); }
            catch (e) { showToast('Не удалось открыть оверлей: ' + e, 6000); enabled = false; if (check) check.checked = false; }
            lastJson = '';
            pushState(true);
        } else {
            editing = false;
            try { await t.core.invoke('overlay_close'); } catch (e) {}
        }
        setEditUi();
    }

    // ----- Настройки оверлея. Хранятся в одном ключе (его же читает и сам оверлей), синхронизируются событиями -----
    const CFG_KEY = 'mute_overlay_v1';
    const BLOCKS = ['voice', 'music', 'messages', 'video'];
    const BLOCK_DEFAULT_VISIBLE = { voice: true, music: true, messages: true, video: false };
    function readCfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch (e) { return {}; } }
    function writeCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) {} }
    function blockVisible(k) {
        const c = readCfg();
        return c[k] && typeof c[k].visible === 'boolean' ? c[k].visible : BLOCK_DEFAULT_VISIBLE[k];
    }
    function chatFlag(name, def) { const c = readCfg(); return typeof c[name] === 'boolean' ? c[name] : def; }
    function pushCfgToOverlay() { t.event.emit('overlay-config', { cfg: readCfg() }).catch(() => {}); }
    function setBlockVisible(k, v) {
        const c = readCfg();
        c[k] = Object.assign({}, c[k], { visible: !!v });
        writeCfg(c); pushCfgToOverlay(); schedulePush();
    }
    function setChatFlag(name, v) { const c = readCfg(); c[name] = !!v; writeCfg(c); pushCfgToOverlay(); }
    const dmCheck = document.getElementById('overlay-msg-dm-check');
    const allCheck = document.getElementById('overlay-msg-all-check');
    function syncChecks() {
        BLOCKS.forEach((k) => { const el = document.getElementById('overlay-block-' + k); if (el) el.checked = blockVisible(k); });
        if (dmCheck) dmCheck.checked = chatFlag('chatDm', true);
        if (allCheck) allCheck.checked = chatFlag('chatAll', false);
    }
    BLOCKS.forEach((k) => {
        const el = document.getElementById('overlay-block-' + k);
        if (el) el.addEventListener('change', () => setBlockVisible(k, el.checked));
    });
    if (dmCheck) dmCheck.addEventListener('change', () => setChatFlag('chatDm', dmCheck.checked));
    if (allCheck) allCheck.addEventListener('change', () => setChatFlag('chatAll', allCheck.checked));
    syncChecks();
    // Что-то изменили в панели самого оверлея (режим настройки) — берём его настройки целиком
    t.event.listen('overlay-config-changed', (ev) => {
        const m = ev && ev.payload;
        if (m && typeof m === 'object') writeCfg(m);
        syncChecks(); schedulePush();
    });

    // ----- Чат в оверлее: показывать ли сообщение, решает сам оверлей по своим настройкам -----
    window.muteOverlayMessage = (payload, kind, senderName) => {
        if (!enabled || !payload || !blockVisible('messages')) return;
        let text = String(payload.text || '').trim();
        if (!text) text = (payload.image_url || payload.file_url || (payload.attachments && payload.attachments.length)) ? '📎 вложение' : '';
        if (!text) return;
        t.event.emit('overlay-message', {
            id: String(payload.id || '') + ':' + Date.now(),
            name: senderName || payload.username || payload.user || 'Участник',
            text,
            kind,
            color: typeof getUserColor === 'function' ? getUserColor(senderName || '') : '',
            avatar: payload.avatar || ''
        }).catch(() => {});
    };

    // ----- Видео чужой демонстрации экрана в оверлее -----
    // Оверлей — отдельное окно, поэтому видеотрек передаём ему локальным WebRTC-соединением
    // (сигналы идут событиями Tauri). Битрейт и частота кадров ограничены, чтобы не грузить игру.
    let rtc = null;
    function pickDemo() {
        if (typeof sharingPeers === 'undefined') return null;
        for (const id of sharingPeers) {
            const st = remoteStreamsByPeer[id];
            const tr = st && st.getVideoTracks().find((x) => x.readyState === 'live');
            if (tr) return { id, track: tr, name: (connectedUsers[id] && connectedUsers[id].username) || '' };
        }
        return null;
    }
    function closeRtc() {
        if (!rtc) return;
        const r = rtc; rtc = null;
        try { r.pc.close(); } catch (e) {}
    }
    t.event.listen('ov-rtc-offer', async (ev) => {
        closeRtc();
        const demo = pickDemo();
        if (!demo || !enabled || !blockVisible('video') || !ev || !ev.payload) { t.event.emit('ov-rtc-none', null).catch(() => {}); return; }
        const pc = new RTCPeerConnection({ iceServers: [] });
        const me = rtc = { pc, demoId: demo.id, trackId: demo.track.id, pending: [], haveRemote: false };
        pc.onicecandidate = (e) => { if (e.candidate && rtc === me) t.event.emit('ov-rtc-ice', { c: e.candidate.toJSON() }).catch(() => {}); };
        try {
            await pc.setRemoteDescription({ type: 'offer', sdp: ev.payload.sdp });
            const tr = pc.getTransceivers()[0];
            tr.direction = 'sendonly';
            await tr.sender.replaceTrack(demo.track);
            await pc.setLocalDescription(await pc.createAnswer());
            try {
                const p = tr.sender.getParameters();
                if (!p.encodings || !p.encodings.length) p.encodings = [{}];
                p.encodings[0].maxBitrate = 1200000;
                p.encodings[0].maxFramerate = 20;
                p.encodings[0].scaleResolutionDownBy = 2;
                await tr.sender.setParameters(p);
            } catch (e) { /* параметры — необязательная оптимизация */ }
            if (rtc !== me) return;
            me.haveRemote = true;
            me.pending.splice(0).forEach((c) => pc.addIceCandidate(c).catch(() => {}));
            t.event.emit('ov-rtc-answer', { sdp: pc.localDescription.sdp }).catch(() => {});
        } catch (e) {
            console.warn('[overlay video]', e);
            if (rtc === me) closeRtc();
            t.event.emit('ov-rtc-none', null).catch(() => {});
        }
    });
    t.event.listen('ov-rtc-ice', (ev) => {
        const c = ev && ev.payload && ev.payload.c;
        if (!rtc || !c) return;
        if (rtc.haveRemote) rtc.pc.addIceCandidate(c).catch(() => {}); else rtc.pending.push(c);
    });
    t.event.listen('ov-rtc-stop', closeRtc);
    // Демонстрацию сменили или она закончилась — пусть оверлей запросит видео заново
    function checkRtcSource() {
        if (!rtc) return;
        const demo = pickDemo();
        if (!demo || demo.id !== rtc.demoId || demo.track.id !== rtc.trackId) {
            closeRtc();
            t.event.emit('ov-rtc-restart', null).catch(() => {});
        }
    }

    // Бинд «Оверлей: режим настройки»
    window.muteOverlayToggleEdit = () => {
        if (!enabled) { showToast('Оверлей выключен: включите его в настройках.', 3500); return; }
        setEditing(!editing);
    };

    // Окно оверлея после загрузки просит текущее состояние.
    t.event.listen('overlay-request-state', () => {
        pushCfgToOverlay(); // возвращаем оверлею его сохранённые положение/размеры/прозрачность
        pushState(true);
        if (editing) t.event.emit('overlay-edit', true).catch(() => {});
    });
    // «Готово» в панели самого оверлея
    t.event.listen('overlay-edit-changed', (ev) => { editing = !!(ev && ev.payload); setEditUi(); });

    if (check) {
        check.checked = enabled;
        check.addEventListener('change', () => setEnabled(check.checked));
    }
    if (editBtn) editBtn.addEventListener('click', () => setEditing(!editing));
    setEditUi();
    if (enabled) setEnabled(true);
});

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


// Если картинка аватарки не грузится (например, Cloudinary отвечает 401/404, файл удалён),
// подставляем сгенерированный identicon вместо «битой» картинки.
const brokenAvatarUrls = new Set();
document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.classList.contains('user-avatar')) return;
    if (img.dataset.avatarFallback) return; // не зацикливаться
    img.dataset.avatarFallback = '1';
    brokenAvatarUrls.add(img.src);
    const row = img.closest('.voice-user-row, .member-row, .message, [data-username]');
    const nameEl = row && row.querySelector('.voice-user-name, .username, .msg-username');
    const seed = (nameEl && nameEl.textContent.trim()) || (row && row.dataset.username) || (img.src.split('/').pop() || 'user');
    img.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(seed)}`;
}, true);


// ===================================================================================
// Саундпад: свои короткие звуки, которые слышат участники канала (и вы сами).
// Файлы лежат в IndexedDB браузера/приложения (только на этом устройстве), названия, громкости
// и настройки — в localStorage, горячие клавиши — в общей системе горячих клавиш (keybinds),
// поэтому работают и глобально (в игре), как остальные.
// Звук подмешивается в исходящий поток (destinationNode) мимо шумоподавления и «изменения голоса».
// ===================================================================================
const SP_META_KEY = 'mute_soundpad_meta_v1';
const SP_MAX_BYTES = 10 * 1024 * 1024;
const SP_MAX_SOUNDS = 100;
let sp = { sounds: [], groups: [], master: 100 };
try {
    const raw = JSON.parse(localStorage.getItem(SP_META_KEY) || 'null');
    if (raw && typeof raw === 'object') {
        sp = { ...sp, ...raw };
        if (!Array.isArray(sp.sounds)) sp.sounds = [];
    }
} catch (e) { /* ignore */ }
// Группы звуков (как плейлисты в «Плейлисте»): у каждого звука есть groupId.
if (!sp.groups.length) sp.groups = [{ id: 'grp_default', name: 'Основная' }];
sp.sounds.forEach((s) => { if (!sp.groups.some((g) => g.id === s.groupId)) s.groupId = sp.groups[0].id; });
let spAddTarget = null; // в какой раздел добавляем выбранные файлы
function spSave() { try { localStorage.setItem(SP_META_KEY, JSON.stringify(sp)); } catch (e) { /* ignore */ } }

// ---- хранилище файлов ----
let spDbPromise = null;
function spDb() {
    if (!spDbPromise) {
        spDbPromise = new Promise((resolve, reject) => {
            if (!window.indexedDB) { reject(new Error('IndexedDB недоступна')); return; }
            const req = indexedDB.open('mute_soundpad_v1', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('sounds');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return spDbPromise;
}
async function spDbOp(mode, fn) {
    const db = await spDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('sounds', mode);
        const req = fn(tx.objectStore('sounds'));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}
const spPutBlob = (id, blob) => spDbOp('readwrite', (s) => s.put(blob, id));
const spGetBlob = (id) => spDbOp('readonly', (s) => s.get(id));
const spDelBlob = (id) => spDbOp('readwrite', (s) => s.delete(id));

// ---- воспроизведение ----
let spLocalCtx = null;            // запасной контекст, если микрофон ещё не запущен (звук только себе)
const spBuffers = new Map();      // id -> AudioBuffer
const spPlaying = new Map();      // id -> экземпляр воспроизведения
let spTx = 0;                     // сколько звуков сейчас уходит в канал

function soundpadTransmitActive() { return spTx > 0 && !isMuted && !isDeafened; }

function spContext() {
    if (audioContext && audioContext.state !== 'closed') return audioContext;
    if (!spLocalCtx) spLocalCtx = new (window.AudioContext || window.webkitAudioContext)();
    return spLocalCtx;
}
async function spGetBuffer(id, ctx) {
    if (spBuffers.has(id)) return spBuffers.get(id);
    const blob = await spGetBlob(id);
    if (!blob) throw new Error('Файл звука не найден');
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    spBuffers.set(id, buf);
    return buf;
}
function spFindSound(id) { return sp.sounds.find((s) => s.id === id); }

async function spPlay(id) {
    const snd = spFindSound(id);
    if (!snd) return;
    try {
        const ctx = spContext();
        if (ctx.state !== 'running') await ctx.resume().catch(() => {});
        const buf = await spGetBuffer(id, ctx);
        if (spPlaying.has(id)) spPlaying.get(id).stop();

        const src = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.value = (Math.max(0, Math.min(100, snd.vol)) / 100) * (sp.master / 100);
        src.connect(gain);

        // Передаём в канал, если вы в звонке и не заглушены; сами слышим, если наушники не выключены.
        const sending = !!(ctx === audioContext && destinationNode && currentUser.room && !isMuted && !isDeafened);
        const hearing = !isDeafened;
        if (!sending && !hearing) { showToast('Звук выключен (наушники отключены) — включите звук, чтобы слышать саундпад.'); return; }
        if (sending) gain.connect(destinationNode);
        if (hearing) gain.connect(ctx.destination);

        const inst = {
            sending,
            gainNode: gain,
            sound: snd,
            stopped: false,
            stop() { try { src.stop(); } catch (e) { /* уже остановлен */ } },
            finish() {
                if (this.stopped) return;
                this.stopped = true;
                try { src.disconnect(); gain.disconnect(); } catch (e) { /* ignore */ }
                if (spPlaying.get(id) === this) spPlaying.delete(id);
                if (this.sending) spTx = Math.max(0, spTx - 1);
                applyGateToMicTrack();
                spUpdatePlayingUi();
            }
        };
        src.onended = () => inst.finish();
        spPlaying.set(id, inst);
        if (sending) { spTx++; applyGateToMicTrack(); }
        src.start();
        spUpdatePlayingUi();
    } catch (e) {
        console.warn('[Саундпад]', e);
        showToast('Не удалось воспроизвести звук: ' + (e && e.message ? e.message : e));
    }
}
// Громкость звука/общая громкость меняется на лету, в том числе у уже играющих звуков
function spApplyLiveVolumes() {
    spPlaying.forEach((inst) => {
        if (inst.gainNode && inst.sound) {
            inst.gainNode.gain.value = (Math.max(0, Math.min(100, inst.sound.vol)) / 100) * (sp.master / 100);
        }
    });
}
function spPlayToggle(id) {
    if (spPlaying.has(id)) spPlaying.get(id).stop();
    else spPlay(id);
}
function spStopAll() { Array.from(spPlaying.values()).forEach((i) => i.stop()); }

// ---- горячие клавиши звуков (динамические действия общей системы) ----
function spSyncKeybindActions() {
    for (let i = KEYBIND_ACTIONS.length - 1; i >= 0; i--) {
        if (String(KEYBIND_ACTIONS[i].id).startsWith('sp:')) KEYBIND_ACTIONS.splice(i, 1);
    }
    sp.sounds.forEach((s) => KEYBIND_ACTIONS.push({ id: 'sp:' + s.id, label: 'Саундпад: ' + s.name, hidden: true }));
}

// ---- добавление / удаление ----
const spNewId = () => 'snd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
async function spAddFiles(files) {
    let added = 0;
    for (const file of Array.from(files || [])) {
        if (sp.sounds.length >= SP_MAX_SOUNDS) { showToast(`Максимум ${SP_MAX_SOUNDS} звуков.`); break; }
        if (!/^audio\//.test(file.type) && !/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)$/i.test(file.name)) { showToast(`«${file.name}» — не аудиофайл.`); continue; }
        if (file.size > SP_MAX_BYTES) { showToast(`«${file.name}» больше 10 МБ — выберите файл покороче.`); continue; }
        try {
            const ctx = spContext();
            const buf = await ctx.decodeAudioData(await file.arrayBuffer());
            const id = spNewId();
            await spPutBlob(id, file);
            spBuffers.set(id, buf);
            sp.sounds.push({ id, groupId: spAddTarget || sp.groups[0].id, name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Звук', vol: 100, dur: Math.round(buf.duration * 10) / 10 });
            added++;
        } catch (e) {
            console.warn('[Саундпад] не удалось добавить', file.name, e);
            showToast(`Не удалось прочитать «${file.name}».`);
        }
    }
    spAddTarget = null;
    if (added) { spSave(); spSyncKeybindActions(); renderSoundpad(); }
}
async function spRemove(id) {
    const snd = spFindSound(id);
    if (!snd || !confirm(`Удалить звук «${snd.name}»?`)) return;
    if (spPlaying.has(id)) spPlaying.get(id).stop();
    sp.sounds = sp.sounds.filter((s) => s.id !== id);
    spBuffers.delete(id);
    try { await spDelBlob(id); } catch (e) { /* ignore */ }
    if (keybinds['sp:' + id]) { delete keybinds['sp:' + id]; saveKeybinds(); }
    spSave();
    spSyncKeybindActions();
    syncGlobalShortcuts();
    renderSoundpad();
}

// ---- интерфейс ----
const spEl = {
    list: document.getElementById('sp-list'),
    file: document.getElementById('sp-file-input'),
    stopAll: document.getElementById('sp-stopall-btn'),
    sectionNew: document.getElementById('sp-section-new-btn'),
    master: document.getElementById('sp-master-slider'),
    masterVal: document.getElementById('sp-master-value'),
    btn: document.getElementById('soundpad-btn'),
    pop: document.getElementById('soundpad-pop'),
    grid: document.getElementById('sp-pop-grid'),
    popStop: document.getElementById('sp-pop-stop'),
    popSettings: document.getElementById('sp-pop-settings')
};
const SP_ICON_PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"></polygon></svg>';
const SP_ICON_STOP = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"></rect></svg>';
const SP_ICON_X = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
const SP_ICON_TRASH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';

function spComboLabel(id) {
    const combo = keybinds['sp:' + id];
    return combo ? prettyCombo(combo) : '';
}

const SP_ICON_CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
const SP_ICON_PLUS = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>';
const SP_ICON_EDIT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';
const SP_ICON_GRIP = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.6"></circle><circle cx="15" cy="6" r="1.6"></circle><circle cx="9" cy="12" r="1.6"></circle><circle cx="15" cy="12" r="1.6"></circle><circle cx="9" cy="18" r="1.6"></circle><circle cx="15" cy="18" r="1.6"></circle></svg>';
let spDragId = null;

// Строка одного звука в настройках
function spBuildRow(s) {
    const row = document.createElement('div');
    row.className = 'sp-row' + (spPlaying.has(s.id) ? ' playing' : '');
    row.dataset.id = s.id;

    const grip = document.createElement('span');
    grip.className = 'sp-grip'; grip.title = 'Перетащите в другой раздел'; grip.draggable = true;
    grip.innerHTML = SP_ICON_GRIP;
    grip.addEventListener('dragstart', (e) => {
        spDragId = s.id;
        row.classList.add('dragging');
        if (e.dataTransfer) { e.dataTransfer.setData('text/plain', s.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setDragImage(row, 16, 16); }
    });
    grip.addEventListener('dragend', () => {
        spDragId = null;
        row.classList.remove('dragging');
        document.querySelectorAll('.sp-section.drop-target').forEach((el) => el.classList.remove('drop-target'));
    });

    const play = document.createElement('button');
    play.type = 'button'; play.className = 'sp-play'; play.title = 'Проиграть / остановить';
    play.innerHTML = spPlaying.has(s.id) ? SP_ICON_STOP : SP_ICON_PLAY;
    play.addEventListener('click', () => spPlayToggle(s.id));

    const nameWrap = document.createElement('div');
    nameWrap.className = 'sp-name-wrap';
    const name = document.createElement('input');
    name.type = 'text'; name.className = 'sp-name'; name.value = s.name; name.maxLength = 40;
    name.addEventListener('change', () => {
        s.name = name.value.trim() || 'Звук';
        name.value = s.name;
        spSave(); spSyncKeybindActions(); spRenderPop();
    });
    const dur = document.createElement('span');
    dur.className = 'sp-dur';
    dur.textContent = s.dur ? `${s.dur.toFixed(1)} с` : '';
    nameWrap.append(name, dur);

    const vol = document.createElement('input');
    vol.type = 'range'; vol.min = '0'; vol.max = '100'; vol.step = '1'; vol.value = String(s.vol);
    vol.title = 'Громкость этого звука';
    vol.style.setProperty('--fill', s.vol + '%');
    vol.addEventListener('input', () => { s.vol = Number(vol.value); vol.style.setProperty('--fill', vol.value + '%'); spSave(); spApplyLiveVolumes(); });

    const keys = document.createElement('span');
    keys.className = 'sp-keys';
    const recording = keybindRecording === 'sp:' + s.id;
    const key = document.createElement('button');
    const combo = spComboLabel(s.id);
    key.type = 'button';
    key.className = 'sp-key' + (combo ? '' : ' empty') + (recording ? ' recording' : '');
    key.textContent = recording ? 'Нажмите клавишу…' : (combo || 'Клавиша');
    key.addEventListener('click', () => {
        if (recording) stopKeybindRecording(); else startKeybindRecording('sp:' + s.id);
    });
    keys.appendChild(key);
    if (combo && !recording) {
        const clear = document.createElement('button');
        clear.type = 'button'; clear.className = 'sp-key-clear'; clear.title = 'Убрать клавишу';
        clear.innerHTML = SP_ICON_X;
        clear.addEventListener('click', () => {
            keybinds['sp:' + s.id] = '';
            saveKeybinds(); syncGlobalShortcuts(); renderSoundpad();
        });
        keys.appendChild(clear);
    }

    const del = document.createElement('button');
    del.type = 'button'; del.className = 'sp-del'; del.title = 'Удалить звук';
    del.innerHTML = SP_ICON_TRASH;
    del.addEventListener('click', () => spRemove(s.id));

    row.append(grip, play, nameWrap, vol, keys, del);
    return row;
}

// Большой список: разделы, которые сворачиваются и разворачиваются
function renderSoundpad() {
    if (spEl.list) {
        spEl.list.innerHTML = '';
        sp.groups.forEach((g) => {
            const sounds = sp.sounds.filter((s) => s.groupId === g.id);
            const sec = document.createElement('div');
            sec.className = 'sp-section' + (g.collapsed ? ' collapsed' : '');
            sec.dataset.group = g.id;

            const head = document.createElement('div');
            head.className = 'sp-sec-head';
            const toggle = document.createElement('button');
            toggle.type = 'button'; toggle.className = 'sp-sec-toggle';
            toggle.title = g.collapsed ? 'Развернуть раздел' : 'Свернуть раздел';
            toggle.innerHTML = SP_ICON_CHEVRON;
            const nm = document.createElement('span'); nm.className = 'sp-sec-name'; nm.textContent = g.name;
            const cnt = document.createElement('span'); cnt.className = 'sp-sec-count'; cnt.textContent = String(sounds.length);
            toggle.append(nm, cnt);
            toggle.addEventListener('click', () => { g.collapsed = !g.collapsed; spSave(); renderSoundpad(); });

            const addBtn = document.createElement('button');
            addBtn.type = 'button'; addBtn.className = 'sp-sec-btn'; addBtn.title = 'Добавить звуки в этот раздел';
            addBtn.innerHTML = SP_ICON_PLUS + '<span>Звуки</span>';
            addBtn.addEventListener('click', () => {
                spAddTarget = g.id;
                if (g.collapsed) { g.collapsed = false; spSave(); }
                if (spEl.file) spEl.file.click();
            });
            const renBtn = document.createElement('button');
            renBtn.type = 'button'; renBtn.className = 'sp-sec-btn'; renBtn.title = 'Переименовать раздел';
            renBtn.innerHTML = SP_ICON_EDIT;
            renBtn.addEventListener('click', () => spRenameSection(g.id));
            const delBtn = document.createElement('button');
            delBtn.type = 'button'; delBtn.className = 'sp-sec-btn danger'; delBtn.title = 'Удалить раздел';
            delBtn.innerHTML = SP_ICON_TRASH;
            delBtn.disabled = sp.groups.length <= 1;
            delBtn.addEventListener('click', () => spDeleteSection(g.id));
            head.append(toggle, addBtn, renBtn, delBtn);

            const body = document.createElement('div');
            body.className = 'sp-sec-body';
            if (!sounds.length) {
                const empty = document.createElement('div');
                empty.className = 'sp-sec-empty';
                empty.textContent = 'Пусто. Нажмите «Звуки», чтобы добавить файлы (mp3, wav, ogg, до 10 МБ), или перетащите сюда звук из другого раздела.';
                body.appendChild(empty);
            }
            sounds.forEach((s) => body.appendChild(spBuildRow(s)));

            // перетаскивание звука из другого раздела
            sec.addEventListener('dragover', (e) => { if (spDragId) { e.preventDefault(); sec.classList.add('drop-target'); } });
            sec.addEventListener('dragleave', (e) => { if (!sec.contains(e.relatedTarget)) sec.classList.remove('drop-target'); });
            sec.addEventListener('drop', (e) => {
                e.preventDefault();
                sec.classList.remove('drop-target');
                const snd = spFindSound(spDragId);
                spDragId = null;
                if (!snd || snd.groupId === g.id) return;
                snd.groupId = g.id;
                g.collapsed = false;
                spSave(); renderSoundpad();
            });

            sec.append(head, body);
            spEl.list.appendChild(sec);
        });
    }
    if (spEl.master) { spEl.master.value = String(sp.master); spEl.master.style.setProperty('--fill', sp.master + '%'); if (spEl.masterVal) spEl.masterVal.textContent = sp.master + '%'; }
    spRenderPop();
}

function spCreateSection() {
    const clean = String(prompt('Название нового раздела:') || '').trim().slice(0, 30);
    if (!clean) return;
    if (sp.groups.some((g) => g.name.toLowerCase() === clean.toLowerCase())) { alert('Раздел с таким названием уже существует.'); return; }
    const g = { id: 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: clean, collapsed: false };
    sp.groups.push(g);
    spSave();
    renderSoundpad();
    const el = spEl.list && spEl.list.querySelector(`.sp-section[data-group="${g.id}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function spRenameSection(id) {
    const g = sp.groups.find((x) => x.id === id);
    if (!g) return;
    const clean = String(prompt('Новое название раздела:', g.name) || '').trim().slice(0, 30);
    if (!clean || clean === g.name) return;
    if (sp.groups.some((x) => x.id !== id && x.name.toLowerCase() === clean.toLowerCase())) { alert('Раздел с таким названием уже существует.'); return; }
    g.name = clean;
    spSave();
    renderSoundpad();
}
async function spDeleteSection(id) {
    if (sp.groups.length <= 1) { alert('Нельзя удалить последний раздел.'); return; }
    const g = sp.groups.find((x) => x.id === id);
    if (!g) return;
    const doomed = sp.sounds.filter((s) => s.groupId === g.id);
    const msg = doomed.length
        ? `Удалить раздел «${g.name}» вместе со всеми звуками в нём (${doomed.length})?`
        : `Удалить пустой раздел «${g.name}»?`;
    if (!confirm(msg)) return;
    for (const s of doomed) {
        if (spPlaying.has(s.id)) spPlaying.get(s.id).stop();
        spBuffers.delete(s.id);
        try { await spDelBlob(s.id); } catch (e) { /* ignore */ }
        if (keybinds['sp:' + s.id]) delete keybinds['sp:' + s.id];
    }
    sp.sounds = sp.sounds.filter((s) => s.groupId !== g.id);
    sp.groups = sp.groups.filter((x) => x.id !== g.id);
    saveKeybinds();
    spSave();
    spSyncKeybindActions();
    syncGlobalShortcuts();
    renderSoundpad();
}

// Быстрая панель: те же разделы (общее состояние «свёрнуто/развёрнуто»), пустые не показываем
function spRenderPop() {
    if (!spEl.grid) return;
    spEl.grid.innerHTML = '';
    let any = false;
    sp.groups.forEach((g) => {
        const sounds = sp.sounds.filter((s) => s.groupId === g.id);
        if (!sounds.length) return;
        any = true;
        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'sp-pop-sec' + (g.collapsed ? ' collapsed' : '');
        head.innerHTML = SP_ICON_CHEVRON;
        const nm = document.createElement('b'); nm.textContent = g.name;
        const cnt = document.createElement('span'); cnt.textContent = String(sounds.length);
        head.append(nm, cnt);
        head.addEventListener('click', () => { g.collapsed = !g.collapsed; spSave(); renderSoundpad(); spPositionPop(); });
        spEl.grid.appendChild(head);
        if (g.collapsed) return;
        const grid = document.createElement('div');
        grid.className = 'sp-pop-grid';
        sounds.forEach((s) => {
            const pad = document.createElement('button');
            pad.type = 'button';
            pad.className = 'sp-pad' + (spPlaying.has(s.id) ? ' playing' : '');
            pad.dataset.id = s.id;
            const ico = document.createElement('span');
            ico.className = 'sp-pad-ico';
            ico.innerHTML = spPlaying.has(s.id) ? SP_ICON_STOP : SP_ICON_PLAY;
            const text = document.createElement('span');
            text.className = 'sp-pad-text';
            const b = document.createElement('b'); b.textContent = s.name;
            text.appendChild(b);
            pad.append(ico, text);
            const combo = spComboLabel(s.id);
            if (combo) { const k = document.createElement('kbd'); k.textContent = combo; pad.appendChild(k); }
            pad.addEventListener('click', () => spPlayToggle(s.id));
            grid.appendChild(pad);
        });
        spEl.grid.appendChild(grid);
    });
    if (!any) {
        const empty = document.createElement('div');
        empty.className = 'sp-empty';
        empty.textContent = 'Звуков пока нет. Добавьте их в настройках.';
        spEl.grid.appendChild(empty);
    }
}

function spUpdatePlayingUi() {
    document.querySelectorAll('.sp-row[data-id]').forEach((row) => {
        const on = spPlaying.has(row.dataset.id);
        row.classList.toggle('playing', on);
        const btn = row.querySelector('.sp-play');
        if (btn) btn.innerHTML = on ? SP_ICON_STOP : SP_ICON_PLAY;
    });
    document.querySelectorAll('.sp-pad[data-id]').forEach((pad) => {
        const on = spPlaying.has(pad.dataset.id);
        pad.classList.toggle('playing', on);
        const ico = pad.querySelector('.sp-pad-ico');
        if (ico) ico.innerHTML = on ? SP_ICON_STOP : SP_ICON_PLAY;
    });
}

function spPositionPop() {
    if (!spEl.btn || !spEl.pop) return;
    const r = spEl.btn.getBoundingClientRect();
    const w = spEl.pop.offsetWidth || 300;
    spEl.pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
    spEl.pop.style.bottom = Math.max(8, window.innerHeight - r.top + 8) + 'px';
    spEl.pop.style.top = 'auto';
}
function spTogglePop(force) {
    if (!spEl.pop) return;
    const open = typeof force === 'boolean' ? force : spEl.pop.hidden;
    spEl.pop.hidden = !open;
    if (spEl.btn) spEl.btn.classList.toggle('active', open);
    if (open) { spRenderPop(); spPositionPop(); }
}

(function initSoundpad() {
    if (spEl.btn) spEl.btn.addEventListener('click', (e) => { e.stopPropagation(); spTogglePop(); });
    document.addEventListener('mousedown', (e) => {
        if (!spEl.pop || spEl.pop.hidden) return;
        if (spEl.pop.contains(e.target) || (spEl.btn && spEl.btn.contains(e.target))) return;
        spTogglePop(false);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && spEl.pop && !spEl.pop.hidden && !keybindRecording) spTogglePop(false); });
    window.addEventListener('resize', () => { if (spEl.pop && !spEl.pop.hidden) spPositionPop(); });
    if (spEl.popStop) spEl.popStop.addEventListener('click', spStopAll);
    if (spEl.popSettings) spEl.popSettings.addEventListener('click', () => {
        spTogglePop(false);
        if (typeof settingsBtn !== 'undefined' && settingsBtn) settingsBtn.click();
        switchSettingsTab('soundpad');
    });
    if (spEl.stopAll) spEl.stopAll.addEventListener('click', spStopAll);
    if (spEl.file) spEl.file.addEventListener('change', async () => { await spAddFiles(spEl.file.files); spEl.file.value = ''; });
    if (spEl.sectionNew) spEl.sectionNew.addEventListener('click', spCreateSection);
    if (spEl.master) spEl.master.addEventListener('input', () => {
        sp.master = Number(spEl.master.value);
        spEl.master.style.setProperty('--fill', sp.master + '%');
        spApplyLiveVolumes();
        if (spEl.masterVal) spEl.masterVal.textContent = sp.master + '%';
        spSave();
    });
    spSyncKeybindActions();
    renderSoundpad();
    syncGlobalShortcuts();
})();


// ---- Единый стиль: заливка всех ползунков акцентным цветом ----
// CSS рисует дорожку градиентом по переменной --fill. Её ведёт этот блок: при вводе, при программной
// установке .value (громкость, пороги и т.д.) и для ползунков, созданных позже.
(function initRangeFill() {
    try {
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (desc && desc.set && desc.get) {
            Object.defineProperty(HTMLInputElement.prototype, 'value', {
                configurable: true,
                enumerable: desc.enumerable,
                get: desc.get,
                set(v) {
                    desc.set.call(this, v);
                    if (this.type === 'range') updateSeekFill(this);
                }
            });
        }
    } catch (e) { /* без патча заливка обновляется только при вводе */ }
    document.addEventListener('input', (e) => { if (e.target && e.target.type === 'range') updateSeekFill(e.target); }, true);
    const initAll = () => document.querySelectorAll('input[type="range"]').forEach(updateSeekFill);
    initAll();
    // Ползунки, которые строятся позже через innerHTML (громкость участника, демонстрации, плеера и т.д.),
    // получают значение атрибутом value, а не свойством — заливку для них считает наблюдатель.
    try {
        const mo = new MutationObserver((muts) => {
            for (const m of muts) {
                if (m.type === 'attributes') { if (m.target.type === 'range') updateSeekFill(m.target); continue; }
                m.addedNodes.forEach((n) => {
                    if (n.nodeType !== 1) return;
                    if (n.matches && n.matches('input[type="range"]')) updateSeekFill(n);
                    if (n.querySelectorAll) n.querySelectorAll('input[type="range"]').forEach(updateSeekFill);
                });
            }
        });
        mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['value', 'min', 'max'] });
    } catch (e) { /* без наблюдателя заливка у динамических ползунков появится только после ввода */ }
    // ползунки в скрытых вкладках/окнах получают значения позже — обновляем при открытии настроек
    document.addEventListener('click', (e) => { if (e.target && e.target.closest && e.target.closest('.settings-tab, #settings-btn')) setTimeout(initAll, 0); }, true);
})();


// ---------- Освобождение памяти, когда вкладка/окно неактивны ----------
// Если окно скрыто (свёрнуто или вкладка не на виду) дольше 30 секунд, освобождаем то, что тяжелее всего
// и легко восстанавливается:
//  • ленту чата вместе с картинками и GIF (декодированные кадры занимают больше всего памяти) —
//    при возврате история заново загружается с сервера (кэша каналов больше нет);
//  • декодированные звуки саундпада (AudioBuffer до сотен МБ у длинных файлов) — декодируются снова
//    при следующем нажатии, если ничего не играет.
// Звонок, голос, демонстрации, музыка и звуки уведомлений не затрагиваются.
const MEMORY_RELEASE_AFTER_MS = 30 * 1000;
let memoryReleaseTimer = null;

function releaseInactiveMemory() {
    memoryReleaseTimer = null;
    if (!document.hidden) return;
    const freed = [];
    if (selectedRoom && messagesDiv && messagesDiv.firstElementChild) {
        rememberChatReadPosition(chatRenderedRoom); // запоминаем, докуда дочитали
        clearChatMessages();                          // убирает и src картинок, и сами узлы
        lastMessageDateKey = null;
        chatRenderedRoom = null;
        chatMemoryReleased = true;
        freed.push('лента чата');
    }
    if (typeof spBuffers !== 'undefined' && spBuffers.size && spPlaying.size === 0) {
        spBuffers.clear();
        freed.push('звуки саундпада');
    }
    chatHistoryCache.clear();
    if (freed.length) console.log('[Память] Окно неактивно 30 с — освобождено:', freed.join(', '));
}

function restoreAfterInactive() {
    if (memoryReleaseTimer) { clearTimeout(memoryReleaseTimer); memoryReleaseTimer = null; }
    if (!chatMemoryReleased) return;
    chatMemoryReleased = false;
    if (!selectedRoom) return;
    // Загружаем историю открытого канала заново; разделитель «Непрочитанные» и позиция чтения восстановятся
    unreadSnapshotByRoom.set(String(selectedRoom), { ids: getUnreadIds(selectedRoom), at: Date.now() });
    if (socket && socket.connected) socket.emit('select chat room', { room: selectedRoom });
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (!memoryReleaseTimer) memoryReleaseTimer = setTimeout(releaseInactiveMemory, MEMORY_RELEASE_AFTER_MS);
    } else {
        restoreAfterInactive();
    }
});


// ---------- Мои GIF: раздел окна смайликов ----------
// В окне смайликов (кнопка рядом с полем чата) есть раздел «GIF» со своими GIF. Файл загружается обычным
// /upload (Cloudinary), в сообщение уходит ссылка-картинка, поэтому у остальных GIF выглядит как любая
// загруженная картинка. Список GIF хранится на устройстве, а при входе в аккаунт — ещё и на сервере
// (/auth/gifs), чтобы он был одинаковым на всех устройствах. Сами файлы с Cloudinary при удалении из
// коллекции не стираются: убирается только ссылка из вашего списка.
const MY_GIFS_KEY = 'mute_my_gifs_v1';
const MY_GIFS_SYNCED_KEY = 'mute_my_gifs_synced_for';
const MY_GIFS_MAX = 100;
const MY_GIF_MAX_BYTES = 8 * 1024 * 1024; // как лимит /upload на сервере
let myGifs = (function loadMyGifsLocal() {
    try {
        const a = JSON.parse(localStorage.getItem(MY_GIFS_KEY) || '[]');
        return Array.isArray(a) ? a.filter((g) => g && typeof g.id === 'string' && typeof g.url === 'string').slice(0, MY_GIFS_MAX) : [];
    } catch (e) { return []; }
})();
let myGifsPushTimer = null;
let myGifFileInput = null;
let myGifUploading = false;

function saveMyGifsLocal() {
    try { localStorage.setItem(MY_GIFS_KEY, JSON.stringify(myGifs)); } catch (e) { /* ignore */ }
}

// Уменьшенное превью: Cloudinary умеет сжимать и анимированные GIF; если не вышло — покажем оригинал
function gifThumbUrl(url) {
    return /\/image\/upload\//.test(url) && !/\/image\/upload\/[^/]*\bw_\d+/.test(url)
        ? url.replace('/image/upload/', '/image/upload/w_240,c_limit/')
        : url;
}

function gifTabIndex() { return EMOJI_CATEGORIES.length + 1; }
function isGifTabOpen() {
    return !!(emojiPickerEl && emojiPickerEl.classList.contains('open') && emojiPickerState && emojiPickerState.allowGif && emojiPickerState.tab === gifTabIndex());
}

// Кнопка GIF подсвечивается, пока открыт раздел GIF (у кнопки смайликов иконка теперь всегда смайлик)
function updateEmojiBtnIcon() {
    const gb = document.getElementById('gif-btn');
    if (gb) gb.classList.toggle('active', isGifTabOpen());
    const eb = document.getElementById('emoji-btn');
    if (eb) eb.classList.remove('show-gif');
}

let gifLinkDraft = ''; // набранное в поле ссылки (сохраняется при перерисовке раздела)
let gifAddMode = null;  // null — плитка «Добавить GIF»; 'menu' — выбор «Файлом / По ссылке»; 'link' — поле для ссылки
const looksLikeUrl = (v) => /^https?:\/\/\S+$/i.test(String(v || '').trim());

const GIF_ICON_PLUS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>';
const GIF_ICON_FILE = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path></svg>';
const GIF_ICON_LINK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"></path><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"></path></svg>';
const GIF_ICON_BACK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg>';

function setGifAddMode(mode) {
    gifAddMode = mode;
    refreshGifTabIfOpen();
}

// Плитка «Добавить GIF» → выбор способа: файлом или по ссылке (ссылка вставляется в поле, GIF добавляется сразу)
function buildGifAddControl() {
    if (gifAddMode === 'link') {
        const row = document.createElement('div');
        row.className = 'gif-link-row';
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'gif-link-back';
        back.title = 'Назад';
        back.innerHTML = GIF_ICON_BACK;
        back.disabled = myGifUploading;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'gif-link-input';
        input.placeholder = 'Вставьте ссылку на GIF';
        input.maxLength = 1000;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.value = gifLinkDraft;
        input.disabled = myGifUploading;
        const linkBtn = document.createElement('button');
        linkBtn.type = 'button';
        linkBtn.className = 'gif-link-btn';
        linkBtn.textContent = myGifUploading ? 'Добавляю…' : 'Добавить';
        linkBtn.disabled = myGifUploading;
        const submit = () => { gifLinkDraft = input.value; return addMyGifFromUrl(input.value); }; // при ошибке адрес остаётся в поле, его можно поправить
        back.addEventListener('click', () => setGifAddMode('menu'));
        input.addEventListener('input', () => { gifLinkDraft = input.value; });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
        input.addEventListener('paste', () => setTimeout(() => { gifLinkDraft = input.value; if (looksLikeUrl(input.value)) submit(); }, 0));
        linkBtn.addEventListener('click', submit);
        row.append(back, input, linkBtn);
        if (!myGifUploading) setTimeout(() => input.focus(), 0);
        return row;
    }
    if (gifAddMode === 'menu') {
        const menu = document.createElement('div');
        menu.className = 'gif-add-menu';
        const mk = (cls, icon, label, onClick) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = cls;
            b.innerHTML = icon + '<span>' + label + '</span>';
            b.addEventListener('click', onClick);
            return b;
        };
        menu.append(
            mk('gif-add-opt gif-add-file', GIF_ICON_FILE, 'Файлом', () => { gifAddMode = null; pickGifFiles(); refreshGifTabIfOpen(); }),
            mk('gif-add-opt gif-add-link', GIF_ICON_LINK, 'По ссылке', () => setGifAddMode('link'))
        );
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'gif-link-back';
        close.title = 'Отмена';
        close.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
        close.addEventListener('click', () => setGifAddMode(null));
        menu.appendChild(close);
        return menu;
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'my-gif-add';
    add.innerHTML = GIF_ICON_PLUS + '<span>' + (myGifUploading ? 'Загрузка…' : 'Добавить GIF') + '</span>';
    add.disabled = myGifUploading;
    add.addEventListener('click', () => setGifAddMode('menu'));
    return add;
}

function renderMyGifGrid(grid) {
    grid.innerHTML = '';
    grid.appendChild(buildGifAddControl());

    if (!myGifs.length) {
        const empty = document.createElement('div');
        empty.className = 'emoji-empty';
        empty.textContent = 'Здесь будут ваши GIF. Нажмите «Добавить GIF»: можно выбрать файл (до 8 МБ) или вставить ссылку.';
        grid.appendChild(empty);
        return;
    }
    myGifs.forEach((g) => {
        const item = document.createElement('div');
        item.className = 'my-gif';
        item.dataset.id = g.id;
        item.title = g.name || 'GIF';
        const img = document.createElement('img');
        img.alt = g.name || 'GIF';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.draggable = false;
        img.src = gifThumbUrl(g.url);
        img.addEventListener('error', () => { if (img.src !== g.url) img.src = g.url; }, { once: true });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'my-gif-del';
        del.title = 'Убрать из коллекции';
        del.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
        item.append(img, del);
        grid.appendChild(item);
    });
}

function gifNameFromUrl(u) {
    try {
        const seg = decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || '');
        const name = seg.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 60);
        return name || 'GIF';
    } catch (e) { return 'GIF'; }
}

// Ссылка на GIF → сервер сам скачивает файл и кладёт в наш Cloudinary, в коллекцию попадает уже наша ссылка
async function addMyGifFromUrl(raw) {
    const url = String(raw || '').trim();
    if (!url) { showToast('Вставьте ссылку на GIF'); return false; }
    if (/^http:\/\//i.test(url)) { showToast('Нужна ссылка, начинающаяся с https://'); return false; }
    if (!/^https:\/\/\S{4,}$/i.test(url)) { showToast('Это не похоже на ссылку. Пример: https://…/cat.gif'); return false; }
    if (myGifUploading) { showToast('GIF уже загружаются — дождитесь окончания'); return false; }
    if (myGifs.length >= MY_GIFS_MAX) { showToast(`В коллекции не больше ${MY_GIFS_MAX} GIF`); return false; }
    myGifUploading = true;
    refreshGifTabIfOpen(); // кнопка станет «Добавляю…»
    try {
        let res;
        try {
            res = await fetch('/api/gif-from-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
        } catch (netErr) {
            throw new Error('Нет связи с сервером. Попробуйте ещё раз.');
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) throw new Error(data.error || 'Не удалось добавить GIF по ссылке');
        myGifs.unshift({
            id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            url: data.url,
            name: gifNameFromUrl(url),
            at: Date.now()
        });
        gifLinkDraft = '';
        gifAddMode = null;
        saveMyGifsLocal();
        scheduleMyGifsPush();
        showToast('GIF добавлен в вашу коллекцию');
        return true;
    } catch (err) {
        showToast(err && err.message ? err.message : 'Не удалось добавить GIF по ссылке');
        return false;
    } finally {
        myGifUploading = false;
        refreshGifTabIfOpen();
    }
}

function refreshGifTabIfOpen() {
    if (isGifTabOpen()) renderEmojiGrid();
}

function sendMyGif(g) {
    if (!g || messageInput.disabled) return;
    sendChatPayloadAndStick({ text: '', attachments: [{ kind: 'image', url: g.url, name: g.name || 'GIF', size: null }] });
    messageInput.focus();
}

function removeMyGif(id) {
    myGifs = myGifs.filter((g) => g.id !== id);
    saveMyGifsLocal();
    scheduleMyGifsPush();
    refreshGifTabIfOpen();
}

function pickGifFiles() {
    if (!myGifFileInput) {
        myGifFileInput = document.createElement('input');
        myGifFileInput.type = 'file';
        myGifFileInput.accept = 'image/gif';
        myGifFileInput.multiple = true;
        myGifFileInput.style.display = 'none';
        document.body.appendChild(myGifFileInput);
        myGifFileInput.addEventListener('change', async () => {
            const files = Array.from(myGifFileInput.files || []);
            myGifFileInput.value = '';
            if (files.length) await addMyGifFiles(files);
        });
    }
    myGifFileInput.click();
}

async function addMyGifFiles(files) {
    if (myGifUploading) { showToast('GIF уже загружаются — дождитесь окончания'); return; }
    myGifUploading = true;
    let added = 0;
    try {
        for (const file of files) {
            if (myGifs.length >= MY_GIFS_MAX) { showToast(`В коллекции не больше ${MY_GIFS_MAX} GIF`); break; }
            if (!/^image\/gif$/i.test(file.type) && !/\.gif$/i.test(file.name)) { showToast(`«${file.name}» — не GIF`); continue; }
            if (file.size > MY_GIF_MAX_BYTES) { showToast(`«${file.name}» больше 8 МБ — выберите файл поменьше`); continue; }
            try {
                const fd = new FormData();
                fd.append('image', file);
                const data = await postFormWithProgress('/upload', fd, () => {});
                if (!data || !data.url) throw new Error('сервер не вернул ссылку');
                if (myGifs.some((g) => g.url === data.url)) continue;
                myGifs.unshift({
                    id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    url: data.url,
                    name: file.name.replace(/\.gif$/i, '').slice(0, 60) || 'GIF',
                    at: Date.now()
                });
                added++;
            } catch (err) {
                if (err && err.message === 'cancelled') break;
                console.error('[GIF] Не удалось загрузить', file.name, err);
                showToast(`Не удалось загрузить «${file.name}»: ${err && err.message ? err.message : err}`);
            }
        }
    } finally {
        myGifUploading = false;
    }
    if (added) {
        saveMyGifsLocal();
        scheduleMyGifsPush();
        showToast(added === 1 ? 'GIF добавлен в вашу коллекцию' : `Добавлено GIF: ${added}`);
        // окно закрывается при выборе файла (смена фокуса) — открываем его снова на разделе GIF
        const btn = document.getElementById('gif-btn') || document.getElementById('emoji-btn');
        if (btn && !btn.disabled) {
            if (emojiPickerEl && emojiPickerEl.classList.contains('open')) refreshGifTabIfOpen();
            else openEmojiPicker({ anchor: btn, onPick: insertEmojiIntoInput, quick: false, closeOnPick: true, allowGif: true, startTab: gifTabIndex() });
        }
    }
}

// ---- синхронизация с аккаунтом ----
function scheduleMyGifsPush(delay = 800) {
    if (!currentUser.token) return; // гость: только на этом устройстве
    clearTimeout(myGifsPushTimer);
    myGifsPushTimer = setTimeout(async () => {
        try {
            await authFetch('/auth/gifs', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gifs: myGifs })
            });
        } catch (e) { /* повторим при следующем изменении или входе */ }
    }, delay);
}

async function syncMyGifsFromServer() {
    if (!currentUser.token) return;
    try {
        const res = await authFetch('/auth/gifs');
        if (!res.ok) return;
        const data = await res.json();
        const server = Array.isArray(data.gifs) ? data.gifs : [];
        const syncedFor = localStorage.getItem(MY_GIFS_SYNCED_KEY);
        if (!server.length && myGifs.length && syncedFor !== currentUser.username) {
            // первый вход этого ника на устройстве: на сервере пусто, а локально GIF уже есть — отправляем их
            scheduleMyGifsPush(0);
        } else {
            myGifs = server.slice(0, MY_GIFS_MAX); // дальше источник истины — сервер (удаления тоже синхронизируются)
            saveMyGifsLocal();
            refreshGifTabIfOpen();
        }
        localStorage.setItem(MY_GIFS_SYNCED_KEY, currentUser.username);
    } catch (e) { /* нет связи — остаёмся на локальной коллекции */ }
}
