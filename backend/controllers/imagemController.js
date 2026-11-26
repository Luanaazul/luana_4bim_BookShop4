const fs = require('fs');
const { randomUUID } = require('node:crypto');
const path = require('path');
const sharp = require('sharp');
const db = require('../database');

const PASTA_IMAGENS = path.join(__dirname, '../../shared/book-covers/livros');
const EXTENSOES_FORMATO = {
  jpeg: new Set(['.jpg', '.jpeg', '.jpe']),
  png: new Set(['.png']),
  webp: new Set(['.webp']),
};

async function uploadImagem(req, res) {
  const idLivro = Number(req.params.id);

  if (!Number.isInteger(idLivro) || idLivro < 1) {
    return res.status(400).json({ erro: 'ID do livro inválido.' });
  }

  if (!req.file) {
    return res.status(400).json({ erro: 'Selecione uma imagem.' });
  }

  try {
    const livro = await db.query(
      'SELECT id_livro FROM livros WHERE id_livro = $1',
      [idLivro]
    );

    if (livro.rowCount === 0) {
      return res.status(404).json({ erro: 'Livro não encontrado.' });
    }

    const extensao = path.extname(req.file.originalname).toLowerCase();
    const imagem = sharp(req.file.buffer, { failOn: 'error' });
    let metadados;
    try {
      metadados = await imagem.metadata();
    } catch (error) {
      return res.status(400).json({ erro: 'O arquivo enviado não contém uma imagem válida.' });
    }

    const formatoSuportado = EXTENSOES_FORMATO[metadados.format];

    if (!formatoSuportado || !formatoSuportado.has(extensao)) {
      return res.status(400).json({
        erro: 'Use uma imagem JPEG, PNG ou WebP com extensão correspondente ao conteúdo.'
      });
    }

    const nomeArquivo = `livro_${idLivro}_${randomUUID()}${extensao}`;
    const caminhoArquivo = path.join(PASTA_IMAGENS, nomeArquivo);
    const caminhoPublico = `/imagens/livros/${nomeArquivo}`;

    let imagemProcessada = imagem
      .rotate()
      .resize({
        width: 300,
        height: 450,
        fit: 'inside',
        withoutEnlargement: true,
      });

    if (metadados.format === 'jpeg') {
      imagemProcessada = imagemProcessada.jpeg({ quality: 88 });
    } else if (metadados.format === 'png') {
      imagemProcessada = imagemProcessada.png({ compressionLevel: 9 });
    } else {
      imagemProcessada = imagemProcessada.webp({ quality: 88 });
    }

    await fs.promises.mkdir(PASTA_IMAGENS, { recursive: true });
    await imagemProcessada.toFile(caminhoArquivo);

    try {
      const atualizado = await db.query(
        'UPDATE livros SET caminho_imagem_livro = $1 WHERE id_livro = $2 RETURNING caminho_imagem_livro',
        [caminhoPublico, idLivro]
      );
      if (!atualizado.rowCount) throw new Error('Livro não encontrado ao registrar a capa.');
      // Pedidos anteriores podem referenciar a capa substituída.
    } catch (error) {
      await fs.promises.unlink(caminhoArquivo).catch(() => {});
      console.error('Não foi possível registrar o caminho da imagem:', error.message);
      return res.status(500).json({
        erro: 'A imagem não foi confirmada no banco; tente novamente.'
      });
    }

    res.status(201).json({
      mensagem: 'Imagem cadastrada com sucesso.',
      caminho: caminhoPublico,
      caminho_imagem_livro: caminhoPublico,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível salvar a imagem.' });
  }
}

module.exports = { uploadImagem };
