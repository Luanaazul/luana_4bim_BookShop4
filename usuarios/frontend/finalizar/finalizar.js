const CHAVE_TENTATIVA = 'bookshop_tentativa_checkout_v1';
let itensCarrinho = [];
let pedidoAtualId = null;
let cartaoValidado = false;
let enderecos = [];

window.addEventListener('DOMContentLoaded', iniciarFinalizacao);

async function iniciarFinalizacao() {
  BookShopCart.atualizarAreaConta(document.getElementById('account-area'));
  document.getElementById('payment-form').addEventListener('submit', prepararPedido);
  document.getElementById('confirm-order').addEventListener('click', confirmarPedido);
  document.getElementById('copy-pix').addEventListener('click', copiarPix);
  document.getElementById('add-address-form').addEventListener('submit', salvarEndereco);
  document.getElementById('shipping-address').addEventListener('change', atualizarOpcaoSelecionada);
  document.getElementById('edit-address').addEventListener('click', editarEnderecoSelecionado);
  document.getElementById('make-primary-address').addEventListener('click', tornarEnderecoPrincipal);
  document.getElementById('delete-address').addEventListener('click', excluirEnderecoSelecionado);
  document.querySelectorAll('input[name="forma_pagamento_id"]').forEach((radio) => {
    radio.addEventListener('change', atualizarOpcaoSelecionada);
  });

  try {
    const sessao = await obterJson(`${window.BOOKSHOP_API_BASE_URL}/login/sessao`);
    if (!sessao.autenticada) {
      window.location.assign(new URL(
        `/login/login.html?next=${encodeURIComponent('/finalizar/finalizar.html')}`,
        window.BOOKSHOP_API_BASE_URL
      ).href);
      return;
    }

    itensCarrinho = BookShopCart.lerItens();
    if (!itensCarrinho.length) {
      throw new Error('Seu carrinho está vazio. Volte à vitrine para escolher livros.');
    }

    const validacao = await BookShopCart.validarItens(itensCarrinho);
    if (!validacao.valido) {
      throw new Error((validacao.erros || []).join(' '));
    }
    await carregarEnderecos();
    renderizarResumo(validacao);
    configurarMetodos();
  } catch (error) {
    mostrarStatus(error.message || 'Não foi possível preparar o checkout de teste.', true);
    document.getElementById('prepare-payment').disabled = true;
  }
}

function renderizarResumo(validacao) {
  const lista = document.getElementById('checkout-items');
  lista.replaceChildren();
  validacao.itens.forEach((item) => {
    const linha = document.createElement('p');
    linha.textContent = `${item.livro.titulo} — ${item.quantidade} × ${formatar(item.livro.preco)} = ${formatar(item.quantidade * item.livro.preco)}`;
    lista.appendChild(linha);
  });
  document.getElementById('checkout-subtotal').textContent = formatar(validacao.subtotal);
  document.getElementById('checkout-total').textContent = 'Aguardando cotação';
}

function configurarMetodos() {
  document.getElementById('prepare-payment').disabled =
    !document.getElementById('shipping-address').value;
  atualizarOpcaoSelecionada();
}

function atualizarOpcaoSelecionada() {
  const pixSelecionado = document.getElementById('payment-pix').checked;
  const botao = document.getElementById('prepare-payment');
  botao.textContent = pixSelecionado
    ? 'Gerar QR Code demonstrativo'
    : 'Validar formato do cartão';
  botao.disabled = !document.getElementById('shipping-address').value;
}

async function prepararPedido(event) {
  event.preventDefault();
  const botao = document.getElementById('prepare-payment');
  botao.disabled = true;
  mostrarStatus('Validando estoque e preparando o pedido simulado...', false);

  try {
    const formaPagamentoId = Number(
      new FormData(document.getElementById('payment-form')).get('forma_pagamento_id')
    );
    const enderecoId = Number(document.getElementById('shipping-address').value);
    if (!Number.isInteger(enderecoId) || enderecoId < 1) {
      throw new Error('Selecione ou cadastre um endereço de entrega.');
    }
    const promocoes = BookShopCart.lerPromocoes();
    const cotacao = await requisicaoJson(
      `${window.BOOKSHOP_API_BASE_URL}/compras/cotacao`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          itens: itensCarrinho,
          forma_pagamento_id: formaPagamentoId,
          promocao_codigos: promocoes,
          endereco_id: enderecoId
        })
      }
    );
    renderizarCotacao(cotacao);
    const tentativaId = obterTentativaId(itensCarrinho, formaPagamentoId, enderecoId, cotacao.desconto_registro);
    const resultado = await requisicaoJson(
      `${window.BOOKSHOP_API_BASE_URL}/compras/preparar`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          itens: itensCarrinho,
          forma_pagamento_id: formaPagamentoId,
          tentativa_id: tentativaId,
          promocao_codigos: promocoes,
          endereco_id: enderecoId
        })
      }
    );

    renderizarCotacao({
      itens: resultado.itens,
      subtotal_pedido: resultado.pedido.subtotal_pedido,
      desconto_pedido: resultado.pedido.desconto_pedido,
      desconto_registro: resultado.pedido.desconto_registro,
      frete_pedido: resultado.pedido.frete_pedido,
      total_pedido: resultado.pedido.total_pedido
    });
    pedidoAtualId = Number(resultado.pedido.id_pedido);
    if (formaPagamentoId === 1) {
      exibirPix(resultado);
      desabilitarSelecaoMetodo();
    } else {
      iniciarValidacaoCartao();
    }
  } catch (error) {
    mostrarStatus(error.message || 'Não foi possível preparar o pedido de teste.', true);
    botao.disabled = false;
  }
}

async function carregarEnderecos(enderecoPreferido) {
  const seletor = document.getElementById('shipping-address');
  const estado = document.getElementById('address-status');
  enderecos = await obterJson(`${window.BOOKSHOP_API_BASE_URL}/enderecos`);
  if (!Array.isArray(enderecos)) {
    throw new Error('A API retornou uma lista de endereços inválida.');
  }
  seletor.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = enderecos.length
    ? 'Selecione um endereço'
    : 'Cadastre um endereço para continuar';
  seletor.appendChild(placeholder);
  enderecos.forEach((endereco) => {
    const opcao = document.createElement('option');
    opcao.value = String(endereco.id_endereco);
    opcao.textContent = `${endereco.rua}, ${endereco.numero} — ${endereco.bairro}, ${endereco.cidade}/${endereco.estado}${endereco.principal ? ' (principal)' : ''}`;
    seletor.appendChild(opcao);
  });
  const escolhido = enderecos.find((endereco) =>
    String(endereco.id_endereco) === String(enderecoPreferido)
  ) || enderecos.find((endereco) => endereco.principal) || enderecos[0];
  if (escolhido) seletor.value = String(escolhido.id_endereco);
  document.getElementById('edit-address').disabled = !escolhido;
  document.getElementById('make-primary-address').disabled =
    !escolhido || escolhido.principal;
  document.getElementById('delete-address').disabled = !escolhido;
  estado.textContent = enderecos.length
    ? ''
    : 'Salve um endereço de entrega antes de preparar o pedido.';
  estado.classList.remove('error');
  configurarMetodos();
}

async function salvarEndereco(event) {
  event.preventDefault();
  const formulario = event.currentTarget;
  const botao = formulario.querySelector('button[type="submit"]');
  botao.disabled = true;
  try {
    const dados = Object.fromEntries(new FormData(formulario).entries());
    const id = formulario.dataset.editId;
    const endereco = await requisicaoJson(
      `${window.BOOKSHOP_API_BASE_URL}/enderecos${id ? `/${id}` : ''}`,
      {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(dados)
      }
    );
    delete formulario.dataset.editId;
    formulario.reset();
    await carregarEnderecos(endereco.id_endereco);
    document.getElementById('address-form-title').textContent = 'Adicionar outro endereço';
    botao.textContent = 'Salvar endereço';
    document.getElementById('address-status').textContent = 'Endereço salvo.';
    document.getElementById('address-status').classList.remove('error');
  } catch (error) {
    document.getElementById('address-status').textContent =
      error.message || 'Não foi possível salvar o endereço.';
    document.getElementById('address-status').classList.add('error');
  } finally {
    botao.disabled = false;
  }
}

function editarEnderecoSelecionado() {
  const id = Number(document.getElementById('shipping-address').value);
  const endereco = enderecos.find((item) => Number(item.id_endereco) === id);
  if (!endereco) return;
  const formulario = document.getElementById('add-address-form');
  for (const campo of ['cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'estado']) {
    formulario.elements.namedItem(campo).value = endereco[campo] || '';
  }
  formulario.dataset.editId = String(endereco.id_endereco);
  document.getElementById('address-form-title').textContent = 'Editar endereço selecionado';
  document.getElementById('save-address').textContent = 'Salvar alterações';
  formulario.closest('details').open = true;
}

async function tornarEnderecoPrincipal() {
  const id = document.getElementById('shipping-address').value;
  if (!id) return;
  await alterarEnderecoSelecionado(id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ principal: true })
  }, 'Endereço principal atualizado.');
}

async function excluirEnderecoSelecionado() {
  const seletor = document.getElementById('shipping-address');
  const id = seletor.value;
  if (!id || !window.confirm('Deseja excluir este endereço salvo?')) return;
  await alterarEnderecoSelecionado(id, { method: 'DELETE' }, 'Endereço excluído.');
}

async function alterarEnderecoSelecionado(id, opcoes, sucesso) {
  const estado = document.getElementById('address-status');
  try {
    await requisicaoJson(
      `${window.BOOKSHOP_API_BASE_URL}/enderecos/${id}`,
      { credentials: 'include', ...opcoes }
    );
    await carregarEnderecos();
    estado.textContent = sucesso;
    estado.classList.remove('error');
  } catch (error) {
    estado.textContent = error.message || 'Não foi possível atualizar o endereço.';
    estado.classList.add('error');
  }
}

function renderizarCotacao(cotacao) {
  const lista = document.getElementById('checkout-items');
  lista.replaceChildren();
  cotacao.itens.forEach((item) => {
    const linha = document.createElement('p');
    linha.textContent = `${item.titulo} — ${item.quantidade} × ${formatar(item.preco_unitario)} = ${formatar(item.total_item)}`;
    lista.appendChild(linha);
  });
  document.getElementById('checkout-subtotal').textContent = formatar(cotacao.subtotal_pedido);
  const desconto = document.getElementById('checkout-discount');
  desconto.textContent = cotacao.desconto_registro
    ? `${cotacao.desconto_registro.nome}${cotacao.desconto_registro.percentual == null ? '' : ` (${cotacao.desconto_registro.percentual}%)`} · ${formatar(cotacao.desconto_pedido)}`
    : formatar(cotacao.desconto_pedido);
  document.getElementById('checkout-shipping').textContent = formatar(cotacao.frete_pedido);
  document.getElementById('checkout-total').textContent = formatar(cotacao.total_pedido);
}

function exibirPix(resultado) {
  const pix = resultado.pagamento && resultado.pagamento.pix;
  if (!pix || !pix.qr_code || !pix.qr_code_base64) {
    throw new Error('Não foi possível gerar o QR Code demonstrativo.');
  }

  const img = document.getElementById('pix-qr');
  img.src = `data:image/png;base64,${pix.qr_code_base64}`;
  document.getElementById('pix-order').textContent =
    `Pedido #${resultado.pedido.id_pedido} · Total ${formatar(resultado.pedido.total_pedido)}`;
  document.getElementById('pix-code').value = pix.qr_code;
  document.getElementById('pix-section').hidden = false;
  mostrarStatus(resultado.pagamento.mensagem, false);
  exibirConfirmacao();
}

function iniciarValidacaoCartao() {
  const formulario = document.getElementById('card-validation-form');
  document.getElementById('payment-form').hidden = true;
  document.getElementById('card-section').hidden = false;
  document.getElementById('validate-card').disabled = false;
  desabilitarSelecaoMetodo();

  formulario.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!formulario.reportValidity()) return;

    const numeroBruto = document.getElementById('card-number').value;
    const numero = numeroBruto.replace(/\D/g, '');
    const validade = document.getElementById('expiration-date').value;
    const codigo = document.getElementById('security-code').value;
    const nome = document.getElementById('cardholder-name').value.trim();
    if (!/^[\d\s-]+$/.test(numeroBruto)) {
      mostrarStatus('O número do cartão deve conter somente números, espaços ou hífens.', true);
      return;
    }
    const erro = validarDadosCartao(numero, validade, codigo, nome);
    if (erro) {
      mostrarStatus(erro, true);
      return;
    }

    if (resultadoCartaoSimulado(numero) === 'recusado') {
      cartaoValidado = false;
      mostrarStatus(
        'Recusa simulada: nenhum dado foi enviado ou armazenado. Use outro número de teste válido para simular aprovação.',
        true
      );
      return;
    }

    cartaoValidado = true;
    formulario.reset();
    formulario.hidden = true;
    mostrarStatus('Aprovação simulada localmente. Nenhum dado foi enviado ou cobrado.', false);
    exibirConfirmacao();
  });
}

function resultadoCartaoSimulado(numero) {
  return numero.endsWith('0') ? 'recusado' : 'aprovado';
}

function validarDadosCartao(numero, validade, codigo, nome) {
  if (nome.length < 2) return 'Informe o nome do titular do cartão.';
  if (!/^\d{13,19}$/.test(numero) || !numeroPassaNoLuhn(numero)) {
    return 'Confira o número do cartão. A validação verifica apenas o formato.';
  }
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(validade)) {
    return 'Informe a validade no formato MM/AA.';
  }
  const [mes, ano] = validade.split('/').map(Number);
  const agora = new Date();
  const anoAtual = agora.getFullYear() % 100;
  if (ano < anoAtual || (ano === anoAtual && mes < agora.getMonth() + 1)) {
    return 'O cartão está vencido.';
  }
  if (!/^\d{3,4}$/.test(codigo)) return 'O código de segurança deve ter 3 ou 4 dígitos.';
  return null;
}

function numeroPassaNoLuhn(numero) {
  let soma = 0;
  let dobrar = false;
  for (let indice = numero.length - 1; indice >= 0; indice -= 1) {
    let digito = Number(numero[indice]);
    if (dobrar) {
      digito *= 2;
      if (digito > 9) digito -= 9;
    }
    soma += digito;
    dobrar = !dobrar;
  }
  return soma % 10 === 0;
}

function desabilitarSelecaoMetodo() {
  document.querySelectorAll('input[name="forma_pagamento_id"]').forEach((radio) => {
    radio.disabled = true;
  });
  document.getElementById('prepare-payment').hidden = true;
  document.getElementById('shipping-address').disabled = true;
  document.getElementById('edit-address').disabled = true;
  document.getElementById('make-primary-address').disabled = true;
  document.getElementById('delete-address').disabled = true;
  document.querySelectorAll('#add-address-form input, #save-address').forEach((campo) => {
    campo.disabled = true;
  });
}

function exibirConfirmacao() {
  document.getElementById('confirmation-section').hidden = false;
  document.getElementById('confirm-order').disabled =
    Number(document.querySelector('input[name="forma_pagamento_id"]:checked').value) === 2
    && !cartaoValidado;
}

async function confirmarPedido() {
  if (!pedidoAtualId) {
    mostrarStatus('Prepare o pedido antes de confirmar.', true);
    return;
  }
  if (
    Number(document.querySelector('input[name="forma_pagamento_id"]:checked').value) === 2
    && !cartaoValidado
  ) {
    mostrarStatus('Valide os dados do cartão antes de confirmar o pedido simulado.', true);
    return;
  }

  const botao = document.getElementById('confirm-order');
  botao.disabled = true;
  botao.textContent = 'Confirmando pedido de teste...';
  try {
    const resultado = await requisicaoJson(
      `${window.BOOKSHOP_API_BASE_URL}/compras/${pedidoAtualId}/confirmar`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      }
    );
    BookShopCart.salvarItens([]);
    BookShopCart.salvarPromocoes([]);
    sessionStorage.removeItem(CHAVE_TENTATIVA);
    sessionStorage.setItem('bookshop_ultimo_pedido', JSON.stringify(resultado.pedido));
    window.location.assign(new URL('/pedido-confirmado.html', window.BOOKSHOP_API_BASE_URL).href);
  } catch (error) {
    mostrarStatus(error.message || 'Não foi possível confirmar o pedido de teste.', true);
    botao.disabled = false;
    botao.textContent = 'Tentar confirmar novamente (simulação)';
  }
}

async function copiarPix() {
  const campo = document.getElementById('pix-code');
  try {
    await navigator.clipboard.writeText(campo.value);
    mostrarStatus('Código demonstrativo copiado. Ele não é um código PIX pagável.', false);
  } catch (error) {
    campo.focus();
    campo.select();
    mostrarStatus('Não foi possível copiar automaticamente. Selecione e copie o código demonstrativo.', true);
  }
}

function obterTentativaId(itens, formaPagamentoId, enderecoId, desconto) {
  const fingerprint = JSON.stringify({
    desconto,
    forma_pagamento_id: formaPagamentoId,
    endereco_id: enderecoId,
    itens: itens
      .map((item) => ({ id_livro: Number(item.id_livro), quantidade: Number(item.quantidade) }))
      .sort((a, b) => a.id_livro - b.id_livro)
  });

  let tentativa;
  try {
    tentativa = JSON.parse(sessionStorage.getItem(CHAVE_TENTATIVA) || 'null');
  } catch (error) {
    tentativa = null;
  }
  if (tentativa && tentativa.fingerprint === fingerprint && tentativa.id) {
    return tentativa.id;
  }

  if (!window.crypto || typeof window.crypto.randomUUID !== 'function') {
    throw new Error('Este navegador não oferece um gerador seguro de identificadores. Abra a BookShop em localhost/HTTPS.');
  }
  const id = window.crypto.randomUUID();
  sessionStorage.setItem(CHAVE_TENTATIVA, JSON.stringify({ fingerprint, id }));
  return id;
}

async function obterJson(url) {
  const resposta = await fetch(url, { credentials: 'include' });
  const dados = await lerJson(resposta);
  if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível consultar a BookShop.');
  return dados;
}

async function requisicaoJson(url, opcoes) {
  const resposta = await fetch(url, opcoes);
  if (resposta.status === 204) {
    if (!resposta.ok) throw new Error('A API recusou a operação.');
    return null;
  }
  const dados = await lerJson(resposta);
  if (!resposta.ok) {
    if (resposta.status === 401) {
      window.location.assign(new URL(
        `/login/login.html?next=${encodeURIComponent('/finalizar/finalizar.html')}`,
        window.BOOKSHOP_API_BASE_URL
      ).href);
    }
    throw new Error(dados.erro || 'Não foi possível concluir a operação.');
  }
  return dados;
}

async function lerJson(resposta) {
  const contentType = resposta.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`A API respondeu com conteúdo inesperado (HTTP ${resposta.status}).`);
  }
  return resposta.json();
}

function mostrarStatus(texto, erro = false) {
  const elemento = document.getElementById('payment-status');
  elemento.textContent = texto;
  elemento.classList.toggle('error', erro);
  elemento.classList.toggle('success', !erro);
}

function formatar(valor) {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
