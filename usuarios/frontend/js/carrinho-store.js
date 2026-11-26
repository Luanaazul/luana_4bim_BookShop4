(function () {
  const CHAVE_CARRINHO = 'bookshop_carrinho_v1';

  function lerItens() {
    const conteudo = window.localStorage.getItem(CHAVE_CARRINHO);
    if (conteudo === null) return [];

    let itens;
    try {
      itens = JSON.parse(conteudo);
    } catch (error) {
      throw new Error('Os dados salvos do carrinho estão inválidos.');
    }

    if (!Array.isArray(itens)) {
      throw new Error('Os dados salvos do carrinho estão inválidos.');
    }

    const ids = new Set();
    for (const item of itens) {
      if (
        !item ||
        !Number.isInteger(item.id_livro) ||
        item.id_livro < 1 ||
        !Number.isInteger(item.quantidade) ||
        item.quantidade < 1 ||
        ids.has(item.id_livro)
      ) {
        throw new Error('Os dados salvos do carrinho estão inválidos.');
      }
      ids.add(item.id_livro);
    }
    return itens;
  }

  function salvarItens(itens) {
    window.localStorage.setItem(CHAVE_CARRINHO, JSON.stringify(itens));
  }

  async function validarItens(itens, opcoes = {}) {
    const resposta = await fetch(`${window.BOOKSHOP_API_BASE_URL}/carrinho/validar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ itens, ...opcoes })
    });
    const resultado = await lerRespostaJson(resposta);
    if (!resposta.ok) {
      throw new Error(resultado.erro || 'Não foi possível validar o carrinho.');
    }
    return resultado;
  }

  async function lerRespostaJson(resposta) {
    const tipoConteudo = resposta.headers.get('content-type') || '';
    if (!tipoConteudo.toLowerCase().includes('application/json')) {
      throw new Error(
        `A API respondeu com conteúdo não JSON (HTTP ${resposta.status}). `
        + 'Confirme se o backend atualizado está em execução.'
      );
    }
    return resposta.json();
  }

  async function atualizarAreaConta(elemento) {
    try {
      const resposta = await fetch(`${window.BOOKSHOP_API_BASE_URL}/login/sessao`, {
        credentials: 'include'
      });
      if (!resposta.ok) throw new Error('Não foi possível verificar a sessão.');
      const estado = await lerRespostaJson(resposta);
      elemento.replaceChildren();

      if (estado.autenticada) {
        const identificacao = document.createElement('span');
        identificacao.className = 'account-status';
        identificacao.textContent = 'Você está conectado';

        const perfil = document.createElement('a');
        perfil.className = 'account-link';
        perfil.href = new URL('/perfil.html', window.BOOKSHOP_API_BASE_URL).href;
        perfil.textContent = 'Perfil';
        const controles = [perfil];
        if (estado.funcionario) {
          const painel = document.createElement('a');
          painel.className = 'account-link';
          painel.href = new URL('/acesso/funcionario', window.BOOKSHOP_API_BASE_URL).href;
          painel.textContent = 'Acessar painel de funcionário';
          controles.push(painel);
        }

        const sair = document.createElement('button');
        sair.type = 'button';
        sair.className = 'account-link';
        sair.textContent = 'Sair';
        sair.addEventListener('click', async () => {
          sair.disabled = true;
          try {
            const logout = await fetch(`${window.BOOKSHOP_API_BASE_URL}/logout`, {
              method: 'POST',
              credentials: 'include'
            });
            await lerRespostaJson(logout);
            if (!logout.ok) throw new Error('Não foi possível encerrar a sessão.');
            window.location.reload();
          } catch (error) {
            sair.disabled = false;
            const aviso = document.createElement('span');
            aviso.className = 'account-error';
            aviso.textContent = error.message;
            elemento.appendChild(aviso);
          }
        });
        elemento.append(identificacao, ...controles, sair);
        return;
      }

      const entrar = document.createElement('a');
      entrar.className = 'account-link';
      entrar.href = new URL('/login/login.html', window.BOOKSHOP_API_BASE_URL).href;
      const icone = document.createElement('span');
      icone.className = 'person-icon';
      icone.setAttribute('aria-hidden', 'true');
      const texto = document.createElement('span');
      texto.textContent = 'Entrar';
      entrar.append(icone, texto);
      elemento.appendChild(entrar);
    } catch (error) {
      const aviso = document.createElement('span');
      aviso.className = 'account-error';
      aviso.textContent = error.message;
      const entrar = document.createElement('a');
      entrar.className = 'account-link';
      entrar.href = new URL('/login/login.html', window.BOOKSHOP_API_BASE_URL).href;
      entrar.textContent = 'Entrar';
      elemento.replaceChildren(aviso, entrar);
    }
  }

  function lerPromocoes() {
    const atual = sessionStorage.getItem('bookshop_promocao');
    if (!atual) return [];
    if (!atual.startsWith('[')) return [atual];
    try {
      const codigos = JSON.parse(atual);
      return Array.isArray(codigos) ? codigos.filter(c => typeof c === 'string') : [];
    } catch { return []; }
  }

  function salvarPromocoes(codigos) {
    if (codigos.length) sessionStorage.setItem('bookshop_promocao', JSON.stringify(codigos));
    else sessionStorage.removeItem('bookshop_promocao');
  }

  window.BookShopCart = {
    lerPromocoes,
    salvarPromocoes,
    lerItens,
    salvarItens,
    validarItens,
    atualizarAreaConta
  };
})();
