const URL_API = window.location.origin;

const imagensIniciais = {
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
  15: 'ritalee.jpe',
  16: 'livros/livro_16.jpe',
  17: 'livros/livro_17.jpeg',
};

const OUTRA_EDITORA = '__outra_editora__';
let operacaoAtual = '';
let livroAtual = null;

window.addEventListener('DOMContentLoaded', inicializar);

function inicializar() {
  document.getElementById('btProcure').addEventListener('click', procurar);
  document.getElementById('btInserir').addEventListener('click', inserir);
  document.getElementById('btAlterar').addEventListener('click', alterar);
  document.getElementById('btExcluir').addEventListener('click', excluir);
  document.getElementById('btSalvar').addEventListener('click', salvar);
  document.getElementById('btCancelar').addEventListener('click', cancelarOperacao);
  document.getElementById('btn-atualizar').addEventListener('click', listar);
  document.getElementById('imagem').addEventListener('change', previewImagem);

  document.getElementById('editora').addEventListener('change', () => sincronizarEditora(true));
  bloquearAtributos(true);
  carregarGeneros();
  listar();
}

async function carregarGeneros() {
  const select = document.getElementById('genero_id');

  try {
    const resposta = await fetch(`${URL_API}/livros/generos`);
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

    const generos = await resposta.json();
    select.replaceChildren(new Option('Selecione um gênero', ''));
    generos.forEach((genero) => {
      select.add(new Option(genero.nome_genero, genero.id_genero));
    });
  } catch (erro) {
    select.replaceChildren(new Option('Não foi possível carregar', ''));
    mostrarAviso('Não foi possível carregar os gêneros.', true);
  }
}

async function procurar() {
  const id = Number(document.getElementById('id_livro').value);

  if (!Number.isInteger(id) || id < 1) {
    mostrarAviso('Informe um ID inteiro válido.', true);
    return;
  }

  try {
    const resposta = await fetch(`${URL_API}/livros/${id}`);

    if (resposta.status === 404) {
      livroAtual = null;
      limparAtributos(false);
      visibilidadeDosBotoes(true, true, false, false, false);
      mostrarAviso('Livro não encontrado. Clique em Inserir.');
      return;
    }

    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

    livroAtual = await resposta.json();
    mostrarDadosLivro(livroAtual);
    mostrarImagemLivro(livroAtual);
    visibilidadeDosBotoes(false, false, true, true, false);
    mostrarAviso('Livro encontrado. Escolha Alterar ou Excluir.');
  } catch (erro) {
    mostrarAviso('Não foi possível consultar o servidor.', true);
  }
}

function inserir() {
  operacaoAtual = 'inserindo';
  bloquearAtributos(false);
  // O ID informado na busca é preservado para cadastrar o livro nesse número livre.
  document.getElementById('id_livro').readOnly = true;
  limparCampos();
  visibilidadeDosBotoes(false, false, false, false, true);
  mostrarAviso('INSERINDO: preencha os dados e clique em Salvar.');
  document.getElementById('titulo').focus();
}

function alterar() {
  operacaoAtual = 'alterando';
  bloquearAtributos(false);
  document.getElementById('id_livro').readOnly = true;
  visibilidadeDosBotoes(false, false, false, false, true);
  mostrarAviso('ALTERANDO: edite os dados e clique em Salvar.');
}

function excluir() {
  operacaoAtual = 'excluindo';
  bloquearAtributos(true);
  visibilidadeDosBotoes(false, false, false, false, true);
  mostrarAviso('EXCLUINDO: clique em Salvar para confirmar.');
}

async function salvar() {
  if (operacaoAtual === 'excluindo') {
    await excluirLivro();
    return;
  }

  const dados = coletarDadosLivro();
  if (!dados) return;

  const alterando = operacaoAtual === 'alterando';
  const endpoint = alterando
    ? `${URL_API}/livros/${livroAtual.id_livro}`
    : `${URL_API}/livros`;

  let livroSalvo;
  try {
    const resposta = await fetch(endpoint, {
      method: alterando ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados),
    });

    const retorno = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      throw new Error(retorno.erro || `HTTP ${resposta.status}`);
    }

    livroSalvo = retorno;
  } catch (erro) {
    mostrarAviso(erro.message, true);
    return;
  }

  if (document.getElementById('imagem').files[0]) {
    try {
      const imagemSalva = await enviarImagem(livroSalvo.id_livro);
      livroSalvo.caminho_imagem_livro = imagemSalva.caminho_imagem_livro;
    } catch (erro) {
      mostrarAviso(`Livro salvo, mas a imagem não foi salva: ${erro.message}`, true);
      finalizarOperacao();
      await listar();
      return;
    }
  }

  mostrarAviso(alterando
    ? 'Livro alterado com sucesso.'
    : 'Livro inserido com sucesso.');

  finalizarOperacao();
  await listar();
}

async function enviarImagem(idLivro) {
  const arquivo = document.getElementById('imagem').files[0];
  if (!arquivo) return;

  const formulario = new FormData();
  formulario.append('imagem', arquivo);

  const resposta = await fetch(`${URL_API}/livros/${idLivro}/imagem`, {
    method: 'POST',
    body: formulario,
  });

  const retorno = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new Error(retorno.erro || 'Não foi possível salvar a imagem.');
  }
  return retorno;
}

async function excluirLivro() {
  try {
    const id = livroAtual.id_livro;
    const resposta = await fetch(`${URL_API}/livros/${id}`, { method: 'DELETE' });
    const retorno = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      throw new Error(retorno.erro || `HTTP ${resposta.status}`);
    }

    mostrarAviso('Livro excluído com sucesso.');
    finalizarOperacao();
    await listar();
  } catch (erro) {
    mostrarAviso(erro.message, true);
  }
}

async function listar() {
  const tbody = document.getElementById('livros-tbody');

  try {
    const resposta = await fetch(`${URL_API}/livros`);
    if (!resposta.ok) throw new Error();

    const livros = await resposta.json();
    livros.forEach(livro => adicionarEditora(livro.editora));
    tbody.replaceChildren();

    livros.forEach((livro) => {
      const row = tbody.insertRow();

      const imagemCell = row.insertCell();
      const img = document.createElement('img');
      img.className = 'capa-tabela';
      img.alt = `Capa de ${livro.titulo}`;
      configurarImagem(img, livro);
      imagemCell.appendChild(img);

      row.insertCell().textContent = livro.titulo;
      row.insertCell().textContent = livro.autor;
      row.insertCell().textContent = livro.nome_genero;
      row.insertCell().textContent = formatarPreco(livro.preco);
      row.insertCell().textContent = livro.estoque;

      const actions = row.insertCell();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button-secondary';
      button.textContent = 'Selecionar';
      button.addEventListener('click', () => selecionarLivro(livro));
      actions.appendChild(button);
    });

    if (!livros.length) {
      const row = tbody.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 7;
      cell.textContent = 'Nenhum livro cadastrado.';
    }

    document.getElementById('list-status').textContent =
      `${livros.length} livro(s) cadastrado(s).`;
  } catch (erro) {
    tbody.replaceChildren();
    const row = tbody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 7;
    cell.textContent = 'Servidor offline ou banco indisponível.';
    document.getElementById('list-status').textContent =
      'Não foi possível carregar os livros.';
  }
}

function selecionarLivro(livro) {
  livroAtual = livro;
  mostrarDadosLivro(livro);
  mostrarImagemLivro(livro);
  visibilidadeDosBotoes(false, false, true, true, false);
  mostrarAviso('Livro selecionado. Escolha Alterar ou Excluir.');
}

function adicionarEditora(nome) {
  const select = document.getElementById('editora');
  if (!nome || [...select.options].some(opcao => opcao.value === nome)) return;
  select.add(new Option(nome, nome), select.options[select.options.length - 1]);
}

function sincronizarEditora(focar = false) {
  const select = document.getElementById('editora');
  const campo = document.getElementById('editora-outra');
  const outra = select.value === OUTRA_EDITORA;
  document.getElementById('editora-outra-grupo').hidden = !outra;
  campo.disabled = select.disabled || !outra;
  campo.required = !campo.disabled;
  if (!outra) campo.value = '';
  if (focar && outra && !campo.disabled) campo.focus();
}

function coletarDadosLivro() {
  const valor = (id) => document.getElementById(id).value.trim();
  const idTexto = valor('id_livro');
  const paginasTexto = valor('paginas');
  const anoTexto = valor('ano');
  const precoTexto = valor('preco');
  const estoqueTexto = valor('estoque');
  const generoTexto = valor('genero_id');
  const titulo = valor('titulo');
  const autor = valor('autor');

  // Valida cada campo antes de converter: Number('') transforma vazio em zero.
  if (!/^[1-9]\d*$/.test(idTexto) || Number(idTexto) > 2147483647) {
    mostrarAviso('ID: informe um número inteiro positivo.', true); return null;
  }
  if (!titulo) { mostrarAviso('Título: este campo é obrigatório.', true); return null; }
  if (titulo.length > 200) { mostrarAviso('Título: máximo de 200 caracteres.', true); return null; }
  if (!autor) { mostrarAviso('Autor: este campo é obrigatório.', true); return null; }
  if (autor.length > 150) { mostrarAviso('Autor: máximo de 150 caracteres.', true); return null; }
  if (valor('isbn').length > 20) { mostrarAviso('ISBN: máximo de 20 caracteres.', true); return null; }
  const novaEditora = valor('editora') === OUTRA_EDITORA;
  const editora = novaEditora ? valor('editora-outra') : valor('editora');
  if (novaEditora && !editora) { mostrarAviso('Informe o nome da editora.', true); return null; }
  if (editora.length > 100) { mostrarAviso('Editora: máximo de 100 caracteres.', true); return null; }
  if (!/^[1-9]\d*$/.test(paginasTexto) || Number(paginasTexto) > 2147483647) {
    mostrarAviso('Páginas: informe um número inteiro maior que zero.', true); return null;
  }
  if (anoTexto && (!/^\d+$/.test(anoTexto) || Number(anoTexto) < 1 || Number(anoTexto) > 2100)) {
    mostrarAviso('Ano: informe um ano entre 1 e 2100 ou deixe o campo vazio.', true); return null;
  }
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(precoTexto) || !Number.isFinite(Number(precoTexto.replace(',', '.'))) ||
      Number(precoTexto.replace(',', '.')) > 99999999.99) {
    mostrarAviso('Preço: informe um valor entre 0 e 99.999.999,99.', true); return null;
  }
  if (!/^\d+$/.test(estoqueTexto) || Number(estoqueTexto) > 2147483647) {
    mostrarAviso('Estoque: informe um número inteiro igual ou maior que zero.', true); return null;
  }
  if (!/^[1-9]\d*$/.test(generoTexto)) {
    mostrarAviso('Gênero: selecione um gênero válido.', true); return null;
  }

  return {
    id_livro: Number(idTexto), titulo, autor,
    isbn: valor('isbn') || null,
    editora: editora || null,
    paginas: Number(paginasTexto),
    ano: anoTexto ? Number(anoTexto) : null,
    sinopse: valor('sinopse') || null,
    preco: Number(precoTexto.replace(',', '.')),
    estoque: Number(estoqueTexto),
    genero_id: Number(generoTexto)
  };
}

function mostrarDadosLivro(livro) {
  document.getElementById('id_livro').value = livro.id_livro;
  adicionarEditora(livro.editora);

  ['titulo', 'autor', 'isbn', 'editora', 'paginas', 'ano', 'sinopse', 'preco', 'estoque', 'genero_id']
    .forEach((campo) => {
      document.getElementById(campo).value = livro[campo] ?? '';
    });

  document.getElementById('imagem').value = '';
  bloquearAtributos(true);
}

function limparCampos() {
  ['titulo', 'autor', 'isbn', 'editora', 'paginas', 'ano', 'sinopse', 'preco', 'estoque']
    .forEach((campo) => {
      document.getElementById(campo).value = '';
    });
  sincronizarEditora();
  document.getElementById('genero_id').value = '';
  document.getElementById('imagem').value = '';
  esconderPreview();
}

function limparAtributos(limparId = true) {
  livroAtual = null;
  if (limparId) document.getElementById('id_livro').value = '';
  limparCampos();
  bloquearAtributos(true);
}

function finalizarOperacao() {
  operacaoAtual = '';
  limparAtributos();
  visibilidadeDosBotoes(true, false, false, false, false);
}

function cancelarOperacao() {
  finalizarOperacao();
  mostrarAviso('Operação cancelada.');
}

function bloquearAtributos(somenteLeitura) {
  document.getElementById('id_livro').readOnly = !somenteLeitura;

  ['titulo', 'autor', 'isbn', 'editora', 'paginas', 'ano', 'sinopse', 'preco', 'estoque']
    .forEach((campo) => {
      document.getElementById(campo).readOnly = somenteLeitura;
    });

  document.getElementById('editora').disabled = somenteLeitura;
  sincronizarEditora();
  document.getElementById('genero_id').disabled = somenteLeitura;
  document.getElementById('imagem').disabled = somenteLeitura;
}

function visibilidadeDosBotoes(procure, inserir, alterar, excluir, salvar) {
  document.getElementById('btProcure').hidden = !procure;
  document.getElementById('btInserir').hidden = !inserir;
  document.getElementById('btAlterar').hidden = !alterar;
  document.getElementById('btExcluir').hidden = !excluir;
  document.getElementById('btSalvar').hidden = !salvar;
  document.getElementById('btCancelar').hidden = !salvar;
}

function mostrarAviso(mensagem, erro = false) {
  const aviso = document.getElementById('divAviso');
  aviso.textContent = mensagem;
  aviso.classList.toggle('error', erro);
}

function configurarImagem(img, livro) {
  const idLivro = Number(livro.id_livro);
  const caminho = typeof livro.caminho_imagem_livro === 'string'
    ? livro.caminho_imagem_livro.trim()
    : '';
  const arquivoLegado = imagensIniciais[idLivro];
  if (!caminho && !arquivoLegado) {
    img.hidden = true;
    img.removeAttribute('src');
    return;
  }

  const url = caminho
    ? new URL(caminho, URL_API).href
    : new URL(`/imagens/${arquivoLegado}`, URL_API).href;
  img.onerror = () => {
    console.error(`Não foi possível carregar a capa do livro ${idLivro}: ${url}`);
    img.hidden = true;
  };
  img.src = url;
}

function mostrarImagemLivro(livro) {
  const preview = document.getElementById('imagem-preview');
  configurarImagem(preview, livro);
  preview.hidden = false;
}

function previewImagem() {
  const arquivo = document.getElementById('imagem').files[0];
  const preview = document.getElementById('imagem-preview');

  if (!arquivo) {
    esconderPreview();
    return;
  }

  const leitor = new FileReader();
  leitor.onload = () => {
    preview.src = leitor.result;
    preview.hidden = false;
  };
  leitor.readAsDataURL(arquivo);
}

function esconderPreview() {
  const preview = document.getElementById('imagem-preview');
  preview.removeAttribute('src');
  preview.hidden = true;
}

function formatarPreco(preco) {
  return Number(preco).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}
