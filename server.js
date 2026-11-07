 const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'ludara_super_secret_key';

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет доступа' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Токен недействителен' });
        req.user = user;
        next();
    });
}

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });
    const { data: existing } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Никнейм занят' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const { data: newUser, error } = await supabase.from('users').insert([
        { username, password: hashedPassword, balance: 0, owned: [], last_claim: 0 }
    ]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    const token = jwt.sign({ username: newUser.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { username: newUser.username, balance: newUser.balance, owned: newUser.owned, last_claim: newUser.last_claim } });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const { data: user, error } = await supabase.from('users').select('*').eq('username', username).maybeSingle();
    if (error || !user) return res.status(400).json({ error: 'Неверный ник или пароль' });
    let validPass = false;
    if (user.password && user.password.startsWith('$2')) {
        validPass = await bcrypt.compare(password, user.password);
    } else if (user.password && user.password.length === 64) {
        const sha256 = crypto.createHash('sha256').update(password).digest('hex');
        if (sha256 === user.password) { validPass = true; }
    } else if (user.password === password) {
        validPass = true;
    }
    if (!validPass) return res.status(400).json({ error: 'Неверный ник или пароль' });
    if (!user.password.startsWith('$2')) {
        const newHash = await bcrypt.hash(password, 10);
        await supabase.from('users').update({ password: newHash }).eq('username', user.username);
    }
    const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { username: user.username, balance: user.balance, owned: user.owned, last_claim: user.last_claim } });
});

app.get('/api/user', authenticateToken, async (req, res) => {
    const { data, error } = await supabase.from('users').select('*').eq('username', req.user.username).maybeSingle();
    if (error || !data) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ username: data.username, balance: data.balance, owned: data.owned, last_claim: data.last_claim });
});

app.post('/api/claim-bonus', authenticateToken, async (req, res) => {
    const { data: user } = await supabase.from('users').select('*').eq('username', req.user.username).maybeSingle();
    const now = Date.now();
    if (now - user.last_claim < 24 * 60 * 60 * 1000) return res.status(400).json({ error: 'Бонус еще не доступен' });
    const { data: updated, error } = await supabase.from('users').update({
        balance: (user.balance || 0) + 10,
        last_claim: now
    }).eq('username', req.user.username).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ balance: updated.balance, last_claim: updated.last_claim });
});

// ОБНОВЛЕНО: Теперь используем RPC (атомарный инкремент)
app.post('/api/add-game', authenticateToken, async (req, res) => {
    const { gameId } = req.body;
    const { data: user } = await supabase.from('users').select('*').eq('username', req.user.username).maybeSingle();
    
    let owned = user.owned || [];
    if (!owned.includes(gameId)) {
        owned.push(gameId);
        await supabase.from('users').update({ owned }).eq('username', req.user.username);
        
        // Вызываем атомарную функцию в базе данных
        await supabase.rpc('increment_game_count', { gid: gameId });
    }
    res.json({ owned });
});

app.get('/api/game-stats', async (req, res) => {
    const { data, error } = await supabase.from('game_stats').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.get('/api/comments', async (req, res) => {
    const { gameId } = req.query;
    let query = supabase.from('comments').select('*').order('created_at', { ascending: false });
    if (gameId) query = query.eq('game_id', gameId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/comments', authenticateToken, async (req, res) => {
    const { text, gameId } = req.body;
    if (!text) return res.status(400).json({ error: 'Введите текст' });
    await supabase.from('comments').insert([{ name: req.user.username, text, game_id: gameId || 'evoworld' }]);
    res.json({ success: true });
});

app.listen(process.env.PORT || 3000, () => console.log('Сервер запущен'));
