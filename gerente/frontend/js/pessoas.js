const $ = id => document.getElementById(id);
let pessoas = [];
let cpfEmEdicao;
const dataBR = valor => valor ? String(valor).slice(0, 10).split('-').reverse().join('/') : '—';

async function api(url, method = 'GET', dados) {
  const r = await fetch(url, {
    method,
    ...(dados && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) }),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro || 'Falha ao consultar o servidor.');
  return json;
}

function texto(tag, valor) {
  const el = document.createElement(tag);
  el.textContent = valor || '—';
  return el;
}

function enderecos(pessoa) {
  const td = document.createElement('td');
  for (const e of pessoa.enderecos) {
    const campos = [e.rua, e.numero, e.complemento, e.bairro, e.cidade, e.estado, e.cep].filter(Boolean);
    td.append(texto('p', (e.principal ? 'Principal · ' : '') + campos.join(', ')));
  }
  if (!pessoa.enderecos.length) td.textContent = pessoa.endereco_pessoa || 'Não cadastrado';
  return td;
}

function renderizar() {
  const termo = $('pessoa-busca').value.trim().toLocaleLowerCase('pt-BR');
  const digitos = /^[0-9.\-]+$/.test(termo) ? termo.replace(/\D/g, '') : '';
  const visiveis = pessoas.filter(p => !termo || p.nome_pessoa.toLocaleLowerCase('pt-BR').includes(termo)
    || (digitos && p.cpf_pessoa.replace(/\D/g, '').includes(digitos)));
  const linhas = visiveis.map(p => {
    const linha = document.createElement('tr');
    for (const valor of [p.cpf_pessoa, p.nome_pessoa, dataBR(p.data_nascimento_pessoa), p.nome_usuario_pessoa, p.email_pessoa]) {
      linha.append(texto('td', valor));
    }
    linha.append(enderecos(p), texto('td', dataBR(p.data_cadastro_cliente)),
      texto('td', [p.eh_cliente && 'Cliente', p.eh_funcionario && (p.nome_cargo || 'Funcionário')].filter(Boolean).join(' · ')));
    const acao = document.createElement('td');
    if (p.eh_funcionario) {
      const botao = texto('button', 'Editar vínculo');
      botao.addEventListener('click', () => abrirVinculo(p));
      acao.append(botao);
    } else acao.textContent = '—';
    linha.append(acao);
    return linha;
  });
  $('pessoas-tbody').replaceChildren(...linhas);
  $('pessoas-list-status').textContent = linhas.length ? `${linhas.length} pessoa(s)` : 'Nenhuma pessoa encontrada.';
}

async function carregar() {
  pessoas = await api('/pessoas');
  renderizar();
}

function abrirVinculo(p) {
  cpfEmEdicao = p.cpf_pessoa;
  const form = $('vinculo-form');
  form.elements.cargo_id_cargo.value = p.cargo_id_cargo;
  form.elements.salario_funcionario.value = p.salario_funcionario;
  $('vinculo-nome').textContent = p.nome_pessoa;
  $('vinculo-status').textContent = '';
  $('vinculo-dialog').showModal();
}

async function enviar(event, url, metodo, dados, status) {
  event.preventDefault();
  const botao = event.submitter;
  if (botao) botao.disabled = true;
  try {
    await api(url, metodo, dados);
    await carregar();
    status.textContent = 'Cadastro salvo.';
    return true;
  } catch (erro) { status.textContent = erro.message; return false; }
  finally { if (botao) botao.disabled = false; }
}

const novo = $('pessoa-form');
novo.elements.cpf_pessoa.addEventListener('input', ({ target }) => {
  target.value = target.value.replace(/\D/g, '').slice(0, 11)
    .replace(/^(\d{3})(?=\d)/, '$1.').replace(/^(\d{3}\.\d{3})(?=\d)/, '$1.')
    .replace(/^(\d{3}\.\d{3}\.\d{3})(?=\d)/, '$1-');
});
function mostrarCamposFuncionario() {
  const campo = $('novo-funcionario');
  campo.hidden = campo.disabled = !novo.elements.eh_funcionario.checked;
}
novo.elements.eh_funcionario.addEventListener('change', mostrarCamposFuncionario);
novo.addEventListener('submit', async event => {
  const dados = Object.fromEntries(new FormData(novo));
  if (novo.elements.eh_funcionario.checked) {
    dados.eh_funcionario = true;
    dados.funcionario = { cargo_id_cargo: dados.cargo_id_cargo, salario_funcionario: dados.salario_funcionario };
    delete dados.cargo_id_cargo;
    delete dados.salario_funcionario;
  }
  if (await enviar(event, '/pessoas', 'POST', dados, $('pessoa-status'))) {
    novo.reset();
    mostrarCamposFuncionario();
  }
});
$('vinculo-form').addEventListener('submit', async event => {
  const dados = Object.fromEntries(new FormData(event.currentTarget));
  if (await enviar(event, '/pessoas/' + encodeURIComponent(cpfEmEdicao), 'PUT', dados, $('vinculo-status'))) {
    $('vinculo-dialog').close();
  }
});
$('vinculo-fechar').addEventListener('click', () => $('vinculo-dialog').close());
$('pessoa-busca').addEventListener('input', renderizar);
carregar().catch(erro => $('pessoas-list-status').textContent = erro.message);
api('/cargos').then(cargos => {
  for (const select of document.querySelectorAll('select[name="cargo_id_cargo"]')) {
    select.replaceChildren(new Option('Selecione', ''), ...cargos.map(c => new Option(c.nome_cargo, c.id_cargo)));
  }
}).catch(erro => $('pessoa-status').textContent = erro.message);
