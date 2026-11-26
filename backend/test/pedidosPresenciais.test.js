const assert = require('node:assert/strict');
const test = require('node:test');
const pedidoController = require('../controllers/pedidoController');
const { validarDadosPedidoPresencial } = pedidoController;

test('pedido presencial aceita CPF e datas válidos com cliente físico booleano', () => {
  assert.equal(validarDadosPedidoPresencial({
    cpf_cliente: '529.982.247-25',
    data_pedido: '2026-11-19',
    data_prevista_entrega: '2026-11-25',
    forma_pagamento_id: '1',
    status_pedido: 'Em preparação',
    itens: [{ id_livro: '16', quantidade: 1 }],
    cliente_fisico: true
  }), true);
});

test('pedido presencial rejeita CPF inválido, data impossível e cliente físico não booleano', () => {
  const base = {
    cpf_cliente: '529.982.247-25',
    forma_pagamento_id: '1',
    status_pedido: 'Em preparação',
    itens: [{ id_livro: '16', quantidade: 1 }]
  };
  assert.equal(validarDadosPedidoPresencial({ ...base, cpf_cliente: '111.111.111-11' }), false);
  assert.equal(validarDadosPedidoPresencial({ ...base, data_pedido: '2026-02-31' }), false);
  assert.equal(validarDadosPedidoPresencial({
    ...base, data_pedido: '2026-11-25', data_prevista_entrega: '2026-11-24'
  }), false);
  assert.equal(validarDadosPedidoPresencial({ ...base, cliente_fisico: 'false' }), false);
  assert.equal(validarDadosPedidoPresencial({ ...base, itens: [] }), false);
});

test('a validação do formulário de livros reconhece IDs inteiros válidos', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const values = {
    id_livro: '16', titulo: 'Império dos Malditos', autor: 'Autora Teste',
    isbn: '', editora: 'DarkSide Books', paginas: '300', ano: '2024',
    preco: '49.90', estoque: '3', genero_id: '2', sinopse: ''
  };
  const context = {
    window: { location: { origin: 'http://localhost:3000' }, addEventListener() {} },
    document: { getElementById(id) { return { value: values[id] ?? '' }; } }
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../../gerente/frontend/js/livros.js'), 'utf8');
  vm.runInNewContext(source, context);
  assert.ok(context.coletarDadosLivro());
});
