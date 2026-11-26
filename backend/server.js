const express = require('express');
const cors = require('cors');
const cookieSession = require('cookie-session');
const path = require('path');

require('dotenv').config({
    path: path.resolve(__dirname, '../.env')
});

const livroRoutes = require('./routes/livroRoutes');
const lancamentoRoutes = require('./routes/lancamentoRoutes');
const cargoRoutes = require('./routes/cargoRoutes');
const generoRoutes = require('./routes/generoRoutes');
const pessoaRoutes = require('./routes/pessoaRoutes');
const loginRoutes = require('./routes/loginRoutes');
const carrinhoRoutes = require('./routes/carrinhoRoutes');
const compraRoutes = require('./routes/compraRoutes');
const pedidoRoutes = require('./routes/pedidoRoutes');
const enderecoRoutes = require('./routes/enderecoRoutes');
const requireManager = require('./middleware/requireManager');
const requireAuth = require('./middleware/requireAuth');

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;
const allowedOrigins = new Set([
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    `http://[::1]:${PORT}`,
    ...(process.env.CORS_ORIGINS ||
        'http://localhost:5500,http://127.0.0.1:5500,http://localhost:5503,http://127.0.0.1:5503')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
]);

if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET precisa estar definido no .env.');
}

// Caminho absoluto da pasta de imagens
const PASTA_IMAGENS = path.resolve(__dirname, '../shared/book-covers');
const PASTA_IMAGENS_ADMIN = path.resolve(__dirname, '../gerente/imagens/menu');
const FRONTEND_USUARIOS = path.resolve(__dirname, '../usuarios/frontend');
const FRONTEND_GERENTE = path.resolve(__dirname, '../gerente/frontend');

// Middlewares
app.use(cors({
    origin(origin, callback) {
        if (!origin) {
            return callback(null, true);
        }

        return callback(null, allowedOrigins.has(origin));
    },
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieSession({
    name: 'bookshop_session',
    keys: [SESSION_SECRET],
    maxAge: 8 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
}));

// Disponibiliza as imagens
app.use('/imagens', express.static(PASTA_IMAGENS));
app.use('/admin-imagens', express.static(PASTA_IMAGENS_ADMIN));
app.use('/gerente', (req, res, next) => {
    if (!req.session || !req.session.cpf_pessoa) {
        return res.redirect('/login/login.html?next=%2Fgerente%2Fmenu%2Findex.html');
    }

    const areaPedidos = ['/pedidos/pedidos.html', '/pedidos/pedidos.js',
        '/css/menu.css', '/css/livros.css', '/css/pedidos.css'];
    const autenticar = areaPedidos.includes(req.path) ? requireManager.requireOrderStaff : requireManager;
    return autenticar(req, res, next);
}, express.static(FRONTEND_GERENTE));
app.get('/gerente/menu.html', (req, res) => {
    res.redirect('/gerente/menu/index.html');
});
app.use(express.static(FRONTEND_USUARIOS));

// Rotas
app.use('/', loginRoutes);
app.use('/carrinho', carrinhoRoutes);
app.use('/compras', compraRoutes);
app.use('/perfil', require('./routes/perfilRoutes'));
app.use('/promocoes', require('./routes/promocaoRoutes'));
app.use('/enderecos', requireAuth, enderecoRoutes);
app.use('/pedidos', pedidoRoutes);
app.use('/livros', livroRoutes);
app.use('/lancamentos', requireManager, lancamentoRoutes);
app.use('/generos', requireManager, generoRoutes);
app.use('/cargos', requireManager, cargoRoutes);
app.use('/pessoas', requireManager, pessoaRoutes);

// Rota inicial
app.get('/', (req, res) => {
    res.redirect('/vitrine/index.html');
});

// Rota para páginas inexistentes
app.use((req, res) => {
    res.status(404).json({
        erro: 'Rota não encontrada.'
    });
});

// Inicialização do servidor
app.listen(PORT, () => {
    console.log(`Servidor BookShop rodando na porta ${PORT}`);
});