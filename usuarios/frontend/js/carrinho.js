window.addEventListener('DOMContentLoaded', inicializarCarrinho);

async function inicializarCarrinho() {
  BookShopCart.atualizarAreaConta(document.getElementById('account-area'));
  atualizarNavegacaoConta();
  document.getElementById('my-orders-link')
    .addEventListener('click', abrirMeusPedidos);
  document.getElementById('checkout-button')
    .addEventListener('click', finalizarCompra);
  await renderizarCarrinho();

  if (new URLSearchParams(window.location.search).get('checkout') === '1') {
    await finalizarCompra();
  }
}

async function abrirMeusPedidos(event) {
  event.preventDefault();
  const destino = '/meus-pedidos.html';
  try {
    const response = await fetch(
      `${window.BOOKSHOP_API_BASE_URL}/login/sessao`,
      { credentials: 'include' }
    );
    if (!response.ok) throw new Error('Não foi possível verificar a sessão.');
    const sessao = await response.json();
    if (sessao.autenticada) {
      window.location.assign(new URL(destino, window.BOOKSHOP_API_BASE_URL).href);
      return;
    }
  } catch (error) {
    console.error('Não foi possível verificar a sessão antes de abrir os pedidos:', error);
  }

  window.alert('Login necessário! Entre e continue sua ação.');
  window.location.assign(new URL(
    `/login/login.html?next=${encodeURIComponent(destino)}`,
    window.BOOKSHOP_API_BASE_URL
  ).href);
}

let versaoCarrinho = 0;

async function renderizarCarrinho() {
  const versao = ++versaoCarrinho;
  const linhas = document.getElementById('cart-lines');
  const status = document.getElementById('cart-status');
  const botao = document.getElementById('checkout-button');
  botao.disabled = true;
  try {
    const itens = BookShopCart.lerItens();
    const promocoes = BookShopCart.lerPromocoes();
    const estado = await BookShopCart.validarItens(itens, { resumo: true, promocao_codigos: promocoes });
    if (versao !== versaoCarrinho) return;
    const aplicados = estado.resumo.desconto_registro?.itens || [];
    linhas.replaceChildren(...estado.itens.map(item =>
      criarLinhaCarrinho(item, aplicados.find(a => a.id_livro === item.id_livro))));
    BookShopCart.salvarPromocoes(estado.resumo.desconto_registro?.selecionadas || []);
    mostrarDescontos(estado);
    const resumo = estado.resumo;
    const primeira = resumo.desconto_registro?.codigo === 'primeira_compra';
    for (const [id, valor] of [
      ['cart-subtotal', resumo.subtotal_pedido],
      ['cart-first-discount', primeira ? resumo.desconto_pedido : 0],
      ['cart-other-discount', primeira ? 0 : resumo.desconto_pedido],
      ['cart-savings', resumo.desconto_pedido],
      ['cart-shipping', resumo.frete_pedido],
      ['cart-total', resumo.total_pedido]
    ]) document.getElementById(id).textContent = formatarPrecoCarrinho(valor);
    botao.disabled = !estado.valido;
    status.textContent = !itens.length ? 'Seu carrinho está vazio.' : estado.valido
      ? `${itens.reduce((soma, item) => soma + item.quantidade, 0)} item(ns) no carrinho.` : estado.erros.join(' ');
    status.classList.toggle('error', itens.length > 0 && !estado.valido);
  } catch (error) {
    if (versao !== versaoCarrinho) return;
    status.textContent = error.message || 'Não foi possível carregar o carrinho.';
    status.classList.add('error');
  }
}

function mostrarDescontos(estado) {
  const lista = document.getElementById('cart-discounts');
  lista.replaceChildren();
  const descontos = [estado.primeira_compra, ...estado.promocoes].filter(Boolean);
  if (!descontos.length) {
    const vazio = document.createElement('p');
    vazio.textContent = 'Nenhum desconto no momento.';
    lista.append(vazio);
    return;
  }
  for (const desconto of descontos) {
    const primeira = desconto.codigo === 'primeira_compra';
    const label = document.createElement('label');
    const campo = document.createElement('input');
    const nome = document.createElement('strong');
    const descricao = document.createElement('small');
    campo.type = 'checkbox';
    campo.checked = primeira || BookShopCart.lerPromocoes().includes(desconto.codigo);
    campo.disabled = primeira || Boolean(estado.primeira_compra);
    nome.textContent = `${desconto.nome} — ${desconto.percentual}%`;
    descricao.textContent = primeira ? 'Aplicado automaticamente.' : estado.primeira_compra
      ? 'Disponível após a primeira compra. As promoções não são cumulativas.' : desconto.descricao || 'Uma promoção por pedido.';
    if (!primeira) descricao.textContent += ` ${desconto.combinavel ? 'Combinável.' : 'Exclusiva.'} Livros: ${desconto.livros.map(l => l.titulo).join(', ')}.`;
    campo.addEventListener('change', () => {
      let selecionadas = BookShopCart.lerPromocoes().filter(c => c !== desconto.codigo);
      if (campo.checked) {
        selecionadas = desconto.combinavel ? selecionadas.filter(c => estado.promocoes.some(p => p.codigo === c && p.combinavel)) : [];
        selecionadas.push(desconto.codigo);
      }
      BookShopCart.salvarPromocoes(selecionadas);
      renderizarCarrinho();
    });
    label.append(campo, nome, descricao);
    lista.append(label);
  }
}

function criarLinhaCarrinho(item, desconto) {
  const linha = document.createElement('article');
  linha.className = 'cart-line';
  const capa = document.createElement('div');
  capa.className = 'cart-book-cover';
  if (item.livro && item.livro.caminho_imagem_livro) {
    const imagem = document.createElement('img');
    imagem.src = new URL(
      item.livro.caminho_imagem_livro,
      window.BOOKSHOP_API_BASE_URL
    ).href;
    imagem.alt = `Capa de ${item.livro.titulo}`;
    imagem.loading = 'lazy';
    imagem.addEventListener('error', () => {
      const placeholder = document.createElement('span');
      placeholder.textContent = 'Capa indisponível';
      capa.replaceChildren(placeholder);
    }, { once: true });
    capa.appendChild(imagem);
  } else {
    const placeholder = document.createElement('span');
    placeholder.textContent = 'Capa indisponível';
    capa.appendChild(placeholder);
  }

  const detalhes = document.createElement('div');
  detalhes.className = 'cart-book-details';
  const titulo = document.createElement('h2');
  titulo.textContent = item.livro ? item.livro.titulo : 'Livro indisponível';
  const autor = document.createElement('p');
  autor.textContent = item.livro ? item.livro.autor : 'Este item não está mais no catálogo.';
  const preco = document.createElement('p');
  preco.textContent = item.livro
    ? `Preço unitário: ${formatarPrecoCarrinho(item.livro.preco)}`
    : 'Preço indisponível';
  const subtotal = document.createElement('p');
  subtotal.className = 'cart-line-subtotal';
  subtotal.textContent = item.livro
    ? `Subtotal: ${formatarPrecoCarrinho(item.livro.preco * item.quantidade)}`
    : 'Subtotal indisponível';
  const disponibilidade = document.createElement('p');
  disponibilidade.textContent = item.disponivel
    ? `Em estoque: ${item.livro.estoque}`
    : 'Quantidade acima do estoque disponível.';
  detalhes.append(titulo, autor, preco, subtotal, disponibilidade);
  if (desconto) {
    const promocao = document.createElement('p');
    promocao.className = 'cart-line-subtotal';
    promocao.textContent = `${desconto.nome} — ${desconto.percentual}% · com desconto ${formatarPrecoCarrinho(desconto.valor_pago)}`;
    detalhes.append(promocao);
  }

  const acoes = document.createElement('div');
  acoes.className = 'line-actions';
  const controlesQuantidade = document.createElement('div');
  controlesQuantidade.className = 'quantity-controls';
  const diminuir = document.createElement('button');
  diminuir.type = 'button';
  diminuir.className = 'quantity-button';
  diminuir.textContent = '−';
  diminuir.setAttribute('aria-label', `Diminuir quantidade de ${titulo.textContent}`);
  diminuir.addEventListener('click', () => alterarQuantidade(item.id_livro, item.quantidade - 1));

  const quantidade = document.createElement('input');
  quantidade.type = 'number';
  quantidade.min = '1';
  quantidade.max = item.livro ? String(Math.min(100, item.livro.estoque)) : '100';
  quantidade.value = String(item.quantidade);
  quantidade.setAttribute('aria-label', `Quantidade de ${titulo.textContent}`);
  quantidade.addEventListener('change', () => alterarQuantidade(item.id_livro, Number(quantidade.value)));

  const aumentar = document.createElement('button');
  aumentar.type = 'button';
  aumentar.className = 'quantity-button';
  aumentar.textContent = '+';
  aumentar.setAttribute('aria-label', `Aumentar quantidade de ${titulo.textContent}`);
  aumentar.disabled = !item.livro
    || !item.disponivel
    || item.quantidade >= Math.min(100, item.livro.estoque);
  aumentar.addEventListener('click', () => alterarQuantidade(item.id_livro, item.quantidade + 1));
  diminuir.disabled = item.quantidade <= 1;
  controlesQuantidade.append(diminuir, quantidade, aumentar);

  const remover = document.createElement('button');
  remover.type = 'button';
  remover.className = 'remove-item';
  remover.textContent = 'Remover';
  remover.addEventListener('click', () => removerItem(item.id_livro));
  acoes.append(controlesQuantidade, remover);

  linha.append(capa, detalhes, acoes);
  return linha;
}

async function alterarQuantidade(idLivro, quantidade) {
  if (!Number.isInteger(quantidade) || quantidade < 0 || quantidade > 100) {
    exibirStatusCheckout('Informe uma quantidade inteira válida.', true);
    await renderizarCarrinho();
    return;
  }

  if (quantidade === 0) {
    await removerItem(idLivro);
    return;
  }

  try {
    const itens = BookShopCart.lerItens().map((item) =>
      item.id_livro === idLivro ? { ...item, quantidade } : item
    );
    const estado = await BookShopCart.validarItens(itens);
    const itemValidado = estado.itens.find((item) => item.id_livro === idLivro);
    if (!itemValidado || !itemValidado.disponivel) {
      throw new Error(
        estado.erros.find((erro) => erro.includes(itemValidado?.livro?.titulo || ''))
        || 'Não há estoque suficiente para essa quantidade.'
      );
    }
    BookShopCart.salvarItens(itens);
    await renderizarCarrinho();
    exibirStatusCheckout('Quantidade atualizada.');
  } catch (error) {
    exibirStatusCheckout(error.message || 'Não foi possível alterar a quantidade.', true);
    await renderizarCarrinho();
  }
}

async function removerItem(idLivro) {
  try {
    const itens = BookShopCart.lerItens().filter((item) => item.id_livro !== idLivro);
    BookShopCart.salvarItens(itens);
    await renderizarCarrinho();
    exibirStatusCheckout('Livro removido do carrinho.');
  } catch (error) {
    exibirStatusCheckout(error.message || 'Não foi possível remover o livro.', true);
  }
}

async function finalizarCompra() {
  const botao = document.getElementById('checkout-button');
  if (botao.disabled) return;
  botao.disabled = true;
  try {
    const itens = BookShopCart.lerItens();
    if (!itens.length) throw new Error('Seu carrinho está vazio.');
    const estado = await BookShopCart.validarItens(itens);
    if (!estado.valido) throw new Error((estado.erros || []).join(' '));
    const sessaoResponse = await fetch(
      `${window.BOOKSHOP_API_BASE_URL}/login/sessao`,
      { credentials: 'include' }
    );
    const sessao = await sessaoResponse.json();
    if (!sessao.autenticada) {
      const destino = '/finalizar/finalizar.html';
      window.location.assign(new URL(
        `/login/login.html?next=${encodeURIComponent(destino)}`,
        window.BOOKSHOP_API_BASE_URL
      ).href);
      return;
    }
    window.location.assign(new URL(
      '/finalizar/finalizar.html',
      window.BOOKSHOP_API_BASE_URL
    ).href);
  } catch (error) {
    exibirStatusCheckout(error.message || 'Não foi possível continuar a compra.', true);
    botao.disabled = false;
  }
}

function exibirStatusCheckout(mensagem, erro = false) {
  const status = document.getElementById('checkout-status');
  status.textContent = mensagem;
  status.classList.toggle('error', erro);
  status.classList.toggle('success', !erro);
}

function formatarPrecoCarrinho(preco) {
  return Number(preco).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

async function atualizarNavegacaoConta() {
  const loginLink = document.getElementById('cart-login-nav');
  if (!loginLink) return;
  try {
    const response = await fetch(`${window.BOOKSHOP_API_BASE_URL}/login/sessao`, { credentials: 'include' });
    const sessao = await response.json();
    loginLink.hidden = Boolean(response.ok && sessao.autenticada);
  } catch {
    loginLink.hidden = false;
  }
}
