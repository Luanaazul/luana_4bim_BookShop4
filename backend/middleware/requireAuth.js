function requireAuth(req, res, next) {
  if (!req.session || !req.session.cpf_pessoa) {
    return res.status(401).json({
      erro: 'Login necessário!'
    });
  }

  return next();
}

module.exports = requireAuth;
