const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../database');
const pessoaController = require('../controllers/pessoaController');

function resposta() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test('consulta unificada de Pessoas retorna dados dos vínculos de cliente e funcionário', async () => {
  const originalQuery = db.query;
  let sqlExecutado = '';
  db.query = async (sql) => {
    sqlExecutado = sql;
    return {
      rowCount: 1,
      rows: [{
        cpf_pessoa: '529.982.247-25',
        eh_cliente: true,
        enderecos: [{ rua: 'Rua Teste', principal: true }],
        data_cadastro_cliente: '2026-01-01',
        eh_funcionario: true,
        salario_funcionario: '3000.00',
        cargo_id_cargo: 1,
        porcentagem_comissao_funcionario: '5.00'
      }]
    };
  };
  const res = resposta();
  try {
    await pessoaController.obterPessoa({ params: { id: '529.982.247-25' } }, res);
  } finally {
    db.query = originalQuery;
  }
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.eh_cliente, true);
  assert.equal(res.body.eh_funcionario, true);
  assert.match(sqlExecutado, /LEFT JOIN clientes/);
  assert.match(sqlExecutado, /LEFT JOIN funcionarios/);
  assert.match(sqlExecutado, /WHERE cliente_pessoa_cpf_pessoa = cl.pessoa_cpf_pessoa/);
  assert.equal(res.body.enderecos[0].rua, 'Rua Teste');
});

test('a tela Pessoas consulta os vínculos pela rota unificada, sem chamar rotas CRUD separadas', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../gerente/frontend/js/pessoas.js'), 'utf8'
  );
  assert.match(source, /p\.eh_cliente/);
  assert.match(source, /p\.eh_funcionario/);
  assert.doesNotMatch(source, /buscarJSON\s*\(\s*`\/clientes\//);
  assert.doesNotMatch(source, /buscarJSON\s*\(\s*`\/funcionarios\//);
});
