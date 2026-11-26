const express = require('express');
const controller = require('../controllers/pessoaController');

const router = express.Router();

router.get('/', controller.listarPessoas);
router.get('/:id', controller.obterPessoa);
router.post('/', controller.criarPessoa);
router.put('/:id', controller.atualizarVinculo);

module.exports = router;
