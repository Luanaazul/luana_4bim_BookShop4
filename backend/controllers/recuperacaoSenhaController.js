const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../database');

function transportador() {
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch (_) { return null; }
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass }
  });
}

async function solicitar(req, res) {
  const email = typeof (req.body || {}).email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ erro: 'Informe um e-mail válido.' });
  }
  const mailer = transportador();
  if (!mailer) return res.status(503).json({ erro: 'Recuperação por e-mail ainda não configurada. Preencha SMTP_HOST, SMTP_PORT, SMTP_USER e SMTP_PASS no .env.' });
  try {
    const pessoa = await db.query('SELECT cpf_pessoa, email_pessoa FROM pessoas WHERE LOWER(email_pessoa) = $1', [email]);
    // Resposta genérica para não revelar se o e-mail existe.
    if (pessoa.rowCount) {
      const token = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      await db.query('DELETE FROM tokens_recuperacao_senha WHERE cpf_pessoa = $1', [pessoa.rows[0].cpf_pessoa]);
      await db.query(
        `INSERT INTO tokens_recuperacao_senha (cpf_pessoa, token_hash, expira_em)
         VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
        [pessoa.rows[0].cpf_pessoa, hash]
      );
      const base = process.env.APP_BASE_URL || 'http://localhost:3000';
      const link = `${base}/login/redefinir-senha.html?token=${token}`;
      await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: email,
        subject: 'Recuperação de senha - BookShop',
        text: `Para redefinir sua senha, acesse: ${link}
O link expira em 30 minutos. Se não solicitou, ignore esta mensagem.`
      });
    }
    return res.json({ sucesso: true, mensagem: 'Se o e-mail estiver cadastrado, enviaremos um link de recuperação.' });
  } catch (error) {
    console.error('Falha na recuperação de senha:', error.message);
    return res.status(500).json({ erro: 'Não foi possível enviar o e-mail de recuperação.' });
  }
}

async function redefinir(req, res) {
  const token = typeof (req.body || {}).token === 'string' ? req.body.token : '';
  const senha = typeof (req.body || {}).senha === 'string' ? req.body.senha : '';
  if (!/^[a-f0-9]{64}$/.test(token) || Buffer.byteLength(senha, 'utf8') < 8 || Buffer.byteLength(senha, 'utf8') > 72) {
    return res.status(400).json({ erro: 'Link inválido ou senha fora do limite de 8 a 72 bytes.' });
  }
  const hashToken = crypto.createHash('sha256').update(token).digest('hex');
  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT cpf_pessoa FROM tokens_recuperacao_senha
       WHERE token_hash = $1 AND expira_em > NOW() FOR UPDATE`, [hashToken]
    );
    if (!r.rowCount) { await client.query('ROLLBACK'); return res.status(400).json({ erro: 'Link expirado ou inválido. Solicite outro.' }); }
    const senhaHash = await bcrypt.hash(senha, 12);
    await client.query('UPDATE pessoas SET senha_pessoa = $1 WHERE cpf_pessoa = $2', [senhaHash, r.rows[0].cpf_pessoa]);
    await client.query('DELETE FROM tokens_recuperacao_senha WHERE cpf_pessoa = $1', [r.rows[0].cpf_pessoa]);
    await client.query('COMMIT');
    return res.json({ sucesso: true, mensagem: 'Senha redefinida. Faça login com a nova senha.' });
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    console.error('Falha ao redefinir senha:', error.message);
    return res.status(500).json({ erro: 'Não foi possível redefinir a senha.' });
  } finally { client?.release(); }
}
module.exports = { solicitar, redefinir };
