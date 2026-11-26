const bcrypt = require('bcryptjs');
const db = require('../database');
const { elegivelPrimeiraCompra } = require('../utils/descontos');
const { senhaValida, cpfValido, formatarCPF, dataISOValida } = require('../utils/validacao');

const HASH_BCRYPT = /^\$2[aby]\$\d{2}\$/;
const MAX_SENHA_BYTES = 72;
const PAINEIS_FUNCIONARIO = new Map([
  ['gerente', '/gerente/menu/index.html']
]);

async function login(req, res) {
  const nomeUsuario = typeof req.body?.nome_usuario_pessoa === 'string'
    ? req.body.nome_usuario_pessoa.trim()
    : '';
  const senha = typeof req.body?.senha === 'string'
    ? req.body.senha
    : '';

  if (
    !nomeUsuario ||
    nomeUsuario.length > 50 ||
    !senha ||
    Buffer.byteLength(senha, 'utf8') > MAX_SENHA_BYTES
  ) {
    registrarTentativaFalha(req);
    return res.status(400).json({
      erro: 'Informe um nome de usuário e uma senha válidos.'
    });
  }
  try {
    const resultado = await db.query(
      `SELECT
         p.cpf_pessoa,
         p.senha_pessoa,
         EXISTS (
           SELECT 1
           FROM clientes cl
           WHERE cl.pessoa_cpf_pessoa = p.cpf_pessoa
         ) AS is_client,
         EXISTS (
           SELECT 1
           FROM funcionarios f
           JOIN cargos c ON c.id_cargo = f.cargo_id_cargo
           WHERE f.pessoa_cpf_pessoa = p.cpf_pessoa
             AND LOWER(TRIM(c.nome_cargo)) = 'gerente'
         ) AS is_manager,
         EXISTS (
           SELECT 1
           FROM funcionarios f
           WHERE f.pessoa_cpf_pessoa = p.cpf_pessoa
         ) AS is_employee
       FROM pessoas p
       WHERE LOWER(BTRIM(p.nome_usuario_pessoa)) = LOWER(BTRIM($1))
       LIMIT 2`,
      [nomeUsuario]
    );

    if (resultado.rowCount > 1) {
      console.error('Login recusado: nome de usuário ambíguo por diferença de capitalização.');
      registrarTentativaFalha(req);
      return res.status(401).json({
        erro: 'Nome de usuário ou senha incorretos. Se sua conta ainda usa senha antiga, redefina-a antes de entrar.'
      });
    }

    const pessoa = resultado.rows[0];
    if (!pessoa || !HASH_BCRYPT.test(pessoa.senha_pessoa)) {
      registrarTentativaFalha(req);
      return res.status(401).json({
        erro: 'Nome de usuário ou senha incorretos. Se sua conta ainda usa senha antiga, redefina-a antes de entrar.'
      });
    }

    const senhaCorreta = await bcrypt.compare(senha, pessoa.senha_pessoa);
    if (!senhaCorreta) {
      registrarTentativaFalha(req);
      return res.status(401).json({
        erro: 'Nome de usuário ou senha incorretos. Se sua conta ainda usa senha antiga, redefina-a antes de entrar.'
      });
    }

    if (!pessoa.is_employee && !pessoa.is_client) {
      return res.status(403).json({
        erro: 'Esta conta não tem acesso à área de clientes ou de funcionários.'
      });
    }

    const primeiraCompra = !pessoa.is_employee && await elegivelPrimeiraCompra(db, pessoa.cpf_pessoa);
    req.session = { cpf_pessoa: pessoa.cpf_pessoa };
    tentativasLogin.delete(chaveTentativas(req));
    const destino = destinoCliente(req.body && req.body.next);
    const destinoLogin = pessoa.is_employee
      ? `/acesso/index.html?next=${encodeURIComponent(destino)}`
      : destino;

    return res.json({
      sucesso: true,
      tipo: pessoa.is_manager ? 'gerente' : pessoa.is_employee ? 'funcionario' : 'cliente',
      primeira_compra: primeiraCompra,
      redirecionar: destinoLogin
    });
  } catch (error) {
    console.error('Erro ao autenticar pessoa:', error.message);
    return res.status(500).json({
      erro: 'Não foi possível realizar o login.'
    });
  }
}


async function cadastrarCliente(req, res) {
  const dados = req.body || {};
  const cpfInformado = typeof dados.cpf_pessoa === 'string' ? dados.cpf_pessoa.trim() : '';
  const cpf = cpfValido(cpfInformado) ? formatarCPF(cpfInformado) : '';
  const nome = typeof dados.nome_pessoa === 'string' ? dados.nome_pessoa.trim() : '';
  const nomeUsuario = typeof dados.nome_usuario_pessoa === 'string'
    ? dados.nome_usuario_pessoa.trim()
    : '';
  const dataNascimento = dados.data_nascimento_pessoa;
  const email = typeof dados.email_pessoa === 'string' ? dados.email_pessoa.trim().toLowerCase() : '';
  const senha = typeof dados.senha_pessoa === 'string' ? dados.senha_pessoa : '';
  if (!cpf) return res.status(400).json({ erro: 'Informe um CPF com 11 dígitos e dígitos verificadores válidos.' });
  if (
    !nome || nome.length > 100 ||
    !nomeUsuario || nomeUsuario.length > 50 ||
    !dataISOValida(dataNascimento) ||
    dataNascimento > new Date().toISOString().slice(0, 10) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 ||
    !senhaValida(senha)
  ) {
    return res.status(400).json({
      erro: 'Informe nome, CPF válido, data de nascimento válida, e-mail, nome de usuário e uma senha entre 8 e 72 bytes.'
    });
  }

  let client;
  let transacaoAberta = false;
  try {
    const hash = await bcrypt.hash(senha, 12);
    client = await db.connect();
    await client.query('BEGIN');
    transacaoAberta = true;
    await client.query('LOCK TABLE public.pessoas IN SHARE ROW EXCLUSIVE MODE');
    const existentes = await client.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM pessoas
           WHERE REGEXP_REPLACE(cpf_pessoa, '[^0-9]', '', 'g') = $1
         ) AS cpf_existente,
         EXISTS (
           SELECT 1 FROM pessoas
           WHERE LOWER(BTRIM(email_pessoa)) = LOWER(BTRIM($2))
         ) AS email_existente,
         EXISTS (
           SELECT 1 FROM pessoas
           WHERE LOWER(BTRIM(nome_usuario_pessoa)) = LOWER(BTRIM($3))
         ) AS usuario_existente`,
      [cpf.replace(/\D/g, ''), email, nomeUsuario]
    );
    const duplicados = existentes.rows[0];
    if (duplicados.cpf_existente || duplicados.email_existente || duplicados.usuario_existente) {
      await client.query('ROLLBACK');
      transacaoAberta = false;
      const conflitos = [];
      if (duplicados.cpf_existente) conflitos.push('CPF');
      if (duplicados.email_existente) conflitos.push('e-mail');
      if (duplicados.usuario_existente) conflitos.push('nome de usuário');
      return res.status(409).json({
        erro: `${conflitos.join(', ')} já cadastrado${conflitos.length > 1 ? 's' : ''}.`
      });
    }

    // O esquema legado ainda exige o campo; o cadastro não coleta endereço.
    await client.query(
      `INSERT INTO pessoas (
         cpf_pessoa, nome_pessoa, data_nascimento_pessoa, endereco_pessoa,
         senha_pessoa, email_pessoa, nome_usuario_pessoa
       )
       VALUES ($1, $2, $3, NULL, $4, $5, $6)`,
      [cpf, nome, dataNascimento, hash, email, nomeUsuario]
    );
    await client.query(
      `INSERT INTO clientes (pessoa_cpf_pessoa, renda_cliente, data_cadastro_cliente)
       VALUES ($1, 0, CURRENT_DATE)`, [cpf]);
    await client.query('COMMIT');
    transacaoAberta = false;
    req.session = { cpf_pessoa: cpf };
    return res.status(201).json({ sucesso: true, redirecionar: '/vitrine/index.html' });
  } catch (error) {
    if (client && transacaoAberta) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Erro ao desfazer cadastro público:', rollbackError.message);
      }
    }
    if (error.code === '23505') {
      return res.status(409).json({
        erro: 'CPF, e-mail ou nome de usuário já cadastrado.'
      });
    }
    if (error.code === '23503') return res.status(400).json({ erro: 'Não foi possível relacionar a pessoa ao cadastro de cliente.' });
    console.error('Erro no cadastro público:', error.message);
    return res.status(500).json({ erro: 'Não foi possível criar a conta.' });
  } finally {
    if (client) client.release();
  }
}

const LIMITE_TENTATIVAS_LOGIN = 10;
const JANELA_TENTATIVAS_LOGIN_MS = 15 * 60 * 1000;
const tentativasLogin = new Map();

function chaveTentativas(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

function registrarTentativaFalha(req) {
  const chave = chaveTentativas(req);
  const agora = Date.now();
  const atual = tentativasLogin.get(chave);
  if (!atual || agora - atual.inicio >= JANELA_TENTATIVAS_LOGIN_MS) {
    tentativasLogin.set(chave, { inicio: agora, quantidade: 1 });
    return;
  }
  atual.quantidade += 1;
}

function limitarTentativasLogin(req, res, next) {
  const atual = tentativasLogin.get(chaveTentativas(req));
  if (atual && Date.now() - atual.inicio < JANELA_TENTATIVAS_LOGIN_MS &&
    atual.quantidade >= LIMITE_TENTATIVAS_LOGIN) {
    return res.status(429).json({
      erro: 'Muitas tentativas de login. Aguarde 15 minutos e tente novamente.'
    });
  }
  return next();
}

async function sessao(req, res) {
  const cpf = req.session && req.session.cpf_pessoa;
  if (!cpf) {
    return res.json({ autenticada: false, gerente: false });
  }

  try {
    const resultado = await db.query(
      `SELECT p.nome_pessoa, p.nome_usuario_pessoa, p.email_pessoa,
         EXISTS (
           SELECT 1 FROM funcionarios f
           JOIN cargos c ON c.id_cargo = f.cargo_id_cargo
           WHERE f.pessoa_cpf_pessoa = p.cpf_pessoa
             AND LOWER(TRIM(c.nome_cargo)) = 'gerente'
         ) AS gerente,
         c.nome_cargo AS cargo,
         f.pessoa_cpf_pessoa IS NOT NULL AS funcionario
       FROM pessoas p
       LEFT JOIN funcionarios f ON f.pessoa_cpf_pessoa = p.cpf_pessoa
       LEFT JOIN cargos c ON c.id_cargo = f.cargo_id_cargo
       WHERE p.cpf_pessoa = $1`,
      [cpf]
    );

    if (!resultado.rowCount) {
      req.session = null;
      return res.json({ autenticada: false, gerente: false });
    }

    const usuario = resultado.rows[0];
    return res.json({
      autenticada: true,
      gerente: Boolean(usuario.gerente),
      funcionario: Boolean(usuario.funcionario),
      cargo: usuario.cargo || null,
      painel_disponivel: Boolean(painelFuncionario(usuario.cargo)),
      nome: usuario.nome_usuario_pessoa || usuario.nome_pessoa,
      email: usuario.email_pessoa
    });
  } catch (error) {
    console.error('Erro ao consultar sessão:', error.message);
    return res.status(500).json({ erro: 'Não foi possível consultar a sessão.' });
  }
}

function acessarCliente(req, res) {
  return res.redirect(destinoCliente(req.query && req.query.next));
}

async function acessarFuncionario(req, res) {
  const cpf = req.session && req.session.cpf_pessoa;
  try {
    const resultado = await db.query(
      `SELECT c.nome_cargo
       FROM funcionarios f
       JOIN cargos c ON c.id_cargo = f.cargo_id_cargo
       WHERE f.pessoa_cpf_pessoa = $1`,
      [cpf]
    );

    if (!resultado.rowCount) {
      return res.status(403).json({
        erro: 'Acesso permitido somente para pessoas cadastradas como funcionárias.'
      });
    }

    const painel = painelFuncionario(resultado.rows[0].nome_cargo);
    if (!painel) {
      return res.redirect('/acesso/index.html?aviso=painel-indisponivel');
    }
    return res.redirect(painel);
  } catch (error) {
    console.error('Erro ao verificar o cargo para acesso ao painel:', error.message);
    return res.status(500).json({
      erro: 'Não foi possível verificar o acesso ao painel de funcionário.'
    });
  }
}

function painelFuncionario(cargo) {
  const nomeCargo = typeof cargo === 'string' ? cargo.trim().toLocaleLowerCase('pt-BR') : '';
  return PAINEIS_FUNCIONARIO.get(nomeCargo) || (nomeCargo ? '/gerente/pedidos/pedidos.html' : null);
}

function logout(req, res) {
  req.session = null;
  return res.json({ sucesso: true });
}

function destinoCliente(destino) {
  if (typeof destino !== 'string' || !destino.startsWith('/') ||
    destino.startsWith('//') || destino.includes('\\')) {
    return '/vitrine/index.html';
  }

  let url;
  try {
    url = new URL(destino, 'http://bookshop.local');
  } catch (error) {
    return '/vitrine/index.html';
  }
  if (url.origin !== 'http://bookshop.local') {
    return '/vitrine/index.html';
  }
  if (url.pathname === '/carrinho/carrinho.html') {
    return url.searchParams.get('checkout') === '1'
      ? '/carrinho/carrinho.html?checkout=1'
      : '/carrinho/carrinho.html';
  }
  if (url.pathname === '/finalizar/finalizar.html') return '/finalizar/finalizar.html';
  if (url.pathname === '/perfil.html') return '/perfil.html';
  if (url.pathname === '/meus-pedidos.html') return '/meus-pedidos.html';
  return '/vitrine/index.html';
}

module.exports = {
  login,
  logout,
  sessao,
  destinoCliente,
  cadastrarCliente,
  acessarCliente,
  acessarFuncionario,
  limitarTentativasLogin
};
