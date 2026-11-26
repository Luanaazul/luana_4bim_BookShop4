const nomesCapas = {
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

let livrosVitrine = [];
let promocoesVitrine = {};
let generosVitrine = [];
let filtrosAplicados = { titulo: '', genero: '', paginas: null, preco: null };
let observadoresCarrossel = [];
let atualizadoresDeSetas = [];
let resizeCarrosseisInstalado = false;

window.addEventListener('DOMContentLoaded', inicializarVitrine);

async function inicializarVitrine() {
  const filtros = document.getElementById('store-search');
  filtros.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!atualizarFiltrosAplicados()) return;
    renderizarVitrine();
  });
  filtros.addEventListener('reset', () => {
    filtrosAplicados = { titulo: '', genero: '', paginas: null, preco: null };
    document.getElementById('vitrine-max-pages').setCustomValidity('');
    document.getElementById('vitrine-max-price').setCustomValidity('');
    requestAnimationFrame(renderizarVitrine);
  });
  BookShopCart.atualizarAreaConta(document.getElementById('account-area'));

  try {
    const [respostaLivros, respostaGeneros, ofertas] = await Promise.all([
      fetch(`${window.BOOKSHOP_API_BASE_URL}/livros`),
      fetch(`${window.BOOKSHOP_API_BASE_URL}/livros/generos`),
      fetch(`${window.BOOKSHOP_API_BASE_URL}/promocoes/vitrine`).then(r => r.ok ? r.json() : {}).catch(() => ({}))
    ]);
    if (!respostaLivros.ok) throw new Error(`Falha ao carregar livros: HTTP ${respostaLivros.status}`);
    if (!respostaGeneros.ok) throw new Error(`Falha ao carregar gêneros: HTTP ${respostaGeneros.status}`);
    livrosVitrine = await respostaLivros.json();
    promocoesVitrine = ofertas;
    const generos = await respostaGeneros.json();
    generosVitrine = [...generos].sort((a, b) =>
      String(a.nome_genero).localeCompare(String(b.nome_genero), 'pt-BR', { sensitivity: 'base' })
    );
    preencherGeneros(generosVitrine);
    restaurarFiltrosDaUrl();
    renderizarVitrine();
  } catch (error) {
    console.error(error);
    mostrarAviso('Não foi possível carregar a vitrine. Tente novamente.', true);
    document.getElementById('storefront-grid').replaceChildren();
  }
}

function agruparPorAutor(livros) {
  const grupos = new Map();
  const cadastrados = [...livros].sort((a, b) =>
    Number(a.ordem_cadastro ?? a.id_livro) - Number(b.ordem_cadastro ?? b.id_livro)
  );
  for (const livro of cadastrados) {
    const autor = String(livro.autor || '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR') || livro.id_livro;
    if (!grupos.has(autor)) grupos.set(autor, []);
    grupos.get(autor).push(livro);
  }
  return [...grupos.values()].flat();
}

function renderizarVitrine() {
  observadoresCarrossel.forEach((observador) => observador.disconnect());
  observadoresCarrossel = [];
  atualizadoresDeSetas = [];
  const container = document.getElementById('storefront-grid');
  const termo = filtrosAplicados.titulo.toLocaleLowerCase('pt-BR');
  const livros = livrosVitrine.filter((livro) =>
    String(livro.titulo).toLocaleLowerCase('pt-BR').includes(termo)
    && (!filtrosAplicados.genero
      || String(livro.genero_id) === filtrosAplicados.genero)
    && (filtrosAplicados.paginas === null
      || Number(livro.paginas) <= filtrosAplicados.paginas)
    && (filtrosAplicados.preco === null
      || Number(livro.preco) <= filtrosAplicados.preco)
  );

  container.replaceChildren();
  const pesquisaTextualOuPaginas = Boolean(termo) || filtrosAplicados.paginas !== null || filtrosAplicados.preco !== null;

  if (pesquisaTextualOuPaginas) {
    container.className = 'storefront-grid search-results-grid';
    livros.forEach((livro) => container.appendChild(criarCardLivro(livro)));
    mostrarAviso(livros.length
      ? `${livros.length} livro(s) encontrado(s).`
      : 'Nenhum livro encontrado com esses filtros.');
    return;
  }

  container.className = 'storefront-grid genre-sections';
  const generosExibidos = filtrosAplicados.genero
    ? generosVitrine.filter((genero) => String(genero.id_genero) === filtrosAplicados.genero)
    : generosVitrine;

  let totalExibido = 0;
  generosExibidos.forEach((genero) => {
    const livrosDoGenero = agruparPorAutor(livros.filter(
      (livro) => String(livro.genero_id) === String(genero.id_genero)
    ));
    if (!livrosDoGenero.length) return;

    totalExibido += livrosDoGenero.length;
    const secao = document.createElement('section');
    secao.className = 'genre-section';
    secao.setAttribute('aria-label', `Gênero ${genero.nome_genero}`);

    const cabecalho = document.createElement('div');
    cabecalho.className = 'genre-section-heading';
    const titulo = document.createElement('h3');
    titulo.textContent = genero.nome_genero;
    cabecalho.appendChild(titulo);

    const trilho = document.createElement('div');
    trilho.className = 'genre-carousel';
    const anterior = document.createElement('button');
    anterior.type = 'button';
    anterior.className = 'carousel-arrow carousel-arrow-prev';
    anterior.setAttribute('aria-label', `Livros anteriores de ${genero.nome_genero}`);
    anterior.textContent = '‹';

    const viewport = document.createElement('div');
    viewport.className = 'carousel-viewport';
    viewport.setAttribute('tabindex', '0');
    viewport.setAttribute('aria-label', `Livros de ${genero.nome_genero}`);

    const faixa = document.createElement('div');
    faixa.className = 'carousel-track';
    livrosDoGenero.forEach((livro) => faixa.appendChild(criarCardLivro(livro)));
    viewport.appendChild(faixa);

    const proximo = document.createElement('button');
    proximo.type = 'button';
    proximo.className = 'carousel-arrow carousel-arrow-next';
    proximo.setAttribute('aria-label', `Próximos livros de ${genero.nome_genero}`);
    proximo.textContent = '›';

    trilho.append(anterior, viewport, proximo);
    secao.append(cabecalho, trilho);
    container.appendChild(secao);

    const atualizarSetas = () => {
      const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const podeNavegar = maxScroll > 2;
      anterior.hidden = !podeNavegar;
      proximo.hidden = !podeNavegar;
      anterior.disabled = viewport.scrollLeft <= 2;
      proximo.disabled = viewport.scrollLeft >= maxScroll - 2;
    };

    const deslocarUmCard = (direcao) => {
      const card = faixa.querySelector('.book-card');
      if (!card) return;
      const estiloFaixa = getComputedStyle(faixa);
      const gap = parseFloat(estiloFaixa.columnGap || estiloFaixa.gap) || 0;
      viewport.scrollBy({
        left: direcao * (card.getBoundingClientRect().width + gap),
        behavior: 'smooth'
      });
    };

    anterior.addEventListener('click', () => deslocarUmCard(-1));
    proximo.addEventListener('click', () => deslocarUmCard(1));
    viewport.addEventListener('scroll', atualizarSetas, { passive: true });
    faixa.querySelectorAll('img').forEach((imagem) => {
      imagem.addEventListener('load', atualizarSetas, { once: true });
    });
    if ('ResizeObserver' in window) {
      const observador = new ResizeObserver(atualizarSetas);
      observador.observe(viewport);
      observadoresCarrossel.push(observador);
    } else {
      atualizadoresDeSetas.push(atualizarSetas);
      if (!resizeCarrosseisInstalado) {
        window.addEventListener('resize', () => {
          atualizadoresDeSetas.forEach((atualizar) => atualizar());
        });
        resizeCarrosseisInstalado = true;
      }
    }
    requestAnimationFrame(atualizarSetas);
  });

  mostrarAviso(totalExibido
    ? `${totalExibido} livro(s) na vitrine.`
    : livrosVitrine.length
      ? 'Nenhum livro encontrado com esses filtros.'
      : 'Nenhum livro cadastrado.');
}

function criarCardLivro(livro) {
  const card = document.createElement('article');
  card.className = 'book-card';
  const detalhesUrl = criarUrlDetalhes(livro.id_livro);
  const capa = document.createElement('div');
  capa.className = 'book-cover';
  const linkCapa = document.createElement('a');
  linkCapa.className = 'book-cover-link';
  linkCapa.href = detalhesUrl;
  linkCapa.setAttribute('aria-label', `Ver detalhes de ${livro.titulo}`);
  const placeholder = document.createElement('span');
  placeholder.className = 'cover-placeholder';
  placeholder.textContent = 'Capa indisponível';
  const imagem = document.createElement('img');
  imagem.alt = `Capa de ${livro.titulo}`;
  imagem.loading = 'lazy';
  imagem.addEventListener('load', () => { placeholder.hidden = true; }, { once: true });
  configurarCapa(imagem, livro);
  linkCapa.append(imagem, placeholder);
  capa.append(linkCapa);

  const conteudo = document.createElement('div');
  conteudo.className = 'book-card-content';
  const titulo = document.createElement('h3');
  titulo.textContent = livro.titulo;
  const autor = document.createElement('p');
  autor.className = 'book-author';
  autor.textContent = livro.autor;
  const genero = document.createElement('p');
  genero.className = 'book-meta genre';
  genero.textContent = livro.nome_genero;
  const paginas = document.createElement('p');
  paginas.className = 'book-meta';
  paginas.textContent = `${livro.paginas} páginas`;
  const preco = document.createElement('p');
  preco.className = 'book-price';
  preco.textContent = formatarPreco(livro.preco);
  const estoque = document.createElement('p');
  estoque.className = 'book-stock';
  estoque.textContent = Number(livro.estoque) > 0
    ? `${livro.estoque} disponível(is)`
    : 'Indisponível no momento';

  const acoes = document.createElement('div');
  acoes.className = 'book-card-actions';
  const detalhes = document.createElement('button');
  detalhes.type = 'button';
  detalhes.className = 'details-button';
  detalhes.textContent = 'Ver detalhes';
  detalhes.addEventListener('click', () => window.location.assign(detalhesUrl));
  const adicionar = document.createElement('button');
  adicionar.type = 'button';
  adicionar.textContent = 'Adicionar ao carrinho';
  adicionar.disabled = Number(livro.estoque) < 1;
  adicionar.addEventListener('click', () => adicionarAoCarrinho(livro, adicionar));
  acoes.append(detalhes, adicionar);
  conteudo.append(titulo, autor, genero, paginas, preco);
  const oferta = promocoesVitrine[livro.id_livro];
  if (oferta) {
    const etiqueta = document.createElement('p');
    etiqueta.className = 'book-meta book-promo';
    etiqueta.textContent = `${oferta.nome} · ${formatarPreco(oferta.preco_promocional)} ao selecionar no carrinho`;
    conteudo.append(etiqueta);
  }
  conteudo.append(estoque, acoes);
  card.append(capa, conteudo);
  return card;
}

function preencherGeneros(generos) {
  const seletor = document.getElementById('vitrine-genre');
  generos.forEach((genero) => {
    const opcao = document.createElement('option');
    opcao.value = String(genero.id_genero);
    opcao.textContent = genero.nome_genero;
    seletor.appendChild(opcao);
  });
}

function restaurarFiltrosDaUrl() {
  const parametros = new URLSearchParams(window.location.search);
  const titulo = parametros.get('titulo') || '';
  const genero = parametros.get('genero') || '';
  const paginas = parametros.get('paginas') || '';
  const preco = parametros.get('preco') || '';

  document.getElementById('vitrine-search').value = titulo;
  document.getElementById('vitrine-genre').value = genero;
  document.getElementById('vitrine-max-pages').value = paginas;
  document.getElementById('vitrine-max-price').value = preco;

  if (!atualizarFiltrosAplicados()) {
    filtrosAplicados = { titulo: '', genero: '', paginas: null, preco: null };
  }
}

function criarUrlDetalhes(idLivro) {
  const parametros = new URLSearchParams({ id: String(idLivro) });
  const filtros = new URLSearchParams();
  if (filtrosAplicados.titulo) filtros.set('titulo', filtrosAplicados.titulo);
  if (filtrosAplicados.genero) filtros.set('genero', filtrosAplicados.genero);
  if (filtrosAplicados.paginas !== null) {
    filtros.set('paginas', String(filtrosAplicados.paginas));
  }
  if (filtrosAplicados.preco !== null) filtros.set('preco', String(filtrosAplicados.preco));

  const queryFiltros = filtros.toString();
  const retorno = `/vitrine/index.html${queryFiltros ? `?${queryFiltros}` : ''}`;
  parametros.set('return', retorno);
  return new URL(
    `/vitrine/detalhes/detalhes.html?${parametros.toString()}`,
    window.BOOKSHOP_API_BASE_URL
  ).href;
}

function atualizarFiltrosAplicados() {
  const titulo = document.getElementById('vitrine-search').value.trim();
  const genero = document.getElementById('vitrine-genre').value;
  const campoPaginas = document.getElementById('vitrine-max-pages');
  const valorPaginas = campoPaginas.value;
  const paginas = valorPaginas === '' ? null : Number(valorPaginas);
  const limiteInvalido = paginas !== null
    && (!Number.isInteger(paginas) || paginas < 1);

  campoPaginas.setCustomValidity(
    limiteInvalido ? 'Informe um número inteiro positivo.' : ''
  );
  if (limiteInvalido) {
    campoPaginas.reportValidity();
    return false;
  }

  const campoPreco = document.getElementById('vitrine-max-price');
  const valorPreco = campoPreco.value;
  const preco = valorPreco === '' ? null : Number(valorPreco);
  const precoInvalido = preco !== null && (!Number.isFinite(preco) || preco < 0);
  campoPreco.setCustomValidity(precoInvalido ? 'Informe um preço válido, igual ou maior que zero.' : '');
  if (precoInvalido) {
    campoPreco.reportValidity();
    return false;
  }

  filtrosAplicados = { titulo, genero, paginas, preco };
  return true;
}

async function adicionarAoCarrinho(livro, botao) {
  botao.disabled = true;
  const textoOriginal = botao.textContent;
  botao.textContent = 'Verificando estoque...';
  try {
    const itens = BookShopCart.lerItens();
    const itemAtual = itens.find((item) => item.id_livro === Number(livro.id_livro));
    const novosItens = itemAtual
      ? itens.map((item) => item.id_livro === Number(livro.id_livro)
        ? { ...item, quantidade: item.quantidade + 1 }
        : item)
      : [...itens, { id_livro: Number(livro.id_livro), quantidade: 1 }];
    if (itemAtual && itemAtual.quantidade >= 100) {
      throw new Error('O limite por livro é de 100 unidades.');
    }
    const validacao = await BookShopCart.validarItens(novosItens);
    const itemValidado = validacao.itens.find(
      (item) => item.id_livro === Number(livro.id_livro)
    );
    if (!itemValidado || !itemValidado.disponivel) {
      throw new Error(
        validacao.erros.find((erro) => erro.includes(livro.titulo))
        || 'Não há estoque suficiente para adicionar este livro.'
      );
    }
    BookShopCart.salvarItens(novosItens);
    mostrarAviso('Livro adicionado ao carrinho!');
  } catch (error) {
    mostrarAviso(error.message || 'Não foi possível adicionar o livro.', true);
  } finally {
    botao.disabled = Number(livro.estoque) < 1;
    botao.textContent = textoOriginal;
  }
}

function configurarCapa(imagem, livro) {
  const idLivro = Number(livro.id_livro);
  const caminho = typeof livro.caminho_imagem_livro === 'string'
    ? livro.caminho_imagem_livro.trim()
    : '';
  const arquivoLegado = nomesCapas[idLivro];
  if (!caminho && !arquivoLegado) {
    imagem.hidden = true;
    imagem.removeAttribute('src');
    return;
  }

  const url = caminho
    ? new URL(caminho, window.BOOKSHOP_API_BASE_URL).href
    : new URL(`/imagens/${arquivoLegado}`, window.BOOKSHOP_API_BASE_URL).href;
  imagem.onerror = () => {
    console.error(`Não foi possível carregar a capa do livro ${idLivro}: ${url}`);
    imagem.hidden = true;
  };
  imagem.src = url;
}

function mostrarAviso(texto, erro = false) {
  const status = document.getElementById('storefront-status');
  status.textContent = texto;
  status.classList.toggle('error', erro);
}

function formatarPreco(preco) {
  return Number(preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
