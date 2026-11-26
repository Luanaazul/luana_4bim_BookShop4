const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { senhaValida } = require('../utils/validacao');

const CUSTO_HASH = 12;

function perguntarEmail() {
  const interfaceTerminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    interfaceTerminal.question('E-mail da conta a redefinir: ', (email) => {
      interfaceTerminal.close();
      resolve(email.trim());
    });
  });
}

function perguntarSenhaOculta(rotulo) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Execute este procedimento em um terminal interativo.');
  }

  return new Promise((resolve, reject) => {
    const entrada = process.stdin;
    let senha = '';
    process.stdout.write(rotulo);
    entrada.setRawMode(true);
    entrada.resume();

    function finalizar() {
      entrada.setRawMode(false);
      entrada.pause();
      entrada.removeListener('data', aoReceberDados);
      process.stdout.write('\n');
    }

    function aoReceberDados(dados) {
      for (const caractere of dados.toString('utf8')) {
        if (caractere === '\u0003') {
          finalizar();
          reject(new Error('Operação cancelada.'));
          return;
        }

        if (caractere === '\r' || caractere === '\n') {
          finalizar();
          resolve(senha);
          return;
        }

        if (caractere === '\u007f' || caractere === '\b') {
          senha = senha.slice(0, -1);
        } else {
          senha += caractere;
        }
      }
    }

    entrada.on('data', aoReceberDados);
  });
}

async function main() {
  const email = await perguntarEmail();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Informe um e-mail válido.');
  }

  const conta = await db.query(
    `SELECT cpf_pessoa,
            (substring(senha_pessoa from 1 for 3) IN ('$2a', '$2b', '$2y')) AS senha_em_bcrypt
     FROM pessoas
     WHERE LOWER(email_pessoa) = LOWER($1)
     LIMIT 2`,
    [email]
  );

  if (conta.rowCount === 0) {
    throw new Error('Não foi encontrada uma pessoa com esse e-mail.');
  }
  if (conta.rowCount > 1) {
    throw new Error('Há e-mails duplicados sem diferenciar maiúsculas e minúsculas; redefinição cancelada.');
  }

  const senhaEmBytes = await perguntarSenhaOculta('Nova senha (não será exibida): ');
  const confirmacao = await perguntarSenhaOculta('Confirme a nova senha: ');

  if (senhaEmBytes !== confirmacao) {
    throw new Error('As senhas não correspondem.');
  }

  if (!senhaValida(senhaEmBytes)) {
    throw new Error('A senha precisa ter entre 8 e 72 bytes.');
  }

  const hash = await bcrypt.hash(senhaEmBytes, CUSTO_HASH);
  const atualizacao = await db.query(
    `UPDATE pessoas
     SET senha_pessoa = $1
     WHERE cpf_pessoa = $2
     RETURNING cpf_pessoa`,
    [hash, conta.rows[0].cpf_pessoa]
  );

  if (atualizacao.rowCount !== 1) {
    throw new Error('Não foi possível atualizar a senha da conta.');
  }

  console.log(
    conta.rows[0].senha_em_bcrypt
      ? 'Senha redefinida. O cadastro e suas relações foram preservados.'
      : 'Senha antiga substituída por hash bcrypt. O cadastro e suas relações foram preservados.'
  );
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
