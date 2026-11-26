const express = require('express');
const multer = require('multer');
const controller = require('../controllers/livroController');
const imagemController = require('../controllers/imagemController');
const requireManager = require('../middleware/requireManager');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
});

function receberImagem(req, res, next) {
  upload.single('imagem')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ erro: 'Não foi possível receber a imagem enviada.' });
    }
    if (error) return next(error);
    return next();
  });
}

router.get('/generos', controller.listarGeneros);
router.get('/', controller.listarLivros);
router.get('/:id', controller.obterLivro);
router.post('/', requireManager, controller.criarLivro);
router.put('/:id', requireManager, controller.atualizarLivro);
router.delete('/:id', requireManager, controller.excluirLivro);
router.post('/:id/imagem', requireManager, receberImagem, imagemController.uploadImagem);

module.exports = router;
