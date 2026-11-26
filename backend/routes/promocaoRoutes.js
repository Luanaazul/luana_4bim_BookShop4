const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireManager = require('../middleware/requireManager');
const campanha = require('../controllers/campanhaController');
const router = express.Router();

const executar = funcao => async (req,res) => {
  try { await funcao(req,res); }
  catch (erro) {
    if (erro.constraint === 'uq_promocoes_id_exibicao') return res.status(409).json({ erro:'Este ID de desconto já está em uso.' });
    console.error('Erro em campanhas:', erro.code || erro.name);
    res.status(erro.code === '23514' ? 400 : 500).json({ erro:'Não foi possível concluir a operação com a campanha.' });
  }
};

router.get('/vitrine', executar(campanha.vitrine));
router.use(requireAuth, requireManager);
router.get('/catalogo', executar(campanha.catalogo));
router.post('/previa', executar(campanha.previa));
router.get('/', executar(campanha.listar));
router.post('/', executar(campanha.salvar));
router.get('/:codigo', executar(campanha.obter));
router.put('/:codigo', executar(campanha.salvar));
router.patch('/:codigo/ativacao', executar(campanha.ativar));
router.delete('/:codigo', executar(campanha.excluir));
module.exports = router;
