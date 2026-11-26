const express = require('express');
const controller = require('../controllers/enderecoController');

const router = express.Router();

router.get('/', controller.listarEnderecos);
router.post('/', controller.criarEndereco);
router.put('/:id', controller.atualizarEndereco);
router.delete('/:id', controller.excluirEndereco);

module.exports = router;
