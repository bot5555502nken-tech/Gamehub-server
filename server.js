const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

// Для Vercel используем временную папку /tmp
const COMMENTS_FILE = '/tmp/comments.json';

app.get('/api/comments', (req, res) => {
    fs.readFile(COMMENTS_FILE, 'utf8', (err, data) => {
        if (err) return res.json([]);
        try { res.json(JSON.parse(data)); } catch (e) { res.json([]); }
    });
});

app.post('/api/comments', (req, res) => {
    const { name, text } = req.body;
    if (!name || !text) return res.status(400).json({ error: 'Нужны имя и текст' });
    
    fs.readFile(COMMENTS_FILE, 'utf8', (err, data) => {
        let comments = [];
        if (!err) {
            try { comments = JSON.parse(data); } catch (e) {}
        }
        comments.push({ name, text, date: new Date().toISOString() });
        fs.writeFile(COMMENTS_FILE, JSON.stringify(comments, null, 2), (err) => {
            if (err) return res.status(500).json({ error: 'Ошибка сервера' });
            res.json({ success: true });
        });
    });
});

// ВАЖНО: Для Vercel экспортируем app, а не вызываем app.listen
module.exports = app;
