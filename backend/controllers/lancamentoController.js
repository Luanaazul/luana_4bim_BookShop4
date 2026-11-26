const db = require('../database');
const { dataISOValida } = require('../utils/validacao');

function idPositivo(valor) {
  const texto = String(valor);
  if (!/^[1-9]\d*$/.test(texto)) return null;
  const id = Number(texto);
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
}

const SELECT_LANCAMENTO = `
  SELECT
    la.id_lancamento,
    la.livro_id_livro,
    l.titulo,
    la.pais_lancamento,
    la.data_lancamento
  FROM lancamentos la
  JOIN livros l ON l.id_livro = la.livro_id_livro
`;

function validarDados(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return false;
  const livroValido = typeof dados.livro_id_livro === 'number' ||
    (typeof dados.livro_id_livro === 'string' && dados.livro_id_livro.trim() !== '');
  const livro = Number(dados.livro_id_livro);
  return livroValido && Number.isInteger(livro)
    && livro > 0
    && livro <= 2147483647
    && typeof dados.pais_lancamento === 'string'
    && dados.pais_lancamento.trim() !== ''
    && dados.pais_lancamento.trim().length <= 100
    && typeof dados.data_lancamento === 'string'
    && dataISOValida(dados.data_lancamento);
}

async function listarLancamentos(req, res) {
  try {
    const resultado = await db.query(
      `${SELECT_LANCAMENTO} ORDER BY la.id_lancamento`
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível listar os lançamentos.' });
  }
}

async function obterLancamento(req, res) {
  const id = idPositivo(req.params.id);
  if (!id) return res.status(400).json({ erro: 'ID de lançamento inválido.' });
  try {
    const resultado = await db.query(
      `${SELECT_LANCAMENTO} WHERE la.id_lancamento = $1`,
      [id]
    );
    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: 'Lançamento não encontrado.' });
    }
    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível obter o lançamento.' });
  }
}

async function criarLancamento(req, res) {
  const dados = req.body || {};
  const idLancamento = idPositivo(dados.id_lancamento);

  if (!idLancamento) {
    return res.status(400).json({ erro: 'Informe um ID de lançamento válido.' });
  }

  if (!validarDados(dados)) {
    return res.status(400).json({ erro: 'Livro, país e data são obrigatórios.' });
  }

  const livro = Number(dados.livro_id_livro);
  const pais = dados.pais_lancamento.trim();
  const data = dados.data_lancamento;

  let client;
  let transacaoAberta = false;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    transacaoAberta = true;
    const resultado = await client.query(
      `INSERT INTO lancamentos
       (id_lancamento, livro_id_livro, pais_lancamento, data_lancamento)
       VALUES ($1, $2, $3, $4)
       RETURNING id_lancamento, livro_id_livro, pais_lancamento, data_lancamento`,
      [idLancamento, livro, pais, data]
    );

    // Como o ID é SERIAL, ajusta a sequência para o próximo cadastro automático
    // não tentar reutilizar um ID que foi informado manualmente.
    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('lancamentos', 'id_lancamento'),
        (SELECT MAX(id_lancamento) FROM lancamentos),
        true
      )
    `);

    await client.query('COMMIT');
    transacaoAberta = false;
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    if (client && transacaoAberta) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Erro ao desfazer cadastro de lançamento:', rollbackError.message);
      }
    }
    if (error.code === '23505') {
      if (error.constraint === 'lancamentos_pkey') {
        return res.status(409).json({ erro: 'Este ID de lançamento já está cadastrado.' });
      }
      return res.status(409).json({ erro: 'Este livro já possui um lançamento.' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ erro: 'O livro selecionado não existe.' });
    }
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível cadastrar o lançamento.' });
  } finally {
    if (client) client.release();
  }
}

async function atualizarLancamento(req, res) {
  const id = idPositivo(req.params.id);
  if (!id) return res.status(400).json({ erro: 'ID de lançamento inválido.' });
  const dados = req.body || {};
  if (!validarDados(dados)) {
    return res.status(400).json({ erro: 'Livro, país e data são obrigatórios.' });
  }

  const livro = Number(dados.livro_id_livro);
  const pais = dados.pais_lancamento.trim();
  const data = dados.data_lancamento;

  try {
    const resultado = await db.query(
      `UPDATE lancamentos
       SET livro_id_livro = $1,
           pais_lancamento = $2,
           data_lancamento = $3
       WHERE id_lancamento = $4
       RETURNING id_lancamento, livro_id_livro, pais_lancamento, data_lancamento`,
      [livro, pais, data, id]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: 'Lançamento não encontrado.' });
    }

    res.json(resultado.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ erro: 'Este livro já possui outro lançamento.' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ erro: 'O livro selecionado não existe.' });
    }
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível alterar o lançamento.' });
  }
}

async function excluirLancamento(req, res) {
  const id = idPositivo(req.params.id);
  if (!id) return res.status(400).json({ erro: 'ID de lançamento inválido.' });
  try {
    const resultado = await db.query(
      'DELETE FROM lancamentos WHERE id_lancamento = $1 RETURNING id_lancamento',
      [id]
    );
    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: 'Lançamento não encontrado.' });
    }
    res.status(204).send();
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível excluir o lançamento.' });
  }
}

module.exports = {
  listarLancamentos,
  obterLancamento,
  criarLancamento,
  atualizarLancamento,
  excluirLancamento,
};
