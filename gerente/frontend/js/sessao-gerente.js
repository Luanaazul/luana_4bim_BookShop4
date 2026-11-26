// Exibe a pessoa autenticada e encerra a sessão através do backend.
window.addEventListener('DOMContentLoaded', async () => {
  const greeting = document.getElementById('manager-greeting');
  const logoutButton = document.getElementById('manager-logout');

  try {
    const response = await fetch('/login/sessao', { credentials: 'same-origin' });
    const session = await response.json();
    if (!response.ok || !session.autenticada || !session.gerente) {
      window.location.replace('/login/login.html?next=%2Fgerente%2Fmenu%2Findex.html');
      return;
    }
    greeting.textContent = `Olá, ${session.nome}`;
  } catch (error) {
    greeting.textContent = 'Não foi possível verificar a sessão.';
    logoutButton.disabled = true;
    return;
  }

  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true;
    try {
      const response = await fetch('/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error('Falha ao terminar sessão.');
      window.location.replace('/login/login.html');
    } catch (error) {
      logoutButton.disabled = false;
      greeting.textContent = 'Não foi possível sair. Tente novamente.';
    }
  });
});
