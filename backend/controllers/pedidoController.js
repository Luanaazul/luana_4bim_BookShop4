const db = require('../database');
const { cpfValido, dataISOValida } = require('../utils/validacao');
const MAX_ID_PEDIDO = 2147483647;

function idPositivo(valor) {
  const texto = String(valor);
  if (!/^[1-9]\d*$/.test(texto)) return null;
  const id = Number(texto);
  return Number.isSafeInteger(id) && id <= MAX_ID_PEDIDO ? id : null;
}

const SELECT_PEDIDOS = `
  SELECT p.id_pedido, p.data_pedido::text, p.data_prevista_entrega::text,
         CASE p.status_pedido
           WHEN 'Confirmado' THEN 'Em preparação'
           WHEN 'Enviado' THEN 'Enviado para entrega'
           WHEN 'Entregue' THEN 'Concluído'
           ELSE p.status_pedido
         END AS status_pedido,
         COALESCE(p.cliente_fisico, FALSE) AS cliente_fisico, p.detalhes_pedido,
         p.total_pedido, p.telefone_cliente_presencial, p.cliente_pessoa_cpf_pessoa AS cpf_cliente,
         p.subtotal_pedido, p.desconto_pedido, p.frete_pedido, p.desconto_registro,
         sc.estado AS solicitacao_cancelamento, sc.resposta AS resposta_cancelamento,
         (p.status_pedido IN ('Confirmado para entrega', 'Enviado para entrega', 'Enviado')
          OR (p.status_pedido = 'Atraso' AND (p.enviado_em IS NOT NULL OR EXISTS (
            SELECT 1 FROM pedido_eventos e WHERE e.pedido_id = p.id_pedido
              AND (e.estado IN ('Confirmado para entrega','Enviado para entrega','Enviado')
                OR e.estado_anterior IN ('Enviado para entrega','Enviado'))
          )))) AS cancelamento_em_analise,
         p.endereco_entrega_cep, p.endereco_entrega_rua,
         p.endereco_entrega_numero, p.endereco_entrega_complemento,
         p.endereco_entrega_bairro, p.endereco_entrega_cidade,
         p.endereco_entrega_estado,
         COALESCE(p.nome_cliente_presencial, pessoa.nome_pessoa) AS nome_cliente,
         fp.nome_forma_pagamento, pg.status_pagamento, pg.valor_total_pagamento,
         (p.status_pedido IN ('Em preparação', 'Confirmado', 'Confirmado para entrega', 'Atraso', 'Enviado para entrega', 'Enviado')
          AND pg.status_pagamento IN ('Simulado', 'Pago', 'Confirmado')
          AND NOT EXISTS (SELECT 1 FROM pedido_eventos e WHERE e.pedido_id = p.id_pedido AND e.percentual IS NOT NULL)) AS pode_cancelar
  FROM pedidos p
  LEFT JOIN pessoas pessoa ON pessoa.cpf_pessoa = p.cliente_pessoa_cpf_pessoa
  LEFT JOIN solicitacoes_cancelamento sc ON sc.pedido_id = p.id_pedido
  LEFT JOIN pagamentos pg ON pg.pedido_id_pedido = p.id_pedido
  LEFT JOIN formas_pagamento fp ON fp.id_forma_pagamento = pg.forma_pagamento_id_forma_pagamento`;

async function listarPedidos(req, res) {
  try {
    const result = await db.query(`${SELECT_PEDIDOS} WHERE ($1::boolean IS NULL OR COALESCE(p.cliente_fisico, FALSE) = $1) ORDER BY p.data_pedido DESC, p.id_pedido DESC`,
      [req.gerente === false || req.query?.origem === 'presencial' ? true : req.query?.origem === 'online' ? false : null]);
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar pedidos:', error.code || 'inesperado');
    res.status(500).json({ erro: 'Não foi possível listar os pedidos.' });
  }
}

async function obterPedido(req, res) {
  const id = idPositivo(req.params.id);
  if (!id) return res.status(400).json({ erro: 'ID de pedido inválido.' });
  try {
    const cpf = req.session.cpf_pessoa;
    const cabecalho = await db.query(
      `${SELECT_PEDIDOS}
       WHERE p.id_pedido = $1
         AND (
           p.cliente_pessoa_cpf_pessoa = $2
           OR EXISTS (
             SELECT 1
             FROM funcionarios f
             JOIN cargos c ON c.id_cargo = f.cargo_id_cargo
             WHERE f.pessoa_cpf_pessoa = $2
               AND (p.cliente_fisico OR LOWER(TRIM(c.nome_cargo)) = 'gerente')
           )
         )`,
      [id, cpf]
    );
    if (!cabecalho.rowCount) return res.status(404).json({ erro: 'Pedido não encontrado.' });
    const itens = await db.query(
      `SELECT i.livro_id_livro AS id_livro,
              COALESCE(i.titulo_livro, l.titulo) AS titulo,
              COALESCE(i.caminho_imagem_livro, l.caminho_imagem_livro) AS caminho_imagem_livro,
              i.quantidade, i.preco_unitario,
              COALESCE(i.total_item, i.quantidade * i.preco_unitario) AS subtotal
       FROM pedido_has_livro i LEFT JOIN livros l ON l.id_livro = i.livro_id_livro
       WHERE i.pedido_id_pedido = $1 ORDER BY l.titulo`, [id]
    );
    const eventos = await db.query(
      `SELECT e.estado, e.estado_anterior, e.motivo, e.criado_em, e.percentual, e.reembolso, e.situacao, e.processado_em,
              p.nome_pessoa AS autor
       FROM pedido_eventos e LEFT JOIN pessoas p ON p.cpf_pessoa = e.autor_cpf
       WHERE e.pedido_id = $1 ORDER BY e.criado_em DESC, e.id DESC`, [id]
    );
    const pedido = cabecalho.rows[0];
    const endereco_entrega = pedido.endereco_entrega_cep
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
    let endereco_cadastrado = null;
    if (!endereco_entrega && pedido.cpf_cliente && !pedido.cliente_fisico) {
      const { rows } = await db.query(
        `SELECT e.cep, e.rua, e.numero, e.complemento, e.bairro, e.cidade, e.estado,
                 e.id_endereco = p.endereco_entrega_id AS vinculado
          FROM pedidos p JOIN enderecos_clientes e ON e.cliente_pessoa_cpf_pessoa = p.cliente_pessoa_cpf_pessoa
          WHERE p.id_pedido = $1 ORDER BY (e.id_endereco = p.endereco_entrega_id) DESC NULLS LAST,
            e.principal DESC, e.id_endereco LIMIT 1`, [id]);
      endereco_cadastrado = rows[0] || null;
    }
    res.json({ ...pedido, status_disponiveis: statusDisponiveis(pedido), endereco_entrega, endereco_cadastrado, itens: itens.rows, eventos: eventos.rows });
  } catch (error) {
    console.error('Erro ao obter pedido:', error.code || 'inesperado');
    res.status(500).json({ erro: 'Não foi possível consultar o pedido.' });
  }
}

async function ocultarCancelado(req, res) {
  const id = idPositivo(req.params.id);
  if (!id) return res.status(400).json({ erro: 'Pedido inválido.' });
  try {
    const { rowCount } = await db.query(
      `UPDATE pedidos SET ocultar_cancelado_cliente = TRUE
         WHERE id_pedido = $1 AND cliente_pessoa_cpf_pessoa = $2 AND status_pedido = 'Cancelado'`,
      [id, req.session.cpf_pessoa]);
    if (!rowCount) return res.status(404).json({ erro: 'Pedido cancelado não encontrado na sua conta.' });
    res.status(200).json({ aviso: 'Pedido removido de Meus pedidos.' });
  } catch (erro) {
    console.error('Erro ao ocultar pedido:', erro.code || erro.name);
    res.status(500).json({ erro: 'Não foi possível remover o pedido da lista.' });
  }
}

async function meusPedidos(req, res) {
  try {
    const result = await db.query(`${SELECT_PEDIDOS} WHERE p.cliente_pessoa_cpf_pessoa = $1 AND NOT p.ocultar_cancelado_cliente ORDER BY p.data_pedido DESC, p.id_pedido DESC`, [req.session.cpf_pessoa]);
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar pedidos do cliente:', error.code || 'inesperado');
    res.status(500).json({ erro: 'Não foi possível listar seus pedidos.' });
  }
}

const PAGO = ['Simulado', 'Pago', 'Confirmado'];
const CANCELAVEIS = ['Em preparação', 'Confirmado', 'Confirmado para entrega', 'Atraso', 'Enviado para entrega', 'Enviado'];
const normalizarStatus = estado => ({ Confirmado: 'Em preparação', Enviado: 'Enviado para entrega', Entregue: 'Concluído' })[estado] || estado;
const STATUS_VALIDOS = ['Em preparação', 'Confirmado para entrega', 'Enviado para entrega', 'Atraso', 'Cancelado', 'Concluído'];

const TRANSICOES = {
  'Aguardando confirmação': new Set(),
  'Em preparação': new Set(['Confirmado para entrega', 'Atraso', 'Cancelado']),
  'Confirmado para entrega': new Set(['Enviado para entrega', 'Atraso', 'Concluído', 'Cancelado']),
  'Enviado para entrega': new Set(['Atraso', 'Concluído', 'Cancelado']),
  'Atraso': new Set(['Confirmado para entrega', 'Enviado para entrega', 'Concluído', 'Cancelado']),
  'Concluído': new Set(),
  'Cancelado': new Set()
};

function statusDisponiveis(pedido) {
  return [...(TRANSICOES[normalizarStatus(pedido.status_pedido)] || [])].filter(estado =>
    estado !== 'Cancelado' || (pedido.cliente_fisico && pedido.solicitacao_cancelamento !== 'Pendente' && pedido.pode_cancelar)
  );
}

async function atualizarStatusPedido(req, res) {
  const id = idPositivo(req.params.id);
  const body = req.body || {};
  const camposPermitidos = ['status_pedido', 'detalhes_pedido', 'motivo', 'dados_presenciais', 'previsao_entrega'];
  if (Object.keys(body).some(campo => !camposPermitidos.includes(campo))) {
    return res.status(400).json({ erro: 'Somente status, observações e dados operacionais presenciais podem ser alterados.' });
  }
  const statusInformado = String(body.status_pedido || '').trim();
  const status = ({ 'Entregue': 'Concluído', 'Enviado': 'Enviado para entrega' })[statusInformado] || statusInformado;
  if (status === 'Cancelado' && !body.dados_presenciais && body.previsao_entrega === undefined) return cancelarPedidoCliente(req, res, true);
  const previsao = body.previsao_entrega;
  if (previsao !== undefined && !dataISOValida(previsao)) {
    return res.status(400).json({ erro: 'Informe uma previsão de entrega válida.' });
  }
  const dadosPresenciais = body.dados_presenciais;
  const endereco = dadosPresenciais ? validarEndereco(dadosPresenciais) : null;
  const nome = texto(dadosPresenciais?.nome_cliente, 150);
  const telefone = texto(dadosPresenciais?.telefone, 30);
  const motivo = texto(body.motivo, 5000);
  if (status === 'Atraso' && !motivo) return res.status(400).json({ erro: 'Descreva o motivo do atraso no envio.' });
  const detalhes = body.detalhes_pedido === undefined ? undefined : texto(body.detalhes_pedido, 5000);
  if (!id || status === 'Cancelado' || motivo === null || (dadosPresenciais && (!nome || telefone === null || !endereco ||
      (dadosPresenciais.data_prevista_entrega && !dataISOValida(dadosPresenciais.data_prevista_entrega)))) || (status && !STATUS_VALIDOS.includes(status)) ||
      (detalhes === null) ||
      (!status && detalhes === undefined && !dadosPresenciais && !motivo && previsao === undefined)) {
    return res.status(400).json({ erro: 'Informe um status permitido ou detalhes com até 5.000 caracteres.' });
  }

  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const pedidoResult = await client.query(
      'SELECT id_pedido, status_pedido, cliente_fisico, data_pedido::text, data_prevista_entrega::text, detalhes_pedido FROM pedidos WHERE id_pedido = $1 FOR UPDATE', [id]
    );
    if (!pedidoResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Pedido não encontrado.' });
    }
    const atual = pedidoResult.rows[0].status_pedido;
    const atualNormalizado = normalizarStatus(atual);
    if (status && status !== atualNormalizado &&
        (!TRANSICOES[atualNormalizado] || !TRANSICOES[atualNormalizado].has(status))) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        erro: `Transição inválida: não é possível passar de "${atualNormalizado}" para "${status}".`
      });
    }

    const pedido = pedidoResult.rows[0];
    if (previsao && (previsao < pedido.data_pedido || atualNormalizado === 'Cancelado' || atualNormalizado === 'Concluído')) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'A previsão deve ser a partir da data do pedido e só pode mudar em pedidos abertos.' });
    }
    if (dadosPresenciais) {
      const entrega = dadosPresenciais.data_prevista_entrega || null;
      if (!pedido.cliente_fisico || atualNormalizado !== 'Em preparação' ||
          (entrega && entrega < pedido.data_pedido)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ erro: 'Só é possível editar os dados de pedidos presenciais em preparação com datas válidas.' });
      }
      await client.query(
        `UPDATE pedidos SET nome_cliente_presencial = $2, telefone_cliente_presencial = $3,
          data_prevista_entrega = $4, endereco_entrega_cep = $5, endereco_entrega_rua = $6,
          endereco_entrega_numero = $7, endereco_entrega_complemento = $8, endereco_entrega_bairro = $9,
          endereco_entrega_cidade = $10, endereco_entrega_estado = $11, endereco_entrega_id = NULL
         WHERE id_pedido = $1`, [id, nome, telefone || null, entrega, ...endereco]
      );
    }

    const novo = status || atualNormalizado;
    await client.query(
      `UPDATE pedidos SET status_pedido = $2,
          detalhes_pedido = COALESCE($3, detalhes_pedido),
          data_prevista_entrega = COALESCE($5::date, data_prevista_entrega),
          enviado_em = CASE WHEN $2::varchar = 'Enviado para entrega' OR $4::varchar = 'Enviado para entrega' THEN COALESCE(enviado_em, NOW()) ELSE enviado_em END
       WHERE id_pedido = $1`, [id, novo, detalhes ?? null, atualNormalizado, previsao ?? null]
    );
    const previsaoAlterada = previsao && previsao !== pedido.data_prevista_entrega;
    const textoPrevisao = previsaoAlterada ? 'Previsão de entrega: ' + previsao.split('-').reverse().join('/') : '';
    if (novo !== atual || motivo || previsaoAlterada || dadosPresenciais || (detalhes !== undefined && detalhes !== pedido.detalhes_pedido)) {
      await client.query(
        `INSERT INTO pedido_eventos (pedido_id, estado_anterior, estado, autor_cpf, motivo)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, atualNormalizado, novo, req.session.cpf_pessoa,
          [motivo || (dadosPresenciais ? 'Dados do pedido presencial atualizados.' : detalhes), textoPrevisao].filter(Boolean).join(' · ') || null]
      );
    }
    await client.query('COMMIT');
    return res.json({ sucesso: true, id_pedido: id, status_pedido: status || atualNormalizado });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao atualizar pedido:', error.code || 'inesperado');
    return res.status(500).json({ erro: 'Não foi possível atualizar o pedido.' });
  } finally {
    client?.release();
  }
}

async function cancelarPedidoCliente(req, res, gerente = false, decisao = null) {
  const id = idPositivo(req.params.id);
  const motivo = texto(req.body?.motivo, 5000);
  if (!id || motivo === null) return res.status(400).json({ erro: 'ID de pedido inválido.' });
  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT p.id_pedido, p.status_pedido, p.total_pedido, p.enviado_em, p.cliente_fisico,
              EXISTS (SELECT 1 FROM pedido_eventos e WHERE e.pedido_id = p.id_pedido
                AND e.estado = 'Confirmado para entrega') AS entrega_confirmada,
              EXISTS (SELECT 1 FROM pedido_eventos e WHERE e.pedido_id = p.id_pedido
                AND (e.estado IN ('Enviado', 'Enviado para entrega')
                  OR e.estado_anterior IN ('Enviado', 'Enviado para entrega'))) AS ja_enviado,
              EXISTS (SELECT 1 FROM pedido_eventos e WHERE e.pedido_id = p.id_pedido AND e.percentual IS NOT NULL) AS ja_reembolsado,
              pg.status_pagamento, pg.valor_total_pagamento
       FROM pedidos p
       LEFT JOIN pagamentos pg ON pg.pedido_id_pedido = p.id_pedido
       WHERE p.id_pedido = $1 AND ($3::boolean OR p.cliente_pessoa_cpf_pessoa = $2)
       FOR UPDATE OF p`,
      [id, req.session.cpf_pessoa, gerente === true]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Pedido não encontrado.' });
    }
    const pedido = result.rows[0];
    const { rows: [solicitacao] } = await client.query(
      'SELECT estado FROM solicitacoes_cancelamento WHERE pedido_id = $1', [id]);
    pedido.solicitacao = solicitacao?.estado;
    const statusAtual = pedido.status_pedido;
    if (gerente === true && !decisao && !pedido.cliente_fisico) {
      await client.query('ROLLBACK');
      return res.status(403).json({ erro: 'Pedidos online só podem ser cancelados pelo cliente ou pela aprovação da solicitação em Avisos.' });
    }
    if (decisao && pedido.solicitacao !== 'Pendente') {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'A solicitação já foi analisada ou não existe.' });
    }
    if (decisao === 'Recusada') {
      await registrarDecisao(client, id, decisao, motivo, statusAtual, req.session.cpf_pessoa);
      await client.query('COMMIT');
      return res.json({ aviso: 'Solicitação recusada.' });
    }
    if (pedido.solicitacao === 'Pendente' && !decisao) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: gerente ? 'Analise a solicitação pendente em Avisos.' : 'Já existe uma solicitação pendente.' });
    }
    const emAnalise = statusAtual === 'Confirmado para entrega' || normalizarStatus(statusAtual) === 'Enviado para entrega' ||
      (statusAtual === 'Atraso' && (pedido.enviado_em || pedido.ja_enviado || pedido.entrega_confirmada));
    if (gerente !== true && emAnalise && !pedido.ja_reembolsado) {
      if (pedido.solicitacao) {
        await client.query('ROLLBACK');
        return res.status(409).json({ erro: 'A solicitação deste pedido já foi analisada.' });
      }
      if (!pedido.cliente_fisico && !motivo) {
        await client.query('ROLLBACK');
        return res.status(400).json({ erro: 'Informe o motivo para solicitar o cancelamento.' });
      }
      const anexo = req.file;
      await client.query(
        'INSERT INTO solicitacoes_cancelamento (pedido_id, motivo, anexo, tipo_anexo) VALUES ($1, $2, $3, $4)',
        [id, motivo || null, anexo?.buffer || null, anexo?.mimetype || null]
      );
      await client.query(
        'INSERT INTO pedido_eventos (pedido_id, estado_anterior, estado, autor_cpf, motivo) VALUES ($1, $2, $2, $3, $4)',
        [id, statusAtual, req.session.cpf_pessoa, motivo ? 'Solicitação de cancelamento: ' + motivo : 'Solicitação de cancelamento enviada.']
      );
      await client.query('COMMIT');
      return res.status(202).json({ aviso: 'Solicitação enviada. Aguarde a análise do gerente.' });
    }
    if (req.file) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Os anexos são usados nas solicitações para análise do gerente.' });
    }
    const pendente = statusAtual === 'Aguardando confirmação' &&
      (!pedido.status_pagamento || pedido.status_pagamento === 'Aguardando confirmação');
    let impedimento;
    if (statusAtual === 'Cancelado' || pedido.ja_reembolsado) impedimento = 'Este pedido já foi cancelado ou já tem reembolso registrado.';
    else if (normalizarStatus(statusAtual) === 'Concluído') impedimento = 'Um pedido concluído não pode ser cancelado.';
    else if (!pedido.cliente_fisico && !decisao && !pendente && normalizarStatus(statusAtual) !== 'Em preparação') impedimento = 'O cancelamento direto está disponível somente em preparação.';
    else if (!pendente && !CANCELAVEIS.includes(statusAtual)) impedimento = 'O status atual impede o cancelamento.';
    else if (!pendente && !PAGO.includes(pedido.status_pagamento)) impedimento = 'O pagamento precisa ser verificado antes do cancelamento.';
    if (impedimento) {
      const resultado = 'Cancelamento não realizado. ' + impedimento;
      await client.query(
        `INSERT INTO pedido_eventos (pedido_id, estado_anterior, estado, autor_cpf, motivo)
         SELECT $1::integer, $2::varchar, $2::varchar, $3::varchar, $4::text WHERE NOT EXISTS (
           SELECT 1 FROM pedido_eventos WHERE pedido_id = $1 AND estado = $2 AND autor_cpf = $3 AND motivo = $4
         )`, [id, statusAtual, req.session.cpf_pessoa, resultado]);
      await client.query('COMMIT');
      return res.status(409).json({ erro: resultado });
    }
    const estado = normalizarStatus(statusAtual);
    const percentual = pendente ? null : !pedido.cliente_fisico && decisao
      ? 75 : estado === 'Enviado para entrega' ? 50 : 100;
    const valorBaseCentavos = Math.round(Number(pedido.valor_total_pagamento) * 100);
    const valorReembolso = pendente ? null : Math.round(valorBaseCentavos * percentual / 100) / 100;
    const repor = !pendente && estado !== 'Enviado para entrega' && !pedido.enviado_em && !pedido.ja_enviado;
    if (repor) {
      const itens = await client.query(
        'SELECT livro_id_livro, quantidade FROM pedido_has_livro WHERE pedido_id_pedido = $1 ORDER BY livro_id_livro', [id]
      );
      for (const item of itens.rows) {
        await client.query('UPDATE livros SET estoque = estoque + $1 WHERE id_livro = $2',
          [item.quantidade, item.livro_id_livro]);
      }
    }

    await client.query("UPDATE pedidos SET status_pedido = 'Cancelado', ocultar_cancelado_cliente = $2 WHERE id_pedido = $1",
      [id, gerente !== true && estado === 'Em preparação']);
    if (pendente && pedido.status_pagamento) {
      await client.query("UPDATE pagamentos SET status_pagamento = 'Cancelado' WHERE pedido_id_pedido = $1", [id]);
    }
    await client.query(
      `INSERT INTO pedido_eventos (pedido_id, estado_anterior, estado, autor_cpf, motivo,
         percentual, reembolso, situacao, estoque_reposto, processado_em)
       VALUES ($1, $2, 'Cancelado', $3, $4, $5, $6,
         CASE WHEN $5::smallint IS NOT NULL THEN 'Simulado' END, $7,
         CASE WHEN $5::smallint IS NOT NULL THEN NOW() END)`,
      [id, estado, req.session.cpf_pessoa, motivo || (pendente ? 'Cancelamento solicitado. Pedido pendente cancelado sem reembolso.' : estado === 'Atraso' ? 'Atraso na entrega' : 'Cancelamento solicitado e concluído.'),
        percentual, valorReembolso, repor]
    );
    if (decisao) await registrarDecisao(client, id, decisao, motivo, 'Cancelado', req.session.cpf_pessoa);
    await client.query('COMMIT');
    return res.json({
      sucesso: true,
      id_pedido: id,
      status_pedido: 'Cancelado',
      percentual_reembolso: percentual,
      valor_reembolso: valorReembolso,
      aviso: pendente ? 'Pedido pendente cancelado. Nenhum valor foi cobrado.' : 'Reembolso simulado registrado.'
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao cancelar pedido do cliente:', error.code || 'inesperado');
    return res.status(500).json({ erro: 'Não foi possível cancelar o pedido.' });
  } finally {
    client?.release();
  }
}

async function registrarDecisao(client, id, decisao, motivo, estado, autor) {
  await client.query('UPDATE solicitacoes_cancelamento SET estado = $2, resposta = $3, analisado_em = NOW() WHERE pedido_id = $1',
    [id, decisao, motivo || null]);
  await client.query(
    'INSERT INTO pedido_eventos (pedido_id, estado_anterior, estado, autor_cpf, motivo) VALUES ($1, $2, $2, $3, $4)',
    [id, estado, autor, 'Solicitação ' + decisao.toLowerCase() + (motivo ? ': ' + motivo : '.')]
  );
}

async function decidirCancelamento(req, res) {
  const decisao = req.body?.decisao;
  if (!['Aprovada', 'Recusada'].includes(decisao) || (decisao === 'Recusada' && !texto(req.body?.motivo, 5000))) {
    return res.status(400).json({ erro: 'Informe uma decisão e explique caso recuse.' });
  }
  return cancelarPedidoCliente(req, res, true, decisao);
}

async function avisosCancelamento(req, res) {
  try {
    const { rows } = await db.query(`
      SELECT s.pedido_id, s.motivo, s.criado_em, s.tipo_anexo, pessoa.nome_pessoa AS cliente, p.status_pedido
      FROM solicitacoes_cancelamento s JOIN pedidos p ON p.id_pedido = s.pedido_id
      JOIN pessoas pessoa ON pessoa.cpf_pessoa = p.cliente_pessoa_cpf_pessoa
      WHERE s.estado = 'Pendente' ORDER BY s.criado_em, s.pedido_id`);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ erro: 'Não foi possível consultar os avisos.' });
  }
}

async function anexoCancelamento(req, res) {
  try {
    const { rows: [solicitacao] } = await db.query(
      'SELECT anexo, tipo_anexo FROM solicitacoes_cancelamento WHERE pedido_id = $1 AND anexo IS NOT NULL', [idPositivo(req.params.id)]);
    if (!solicitacao) return res.status(404).json({ erro: 'Anexo não encontrado.' });
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    res.type(solicitacao.tipo_anexo).send(solicitacao.anexo);
  } catch (error) {
    res.status(500).json({ erro: 'Não foi possível abrir o anexo.' });
  }
}

async function listarFormasPagamento(req, res) {
  try {
    const r = await db.query('SELECT id_forma_pagamento, nome_forma_pagamento FROM formas_pagamento WHERE ativa = TRUE ORDER BY nome_forma_pagamento');
    res.json(r.rows);
  } catch (error) {
    res.status(500).json({ erro: 'Não foi possível listar formas de pagamento.' });
  }
}

function texto(valor, limite) {
  if (valor == null) return '';
  return typeof valor === 'string' && !valor.includes('\0') && valor.trim().length <= limite ? valor.trim() : null;
}

function validarEndereco(dados) {
  const limites = { cep: 9, rua: 200, numero: 30, complemento: 100, bairro: 100, cidade: 100, estado: 2 };
  const valores = Object.entries(limites).map(([campo, limite]) => texto(dados[campo], limite));
  if (valores.includes(null) || (dados.entrega !== undefined && typeof dados.entrega !== 'boolean')) return null;
  if (dados.entrega === false || (!dados.entrega && valores.every(v => !v))) return valores.map(() => null);
  const [cep, rua, numero, complemento, bairro, cidade, estado] = valores;
  if (!/^\d{5}-?\d{3}$/.test(cep) || !rua || !numero || !bairro || !cidade || !/^[A-Z]{2}$/i.test(estado)) return null;
  return [cep.replace(/^(\d{5})(\d{3})$/, '$1-$2'), rua, numero, complemento || null, bairro, cidade, estado.toUpperCase()];
}

async function buscarClientes(req, res) {
  const nome = texto(req.query.nome, 150);
  if (!nome || nome.length < 2) return res.json([]);
  try {
    const { rows } = await db.query(
      `SELECT p.cpf_pessoa AS cliente_id, p.nome_pessoa AS nome
       FROM clientes c JOIN pessoas p ON p.cpf_pessoa = c.pessoa_cpf_pessoa
       WHERE strpos(lower(p.nome_pessoa), lower($1)) > 0 ORDER BY p.nome_pessoa LIMIT 20`, [nome]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ erro: 'Não foi possível procurar clientes.' });
  }
}

function validarDadosPedidoPresencial(dados) {
  const d = dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {};
  const cpf = typeof d.cpf_cliente === 'string' ? d.cpf_cliente.trim() : '';
  const data = d.data_pedido || null;
  const entrega = d.data_prevista_entrega || null;
  const status = d.status_pedido || 'Em preparação';
  const nome = texto(d.nome_cliente, 150);
  const telefone = texto(d.telefone, 30);
  const itensValidos = Array.isArray(d.itens) && d.itens.length > 0 && d.itens.length <= 30 &&
    d.itens.every(item => item &&
      idPositivo(item.id_livro) &&
      Boolean(idPositivo(item.quantidade)) &&
      Number(item.quantidade) >= 1 && Number(item.quantidade) <= 100);
  return (Boolean(nome) || cpfValido(cpf)) && nome !== null && telefone !== null &&
    (!d.cliente_id || /^\d{11}$|^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(d.cliente_id)) &&
    itensValidos && Boolean(idPositivo(d.forma_pagamento_id)) && status === 'Em preparação' &&
    Boolean(validarEndereco(d)) && texto(d.detalhes_pedido, 5000) !== null &&
    (!d.tentativa_id || /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(d.tentativa_id)) &&
    (d.cliente_fisico === undefined || d.cliente_fisico === true) &&
    (!data || dataISOValida(data)) && (!entrega || dataISOValida(entrega)) &&
    (!data || !entrega || entrega >= data) &&
    (!d.cep || /^\d{5}-?\d{3}$/.test(String(d.cep)));
}

async function criarPedidoPresencial(req, res) {
  const d = req.body || {};
  const cpf = typeof d.cpf_cliente === 'string' ? d.cpf_cliente.trim() : '';
  const data = d.data_pedido || null;
  const entrega = d.data_prevista_entrega || null;
  const forma = idPositivo(d.forma_pagamento_id);
  const status = d.status_pedido || 'Em preparação';
  if (!validarDadosPedidoPresencial(d)) {
    return res.status(400).json({ erro: 'Informe cliente, ao menos um livro, quantidades, datas, pagamento e status válidos.' });
  }

  const itensAgrupados = new Map();
  for (const item of d.itens) {
    const id = Number(item.id_livro);
    itensAgrupados.set(id, (itensAgrupados.get(id) || 0) + Number(item.quantidade));
  }
  if ([...itensAgrupados.values()].some(q => q > 100)) {
    return res.status(400).json({ erro: 'A quantidade total de um livro não pode ultrapassar 100.' });
  }

  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    if (d.tentativa_id) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [d.tentativa_id]);
      const anterior = await client.query(
        `SELECT p.id_pedido, p.total_pedido, p.cliente_fisico FROM pagamentos pg
         JOIN pedidos p ON p.id_pedido = pg.pedido_id_pedido WHERE pg.tentativa_id = $1`, [d.tentativa_id]
      );
      if (anterior.rowCount) {
        await client.query('COMMIT');
        if (!anterior.rows[0].cliente_fisico) return res.status(409).json({ erro: 'Identificador de tentativa indispon?vel.' });
        return res.status(201).json({ sucesso: true, ...anterior.rows[0] });
      }
    }
    let cliente = null;
    if (d.cliente_id || cpf) {
      const vinculo = await client.query(
        `SELECT pessoa_cpf_pessoa, nome_pessoa FROM clientes JOIN pessoas ON cpf_pessoa = pessoa_cpf_pessoa
         WHERE REGEXP_REPLACE(pessoa_cpf_pessoa, '[^0-9]', '', 'g') = $1`,
        [(d.cliente_id || cpf).replace(/\D/g, '')]
      );
      cliente = vinculo.rows[0];
      if (!cliente) {
        await client.query('ROLLBACK');
        return res.status(404).json({ erro: 'Cliente não encontrado.' });
      }
    }
    const formaResult = await client.query(
      'SELECT id_forma_pagamento FROM formas_pagamento WHERE id_forma_pagamento = $1 AND ativa = TRUE',
      [forma]
    );
    if (!formaResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Forma de pagamento inválida.' });
    }

    const ids = [...itensAgrupados.keys()].sort((a,b) => a-b);
    const livrosResult = await client.query(
      `SELECT id_livro, titulo, caminho_imagem_livro, preco, estoque
       FROM livros WHERE id_livro = ANY($1::integer[]) ORDER BY id_livro FOR UPDATE`,
      [ids]
    );
    if (livrosResult.rowCount !== ids.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Um ou mais livros não foram encontrados.' });
    }
    const livros = new Map(livrosResult.rows.map(l => [Number(l.id_livro), l]));
    let subtotalCentavos = 0;
    const itens = [];
    for (const [id, quantidade] of itensAgrupados) {
      const livro = livros.get(id);
      if (quantidade > Number(livro.estoque)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ erro: `Estoque insuficiente para "${livro.titulo}". Disponível: ${livro.estoque}.` });
      }
      const precoCentavos = Math.round(Number(livro.preco) * 100);
      subtotalCentavos += precoCentavos * quantidade;
      itens.push({
        id_livro: id, quantidade, titulo: livro.titulo,
        caminho_imagem_livro: livro.caminho_imagem_livro,
        preco_unitario: (precoCentavos / 100).toFixed(2),
        total_item: (precoCentavos * quantidade / 100).toFixed(2)
      });
    }
    if (subtotalCentavos > 999999999999) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'O total excede o limite aceito pelo sistema.' });
    }
    const total = (subtotalCentavos / 100).toFixed(2);
    const endereco = validarEndereco(d);
    const pedidoResult = await client.query(
      `INSERT INTO pedidos
       (data_pedido, cliente_pessoa_cpf_pessoa, status_pedido, data_prevista_entrega,
        total_pedido, subtotal_pedido, desconto_pedido, frete_pedido,
        endereco_entrega_cep, endereco_entrega_rua, endereco_entrega_numero,
        endereco_entrega_complemento, endereco_entrega_bairro, endereco_entrega_cidade,
        endereco_entrega_estado, cliente_fisico, detalhes_pedido,
        nome_cliente_presencial, telefone_cliente_presencial)
       VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $5, 0, 0,
        $6,$7,$8,$9,$10,$11,$12,TRUE,$13,$14,$15) RETURNING id_pedido`,
      [data, cliente?.pessoa_cpf_pessoa || null, status, entrega, total,
        ...endereco, texto(d.detalhes_pedido, 5000) || null,
        texto(d.nome_cliente, 150) || cliente?.nome_pessoa, texto(d.telefone, 30) || null]
    );
    const pedidoId = pedidoResult.rows[0].id_pedido;
    for (const item of itens) {
      await client.query(
        `INSERT INTO pedido_has_livro
         (livro_id_livro, pedido_id_pedido, quantidade, preco_unitario,
          titulo_livro, caminho_imagem_livro, total_item)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [item.id_livro, pedidoId, item.quantidade, item.preco_unitario,
         item.titulo, item.caminho_imagem_livro, item.total_item]
      );
      await client.query(
        'UPDATE livros SET estoque = estoque - $1 WHERE id_livro = $2 AND estoque >= $1',
        [item.quantidade, item.id_livro]
      );
    }
    await client.query(
      `INSERT INTO pagamentos
       (pedido_id_pedido, valor_total_pagamento, status_pagamento, forma_pagamento_id_forma_pagamento, tentativa_id)
       VALUES ($1, $2, 'Simulado', $3, $4)`,
      [pedidoId, total, forma, d.tentativa_id || null]
    );
    await client.query(
      `INSERT INTO pedido_eventos
       (pedido_id, estado, autor_cpf, motivo) VALUES ($1, $2, $3, 'Cadastro presencial')`,
      [pedidoId, status, req.session.cpf_pessoa]
    );
    await client.query('COMMIT');
    return res.status(201).json({ sucesso: true, id_pedido: pedidoId, total_pedido: Number(total), itens });
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    console.error('Erro ao criar pedido presencial:', error.code || 'inesperado');
    return res.status(500).json({ erro: 'Não foi possível cadastrar o pedido presencial. Verifique a migração de status/histórico e os dados.' });
  } finally { client?.release(); }
}

module.exports = { ocultarCancelado, decidirCancelamento, avisosCancelamento, anexoCancelamento, buscarClientes, listarPedidos, obterPedido, meusPedidos, atualizarStatusPedido, cancelarPedidoCliente, criarPedidoPresencial, listarFormasPagamento, validarDadosPedidoPresencial };
