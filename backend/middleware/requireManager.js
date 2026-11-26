const db = require('../database');

async function verificarFuncionario(req, res, next, somenteGerente) {
  const cpf = req.session && req.session.cpf_pessoa;
  if (!cpf) {
    return res.status(401).json({ erro: 'Login necessário.' });
  }

  try {
    const resultado = await db.query(
      `SELECT EXISTS (
         SELECT 1
         FROM funcionarios f
         JOIN cargos c ON c.id_cargo = f.cargo_id_cargo
         WHERE f.pessoa_cpf_pessoa = $1
           AND LOWER(TRIM(c.nome_cargo)) = 'gerente'
       ) AS is_manager, EXISTS (SELECT 1 FROM funcionarios WHERE pessoa_cpf_pessoa = $1) AS is_employee`,
      [cpf]
    );

    const perfil = resultado.rows[0];
    if (!perfil.is_manager && (somenteGerente || !perfil.is_employee)) {
      return res.status(403).json({
        erro: somenteGerente ? 'Acesso permitido somente para gerente.' : 'Acesso permitido somente para funcionários.'
      });
    }

    req.gerente = perfil.is_manager;
    return next();
  } catch (error) {
    console.error('Erro ao verificar permissão de gerente:', error.message);
    return res.status(500).json({
      erro: 'Não foi possível verificar a permissão de gerente.'
    });
  }
}

module.exports = (req, res, next) => verificarFuncionario(req, res, next, true);
module.exports.requireOrderStaff = (req, res, next) => verificarFuncionario(req, res, next, false);
