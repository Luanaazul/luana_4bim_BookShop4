const PRIMEIRA_COMPRA = { codigo: 'primeira_compra', nome: 'Primeira compra', percentual: 50 };
const PIX = { codigo: 'pix', nome: 'Desconto PIX', percentual: 5 };
const FRETE_CENTAVOS = 1000;

async function elegivelPrimeiraCompra(db, cpf) {
  if (!cpf) return false;
  const { rows: [row] } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM clientes WHERE pessoa_cpf_pessoa = $1)
       AND NOT EXISTS (
         SELECT 1 FROM pedidos p LEFT JOIN pagamentos g ON g.pedido_id_pedido = p.id_pedido
         WHERE p.cliente_pessoa_cpf_pessoa = $1 AND
           (p.primeira_compra_utilizada OR
            (p.status_pedido <> 'Aguardando confirmação' AND g.status_pagamento IN ('Simulado','Pago','Confirmado')) OR
            EXISTS (SELECT 1 FROM pedido_eventos e WHERE e.pedido_id = p.id_pedido AND e.percentual IS NOT NULL))
       ) AS elegivel`, [cpf]);
  return row.elegivel;
}

function livrosAtingidos(campanha, catalogo) {
  const c = campanha.criterios || {};
  return catalogo.filter(livro => {
    const testes = [];
    if (c.generos?.length) testes.push(c.generos.includes(livro.genero_id));
    if (c.autores?.length) testes.push(c.autores.includes(livro.autor));
    if (c.editoras?.length) testes.push(c.editoras.includes(livro.editora));
    if (c.livros?.length) testes.push(c.livros.includes(livro.id_livro));
    if (c.minimo != null || c.maximo != null) {
      const preco = Number(livro.preco);
      testes.push((c.minimo == null || (c.minimo_exclusivo ? preco > c.minimo : preco >= c.minimo)) &&
        (c.maximo == null || (c.maximo_exclusivo ? preco < c.maximo : preco <= c.maximo)));
    }
    return !testes.length || (campanha.combinacao === 'OU' ? testes.some(Boolean) : testes.every(Boolean));
  });
}

async function catalogoPromocoes(db, ids = null) {
  const { rows } = await db.query(
    `SELECT l.id_livro, l.titulo, l.autor, l.editora, l.preco, l.genero_id, l.caminho_imagem_livro, g.nome_genero
       FROM livros l JOIN generos g ON g.id_genero = l.genero_id
      WHERE ($1::integer[] IS NULL OR l.id_livro = ANY($1)) ORDER BY l.ordem_cadastro`, [ids]);
  return rows;
}

async function descontosDisponiveis(db, cpf, ids = []) {
  const primeira = await elegivelPrimeiraCompra(db, cpf);
  const { rows } = await db.query(
    `SELECT codigo, nome, descricao, percentual, criterios, combinacao, combinavel FROM promocoes
     WHERE ativa AND inicio <= statement_timestamp() AND (termino IS NULL OR termino > statement_timestamp())
     ORDER BY percentual DESC, codigo`);
  const catalogo = rows.length && ids.length ? await catalogoPromocoes(db, ids) : [];
  const promocoes = rows.map(({ criterios, combinacao, ...p }) => ({
    ...p, livros: livrosAtingidos({ criterios, combinacao }, catalogo).map(({ id_livro, titulo }) => ({ id_livro, titulo }))
  })).filter(p => p.livros.length);
  return { primeira_compra: primeira ? PRIMEIRA_COMPRA : null, promocoes };
}

function codigosPromocao(valor) {
  return [...new Set(Array.isArray(valor) ? valor : valor ? [valor] : [])];
}

function selecionarDesconto(disponiveis, codigos, forma, estrito = true) {
  if (disponiveis.primeira_compra) return disponiveis.primeira_compra;
  const selecionados = codigosPromocao(codigos);
  const campanhas = disponiveis.promocoes.filter(p => selecionados.includes(p.codigo));
  if (estrito && (campanhas.length !== selecionados.length || (campanhas.length > 1 && campanhas.some(p => !p.combinavel)))) {
    const erro = new Error('Uma promoção está indisponível ou não pode ser combinada. Revise o carrinho.');
    erro.status = 409;
    throw erro;
  }
  const exclusivas = campanhas.filter(p => !p.combinavel);
  if (campanhas.length) return { campanhas: exclusivas.length ? [exclusivas[0]] : campanhas };
  return forma === 1 ? PIX : null;
}

function precoPromocional(centavos, percentual) {
  return centavos - Math.round(centavos * percentual / 100);
}

function calcularResumo(centavos, desconto, comFrete = true, itens = []) {
  let registro = null;
  let economia = 0;
  if (desconto?.campanhas) {
    const aplicadas = itens.slice().sort((a,b) => a.id_livro - b.id_livro).flatMap(item => {
      const campanha = desconto.campanhas.find(p => p.livros.some(l => l.id_livro === item.id_livro));
      if (!campanha) return [];
      const preco = Math.round(Number(item.preco_unitario) * 100);
      const original = preco * item.quantidade;
      const pago = precoPromocional(original, campanha.percentual);
      economia += original - pago;
      return [{ id_livro: item.id_livro, titulo: item.titulo, quantidade: item.quantidade,
        codigo: campanha.codigo, nome: campanha.nome, percentual: campanha.percentual,
        preco_unitario_original: preco / 100, valor_original: original / 100,
        desconto: (original - pago) / 100, valor_pago: pago / 100 }];
    });
    const selecionadas = desconto.campanhas.map(p => p.codigo);
    const usadas = new Set(aplicadas.map(i => i.codigo));
    const campanhas = desconto.campanhas.filter(p => usadas.has(p.codigo))
      .map(({ codigo, nome, percentual }) => ({ codigo, nome, percentual }));
    registro = { codigo: campanhas.length === 1 ? campanhas[0].codigo : 'campanhas',
      nome: campanhas.map(p => p.nome).join(' + '), percentual: campanhas.length === 1 ? campanhas[0].percentual : null,
      selecionadas, campanhas, itens: aplicadas };
  } else if (desconto) {
    economia = Math.round(centavos * desconto.percentual / 100);
    registro = { codigo: desconto.codigo, nome: desconto.nome, percentual: desconto.percentual };
  }
  const frete = comFrete ? FRETE_CENTAVOS : 0;
  return {
    subtotal_pedido: centavos / 100,
    desconto_pedido: economia / 100,
    frete_pedido: frete / 100,
    total_pedido: (centavos - economia + frete) / 100,
    desconto_registro: registro
  };
}

module.exports = { elegivelPrimeiraCompra, descontosDisponiveis, selecionarDesconto, calcularResumo,
  livrosAtingidos, catalogoPromocoes, precoPromocional };
