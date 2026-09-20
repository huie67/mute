require('dotenv').config({ quiet: true });

const express = require('express');
const http = require('http');
const multer = require('multer');
const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname)); // Клиентские файлы лежат в корне репозитория
app.use(express.json());

// ---------- База данных: Postgres (Neon) — общий чат хранится тут, не на диске сервера ----------
if (!process.env.DATABASE_URL) {
    console.error('❌ Не задан DATABASE_URL (строка подключения к Neon Postgres). Смотрите .env.example');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Neon требует SSL-соединение
});

async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL,
            avatar TEXT,
            text TEXT,
            image_url TEXT,
            created_at BIGINT NOT NULL
        );
    `);
    // Чат стал отдельным для каждой комнаты/сервера — старые общие сообщения (room = NULL)
    // просто перестают попадать в выборку конкретной комнаты, ничего удалять не нужно.
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS room TEXT;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS messages_room_idx ON messages (room, id);`);

    // Аккаунты: вход по паролю.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL,
            password_hash TEXT,
            email TEXT,
            avatar TEXT,
            created_at BIGINT NOT NULL
        );
    `);
    // Ник должен быть уникален без учёта регистра — проверяем и создаём индекс отдельно,
    // чтобы не ловить ошибку, если в старых данных уже есть регистронезависимые дубликаты.
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));
    `);

    // Пользовательские серверы/комнаты. Метаданные хранятся в Neon, поэтому
    // переживают перезапуск/деплой Render. owner_socket_id намеренно не хранится:
    // socket.id меняется после каждого подключения.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS custom_rooms (
            code VARCHAR(6) PRIMARY KEY,
            name VARCHAR(40) NOT NULL,
            password_hash TEXT,
            created_at BIGINT NOT NULL
        );
    `);
    // avatar/owner_username добавлены позже — ADD COLUMN IF NOT EXISTS безопасен и на уже
    // существующей таблице (переживает деплои без ручных миграций).
    await pool.query(`ALTER TABLE custom_rooms ADD COLUMN IF NOT EXISTS avatar TEXT;`);
    await pool.query(`ALTER TABLE custom_rooms ADD COLUMN IF NOT EXISTS owner_username TEXT;`);
    // Модераторы сервера ("повышенные" участники) — могут выгонять и повышать
    // остальных, но не владельца и не друг друга. Хранится как массив ников.
    await pool.query(`ALTER TABLE custom_rooms ADD COLUMN IF NOT EXISTS admin_usernames TEXT[] DEFAULT '{}';`);

    // Постоянный список участников сервера — раньше "участники" вычислялись только
    // по тому, кто прямо сейчас сидит в голосовом канале/чате, поэтому список был
    // почти всегда пустым. Теперь каждый, кто хоть раз создал или вошёл на сервер,
    // остаётся в этой таблице навсегда (или пока его не выгонят) — список показывает
    // всех, кто "на сервере", а не только тех, кто онлайн прямо сейчас.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS custom_room_members (
            id SERIAL PRIMARY KEY,
            code VARCHAR(6) NOT NULL REFERENCES custom_rooms(code) ON DELETE CASCADE,
            username TEXT NOT NULL,
            avatar TEXT,
            joined_at BIGINT NOT NULL
        );
    `);
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS custom_room_members_unique_idx
        ON custom_room_members (code, LOWER(username));
    `);
}

async function insertMessage({ username, avatar, text, imageUrl, room, createdAt }) {
    const result = await pool.query(
        `INSERT INTO messages (username, avatar, text, image_url, room, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [username, avatar, text, imageUrl, room, createdAt]
    );
    return result.rows[0].id;
}

async function getRecentMessages(room, limit = 100) {
    const result = await pool.query(
        `SELECT * FROM messages WHERE room = $1 ORDER BY id DESC LIMIT $2`,
        [room, limit]
    );
    // pg возвращает колонки BIGINT (created_at) не числом, а строкой — так драйвер
    // защищается от потери точности у значений больше Number.MAX_SAFE_INTEGER.
    // На клиенте `new Date("1758214528000")` (строка) — это Invalid Date, а
    // `new Date(1758214528000)` (число) — нормальная дата. Из-за этого у сообщений,
    // подгруженных из истории, дата отправки "слетала", хотя у свежих, только что
    // отправленных сообщений (created_at приходит как обычное число через socket.io
    // сразу из памяти, без похода в БД) всё было в порядке.
    return result.rows.reverse().map(row => ({
        ...row,
        created_at: Number(row.created_at)
    }));
}

// ---------- Загрузка фото в чат: Cloudinary (не диск сервера — тот эфемерный на бесплатном хостинге) ----------
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.error('❌ Не заданы переменные CLOUDINARY_*. Смотрите .env.example');
    process.exit(1);
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const upload = multer({
    storage: multer.memoryStorage(), // файл не пишем на диск — сразу в буфер и в Cloudinary
    limits: { fileSize: 8 * 1024 * 1024 }, // 8 МБ
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
            return cb(new Error('Недопустимый формат файла'));
        }
        cb(null, true);
    }
});

function uploadBufferToCloudinary(buffer) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            { folder: 'voicechat', resource_type: 'image' },
            (err, result) => {
                if (err) return reject(err);
                resolve(result);
            }
        );
        uploadStream.end(buffer);
    });
}

app.post('/upload', (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'Файл не получен' });

        try {
            const result = await uploadBufferToCloudinary(req.file.buffer);
            res.json({ url: result.secure_url });
        } catch (uploadErr) {
            console.error('❌ Ошибка загрузки в Cloudinary:', uploadErr);
            res.status(500).json({ error: 'Не удалось загрузить изображение' });
        }
    });
});

// ---------- Аккаунты: регистрация/вход по паролю ----------
// JWT нужен, чтобы после входа клиент мог доказать серверу, что он — действительно
// владелец ника (иначе пароль был бы бессмысленным: кто угодно мог бы представиться
// чужим зарегистрированным ником прямо в чате, без всякого пароля).
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
    console.warn('⚠️  JWT_SECRET не задан — сгенерирован временный на время работы процесса. ' +
        'После перезапуска сервера все выданные токены станут недействительны (потребуется перевход). ' +
        'Задайте свой JWT_SECRET в .env, чтобы вход сохранялся между перезапусками.');
}

const USERNAME_MIN = 2;
const USERNAME_MAX = 24;
const PASSWORD_MIN = 6;

function signToken(user) {
    return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}

function validateUsername(username) {
    if (typeof username !== 'string') return 'Введите ник';
    const trimmed = username.trim();
    if (trimmed.length < USERNAME_MIN || trimmed.length > USERNAME_MAX) {
        return `Ник должен быть от ${USERNAME_MIN} до ${USERNAME_MAX} символов`;
    }
    return null;
}

function validatePassword(password) {
    if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
        return `Пароль должен быть не короче ${PASSWORD_MIN} символов`;
    }
    return null;
}

async function findUserByUsername(username) {
    const result = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    return result.rows[0] || null;
}

// Регистрация нового аккаунта с паролем.
app.post('/auth/register', async (req, res) => {
    const username = (req.body && req.body.username || '').trim();
    const password = (req.body && req.body.password) || '';
    const avatar = (req.body && req.body.avatar || '').trim() || null;

    const usernameError = validateUsername(username);
    if (usernameError) return res.status(400).json({ error: usernameError });

    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    try {
        const existing = await findUserByUsername(username);
        if (existing) {
            return res.status(409).json({ error: 'Такой ник уже занят' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const finalAvatar = avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username)}`;

        const result = await pool.query(
            `INSERT INTO users (username, password_hash, avatar, created_at)
             VALUES ($1, $2, $3, $4) RETURNING id, username, avatar`,
            [username, passwordHash, finalAvatar, Date.now()]
        );
        const user = result.rows[0];

        res.json({ token: signToken(user), username: user.username, avatar: user.avatar });
    } catch (err) {
        console.error('❌ Ошибка регистрации:', err);
        res.status(500).json({ error: 'Не удалось зарегистрироваться' });
    }
});

// Вход в существующий аккаунт с паролем.
app.post('/auth/login', async (req, res) => {
    const username = (req.body && req.body.username || '').trim();
    const password = (req.body && req.body.password) || '';

    if (!username || !password) {
        return res.status(400).json({ error: 'Введите ник и пароль' });
    }

    try {
        const user = await findUserByUsername(username);
        // Не уточняем отдельно "нет такого ника" vs "неверный пароль" — чтобы не помогать
        // перебору существующих ников.
        if (!user || !user.password_hash) {
            return res.status(401).json({ error: 'Неверный ник или пароль' });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).json({ error: 'Неверный ник или пароль' });
        }

        res.json({ token: signToken(user), username: user.username, avatar: user.avatar });
    } catch (err) {
        console.error('❌ Ошибка входа:', err);
        res.status(500).json({ error: 'Не удалось войти' });
    }
});

// Обновление ника/аватарки для владельца аккаунта (вызывается из настроек профиля).
// Требует валидный токен — иначе изменить чужой аккаунт нельзя.
app.put('/auth/profile', async (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const decoded = token && verifyToken(token);

    if (!decoded) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const username = (req.body && req.body.username || '').trim();
    const avatar = (req.body && req.body.avatar || '').trim() || null;

    const usernameError = validateUsername(username);
    if (usernameError) return res.status(400).json({ error: usernameError });

    try {
        if (username.toLowerCase() !== decoded.username.toLowerCase()) {
            const existing = await findUserByUsername(username);
            if (existing && existing.id !== decoded.uid) {
                return res.status(409).json({ error: 'Такой ник уже занят' });
            }
        }

        const result = await pool.query(
            `UPDATE users SET username = $1, avatar = COALESCE($2, avatar) WHERE id = $3 RETURNING id, username, avatar`,
            [username, avatar, decoded.uid]
        );
        const user = result.rows[0];
        if (!user) return res.status(404).json({ error: 'Аккаунт не найден' });

        // Ник мог измениться — перевыпускаем токен с актуальным username.
        res.json({ token: signToken(user), username: user.username, avatar: user.avatar });
    } catch (err) {
        console.error('❌ Ошибка обновления профиля:', err);
        res.status(500).json({ error: 'Не удалось сохранить профиль' });
    }
});

const rooms = {}; // Голосовые комнаты: { internalRoomId: { socketId: {...} } }
// Пользовательские серверы/комнаты кэшируются в памяти для быстрых проверок,
// но источник истины — Neon Postgres. Поэтому они переживают рестарты Render.
const customRooms = {}; // { code: { code, name, passwordHash, createdAt } }

function generateRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(0, alphabet.length)];
    return code;
}

async function loadCustomRooms() {
    const result = await pool.query(
        `SELECT code, name, password_hash, avatar, owner_username, admin_usernames, created_at FROM custom_rooms ORDER BY created_at ASC`
    );
    for (const row of result.rows) {
        customRooms[row.code] = {
            code: row.code,
            name: row.name,
            passwordHash: row.password_hash,
            avatar: row.avatar || '',
            ownerUsername: row.owner_username || null,
            adminUsernames: row.admin_usernames || [],
            createdAt: Number(row.created_at)
        };
    }
    console.log(`📦 Загружено пользовательских серверов из Neon: ${result.rows.length}`);
}

// ---------- Роли участников сервера: владелец / модератор ("повышенный") / обычный ----------
function isRoomOwner(room, username) {
    return !!(room && room.ownerUsername && username &&
        room.ownerUsername.toLowerCase() === username.toLowerCase());
}
function isRoomAdmin(room, username) {
    if (!room || !username || !Array.isArray(room.adminUsernames)) return false;
    const lower = username.toLowerCase();
    return room.adminUsernames.some(u => String(u).toLowerCase() === lower);
}
// Может выгонять/повышать: владелец сервера или тот, кого он (или другой модератор) повысил.
function canModerateRoom(room, username) {
    return isRoomOwner(room, username) || isRoomAdmin(room, username);
}

// Записывает человека в постоянный список участников сервера (при создании и при
// каждом входе по коду) — если он там уже есть, просто обновляет сохранённый аватар.
async function addRoomMember(code, username, avatar) {
    if (!code || !username) return;
    try {
        await pool.query(
            `INSERT INTO custom_room_members (code, username, avatar, joined_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (code, LOWER(username))
             DO UPDATE SET avatar = COALESCE(EXCLUDED.avatar, custom_room_members.avatar)`,
            [code, username, avatar || null, Date.now()]
        );
    } catch (err) {
        console.error('❌ Ошибка сохранения участника сервера:', err);
    }
}

async function removeRoomMember(code, username) {
    if (!code || !username) return;
    try {
        await pool.query(
            `DELETE FROM custom_room_members WHERE code = $1 AND LOWER(username) = LOWER($2)`,
            [code, username]
        );
    } catch (err) {
        console.error('❌ Ошибка удаления участника сервера:', err);
    }
}

// Публичные поля сервера для списка иконок — хеш пароля и владелец (username)
// в общую рассылку никогда не уходят.
function publicCustomRoom(room) {
    return {
        code: room.code,
        name: room.name,
        avatar: room.avatar || '',
        hasPassword: !!room.passwordHash
    };
}

// То же самое, но персонально под конкретный сокет — с флагом "это ваш сервер",
// который решает, что показывать в окне сервера (редактирование или просмотр кода).
function customRoomInfoFor(room, socket) {
    const viewerUsername = socket && socket.data && socket.data.username;
    const isOwner = isRoomOwner(room, viewerUsername);
    const isAdmin = isRoomAdmin(room, viewerUsername);
    return { ...publicCustomRoom(room), isOwner, isAdmin, canModerate: isOwner || isAdmin };
}

// Проверка ника из БД (findUserByUsername) ловит только совпадение с ЗАРЕГИСТРИРОВАННЫМ
// (защищённым паролем) аккаунтом. Она НЕ ловит случай, когда два гостя (без пароля)
// подключаются одновременно с одинаковым/дефолтным ником ("Гость" и т.п.) — тогда оба
// реально получают socket.data.username = 'Гость' без каких-либо изменений, и в списке
// комнаты они выглядят абсолютно одинаково — со стороны кажется, будто кто-то "забрал"
// чужой ник, хотя на самом деле сервер просто никогда не сверял ники между уже
// подключёнными сокетами. Эта функция проверяет живую занятость ника среди ВСЕХ сейчас
// подключённых сокетов (не только в одной комнате — чат общий на все комнаты).
function isUsernameActiveElsewhere(username, excludeSocketId) {
    const lower = username.toLowerCase();
    for (const [id, s] of io.sockets.sockets) {
        if (id === excludeSocketId) continue;
        if (s.data && typeof s.data.username === 'string' && s.data.username.toLowerCase() === lower) {
            return true;
        }
    }
    return false;
}

// Подбирает свободный (не занятый ни в БД зарегистрированным аккаунтом, ни живым
// сокетом прямо сейчас) вариант ника на основе requested, добавляя случайный суффикс.
async function resolveFreeGuestUsername(requested, excludeSocketId) {
    let candidate = requested;
    for (let attempt = 0; attempt < 5; attempt++) {
        const owner = await findUserByUsername(candidate);
        const takenByAccount = !!(owner && owner.password_hash);
        const takenLive = isUsernameActiveElsewhere(candidate, excludeSocketId);
        if (!takenByAccount && !takenLive) {
            return { username: candidate, changed: candidate !== requested };
        }
        const suffix = String(Math.floor(1000 + Math.random() * 9000));
        candidate = `${requested}_${suffix}`.slice(0, USERNAME_MAX);
    }
    return { username: candidate, changed: true };
}

io.on('connection', (socket) => {
    let currentUserRoom = null;
    let currentUserData = null;
    let currentChatRoom = null; // какой сервер сейчас открыт в чате у этого сокета

    // Чат теперь свой для каждого сервера — история грузится только когда клиент
    // говорит, какую комнату он открыл (см. 'select chat room' ниже).
    socket.on('select chat room', async ({ room } = {}) => {
        const cleanRoom = String(room || '').trim().slice(0, 80);
        if (!cleanRoom) return;

        const previousChatRoom = currentChatRoom;
        if (currentChatRoom) socket.leave(`chat:${currentChatRoom}`);
        currentChatRoom = cleanRoom;
        socket.join(`chat:${cleanRoom}`);

        try {
            const history = await getRecentMessages(cleanRoom);
            socket.emit('chat history', { room: cleanRoom, messages: history });
        } catch (err) {
            console.error('❌ Ошибка чтения истории чата:', err);
        }

        // Список участников сервера зависит от того, кто реально сейчас его открыл —
        // оповещаем и новую комнату (кто-то зашёл), и предыдущую (кто-то вышел/переключился
        // на другой сервер), чтобы у всех, кто держит открытой вкладку "Участники",
        // список обновился сам, без повторного клика по вкладке.
        broadcastServerMembers(cleanRoom);
        if (previousChatRoom && previousChatRoom !== cleanRoom) broadcastServerMembers(previousChatRoom);
    });

    // ---------- Пользовательские серверы ----------
    // В общий список сервера больше не отдаются — только по конкретным кодам,
    // которые клиент уже знает (создал сам или когда-то вошёл по коду).
    socket.on('get my custom rooms', ({ codes } = {}) => {
        const cleanCodes = Array.isArray(codes)
            ? [...new Set(codes.map(c => String(c || '').trim().toUpperCase()).filter(Boolean))].slice(0, 200)
            : [];
        if (cleanCodes.length === 0) return socket.emit('custom rooms list', []);

        const found = cleanCodes
            .map(code => customRooms[code])
            .filter(Boolean)
            .map(room => publicCustomRoom(room));
        socket.emit('custom rooms list', found);
    });

    socket.on('create custom room', async ({ name, password, avatar }) => {
        const cleanName = String(name || '').trim().slice(0, 40);
        const cleanPassword = String(password || '');
        const cleanAvatar = String(avatar || '').trim().slice(0, 2000) || null;
        if (cleanName.length < 2) {
            return socket.emit('custom room error', 'Название сервера должно содержать минимум 2 символа.');
        }
        if (cleanPassword.length > 64) {
            return socket.emit('custom room error', 'Пароль слишком длинный.');
        }

        // Создателя запоминаем по нику из проверенной сессии (register user), чтобы потом
        // отличать владельца от остальных — именно от этого зависит, что покажет окно сервера.
        const ownerUsername = (socket.data && socket.data.username) || null;

        try {
            const passwordHash = cleanPassword ? await bcrypt.hash(cleanPassword, 10) : null;
            let room = null;

            // Код генерируется заново при конфликте. Уникальность дополнительно
            // гарантирует PRIMARY KEY в Neon, поэтому два одновременных создания
            // не смогут записать один и тот же код.
            for (let attempt = 0; attempt < 10; attempt++) {
                const code = generateRoomCode();
                try {
                    const result = await pool.query(
                        `INSERT INTO custom_rooms (code, name, password_hash, avatar, owner_username, created_at)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         RETURNING code, name, password_hash, avatar, owner_username, admin_usernames, created_at`,
                        [code, cleanName, passwordHash, cleanAvatar, ownerUsername, Date.now()]
                    );
                    const row = result.rows[0];
                    room = {
                        code: row.code,
                        name: row.name,
                        passwordHash: row.password_hash,
                        avatar: row.avatar || '',
                        ownerUsername: row.owner_username || null,
                        adminUsernames: row.admin_usernames || [],
                        createdAt: Number(row.created_at)
                    };
                    break;
                } catch (dbErr) {
                    if (dbErr.code !== '23505') throw dbErr;
                }
            }

            if (!room) throw new Error('Не удалось подобрать уникальный код сервера');
            customRooms[room.code] = room;
            if (ownerUsername) {
                await addRoomMember(room.code, ownerUsername, socket.data && socket.data.avatar);
            }
            // Только создателю — остальные о новом сервере ничего не узнают, пока
            // сами не войдут по коду.
            socket.emit('custom room created', customRoomInfoFor(room, socket));
        } catch (err) {
            console.error('❌ Ошибка создания пользовательского сервера:', err);
            socket.emit('custom room error', 'Не удалось создать сервер.');
        }
    });

    socket.on('join custom room', async ({ code, password }) => {
        const cleanCode = String(code || '').trim().toUpperCase();
        const cleanPassword = String(password || '');
        const custom = customRooms[cleanCode];
        if (!custom) return socket.emit('custom room error', 'Сервер с таким кодом не найден.');

        try {
            const isOwner = !!(custom.ownerUsername && socket.data && socket.data.username &&
                custom.ownerUsername.toLowerCase() === socket.data.username.toLowerCase());
            // Владельцу пароль на вход в свой же сервер спрашивать незачем.
            if (custom.passwordHash && !isOwner) {
                const ok = await bcrypt.compare(cleanPassword, custom.passwordHash);
                if (!ok) return socket.emit('custom room error', 'Неверный пароль.');
            }
            if (socket.data && socket.data.username) {
                await addRoomMember(cleanCode, socket.data.username, socket.data.avatar);
            }
            socket.emit('custom room joined', customRoomInfoFor(custom, socket));
        } catch (err) {
            console.error('❌ Ошибка входа в пользовательский сервер:', err);
            socket.emit('custom room error', 'Не удалось войти на сервер.');
        }
    });

    // Окно сервера: отдаём владельцу редактируемые поля, остальным — только код/имя/аватар.
    socket.on('get custom room info', ({ code }) => {
        const cleanCode = String(code || '').trim().toUpperCase();
        const custom = customRooms[cleanCode];
        if (!custom) return socket.emit('custom room error', 'Сервер с таким кодом не найден.');
        socket.emit('custom room info', customRoomInfoFor(custom, socket));
    });

    // Изменение сервера доступно только владельцу — сверяем это по нику из проверенной сессии.
    socket.on('update custom room', async ({ code, name, password, avatar, removePassword }) => {
        const cleanCode = String(code || '').trim().toUpperCase();
        const custom = customRooms[cleanCode];
        if (!custom) return socket.emit('custom room error', 'Сервер с таким кодом не найден.');

        const viewerUsername = socket.data && socket.data.username;
        const isOwner = !!(custom.ownerUsername && viewerUsername &&
            custom.ownerUsername.toLowerCase() === viewerUsername.toLowerCase());
        if (!isOwner) return socket.emit('custom room error', 'Изменять может только создатель сервера.');

        const cleanName = String(name || '').trim().slice(0, 40);
        const cleanPassword = String(password || '');
        const cleanAvatar = String(avatar || '').trim().slice(0, 2000) || null;
        if (cleanName.length < 2) {
            return socket.emit('custom room error', 'Название сервера должно содержать минимум 2 символа.');
        }
        if (cleanPassword.length > 64) {
            return socket.emit('custom room error', 'Пароль слишком длинный.');
        }

        try {
            let newPasswordHash = custom.passwordHash;
            if (removePassword) {
                newPasswordHash = null;
            } else if (cleanPassword) {
                newPasswordHash = await bcrypt.hash(cleanPassword, 10);
            }

            const result = await pool.query(
                `UPDATE custom_rooms SET name = $1, avatar = $2, password_hash = $3
                 WHERE code = $4
                 RETURNING code, name, password_hash, avatar, owner_username, admin_usernames, created_at`,
                [cleanName, cleanAvatar, newPasswordHash, cleanCode]
            );
            const row = result.rows[0];
            if (!row) return socket.emit('custom room error', 'Сервер с таким кодом не найден.');

            const updated = {
                code: row.code,
                name: row.name,
                passwordHash: row.password_hash,
                avatar: row.avatar || '',
                ownerUsername: row.owner_username || null,
                adminUsernames: row.admin_usernames || [],
                createdAt: Number(row.created_at)
            };
            customRooms[updated.code] = updated;

            io.emit('custom room updated', publicCustomRoom(updated));
            socket.emit('custom room info', customRoomInfoFor(updated, socket));
        } catch (err) {
            console.error('❌ Ошибка обновления пользовательского сервера:', err);
            socket.emit('custom room error', 'Не удалось сохранить изменения.');
        }
    });

    // Удаление сервера — доступно только владельцу. Удаляем из Neon и из памяти,
    // затем оповещаем всех — у кого сервер был в списке, тот его у себя уберёт
    // (см. клиентский обработчик 'custom room deleted').
    socket.on('delete custom room', async ({ code }) => {
        const cleanCode = String(code || '').trim().toUpperCase();
        const custom = customRooms[cleanCode];
        if (!custom) return socket.emit('custom room error', 'Сервер с таким кодом не найден.');

        const viewerUsername = socket.data && socket.data.username;
        const isOwner = !!(custom.ownerUsername && viewerUsername &&
            custom.ownerUsername.toLowerCase() === viewerUsername.toLowerCase());
        if (!isOwner) return socket.emit('custom room error', 'Удалить сервер может только его создатель.');

        try {
            await pool.query(`DELETE FROM custom_rooms WHERE code = $1`, [cleanCode]);
            delete customRooms[cleanCode];
            io.emit('custom room deleted', { code: cleanCode });
        } catch (err) {
            console.error('❌ Ошибка удаления пользовательского сервера:', err);
            socket.emit('custom room error', 'Не удалось удалить сервер.');
        }
    });

    // ---------- Участники сервера: список ВСЕХ, кто когда-либо входил (не только тех,
    // кто сейчас в голосовом канале или в чате), кик, повышение/понижение ----------
    // Источник списка — таблица custom_room_members (постоянная, переживает рестарты).
    // "Онлайн" считается тот, у кого сейчас открыт чат этого сервера (комната
    // `chat:${code}`, см. 'select chat room') — это просто пометка в UI, на сам факт
    // присутствия в списке участников она не влияет.
    async function getServerMembers(code) {
        const custom = customRooms[code];
        const chatRoomName = `chat:${code}`;

        const onlineUsernames = new Set();
        const onlineAvatars = new Map();
        for (const [, sock] of io.sockets.sockets) {
            if (!sock.rooms || !sock.rooms.has(chatRoomName)) continue;
            const uname = sock.data && sock.data.username;
            if (!uname) continue;
            const lower = uname.toLowerCase();
            onlineUsernames.add(lower);
            if (!onlineAvatars.has(lower)) onlineAvatars.set(lower, (sock.data && sock.data.avatar) || '');
        }

        let rows = [];
        try {
            const result = await pool.query(
                `SELECT username, avatar FROM custom_room_members WHERE code = $1 ORDER BY joined_at ASC`,
                [code]
            );
            rows = result.rows;
        } catch (err) {
            console.error('❌ Ошибка чтения участников сервера:', err);
        }

        const known = new Map(rows.map(r => [r.username.toLowerCase(), { username: r.username, avatar: r.avatar || '' }]));

        // Подстраховка для серверов/участников, созданных до появления этой таблицы —
        // если человек сейчас онлайн, но в БД его почему-то нет, дописываем его туда
        // (не блокируя ответ) и всё равно показываем в списке сразу.
        for (const [, sock] of io.sockets.sockets) {
            if (!sock.rooms || !sock.rooms.has(chatRoomName)) continue;
            const uname = sock.data && sock.data.username;
            if (!uname) continue;
            const lower = uname.toLowerCase();
            if (!known.has(lower)) {
                known.set(lower, { username: uname, avatar: (sock.data && sock.data.avatar) || '' });
                addRoomMember(code, uname, sock.data && sock.data.avatar);
            }
        }
        if (custom && custom.ownerUsername && !known.has(custom.ownerUsername.toLowerCase())) {
            known.set(custom.ownerUsername.toLowerCase(), { username: custom.ownerUsername, avatar: '' });
            addRoomMember(code, custom.ownerUsername, null);
        }

        return [...known.entries()]
            .map(([lower, m]) => ({
                username: m.username,
                avatar: onlineAvatars.get(lower) || m.avatar || '',
                isOwner: isRoomOwner(custom, m.username),
                isAdmin: isRoomAdmin(custom, m.username),
                online: onlineUsernames.has(lower)
            }))
            .sort((a, b) => {
                if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
                if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
                if (a.online !== b.online) return a.online ? -1 : 1;
                return a.username.localeCompare(b.username, 'ru');
            });
    }

    // Список участников теперь виден всем, кто открыл сервер (не только создателю и
    // модераторам) — кнопки "Выгнать"/"Повысить" всё равно показываются только тем,
    // у кого есть на это права (это уже проверяется отдельно в соответствующих
    // обработчиках ниже и скрывается в интерфейсе клиента).
    socket.on('get server members', async ({ code } = {}) => {
        const cleanCode = String(code || '').trim().toUpperCase();
        const custom = customRooms[cleanCode];
        if (!custom) return socket.emit('custom room error', 'Сервер с таким кодом не найден.');
        socket.emit('server members list', { code: cleanCode, members: await getServerMembers(cleanCode) });
    });

    // Рассылает актуальный список участников всем, у кого сейчас открыт чат этого
    // сервера — вызывается при входе/выходе, кике и смене ролей, чтобы вкладка
    // "Участники" обновлялась сама, пока открыта, а не только по клику на неё.
    async function broadcastServerMembers(code) {
        if (!code || !customRooms[code]) return;
        io.to(`chat:${code}`).emit('server members list', { code, members: await getServerMembers(code) });
    }

    // Кик: доступен владельцу (может выгнать любого, кроме себя) и модераторам
    // (могут выгонять только обычных участников — не владельца и не других модераторов).
    // Кик убирает человека и из постоянного списка участников — при желании он
    // сможет зайти обратно по коду сервера, и тогда появится в списке заново.
    socket.on('kick server member', async ({ code, username } = {}) => {
        const cleanCode = String(code || '').trim().toUpperCase();
        const targetUsername = String(username || '').trim();
        const custom = customRooms[cleanCode];
        if (!custom) return socket.emit('custom room error', 'Сервер с таким кодом не найден.');
        if (!targetUsername) return;

        const actorUsername = socket.data && socket.data.username;
        if (!canModerateRoom(custom, actorUsername)) {
            return socket.emit('custom room error', 'Исключать участников может только создатель или модератор сервера.');
        }
        if (actorUsername && targetUsername.toLowerCase() === actorUsername.toLowerCase()) {
            return socket.emit('custom room error', 'Нельзя исключить самого себя.');
        }
        if (isRoomOwner(custom, targetUsername)) {
            return socket.emit('custom room error', 'Нельзя исключить создателя сервера.');
        }
        if (isRoomAdmin(custom, targetUsername) && !isRoomOwner(custom, actorUsername)) {
            return socket.emit('custom room error', 'Только создатель сервера может исключить модератора.');
        }

        const chatRoomName = `chat:${cleanCode}`;
        let kickedAny = false;
        for (const [, sock] of io.sockets.sockets) {
            const uname = sock.data && sock.data.username;
            if (!uname || uname.toLowerCase() !== targetUsername.toLowerCase()) continue;
            if (!sock.rooms || !sock.rooms.has(chatRoomName)) continue;
            kickedAny = true;

            sock.leave(chatRoomName);

            // Если тот же человек сидит и в голосовом канале этого сервера — выкидываем и оттуда.
            if (rooms[cleanCode] && rooms[cleanCode][sock.id]) {
                const peerId = rooms[cleanCode][sock.id].peerId;
                delete rooms[cleanCode][sock.id];
                sock.leave(cleanCode);
                if (peerId) io.to(cleanCode).emit('user disconnected', peerId);
                if (Object.keys(rooms[cleanCode]).length === 0) {
                    delete rooms[cleanCode];
                }
                broadcastRoomUsers(cleanCode);
            }

            sock.emit('kicked from server', { code: cleanCode, name: custom.name });
        }

        // Убираем из постоянного списка участников независимо от того, был ли человек
        // онлайн в момент кика — иначе он остался бы висеть в списке до следующего входа.
        await removeRoomMember(cleanCode, targetUsername);
        await broadcastServerMembers(cleanCode);
    });

    // Повышение до модератора — доступно владельцу и уже назначенным модераторам.
    // Понижение (снятие прав) — только владельцу, иначе модераторы могли бы разжаловать друг друга.
    socket.on('set server admin', async ({ code, username, makeAdmin } = {}) => {
        const cleanCode = String(code || '').trim().toUpperCase();
        const targetUsername = String(username || '').trim();
        const custom = customRooms[cleanCode];
        if (!custom) return socket.emit('custom room error', 'Сервер с таким кодом не найден.');
        if (!targetUsername) return;

        const actorUsername = socket.data && socket.data.username;
        const wantMakeAdmin = !!makeAdmin;

        if (isRoomOwner(custom, targetUsername)) {
            return socket.emit('custom room error', 'Создатель сервера уже обладает всеми правами.');
        }
        if (wantMakeAdmin && !canModerateRoom(custom, actorUsername)) {
            return socket.emit('custom room error', 'Повышать участников может только создатель или модератор сервера.');
        }
        if (!wantMakeAdmin && !isRoomOwner(custom, actorUsername)) {
            return socket.emit('custom room error', 'Снять права модератора может только создатель сервера.');
        }

        const current = Array.isArray(custom.adminUsernames) ? custom.adminUsernames.slice() : [];
        const lower = targetUsername.toLowerCase();
        const next = wantMakeAdmin
            ? (current.some(u => u.toLowerCase() === lower) ? current : [...current, targetUsername])
            : current.filter(u => u.toLowerCase() !== lower);

        custom.adminUsernames = next; // обновляем кэш сразу, не дожидаясь ответа БД

        pool.query(`UPDATE custom_rooms SET admin_usernames = $1 WHERE code = $2`, [next, cleanCode])
            .catch(err => console.error('❌ Ошибка сохранения списка модераторов сервера:', err));

        await broadcastServerMembers(cleanCode);
    });

    // Ник закреплён за зарегистрированным аккаунтом (пароль) только когда
    // валидным JWT-токеном подтверждено, что это действительно его владелец. Без токена
    // взять чужой занятый ник нельзя — сервер сам подставит свободный вариант с суффиксом.
    // Помимо занятых аккаунтов, также проверяем, не сидит ли прямо сейчас под этим же
    // ником другой гость (см. isUsernameActiveElsewhere) — иначе два человека без
    // аккаунта могут одновременно оказаться под одинаковым именем.
    socket.on('register user', async (userData, ack) => {
        const requested = ((userData && userData.username) || '').trim() || 'Гость';
        let username = requested;
        const avatar = (userData && userData.avatar) || '';
        const token = userData && userData.token;

        try {
            if (token) {
                const decoded = verifyToken(token);
                if (decoded && decoded.username) {
                    username = decoded.username; // сервер — источник истины по нику владельца аккаунта
                }
            } else {
                const resolved = await resolveFreeGuestUsername(requested, socket.id);
                username = resolved.username;
                if (resolved.changed) {
                    socket.emit('username protected', { requested, assignedUsername: username });
                }
            }
        } catch (err) {
            console.error('❌ Ошибка проверки ника при регистрации сокета:', err);
        }

        socket.data = { username, avatar, peerId: userData && userData.peerId };

        // Клиент при переподключении ждёт подтверждения, прежде чем заново входить в канал —
        // иначе 'join room' может обработаться раньше, чем сокет получит ник, и человек
        // появится у остальных как «Участник».
        if (typeof ack === 'function') ack();
    });

    socket.on('update profile', async ({ username, avatar, token }) => {
        if (!socket.data) return;

        if (typeof avatar === 'string' && avatar.trim()) {
            socket.data.avatar = avatar.trim();
        }

        if (typeof username === 'string' && username.trim()) {
            const requested = username.trim();
            let finalUsername = requested;

            try {
                if (token) {
                    const decoded = verifyToken(token);
                    if (decoded && decoded.username) {
                        finalUsername = decoded.username;
                    }
                } else if (requested.toLowerCase() !== socket.data.username.toLowerCase()) {
                    const owner = await findUserByUsername(requested);
                    const takenLive = isUsernameActiveElsewhere(requested, socket.id);
                    if ((owner && owner.password_hash) || takenLive) {
                        socket.emit('username protected', { requested, assignedUsername: socket.data.username });
                        finalUsername = socket.data.username; // оставляем прежний ник, чужой не отдаём
                    }
                }
            } catch (err) {
                console.error('❌ Ошибка проверки ника при обновлении профиля:', err);
            }

            socket.data.username = finalUsername;
        }

        if (currentUserRoom && rooms[currentUserRoom] && rooms[currentUserRoom][socket.id]) {
            rooms[currentUserRoom][socket.id].username = socket.data.username;
            rooms[currentUserRoom][socket.id].avatar = socket.data.avatar;
            broadcastRoomUsers(currentUserRoom);
        }
    });

    // Кто-то заходит в голосовой канал. Мьют/дефен передаём сразу тем же событием
    // (а не отдельным 'mute state' сразу следом) — раньше это было гонкой: сервер
    // сначала создавал запись с micMuted/deafened=false и рассылал её всем, и только
    // через мгновение прилетало отдельное 'mute state' с реальным значением. Из-за
    // этого при повторном заходе в канал (особенно если 'mute state' почему-то не
    // доходил или обрабатывался с задержкой) у остальных участников значок мьюта
    // мог не появиться вовсе. Теперь состояние приходит атомарно, одним событием.
    socket.on('join room', ({ room, peerId, micMuted, deafened }) => {
        currentUserRoom = room;
        socket.join(room);

        if (!rooms[room]) {
            rooms[room] = {};
        }

        rooms[room][socket.id] = {
            username: socket.data?.username || 'Участник',
            avatar: socket.data?.avatar || '',
            peerId: peerId,
            sharing: false,
            micMuted: !!micMuted,
            deafened: !!deafened
        };

        currentUserData = rooms[room][socket.id];

        // Оповещаем всех в комнате о новом участнике
        broadcastRoomUsers(room);
        socket.to(room).emit('user connected', {
            username: currentUserData.username,
            avatar: currentUserData.avatar,
            peerId: peerId
        });
    });

    socket.on('get room users', (room) => {
        socket.emit('room users', getRoomUsers(room), room);
    });

    socket.on('leave voice', () => {
        leaveCurrentRoom(socket);
    });

    socket.on('video state', ({ sharing }) => {
        if (currentUserRoom && rooms[currentUserRoom] && rooms[currentUserRoom][socket.id]) {
            rooms[currentUserRoom][socket.id].sharing = !!sharing;
            broadcastRoomUsersToWatchers(currentUserRoom);
        }
        if (currentUserRoom && socket.data && socket.data.peerId) {
            socket.to(currentUserRoom).emit('video state', {
                peerId: socket.data.peerId,
                sharing: !!sharing
            });
        }
    });

    // Кто-то включил/выключил мьют или дефен — сохраняем его статус в комнате
    // и рассылаем остальным участникам, чтобы у них обновился значок.
    socket.on('mute state', ({ micMuted, deafened }) => {
        if (currentUserRoom && rooms[currentUserRoom] && rooms[currentUserRoom][socket.id]) {
            rooms[currentUserRoom][socket.id].micMuted = !!micMuted;
            rooms[currentUserRoom][socket.id].deafened = !!deafened;
            broadcastRoomUsersToWatchers(currentUserRoom);
        }
        if (currentUserRoom && socket.data && socket.data.peerId) {
            socket.to(currentUserRoom).emit('mute state', {
                peerId: socket.data.peerId,
                micMuted: !!micMuted,
                deafened: !!deafened
            });
        }
    });

    socket.on('disconnect', () => {
        leaveCurrentRoom(socket);
        // К моменту 'disconnect' сокет уже вышел из всех комнат (socket.io чистит их
        // сам перед этим событием), поэтому getServerMembers внутри уже не посчитает
        // отключившегося как онлайн — рассылаем обновление тем, кто остался.
        if (currentChatRoom) broadcastServerMembers(currentChatRoom);
    });

    socket.on('chat message', async (payload) => {
        if (!socket.data) return;
        if (!currentChatRoom) return; // не в чате ни одной комнаты — отправлять некуда

        const text = typeof payload === 'string' ? payload : (payload && payload.text) || '';
        const imageUrl = (payload && payload.imageUrl) || null;

        if (!text.trim() && !imageUrl) return;

        const username = socket.data.username || 'Участник';
        const avatar = socket.data.avatar || '';
        const createdAt = Date.now();
        const room = currentChatRoom;

        try {
            const id = await insertMessage({ username, avatar, text: text.trim(), imageUrl, room, createdAt });

            // Рассылаем только тем, у кого сейчас открыт этот же сервер в чате.
            io.to(`chat:${room}`).emit('chat message', {
                id,
                username,
                avatar,
                text: text.trim(),
                image_url: imageUrl,
                room,
                created_at: createdAt
            });
        } catch (err) {
            console.error('❌ Ошибка сохранения сообщения:', err);
        }
    });

    function leaveCurrentRoom(sock) {
        if (currentUserRoom && rooms[currentUserRoom]) {
            delete rooms[currentUserRoom][sock.id];
            sock.leave(currentUserRoom);

            if (sock.data && sock.data.peerId) {
                io.to(currentUserRoom).emit('user disconnected', sock.data.peerId);
            }

            if (Object.keys(rooms[currentUserRoom]).length === 0) {
                delete rooms[currentUserRoom];
            }
            // Шлём и когда канал опустел — наблюдатели должны увидеть пустой список.
            broadcastRoomUsers(currentUserRoom);
            currentUserRoom = null;
        }
    }
});

// Актуальный список участников голосового канала получают:
//  1) те, кто сейчас В канале (socket.io-комната `room`);
//  2) те, кто просто СМОТРИТ этот сервер (комната `chat:${room}`), но не в голосе.
// Раньше наблюдатели (открыт сервер, но нет в звонке) не получали ничего и видели
// список только на момент клика. Push от сервера — без опроса, нагрузки почти нет.
function broadcastRoomUsers(room) {
    const users = getRoomUsers(room);
    io.to(room).emit('room users', users, room);
    io.to(`chat:${room}`).except(room).emit('room users', users, room);
}

// Только наблюдателям (для мьюта/демки: участники канала получают свои события отдельно).
function broadcastRoomUsersToWatchers(room) {
    io.to(`chat:${room}`).except(room).emit('room users', getRoomUsers(room), room);
}

function getRoomUsers(room) {
    if (!rooms[room]) return {};
    const usersMap = {};
    for (let sId in rooms[room]) {
        let u = rooms[room][sId];
        if (u.peerId) {
            usersMap[u.peerId] = {
                username: u.username,
                avatar: u.avatar,
                sharing: !!u.sharing,
                micMuted: !!u.micMuted,
                deafened: !!u.deafened
            };
        }
    }
    return usersMap;
}

const PORT = process.env.PORT || 3000;

initDb()
    .then(async () => {
        await loadCustomRooms();
        server.listen(PORT, () => {
            console.log(`Сервер запущен на порту ${PORT}`);
        });
    })
    .catch(err => {
        console.error('❌ Не удалось инициализировать базу данных:', err.message);
        if (err.code === 'ERR_INVALID_URL') {
            console.error(
                '👉 DATABASE_URL не распознаётся как корректный URL. Скопируйте свежую строку целиком ' +
                'из Neon (кнопка "Connect" -> иконка копирования), не набирайте и не редактируйте вручную — ' +
                'в пароле могут быть спецсимволы, которые нужно правильно экранировать.'
            );
        }
        process.exit(1);
    });
