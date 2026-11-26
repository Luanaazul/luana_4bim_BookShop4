const db = require('../database');
const { numeroDecimalValido } = require('../utils/validacao');
const MAX_SALARIO = 99999999.99;

function inteiroValido(valor, minimo, maximo) {
  if (typeof valor === 'string' && !/^\d+$/.test(valor)) return false;
  if (typeof valor !== 'number' && typeof valor !== 'string') return false;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero >= minimo && numero <= maximo;
}

function dadosValidos(salario, cargo, comissao) {
  return numeroDecimalValido(salario, 0, MAX_SALARIO) &&
    inteiroValido(cargo, 1, 2147483647) &&
    numeroDecimalValido(comissao, 0, 100);
}

const SELECT_FUNCIONARIO = `
  SELECT
    f.pessoa_cpf_pessoa,
    p.nome_pessoa,
    f.salario_funcionario,
    f.cargo_id_cargo,
    c.nome_cargo,
    f.porcentagem_comissao_funcionario
  FROM funcionarios f
  JOIN pessoas p ON p.cpf_pessoa = f.pessoa_cpf_pessoa
  JOIN cargos c ON c.id_cargo = f.cargo_id_cargo
`;

async function listarFuncionarios(req, res) {
  try {
    const resultado = await db.query(
      `${SELECT_FUNCIONARIO} ORDER BY p.nome_pessoa`
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível listar os funcionários.' });
  }
}

async function obterFuncionario(req, res) {
  try {
    const resultado = await db.query(
      `${SELECT_FUNCIONARIO} WHERE f.pessoa_cpf_pessoa = $1`,
      [req.params.id]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: 'Funcionário não encontrado.' });
    }

    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível obter o funcionário.' });
  }
}

async function criarFuncionario(req, res) {
  const {
    pessoa_cpf_pessoa,
    salario_funcionario,
    cargo_id_cargo,
    porcentagem_comissao_funcionario,
  } = req.body || {};

  if (typeof pessoa_cpf_pessoa !== 'string' || !pessoa_cpf_pessoa.trim() ||
    !dadosValidos(
    salario_funcionario,
    cargo_id_cargo,
    porcentagem_comissao_funcionario
  )) {
    return res.status(400).json({
      erro: 'Pessoa, salário, cargo e comissão devem ser válidos.',
    });
  }

  let client;
  let transacaoAberta = false;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    transacaoAberta = true;
    await client.query(
      `INSERT INTO clientes (pessoa_cpf_pessoa)
       VALUES ($1)
       ON CONFLICT (pessoa_cpf_pessoa) DO NOTHING`,
      [pessoa_cpf_pessoa]
    );
    const resultado = await client.query(
      `INSERT INTO funcionarios
       (pessoa_cpf_pessoa, salario_funcionario, cargo_id_cargo, porcentagem_comissao_funcionario)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        pessoa_cpf_pessoa,
        salario_funcionario,
        cargo_id_cargo,
        porcentagem_comissao_funcionario,
      ]
    );
    await client.query('COMMIT');
    transacaoAberta = false;
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    if (transacaoAberta) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Erro ao desfazer cadastro de funcionário:', rollbackError.message);
      }
    }
    if (error.code === '23503') {
      return res.status(400).json({ erro: 'A pessoa ou cargo informado não existe.' });
    }
    if (error.code === '23505') {
      return res.status(409).json({ erro: 'Esta pessoa já é funcionário.' });
    }
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível cadastrar o funcionário.' });
  } finally {
    if (client) client.release();
  }
}

async function atualizarFuncionario(req, res) {
  const dados = req.body || {};
  const {
    salario_funcionario,
    cargo_id_cargo,
    porcentagem_comissao_funcionario,
  } = dados;

  const salarioInformado = Object.prototype.hasOwnProperty.call(dados, 'salario_funcionario');
  const cargoInformado = Object.prototype.hasOwnProperty.call(dados, 'cargo_id_cargo');
  const comissaoInformada = Object.prototype.hasOwnProperty.call(
    dados,
    'porcentagem_comissao_funcionario'
  );
  const temAtualizacao = salarioInformado || cargoInformado || comissaoInformada;
  const salarioValido = !salarioInformado ||
    numeroDecimalValido(salario_funcionario, 0, MAX_SALARIO);
  const cargoValido = !cargoInformado ||
    inteiroValido(cargo_id_cargo, 1, 2147483647);
  const comissaoValida = !comissaoInformada ||
    numeroDecimalValido(porcentagem_comissao_funcionario, 0, 100);

  const camposInvalidos = [];
  if (!temAtualizacao) camposInvalidos.push('nenhum campo enviado para atualização');
  if (!salarioValido) camposInvalidos.push('salario_funcionario');
  if (!cargoValido) camposInvalidos.push('cargo_id_cargo');
  if (!comissaoValida) camposInvalidos.push('porcentagem_comissao_funcionario');

  if (camposInvalidos.length) {
    return res.status(400).json({
      erro: `Dados inválidos: ${camposInvalidos.join(', ')}.`,
      campos: camposInvalidos
    });
  }

  try {
    const resultado = await db.query(
      `UPDATE funcionarios
       SET salario_funcionario = COALESCE($1, salario_funcionario),
           cargo_id_cargo = COALESCE($2, cargo_id_cargo),
           porcentagem_comissao_funcionario = COALESCE($3, porcentagem_comissao_funcionario)
       WHERE pessoa_cpf_pessoa = $4
       RETURNING *`,
      [
        salarioInformado ? Number(salario_funcionario) : null,
        cargoInformado ? Number(cargo_id_cargo) : null,
        comissaoInformada ? Number(porcentagem_comissao_funcionario) : null,
        req.params.id,
      ]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: 'Funcionário não encontrado.' });
    }

    res.json(resultado.rows[0]);
  } catch (error) {
    if (error.code === '23503') {
      return res.status(400).json({ erro: 'O cargo informado não existe.' });
    }
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível alterar o funcionário.' });
  }
}

async function excluirFuncionario(req, res) {
  try {
    const resultado = await db.query(
      'DELETE FROM funcionarios WHERE pessoa_cpf_pessoa = $1 RETURNING pessoa_cpf_pessoa',
      [req.params.id]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: 'Funcionário não encontrado.' });
    }

    res.status(204).send();
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ erro: 'Não foi possível excluir o funcionário.' });
  }
}

module.exports = {
  listarFuncionarios,
  obterFuncionario,
  criarFuncionario,
  atualizarFuncionario,
  excluirFuncionario,
};
