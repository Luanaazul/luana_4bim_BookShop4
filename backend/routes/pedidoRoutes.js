const multer = require('multer');
const express = require('express');
const controller = require('../controllers/pedidoController');
const requireAuth = require('../middleware/requireAuth');
const requireManager = require('../middleware/requireManager');
const { requireOrderStaff } = requireManager;
const router = express.Router();
router.get('/formas-pagamento', requireAuth, requireOrderStaff, controller.listarFormasPagamento);
router.get('/clientes', requireAuth, requireOrderStaff, controller.buscarClientes);
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, fieldSize: 22000 } }).single('anexo');

function receberAnexo(req, res, next) {
  upload(req, res, erro => {
    if (erro) return res.status(400).json({ erro: 'Envie um único anexo de até 10 MB.' });
    if (req.file) {
      const { buffer, mimetype } = req.file;
      const valido = {
        'image/jpeg': buffer.subarray(0, 3).toString('hex') === 'ffd8ff',
        'image/png': buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
        'video/mp4': buffer.subarray(4, 8).toString('ascii') === 'ftyp',
        'video/webm': buffer.subarray(0, 4).toString('hex') === '1a45dfa3',
      };
      if (!Object.hasOwn(valido, mimetype) || !valido[mimetype]) {
        return res.status(400).json({ erro: 'Use uma foto JPEG/PNG ou vídeo MP4/WebM.' });
      }
    }
    next();
  });
}

router.get('/avisos', requireAuth, requireManager, controller.avisosCancelamento);
router.get('/:id/cancelamento/anexo', requireAuth, requireManager, controller.anexoCancelamento);
router.post('/:id/cancelamento/decisao', requireAuth, requireManager, controller.decidirCancelamento);
router.get('/meus', requireAuth, controller.meusPedidos);
router.get('/', requireAuth, requireOrderStaff, controller.listarPedidos);
router.post('/', requireAuth, requireOrderStaff, controller.criarPedidoPresencial);
router.get('/:id', requireAuth, controller.obterPedido);
router.post('/:id/ocultar', requireAuth, controller.ocultarCancelado);
router.post('/:id/cancelar', requireAuth, receberAnexo, controller.cancelarPedidoCliente);
router.put('/:id', requireAuth, requireManager, controller.atualizarStatusPedido);
module.exports = router;
