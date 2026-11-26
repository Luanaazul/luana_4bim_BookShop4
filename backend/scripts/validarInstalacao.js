const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { Client } = require('pg');
const pool = require('../database');

const raiz = path.resolve(__dirname, '../..');
const nomeBanco = 'bookshop_teste_' + randomBytes(6).toString('hex');
const capasCriadas = new Set();
const tabelas = [
  'cargos', 'clientes', 'enderecos_clientes', 'formas_pagamento', 'funcionarios', 'generos',
  'lancamentos', 'livros', 'pagamentos', 'pedido_eventos', 'pedido_has_livro', 'pedidos', 'pessoas',
  'promocoes', 'solicitacoes_cancelamento', 'tokens_recuperacao_senha',
];

function clienteHttp(base) {
  let cookies = '';
  return async (rota, esperado, { metodo = 'GET', dados } = {}) => {
    const multipart = dados instanceof FormData;
    const resposta = await fetch(base + rota, {
      method: metodo,
      redirect: 'manual',
      headers: {
        Cookie: cookies,
        ...(dados && !multipart ? { 'Content-Type': 'application/json' } : {}),
      },
      body: multipart ? dados : dados && JSON.stringify(dados),
      signal: AbortSignal.timeout(10_000),
    });
    const recebidos = resposta.headers.getSetCookie();
    if (recebidos.length) {
      assert(recebidos.every((cookie) => /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie)));
      cookies = recebidos.map((cookie) => cookie.split(';')[0]).join('; ');
    }
    assert.equal(resposta.status, esperado, metodo + ' ' + rota);
    if (resposta.headers.get('content-type')?.includes('application/json')) return resposta.json();
    return resposta.text();
  };
}

async function validarBanco(db) {
  const { rows } = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  assert.deepEqual(rows.map(({ tablename }) => tablename), tabelas);
  for (const tabela of tabelas) {
    const { rows: [linha] } = await db.query('SELECT COUNT(*)::int AS n FROM public.' + tabela);
    if (!['pedido_eventos', 'solicitacoes_cancelamento', 'promocoes'].includes(tabela)) assert(linha.n >= 10, tabela + ' precisa ter pelo menos dez registros');
    console.log(tabela, linha.n);
  }
  const restricoes = await db.query(`
    SELECT conrelid::regclass::text AS origem, confrelid::regclass::text AS destino,
           contype, convalidated, pg_get_constraintdef(oid) AS definicao
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype IN ('p','f','u')
  `);
  const constraints = restricoes.rows;
  assert(constraints.every(({ convalidated }) => convalidated));
  assert.equal(constraints.filter(({ contype }) => contype === 'p').length, tabelas.length);
  assert.equal(constraints.filter(({ contype }) => contype === 'f').length, 16);
  assert(!constraints.some(({ origem, contype }) => origem === 'generos' && contype === 'f'));
  assert(constraints.some((r) => r.origem === 'livros' && r.destino === 'generos'));
  assert(constraints.some((r) => r.origem === 'pagamentos' && r.destino === 'pedidos'));
  assert(constraints.some((r) => r.origem === 'pagamentos' && r.definicao === 'PRIMARY KEY (pedido_id_pedido)'));
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pessoas WHERE left(cpf_pessoa, 12) = '000.000.000-'")).rows[0].n, 11);
  const divergencias = await db.query(`
    SELECT p.id_pedido FROM pedidos p
    LEFT JOIN pagamentos pg ON pg.pedido_id_pedido = p.id_pedido
    LEFT JOIN pedido_has_livro i ON i.pedido_id_pedido = p.id_pedido
    LEFT JOIN enderecos_clientes e ON e.id_endereco = p.endereco_entrega_id
    GROUP BY p.id_pedido, pg.pedido_id_pedido, e.id_endereco
    HAVING pg.pedido_id_pedido IS NULL OR pg.valor_total_pagamento <> p.total_pedido
       OR COUNT(i.livro_id_livro) = 0 OR SUM(i.total_item) <> p.subtotal_pedido
       OR p.subtotal_pedido - p.desconto_pedido + p.frete_pedido <> p.total_pedido
       OR e.id_endereco IS NULL OR e.rua <> p.endereco_entrega_rua
       OR e.cliente_pessoa_cpf_pessoa <> p.cliente_pessoa_cpf_pessoa
  `);
  assert.equal(divergencias.rowCount, 0);
  console.log('Carga, PK, FK, relações e totais conferidos.');
}

async function validarHttp(base, db) {
  const publico = clienteHttp(base);
  const cliente = clienteHttp(base);
  const gerente = clienteHttp(base);
  const outro = clienteHttp(base);
  const funcionario = clienteHttp(base);
  const senhaDemo = 'BookShop123!';
  const post = (dados) => ({ metodo: 'POST', dados });
  const put = (dados) => ({ metodo: 'PUT', dados });
  const login = (usuario, senha) => post({ nome_usuario_pessoa: usuario, senha });
  const cadastro = {
    cpf_pessoa: '529.982.247-25', nome_pessoa: 'Leitora de Teste',
    nome_usuario_pessoa: 'leitora.teste', senha_pessoa: 'LeitoraTeste123!',
    data_nascimento_pessoa: '2000-01-01', email_pessoa: 'leitora@bookshop.test',
  };

  await publico('/', 302);
  const paginas = [
    '/vitrine/index.html', '/vitrine/detalhes/detalhes.html', '/cadastro.html',
    '/carrinho/carrinho.html', '/finalizar/finalizar.html', '/meus-pedidos.html',
    '/pedido-confirmado.html', '/acesso/index.html', '/login/login.html',
    '/login/recuperar-senha.html', '/login/redefinir-senha.html',
  ];
  for (const pagina of paginas) assert.match(await publico(pagina, 200), /Turma M32/);
  await publico('/css/identificacao.css', 200);
  await publico('/gerente/menu/index.html', 302);
  await publico('/pedidos/meus', 401);
  await publico('/perfil', 401);
  await publico('/perfil/foto', 401);
  await publico('/login', 401, login('cliente.demo', 'incorreta'));
  assert.equal((await publico('/livros', 200)).length, 15);
  await publico('/livros/1', 200);
  await publico('/imagens/imperio.jpe', 200);
  await publico('/redefinir-senha', 400, post({ token: 'a'.repeat(64), senha: cadastro.senha_pessoa }));

  await cliente('/cadastro', 400, post({ ...cadastro, cpf_pessoa: '000.000.000-01' }));
  await cliente('/cadastro', 201, post({ ...cadastro, cpf_pessoa: cadastro.cpf_pessoa.replace(/\D/g, '') }));
  assert.equal((await cliente('/login/sessao', 200)).autenticada, true);
  await cliente('/logout', 200, post());
  await cliente('/pedidos/meus', 401);
  assert.equal((await cliente('/login', 200, login(cadastro.nome_usuario_pessoa, cadastro.senha_pessoa))).primeira_compra, true);
  await cliente('/gerente/menu/index.html', 403);
  await cliente('/pedidos', 403);
  await cliente('/livros', 403, post({}));
  await cliente('/compras/2147483648/confirmar', 400, post());
  assert.equal((await outro('/login', 200, login('cliente.demo', senhaDemo))).primeira_compra, false);
  assert((await outro('/pedidos/meus', 200)).length > 0);
  console.log('Páginas públicas, sessão, cadastro, login e controle de acesso conferidos.');

  const endereco = await cliente('/enderecos', 201, post({
    cep: '80010-000', rua: 'Rua dos Testes', numero: '12', bairro: 'Centro',
    cidade: 'Curitiba', estado: 'PR',
  }));
  const enderecoId = Number(endereco.id_endereco);
  assert.equal((await cliente('/enderecos', 200)).length, 1);
  const itens = [{ id_livro: 1, quantidade: 2 }];
  assert.equal((await cliente('/carrinho/validar', 200, post({ itens }))).subtotal, 119.8);
  assert.equal((await cliente('/carrinho/validar', 200, post({ itens: [] }))).valido, false);
  await cliente('/carrinho/validar', 400, post({ itens: [{ id_livro: 2147483648, quantidade: 1 }] }));
  const compra = { itens, forma_pagamento_id: 1, endereco_id: enderecoId, tentativa_id: randomUUID() };
  const cotacao = await cliente('/compras/cotacao', 200, post(compra));
  assert.equal(Number(cotacao.total_pedido), 69.9);
  assert.equal(cotacao.desconto_registro.codigo, 'primeira_compra');
  const resumo = async (lista, promocao_codigo) =>
    cliente('/carrinho/validar', 200, post({ itens: lista, resumo: true, promocao_codigo }));
  const primeira = await resumo(itens);
  assert.equal(primeira.primeira_compra.percentual, 50);
  assert.equal(primeira.resumo.desconto_pedido, 59.9);
  assert.deepEqual(primeira.promocoes, []);
  assert.equal((await resumo([{ id_livro: 1, quantidade: 1 }])).resumo.desconto_pedido, 29.95);
  assert.equal((await resumo([])).resumo.total_pedido, 0);
  const pendenteSemCompra = await cliente('/compras/preparar', 200, post({ ...compra, tentativa_id: randomUUID() }));
  await cliente('/pedidos/' + pendenteSemCompra.pedido.id_pedido + '/cancelar', 200, post({}));
  assert.equal((await resumo(itens)).primeira_compra.percentual, 50);
  const concorrente = await cliente('/compras/preparar', 200, post({ ...compra, tentativa_id: randomUUID() }));
  const estoqueInicial = (await publico('/livros/1', 200)).estoque;
  const { pedido } = await cliente('/compras/preparar', 200, post(compra));
  assert.equal(pedido.status_pedido, 'Aguardando confirmação');
  assert.equal((await cliente('/compras/preparar', 200, post(compra))).pedido.id_pedido, pedido.id_pedido);
  assert.equal((await publico('/livros/1', 200)).estoque, estoqueInicial);
  const id = pedido.id_pedido;
  await outro('/compras/' + id + '/confirmar', 404, post());
  await outro('/pedidos/' + id, 404);
  await cliente('/compras/' + id + '/confirmar', 200, post());
  await cliente('/compras/' + id + '/confirmar', 200, post());
  await cliente('/compras/' + concorrente.pedido.id_pedido + '/confirmar', 409, post());
  await cliente('/pedidos/' + concorrente.pedido.id_pedido + '/cancelar', 200, post({}));
  assert.equal((await publico('/livros/1', 200)).estoque, estoqueInicial - 2);
  assert.equal((await resumo(itens)).primeira_compra, null);
  assert.equal((await cliente('/compras/cotacao', 200, post(compra))).total_pedido, 123.81);
  const { rows: [beneficio] } = await db.query('SELECT desconto_registro, primeira_compra_utilizada FROM pedidos WHERE id_pedido = $1', [id]);
  assert.equal(beneficio.primeira_compra_utilizada, true);
  assert.equal(beneficio.desconto_registro.percentual, 50);
  const perfil = await cliente('/perfil', 200);
  assert.equal(Number(perfil.livros), 2);
  assert.equal(Number(perfil.total), 69.9);
  assert.equal(perfil.tema, 'padrao');
  await cliente('/perfil/tema', 400, put({ tema:'invalido' }));
  assert.equal((await cliente('/perfil/tema', 200, put({ tema:'preto-vermelho' }))).tema, 'preto-vermelho');
  assert.equal((await cliente('/perfil/tema', 200)).tema, 'preto-vermelho');
  assert.equal((await outro('/perfil/tema', 200)).tema, 'padrao');
  const avatar = new FormData();
  avatar.set('foto', new Blob([await fs.readFile(path.join(raiz,'shared/book-covers/1984.jpe'))], { type:'image/jpeg' }), 'foto.jpg');
  await cliente('/perfil/foto', 200, post(avatar));
  await cliente('/perfil/foto', 200);
  await outro('/perfil/foto', 404);
  assert.equal((await cliente('/perfil', 200)).tem_foto, true);
  await cliente('/perfil/foto', 204, { metodo:'DELETE' });
  await cliente('/perfil/foto', 404);
  await cliente('/enderecos/' + enderecoId, 200, put({ rua: 'Rua Atualizada' }));
  const historico = await db.query(`
    SELECT p.endereco_entrega_rua, p.total_pedido, i.quantidade
    FROM pedidos p JOIN pedido_has_livro i ON i.pedido_id_pedido = p.id_pedido
    WHERE p.id_pedido = $1
  `, [id]);
  assert.deepEqual(historico.rows[0], { endereco_entrega_rua: 'Rua dos Testes', total_pedido: '69.90', quantidade: 2 });
  assert.equal((await cliente('/pedidos/meus', 200)).filter(p => p.status_pedido !== 'Cancelado').length, 1);
  const cartao = {
    itens: [{ id_livro: 2, quantidade: 1 }], forma_pagamento_id: 2,
    endereco_id: enderecoId, tentativa_id: randomUUID(),
  };
  const { pedido: pedidoCartao } = await cliente('/compras/preparar', 200, post(cartao));
  assert.equal(Number(pedidoCartao.total_pedido), 49.9);
  await cliente('/compras/' + pedidoCartao.id_pedido + '/confirmar', 200, post());
  assert.equal((await cliente('/pedidos/meus', 200)).filter(p => p.status_pedido !== 'Cancelado').length, 2);
  console.log('Carrinho, endereço, checkout PIX e cartão, histórico e baixa única de estoque conferidos.');

  assert.equal((await gerente('/login', 200, login('gerente.demo', senhaDemo))).primeira_compra, false);
  await cliente('/compras/bookfriday', 403);
  await gerente('/compras/bookfriday', 400, put({ ativa: true }));
  const periodo = { ativa: true, inicio: new Date(Date.now() - 60000).toISOString(), termino: new Date(Date.now() + 60000).toISOString() };
  await gerente('/compras/bookfriday', 200, put(periodo));
  assert.equal((await resumo(itens)).promocoes[0].percentual, 25);
  assert.equal((await resumo(itens, 'bookfriday')).resumo.desconto_pedido, 29.95);
  const promo = await cliente('/compras/cotacao', 200, post({ ...compra, promocao_codigo: 'bookfriday', desconto_pedido: 119.8 }));
  assert.equal(promo.total_pedido, 99.85);
  const cupom = await cliente('/compras/preparar', 200, post({ ...compra, promocao_codigo: 'bookfriday', tentativa_id: randomUUID() }));
  assert.equal(cupom.pedido.desconto_registro.percentual, 25);
  await gerente('/compras/bookfriday', 200, put({ ...periodo, ativa: false }));
  await cliente('/compras/' + cupom.pedido.id_pedido + '/confirmar', 409, post());
  await cliente('/pedidos/' + cupom.pedido.id_pedido + '/cancelar', 200, post({}));
  await funcionario('/login', 200, login('ana.demo', senhaDemo));
  await funcionario('/acesso/funcionario', 302);
  await funcionario('/gerente/pedidos/pedidos.html', 200);
  await funcionario('/gerente/menu/index.html', 403);
  await funcionario('/pedidos/' + id, 404);
  assert.equal((await funcionario('/pedidos', 200)).length, 0);
  for (const area of ['menu/index', 'livros/livros', 'pedidos/pedidos', 'pessoas/pessoas', 'cargos/cargos', 'lancamentos/lancamentos']) {
    assert.match(await gerente('/gerente/' + area + '.html', 200), /Turma M32/);
  }
  await gerente('/admin-imagens/menu1.jpe', 200);
  for (const rota of ['/cargos', '/generos', '/lancamentos', '/pessoas']) {
    assert((await gerente(rota, 200)).length >= 10);
  }
  const listadas = await gerente('/pessoas', 200);
  const pessoa = listadas.find(p => p.cpf_pessoa === cadastro.cpf_pessoa);
  assert.equal(pessoa.enderecos[0].rua, 'Rua Atualizada');
  assert.match(pessoa.data_cadastro_cliente, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal('renda_cliente' in pessoa, false);
  await gerente('/pessoas/' + cadastro.cpf_pessoa, 400, put({ nome_pessoa: 'Nome indevido' }));
  await gerente('/pessoas/' + cadastro.cpf_pessoa, 404, put({ salario_funcionario: 3000 }));
  await funcionario('/pessoas/000.000.000-03', 403, put({ salario_funcionario: 3000 }));
  const vinculo = await gerente('/pessoas/000.000.000-03', 200, put({ salario_funcionario: 3000, cargo_id_cargo: 4 }));
  assert.equal(vinculo.salario_funcionario, '3000.00');
  assert.equal(vinculo.cargo_id_cargo, 4);
  await gerente('/pedidos', 200);
  await gerente('/pedidos/' + id, 409, put({ dados_presenciais: { nome_cliente: 'Nome indevido' } }));
  await gerente('/pedidos/' + id, 200);
  const pagoOriginal = await db.query('SELECT * FROM pagamentos WHERE pedido_id_pedido = $1', [id]);
  const reembolso = await cliente('/pedidos/' + id + '/cancelar', 200, post({ motivo: 'Cancelamento de teste' }));
  assert.equal(reembolso.percentual_reembolso, 100);
  assert.equal(reembolso.valor_reembolso, 69.9);
  assert.equal((await resumo(itens)).primeira_compra, null);
  await cliente('/pedidos/' + id + '/cancelar', 409, post({}));
  assert.equal((await publico('/livros/1', 200)).estoque, estoqueInicial);
  assert.deepEqual((await db.query('SELECT * FROM pagamentos WHERE pedido_id_pedido = $1', [id])).rows, pagoOriginal.rows);
  assert(!(await cliente('/pedidos/meus', 200)).some(p => p.id_pedido === id));
  assert.equal((await gerente('/pedidos/' + id, 200)).status_pedido, 'Cancelado');
  const cartaoId = pedidoCartao.id_pedido;
  await gerente('/pedidos/' + cartaoId, 403, put({ status_pedido: 'Cancelado' }));
  await gerente('/pedidos/' + cartaoId + '/cancelamento/decisao', 409, post({ decisao: 'Aprovada' }));
  const estoqueEnviado = (await publico('/livros/2', 200)).estoque;
  const detalheGerente = await gerente('/pedidos/' + cartaoId, 200);
  assert(detalheGerente.status_disponiveis.includes('Confirmado para entrega'));
  assert(!detalheGerente.status_disponiveis.includes('Cancelado'));
  const previsao = new Date(Date.now() + 17 * 86400000).toISOString().slice(0, 10);
  await gerente('/pedidos/' + cartaoId, 200, put({ status_pedido: 'Confirmado para entrega', previsao_entrega: previsao }));
  const listaCliente = await cliente('/pedidos/meus', 200);
  const pedidoCliente = listaCliente.find(p => p.id_pedido === cartaoId);
  assert.equal(pedidoCliente.status_pedido, 'Confirmado para entrega');
  assert.equal(pedidoCliente.data_prevista_entrega, previsao);
  const detalheCliente = await cliente('/pedidos/' + cartaoId, 200);
  assert(detalheCliente.eventos.some(e => e.estado === 'Confirmado para entrega' && e.motivo.includes('Previsão de entrega')));

  await gerente('/pedidos/' + cartaoId, 200, put({ status_pedido: 'Enviado para entrega', motivo: 'Saiu para entrega' }));
  await cliente('/pedidos/' + cartaoId + '/cancelar', 400, post({ motivo: '   ' }));
  const anexo = new FormData();
  anexo.append('motivo', 'Livro com dano');
  anexo.append('anexo', new Blob([await fs.readFile(path.join(raiz, 'shared/book-covers/1984.jpe'))], { type: 'image/jpeg' }), 'foto.jpg');
  await cliente('/pedidos/' + cartaoId + '/cancelar', 202, post(anexo));
  await cliente('/pedidos/' + cartaoId + '/cancelar', 409, post({}));
  assert.equal((await gerente('/pedidos/avisos', 200))[0].motivo, 'Livro com dano');
  assert.equal((await cliente('/pedidos/' + cartaoId, 200)).status_pedido, 'Enviado para entrega');
  await cliente('/pedidos/' + cartaoId + '/cancelamento/anexo', 403);
  await gerente('/pedidos/' + cartaoId + '/cancelamento/anexo', 200);
  await funcionario('/pedidos/' + cartaoId + '/cancelamento/decisao', 403, post({ decisao: 'Aprovada' }));
  const parcial = await gerente('/pedidos/' + cartaoId + '/cancelamento/decisao', 200, post({ decisao: 'Aprovada' }));
  await gerente('/pedidos/' + cartaoId + '/cancelamento/decisao', 409, post({ decisao: 'Aprovada' }));
  assert.equal(parcial.percentual_reembolso, 75);
  assert.equal(parcial.valor_reembolso, 37.43);
  assert.equal((await publico('/livros/2', 200)).estoque, estoqueEnviado);
  const detalhes = await cliente('/pedidos/' + cartaoId, 200);
  assert.equal(detalhes.status_pagamento, 'Simulado');
  assert.equal(detalhes.eventos.find(e => e.percentual != null).situacao, 'Simulado');
  assert(detalhes.eventos.some(e => e.motivo === 'Saiu para entrega'));

  const { pedido: pedidoAtrasado } = await cliente('/compras/preparar', 200, post({ ...cartao, tentativa_id: randomUUID() }));
  const atrasadoId = pedidoAtrasado.id_pedido;
  await gerente('/pedidos/' + atrasadoId, 409, put({ status_pedido: 'Em preparação' }));
  await cliente('/compras/' + atrasadoId + '/confirmar', 200, post());
  await gerente('/pedidos/' + atrasadoId, 400, put({ status_pedido: 'Atraso' }));
  await gerente('/pedidos/' + atrasadoId, 200, put({ status_pedido: 'Confirmado para entrega' }));
  await gerente('/pedidos/' + atrasadoId, 200, put({ status_pedido: 'Enviado para entrega' }));
  await gerente('/pedidos/' + atrasadoId, 200, put({ status_pedido: 'Atraso', motivo: 'Atraso após envio' }));
  const estoqueAtrasado = (await publico('/livros/2', 200)).estoque;
  await cliente('/pedidos/' + atrasadoId + '/cancelar', 202, post({ motivo: 'Atraso no envio' }));
  const atrasado = await gerente('/pedidos/' + atrasadoId + '/cancelamento/decisao', 200, post({ decisao: 'Aprovada' }));
  assert.equal(atrasado.percentual_reembolso, 75);
  assert.equal((await publico('/livros/2', 200)).estoque, estoqueAtrasado);
  assert.equal((await cliente('/pedidos/' + atrasadoId, 200)).eventos.find(e => e.percentual != null).motivo, 'Atraso na entrega');

  const { pedido: emAnalise } = await cliente('/compras/preparar', 200, post({ ...cartao, tentativa_id: randomUUID() }));
  await cliente('/compras/' + emAnalise.id_pedido + '/confirmar', 200, post());
  await gerente('/pedidos/' + emAnalise.id_pedido, 200, put({ status_pedido: 'Confirmado para entrega' }));
  await cliente('/pedidos/' + emAnalise.id_pedido + '/cancelar', 202, post({ motivo: 'Motivo opcional' }));
  await gerente('/pedidos/' + emAnalise.id_pedido + '/cancelamento/decisao', 400, post({ decisao: 'Recusada' }));
  await gerente('/pedidos/' + emAnalise.id_pedido + '/cancelamento/decisao', 200, post({ decisao: 'Recusada', motivo: 'Entrega mantida' }));
  const mantido = await cliente('/pedidos/' + emAnalise.id_pedido, 200);
  assert.equal(mantido.status_pedido, 'Confirmado para entrega');
  assert.equal(mantido.solicitacao_cancelamento, 'Recusada');
  const antesConfirmado = (await publico('/livros/2', 200)).estoque;
  const { pedido: confirmado } = await cliente('/compras/preparar', 200, post({ ...cartao, tentativa_id: randomUUID() }));
  await cliente('/compras/' + confirmado.id_pedido + '/confirmar', 200, post());
  await gerente('/pedidos/' + confirmado.id_pedido, 200, put({ status_pedido: 'Confirmado para entrega' }));
  await cliente('/pedidos/' + confirmado.id_pedido + '/cancelar', 202, post({ motivo: 'Solicitação antes do despacho' }));
  const aprovado = await gerente('/pedidos/' + confirmado.id_pedido + '/cancelamento/decisao', 200, post({ decisao: 'Aprovada' }));
  assert.equal(aprovado.percentual_reembolso, 75);
  assert.equal((await publico('/livros/2', 200)).estoque, antesConfirmado);
  const { pedido: semPagamento } = await cliente('/compras/preparar', 200, post({ ...cartao, tentativa_id: randomUUID() }));
  const { pedido: pendenteGerente } = await cliente('/compras/preparar', 200, post({ ...cartao, tentativa_id: randomUUID() }));
  const urlGerente = '/compras/' + pendenteGerente.id_pedido + '/confirmar-pagamento';
  await cliente(urlGerente, 403, post());
  await funcionario(urlGerente, 403, post());
  await gerente(urlGerente, 200, post());
  const resultadoGerente = await cliente('/pedidos/' + pendenteGerente.id_pedido, 200);
  assert.equal(resultadoGerente.status_pedido, 'Em preparação');
  assert(resultadoGerente.status_disponiveis.includes('Confirmado para entrega'));
  assert(resultadoGerente.eventos.some(e => e.estado === 'Em preparação' && e.autor));
  const pendenteId = semPagamento.id_pedido;
  assert.deepEqual((await gerente('/pedidos/' + pendenteId, 200)).status_disponiveis, []);
  const pendente = await cliente('/pedidos/' + pendenteId + '/cancelar', 200, post({}));
  assert.equal(pendente.percentual_reembolso, null);
  assert.equal((await cliente('/pedidos/' + pendenteId, 200)).status_pagamento, 'Cancelado');

  await cliente('/pedidos/' + pendenteId + '/cancelar', 409, post({}));
  await cliente('/pedidos/' + pendenteId + '/cancelar', 409, post({}));
  const eventosPendentes = (await cliente('/pedidos/' + pendenteId, 200)).eventos;
  assert.equal(eventosPendentes.filter(e => e.motivo.startsWith('Cancelamento não realizado')).length, 1);
  await outro('/pedidos/' + pendenteId + '/ocultar', 404, post({}));
  await cliente('/pedidos/' + emAnalise.id_pedido + '/ocultar', 404, post({}));
  const pagamentoPendente = (await db.query('SELECT * FROM pagamentos WHERE pedido_id_pedido = $1', [pendenteId])).rows;
  await cliente('/pedidos/' + pendenteId + '/ocultar', 200, post({}));
  await cliente('/pedidos/' + pendenteId + '/ocultar', 200, post({}));
  assert(!(await cliente('/pedidos/meus', 200)).some(p => p.id_pedido === pendenteId));
  assert.equal((await gerente('/pedidos/' + pendenteId, 200)).status_pedido,'Cancelado');
  assert.deepEqual((await db.query('SELECT * FROM pagamentos WHERE pedido_id_pedido = $1', [pendenteId])).rows,pagamentoPendente);
  const papel = (await gerente('/pedidos/formas-pagamento', 200)).find(p => p.nome_forma_pagamento === 'Papel/Nota');
  assert(papel);
  const cadastroPresencial = {
    nome_cliente: 'Cliente presencial de teste', telefone: '41999990000',
    forma_pagamento_id: papel.id_forma_pagamento, itens: [{ id_livro: 1, quantidade: 1 }], tentativa_id: randomUUID(), cliente_fisico: true,
  };
  await gerente('/pedidos', 400, post({ ...cadastroPresencial, entrega: true }));
  await gerente('/pedidos', 400, post({ ...cadastroPresencial, cliente_fisico: false }));
  await gerente('/pedidos', 400, post({ ...cadastroPresencial, forma_pagamento_id: 4 }));
  assert((await gerente('/pedidos/clientes?nome=Leitora', 200)).some(p => p.nome === cadastro.nome_pessoa));
  const presencial = await funcionario('/pedidos', 201, post(cadastroPresencial));
  assert.equal((await gerente('/pedidos', 201, post(cadastroPresencial))).id_pedido, presencial.id_pedido);
  const rotaPresencial = '/pedidos/' + presencial.id_pedido;
  const leitura = await funcionario(rotaPresencial, 200);
  await funcionario(rotaPresencial, 403, put({ status_pedido: 'Cancelado' }));
  assert.equal(leitura.cpf_cliente, null);
  assert.equal(leitura.nome_forma_pagamento, 'Papel/Nota');
  assert(leitura.itens[0].caminho_imagem_livro);
  assert((await gerente('/pedidos', 200)).some(p => p.id_pedido === presencial.id_pedido));
  assert.equal(leitura.status_pagamento, 'Simulado');
  assert.equal((await gerente('/pedidos?origem=presencial', 200)).length, 1);
  assert(!(await gerente('/pedidos?origem=online', 200)).some(p => p.id_pedido === presencial.id_pedido));
  await gerente(rotaPresencial, 200, put({ dados_presenciais: {
    nome_cliente: 'Nome corrigido', entrega: true, cep: '80010000', rua: 'Rua de Teste',
    numero: '12', bairro: 'Centro', cidade: 'Curitiba', estado: 'pr',
  } }));
  assert.equal((await gerente(rotaPresencial, 200)).endereco_entrega.cep, '80010-000');
  assert.equal((await gerente(rotaPresencial, 200)).nome_cliente, 'Nome corrigido');
  await gerente(rotaPresencial, 200, put({ status_pedido: 'Atraso', motivo: 'Entrega atrasada' }));
  assert.equal((await gerente(rotaPresencial, 200, put({ status_pedido: 'Cancelado' }))).percentual_reembolso, 100);
  assert.equal((await publico('/livros/1', 200)).estoque, estoqueInicial);
  await gerente(rotaPresencial, 409, put({ status_pedido: 'Cancelado' }));
  console.log('Cancelamentos online de 100% e 75%, estoque, pagamento original e CRUD presencial conferidos.');
  await cliente('/promocoes', 403);
  await funcionario('/promocoes', 403);
  const catalogo = await gerente('/promocoes/catalogo', 200);
  const l1 = catalogo.find(l => l.id_livro === 1);
  const l2 = catalogo.find(l => l.id_livro === 2);
  const inicio = new Date(Date.now() - 60000).toISOString();
  const futuro = new Date(Date.now() + 86400000).toISOString();
  const passado = new Date(Date.now() - 86400000).toISOString();
  const dadosCampanha = { nome: 'Campanha de integração', tipo: 'Teste', percentual: 30,
    ativa: true, combinavel: true, combinacao: 'E', inicio, termino: null, criterios: { livros: [l1.id_livro] } };
  const prever = criterios => gerente('/promocoes/previa', 200, post({ ...dadosCampanha, ...criterios }));
  const apenas = await prever({ criterios: { livros: [l1.id_livro], autores: [l1.autor], generos: [l1.genero_id],
    editoras: [l1.editora], minimo: Number(l1.preco), maximo: Number(l1.preco) } });
  assert.equal(apenas.length, 1);
  assert.equal(apenas[0].preco_promocional, 41.93);
  const ou = await prever({ combinacao: 'OU', criterios: { livros: [l1.id_livro], autores: [l2.autor] } });
  assert(ou.some(l => l.id_livro === l1.id_livro));
  assert(ou.some(l => l.id_livro === l2.id_livro));
  assert.deepEqual(await prever({ criterios: { livros: [l1.id_livro], minimo: Number(l1.preco), minimo_exclusivo: true } }), []);
  await gerente('/promocoes', 400, post({ ...dadosCampanha, criterios: { minimo: 999999 } }));
  await gerente('/promocoes', 400, post({ ...dadosCampanha, criterios: { livros: [2147483647] } }));
  const primeiraCampanha = await gerente('/promocoes', 201, post({ ...dadosCampanha, id_exibicao:7 }));
  assert.equal(primeiraCampanha.id_exibicao, 7);
  await gerente('/promocoes', 409, post({ ...dadosCampanha, id_exibicao:7 }));
  const rotaCampanha = '/promocoes/' + primeiraCampanha.codigo;
  assert.equal((await gerente(rotaCampanha, 200)).livros.length, 1);
  let editada = await gerente(rotaCampanha, 200, put({ ...dadosCampanha, nome: 'Campanha revisada', inicio: futuro }));
  assert.equal(editada.situacao, 'Programado');
  assert.equal(editada.id_exibicao, 7);
  assert((await gerente('/promocoes?nome=revisada&situacao=Programado', 200)).some(p => p.codigo === editada.codigo));
  editada = await gerente(rotaCampanha, 200, put({ ...dadosCampanha, inicio: passado, termino: inicio }));
  assert.equal(editada.situacao, 'Expirado');
  const carrinhoCampanha = [{ id_livro: 1, quantidade: 1 }, { id_livro: 2, quantidade: 1 }];
  assert(!(await resumo(carrinhoCampanha)).promocoes.some(p => p.codigo === editada.codigo));
  editada = await gerente(rotaCampanha, 200, put(dadosCampanha));
  assert.equal(editada.situacao, 'Ativo');
  const ativacao = (ativa) => gerente(rotaCampanha + '/ativacao', 200, { metodo:'PATCH', dados:{ ativa } });
  assert.equal((await ativacao(false)).situacao, 'Inativo');
  assert.equal((await ativacao(true)).situacao, 'Ativo');
  const segunda = await gerente('/promocoes', 201, post({ ...dadosCampanha, nome:'Campanha sobreposta', percentual: 20,
    criterios:{ livros:[1,2] } }));
  const exclusiva = await gerente('/promocoes', 201, post({ ...dadosCampanha, nome:'Campanha exclusiva', combinavel:false }));
  await cliente('/compras/cotacao', 409, post({ ...cartao, itens:carrinhoCampanha, promocao_codigos:[exclusiva.codigo, segunda.codigo] }));
  assert.equal((await publico('/promocoes/vitrine', 200))[1].percentual, 30);
  const codigos = [primeiraCampanha.codigo, segunda.codigo];
  const cotacaoCombinada = await cliente('/compras/cotacao', 200, post({ ...cartao, itens:carrinhoCampanha, promocao_codigos:codigos }));
  assert.deepEqual(cotacaoCombinada.desconto_registro.itens.map(i => i.percentual), [30,20]);
  const soPrimeiraCampanha = await cliente('/compras/cotacao', 200, post({ ...cartao, itens:carrinhoCampanha, promocao_codigos:[primeiraCampanha.codigo] }));
  assert.deepEqual(soPrimeiraCampanha.desconto_registro.itens.map(i => i.id_livro), [1]);
  const compraCampanha = { ...cartao, itens:carrinhoCampanha, promocao_codigos:codigos, tentativa_id:randomUUID() };
  const {pedido: pedidoCampanha} = await cliente('/compras/preparar', 200, post(compraCampanha));
  await cliente('/compras/preparar', 200, post(compraCampanha));
  await cliente('/compras/' + pedidoCampanha.id_pedido + '/confirmar', 200, post());
  await gerente(rotaCampanha, 204, { metodo:'DELETE' });
  await gerente(rotaCampanha, 404);
  const preservado = await cliente('/pedidos/' + pedidoCampanha.id_pedido, 200);
  assert.deepEqual(preservado.desconto_registro, cotacaoCombinada.desconto_registro);
  assert.equal(Number((await publico('/livros/1', 200)).preco), Number(l1.preco));
  const novoCpf = '11144477735';
  const primeiraVez = clienteHttp(base);
  await primeiraVez('/cadastro', 201, post({ ...cadastro, cpf_pessoa:novoCpf, nome_usuario_pessoa:'novo.campanha', email_pessoa:'campanha@example.test' }));
  const prioridade = await primeiraVez('/carrinho/validar', 200, post({ itens:carrinhoCampanha, resumo:true, promocao_codigos:[segunda.codigo] }));
  assert.equal(prioridade.resumo.desconto_registro.codigo,'primeira_compra');
  console.log('CRUD de campanhas, datas, critérios, prioridade por livro e histórico após exclusão conferidos.');

  const dinamica = await gerente('/promocoes', 201, post({ ...dadosCampanha, nome:'Por gênero', criterios:{ generos:[1] } }));
  const contagem = (await gerente('/promocoes/' + dinamica.codigo, 200)).livros.length;
  const livro = { id_livro: 150, titulo: 'Livro de Teste', autor: 'Autora Fictícia', paginas: 100, preco: 30, estoque: 4, genero_id: 1 };
  await gerente('/livros', 201, post({ ...livro, editora: 'Editora de Teste' }));
  assert.equal((await gerente('/promocoes/' + dinamica.codigo, 200)).livros.length, contagem + 1);
  const salvo = await publico('/livros/150', 200);
  assert.equal(salvo.editora, 'Editora de Teste');
  const idMenor = 149;
  await gerente('/livros', 201, post({ ...livro, id_livro: idMenor, editora: salvo.editora }));
  const cadastradoDepois = await publico('/livros/' + idMenor, 200);
  assert(Number(cadastradoDepois.ordem_cadastro) > Number(salvo.ordem_cadastro));
  await gerente('/livros/' + idMenor, 204, { metodo: 'DELETE' });
  await gerente('/livros/150', 200, put({ ...livro, titulo: 'Livro Editado', estoque: 5 }));
  const dados = new FormData();
  dados.append('imagem', new Blob([await fs.readFile(path.join(raiz, 'shared/book-covers/1984.jpe'))], { type: 'image/jpeg' }), 'capa.jpg');
  const capa = await gerente('/livros/150/imagem', 201, post(dados));
  capasCriadas.add(path.basename(capa.caminho));
  await publico(capa.caminho, 200);
  const editado = await publico('/livros/150', 200);
  assert.equal(editado.titulo, 'Livro Editado');
  assert.equal(editado.estoque, 5);
  assert.equal(editado.caminho_imagem_livro, capa.caminho);
  const capaNova = await gerente('/livros/150/imagem', 201, post(dados));
  capasCriadas.add(path.basename(capaNova.caminho));
  assert.notEqual(capa.caminho, capaNova.caminho);
  await publico(capa.caminho, 200);
  await publico(capaNova.caminho, 200);
  await gerente('/livros/150', 204, { metodo: 'DELETE' });
  await publico('/livros/150', 404);
  await gerente('/livros/1', 409, { metodo: 'DELETE' });
  await gerente('/logout', 200, post());
  await gerente('/pedidos', 401);
  await cliente('/logout', 200, post());
  await cliente('/pedidos/meus', 401);
  console.log('Gestão de pedidos, CRUD de livros, upload e logout conferidos.');

  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const novaSenha = 'NovaSenhaTeste123!';
  await db.query(`
    INSERT INTO tokens_recuperacao_senha (cpf_pessoa, token_hash, expira_em)
    VALUES ($1, $2, NOW() + INTERVAL '30 minutes')
  `, [cadastro.cpf_pessoa, hash]);
  await publico('/redefinir-senha', 200, post({ token, senha: novaSenha }));
  await publico('/redefinir-senha', 400, post({ token, senha: novaSenha }));
  await cliente('/login', 401, login(cadastro.nome_usuario_pessoa, cadastro.senha_pessoa));
  await cliente('/login', 200, login(cadastro.nome_usuario_pessoa, novaSenha));
  // Simula uma compra antiga paga e cancelada, anterior à marca de primeira compra.
  const {rows:[legado]} = await db.query(
    "UPDATE pedidos SET status_pedido='Cancelado' WHERE cliente_pessoa_cpf_pessoa=(SELECT cpf_pessoa FROM pessoas WHERE nome_usuario_pessoa='cliente.demo') RETURNING id_pedido, primeira_compra_utilizada");
  assert.equal(legado.primeira_compra_utilizada, false);
  const relogin = await outro('/login', 200, login('cliente.demo', senhaDemo));
  assert.equal(relogin.primeira_compra, false);
  const resumoLegado = await outro('/carrinho/validar', 200, post({ itens:[{ id_livro:1, quantidade:1 }], resumo:true }));
  assert.equal(resumoLegado.primeira_compra, null);
  console.log('Compra antiga confirmada e cancelada continua impedindo o benefício de primeira compra.');
  console.log('Redefinição com token válido e rejeição de reutilização conferidas.');
}

async function portaTemporaria() {
  const reserva = net.createServer().listen(0);
  await once(reserva, 'listening');
  const { port } = reserva.address();
  await new Promise((resolve, reject) => reserva.close((erro) => erro ? reject(erro) : resolve()));
  return port;
}

async function main() {
  let db, servidor;
  try {
    await pool.query('CREATE DATABASE ' + nomeBanco + " TEMPLATE template0 ENCODING 'UTF8'");
    console.log('Banco descartável criado:', nomeBanco);
    db = new Client({
      host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
      password: process.env.DB_PASSWORD, database: nomeBanco,
    });
    await db.connect();
    const sql = await fs.readFile(path.join(raiz, 'documentacao/instalar_bookshop4.sql'), 'utf8');
    await db.query(sql);
    await validarBanco(db);
    await assert.rejects(db.query(sql), /Use um banco vazio/);
    await db.query('ROLLBACK');
    console.log('Reexecução do SQL bloqueada em banco populado.');

    const port = await portaTemporaria();
    servidor = spawn(process.execPath, ['backend/server.js'], {
      cwd: raiz,
      env: { ...process.env, DB_NAME: nomeBanco, PORT: String(port), NODE_ENV: 'test',
        SMTP_HOST: '', SESSION_SECRET: randomBytes(32).toString('hex') },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    await Promise.race([
      once(servidor.stdout, 'data', { signal: AbortSignal.timeout(10_000) }),
      once(servidor, 'exit').then(() => { throw new Error('Servidor encerrou antes de iniciar.'); }),
    ]);
    const base = 'http://localhost:' + port;
    await validarHttp(base, db);
  } finally {
    servidor?.kill();
    for (const capa of capasCriadas) {
      await fs.rm(path.join(raiz, 'shared/book-covers/livros', capa), { force: true });
    }
    await db?.end();
    await pool.end();
  }
}

main().catch((erro) => {
  console.error(erro.message);
  process.exitCode = 1;
});
