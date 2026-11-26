const express = require('express');
const controller = require('../controllers/relatorioController');
const router = express.Router();
router.get('/vendas-mensais', controller.vendasPorMes);
router.get('/livros-mais-vendidos', controller.livrosMaisVendidos);
module.exports = router;
