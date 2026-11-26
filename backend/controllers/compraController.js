const { isDeepStrictEqual } = require('node:util');
const QRCode = require('qrcode');
const db = require('../database');
const { descontosDisponiveis, selecionarDesconto, calcularResumo } = require('../utils/descontos');

const MAX_ITENS = 100;
const MAX_QUANTIDADE = 100;
const MAX_ID_INTEIRO = 2147483647;
const MAX_TOTAL_CENTAVOS = 999999999999;
const STATUS_AGUARDANDO = 'Aguardando confirmação';
const FRETE_FIXO_CENTAVOS = 1000;
const METODOS_PERMITIDOS = new Set([1, 2]);
const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validarEntrada(itens, formaPagamentoId, tentativaId, enderecoId) {
  if (!Array.isArray(itens) || itens.length === 0 || itens.length > MAX_ITENS) {
    return 'O carrinho está vazio ou contém itens demais.';
  }
  if (!inteiroNoIntervalo(formaPagamentoId, 1, 2) ||
    !METODOS_PERMITIDOS.has(Number(formaPagamentoId))) {
    return 'Escolha PIX ou cartão de teste.';
  }
  if (typeof tentativaId !== 'string' || !UUID_VALIDO.test(tentativaId)) {
    return 'Identificador de tentativa inválido. Atualize a página e tente novamente.';
  }
  if (!inteiroNoIntervalo(enderecoId, 1, Number.MAX_SAFE_INTEGER)) {
    return 'Selecione um endereço de entrega válido.';
  }

  const vistos = new Set();
  for (const item of itens) {
    const id = item && inteiroNoIntervalo(item.id_livro, 1, MAX_ID_INTEIRO)
      ? Number(item.id_livro)
      : null;
    const quantidade = item && inteiroNoIntervalo(item.quantidade, 1, MAX_QUANTIDADE)
      ? Number(item.quantidade)
      : null;
    if (
      id === null ||
      quantidade === null ||
      vistos.has(id)
    ) {
      return 'Cada livro deve aparecer uma única vez no carrinho, com uma quantidade inteira entre 1 e 100.';
    }
    vistos.add(id);
  }
  return null;
}

function calcularValores(subtotalCentavos, formaPagamentoId) {
  const descontoCentavos = descontoEmCentavos(subtotalCentavos, formaPagamentoId);
  return {
    subtotal: (subtotalCentavos / 100).toFixed(2),
    desconto: (descontoCentavos / 100).toFixed(2),
    frete: (FRETE_FIXO_CENTAVOS / 100).toFixed(2),
    total: (totalFinalCentavos(subtotalCentavos, formaPagamentoId) / 100).toFixed(2)
  };
}

function inteiroNoIntervalo(valor, minimo, maximo) {
  if (typeof valor === 'string' && !/^\d+$/.test(valor)) return false;
  if (typeof valor !== 'number' && typeof valor !== 'string') return false;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero >= minimo && numero <= maximo;
}

function descontoEmCentavos(subtotalCentavos, formaPagamentoId) {
  return formaPagamentoId === 1 ? Math.round(subtotalCentavos * 0.05) : 0;
}

function totalFinalCentavos(subtotalCentavos, formaPagamentoId) {
  return subtotalCentavos - descontoEmCentavos(subtotalCentavos, formaPagamentoId)
    + FRETE_FIXO_CENTAVOS;
}

function mesmoDesconto(registro, desconto) {
  if (registro?.campanhas) return isDeepStrictEqual(registro, desconto);
  return (registro?.codigo ?? null) === (desconto?.codigo ?? null) &&
    (registro?.percentual ?? 0) === (desconto?.percentual ?? 0);
}

function enderecoDoPedido(pedido) {
  return pedido.endereco_entrega_cep
    ? {
      cep: pedido.endereco_entrega_cep,
      rua: pedido.endereco_entrega_rua,
      numero: pedido.endereco_entrega_numero,
      complemento: pedido.endereco_entrega_complemento,
      bairro: pedido.endereco_entrega_bairro,
      cidade: pedido.endereco_entrega_cidade,
      estado: pedido.endereco_entrega_estado
    }
    : null;
}

function itensCanonicos(itens) {
  return itens
    .map((item) => ({
      id_livro: Number(item.id_livro),
      quantidade: Number(item.quantidade)
    }))
    .sort((a, b) => a.id_livro - b.id_livro);
}

function erroDeValidacao(res, status, erro) {
  return res.status(status).json({ erro });
}

function respostaPedido(pedido, itens, formaPagamento, pagamento) {
  return {
    sucesso: true,
    pedido: {
      id_pedido: Number(pedido.id_pedido),
      data_pedido: pedido.data_pedido,
      data_prevista_entrega: pedido.data_prevista_entrega,
      total_pedido: Number(pedido.total_pedido),
      subtotal_pedido: Number(pedido.subtotal_pedido ?? pedido.total_pedido),
      desconto_pedido: Number(pedido.desconto_pedido ?? 0),
      desconto_registro: pedido.desconto_registro,
      frete_pedido: Number(pedido.frete_pedido ?? 0),
      status_pedido: pedido.status_pedido,
      endereco_entrega: enderecoDoPedido(pedido),
      forma_pagamento: formaPagamento,
      status_pagamento: pagamento.status_pagamento,
      pagamento_simulado: true,
      itens: itens.map((item) => ({
        id_livro: Number(item.id_livro),
        titulo: item.titulo,
        caminho_imagem_livro: item.caminho_imagem_livro || null,
        quantidade: Number(item.quantidade),
        preco_unitario: Number(item.preco_unitario),
        subtotal: Number(item.total_item ??
          (Math.round(Number(item.preco_unitario) * Number(item.quantidade) * 100) / 100))
      }))
    }
  };
}

async function prepararCompra(req, res) {
  const dados = req.body || {};
  const itens = dados.itens;
  const formaPagamentoInformada = dados.forma_pagamento_id;
  const formaPagamentoId = Number(dados.forma_pagamento_id);
  const tentativaId = dados.tentativa_id;
  const enderecoInformado = dados.endereco_id;
  const erroEntrada = validarEntrada(
    itens,
    formaPagamentoInformada,
    tentativaId,
    enderecoInformado
  );
  if (erroEntrada) return erroDeValidacao(res, 400, erroEntrada);
  const enderecoId = Number(enderecoInformado);

  const cpf = req.session && req.session.cpf_pessoa;
  let client;
  let transacaoAberta = false;
  let pedido;
  let pagamento;
  let formaPagamento;
  let itensPedido;

  try {
    client = await db.connect();
    await client.query('BEGIN');
    transacaoAberta = true;

    const cliente = await client.query(
      'SELECT pessoa_cpf_pessoa FROM clientes WHERE pessoa_cpf_pessoa = $1 FOR UPDATE',
      [cpf]
    );
    if (!cliente.rowCount) {
      await client.query('ROLLBACK');
      transacaoAberta = false;
      return erroDeValidacao(res, 403, 'A conta autenticada ainda não está cadastrada como cliente.');
    }

    const existentes = await client.query(
      `SELECT p.id_pedido, p.cliente_pessoa_cpf_pessoa,
              p.data_pedido, p.data_prevista_entrega,
              p.total_pedido, p.subtotal_pedido, p.desconto_pedido, p.desconto_registro,
              p.frete_pedido, p.endereco_entrega_id,
              p.endereco_entrega_cep, p.endereco_entrega_rua,
              p.endereco_entrega_numero, p.endereco_entrega_complemento,
              p.endereco_entrega_bairro, p.endereco_entrega_cidade,
              p.endereco_entrega_estado, p.status_pedido,
              pg.status_pagamento, pg.forma_pagamento_id_forma_pagamento,
              pg.pix_qr_code, pg.pix_qr_code_base64,
              fp.nome_forma_pagamento
       FROM pagamentos pg
       JOIN pedidos p ON p.id_pedido = pg.pedido_id_pedido
       JOIN formas_pagamento fp
         ON fp.id_forma_pagamento = pg.forma_pagamento_id_forma_pagamento
       WHERE pg.tentativa_id = $1
       FOR UPDATE OF p, pg`,
      [tentativaId]
    );

    const desconto = selecionarDesconto(await descontosDisponiveis(client, cpf, itens.map(i => Number(i.id_livro))), dados.promocao_codigos ?? dados.promocao_codigo, formaPagamentoId);
    if (existentes.rowCount) {
      pedido = existentes.rows[0];
      if (pedido.cliente_pessoa_cpf_pessoa !== cpf) {
        await client.query('ROLLBACK');
        transacaoAberta = false;
        return erroDeValidacao(res, 409, 'Esta tentativa de compra já está associada a outra conta.');
      }
      if (Number(pedido.forma_pagamento_id_forma_pagamento) !== formaPagamentoId) {
        await client.query('ROLLBACK');
        transacaoAberta = false;
        return erroDeValidacao(res, 409, 'A tentativa existente usa outra forma de pagamento.');
      }
      if (Number(pedido.endereco_entrega_id) !== enderecoId) {
        await client.query('ROLLBACK');
        transacaoAberta = false;
        return erroDeValidacao(res, 409, 'A tentativa existente usa outro endereço de entrega.');
      }
      if (
        pedido.status_pedido !== STATUS_AGUARDANDO ||
        pedido.status_pagamento !== STATUS_AGUARDANDO
      ) {
        await client.query('ROLLBACK');
        transacaoAberta = false;
        return erroDeValidacao(res, 409, 'Este pedido já foi confirmado ou cancelado.');
      }

      const linhasExistentes = await client.query(
        `SELECT i.livro_id_livro AS id_livro, i.quantidade,
                COALESCE(i.titulo_livro, l.titulo) AS titulo,
                COALESCE(i.caminho_imagem_livro, l.caminho_imagem_livro) AS caminho_imagem_livro,
                i.preco_unitario
         FROM pedido_has_livro i
         JOIN livros l ON l.id_livro = i.livro_id_livro
         WHERE pedido_id_pedido = $1
         ORDER BY livro_id_livro`,
        [pedido.id_pedido]
      );
      const solicitados = itensCanonicos(itens);
      const salvos = linhasExistentes.rows.map((item) => ({
        id_livro: Number(item.id_livro),
        quantidade: Number(item.quantidade)
      }));
      if (JSON.stringify(solicitados) !== JSON.stringify(salvos)) {
        await client.query('ROLLBACK');
        transacaoAberta = false;
        return erroDeValidacao(res, 409, 'O carrinho mudou desde o início desta tentativa. Atualize a página para continuar.');
      }

      itensPedido = linhasExistentes.rows;
      if (!mesmoDesconto(pedido.desconto_registro, calcularResumo(0, desconto, true, itensPedido).desconto_registro)) {
        await client.query('ROLLBACK');
        transacaoAberta = false;
        return erroDeValidacao(res, 409, 'O desconto mudou. Inicie uma nova tentativa de compra.');
      }
      pagamento = existentes.rows[0];
      formaPagamento = pagamento.nome_forma_pagamento;
    } else {
      const enderecoResult = await client.query(
        `SELECT id_endereco, cep, rua, numero, complemento, bairro, cidade, estado
         FROM enderecos_clientes
         WHERE id_endereco = $1 AND cliente_pessoa_cpf_pessoa = $2
         FOR SHARE`,
        [enderecoId, cpf]
      );
      if (!enderecoResult.rowCount) {
        await client.query('ROLLBACK');
        transacaoAberta = false;
        return erroDeValidacao(res, 404, 'Endereço de entrega não encontrado.');
      }
      const endereco = enderecoResult.rows[0];
      const forma = await client.query(
        `SELECT id_forma_pagamento, nome_forma_pagamento
         FROM formas_pagamento
         WHERE id_forma_pagamento = $1 AND ativa = TRUE`,
        [formaPagamentoId]
      );
      if (!forma.rowCount) {
        await client.query('ROLLBACK');
        transacaoAberta = false;
        return erroDeValidacao(res, 400, 'Forma de pagamento de teste indisponível.');
      }

      const ids = itens.map((item) => Number(item.id_livro)).sort((a, b) => a - b);
      const livrosResult = await client.query(
        `SELECT id_livro, titulo, caminho_imagem_livro, preco, estoque
         FROM livros
         WHERE id_livro = ANY($1::integer[])
         ORDER BY id_livro
         FOR UPDATE`,
        [ids]
      );
      const livros = new Map(
        livrosResult.rows.map((livro) => [Number(livro.id_livro), livro])
      );
      if (livros.size !== ids.length) {
        await client.query('ROLLBACK');
        transacaoAberta = false;
        return erroDeValidacao(res, 409, 'Um ou mais livros não existem mais no catálogo.');
      }

      let totalCentavos = 0;
      itensPedido = [];
      for (const item of itensCanonicos(itens)) {
        const livro = livros.get(item.id_livro);
        const estoque = Number(livro.estoque);
        if (item.quantidade > estoque) {
          await client.query('ROLLBACK');
          transacaoAberta = false;
          return erroDeValidacao(
            res,
            409,
            `Estoque insuficiente para "${livro.titulo}". Disponível: ${estoque}.`
          );
        }

        const precoCentavos = Math.round(Number(livro.preco) * 100);
        totalCentavos += precoCentavos * item.quantidade;
        itensPedido.push({
          id_livro: item.id_livro,
          titulo: livro.titulo,
          caminho_imagem_livro: livro.caminho_imagem_livro,
          quantidade: item.quantidade,
          preco_unitario: (precoCentavos / 100).toFixed(2)
        });
      }

      const valores = calcularResumo(totalCentavos, desconto, true, itensPedido);
      if (totalCentavos > MAX_TOTAL_CENTAVOS ||
        valores.total_pedido > MAX_TOTAL_CENTAVOS / 100) {
        await client.query('ROLLBACK');
        transacaoAberta = false;
        return erroDeValidacao(res, 400, 'O total do pedido excede o limite aceito pelo sistema.');
      }
      const pedidoResult = await client.query(
        `INSERT INTO pedidos (
           data_pedido, cliente_pessoa_cpf_pessoa, status_pedido,
           data_prevista_entrega, total_pedido, subtotal_pedido,
           desconto_pedido, frete_pedido, endereco_entrega_id,
           endereco_entrega_cep, endereco_entrega_rua, endereco_entrega_numero,
           endereco_entrega_complemento, endereco_entrega_bairro,
           endereco_entrega_cidade, endereco_entrega_estado, desconto_registro
         )
         VALUES (
           CURRENT_DATE, $1, $2, CURRENT_DATE + INTERVAL '15 days',
           $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
         )
         RETURNING id_pedido, data_pedido, data_prevista_entrega,
                   total_pedido, subtotal_pedido, desconto_pedido, frete_pedido, desconto_registro,
                   endereco_entrega_cep, endereco_entrega_rua,
                   endereco_entrega_numero, endereco_entrega_complemento,
                   endereco_entrega_bairro, endereco_entrega_cidade,
                   endereco_entrega_estado, status_pedido`,
        [
          cpf, STATUS_AGUARDANDO, valores.total_pedido, valores.subtotal_pedido,
          valores.desconto_pedido, valores.frete_pedido, enderecoId, endereco.cep,
          endereco.rua, endereco.numero, endereco.complemento,
          endereco.bairro, endereco.cidade, endereco.estado, valores.desconto_registro
        ]
      );
      pedido = pedidoResult.rows[0];

      for (const item of itensPedido) {
        await client.query(
          `INSERT INTO pedido_has_livro (
             livro_id_livro, pedido_id_pedido, quantidade, preco_unitario,
             titulo_livro, caminho_imagem_livro, total_item
           )
           SELECT $1, $2, $3, $4, l.titulo, l.caminho_imagem_livro, $5
           FROM livros l WHERE l.id_livro = $1`,
          [
            item.id_livro,
            pedido.id_pedido,
            item.quantidade,
            item.preco_unitario,
            (Number(item.preco_unitario) * item.quantidade).toFixed(2)
          ]
        );
      }

      const pagamentoResult = await client.query(
        `INSERT INTO pagamentos (
           pedido_id_pedido, valor_total_pagamento, status_pagamento,
           forma_pagamento_id_forma_pagamento, tentativa_id
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING status_pagamento, pix_qr_code, pix_qr_code_base64`,
        [
          pedido.id_pedido,
          pedido.total_pedido,
          STATUS_AGUARDANDO,
          formaPagamentoId,
          tentativaId
        ]
      );
      pagamento = pagamentoResult.rows[0];
      formaPagamento = forma.rows[0].nome_forma_pagamento;

    }

    await client.query('COMMIT');
    transacaoAberta = false;
  } catch (error) {
    if (client && transacaoAberta) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Erro ao desfazer preparação de pedido:', rollbackError.message);
      }
    }
    if (error.status === 409) return erroDeValidacao(res, 409, error.message);
    if (error.code === '23505') {
      return erroDeValidacao(res, 409, 'Esta tentativa de pedido já foi registrada. Tente novamente.');
    }
    console.error('Erro ao preparar pedido de teste:', error.message);
    return erroDeValidacao(res, 500, 'Não foi possível preparar o pedido de teste.');
  } finally {
    if (client) client.release();
  }

  let pix;
  if (formaPagamentoId === 1) {
    if (pagamento.pix_qr_code && pagamento.pix_qr_code_base64) {
      pix = {
        qr_code: pagamento.pix_qr_code,
        qr_code_base64: pagamento.pix_qr_code_base64
      };
    } else {
      try {
        const codigoPix = `BOOKSHOP-PIX-DEMO|PEDIDO=${pedido.id_pedido}|VALOR=${Number(pedido.total_pedido).toFixed(2)}`;
        const imagemQr = await QRCode.toBuffer(codigoPix, {
          errorCorrectionLevel: 'M',
          margin: 2,
          type: 'png'
        });
        pix = {
          qr_code: codigoPix,
          qr_code_base64: imagemQr.toString('base64')
        };
        const pixSalvo = await db.query(
          `UPDATE pagamentos
           SET pix_qr_code = $1,
               pix_qr_code_base64 = $2
           WHERE pedido_id_pedido = $3
             AND status_pagamento = $4`,
          [
            pix.qr_code,
            pix.qr_code_base64,
            pedido.id_pedido,
            STATUS_AGUARDANDO
          ]
        );
        if (pixSalvo.rowCount !== 1) {
          return erroDeValidacao(res, 409, 'O pedido mudou antes que os dados PIX de teste fossem salvos. Tente novamente.');
        }
      } catch (error) {
        console.error('Erro ao gerar ou salvar o QR Code demonstrativo:', error.message);
        return erroDeValidacao(res, 500, 'Não foi possível gerar o QR Code demonstrativo.');
      }
    }
  }

  const linhas = itensPedido.map((item) => ({
    ...item,
    preco_unitario: Number(item.preco_unitario),
    total_item: Math.round(Number(item.preco_unitario) * Number(item.quantidade) * 100) / 100
  }));
  return res.status(200).json({
    sucesso: true,
    pedido: {
      id_pedido: Number(pedido.id_pedido),
      total_pedido: Number(pedido.total_pedido),
      subtotal_pedido: Number(pedido.subtotal_pedido),
      desconto_pedido: Number(pedido.desconto_pedido),
      desconto_registro: pedido.desconto_registro,
      frete_pedido: Number(pedido.frete_pedido),
      status_pedido: pedido.status_pedido,
      endereco_entrega: enderecoDoPedido(pedido),
      forma_pagamento: formaPagamento
    },
    pagamento: {
      status: STATUS_AGUARDANDO,
      ambiente: 'simulacao',
      pix,
      mensagem: 'PIX demonstrativo: este código não é pagável e não representa uma cobrança. Use a confirmação simulada para concluir o pedido nesta aplicação.'
    },
    itens: linhas
  });
}

async function cotacaoCompra(req, res) {
  const dados = req.body || {};
  const itens = dados.itens;
  const formaPagamentoInformada = dados.forma_pagamento_id;
  const formaPagamentoId = Number(dados.forma_pagamento_id);
  const enderecoId = Number(dados.endereco_id);
  if (!Array.isArray(itens) || !itens.length || itens.length > MAX_ITENS ||
    !inteiroNoIntervalo(formaPagamentoInformada, 1, 2) ||
    !METODOS_PERMITIDOS.has(formaPagamentoId) ||
    !inteiroNoIntervalo(dados.endereco_id, 1, Number.MAX_SAFE_INTEGER)) {
    return erroDeValidacao(res, 400, 'Informe itens, forma de pagamento e endereço válidos.');
  }
  const vistos = new Set();
  for (const item of itens) {
    const idValido = item && inteiroNoIntervalo(item.id_livro, 1, MAX_ID_INTEIRO);
    const quantidadeValida = item &&
      inteiroNoIntervalo(item.quantidade, 1, MAX_QUANTIDADE);
    const id = idValido ? Number(item.id_livro) : null;
    if (!idValido || !quantidadeValida || vistos.has(id)) {
      return erroDeValidacao(res, 400, 'O carrinho contém um livro ou uma quantidade inválida.');
    }
    vistos.add(id);
  }

  try {
    const endereco = await db.query(
      `SELECT cep, rua, numero, complemento, bairro, cidade, estado
       FROM enderecos_clientes
       WHERE id_endereco = $1 AND cliente_pessoa_cpf_pessoa = $2`,
      [enderecoId, req.session.cpf_pessoa]
    );
    if (!endereco.rowCount) {
      return erroDeValidacao(res, 404, 'Endereço de entrega não encontrado.');
    }

    const livros = await db.query(
      `SELECT id_livro, titulo, caminho_imagem_livro, preco, estoque
       FROM livros WHERE id_livro = ANY($1::integer[])`,
      [itens.map((item) => Number(item.id_livro))]
    );
    const porId = new Map(livros.rows.map((livro) => [Number(livro.id_livro), livro]));
    if (porId.size !== vistos.size) {
      return erroDeValidacao(res, 409, 'Um ou mais livros não existem mais no catálogo.');
    }

    let subtotalCentavos = 0;
    const linhas = [];
    for (const item of itens) {
      const livro = porId.get(Number(item.id_livro));
      const quantidade = Number(item.quantidade);
      if (quantidade > Number(livro.estoque)) {
        return erroDeValidacao(res, 409, `Estoque insuficiente para "${livro.titulo}".`);
      }
      const precoCentavos = Math.round(Number(livro.preco) * 100);
      const totalItemCentavos = precoCentavos * quantidade;
      subtotalCentavos += totalItemCentavos;
      linhas.push({
        id_livro: Number(livro.id_livro),
        titulo: livro.titulo,
        caminho_imagem_livro: livro.caminho_imagem_livro,
        quantidade,
        preco_unitario: precoCentavos / 100,
        total_item: totalItemCentavos / 100
      });
    }
    const desconto = selecionarDesconto(await descontosDisponiveis(db, req.session.cpf_pessoa, linhas.map(i => i.id_livro)), dados.promocao_codigos ?? dados.promocao_codigo, formaPagamentoId);
    const valores = calcularResumo(subtotalCentavos, desconto, true, linhas);
    if (subtotalCentavos > MAX_TOTAL_CENTAVOS ||
      valores.total_pedido > MAX_TOTAL_CENTAVOS / 100) {
      return erroDeValidacao(res, 400, 'O total do pedido excede o limite aceito pelo sistema.');
    }
    return res.json({
      itens: linhas,
      ...valores,
      endereco_entrega: endereco.rows[0],
      forma_pagamento_id: formaPagamentoId
    });
  } catch (error) {
    if (error.status === 409) return erroDeValidacao(res, 409, error.message);
    console.error('Erro ao calcular cotação de compra:', error.message);
    return erroDeValidacao(res, 500, 'Não foi possível calcular o total da compra.');
  }
}

async function confirmarCompra(req, res, peloGerente = false) {
  const id = Number(req.params.id);
  if (!inteiroNoIntervalo(req.params.id, 1, MAX_ID_INTEIRO)) {
    return erroDeValidacao(res, 400, 'ID de pedido inválido.');
  }

  const autor = req.session?.cpf_pessoa;
  let cpf = autor;
  let client;
  let transacaoAberta = false;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    transacaoAberta = true;

    if (peloGerente === true) {
      const { rows: [pedido] } = await client.query(
        'SELECT cliente_pessoa_cpf_pessoa FROM pedidos WHERE id_pedido = $1 AND cliente_fisico = FALSE', [id]);
      cpf = pedido?.cliente_pessoa_cpf_pessoa;
      if (!cpf) {
        await client.query('ROLLBACK');
        transacaoAberta = false;
        return erroDeValidacao(res, 404, 'Pedido online não encontrado.');
      }
    }
    await client.query('SELECT pessoa_cpf_pessoa FROM clientes WHERE pessoa_cpf_pessoa = $1 FOR UPDATE', [cpf]);
    const pedidoResult = await client.query(
      `SELECT p.id_pedido, p.data_pedido, p.data_prevista_entrega,
              p.total_pedido, p.subtotal_pedido, p.desconto_pedido, p.desconto_registro,
              p.frete_pedido, p.endereco_entrega_cep,
              p.endereco_entrega_rua, p.endereco_entrega_numero,
              p.endereco_entrega_complemento, p.endereco_entrega_bairro,
              p.endereco_entrega_cidade, p.endereco_entrega_estado,
              p.status_pedido,
              pg.status_pagamento, pg.forma_pagamento_id_forma_pagamento,
              fp.nome_forma_pagamento
       FROM pedidos p
       JOIN pagamentos pg ON pg.pedido_id_pedido = p.id_pedido
       JOIN formas_pagamento fp
         ON fp.id_forma_pagamento = pg.forma_pagamento_id_forma_pagamento
       WHERE p.id_pedido = $1
         AND p.cliente_pessoa_cpf_pessoa = $2
       FOR UPDATE OF p, pg`,
      [id, cpf]
    );
    if (!pedidoResult.rowCount) {
      await client.query('ROLLBACK');
      transacaoAberta = false;
      return erroDeValidacao(res, 404, 'Pedido de teste não encontrado.');
    }

    const pedido = pedidoResult.rows[0];
    if (['Confirmado', 'Em preparação', 'Confirmado para entrega', 'Enviado para entrega', 'Atraso', 'Concluído'].includes(pedido.status_pedido) && pedido.status_pagamento === 'Simulado') {
      const itens = await carregarItens(client, id);
      await client.query('COMMIT');
      transacaoAberta = false;
      return res.json({
        ...respostaPedido(pedido, itens, pedido.nome_forma_pagamento, pedido),
        ja_confirmado: true,
        aviso: 'A confirmação deste pedido já havia sido registrada. Nenhum estoque foi descontado novamente.'
      });
    }
    if (
      pedido.status_pedido !== STATUS_AGUARDANDO ||
      pedido.status_pagamento !== STATUS_AGUARDANDO
    ) {
      await client.query('ROLLBACK');
      transacaoAberta = false;
      return erroDeValidacao(res, 409, 'Este pedido não está aguardando confirmação.');
    }

    const itens = await client.query(
      `SELECT i.livro_id_livro AS id_livro, i.quantidade, i.preco_unitario,
              COALESCE(i.titulo_livro, l.titulo) AS titulo, l.estoque
       FROM pedido_has_livro i
       JOIN livros l ON l.id_livro = i.livro_id_livro
       WHERE i.pedido_id_pedido = $1
       ORDER BY i.livro_id_livro
       FOR UPDATE OF l`,
      [id]
    );
    if (!itens.rowCount) {
      await client.query('ROLLBACK');
      transacaoAberta = false;
      return erroDeValidacao(res, 409, 'O pedido não possui itens para confirmar.');
    }

    const codigo = pedido.desconto_registro?.codigo;
    const forma = Number(pedido.forma_pagamento_id_forma_pagamento);
    const desconto = selecionarDesconto(await descontosDisponiveis(client, cpf, itens.rows.map(i => i.id_livro)),
      pedido.desconto_registro?.selecionadas ?? pedido.desconto_registro?.campanhas?.map(p => p.codigo) ?? (['primeira_compra', 'pix'].includes(codigo) ? null : codigo), forma);
    const esperado = calcularResumo(Math.round(Number(pedido.subtotal_pedido) * 100), desconto, true, itens.rows);
    if ((pedido.desconto_registro && !mesmoDesconto(pedido.desconto_registro, esperado.desconto_registro)) ||
        Number(pedido.desconto_pedido) !== esperado.desconto_pedido || Number(pedido.total_pedido) !== esperado.total_pedido) {
      await client.query('ROLLBACK');
      transacaoAberta = false;
      return erroDeValidacao(res, 409, 'Os descontos mudaram. Volte ao carrinho para preparar um novo pedido.');
    }

    for (const item of itens.rows) {
      if (Number(item.quantidade) > Number(item.estoque)) {
        await client.query('ROLLBACK');
        transacaoAberta = false;
        return erroDeValidacao(
          res,
          409,
          `Estoque insuficiente para "${item.titulo}". Disponível: ${item.estoque}.`
        );
      }
    }

    for (const item of itens.rows) {
      const resultadoEstoque = await client.query(
        `UPDATE livros
         SET estoque = estoque - $1
         WHERE id_livro = $2 AND estoque >= $1
         RETURNING estoque`,
        [item.quantidade, item.id_livro]
      );
      if (!resultadoEstoque.rowCount) {
        await client.query('ROLLBACK');
        transacaoAberta = false;
        return erroDeValidacao(res, 409, `Não foi possível reservar o estoque de "${item.titulo}".`);
      }
    }

    const pedidoAtualizado = await client.query(
      `UPDATE pedidos
       SET status_pedido = 'Em preparação', primeira_compra_utilizada = $3, desconto_registro = $4
       WHERE id_pedido = $1 AND status_pedido = $2
       RETURNING id_pedido, data_pedido, data_prevista_entrega,
                 total_pedido, subtotal_pedido, desconto_pedido, frete_pedido, desconto_registro,
                 endereco_entrega_cep, endereco_entrega_rua,
                 endereco_entrega_numero, endereco_entrega_complemento,
                 endereco_entrega_bairro, endereco_entrega_cidade,
                 endereco_entrega_estado, status_pedido`,
      [id, STATUS_AGUARDANDO, desconto?.codigo === 'primeira_compra', esperado.desconto_registro]
    );
    const pagamentoAtualizado = await client.query(
      `UPDATE pagamentos
       SET status_pagamento = 'Simulado', data_pagamento = CURRENT_TIMESTAMP
       WHERE pedido_id_pedido = $1 AND status_pagamento = $2
       RETURNING status_pagamento`,
      [id, STATUS_AGUARDANDO]
    );
    if (!pedidoAtualizado.rowCount || !pagamentoAtualizado.rowCount) {
      throw new Error('O estado do pedido mudou durante a confirmação.');
    }

    await client.query(
      `INSERT INTO pedido_eventos (pedido_id, estado_anterior, estado, autor_cpf, motivo)
       VALUES ($1, 'Aguardando confirmação', 'Em preparação', $2, 'Pagamento simulado confirmado')`,
      [id, autor]
    );
    await client.query('COMMIT');
    transacaoAberta = false;

    return res.status(200).json({
      ...respostaPedido(
        pedidoAtualizado.rows[0],
        itens.rows,
        pedido.nome_forma_pagamento,
        pagamentoAtualizado.rows[0]
      ),
      aviso: 'Pedido confirmado apenas nesta aplicação. Nenhum pagamento real foi feito.'
    });
  } catch (error) {
    if (client && transacaoAberta) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Erro ao desfazer confirmação do pedido:', rollbackError.message);
      }
    }
    if (error.status === 409 || error.constraint === 'uq_pedido_primeira_compra') {
      return erroDeValidacao(res, 409, error.status === 409 ? error.message : 'O benefício de primeira compra já foi utilizado.');
    }
    console.error('Erro ao confirmar pedido de teste:', error.message);
    return erroDeValidacao(res, 500, 'Não foi possível confirmar o pedido de teste.');
  } finally {
    if (client) client.release();
  }
}

async function carregarItens(client, pedidoId) {
  const resultado = await client.query(
    `SELECT i.livro_id_livro AS id_livro, i.quantidade,
            i.preco_unitario, COALESCE(i.titulo_livro, l.titulo) AS titulo,
            COALESCE(i.caminho_imagem_livro, l.caminho_imagem_livro) AS caminho_imagem_livro
     FROM pedido_has_livro i
     JOIN livros l ON l.id_livro = i.livro_id_livro
     WHERE i.pedido_id_pedido = $1
     ORDER BY l.titulo`,
    [pedidoId]
  );
  return resultado.rows;
}

module.exports = {
  cotacaoCompra,
  prepararCompra,
  confirmarCompra,
  calcularValores
};
