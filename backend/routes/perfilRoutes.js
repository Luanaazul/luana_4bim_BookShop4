const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const db = require('../database');
const requireAuth = require('../middleware/requireAuth');
const router = express.Router();

router.use(requireAuth, (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

const executar = funcao => async (req, res) => {
  try { await funcao(req, res); }
  catch (erro) {
    console.error('Erro no perfil:', erro.code || erro.name);
    res.status(500).json({ erro: 'Não foi possível acessar o perfil.' });
  }
};

router.get('/', executar(async (req, res) => {
  const { rows: [perfil] } = await db.query(`
    SELECT pessoa.nome_pessoa AS nome, pessoa.nome_usuario_pessoa AS usuario,
           pessoa.tema, pessoa.foto_perfil IS NOT NULL AS tem_foto,
           COALESCE(compras.livros, 0) AS livros, COALESCE(compras.total, 0) AS total
    FROM pessoas pessoa LEFT JOIN LATERAL (
      SELECT SUM(COALESCE(itens.quantidade,0)) AS livros, SUM(g.valor_total_pagamento) AS total
      FROM pedidos p JOIN pagamentos g ON g.pedido_id_pedido = p.id_pedido
      LEFT JOIN LATERAL (SELECT SUM(i.quantidade) AS quantidade FROM pedido_has_livro i WHERE i.pedido_id_pedido = p.id_pedido) itens ON TRUE
      WHERE p.cliente_pessoa_cpf_pessoa = pessoa.cpf_pessoa
        AND p.status_pedido NOT IN ('Aguardando confirmação','Cancelado')
        AND g.status_pagamento IN ('Simulado','Pago','Confirmado')
    ) compras ON TRUE WHERE pessoa.cpf_pessoa = $1`, [req.session.cpf_pessoa]);
  if (!perfil) return res.status(404).json({ erro:'Perfil não encontrado.' });
  res.json(perfil);
}));

router.get('/tema', executar(async (req,res) => {
  const {rows:[p]} = await db.query('SELECT tema FROM pessoas WHERE cpf_pessoa=$1',[req.session.cpf_pessoa]);
  if (!p) return res.status(404).json({ erro:'Perfil não encontrado.' });
  res.json(p);
}));

router.put('/tema', executar(async (req,res) => {
  const tema = req.body?.tema;
  if (!['padrao','azul-laranja','preto-vermelho','preto-amarelo'].includes(tema)) {
    return res.status(400).json({ erro:'Escolha um tema disponível.' });
  }
  const {rows:[p]} = await db.query('UPDATE pessoas SET tema=$2 WHERE cpf_pessoa=$1 RETURNING tema',[req.session.cpf_pessoa, tema]);
  if (!p) return res.status(404).json({ erro:'Perfil não encontrado.' });
  res.json(p);
}));

router.get('/foto', executar(async (req,res) => {
  const {rows:[p]} = await db.query('SELECT foto_perfil FROM pessoas WHERE cpf_pessoa=$1',[req.session.cpf_pessoa]);
  if (!p?.foto_perfil) return res.status(404).end();
  res.set('X-Content-Type-Options','nosniff').type('image/webp').send(p.foto_perfil);
}));

const upload = multer({ limits:{ fileSize:4*1024*1024, files:1, fields:0 } }).single('foto');
router.post('/foto', (req,res,next) => upload(req,res,erro => {
  if (erro) return res.status(400).json({ erro:'Envie uma única foto de até 4 MB.' });
  next();
}), executar(async (req,res) => {
  if (!req.file) return res.status(400).json({ erro:'Selecione uma foto.' });
  let foto;
  try {
    const imagem = sharp(req.file.buffer,{ limitInputPixels:16000000 });
    if (!['jpeg','png','webp'].includes((await imagem.metadata()).format)) throw Error();
    foto = await imagem.autoOrient().resize(384,384,{ fit:'cover' }).webp({quality:82}).toBuffer();
  } catch { return res.status(400).json({ erro:'Use uma imagem JPEG, PNG ou WebP válida.' }); }
  const {rowCount} = await db.query('UPDATE pessoas SET foto_perfil=$2 WHERE cpf_pessoa=$1',[req.session.cpf_pessoa,foto]);
  if (!rowCount) return res.status(404).json({ erro:'Perfil não encontrado.' });
  res.json({ tem_foto:true });
}));
router.delete('/foto', executar(async (req,res) => {
  await db.query('UPDATE pessoas SET foto_perfil=NULL WHERE cpf_pessoa=$1',[req.session.cpf_pessoa]);
  res.status(204).end();
}));
module.exports = router;
