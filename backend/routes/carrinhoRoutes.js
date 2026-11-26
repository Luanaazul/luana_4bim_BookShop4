const express = require('express');
const controller = require('../controllers/carrinhoController');

const router = express.Router();

router.post('/validar', controller.validarCarrinho);

module.exports = router;
