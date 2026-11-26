const db = require('../database');
const { dataISOValida } = require('../utils/validacao');

const STATUS_VENDA = ['Confirmado', 'Em preparação', 'Enviado', 'Entregue'];

function validarPeriodo(req) {
  const inicioFornecido = Object.prototype.hasOwnProperty.call(req.query, 'inicio');
  const fimFornecido = Object.prototype.hasOwnProperty.call(req.query, 'fim');
  if ((inicioFornecido && typeof req.query.inicio !== 'string') ||
    (fimFornecido && typeof req.query.fim !== 'string')) {
    return { erro: 'Informe cada data uma única vez no formato AAAA-MM-DD.' };
  }
  const inicio = typeof req.query.inicio === 'string' ? req.query.inicio : null;
  const fim = typeof req.query.fim === 'string' ? req.query.fim : null;
  if ((inicio && !dataISOValida(inicio)) || (fim && !dataISOValida(fim))) {
    return { erro: 'Use datas reais no formato AAAA-MM-DD.' };
  }
  if (inicio && fim && inicio > fim) {
    return { erro: 'A data inicial deve ser anterior ou igual à data final.' };
  }
  return { inicio, fim };
}

async function vendasPorMes(req, res) {
  const periodo = validarPeriodo(req);
  if (periodo.erro) return res.status(400).json({ erro: periodo.erro });
  try {
    const result = await db.query(
      `SELECT date_trunc('month', p.data_pedido)::date AS mes,
              COUNT(DISTINCT p.id_pedido)::integer AS quantidade_pedidos,
              COALESCE(SUM(p.total_pedido), 0)::numeric(12,2) AS total_vendido
       FROM pedidos p
       JOIN pagamentos pg ON pg.pedido_id_pedido = p.id_pedido
       WHERE p.status_pedido = ANY($3::varchar[])
         AND pg.status_pagamento = 'Simulado'
         AND ($1::date IS NULL OR p.data_pedido >= $1::date)
         AND ($2::date IS NULL OR p.data_pedido <= $2::date)
       GROUP BY date_trunc('month', p.data_pedido)
       ORDER BY mes DESC`,
      [periodo.inicio, periodo.fim, STATUS_VENDA]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Erro ao gerar relatório de vendas:', error.message);
    return res.status(500).json({ erro: 'Não foi possível gerar o relatório de vendas.' });
  }
}

async function livrosMaisVendidos(req, res) {
  try {
    const result = await db.query(
      `SELECT l.id_livro, l.titulo,
              COALESCE(SUM(i.quantidade) FILTER (WHERE pg.pedido_id_pedido IS NOT NULL), 0)::integer
                AS unidades_vendidas,
              COALESCE(SUM(COALESCE(i.total_item,
                i.quantidade * i.preco_unitario))
                FILTER (WHERE pg.pedido_id_pedido IS NOT NULL), 0)::numeric(12,2) AS receita
       FROM livros l
       LEFT JOIN pedido_has_livro i ON i.livro_id_livro = l.id_livro
       LEFT JOIN pedidos p
         ON p.id_pedido = i.pedido_id_pedido
        AND p.status_pedido = ANY($1::varchar[])
       LEFT JOIN pagamentos pg
         ON pg.pedido_id_pedido = p.id_pedido
        AND pg.status_pagamento = 'Simulado'
       GROUP BY l.id_livro, l.titulo
       HAVING COALESCE(SUM(i.quantidade)
         FILTER (WHERE pg.pedido_id_pedido IS NOT NULL), 0) > 0
       ORDER BY unidades_vendidas DESC, l.titulo
       LIMIT 20`,
      [STATUS_VENDA]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Erro ao gerar relatório de livros:', error.message);
    return res.status(500).json({ erro: 'Não foi possível gerar o relatório de livros.' });
  }
}

module.exports = { vendasPorMes, livrosMaisVendidos };
