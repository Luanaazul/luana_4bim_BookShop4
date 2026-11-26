const db = require('../database');
const { dataISOValida, numeroDecimalValido } = require('../utils/validacao');
const MAX_RENDA = 99999999.99;

function numeroValido(valor) {
  return numeroDecimalValido(valor, 0, MAX_RENDA);
}

const SELECT_CLIENTE = `
  SELECT
    c.pessoa_cpf_pessoa,
    p.nome_pessoa,
    c.renda_cliente,
    c.data_cadastro_cliente
  FROM clientes c
  JOIN pessoas p ON p.cpf_pessoa = c.pessoa_cpf_pessoa
`;

async function listarClientes(req, res) {
  try {
    const resultado = await db.query(
      `${SELECT_CLIENTE} ORDER BY p.nome_pessoa`
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível listar os clientes.' });
  }
}

async function obterCliente(req, res) {
  try {
    const resultado = await db.query(
      `${SELECT_CLIENTE} WHERE c.pessoa_cpf_pessoa = $1`,
      [req.params.id]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: 'Cliente não encontrado.' });
    }

    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível obter o cliente.' });
  }
}

async function criarCliente(req, res) {
  const { pessoa_cpf_pessoa, renda_cliente, data_cadastro_cliente } = req.body || {};

  const rendaValida = renda_cliente === undefined || renda_cliente === null || renda_cliente === ''
    || numeroValido(renda_cliente);
  const dataValida = data_cadastro_cliente === undefined || data_cadastro_cliente === null
    || dataISOValida(data_cadastro_cliente);
  if (typeof pessoa_cpf_pessoa !== 'string' || !pessoa_cpf_pessoa.trim() ||
    !rendaValida || !dataValida) {
    return res.status(400).json({
      erro: 'Pessoa, renda e data de cadastro devem ser válidos.',
    });
  }

  try {
    const resultado = await db.query(
      `INSERT INTO clientes
       (pessoa_cpf_pessoa, renda_cliente, data_cadastro_cliente)
       VALUES ($1, COALESCE($2, 0), COALESCE($3::date, CURRENT_DATE))
       RETURNING *`,
      [
        pessoa_cpf_pessoa,
        renda_cliente === '' ? null : renda_cliente,
        data_cadastro_cliente || null
      ]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    if (error.code === '23503') {
      return res.status(400).json({ erro: 'A pessoa informada não existe.' });
    }
    if (error.code === '23505') {
      return res.status(409).json({ erro: 'Esta pessoa já é cliente.' });
    }
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível cadastrar o cliente.' });
  }
}

async function atualizarCliente(req, res) {
  const dados = req.body || {};
  const { renda_cliente, data_cadastro_cliente } = dados;
  const rendaInformada = Object.prototype.hasOwnProperty.call(dados, 'renda_cliente');
  const dataInformada = Object.prototype.hasOwnProperty.call(dados, 'data_cadastro_cliente');
  const rendaValida = !rendaInformada || numeroValido(renda_cliente);
  const dataValida = !dataInformada || dataISOValida(data_cadastro_cliente);

  const camposInvalidos = [];
  if (!rendaInformada && !dataInformada) camposInvalidos.push('nenhum campo enviado para atualização');
  if (!rendaValida) camposInvalidos.push('renda_cliente');
  if (!dataValida) camposInvalidos.push('data_cadastro_cliente');

  if (camposInvalidos.length) {
    return res.status(400).json({
      erro: `Dados inválidos: ${camposInvalidos.join(', ')}.`,
      campos: camposInvalidos
    });
  }

  try {
    const resultado = await db.query(
      `UPDATE clientes
       SET renda_cliente = COALESCE($1, renda_cliente),
           data_cadastro_cliente = COALESCE($2::date, data_cadastro_cliente)
       WHERE pessoa_cpf_pessoa = $3
       RETURNING *`,
      [
        rendaInformada ? Number(renda_cliente) : null,
        dataInformada ? data_cadastro_cliente : null,
        req.params.id
      ]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: 'Cliente não encontrado.' });
    }

    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível alterar o cliente.' });
  }
}

async function excluirCliente(req, res) {
  return res.status(409).json({
    erro: 'Todas as pessoas são clientes. Exclua a pessoa completa para remover seu cadastro.'
  });
}

module.exports = {
  listarClientes,
  obterCliente,
  criarCliente,
  atualizarCliente,
  excluirCliente,
};
