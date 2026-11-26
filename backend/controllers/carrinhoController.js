const db = require('../database');
const { descontosDisponiveis, selecionarDesconto, calcularResumo } = require('../utils/descontos');

async function validarItensCarrinho(itens) {
  if (!Array.isArray(itens) || itens.length > 100) {
    const error = new Error('Carrinho inválido.');
    error.status = 400;
    throw error;
  }

  const idsVistos = new Set();
  for (const item of itens) {
    if (
      !item ||
      !Number.isInteger(item.id_livro) ||
      item.id_livro < 1 ||
      item.id_livro > 2147483647 ||
      !Number.isInteger(item.quantidade) ||
      item.quantidade < 1 ||
      item.quantidade > 100 ||
      idsVistos.has(item.id_livro)
    ) {
      const error = new Error('Os itens do carrinho precisam ter livros e quantidades válidos.');
      error.status = 400;
      throw error;
    }
    idsVistos.add(item.id_livro);
  }

  if (itens.length === 0) {
    return { valido: false, itens: [], erros: ['O carrinho está vazio.'], subtotal: 0 };
  }

  const resultado = await db.query(
    `SELECT id_livro, titulo, autor, preco, estoque, caminho_imagem_livro
     FROM livros
     WHERE id_livro = ANY($1::integer[])`,
    [itens.map((item) => item.id_livro)]
  );

  const livros = new Map(
    resultado.rows.map((livro) => [Number(livro.id_livro), livro])
  );
  const erros = [];
  let subtotal = 0;

  const itensVerificados = itens.map((item) => {
    const livro = livros.get(item.id_livro);
    if (!livro) {
      erros.push(`O livro ${item.id_livro} não está mais disponível.`);
      return {
        id_livro: item.id_livro,
        quantidade: item.quantidade,
        disponivel: false,
        livro: null
      };
    }

    const estoque = Number(livro.estoque);
    const preco = Number(livro.preco);
    const disponivel = Number.isInteger(estoque) && item.quantidade <= estoque;
    subtotal = Math.round((subtotal + preco * item.quantidade) * 100) / 100;
    if (!disponivel) {
      erros.push(`Estoque insuficiente para "${livro.titulo}". Disponível: ${estoque}.`);
    }

    return {
      id_livro: item.id_livro,
      quantidade: item.quantidade,
      disponivel,
      livro: {
        titulo: livro.titulo,
        autor: livro.autor,
        preco,
        estoque,
        caminho_imagem_livro: livro.caminho_imagem_livro
      }
    };
  });

  return {
    valido: erros.length === 0,
    itens: itensVerificados,
    erros,
    subtotal
  };
}

async function validarCarrinho(req, res) {
  try {
    const resultado = await validarItensCarrinho(req.body && req.body.itens);
    if (req.body?.resumo) {
      const itens = resultado.itens.filter(i => i.livro).map(i => ({
        id_livro: i.id_livro, quantidade: i.quantidade, titulo: i.livro.titulo, preco_unitario: i.livro.preco
      }));
      const disponiveis = await descontosDisponiveis(db, req.session?.cpf_pessoa, itens.map(i => i.id_livro));
      const desconto = selecionarDesconto(disponiveis, req.body.promocao_codigos ?? req.body.promocao_codigo, null, false);
      return res.json({ ...resultado, ...disponiveis, resumo: calcularResumo(
        Math.round(resultado.subtotal * 100), desconto, itens.length > 0, itens
      ) });
    }
    return res.json(resultado);
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ erro: error.message });
    }
    console.error('Erro ao validar carrinho:', error.message);
    return res.status(500).json({ erro: 'Não foi possível validar o carrinho.' });
  }
}

module.exports = { validarCarrinho, validarItensCarrinho };
