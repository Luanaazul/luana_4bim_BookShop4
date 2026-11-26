window.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('order-dialog');
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  document.getElementById('cancelamento-fechar').onclick = () => document.getElementById('cancelamento-dialog').close();
  document.getElementById('cancelamento-form').onsubmit = enviarCancelamento;
  carregarPedidos();
});

async function carregarPedidos() {
  const status = document.getElementById('orders-status');
  const lista = document.getElementById('orders-list');
  try {
    const pedidos = await requisicao('/pedidos/meus');
    lista.replaceChildren();
    if (!pedidos.length) { status.textContent = 'Você ainda não tem pedidos.'; return; }
    pedidos.forEach(pedido => lista.appendChild(criarResumo(pedido)));
    status.textContent = `${pedidos.length} pedido(s) encontrado(s).`;
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('error');
  }
}
function criarResumo(pedido) {
  const artigo = document.createElement('article');
  artigo.className = 'order-card';
  const titulo = document.createElement('h2'); titulo.textContent = `Pedido #${pedido.id_pedido}`;
  const detalhes = document.createElement('div');
  const estado = document.createElement('p');
  estado.className = 'order-status';
  estado.textContent = `Status: ${rotuloStatus(pedido.status_pedido)}`;
  detalhes.append(
    paragrafo(`Data: ${dataBR(pedido.data_pedido)} · Entrega prevista: ${dataBR(pedido.data_prevista_entrega)}`),
    estado,
    paragrafo(`Pagamento: ${pedido.nome_forma_pagamento || '—'} (${pedido.status_pagamento || '—'})`),
    paragrafo(`Total: ${dinheiro(pedido.total_pedido)}`)
  );
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.textContent = 'Ver detalhes';
  botao.setAttribute('aria-haspopup', 'dialog');
  botao.addEventListener('click', async () => {
    const dialog = document.getElementById('order-dialog');
    const conteudo = document.getElementById('order-dialog-content');
    document.getElementById('order-dialog-title').textContent = `Pedido #${pedido.id_pedido}`;
    conteudo.replaceChildren(paragrafo('Carregando detalhes…'));
    dialog.showModal();
    try {
      const completo = await requisicao(`/pedidos/${pedido.id_pedido}`);
      if (dialog.open && document.getElementById('order-dialog-title').textContent === `Pedido #${pedido.id_pedido}`) {
        renderizarDetalhes(conteudo, completo);
      }
    } catch (error) { conteudo.replaceChildren(paragrafo(error.message)); }
  });
  artigo.append(titulo, detalhes, botao);
  adicionarCancelamento(artigo, pedido);
  return artigo;
}

let pedidoCancelamento;
function adicionarCancelamento(artigo, pedido) {
  const estado = pedido.solicitacao_cancelamento;
  if (estado) {
    const rotulo = estado === 'Pendente' ? 'Solicitação em análise' : 'Solicitação ' + estado.toLowerCase();
    artigo.append(paragrafo(rotulo + (pedido.resposta_cancelamento ? ' · ' + pedido.resposta_cancelamento : '')));
  }
  if (pedido.status_pedido === 'Cancelado') {
    const remover = document.createElement('button');
    remover.type = 'button';
    remover.textContent = 'Remover da lista';
    const feedback = paragrafo('');
    feedback.setAttribute('role', 'status');
    remover.onclick = async () => {
      remover.disabled = true;
      try {
        const resultado = await requisicao('/pedidos/' + pedido.id_pedido + '/ocultar', { method: 'POST' });
        await carregarPedidos();
        document.getElementById('orders-status').textContent = resultado.aviso;
      } catch (erro) {
        feedback.textContent = erro.message;
        remover.disabled = false;
      }
    };
    artigo.append(remover, feedback);
    return;
  }
  if (estado === 'Pendente' || estado === 'Aprovada' || estado === 'Recusada') return;
  const cancelar = document.createElement('button');
  const solicitacao = pedido.cancelamento_em_analise;
  cancelar.type = 'button';
  cancelar.className = 'order-cancel';
  cancelar.textContent = solicitacao ? 'Solicitar cancelamento' : 'Cancelar pedido';
  cancelar.onclick = () => {
    pedidoCancelamento = pedido;
    document.getElementById('cancelamento-form').reset();
    document.getElementById('cancelamento-retorno').textContent = '';
    const motivoObrigatorio = solicitacao && !pedido.cliente_fisico;
    document.getElementById('cancelamento-form').elements.motivo.required = motivoObrigatorio;
    document.getElementById('cancelamento-motivo-rotulo').textContent = motivoObrigatorio ? 'Motivo (obrigatório)' : 'Motivo (opcional)';
    document.getElementById('cancelamento-info').textContent = solicitacao
      ? motivoObrigatorio
        ? 'Se a solicitação for aprovada, 25% do valor pago fica com a loja para cobrir os custos de manutenção. O reembolso simulado é de 75%. Obrigada pela compreensão!'
        : 'O gerente vai analisar a solicitação.'
      : 'Pedido #' + pedido.id_pedido + ' · ' + rotuloStatus(pedido.status_pedido);
    document.getElementById('cancelamento-anexo').hidden = !solicitacao;
    document.getElementById('cancelamento-enviar').textContent = solicitacao ? 'Enviar solicitação' : 'Confirmar cancelamento';
    document.getElementById('cancelamento-dialog').showModal();
  };
  artigo.append(cancelar);
}

async function enviarCancelamento(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const pedido = pedidoCancelamento;
  const dados = new FormData();
  dados.set('motivo', form.elements.motivo.value);
  if (pedido.cancelamento_em_analise && form.elements.anexo.files.length) {
    dados.set('anexo', form.elements.anexo.files[0]);
  }
  const botao = document.getElementById('cancelamento-enviar');
  botao.disabled = true;
  try {
    const resultado = await requisicao('/pedidos/' + pedido.id_pedido + '/cancelar', { method: 'POST', body: dados });
    document.getElementById('cancelamento-dialog').close();
    await carregarPedidos();
    document.getElementById('orders-status').textContent = resultado.percentual_reembolso == null
      ? resultado.aviso : `Pedido cancelado. Reembolso simulado de ${resultado.percentual_reembolso}% (${dinheiro(resultado.valor_reembolso)}).`;
  } catch (erro) {
    document.getElementById('cancelamento-retorno').textContent = erro.message;
  } finally { botao.disabled = false; }
}
function renderizarDetalhes(alvo, pedido) {
  alvo.replaceChildren();
  alvo.append(
    paragrafo(`Data da compra: ${dataBR(pedido.data_pedido)}`),
    paragrafo(`Status: ${rotuloStatus(pedido.status_pedido)}`),
    paragrafo(`Entrega prevista: ${dataBR(pedido.data_prevista_entrega)}`),
    paragrafo(`Pagamento: ${pedido.nome_forma_pagamento || '—'} (${pedido.status_pagamento || '—'})`),
    paragrafo(`Subtotal: ${dinheiro(pedido.subtotal_pedido)}`),
    paragrafo(`${pedido.desconto_registro?.nome || 'Desconto'}: ${dinheiro(pedido.desconto_pedido)}`),
    paragrafo(`Frete: ${dinheiro(pedido.frete_pedido)}`),
    paragrafo(`Total: ${dinheiro(pedido.total_pedido)}`)
  );
  const endereco = pedido.endereco_entrega;
  alvo.appendChild(paragrafo(endereco
    ? `Entrega: ${endereco.rua}, ${endereco.numero}${endereco.complemento ? `, ${endereco.complemento}` : ''} — ${endereco.bairro}, ${endereco.cidade}/${endereco.estado}, ${endereco.cep}`
    : 'Endereço de entrega não disponível.'));
  const tituloItens = document.createElement('h3'); tituloItens.textContent = 'Itens'; alvo.appendChild(tituloItens);
  pedido.itens.forEach(item => {
    const linha = document.createElement('div');
    linha.className = 'order-item';
    if (item.caminho_imagem_livro) {
      const img = document.createElement('img');
      img.src = item.caminho_imagem_livro.startsWith('/') ? item.caminho_imagem_livro : `/imagens/${item.caminho_imagem_livro}`;
      img.alt = `Capa de ${item.titulo}`; img.loading = 'lazy'; img.width = 64;
      linha.appendChild(img);
    }
    linha.appendChild(paragrafo(`${item.titulo} — ${item.quantidade} × ${dinheiro(item.preco_unitario)} = ${dinheiro(item.subtotal)}`));
    const desconto = pedido.desconto_registro?.itens?.find(d => d.id_livro === item.id_livro);
    if (desconto) linha.appendChild(paragrafo(`${desconto.nome} (${desconto.percentual}%) · economia ${dinheiro(desconto.desconto)} · pago ${dinheiro(desconto.valor_pago)}`));
    alvo.appendChild(linha);
  });
  const tituloHistorico = document.createElement('h3');
  tituloHistorico.textContent = 'Histórico';
  alvo.append(tituloHistorico);
  if (!pedido.eventos.length) alvo.append(paragrafo('Nenhuma atualização registrada.'));
  for (const evento of pedido.eventos) {
    const horario = new Date(evento.criado_em).toLocaleString('pt-BR');
    const estados = evento.estado_anterior && evento.estado_anterior !== evento.estado
      ? `${rotuloStatus(evento.estado_anterior)} → ${rotuloStatus(evento.estado)}` : rotuloStatus(evento.estado);
    alvo.append(paragrafo([horario, estados, evento.motivo, evento.autor].filter(Boolean).join(' · ')));
    if (evento.percentual != null) {
      const data = evento.processado_em ? ` · ${new Date(evento.processado_em).toLocaleString('pt-BR')}` : '';
      alvo.append(paragrafo(`Reembolso simulado de ${evento.percentual}% (${dinheiro(evento.reembolso)}) · ${evento.situacao}${data}`));
    }
  }

}
function rotuloStatus(status) { return status === 'Atraso' ? 'Atraso no envio' : status; }
function paragrafo(texto) { const e = document.createElement('p'); e.textContent = texto; return e; }
async function requisicao(caminho, options = {}) {
  const resposta = await fetch(`${window.BOOKSHOP_API_BASE_URL}${caminho}`, { credentials: 'include', ...options });
  const tipo = resposta.headers.get('content-type') || '';
  const dados = tipo.includes('application/json') ? await resposta.json() : {};
  if (resposta.status === 401) {
    window.alert('Entre na sua conta para consultar seus pedidos.');
    window.location.assign(new URL(`/login/login.html?next=${encodeURIComponent('/meus-pedidos.html')}`, window.BOOKSHOP_API_BASE_URL).href);
    throw new Error('Faça login para consultar seus pedidos.');
  }
  if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível consultar os pedidos.');
  return dados;
}
function dinheiro(valor) { return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function dataBR(valor) { return valor ? new Date(`${String(valor).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR') : '—'; }
