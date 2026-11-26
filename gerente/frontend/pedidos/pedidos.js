const $ = id => document.getElementById(id);
const ENDERECO = ['cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'estado'];
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let pedidoEmEdicao = null;
let tentativa;
const itens = new Map();
let catalogo = [];
let pedidos = [];
let origemSelecionada = 'presencial';
let gerente = false;

window.addEventListener('DOMContentLoaded', async () => {
  $('pedido-form').addEventListener('submit', salvarPedido);
  $('limpar-pedido').addEventListener('click', limparFormulario);
  $('entrega').addEventListener('change', atualizarEntrega);
  $('cep').addEventListener('blur', buscarCep);
  $('adicionar-livro-pedido').addEventListener('click', adicionarLivro);
  $('busca-livro').addEventListener('input', mostrarCatalogo);
  for (const botao of $('origens-pedido').querySelectorAll('button')) {
    botao.addEventListener('click', () => selecionarLista(botao.dataset.origem));
  }
  limparFormulario();
  await selecionarLista('presencial');
  try {
    const [formas, livros, sessao] = await Promise.all([api('/pedidos/formas-pagamento'), api('/livros'), api('/login/sessao')]);
    gerente = sessao.gerente;
    for (const botao of $('origens-pedido').querySelectorAll('button')) {
      botao.hidden = !gerente && botao.dataset.origem !== 'presencial';
    }
    if (gerente) {
      selecionarLista('todos');
      $('avisos-pedidos').hidden = false;
      $('avisos-pedidos').onclick = () => {
        $('avisos-dialog').showModal();
        carregarAvisos();
      };
      carregarAvisos();
    }
    if (!gerente) {
      for (const link of $('menu-pedidos').querySelectorAll('a')) {
        if (!['./pedidos.html', '/vitrine/index.html'].includes(link.getAttribute('href'))) link.closest('li').hidden = true;
      }
    }
    $('forma_pagamento_id').replaceChildren(new Option('Selecione', ''));
    for (const f of formas) $('forma_pagamento_id').add(new Option(f.nome_forma_pagamento, f.id_forma_pagamento));
    catalogo = livros;
    mostrarCatalogo();
  } catch (erro) { status(erro.message); }
});

async function api(url, method = 'GET', dados) {
  const resposta = await fetch(url, {
    method, credentials: 'same-origin',
    ...(dados && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) }),
  });
  const json = await resposta.json();
  if (!resposta.ok) throw new Error(json.erro || `Erro HTTP ${resposta.status}`);
  return json;
}

function rotuloStatus(status) { return status === 'Atraso' ? 'Atraso no envio' : status; }
function status(texto) { $('status').textContent = texto; }
function moeda(v) { return BRL.format(Number(v || 0)); }
function data(v) { return v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—'; }
function elemento(tag, texto) {
  const e = document.createElement(tag);
  if (texto != null) e.textContent = texto;
  return e;
}

function atualizarEntrega() {
  const entrega = $('entrega').checked;
  $('campos-entrega').hidden = !entrega;
  for (const id of ENDERECO) {
    $(id).disabled = !entrega;
    $(id).required = entrega && id !== 'complemento';
  }
}

function limparFormulario() {
  $('pedido-form').reset();
  pedidoEmEdicao = null;
  tentativa = null;
  itens.clear();
  configurarEdicao(false);
  atualizarEntrega();
  mostrarItens();
  status('');
}

async function buscarCep() {
  const cep = $('cep').value.replace(/\D/g, '');
  if (cep.length !== 8 || !$('entrega').checked) return;
  const formulario = pedidoEmEdicao;
  const campos = ['rua', 'bairro', 'cidade', 'estado'];
  const antes = campos.map(id => $(id).value);
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error();
    const d = await r.json();
    if (d.erro) throw new Error();
    if ($('cep').value.replace(/\D/g, '') !== cep || !$('entrega').checked || pedidoEmEdicao !== formulario) return;
    [d.logradouro, d.bairro, d.localidade, d.uf].forEach((valor, i) => {
      if (valor && $(campos[i]).value === antes[i]) $(campos[i]).value = valor;
    });
    status('Confira o endereço e preencha o número.');
  } catch {
    if ($('cep').value.replace(/\D/g, '') === cep) status('Consulta de CEP indisponível. Preencha o endereço manualmente.');
  }
}

function mostrarCatalogo() {
  const busca = $('busca-livro').value.trim().toLocaleLowerCase('pt-BR');
  $('livro-pedido').replaceChildren(new Option('Selecione um livro', ''));
  for (const livro of catalogo) {
    if (!`${livro.titulo} ${livro.autor}`.toLocaleLowerCase('pt-BR').includes(busca)) continue;
    const opt = new Option(`${livro.titulo} · ${moeda(livro.preco)} · estoque ${livro.estoque}`, livro.id_livro);
    opt.disabled = Number(livro.estoque) <= 0;
    $('livro-pedido').add(opt);
  }
}

function adicionarLivro() {
  const id = Number($('livro-pedido').value);
  const livro = catalogo.find(l => Number(l.id_livro) === id);
  const quantidade = Number($('quantidade-livro-pedido').value);
  if (!livro || !Number.isInteger(quantidade) || quantidade < 1) return status('Selecione um livro e uma quantidade válida.');
  const total = quantidade + (itens.get(id)?.quantidade || 0);
  if (total > Math.min(100, Number(livro.estoque))) return status('Quantidade acima do limite ou do estoque disponível.');
  itens.set(id, { livro, quantidade: total });
  mostrarItens();
}

function mostrarItens() {
  const lista = $('itens-pedido-lista');
  lista.replaceChildren();
  let centavos = 0;
  for (const [id, { livro, quantidade }] of itens) {
    const subtotal = Math.round(Number(livro.preco) * 100) * quantidade;
    centavos += subtotal;
    const linha = elemento('div');
    const valor = elemento('span', `${livro.titulo} · ${moeda(livro.preco)} por unidade · ${moeda(subtotal / 100)}`);
    const qtd = elemento('input');
    qtd.type = 'number';
    qtd.min = '1';
    qtd.max = String(Math.min(100, Number(livro.estoque)));
    qtd.value = quantidade;
    qtd.setAttribute('aria-label', `Quantidade de ${livro.titulo}`);
    qtd.addEventListener('change', () => {
      if (!qtd.checkValidity() || !qtd.value) {
        qtd.value = quantidade;
        return status('Informe uma quantidade dentro do estoque disponível.');
      }
      itens.get(id).quantidade = Number(qtd.value);
      mostrarItens();
    });
    const remover = elemento('button', 'Remover');
    remover.type = 'button';
    remover.addEventListener('click', () => { itens.delete(id); mostrarItens(); });
    linha.append(valor, qtd, remover);
    lista.append(linha);
  }
  $('resumo-financeiro').textContent = `Subtotal ${moeda(centavos / 100)} · desconto ${moeda(0)} · frete ${moeda(0)} · total ${moeda(centavos / 100)}`;
}

function configurarEdicao(editar) {
  $('titulo-form').textContent = editar ? `Editar pedido #${pedidoEmEdicao}` : 'Novo pedido presencial';
  $('salvar-pedido').textContent = editar ? 'Salvar alterações' : 'Cadastrar pedido';
  $('limpar-pedido').textContent = editar ? 'Sair da edição' : 'Limpar formulário';
  for (const secao of ['produtos-pedido', 'pagamento-pedido']) $(secao).hidden = editar;
  $('pedido-presencial').disabled = editar;
  $('produtos-pedido').disabled = editar;
  $('pagamento-pedido').disabled = editar;
}

function editarPedido(pedido) {
  limparFormulario();
  pedidoEmEdicao = pedido.id_pedido;
  $('nome_cliente').value = pedido.nome_cliente || '';
  $('telefone').value = pedido.telefone_cliente_presencial || '';
  $('detalhes_pedido').value = pedido.detalhes_pedido || '';
  $('entrega').checked = Boolean(pedido.endereco_entrega);
  $('data_prevista_entrega').value = String(pedido.data_prevista_entrega || '').slice(0, 10);
  for (const id of ENDERECO) $(id).value = pedido.endereco_entrega?.[id] || '';
  configurarEdicao(true);
  atualizarEntrega();
  $('pedido-dialog').close();
  $('nome_cliente').focus();
}

async function salvarPedido(evento) {
  evento.preventDefault();
  const edicao = pedidoEmEdicao;
  if (!edicao && !itens.size) return status('Adicione pelo menos um livro.');
  const entrega = $('entrega').checked;
  const dados = {
    nome_cliente: $('nome_cliente').value.trim(), telefone: $('telefone').value.trim(), entrega,
    data_prevista_entrega: entrega ? $('data_prevista_entrega').value || null : null,
    ...Object.fromEntries(ENDERECO.map(id => [id, entrega ? $(id).value : ''])),
  };
  const detalhes_pedido = $('detalhes_pedido').value;
  $('salvar-pedido').disabled = true;
  try {
    if (edicao) {
      await api(`/pedidos/${edicao}`, 'PUT', { dados_presenciais: dados, detalhes_pedido });
    } else {
      tentativa ||= crypto.randomUUID();
      const p = await api('/pedidos', 'POST', {
        ...dados, detalhes_pedido, tentativa_id: tentativa, cliente_fisico: $('pedido-presencial').checked,
        forma_pagamento_id: $('forma_pagamento_id').value,
        itens: [...itens].map(([id_livro, item]) => ({ id_livro, quantidade: item.quantidade })),
      });
      limparFormulario();
      status(`Pedido #${p.id_pedido} cadastrado.`);
    }
    if (edicao) { limparFormulario(); status(`Pedido #${edicao} atualizado.`); }
    await carregarPedidos();
  } catch (erro) { status(erro.message); }
  finally { $('salvar-pedido').disabled = false; }
}

function selecionarLista(origem) {
  origemSelecionada = origem;
  for (const botao of $('origens-pedido').querySelectorAll('button')) {
    botao.setAttribute('aria-pressed', String(botao.dataset.origem === origem));
  }
  return carregarPedidos();
}

async function carregarPedidos() {
  const origem = origemSelecionada;
  $('lista-status').textContent = 'Carregando pedidos…';
  $('pedidos-body').replaceChildren();
  try {
    const lista = await api(origem === 'todos' ? '/pedidos' : '/pedidos?' + new URLSearchParams({ origem }));
    if (origem !== origemSelecionada) return;
    pedidos = lista;
    renderizarPedidos();
  } catch (erro) {
    if (origem === origemSelecionada) $('lista-status').textContent = erro.message;
  }
}

function renderizarPedidos() {
  const linhas = pedidos.map(p => {
    const tr = elemento('tr');
    for (const valor of [`#${p.id_pedido}`, p.nome_cliente, p.cliente_fisico ? 'Presencial' : 'Online', data(p.data_pedido), moeda(p.total_pedido), rotuloStatus(p.status_pedido)]) {
      tr.append(elemento('td', valor || '—'));
    }
    const acao = elemento('td');
    const botao = elemento('button', 'Detalhes');
    botao.type = 'button';
    botao.addEventListener('click', () => abrirPedido(p.id_pedido));
    acao.append(botao);
    tr.append(acao);
    return tr;
  });
  $('pedidos-body').replaceChildren(...linhas);
  $('lista-status').textContent = linhas.length ? `${linhas.length} pedido(s)` : 'Nenhum pedido encontrado.';
}

async function abrirPedido(id) {
  const modal = $('pedido-dialog');
  const corpo = $('pedido-dialog-corpo');
  $('pedido-dialog-titulo').textContent = `Pedido #${id}`;
  corpo.replaceChildren(elemento('p', 'Carregando…'));
  if (!modal.open) modal.showModal();
  try {
    const pedido = await api(`/pedidos/${id}`);
    if ($('pedido-dialog-titulo').textContent === `Pedido #${id}`) mostrarDetalhes(corpo, pedido);
  } catch (erro) { corpo.replaceChildren(elemento('p', erro.message)); }
}

function mostrarDetalhes(corpo, p) {
  const endereco = p.endereco_entrega || p.endereco_cadastrado;
  const enderecoTexto = endereco ? ENDERECO.map(id => endereco[id]).filter(Boolean).join(', ') : 'Endereço não registrado';
  const origem = p.cliente_fisico ? 'Presencial' : 'Online';
  const entrega = p.cliente_fisico && !endereco ? 'Retirada na loja' : 'Entrega';
  const rotuloEndereco = p.endereco_entrega ? 'Endereço do pedido' :
    endereco ? 'Endereço cadastrado atualmente' : 'Endereço';
  corpo.replaceChildren(
    elemento('h3', 'Cliente e entrega'),
    elemento('p', `Cliente: ${p.nome_cliente || '—'} · CPF: ${p.cpf_cliente || '—'} · Telefone: ${p.telefone_cliente_presencial || '—'}`),
    elemento('p', `Origem: ${origem} · Data: ${data(p.data_pedido)} · Status: ${rotuloStatus(p.status_pedido)}`),
    elemento('p', `Forma de entrega: ${entrega} · Previsão: ${data(p.data_prevista_entrega)}`),
    elemento('p', `${rotuloEndereco}: ${enderecoTexto}`),
    elemento('h3', 'Pagamento'),
    elemento('p', `${p.nome_forma_pagamento || 'Forma não registrada'} · ${p.status_pagamento || 'Situação não registrada'}`),
    elemento('p', `Subtotal ${p.subtotal_pedido == null ? '—' : moeda(p.subtotal_pedido)} · desconto ${p.desconto_pedido == null ? '—' : moeda(p.desconto_pedido)} · frete ${p.frete_pedido == null ? '—' : moeda(p.frete_pedido)} · total ${moeda(p.total_pedido)}`),
    elemento('h3', 'Produtos'),
  );
  if (p.detalhes_pedido) corpo.append(elemento('p', p.detalhes_pedido));
  if (!p.itens.length) corpo.append(elemento('p', 'Produtos não registrados.'));
  for (const i of p.itens) {
    const linha = elemento('div');
    linha.className = 'pedido-produto';
    if (i.caminho_imagem_livro) {
      const capa = document.createElement('img');
      capa.alt = `Capa de ${i.titulo}`;
      capa.src = i.caminho_imagem_livro.startsWith('/') ? i.caminho_imagem_livro : '/imagens/' + i.caminho_imagem_livro;
      linha.append(capa);
    }
    linha.append(elemento('p', `${i.titulo} · ${i.quantidade} × ${moeda(i.preco_unitario)} = ${moeda(i.subtotal)}`));
    const desconto = p.desconto_registro?.itens?.find(d => Number(d.id_livro) === Number(i.id_livro));
    if (desconto) linha.append(elemento('p', `${desconto.nome} (${desconto.percentual}%) · economia ${moeda(desconto.desconto)} · pago ${moeda(desconto.valor_pago)}`));
    corpo.append(linha);
  }
  corpo.append(elemento('h3', 'Histórico'));
  if (!p.eventos.length) corpo.append(elemento('p', 'Nenhuma atualização registrada.'));
  for (const e of p.eventos) {
    corpo.append(elemento('p', [new Date(e.criado_em).toLocaleString('pt-BR'),
      e.estado_anterior && e.estado_anterior !== e.estado ? `${rotuloStatus(e.estado_anterior)} → ${rotuloStatus(e.estado)}` : rotuloStatus(e.estado),
      e.motivo, e.autor].filter(Boolean).join(' · ')));
    if (e.percentual != null) corpo.append(elemento('p', `Reembolso simulado: ${e.percentual}% (${moeda(e.reembolso)}) · ${e.situacao}${e.processado_em ? ' · ' + new Date(e.processado_em).toLocaleString('pt-BR') : ''}`));
  }
  if (gerente && p.cliente_fisico && p.status_pedido === 'Em preparação') {
    const editar = elemento('button', 'Editar dados');
    editar.addEventListener('click', () => editarPedido(p));
    corpo.append(editar);
  }
  if (gerente) adicionarFormularioStatus(corpo, p);
}

function adicionarFormularioStatus(corpo, pedido) {
  const form = elemento('form');
  const select = elemento('select');
  select.setAttribute('aria-label', 'Novo status');
  select.add(new Option('Selecione o próximo status', ''));
  for (const estado of pedido.status_disponiveis) select.add(new Option(rotuloStatus(estado), estado));
  const statusLabel = elemento('label', 'Status do pedido');
  statusLabel.append(select);
  if (!pedido.status_disponiveis.length) {
    const pendente = !pedido.cliente_fisico && pedido.status_pedido === 'Aguardando confirmação' &&
      pedido.status_pagamento === 'Aguardando confirmação';
    if (pendente) {
      form.append(elemento('p', 'Confirme o pagamento simulado para colocar o pedido em preparação.'));
      const confirmar = elemento('button', 'Confirmar pagamento simulado');
      confirmar.type = 'button';
      const retorno = elemento('p');
      retorno.setAttribute('role', 'status');
      confirmar.onclick = async () => {
        if (!window.confirm('Confirmar o pagamento simulado e iniciar a preparação deste pedido?')) return;
        confirmar.disabled = true;
        try {
          await api(`/compras/${pedido.id_pedido}/confirmar-pagamento`, 'POST', {});
          await abrirPedido(pedido.id_pedido);
          await carregarPedidos();
        } catch (erro) {
          retorno.textContent = erro.message;
          confirmar.disabled = false;
        }
      };
      form.append(confirmar, retorno);
    } else form.append(elemento('p', 'Este pedido não tem uma próxima etapa disponível.'));
  }
  const previsao = elemento('input');
  previsao.type = 'date';
  previsao.value = pedido.data_prevista_entrega || '';
  previsao.min = pedido.data_pedido || '';
  const previsaoLabel = elemento('label', 'Previsão de entrega');
  previsaoLabel.append(previsao);
  const podeEditarPrevisao = !['Cancelado', 'Concluído'].includes(pedido.status_pedido);
  const motivo = elemento('textarea');
  motivo.maxLength = 5000;
  select.onchange = () => { motivo.required = select.value === 'Atraso'; };
  const label = elemento('label', 'Observação');
  label.append(motivo);
  const aviso = elemento('p');
  aviso.setAttribute('role', 'status');
  const botao = elemento('button', 'Registrar atualização');
  if (pedido.status_disponiveis.length) form.append(statusLabel);
  if (podeEditarPrevisao) form.append(previsaoLabel);
  form.append(label, botao, aviso);
  form.addEventListener('submit', async evento => {
    evento.preventDefault();
    if (select.value === 'Cancelado' && !confirm(`Cancelar o pedido #${pedido.id_pedido}?`)) return;
    botao.disabled = true;
    try {
      const dados = { status_pedido: select.value, motivo: motivo.value };
      if (select.value !== 'Cancelado' && podeEditarPrevisao && previsao.value && previsao.value !== pedido.data_prevista_entrega) {
        dados.previsao_entrega = previsao.value;
      }
      const r = await api(`/pedidos/${pedido.id_pedido}`, 'PUT', dados);
      await abrirPedido(pedido.id_pedido);
      const confirmacao = elemento('p', 'Atualização salva. O cliente já pode ver a mudança em Meus pedidos.');
      confirmacao.setAttribute('role', 'status');
      corpo.prepend(confirmacao);
      status('Pedido #' + pedido.id_pedido + ' atualizado.');
      if (r.percentual_reembolso) status(`Reembolso simulado de ${r.percentual_reembolso}% (${moeda(r.valor_reembolso)}).`);
      await carregarPedidos();
    } catch (erro) { aviso.textContent = erro.message; botao.disabled = false; }
  });
  corpo.append(form);
}

async function carregarAvisos() {
  const lista = $('avisos-lista');
  try {
    const avisos = await api('/pedidos/avisos');
    $('avisos-pedidos').textContent = avisos.length ? 'Avisos (' + avisos.length + ')' : 'Avisos';
    lista.replaceChildren();
    if (!avisos.length) lista.append(elemento('p', 'Nenhuma solicitação pendente.'));
    for (const aviso of avisos) {
      const artigo = elemento('article');
      artigo.className = 'aviso-pedido';
      artigo.append(elemento('h3', 'Pedido #' + aviso.pedido_id + ' · ' + aviso.cliente),
        elemento('p', rotuloStatus(aviso.status_pedido) + ' · ' + new Date(aviso.criado_em).toLocaleString('pt-BR')),
        elemento('p', aviso.motivo || 'Cliente não informou o motivo.'));
      if (aviso.tipo_anexo) {
        const anexo = elemento('a', aviso.tipo_anexo.startsWith('image/') ? 'Abrir foto' : 'Abrir vídeo');
        anexo.href = '/pedidos/' + aviso.pedido_id + '/cancelamento/anexo';
        anexo.target = '_blank';
        anexo.rel = 'noopener noreferrer';
        artigo.append(anexo);
      }
      const form = elemento('form');
      const explicacao = elemento('textarea');
      explicacao.maxLength = 5000;
      const label = elemento('label', 'Resposta ao cliente (obrigatória para recusar)');
      label.append(explicacao);
      const retorno = elemento('p');
      retorno.setAttribute('role', 'status');
      form.append(label);
      for (const [acao, decisao] of [['Aprovar', 'Aprovada'], ['Recusar', 'Recusada']]) {
        const botao = elemento('button', acao);
        botao.value = decisao;
        form.append(botao);
      }
      form.append(retorno);
      form.onsubmit = async evento => {
        evento.preventDefault();
        if (evento.submitter.value === 'Recusada' && !explicacao.value.trim()) {
          retorno.textContent = 'Descreva o motivo da recusa.';
          return;
        }
        evento.submitter.disabled = true;
        try {
          await api('/pedidos/' + aviso.pedido_id + '/cancelamento/decisao', 'POST',
            { decisao: evento.submitter.value, motivo: explicacao.value });
          await Promise.all([carregarAvisos(), carregarPedidos()]);
        } catch (erro) { retorno.textContent = erro.message; evento.submitter.disabled = false; }
      };
      artigo.append(form);
      lista.append(artigo);
    }
  } catch (erro) { lista.replaceChildren(elemento('p', erro.message)); }
}
