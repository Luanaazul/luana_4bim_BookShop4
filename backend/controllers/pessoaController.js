const db = require('../database');
const bcrypt = require('bcryptjs');
const {
  senhaValida,
  cpfValido,
  formatarCPF,
  dataISOValida,
  numeroDecimalValido
} = require('../utils/validacao');
const CUSTO_HASH = 12;
const MAX_VALOR_NUMERICO = 99999999.99;

function cargoIdValido(valor) {
  if (typeof valor === 'string' && !/^\d+$/.test(valor)) return false;
  if (typeof valor !== 'number' && typeof valor !== 'string') return false;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 && numero <= 2147483647;
}

/*
==================================================
CAMPOS DA TABELA PESSOAS
==================================================
*/

const CAMPOS_PESSOA = `
  cpf_pessoa,
  nome_pessoa,
  data_nascimento_pessoa,
  endereco_pessoa,
  nome_usuario_pessoa,
  email_pessoa
`;

/*
==================================================
VALIDAÇÃO
==================================================
*/

function dadosValidos(dados) {
  const cpf = typeof dados.cpf_pessoa === 'string' ? dados.cpf_pessoa.trim() : '';
  const nome = typeof dados.nome_pessoa === 'string' ? dados.nome_pessoa.trim() : '';
  const nomeUsuario = typeof dados.nome_usuario_pessoa === 'string'
    ? dados.nome_usuario_pessoa.trim()
    : '';
  const endereco = typeof dados.endereco_pessoa === 'string'
    ? dados.endereco_pessoa.trim()
    : '';
  const email = typeof dados.email_pessoa === 'string'
    ? dados.email_pessoa.trim()
    : '';

  return cpfValido(cpf) &&
    nome.length > 0 && nome.length <= 100 &&
    nomeUsuario.length > 0 && nomeUsuario.length <= 50 &&
    endereco.length <= 200 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 150 &&
    dataISOValida(dados.data_nascimento_pessoa) &&
    new Date(`${dados.data_nascimento_pessoa}T00:00:00.000Z`) <= new Date();
}

/*
==================================================
LISTAR TODAS AS PESSOAS
GET /pessoas
==================================================
*/

const CONSULTA_PESSOAS = `
  SELECT p.cpf_pessoa, p.nome_pessoa, p.data_nascimento_pessoa::text, p.nome_usuario_pessoa,
         p.email_pessoa, p.endereco_pessoa, cl.data_cadastro_cliente::text,
         cl.pessoa_cpf_pessoa IS NOT NULL AS eh_cliente,
         f.pessoa_cpf_pessoa IS NOT NULL AS eh_funcionario,
         f.salario_funcionario, f.cargo_id_cargo, c.nome_cargo,
         COALESCE(e.enderecos, '[]'::jsonb) AS enderecos
    FROM pessoas p
    LEFT JOIN clientes cl ON cl.pessoa_cpf_pessoa = p.cpf_pessoa
    LEFT JOIN funcionarios f ON f.pessoa_cpf_pessoa = p.cpf_pessoa
    LEFT JOIN cargos c ON c.id_cargo = f.cargo_id_cargo
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('cep', cep, 'rua', rua, 'numero', numero,
        'complemento', complemento, 'bairro', bairro, 'cidade', cidade, 'estado', estado,
        'principal', principal) ORDER BY principal DESC, id_endereco) AS enderecos
      FROM enderecos_clientes WHERE cliente_pessoa_cpf_pessoa = cl.pessoa_cpf_pessoa
    ) e ON TRUE`;

async function listarPessoas(req, res) {
  try {
    const { rows } = await db.query(CONSULTA_PESSOAS + ' ORDER BY p.nome_pessoa');
    res.json(rows);
  } catch (error) {
    console.error('Erro ao listar pessoas:', error.code);
    res.status(500).json({ erro: 'Não foi possível listar as pessoas.' });
  }
}

async function obterPessoa(req, res) {
  try {
    const { rows } = await db.query(CONSULTA_PESSOAS +
      " WHERE p.cpf_pessoa = $1 OR ($1 ~ '^[0-9]{11}$' AND regexp_replace(p.cpf_pessoa, '[^0-9]', '', 'g') = $1)", [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: 'Pessoa não encontrada.' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Erro ao consultar pessoa:', error.code);
    res.status(500).json({ erro: 'Não foi possível consultar a pessoa.' });
  }
}

/*
==================================================
CADASTRAR PESSOA
POST /pessoas
==================================================
*/

async function criarPessoa(req, res) {
  const dados = req.body || {};
  const senha = dados.senha_pessoa;
  const clienteDados = dados.cliente && typeof dados.cliente === 'object'
    ? dados.cliente
    : {};
  const funcionarioDados = dados.funcionario && typeof dados.funcionario === 'object'
    ? dados.funcionario
    : null;
  const clienteDadosValido = dados.cliente === undefined || dados.cliente === null ||
    (typeof dados.cliente === 'object' && !Array.isArray(dados.cliente) &&
      Object.keys(dados.cliente).every((campo) =>
        ['renda_cliente', 'data_cadastro_cliente'].includes(campo)
      ));
  const funcionarioDadosValido = dados.funcionario === undefined || dados.funcionario === null ||
    (typeof dados.funcionario === 'object' && !Array.isArray(dados.funcionario) &&
      Object.keys(dados.funcionario).every((campo) =>
        [
          'salario_funcionario',
          'cargo_id_cargo',
          'porcentagem_comissao_funcionario'
        ].includes(campo)
      ));
  const rendaCliente = clienteDados.renda_cliente;
  const dataCadastroCliente = clienteDados.data_cadastro_cliente;
  const rendaClienteValida = rendaCliente === undefined || rendaCliente === null ||
    rendaCliente === '' || numeroDecimalValido(rendaCliente, 0, MAX_VALOR_NUMERICO);
  const dataCadastroClienteValida = dataCadastroCliente === undefined ||
    dataCadastroCliente === null || dataCadastroCliente === '' ||
    dataISOValida(dataCadastroCliente);
  const funcionarioValido = !funcionarioDados || (
    numeroDecimalValido(funcionarioDados.salario_funcionario, 0, MAX_VALOR_NUMERICO) &&
    cargoIdValido(funcionarioDados.cargo_id_cargo) &&
    numeroDecimalValido(funcionarioDados.porcentagem_comissao_funcionario ?? 0, 0, 100)
  );

  if (!dadosValidos(dados) || !cpfValido(dados.cpf_pessoa) || !senhaValida(senha) ||
    !clienteDadosValido || !funcionarioDadosValido ||
    !rendaClienteValida || !dataCadastroClienteValida || !funcionarioValido) {
    return res.status(400).json({
      erro: 'Preencha os dados obrigatórios, informe um CPF e uma data válidos e use uma senha entre 8 e 72 bytes.'
    });
  }

  const {
    cpf_pessoa,
    nome_pessoa,
    data_nascimento_pessoa,
    endereco_pessoa,
    nome_usuario_pessoa,
    email_pessoa
  } = dados;

  let client;
  let transacaoAberta = false;
  try {
    client = await db.connect();
    const senhaHash = await bcrypt.hash(senha, CUSTO_HASH);
    await client.query('BEGIN');
    transacaoAberta = true;
    const resultado = await client.query(
      `
      INSERT INTO pessoas (
        cpf_pessoa,
        nome_pessoa,
        data_nascimento_pessoa,
        endereco_pessoa,
        senha_pessoa,
        email_pessoa,
        nome_usuario_pessoa
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING ${CAMPOS_PESSOA}
      `,
      [
        formatarCPF(cpf_pessoa),
        nome_pessoa.trim(),
        data_nascimento_pessoa,
        endereco_pessoa.trim() || null,
        senhaHash,
        email_pessoa.trim().toLowerCase(),
        nome_usuario_pessoa.trim()
      ]
    );

    await client.query(
      `INSERT INTO clientes
       (pessoa_cpf_pessoa, renda_cliente, data_cadastro_cliente)
       VALUES ($1, COALESCE(NULLIF($2, '')::numeric, 0), COALESCE(NULLIF($3, '')::date, CURRENT_DATE))`,
      [
        formatarCPF(cpf_pessoa),
        rendaCliente === undefined || rendaCliente === null ? '' : String(rendaCliente),
        dataCadastroCliente || ''
      ]
    );
    if (funcionarioDados) {
      await client.query(
        `INSERT INTO funcionarios
         (pessoa_cpf_pessoa, salario_funcionario, cargo_id_cargo, porcentagem_comissao_funcionario)
         VALUES ($1, $2, $3, $4)`,
        [
          formatarCPF(cpf_pessoa),
          Number(funcionarioDados.salario_funcionario),
          Number(funcionarioDados.cargo_id_cargo),
          Number(funcionarioDados.porcentagem_comissao_funcionario ?? 0)
        ]
      );
    }
    await client.query('COMMIT');
    transacaoAberta = false;
    res.status(201).json(resultado.rows[0]);

  } catch (error) {
    if (transacaoAberta) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Erro ao desfazer cadastro de pessoa:', rollbackError.message);
      }
    }

    if (error.code === '23505') {
      return res.status(409).json({
        erro: 'CPF, e-mail ou nome de usuário já cadastrado.'
      });
    }
    if (error.code === '23503') {
      return res.status(400).json({ erro: 'O cargo selecionado não existe.' });
    }

    console.error('Erro ao cadastrar pessoa:', error.message);

    res.status(500).json({
      erro: 'Não foi possível cadastrar a pessoa.'
    });
  } finally {
    if (client) client.release();
  }
}

async function atualizarVinculo(req, res) {
  const dados = req.body || {};
  const campos = Object.keys(dados);
  if (!campos.length || campos.some(campo => !['cargo_id_cargo', 'salario_funcionario'].includes(campo))) {
    return res.status(400).json({ erro: 'Somente cargo e salário podem ser alterados.' });
  }
  const cargo = dados.cargo_id_cargo;
  const salario = dados.salario_funcionario;
  if (('cargo_id_cargo' in dados && !cargoIdValido(cargo)) ||
      ('salario_funcionario' in dados && !numeroDecimalValido(salario, 0, MAX_VALOR_NUMERICO))) {
    return res.status(400).json({ erro: 'Informe um cargo e um salário válidos.' });
  }
  try {
    const resultado = await db.query(`
      UPDATE funcionarios SET cargo_id_cargo = COALESCE($2, cargo_id_cargo),
        salario_funcionario = COALESCE($3, salario_funcionario)
      WHERE pessoa_cpf_pessoa = $1
      RETURNING cargo_id_cargo, salario_funcionario`, [req.params.id, cargo ?? null, salario ?? null]);
    if (!resultado.rowCount) return res.status(404).json({ erro: 'Esta pessoa não tem vínculo de funcionário.' });
    res.json(resultado.rows[0]);
  } catch (error) {
    if (error.code === '23503') return res.status(400).json({ erro: 'Cargo não cadastrado.' });
    console.error('Erro ao atualizar vínculo:', error.code);
    res.status(500).json({ erro: 'Não foi possível atualizar o vínculo funcional.' });
  }
}

module.exports = {
  listarPessoas,
  obterPessoa,
  criarPessoa,
  atualizarVinculo
};
