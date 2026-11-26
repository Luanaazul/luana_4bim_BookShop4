const capasLegadas = {
  1: 'imperio.jpe',
  2: 'milvezesamor.jpe',
  3: 'it.jpe',
  4: 'divinosrivais.jpe',
  5: 'neuromancer.jpe',
  6: 'corvo.jpe',
  7: 'mulherzinhas.jpe',
  8: 'omundo.jpe',
  9: 'orgulhoepreconceito.jpe',
  10: 'dugeons.jpe',
  11: 'jantar.jpe',
  12: 'enaosobrou.jpe',
  13: '1984.jpe',
  14: 'poemasmentais.jpe',
  15: 'ritalee.jpe'
};

let livroAtual;

window.addEventListener('DOMContentLoaded', inicializarDetalhes);

async function inicializarDetalhes() {
  BookShopCart.atualizarAreaConta(document.getElementById('account-area'));
  configurarLinkVoltar();

  const idLivro = Number(new URLSearchParams(window.location.search).get('id'));
  if (!Number.isSafeInteger(idLivro) || idLivro < 1) {
    mostrarErro('Livro não encontrado.');
    return;
  }

  try {
    const resposta = await fetch(`${window.BOOKSHOP_API_BASE_URL}/livros/${idLivro}`);
    if (resposta.status === 404) {
      mostrarErro('Livro não encontrado.');
      return;
    }
    if (!resposta.ok) {
      throw new Error(`Não foi possível carregar o livro (HTTP ${resposta.status}).`);
    }

    const livro = await resposta.json();
    if (Number(livro.id_livro) !== idLivro) {
      mostrarErro('Livro não encontrado.');
      return;
    }

    livroAtual = livro;
    preencherDetalhes(livro);
    document.getElementById('add-to-cart')
      .addEventListener('click', adicionarLivroAoCarrinho);
    document.getElementById('book-details').hidden = false;
    document.getElementById('details-status').textContent = '';
  } catch (error) {
    console.error(error);
    mostrarErro('Não foi possível carregar os detalhes do livro. Tente novamente.', true);
  }
}

function configurarLinkVoltar() {
  const parametros = new URLSearchParams(window.location.search);
  const retorno = parametros.get('return');
  const link = document.getElementById('back-to-store');

  if (!retorno) return;

  try {
    const urlRetorno = new URL(retorno, window.BOOKSHOP_API_BASE_URL);
    if (
      urlRetorno.origin === new URL(window.BOOKSHOP_API_BASE_URL).origin
      && urlRetorno.pathname === '/vitrine/index.html'
    ) {
      link.href = urlRetorno.href;
    }
  } catch (error) {
    console.warn('O endereço de retorno da vitrine é inválido.');
  }
}

function preencherDetalhes(livro) {
  document.title = `${livro.titulo} | BookShop`;
  document.getElementById('details-title').textContent = livro.titulo;
  document.getElementById('details-author').textContent = livro.autor
    ? `Por ${livro.autor}`
    : 'Autor não informado.';
  preencherCampoOpcional('genre-field', 'details-genre', livro.nome_genero);
  preencherCampoOpcional('pages-field', 'details-pages',
    livro.paginas ? `${livro.paginas} páginas` : '');
  preencherCampoOpcional('publisher-field', 'details-publisher', livro.editora);
  preencherCampoOpcional('year-field', 'details-year', livro.ano);

  const sinopse = typeof livro.sinopse === 'string' ? livro.sinopse.trim() : '';
  const areaSinopse = document.getElementById('synopsis-field');
  if (sinopse) {
    document.getElementById('details-synopsis').textContent = sinopse;
  } else {
    areaSinopse.hidden = true;
  }

  document.getElementById('details-price').textContent = formatarPreco(livro.preco);
  document.getElementById('add-to-cart').disabled = Number(livro.estoque) < 1;
  configurarCapa(livro);
}

function preencherCampoOpcional(containerId, valueId, value) {
  const container = document.getElementById(containerId);
  const texto = value === null || value === undefined ? '' : String(value).trim();
  if (!texto) {
    container.hidden = true;
    return;
  }
  document.getElementById(valueId).textContent = texto;
}

function configurarCapa(livro) {
  const imagem = document.getElementById('details-cover-image');
  const placeholder = document.getElementById('details-cover-placeholder');
  const caminho = typeof livro.caminho_imagem_livro === 'string'
    ? livro.caminho_imagem_livro.trim()
    : '';
  const arquivoLegado = capasLegadas[Number(livro.id_livro)];
  imagem.alt = `Capa de ${livro.titulo}`;
  imagem.hidden = true;
  placeholder.hidden = false;
  if (!caminho && !arquivoLegado) {
    imagem.removeAttribute('src');
    return;
  }

  const url = caminho
    ? new URL(caminho, window.BOOKSHOP_API_BASE_URL).href
    : new URL(`/imagens/${arquivoLegado}`, window.BOOKSHOP_API_BASE_URL).href;
  imagem.addEventListener('load', () => {
    imagem.hidden = false;
    placeholder.hidden = true;
  }, { once: true });
  imagem.addEventListener('error', () => {
    console.error(`Não foi possível carregar a capa do livro ${livro.id_livro}: ${url}`);
    imagem.hidden = true;
    placeholder.hidden = false;
  }, { once: true });
  imagem.src = url;
}

async function adicionarLivroAoCarrinho(event) {
  const botao = event.currentTarget;
  const mensagem = document.getElementById('cart-status');
  botao.disabled = true;
  mensagem.classList.remove('error');
  mensagem.textContent = 'Verificando estoque...';

  try {
    const itens = BookShopCart.lerItens();
    const idLivro = Number(livroAtual.id_livro);
    const itemAtual = itens.find((item) => item.id_livro === idLivro);
    const novosItens = itemAtual
      ? itens.map((item) => item.id_livro === idLivro
        ? { ...item, quantidade: item.quantidade + 1 }
        : item)
      : [...itens, { id_livro: idLivro, quantidade: 1 }];
    if (itemAtual && itemAtual.quantidade >= 100) {
      throw new Error('O limite por livro é de 100 unidades.');
    }
    const validacao = await BookShopCart.validarItens(novosItens);
    const itemValidado = validacao.itens.find((item) => item.id_livro === idLivro);
    if (!itemValidado || !itemValidado.disponivel) {
      throw new Error(
        validacao.erros.find((erro) => erro.includes(livroAtual.titulo))
        || 'Não há estoque suficiente para adicionar este livro.'
      );
    }
    BookShopCart.salvarItens(novosItens);
    mensagem.textContent = 'Livro adicionado ao carrinho!';
  } catch (error) {
    mensagem.classList.add('error');
    mensagem.textContent = error.message || 'Não foi possível adicionar o livro ao carrinho.';
  } finally {
    botao.disabled = Number(livroAtual.estoque) < 1;
  }
}

function mostrarErro(texto, erro = false) {
  const status = document.getElementById('details-status');
  status.textContent = texto;
  status.classList.toggle('error', erro);
  document.getElementById('book-details').hidden = true;
}

function formatarPreco(preco) {
  return Number(preco).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}
