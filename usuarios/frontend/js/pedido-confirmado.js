window.addEventListener('DOMContentLoaded', renderizarPedido);

function renderizarPedido() {
  const alvo = document.getElementById('order-details');
  let pedido;
  try {
    pedido = JSON.parse(sessionStorage.getItem('bookshop_ultimo_pedido') || 'null');
  } catch (error) {
    pedido = null;
  }
  if (!pedido) {
    alvo.textContent = 'Não foi possível carregar este comprovativo. Consulte seus pedidos depois de entrar.';
    return;
  }

  alvo.replaceChildren();
  adicionar(alvo, 'h2', `Pedido #${pedido.id_pedido}`);
  adicionar(alvo, 'p', `Data: ${formatarData(pedido.data_pedido)}`);
  adicionar(alvo, 'p', `Entrega prevista: ${formatarData(pedido.data_prevista_entrega)}`);
  adicionar(alvo, 'p', `Estado do pedido: ${pedido.status_pedido}`);
  adicionar(alvo, 'p', `Pagamento: ${pedido.forma_pagamento} — ${pedido.status_pagamento} (simulado)`);
  adicionar(alvo, 'p', `Subtotal: ${formatar(pedido.subtotal_pedido)}`);
  adicionar(alvo, 'p', `${pedido.desconto_registro?.nome || 'Desconto'}: ${formatar(pedido.desconto_pedido)}`);
  adicionar(alvo, 'p', `Frete: ${formatar(pedido.frete_pedido)}`);

  if (pedido.endereco_entrega) {
    const endereco = pedido.endereco_entrega;
    adicionar(alvo, 'p', `Entrega: ${endereco.rua}, ${endereco.numero}${endereco.complemento ? `, ${endereco.complemento}` : ''} — ${endereco.bairro}, ${endereco.cidade}/${endereco.estado}, ${endereco.cep}`);
  }
  adicionar(alvo, 'h3', 'Livros');
  pedido.itens.forEach((item) => {
    adicionar(alvo, 'p', `${item.titulo} — ${item.quantidade} × ${formatar(item.preco_unitario)} = ${formatar(item.subtotal)}`);
    const desconto = pedido.desconto_registro?.itens?.find(d => Number(d.id_livro) === Number(item.id_livro));
    if (desconto) adicionar(alvo, 'p', `${desconto.nome} (${desconto.percentual}%) · economia ${formatar(desconto.desconto)} · pago ${formatar(desconto.valor_pago)}`);
  });
  adicionar(alvo, 'h3', `Total: ${formatar(pedido.total_pedido)}`);
  adicionar(alvo, 'p', 'Esta é uma confirmação acadêmica/simulada. Não foi efetuada qualquer cobrança real.');
}

function adicionar(alvo, tag, texto) {
  const elemento = document.createElement(tag);
  elemento.textContent = texto;
  alvo.appendChild(elemento);
}

function formatar(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(valor) {
  if (!valor) return '—';
  return new Date(`${String(valor).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
}
