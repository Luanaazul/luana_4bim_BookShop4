const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const db = require('../database');
const livroController = require('../controllers/livroController');
const lancamentoController = require('../controllers/lancamentoController');
const enderecoController = require('../controllers/enderecoController');
const compraController = require('../controllers/compraController');
const pedidoController = require('../controllers/pedidoController');
const relatorioController = require('../controllers/relatorioController');

test('resultado do cartão é simulado localmente sem enviar dados', () => {
  const contexto = { window: { addEventListener() {} } };
  const arquivo = path.resolve(
    __dirname,
    '../../usuarios/frontend/finalizar/finalizar.js'
  );
  vm.runInNewContext(fs.readFileSync(arquivo, 'utf8'), contexto);
  assert.equal(contexto.resultadoCartaoSimulado('1230'), 'recusado');
  assert.equal(contexto.resultadoCartaoSimulado('1231'), 'aprovado');
});

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

test('a cotação PIX usa centavos para desconto e mantém o frete demonstrativo', () => {
  assert.deepEqual(compraController.calcularValores(2001, 1), {
    subtotal: '20.01',
    desconto: '1.00',
    frete: '10.00',
    total: '29.01'
  });
  assert.deepEqual(compraController.calcularValores(2001, 2), {
    subtotal: '20.01',
    desconto: '0.00',
    frete: '10.00',
    total: '30.01'
  });
});

test('preparação salva o valor final no pagamento e mantém o pedido pendente', async () => {
  let valoresPagamento;
  const pedido = {
    id_pedido: 7,
    data_pedido: '2026-01-01',
    data_prevista_entrega: '2026-01-16',
    total_pedido: '30.00',
    subtotal_pedido: '20.00',
    desconto_pedido: '0.00',
    frete_pedido: '10.00',
    endereco_entrega_cep: '01000-000',
    endereco_entrega_rua: 'Rua de teste',
    endereco_entrega_numero: '1',
    endereco_entrega_complemento: null,
    endereco_entrega_bairro: 'Centro',
    endereco_entrega_cidade: 'São Paulo',
    endereco_entrega_estado: 'SP',
    status_pedido: 'Aguardando confirmação'
  };
  db.connect = async () => ({
    async query(sql, valores = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT pessoa_cpf_pessoa FROM clientes')) {
        return { rowCount: 1, rows: [{ pessoa_cpf_pessoa: '529.982.247-25' }] };
      }
      if (sql.includes('SELECT p.id_pedido, p.cliente_pessoa_cpf_pessoa')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('AS elegivel')) return { rows: [{ elegivel: false }] };
      if (sql.includes('FROM promocoes')) return { rows: [] };
      if (sql.includes('SELECT id_endereco, cep')) {
        return {
          rowCount: 1,
          rows: [{
            id_endereco: '3',
            cep: '01000-000',
            rua: 'Rua de teste',
            numero: '1',
            complemento: null,
            bairro: 'Centro',
            cidade: 'São Paulo',
            estado: 'SP'
          }]
        };
      }
      if (sql.includes('SELECT id_forma_pagamento, nome_forma_pagamento')) {
        return { rowCount: 1, rows: [{ nome_forma_pagamento: 'Cartão (simulado)' }] };
      }
      if (sql.includes('SELECT id_livro, titulo, caminho_imagem_livro')) {
        return {
          rowCount: 1,
          rows: [{
            id_livro: 2,
            titulo: 'Livro de teste',
            caminho_imagem_livro: null,
            preco: '20.00',
            estoque: 4
          }]
        };
      }
      if (sql.includes('INSERT INTO pedidos')) {
        return { rowCount: 1, rows: [pedido] };
      }
      if (sql.includes('INSERT INTO pedido_has_livro')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('INSERT INTO pagamentos')) {
        valoresPagamento = valores;
        return {
          rowCount: 1,
          rows: [{
            status_pagamento: 'Aguardando confirmação',
            pix_qr_code: null,
            pix_qr_code_base64: null
          }]
        };
      }
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    },
    release() {}
  });

  const result = resposta();
  await compraController.prepararCompra({
    body: {
      itens: [{ id_livro: 2, quantidade: 1 }],
      forma_pagamento_id: 2,
      tentativa_id: '98b7d763-3f2a-4a2d-b94f-61a0af743e7a',
      endereco_id: 3
    },
    session: { cpf_pessoa: '529.982.247-25' }
  }, result);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.pedido.total_pedido, 30);
  assert.equal(result.body.pedido.status_pedido, 'Aguardando confirmação');
  assert.equal(valoresPagamento[1], '30.00');
  assert.equal(valoresPagamento[2], 'Aguardando confirmação');
});

test('a cotação exige endereço antes de consultar o banco', async () => {
  db.query = async () => {
    throw new Error('Uma cotação sem endereço não deve consultar o banco.');
  };
  const result = resposta();
  await compraController.cotacaoCompra({
    body: { itens: [{ id_livro: 1, quantidade: 1 }], forma_pagamento_id: 1 },
    session: { cpf_pessoa: '529.982.247-25' }
  }, result);
  assert.equal(result.statusCode, 400);
});

test('datas impossíveis e períodos invertidos são rejeitados nos relatórios', async () => {
  db.query = async () => {
    throw new Error('Um período inválido não deve consultar o banco.');
  };
  for (const query of [
    { inicio: '2026-02-31' },
    { inicio: '2026-11-02', fim: '2026-11-01' },
    { inicio: ['2026-01-01'] }
  ]) {
    const result = resposta();
    await relatorioController.vendasPorMes({ query }, result);
    assert.equal(result.statusCode, 400);
  }
});

test('o relatório inclui somente vendas pagas e valida filtros de data', async () => {
  let parametros;
  db.query = async (sql, valores) => {
    parametros = valores;
    assert.match(sql, /pg\.status_pagamento = 'Simulado'/);
    assert.match(sql, /p\.status_pedido = ANY/);
    return { rows: [] };
  };
  const result = resposta();
  await relatorioController.vendasPorMes({
    query: { inicio: '2026-01-01', fim: '2026-12-31' }
  }, result);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(parametros.slice(0, 2), ['2026-01-01', '2026-12-31']);
  assert.deepEqual(parametros[2], ['Confirmado', 'Em preparação', 'Enviado', 'Entregue']);
});

test('ano de lançamento impossível é rejeitado antes da consulta ao banco', async () => {
  db.query = async () => {
    throw new Error('Um lançamento inválido não deve consultar o banco.');
  };
  const result = resposta();
  await lancamentoController.criarLancamento({
    body: {
      id_lancamento: 1,
      livro_id_livro: 1,
      pais_lancamento: 'Brasil',
      data_lancamento: '2026-02-31'
    }
  }, result);
  assert.equal(result.statusCode, 400);
});

test('o livro rejeita ano fora do limite do schema', async () => {
  db.query = async () => {
    throw new Error('Um livro inválido não deve consultar o banco.');
  };
  const result = resposta();
  await livroController.criarLivro({
    body: {
      id_livro: 1,
      titulo: 'Livro de teste',
      autor: 'Autoria',
      isbn: null,
      editora: null,
      paginas: 100,
      ano: 2101,
      sinopse: null,
      preco: 10,
      estoque: 1,
      genero_id: 1
    }
  }, result);
  assert.equal(result.statusCode, 400);
});

test('endereço com campo ou CEP inválido é rejeitado antes do banco', async () => {
  db.connect = async () => {
    throw new Error('Um endereço inválido não deve abrir transação.');
  };
  const result = resposta();
  await enderecoController.criarEndereco({
    body: {
      cep: '12ab5678',
      rua: 'Rua de teste',
      numero: '1',
      bairro: 'Centro',
      cidade: 'São Paulo',
      estado: 'SP',
      outro_campo: 'inválido'
    },
    session: { cpf_pessoa: '529.982.247-25' }
  }, result);
  assert.equal(result.statusCode, 400);
});

test('edição parcial de endereço mantém os campos não enviados', async () => {
  let updateSql;
  let updateValues;
  const enderecoSalvo = {
    id_endereco: '8',
    cep: '01000-000',
    rua: 'Rua nova',
    numero: '12',
    complemento: 'Fundos',
    bairro: 'Centro',
    cidade: 'São Paulo',
    estado: 'SP',
    principal: true,
    data_criacao: '2026-01-01T00:00:00.000Z'
  };
  db.connect = async () => ({
    async query(sql, valores = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rowCount: 1, rows: [] };
      if (sql.includes('SELECT pessoa_cpf_pessoa FROM clientes')) {
        return { rowCount: 1, rows: [{ pessoa_cpf_pessoa: '529.982.247-25' }] };
      }
      if (sql.includes('FROM enderecos_clientes') && sql.includes('FOR UPDATE')) {
        return { rowCount: 1, rows: [{ ...enderecoSalvo, rua: 'Rua antiga' }] };
      }
      if (sql.startsWith('UPDATE enderecos_clientes')) {
        updateSql = sql;
        updateValues = valores;
        return { rowCount: 1, rows: [enderecoSalvo] };
      }
      if (sql.includes('FROM enderecos_clientes')) {
        return { rowCount: 1, rows: [enderecoSalvo] };
      }
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    },
    release() {}
  });

  const result = resposta();
  await enderecoController.atualizarEndereco({
    params: { id: '8' },
    body: { rua: 'Rua nova' },
    session: { cpf_pessoa: '529.982.247-25' }
  }, result);

  assert.equal(result.statusCode, 200);
  assert.match(updateSql, /SET rua = \$1/);
  assert.deepEqual(updateValues, ['Rua nova', 8, '529.982.247-25']);
  assert.equal(result.body.numero, '12');
  assert.equal(result.body.complemento, 'Fundos');
});

test('pedido não pode pular estados nem ajustar estoque em transição inválida', async () => {
  const chamadas = [];
  db.connect = async () => ({
    async query(sql) {
      chamadas.push(sql);
      if (sql.includes('SELECT id_pedido, status_pedido')) {
        return { rowCount: 1, rows: [{ id_pedido: 1, status_pedido: 'Aguardando confirmação' }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  });
  const result = resposta();
  await pedidoController.atualizarStatusPedido({
    params: { id: '1' },
    body: { status_pedido: 'Entregue' }
  }, result);
  assert.equal(result.statusCode, 409);
  assert.equal(chamadas.some((sql) => sql.includes('UPDATE livros SET estoque')), false);
  assert.equal(chamadas.includes('ROLLBACK'), true);
});
