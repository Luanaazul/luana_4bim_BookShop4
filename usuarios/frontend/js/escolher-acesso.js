window.addEventListener('DOMContentLoaded', inicializarEscolhaAcesso);

async function inicializarEscolhaAcesso() {
  const saudacao = document.getElementById('access-greeting');
  const mensagem = document.getElementById('access-message');
  const cliente = document.getElementById('client-mode');
  const funcionario = document.getElementById('staff-mode');
  const descricaoFuncionario = document.getElementById('staff-description');
  const parametros = new URLSearchParams(window.location.search);
  const proximo = parametros.get('next');
  const aviso = parametros.get('aviso');

  if (proximo) {
    cliente.href = new URL('/acesso/cliente', window.BOOKSHOP_API_BASE_URL).href
      + `?next=${encodeURIComponent(proximo)}`;
  }

  if (aviso === 'painel-indisponivel') {
    mensagem.textContent = 'Ainda não existe um painel administrativo para esse cargo.';
    mensagem.classList.add('access-message-warning');
  }

  try {
    const resposta = await fetch(`${window.BOOKSHOP_API_BASE_URL}/login/sessao`, {
      credentials: 'include'
    });
    const estado = await resposta.json();
    if (!resposta.ok) throw new Error(estado.erro || 'Não foi possível verificar a sessão.');
    if (!estado.autenticada) {
      window.location.replace(new URL('/login/login.html', window.BOOKSHOP_API_BASE_URL).href);
      return;
    }
    if (!estado.funcionario) {
      window.location.replace(new URL('/vitrine/index.html', window.BOOKSHOP_API_BASE_URL).href);
      return;
    }

    saudacao.textContent = `Olá, ${estado.nome}. Seu cargo é ${estado.cargo}.`;
    if (estado.painel_disponivel) {
      funcionario.disabled = false;
      funcionario.textContent = 'Acessar painel de funcionário';
      funcionario.addEventListener('click', () => {
        window.location.assign(new URL('/acesso/funcionario', window.BOOKSHOP_API_BASE_URL).href);
      });
    } else {
      funcionario.textContent = 'Painel ainda não disponível';
      descricaoFuncionario.textContent =
        `O painel para o cargo ${estado.cargo} ainda não está implementado.`;
      funcionario.setAttribute('aria-describedby', 'staff-description');
    }
  } catch (error) {
    saudacao.textContent = 'Não foi possível verificar seu acesso.';
    mensagem.textContent = error.message || 'Tente novamente mais tarde.';
    mensagem.classList.add('access-message-warning');
    cliente.setAttribute('aria-disabled', 'true');
    cliente.addEventListener('click', (event) => event.preventDefault());
  }
}
