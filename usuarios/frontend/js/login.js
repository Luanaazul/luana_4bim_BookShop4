const loginForm = document.getElementById('login-form');
const loginButton = document.getElementById('login-submit');
const loginMessage = document.getElementById('login-message');

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!loginForm.reportValidity()) {
    return;
  }

  const nomeUsuario = document.getElementById('nome_usuario_pessoa').value.trim();
  const senha = document.getElementById('senha').value;
  const next = new URLSearchParams(window.location.search).get('next')
    || '/vitrine/index.html';

  if (!nomeUsuario || !senha) {
    mostrarMensagem('Informe seu nome de usuário e sua senha.', true);
    return;
  }

  loginButton.disabled = true;
  loginButton.textContent = 'Verificando...';
  mostrarMensagem('');

  try {
    const response = await fetch(`${window.BOOKSHOP_API_BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ nome_usuario_pessoa: nomeUsuario, senha, next })
    });

    const resultado = await response.json();
    if (!response.ok || resultado.sucesso !== true || !resultado.redirecionar) {
      throw new Error(resultado.erro || 'Não foi possível confirmar o login.');
    }

    if (resultado.primeira_compra) {
      const dialog = document.getElementById('welcome-discount');
      dialog.showModal();
      await new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
    }
    mostrarMensagem('Login confirmado. Redirecionando...');
    window.location.assign(
      new URL(resultado.redirecionar, window.BOOKSHOP_API_BASE_URL).href
    );
  } catch (error) {
    mostrarMensagem(
      error.message || 'Não foi possível conectar ao servidor.',
      true
    );
    loginButton.disabled = false;
    loginButton.textContent = 'Entrar';
  }
});

function mostrarMensagem(texto, erro = false) {
  loginMessage.textContent = texto;
  loginMessage.classList.toggle('error', erro);
}
