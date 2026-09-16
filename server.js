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
}

async function insertMessage({ username, avatar, text, imageUrl, createdAt }) {
    const result = await pool.query(
        `INSERT INTO messages (username, avatar, text, image_url, created_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [username, avatar, text, imageUrl, createdAt]
    );
    return result.rows[0].id;
}

async function getRecentMessages(limit = 100) {
    const result = await pool.query(
        `SELECT * FROM messages ORDER BY id DESC LIMIT $1`,
        [limit]
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

const rooms = {}; // Структура: { roomName: { socketId: { username, avatar, peerId } } }

io.on('connection', (socket) => {
    let currentUserRoom = null;
    let currentUserData = null;

    // Общий чат не привязан к комнате — сразу шлём историю последних сообщений.
    getRecentMessages().then(history => {
        socket.emit('chat history', history);
    }).catch(err => console.error('❌ Ошибка чтения истории чата:', err));

    // Ник закреплён за зарегистрированным аккаунтом (пароль) только когда
    // валидным JWT-токеном подтверждено, что это действительно его владелец. Без токена
    // взять чужой занятый ник нельзя — сервер сам подставит свободный вариант с суффиксом.
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
                const owner = await findUserByUsername(requested);
                if (owner && owner.password_hash) {
                    const suffix = String(Math.floor(1000 + Math.random() * 9000));
                    username = `${requested}_${suffix}`.slice(0, USERNAME_MAX);
                    socket.emit('username protected', { requested, assignedUsername: username });
                }
            }
        } catch (err) {
            console.error('❌ Ошибка проверки ника при регистрации сокета:', err);
        }

        socket.data = { username, avatar, peerId: userData && userData.peerId };
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
                    if (owner && owner.password_hash) {
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
        if (!socket.data) return;

        const text = typeof payload === 'string' ? payload : (payload && payload.text) || '';
        const imageUrl = (payload && payload.imageUrl) || null;

        if (!text.trim() && !imageUrl) return;

        const username = socket.data.username || 'Участник';
        const avatar = socket.data.avatar || '';
        const createdAt = Date.now();

        try {
            const id = await insertMessage({ username, avatar, text: text.trim(), imageUrl, createdAt });

            // Общий чат — рассылаем всем подключённым, а не только в рамках комнаты.
            io.emit('chat message', {
                id,
                username,
                avatar,
                text: text.trim(),
                image_url: imageUrl,
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
            } else {
                io.to(currentUserRoom).emit('room users', getRoomUsers(currentUserRoom));
            }
            currentUserRoom = null;
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
