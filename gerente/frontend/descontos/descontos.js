const $ = id => document.getElementById(id);
const form = $('form');
const campos = form.elements;
const filtros = { generos: new Set(), autores: new Set(), editoras: new Set(), livros: new Set() };
let catalogo = [];
let generos = [];
let codigo = '';
let consulta = 0;
let timer;
let versaoPrevia = 0;

async function api(caminho = '', metodo = 'GET', dados) {
  const resposta = await fetch('/promocoes' + caminho, {
    method: metodo, ...(dados ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) } : {})
  });
  if (resposta.status === 204) return null;
  const resultado = await resposta.json();
  if (!resposta.ok) throw Error(resultado.erro);
  return resultado;
}

function elemento(tag, texto) {
  const el = document.createElement(tag);
  if (texto != null) el.textContent = texto;
  return el;
}

function botao(texto, acao) {
  const el = elemento('button', texto);
  el.type = 'button';
  el.onclick = acao;
  return el;
}

const moeda = valor => Number(valor).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const data = valor => valor ? new Date(valor).toLocaleString('pt-BR') : '—';
function dataLocal(valor) {
  if (!valor) return '';
  const d = new Date(valor);
  return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}

async function listar() {
  const atual = ++consulta;
  const params = new URLSearchParams({ nome: $('busca').value, situacao: $('situacao').value });
  const rows = await api('?' + params);
  if (atual !== consulta) return;
  $('resultado').textContent = rows.length ? `${rows.length} campanha(s)` : 'Nenhuma campanha encontrada.';
  $('linhas').replaceChildren(...rows.map(p => {
    const tr = elemento('tr');
    for (const valor of [p.id_exibicao, p.nome, p.tipo, p.percentual + '%', data(p.inicio),
      p.termino ? data(p.termino) : 'Sem encerramento', p.livros_atingidos, p.situacao]) tr.append(elemento('td', valor));
    const acoes = elemento('td');
    const rota = '/' + encodeURIComponent(p.codigo);
    acoes.append(botao('Visualizar', () => acao(async () => visualizar(await api(rota)))),
      botao('Editar', () => acao(async () => editar(await api(rota)))),
      botao(p.ativa ? 'Desativar' : 'Ativar', () => acao(async () => {
        await api(rota + '/ativacao', 'PATCH', { ativa: !p.ativa });
        await listar();
      })),
      botao('Excluir', () => acao(async () => {
        if (!confirm(`Excluir a campanha "${p.nome}"?`)) return;
        await api(rota, 'DELETE');
        await listar();
      })));
    tr.append(acoes);
    return tr;
  }));
}

function acao(fn) { Promise.resolve().then(fn).catch(e => { $('resultado').textContent = e.message; }); }

function preencherFiltros() {
  const listas = {
    generos: generos.map(g => [g.id_genero,g.nome_genero]),
    autores: [...new Set(catalogo.map(l => l.autor))].filter(Boolean).map(x => [x,x]),
    editoras: [...new Set(catalogo.map(l => l.editora))].filter(Boolean).map(x => [x,x]),
    livros: catalogo.map(l => [l.id_livro, l.titulo + ' · ' + l.autor])
  };
  for (const [chave, lista] of Object.entries(listas)) {
    const busca = form.querySelector(`[data-pesquisa="${chave}"]`)?.value.toLocaleLowerCase('pt-BR') || '';
    $(chave).replaceChildren(...lista.filter(([,nome]) => nome.toLocaleLowerCase('pt-BR').includes(busca))
      .sort((a,b) => a[1].localeCompare(b[1],'pt-BR')).map(([id,nome]) => {
        const label = elemento('label');
        label.className = 'check';
        const input = elemento('input');
        input.type = 'checkbox';
        input.checked = filtros[chave].has(id);
        input.onchange = () => {
          if (input.checked) filtros[chave].add(id);
          else filtros[chave].delete(id);
        };
        label.append(input, nome);
        return label;
      }));
  }
}

function editar(p = {}) {
  codigo = p.codigo || '';
  form.reset();
  $('erro').textContent = '';
  for (const nome of ['id_exibicao','nome','tipo','descricao','percentual','combinacao']) {
    if (p[nome] != null) campos[nome].value = p[nome];
  }
  campos.inicio.value = dataLocal(p.inicio);
  campos.termino.value = dataLocal(p.termino);
  campos.ativa.checked = Boolean(p.ativa);
  campos.combinavel.checked = Boolean(p.combinavel);
  const c = p.criterios || {};
  campos.todos.checked = Boolean(codigo && !Object.keys(c).length);
  for (const chave of Object.keys(filtros)) filtros[chave] = new Set(c[chave] || []);
  for (const chave of ['minimo','maximo']) {
    campos[chave].value = c[chave] ?? '';
    campos[chave+'_exclusivo'].checked = Boolean(c[chave+'_exclusivo']);
  }
  $('filtros').hidden = campos.todos.checked;
  preencherFiltros();
  $('editor-titulo').textContent = codigo ? 'Editar desconto' : 'Novo desconto';
  $('editor').showModal();
  agendarPrevia();
}

function dados() {
  const criterios = {};
  if (!campos.todos.checked) {
    for (const [chave, valores] of Object.entries(filtros)) criterios[chave] = [...valores];
    for (const chave of ['minimo','maximo']) {
      if (campos[chave].value !== '') {
        criterios[chave] = Number(campos[chave].value);
        criterios[chave+'_exclusivo'] = campos[chave+'_exclusivo'].checked;
      }
    }
  }
  return { id_exibicao:Number(campos.id_exibicao.value), nome:campos.nome.value, tipo:campos.tipo.value, descricao:campos.descricao.value,
    percentual:Number(campos.percentual.value), ativa:campos.ativa.checked, combinavel:campos.combinavel.checked,
    combinacao:campos.combinacao.value, todos:campos.todos.checked, criterios,
    inicio:campos.inicio.value ? new Date(campos.inicio.value).toISOString() : null,
    termino:campos.termino.value ? new Date(campos.termino.value).toISOString() : null };
}

function mostrarLivros(alvo, livros) {
  alvo.replaceChildren(...livros.map(l => {
    const item = elemento('article');
    item.className = 'campanha-livro';
    if (l.caminho_imagem_livro) {
      const img = elemento('img');
      img.src = l.caminho_imagem_livro.startsWith('/imagens/') ? l.caminho_imagem_livro : '/imagens/' + l.caminho_imagem_livro.replace(/^\/+/, '');
      img.alt = 'Capa de ' + l.titulo;
      img.loading = 'lazy';
      item.append(img);
    }
    const texto = elemento('div');
    texto.append(elemento('strong', l.titulo), elemento('p', `${l.autor} · ${l.nome_genero}`),
      elemento('p', `${moeda(l.preco)} → ${moeda(l.preco_promocional)}`));
    item.append(texto);
    return item;
  }));
}

function visualizar(p) {
  $('visualizar-titulo').textContent = p.nome;
  $('visualizar-info').textContent = [p.tipo, p.situacao, p.percentual + '%', p.descricao, p.livros.length + ' livro(s)'].filter(Boolean).join(' · ');
  mostrarLivros($('visualizar-livros'), p.livros);
  $('visualizar').showModal();
}

function agendarPrevia() {
  clearTimeout(timer);
  const versao = ++versaoPrevia;
  $('salvar').disabled = true;
  $('previa-status').textContent = 'Calculando prévia…';
  timer = setTimeout(async () => {
    try {
      const livros = await api('/previa','POST',dados());
      if (versao !== versaoPrevia) return;
      mostrarLivros($('previa'), livros);
      $('previa-status').textContent = livros.length ? `Esta campanha será aplicada a ${livros.length} livro(s).` : 'Nenhum livro atende a estes critérios.';
      $('salvar').disabled = !livros.length;
    } catch (e) {
      if (versao !== versaoPrevia) return;
      $('previa').replaceChildren();
      $('previa-status').textContent = e.message;
    }
  }, 220);
}

$('nova').onclick = () => editar();
$('fechar').onclick = () => $('editor').close();
$('busca').oninput = () => acao(listar);
$('situacao').onchange = () => acao(listar);
form.addEventListener('input', e => {
  if (e.target.dataset.pesquisa) preencherFiltros();
  else if (e.target.type !== 'checkbox') agendarPrevia();
});
form.addEventListener('change', e => {
  if (e.target === campos.todos) $('filtros').hidden = campos.todos.checked;
  if (!e.target.dataset.pesquisa) agendarPrevia();
});
form.onsubmit = async e => {
  e.preventDefault();
  $('salvar').disabled = true;
  try {
    await api(codigo ? '/' + encodeURIComponent(codigo) : '', codigo ? 'PUT' : 'POST', dados());
    $('editor').close();
    await listar();
  } catch (erro) { $('erro').textContent = erro.message; $('salvar').disabled = false; }
};
$('nova').disabled = true;
acao(async () => {
  [catalogo, generos] = await Promise.all([api('/catalogo'), fetch('/livros/generos').then(r => {
    if (!r.ok) throw Error('Não foi possível carregar os gêneros.');
    return r.json();
  })]);
  $('nova').disabled = false;
  await listar();
});
