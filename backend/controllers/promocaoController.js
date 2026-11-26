const db = require('../database');

async function bookfriday(req, res) {
  const { inicio, termino, ativa } = req.body || {};
  const dataValida = data => data == null || (typeof data === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data) &&
    Number.isFinite(Date.parse(data)) && new Date(data).toISOString() === data);
  const salvar = req.method === 'PUT';
  if (salvar && (typeof ativa !== 'boolean' || !dataValida(inicio) || !dataValida(termino) ||
      (ativa && (!inicio || !termino)) || (inicio && termino && Date.parse(termino) <= Date.parse(inicio)))) {
    return res.status(400).json({ erro: 'Informe início e término válidos antes de ativar a campanha.' });
  }
  try {
    const { rows } = salvar
      ? await db.query("UPDATE promocoes SET inicio = $1, termino = $2, ativa = $3 WHERE codigo = 'bookfriday' RETURNING inicio, termino, ativa", [inicio, termino, ativa])
      : await db.query("SELECT inicio, termino, ativa FROM promocoes WHERE codigo = 'bookfriday'");
    if (!rows[0]) return res.status(404).json({ erro: 'Campanha BookFriday não encontrada.' });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ erro: 'Não foi possível acessar a configuração da campanha.' });
  }
}

module.exports = { bookfriday };
