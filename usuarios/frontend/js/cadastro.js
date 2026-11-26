const formCadastro = document.getElementById('signup-form');
const mensagemCadastro = document.getElementById('signup-message');

const campoCpf = formCadastro.elements.namedItem('cpf_pessoa');
campoCpf.addEventListener('input', () => {
  campoCpf.value = campoCpf.value.replace(/\D/g, '').slice(0, 11)
    .replace(/^(\d{3})(?=\d)/, '$1.')
    .replace(/^(\d{3}\.\d{3})(?=\d)/, '$1.')
    .replace(/^(\d{3}\.\d{3}\.\d{3})(?=\d)/, '$1-');
});

formCadastro.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!formCadastro.reportValidity()) return;

  const senha = formCadastro.elements.namedItem('senha_pessoa').value;
  const confirmacao = formCadastro.elements.namedItem('confirmacao_senha').value;
  const dataNascimento = formCadastro.elements.namedItem('data_nascimento_pessoa').value;
  if (senha !== confirmacao) {
    mensagemCadastro.textContent = 'As senhas não correspondem.';
    mensagemCadastro.classList.add('error');
    return;
  }

  const tamanhoSenha = new TextEncoder().encode(senha).length;
  if (tamanhoSenha < 8 || tamanhoSenha > 72) {
    mensagemCadastro.textContent = 'A senha deve ter entre 8 e 72 bytes.';
    mensagemCadastro.classList.add('error');
    return;
  }

  if (!cpfValido(formCadastro.elements.namedItem('cpf_pessoa').value.trim())) {
    mensagemCadastro.textContent = 'Informe os 11 dígitos de um CPF válido. Identificadores de demonstração só podem ser usados nas contas já cadastradas.';
    mensagemCadastro.classList.add('error');
    return;
  }
  if (!dataISOValida(dataNascimento) ||
    dataNascimento > new Date().toISOString().slice(0, 10)) {
    mensagemCadastro.textContent = 'Informe uma data de nascimento válida, que não seja futura.';
    mensagemCadastro.classList.add('error');
    return;
  }

  const botao = document.getElementById('signup-submit');
  botao.disabled = true;
  botao.textContent = 'Criando conta...';
  mensagemCadastro.textContent = '';
  mensagemCadastro.classList.remove('error');

  const dados = {
    nome_pessoa: formCadastro.elements.namedItem('nome_pessoa').value.trim(),
    cpf_pessoa: formCadastro.elements.namedItem('cpf_pessoa').value.trim(),
    data_nascimento_pessoa: dataNascimento,
    email_pessoa: formCadastro.elements.namedItem('email_pessoa').value.trim(),
    nome_usuario_pessoa: formCadastro.elements.namedItem('nome_usuario_pessoa').value.trim(),
    senha_pessoa: senha
  };

  try {
    const response = await fetch(`${window.BOOKSHOP_API_BASE_URL}/cadastro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(dados)
    });
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || 'Não foi possível criar a conta.');

    window.location.assign(
      new URL(resultado.redirecionar || '/vitrine/index.html', window.BOOKSHOP_API_BASE_URL).href
    );
  } catch (error) {
    mensagemCadastro.textContent = error.message || 'Falha de conexão.';
    mensagemCadastro.classList.add('error');
    botao.disabled = false;
    botao.textContent = 'Criar conta';
  }
});

function dataISOValida(data) {
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const convertida = new Date(`${data}T00:00:00.000Z`);
  return !Number.isNaN(convertida.getTime()) &&
    convertida.toISOString().slice(0, 10) === data;
}

function cpfValido(cpf) {
  if (!/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(cpf)) return false;

  const digitos = cpf.replace(/\D/g, '');
  if (/^(\d)\1{10}$/.test(digitos)) return false;

  function calcularDigito(tamanho) {
    let soma = 0;
    for (let indice = 0; indice < tamanho; indice += 1) {
      soma += Number(digitos[indice]) * (tamanho + 1 - indice);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  }

  return calcularDigito(9) === Number(digitos[9]) &&
    calcularDigito(10) === Number(digitos[10]);
}
