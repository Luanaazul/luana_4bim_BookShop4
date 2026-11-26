const db = require('../database');
const fs = require('fs');
const path = require('path');
const { numeroDecimalValido } = require('../utils/validacao');
const MAX_PRECO = 99999999.99;

function idPositivo(valor) {
  const texto = String(valor);
  if (!/^[1-9]\d*$/.test(texto)) return null;
  const id = Number(texto);
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
}

function numeroDeEntradaValido(valor) {
  return typeof valor === 'number' ||
    (typeof valor === 'string' && valor.trim() !== '');
}

const SELECT_LIVRO = `
  SELECT
    l.id_livro,
    l.ordem_cadastro,
    l.titulo,
    l.autor,
    l.isbn,
    l.editora,
    l.paginas,
    l.ano,
    l.sinopse,
    l.preco,
    l.estoque,
    l.genero_id,
    g.nome_genero,
    l.caminho_imagem_livro
  FROM livros l
  JOIN generos g ON g.id_genero = l.genero_id
`;

function validarLivro(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return false;
  const tituloValido = typeof dados.titulo === 'string' &&
    dados.titulo.trim() !== '' && dados.titulo.trim().length <= 200;
  const autorValido = typeof dados.autor === 'string' &&
    dados.autor.trim() !== '' && dados.autor.trim().length <= 150;
  const isbnValido = dados.isbn === undefined || dados.isbn === null ||
    dados.isbn === '' || (typeof dados.isbn === 'string' && dados.isbn.trim().length <= 20);
  const editoraValida = dados.editora === undefined || dados.editora === null ||
    dados.editora === '' || (typeof dados.editora === 'string' && dados.editora.trim().length <= 100);
  const sinopseValida = dados.sinopse === undefined || dados.sinopse === null ||
    dados.sinopse === '' || typeof dados.sinopse === 'string';
  const paginasValido = numeroDeEntradaValido(dados.paginas);
  const paginas = Number(dados.paginas);
  const ano = dados.ano === null || dados.ano === undefined || dados.ano === ''
    ? null
    : Number(dados.ano);
  const estoque = Number(dados.estoque);
  const generoId = Number(dados.genero_id);

  return tituloValido && autorValido && isbnValido && editoraValida && sinopseValida
    && paginasValido && Number.isInteger(paginas) && paginas > 0 && paginas <= 2147483647
    && (ano === null || (numeroDeEntradaValido(dados.ano) &&
      Number.isInteger(ano) && ano > 0 && ano <= 2100))
    && numeroDecimalValido(dados.preco, 0, MAX_PRECO)
    && numeroDeEntradaValido(dados.estoque) &&
      Number.isInteger(estoque) && estoque >= 0 && estoque <= 2147483647
    && numeroDeEntradaValido(dados.genero_id) &&
      Number.isInteger(generoId) && generoId > 0 && generoId <= 2147483647;
}

function errosDosCamposLivro(dados) {
  const erros = [];
  const texto = (v) => typeof v === 'string' ? v.trim() : '';
  if (!texto(dados.titulo)) erros.push('Título: campo obrigatório.');
  else if (texto(dados.titulo).length > 200) erros.push('Título: máximo de 200 caracteres.');
  if (!texto(dados.autor)) erros.push('Autor: campo obrigatório.');
  else if (texto(dados.autor).length > 150) erros.push('Autor: máximo de 150 caracteres.');
  if (dados.isbn && (typeof dados.isbn !== 'string' || texto(dados.isbn).length > 20)) erros.push('ISBN: máximo de 20 caracteres.');
  if (dados.editora && (typeof dados.editora !== 'string' || texto(dados.editora).length > 100)) erros.push('Editora: máximo de 100 caracteres.');
  if (!numeroDeEntradaValido(dados.paginas) || !Number.isInteger(Number(dados.paginas)) || Number(dados.paginas) < 1) erros.push('Páginas: informe um inteiro maior que zero.');
  if (dados.ano !== '' && dados.ano !== null && dados.ano !== undefined &&
      (!numeroDeEntradaValido(dados.ano) || !Number.isInteger(Number(dados.ano)) || Number(dados.ano) < 1 || Number(dados.ano) > 2100)) erros.push('Ano: informe um ano entre 1 e 2100 ou deixe vazio.');
  if (!numeroDecimalValido(dados.preco, 0, MAX_PRECO)) erros.push('Preço: informe um valor válido entre 0 e 99.999.999,99.');
  if (!numeroDeEntradaValido(dados.estoque) || !Number.isInteger(Number(dados.estoque)) || Number(dados.estoque) < 0) erros.push('Estoque: informe um inteiro igual ou maior que zero.');
  if (!numeroDeEntradaValido(dados.genero_id) || !Number.isInteger(Number(dados.genero_id)) || Number(dados.genero_id) < 1) erros.push('Gênero: selecione uma opção válida.');
  return erros;
}

function normalizarDados(dados) {
  return {
    titulo: String(dados.titulo).trim(),
    autor: String(dados.autor).trim(),
    isbn: typeof dados.isbn === 'string' && dados.isbn.trim()
      ? dados.isbn.trim()
      : null,
    editora: typeof dados.editora === 'string' && dados.editora.trim()
      ? dados.editora.trim()
      : null,
    paginas: Number(dados.paginas),
    ano: dados.ano === '' || dados.ano === undefined || dados.ano === null
      ? null
      : Number(dados.ano),
    sinopse: dados.sinopse ? String(dados.sinopse).trim() : null,
    preco: Number(dados.preco),
    estoque: Number(dados.estoque),
    genero_id: Number(dados.genero_id),
  };
}

async function listarLivros(req, res) {
  try {
    const resultado = await db.query(
      `${SELECT_LIVRO} ORDER BY l.id_livro`
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível listar os livros.' });
  }
}

async function obterLivro(req, res) {
  const id = idPositivo(req.params.id);
  if (!id) return res.status(400).json({ erro: 'ID de livro inválido.' });
  try {
    const resultado = await db.query(
      `${SELECT_LIVRO} WHERE l.id_livro = $1`,
      [id]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: 'Livro não encontrado.' });
    }

    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível obter o livro.' });
  }
}

async function listarGeneros(req, res) {
  try {
    const resultado = await db.query(
      'SELECT id_genero, nome_genero FROM generos ORDER BY nome_genero'
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível listar os gêneros.' });
  }
}

async function criarLivro(req, res) {
  const dadosRecebidos = req.body || {};
  const idLivro = idPositivo(dadosRecebidos.id_livro);
  if (!idLivro) {
    return res.status(400).json({ erro: 'Informe um ID inteiro positivo para o livro.' });
  }

  if (!validarLivro(dadosRecebidos)) {
    return res.status(400).json({ erro: errosDosCamposLivro(dadosRecebidos).join(' ') || 'Preencha os dados do livro com valores válidos.' });
  }

  // Verifica a disponibilidade do ID separadamente das validações dos campos.
  // A restrição PRIMARY KEY continua sendo a proteção final contra cadastros simultâneos.
  try {
    const idExistente = await db.query(
      'SELECT 1 FROM livros WHERE id_livro = $1 LIMIT 1',
      [idLivro]
    );
    if (idExistente.rowCount > 0) {
      return res.status(409).json({ erro: `O ID ${idLivro} já está cadastrado. Informe outro ID livre.` });
    }
  } catch (error) {
    console.error('Erro ao verificar disponibilidade do ID do livro:', error.message);
    return res.status(500).json({ erro: 'Não foi possível verificar se o ID do livro está disponível.' });
  }

  const dados = normalizarDados(dadosRecebidos);

  let client;
  let transacaoAberta = false;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    transacaoAberta = true;
    const resultado = await client.query(
      `INSERT INTO livros
       (id_livro, titulo, autor, isbn, editora, paginas, ano, sinopse, preco, estoque, genero_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id_livro`,
      [
        idLivro,
        dados.titulo,
        dados.autor,
        dados.isbn,
        dados.editora,
        dados.paginas,
        dados.ano,
        dados.sinopse,
        dados.preco,
        dados.estoque,
        dados.genero_id,
      ]
    );

    // Mantém a sequência SERIAL acima do maior ID existente para futuros INSERTs automáticos.
    await client.query(
      `SELECT setval(
         pg_get_serial_sequence('livros', 'id_livro'),
         GREATEST((SELECT COALESCE(MAX(id_livro), 1) FROM livros), 1),
         true
       )`
    );

    const livro = await client.query(
      `${SELECT_LIVRO} WHERE l.id_livro = $1`,
      [resultado.rows[0].id_livro]
    );

    await client.query('COMMIT');
    transacaoAberta = false;
    res.status(201).json(livro.rows[0]);
  } catch (error) {
    if (client && transacaoAberta) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Erro ao desfazer cadastro de livro:', rollbackError.message);
      }
    }
    if (error.code === '23505') {
      if (String(error.constraint || '').includes('pkey') || String(error.constraint || '').includes('id_livro')) {
        return res.status(409).json({ erro: 'Esse ID já está cadastrado. Escolha outro ID livre.' });
      }
      return res.status(409).json({ erro: 'O ISBN informado já está cadastrado.' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ erro: 'O gênero selecionado não existe.' });
    }
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível cadastrar o livro.' });
  } finally {
    if (client) client.release();
  }
}

async function atualizarLivro(req, res) {
  const id = idPositivo(req.params.id);
  if (!id) return res.status(400).json({ erro: 'ID de livro inválido.' });
  const dadosRecebidos = req.body || {};
  if (!validarLivro(dadosRecebidos)) {
    return res.status(400).json({ erro: errosDosCamposLivro(dadosRecebidos).join(' ') || 'Preencha os dados do livro com valores válidos.' });
  }

  const dados = normalizarDados(dadosRecebidos);

  try {
    const resultado = await db.query(
      `UPDATE livros
       SET titulo = $1,
           autor = $2,
           isbn = $3,
           editora = $4,
           paginas = $5,
           ano = $6,
           sinopse = $7,
           preco = $8,
           estoque = $9,
           genero_id = $10
       WHERE id_livro = $11
       RETURNING id_livro`,
      [
        dados.titulo,
        dados.autor,
        dados.isbn,
        dados.editora,
        dados.paginas,
        dados.ano,
        dados.sinopse,
        dados.preco,
        dados.estoque,
        dados.genero_id,
        id,
      ]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: 'Livro não encontrado.' });
    }

    const livro = await db.query(
      `${SELECT_LIVRO} WHERE l.id_livro = $1`,
      [id]
    );

    res.json(livro.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ erro: 'O ISBN informado já está cadastrado.' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ erro: 'O gênero selecionado não existe.' });
    }
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível alterar o livro.' });
  }
}

async function excluirLivro(req, res) {
  const id = idPositivo(req.params.id);
  if (!id) return res.status(400).json({ erro: 'ID de livro inválido.' });
  try {
    const existente = await db.query(
      'SELECT caminho_imagem_livro FROM livros WHERE id_livro = $1',
      [id]
    );
    if (!existente.rowCount) return res.status(404).json({ erro: 'Livro não encontrado.' });

    const resultado = await db.query(
      'DELETE FROM livros WHERE id_livro = $1 RETURNING id_livro',
      [id]
    );
    if (resultado.rowCount === 0) return res.status(404).json({ erro: 'Livro não encontrado.' });

    // A capa só é removida após a exclusão confirmada no banco.
    const capa = existente.rows[0].caminho_imagem_livro;
    if (capa && capa.startsWith('/imagens/livros/')) {
      const pastaCapas = path.resolve(__dirname, '../../shared/book-covers/livros');
      const arquivo = path.resolve(pastaCapas, path.basename(capa));
      if (path.dirname(arquivo) === pastaCapas) {
        await fs.promises.unlink(arquivo).catch((erro) => {
          if (erro.code !== 'ENOENT') console.warn('Livro excluído, mas a capa não pôde ser removida:', erro.message);
        });
      }
    }
    res.status(204).send();
  } catch (error) {
    if (error.code === '23503') {
      return res.status(409).json({
        erro: 'Este livro possui lançamento relacionado e não pode ser excluído.',
      });
    }
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível excluir o livro.' });
  }
}

module.exports = {
  listarLivros,
  obterLivro,
  listarGeneros,
  criarLivro,
  atualizarLivro,
  excluirLivro,
};
