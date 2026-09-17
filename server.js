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
            room_code TEXT,
            username TEXT NOT NULL,
            avatar TEXT,
            text TEXT,
            image_url TEXT,
            created_at BIGINT NOT NULL
        );
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS room_code TEXT;
    `);

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

    await pool.query(`
        CREATE TABLE IF NOT EXISTS rooms (
            id SERIAL PRIMARY KEY,
            code VARCHAR(12) UNIQUE NOT NULL,
            name VARCHAR(50) NOT NULL,
            password_hash TEXT,
            image_url TEXT,
            owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at BIGINT NOT NULL
        );
    `);
}

async function insertMessage({ roomCode, username, avatar, text, imageUrl, createdAt }) {
    const result = await pool.query(
        `INSERT INTO messages (room_code, username, avatar, text, image_url, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [roomCode, username, avatar, text, imageUrl, createdAt]
    );
    return result.rows[0].id;
}

async function getRecentMessages(roomCode, limit = 100) {
    const result = await pool.query(
        `SELECT * FROM messages WHERE room_code = $1 ORDER BY id DESC LIMIT $2`,
        [roomCode, limit]
    );
    return result.rows.reverse();
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
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 МБ
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

// ---------- Комнаты ----------
const ROOM_NAME_MAX = 50;
const ROOM_PASSWORD_MAX = 72;
const CHAT_TEXT_MAX = 200;
const ROOM_CODE_LENGTH = 8;

function getAuthUser(req) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const decoded = token && verifyToken(token);
    return decoded || null;
}

function cleanRoom(room) {
    return {
        code: room.code,
        name: room.name,
        image_url: room.image_url || '',
        has_password: !!room.password_hash,
        owner_id: room.owner_id
    };
}

async function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (;;) {
        let code = '';
        for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += chars[crypto.randomInt(chars.length)];
        const exists = await pool.query('SELECT 1 FROM rooms WHERE code = $1', [code]);
        if (!exists.rowCount) return code;
    }
}

app.get('/rooms', async (req, res) => {
    try {
        const result = await pool.query('SELECT code, name, image_url, password_hash, owner_id FROM rooms ORDER BY id ASC');
        res.json(result.rows.map(cleanRoom));
    } catch (err) {
        console.error('❌ Ошибка списка комнат:', err);
        res.status(500).json({ error: 'Не удалось получить комнаты' });
    }
});

app.post('/rooms', async (req, res) => {
    const auth = getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Для создания комнаты войдите в аккаунт' });
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    const imageUrl = String(req.body?.imageUrl || '').trim() || null;
    if (!name) return res.status(400).json({ error: 'Введите название комнаты' });
    if (name.length > ROOM_NAME_MAX) return res.status(400).json({ error: `Название — максимум ${ROOM_NAME_MAX} символов` });
    if (password.length > ROOM_PASSWORD_MAX) return res.status(400).json({ error: `Пароль — максимум ${ROOM_PASSWORD_MAX} символов` });
    try {
        const code = await generateRoomCode();
        const hash = password ? await bcrypt.hash(password, 10) : null;
        const result = await pool.query(
            `INSERT INTO rooms (code, name, password_hash, image_url, owner_id, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING code,name,image_url,password_hash,owner_id`,
            [code, name, hash, imageUrl, auth.uid, Date.now()]
        );
        res.json(cleanRoom(result.rows[0]));
    } catch (err) {
        console.error('❌ Ошибка создания комнаты:', err);
        res.status(500).json({ error: 'Не удалось создать комнату' });
    }
});

app.put('/rooms/:code', async (req, res) => {
    const auth = getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Не авторизован' });
    const code = String(req.params.code || '').toUpperCase();
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    const imageUrl = String(req.body?.imageUrl || '').trim() || null;
    if (!name) return res.status(400).json({ error: 'Введите название комнаты' });
    if (name.length > ROOM_NAME_MAX) return res.status(400).json({ error: `Название — максимум ${ROOM_NAME_MAX} символов` });
    if (password.length > ROOM_PASSWORD_MAX) return res.status(400).json({ error: `Пароль — максимум ${ROOM_PASSWORD_MAX} символов` });
    try {
        const found = await pool.query('SELECT * FROM rooms WHERE code = $1', [code]);
        const room = found.rows[0];
        if (!room) return res.status(404).json({ error: 'Комната не найдена' });
        if (room.owner_id !== auth.uid) return res.status(403).json({ error: 'Настраивать комнату может только её создатель' });
        const hash = password ? await bcrypt.hash(password, 10) : null;
        const result = await pool.query(
            `UPDATE rooms SET name=$1, password_hash=$2, image_url=$3 WHERE code=$4 RETURNING code,name,image_url,password_hash,owner_id`,
            [name, hash, imageUrl, code]
        );
        res.json(cleanRoom(result.rows[0]));
    } catch (err) {
        console.error('❌ Ошибка изменения комнаты:', err);
        res.status(500).json({ error: 'Не удалось изменить комнату' });
    }
});

app.delete('/rooms/:code', async (req, res) => {
    const auth = getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Не авторизован' });
    const code = String(req.params.code || '').toUpperCase();
    try {
        const found = await pool.query('SELECT owner_id FROM rooms WHERE code = $1', [code]);
        if (!found.rowCount) return res.status(404).json({ error: 'Комната не найдена' });
        if (found.rows[0].owner_id !== auth.uid) return res.status(403).json({ error: 'Удалить комнату может только её создатель' });
        await pool.query('DELETE FROM messages WHERE room_code = $1', [code]);
        await pool.query('DELETE FROM rooms WHERE code = $1', [code]);
        io.to(code).emit('room deleted', { code });
        res.json({ ok: true });
    } catch (err) {
        console.error('❌ Ошибка удаления комнаты:', err);
        res.status(500).json({ error: 'Не удалось удалить комнату' });
    }
});

const rooms = {}; // Онлайн-участники голосовых каналов по уникальному коду комнаты

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
    let currentChatRoom = null;
    const authorizedRooms = new Set();

    // Ник закреплён за зарегистрированным аккаунтом (пароль) только когда
    // валидным JWT-токеном подтверждено, что это действительно его владелец. Без токена
    // взять чужой занятый ник нельзя — сервер сам подставит свободный вариант с суффиксом.
    // Помимо занятых аккаунтов, также проверяем, не сидит ли прямо сейчас под этим же
    // ником другой гость (см. isUsernameActiveElsewhere) — иначе два человека без
    // аккаунта могут одновременно оказаться под одинаковым именем.
    socket.on('register user', async (userData) => {
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

        socket.data = { username, avatar, peerId: userData && userData.peerId, uid: null };
        const decodedToken = token ? verifyToken(token) : null;
        if (decodedToken) socket.data.uid = decodedToken.uid;
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
            io.to(currentUserRoom).emit('room users', getRoomUsers(currentUserRoom));
        }
    });

    // Кто-то заходит в голосовой канал. Мьют/дефен передаём сразу тем же событием
    // (а не отдельным 'mute state' сразу следом) — раньше это было гонкой: сервер
    // сначала создавал запись с micMuted/deafened=false и рассылал её всем, и только
    // через мгновение прилетало отдельное 'mute state' с реальным значением. Из-за
    // этого при повторном заходе в канал (особенно если 'mute state' почему-то не
    // доходил или обрабатывался с задержкой) у остальных участников значок мьюта
    // мог не появиться вовсе. Теперь состояние приходит атомарно, одним событием.
    socket.on('select room', async ({ code, password }) => {
        const roomCode = String(code || '').toUpperCase();
        try {
            const result = await pool.query('SELECT * FROM rooms WHERE code = $1', [roomCode]);
            const room = result.rows[0];
            if (!room) return socket.emit('room access result', { ok: false, error: 'Комната не найдена' });
            if (room.password_hash) {
                const valid = await bcrypt.compare(String(password || ''), room.password_hash);
                if (!valid) return socket.emit('room access result', { ok: false, error: 'Неверный пароль' });
            }
            if (currentChatRoom && currentChatRoom !== roomCode) socket.leave(currentChatRoom);
            authorizedRooms.add(roomCode);
            currentChatRoom = roomCode;
            socket.join(roomCode);
            const history = await getRecentMessages(roomCode);
            socket.emit('room access result', { ok: true, room: cleanRoom(room), history });
        } catch (err) {
            console.error('❌ Ошибка входа в комнату:', err);
            socket.emit('room access result', { ok: false, error: 'Не удалось войти в комнату' });
        }
    });

    socket.on('join room', ({ room, peerId, micMuted, deafened }) => {
        room = String(room || '').toUpperCase();
        if (!authorizedRooms.has(room)) return socket.emit('room access result', { ok: false, error: 'Сначала войдите в комнату' });
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
        io.to(room).emit('room users', getRoomUsers(room));
        socket.to(room).emit('user connected', {
            username: currentUserData.username,
            avatar: currentUserData.avatar,
            peerId: peerId
        });
    });

    socket.on('get room users', (room) => {
        socket.emit('room users', getRoomUsers(room));
    });

    socket.on('leave voice', () => {
        leaveCurrentRoom(socket);
    });

    socket.on('video state', ({ sharing }) => {
        if (currentUserRoom && rooms[currentUserRoom] && rooms[currentUserRoom][socket.id]) {
            rooms[currentUserRoom][socket.id].sharing = !!sharing;
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
    });

    socket.on('chat message', async (payload) => {
        if (!currentChatRoom || !authorizedRooms.has(currentChatRoom)) return;
        const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
        const imageUrl = typeof payload?.imageUrl === 'string' ? payload.imageUrl.trim() : '';
        if (!text && !imageUrl) return;
        if (text.length > CHAT_TEXT_MAX) {
            return socket.emit('chat error', { error: `Сообщение — максимум ${CHAT_TEXT_MAX} символов` });
        }
        if (imageUrl && imageUrl.length > 2000) return;
        try {
            const username = socket.data?.username || 'Участник';
            const avatar = socket.data?.avatar || '';
            const createdAt = Date.now();
            const id = await insertMessage({ roomCode: currentChatRoom, username, avatar, text, imageUrl, createdAt });
            io.to(currentChatRoom).emit('chat message', {
                id, room_code: currentChatRoom, username, avatar, text, image_url: imageUrl, created_at: createdAt
            });
        } catch (err) {
            console.error('❌ Ошибка сохранения сообщения:', err);
            socket.emit('chat error', { error: 'Не удалось отправить сообщение' });
        }
    });

    function leaveCurrentRoom(sock) {
        if (currentUserRoom && rooms[currentUserRoom]) {
            const leftRoom = currentUserRoom;
            delete rooms[currentUserRoom][sock.id];
            sock.leave(currentUserRoom);

            if (sock.data && sock.data.peerId) {
                io.to(currentUserRoom).emit('user disconnected', sock.data.peerId);
            }

            if (Object.keys(rooms[currentUserRoom]).length === 0) {
                delete rooms[currentUserRoom];
            } else {
                io.to(currentUserRoom).emit('room users', getRoomUsers(currentUserRoom));
            }
            currentUserRoom = null;
            if (currentChatRoom === leftRoom) socket.join(leftRoom);
        }
    }
});

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
    .then(() => {
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
