const db = require('../database');

const CAMPOS_ENDERECO = new Set([
  'cep',
  'rua',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'estado'
]);

function idEnderecoValido(valor) {
  const texto = String(valor);
  if (!/^[1-9]\d*$/.test(texto)) return null;
  const id = Number(texto);
  return Number.isSafeInteger(id) ? id : null;
}

function normalizarEndereco(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    return { erro: 'Informe os dados do endereço.' };
  }
  if (Object.keys(dados).some((campo) =>
    campo !== 'principal' && !CAMPOS_ENDERECO.has(campo) &&
      !['id_endereco', 'data_criacao'].includes(campo)
  )) {
    return { erro: 'Informe somente campos válidos para o endereço.' };
  }

  const endereco = {};
  const obrigatorios = ['cep', 'rua', 'numero', 'bairro', 'cidade', 'estado'];
  for (const campo of obrigatorios) {
    if (typeof dados[campo] !== 'string' || !dados[campo].trim()) {
      return { erro: `O campo ${campo} é obrigatório.` };
    }
    endereco[campo] = dados[campo].trim();
  }
  if (dados.complemento !== undefined && dados.complemento !== null &&
    typeof dados.complemento !== 'string') {
    return { erro: 'O complemento deve ser um texto.' };
  }

  if (!/^\d{5}-?\d{3}$/.test(endereco.cep)) {
    return { erro: 'Informe um CEP válido.' };
  }
  const cep = endereco.cep.replace(/\D/g, '');
  if (!/^\d{8}$/.test(cep)) return { erro: 'Informe um CEP válido.' };
  endereco.cep = `${cep.slice(0, 5)}-${cep.slice(5)}`;
  endereco.estado = endereco.estado.toUpperCase();
  endereco.complemento = typeof dados.complemento === 'string'
    ? dados.complemento.trim() || null
    : null;

  const limites = {
    rua: 200,
    numero: 30,
    complemento: 100,
    bairro: 100,
    cidade: 100
  };
  for (const [campo, limite] of Object.entries(limites)) {
    if (endereco[campo] && endereco[campo].length > limite) {
      return { erro: `${campo} excede o limite de ${limite} caracteres.` };
    }
  }
  if (!/^[A-Z]{2}$/.test(endereco.estado)) {
    return { erro: 'Informe a sigla de estado com duas letras.' };
  }
  return { endereco };
}

function principalValido(dados) {
  return dados.principal === undefined || typeof dados.principal === 'boolean';
}

async function listarEnderecos(req, res) {
  try {
    const resultado = await db.query(
      `SELECT id_endereco, cep, rua, numero, complemento, bairro, cidade,
              estado, principal, data_criacao
       FROM enderecos_clientes
       WHERE cliente_pessoa_cpf_pessoa = $1
       ORDER BY principal DESC, id_endereco`,
      [req.session.cpf_pessoa]
    );
    return res.json(resultado.rows);
  } catch (error) {
    console.error('Erro ao listar endereços:', error.message);
    return res.status(500).json({ erro: 'Não foi possível carregar os endereços.' });
  }
}

async function criarEndereco(req, res) {
  const dados = req.body || {};
  const camposDesconhecidos = dados && typeof dados === 'object' &&
    !Array.isArray(dados) && Object.keys(dados).some((campo) =>
      campo !== 'principal' && !CAMPOS_ENDERECO.has(campo)
    );
  const validacao = normalizarEndereco(dados);
  if (camposDesconhecidos || validacao.erro || !principalValido(dados)) {
    return res.status(400).json({
      erro: validacao.erro ||
        (camposDesconhecidos ? 'Informe somente campos válidos para o endereço.' :
          'O indicador de endereço principal deve ser verdadeiro ou falso.')
    });
  }

  const cpf = req.session.cpf_pessoa;
  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const cliente = await client.query(
      'SELECT pessoa_cpf_pessoa FROM clientes WHERE pessoa_cpf_pessoa = $1 FOR UPDATE',
      [cpf]
    );
    if (!cliente.rowCount) {
      await client.query('ROLLBACK');
      return res.status(403).json({ erro: 'A conta autenticada não possui cadastro de cliente.' });
    }

    const existentes = await client.query(
      'SELECT COUNT(*)::integer AS quantidade FROM enderecos_clientes WHERE cliente_pessoa_cpf_pessoa = $1',
      [cpf]
    );
    const principal = dados.principal === true || existentes.rows[0].quantidade === 0;
    if (principal) {
      await client.query(
        'UPDATE enderecos_clientes SET principal = FALSE WHERE cliente_pessoa_cpf_pessoa = $1',
        [cpf]
      );
    }
    const endereco = validacao.endereco;
    const resultado = await client.query(
      `INSERT INTO enderecos_clientes
       (cliente_pessoa_cpf_pessoa, cep, rua, numero, complemento, bairro,
        cidade, estado, principal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id_endereco, cep, rua, numero, complemento, bairro, cidade,
                 estado, principal, data_criacao`,
      [
        cpf,
        endereco.cep,
        endereco.rua,
        endereco.numero,
        endereco.complemento,
        endereco.bairro,
        endereco.cidade,
        endereco.estado,
        principal
      ]
    );
    await client.query('COMMIT');
    return res.status(201).json(resultado.rows[0]);
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {
        console.error('Erro ao desfazer cadastro de endereço:', rollbackError.message);
      }
    }
    if (error.code === '23503') {
      return res.status(403).json({ erro: 'A conta autenticada não possui cadastro de cliente.' });
    }
    console.error('Erro ao cadastrar endereço:', error.message);
    return res.status(500).json({ erro: 'Não foi possível salvar o endereço.' });
  } finally {
    if (client) client.release();
  }
}

async function atualizarEndereco(req, res) {
  const id = idEnderecoValido(req.params.id);
  const dados = req.body || {};
  if (!id) {
    return res.status(400).json({ erro: 'Identificador de endereço inválido.' });
  }
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    return res.status(400).json({ erro: 'Informe os dados do endereço.' });
  }
  if (!principalValido(dados)) {
    return res.status(400).json({ erro: 'O indicador de endereço principal deve ser verdadeiro ou falso.' });
  }

  const campos = Object.keys(dados).filter((campo) => campo !== 'principal');
  if (campos.some((campo) => !CAMPOS_ENDERECO.has(campo)) ||
    (!campos.length && dados.principal === undefined)) {
    return res.status(400).json({ erro: 'Informe somente campos válidos para atualizar.' });
  }
  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const cliente = await client.query(
      'SELECT pessoa_cpf_pessoa FROM clientes WHERE pessoa_cpf_pessoa = $1 FOR UPDATE',
      [req.session.cpf_pessoa]
    );
    if (!cliente.rowCount) {
      await client.query('ROLLBACK');
      return res.status(403).json({ erro: 'A conta autenticada não possui cadastro de cliente.' });
    }
    const atual = await client.query(
      `SELECT id_endereco, cep, rua, numero, complemento, bairro, cidade,
              estado, principal, data_criacao
       FROM enderecos_clientes
       WHERE id_endereco = $1 AND cliente_pessoa_cpf_pessoa = $2
       FOR UPDATE`,
      [id, req.session.cpf_pessoa]
    );
    if (!atual.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Endereço não encontrado.' });
    }

    const validacao = normalizarEndereco({ ...atual.rows[0], ...dados });
    if (validacao.erro) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: validacao.erro });
    }

    if (dados.principal === true) {
      await client.query(
        'UPDATE enderecos_clientes SET principal = FALSE WHERE cliente_pessoa_cpf_pessoa = $1',
        [req.session.cpf_pessoa]
      );
    }

    const atualizaveis = campos.map((campo) => [
      campo,
      validacao.endereco[campo]
    ]);
    if (dados.principal !== undefined) atualizaveis.push(['principal', dados.principal]);

    const atribuicoes = atualizaveis.map(([campo], indice) =>
      `${campo} = $${indice + 1}`
    );
    const parametros = atualizaveis.map(([, valor]) => valor);
    parametros.push(id, req.session.cpf_pessoa);
    const resultado = await client.query(
      `UPDATE enderecos_clientes
       SET ${atribuicoes.join(', ')}
       WHERE id_endereco = $${parametros.length - 1}
         AND cliente_pessoa_cpf_pessoa = $${parametros.length}
       RETURNING id_endereco, cep, rua, numero, complemento, bairro, cidade,
                 estado, principal, data_criacao`,
      parametros
    );

    if (dados.principal === false && atual.rows[0].principal) {
      const substituto = await client.query(
        `UPDATE enderecos_clientes
         SET principal = TRUE
         WHERE id_endereco = (
           SELECT MIN(id_endereco)
           FROM enderecos_clientes
           WHERE cliente_pessoa_cpf_pessoa = $1
             AND id_endereco <> $2
         )
           AND NOT EXISTS (
             SELECT 1 FROM enderecos_clientes
             WHERE cliente_pessoa_cpf_pessoa = $1 AND principal
           )`,
        [req.session.cpf_pessoa, id]
      );
      if (!substituto.rowCount) {
        await client.query(
          'UPDATE enderecos_clientes SET principal = TRUE WHERE id_endereco = $1',
          [id]
        );
      }
    }

    const enderecoAtualizado = await client.query(
      `SELECT id_endereco, cep, rua, numero, complemento, bairro, cidade,
              estado, principal, data_criacao
       FROM enderecos_clientes
       WHERE id_endereco = $1 AND cliente_pessoa_cpf_pessoa = $2`,
      [id, req.session.cpf_pessoa]
    );
    await client.query('COMMIT');
    return res.json(enderecoAtualizado.rows[0] || resultado.rows[0]);
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {
        console.error('Erro ao desfazer edição de endereço:', rollbackError.message);
      }
    }
    console.error('Erro ao atualizar endereço:', error.message);
    return res.status(500).json({ erro: 'Não foi possível atualizar o endereço.' });
  } finally {
    if (client) client.release();
  }
}

async function excluirEndereco(req, res) {
  const id = idEnderecoValido(req.params.id);
  if (!id) {
    return res.status(400).json({ erro: 'Identificador de endereço inválido.' });
  }
  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const cliente = await client.query(
      'SELECT pessoa_cpf_pessoa FROM clientes WHERE pessoa_cpf_pessoa = $1 FOR UPDATE',
      [req.session.cpf_pessoa]
    );
    if (!cliente.rowCount) {
      await client.query('ROLLBACK');
      return res.status(403).json({ erro: 'A conta autenticada não possui cadastro de cliente.' });
    }
    const removido = await client.query(
      `DELETE FROM enderecos_clientes
       WHERE id_endereco = $1 AND cliente_pessoa_cpf_pessoa = $2
       RETURNING principal`,
      [id, req.session.cpf_pessoa]
    );
    if (!removido.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Endereço não encontrado.' });
    }
    if (removido.rows[0].principal) {
      await client.query(
        `UPDATE enderecos_clientes
         SET principal = TRUE
         WHERE id_endereco = (
           SELECT MIN(id_endereco)
           FROM enderecos_clientes
           WHERE cliente_pessoa_cpf_pessoa = $1
         )`,
        [req.session.cpf_pessoa]
      );
    }
    await client.query('COMMIT');
    return res.status(204).send();
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {
        console.error('Erro ao desfazer exclusão de endereço:', rollbackError.message);
      }
    }
    console.error('Erro ao excluir endereço:', error.message);
    return res.status(500).json({ erro: 'Não foi possível excluir o endereço.' });
  } finally {
    if (client) client.release();
  }
}

module.exports = {
  listarEnderecos,
  criarEndereco,
  atualizarEndereco,
  excluirEndereco
};
