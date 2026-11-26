const assert = require('node:assert/strict');
const test = require('node:test');
const db = require('../database');
const pessoaController = require('../controllers/pessoaController');
const clienteController = require('../controllers/clienteController');
const funcionarioController = require('../controllers/funcionarioController');
const requireManager = require('../middleware/requireManager');
const {
  senhaValida,
  cpfValido,
  numeroDecimalValido
} = require('../utils/validacao');

const cpf = '529.982.247-25';
function resposta() {
  return {
    statusCode: 200,
    body: undefined,
    status(codigo) {
      this.statusCode = codigo;
      return this;
    },
    json(dados) {
      this.body = dados;
      return this;
    },
    send(dados) {
      this.body = dados;
      return this;
    }
  };
}

test('validadores compartilham o limite em bytes e o CPF com dígitos verificadores', () => {
  assert.equal(senhaValida('éééé'), true);
  assert.equal(senhaValida('1234567'), false);
  assert.equal(senhaValida('a'.repeat(73)), false);
  assert.equal(cpfValido(cpf), true);
  assert.equal(cpfValido('111.111.111-11'), false);
});

test('validação decimal respeita limites numéricos e duas casas decimais', () => {
  assert.equal(numeroDecimalValido('99999999.99', 0, 99999999.99), true);
  assert.equal(numeroDecimalValido('100000000.00', 0, 99999999.99), false);
  assert.equal(numeroDecimalValido('1.001', 0, 100), false);
  assert.equal(numeroDecimalValido(true, 0, 100), false);
});

test('CPF com máscara ou somente dígitos mantém a mesma identificação', () => {
  const { formatarCPF } = require('../utils/validacao');
  assert.equal(cpfValido('52998224725'), true);
  assert.equal(formatarCPF('52998224725'), cpf);
  assert.equal(cpfValido('000.000.000-01'), false);
});

test('dados pessoais e comissão são rejeitados sem acessar o banco', async () => {
  for (const body of [{ nome_pessoa: 'Outro' }, { email_pessoa: 'nova@example.com' },
    { endereco_pessoa: 'Rua Nova' }, { porcentagem_comissao_funcionario: 5 }]) {
    const res = resposta();
    await pessoaController.atualizarVinculo({ params: { id: cpf }, body }, res);
    assert.equal(res.statusCode, 400);
  }
});

test('campos omitidos de cliente e funcionário são mantidos por atualizações parciais', async () => {
  let chamadas = 0;
  db.query = async (sql, parametros) => {
    chamadas += 1;
    assert.match(sql, /COALESCE/);
    if (chamadas === 1) {
      assert.deepEqual(parametros, [2500, null, cpf]);
      return { rowCount: 1, rows: [{ renda_cliente: '2500.00' }] };
    }
    assert.deepEqual(parametros, [3000, null, null, cpf]);
    return { rowCount: 1, rows: [{ salario_funcionario: '3000.00' }] };
  };

  const cliente = resposta();
  await clienteController.atualizarCliente({
    params: { id: cpf },
    body: { renda_cliente: '2500' }
  }, cliente);
  assert.equal(cliente.statusCode, 200);

  const funcionario = resposta();
  await funcionarioController.atualizarFuncionario({
    params: { id: cpf },
    body: { salario_funcionario: '3000' }
  }, funcionario);
  assert.equal(funcionario.statusCode, 200);
});

test('a proteção de gerente barra usuário sem permissão', async () => {
  db.query = async () => ({ rows: [{ is_manager: false }] });
  let nextChamado = false;
  const result = resposta();

  await requireManager(
    { session: { cpf_pessoa: cpf } },
    result,
    () => { nextChamado = true; }
  );

  assert.equal(result.statusCode, 403);
  assert.equal(nextChamado, false);
});
