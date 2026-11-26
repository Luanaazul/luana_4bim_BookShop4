const { randomUUID } = require('node:crypto');
const db = require('../database');
const { livrosAtingidos, catalogoPromocoes, precoPromocional, descontosDisponiveis } = require('../utils/descontos');

const CAMPOS = `codigo, id_exibicao, nome, descricao, tipo, percentual, inicio, termino, ativa, criterios, combinacao, combinavel,
  CASE WHEN NOT ativa THEN 'Inativo' WHEN inicio > statement_timestamp() THEN 'Programado'
    WHEN termino <= statement_timestamp() THEN 'Expirado' ELSE 'Ativo' END AS situacao`;

function validarRegras(dados, catalogo, generos) {
  const c = dados.criterios;
  if (!c || typeof c !== 'object' || Array.isArray(c) || !['E','OU'].includes(dados.combinacao)) {
    throw new Error('Informe como os critérios serão combinados.');
  }
  const chaves = ['generos','autores','editoras','livros','minimo','maximo','minimo_exclusivo','maximo_exclusivo'];
  if (Object.keys(c).some(x => !chaves.includes(x))) throw new Error('Critério desconhecido.');
  const criterios = {};
  for (const [campo, coluna] of Object.entries({ generos:'genero_id', autores:'autor', editoras:'editora', livros:'id_livro' })) {
    const valores = c[campo];
    if (valores === undefined) continue;
    const permitidos = new Set(campo === 'generos' ? generos : catalogo.map(l => l[coluna]).filter(v => v != null));
    if (!Array.isArray(valores) || valores.some(v => !permitidos.has(v))) throw new Error('Selecione somente opções do catálogo.');
    if (valores.length) criterios[campo] = [...new Set(valores)];
  }
  for (const campo of ['minimo','maximo']) {
    const valor = c[campo];
    if (valor == null) continue;
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || valor > 99999999.99 || !/^\d+(\.\d{1,2})?$/.test(String(valor))) {
      throw new Error('Informe preços válidos com até duas casas decimais.');
    }
    if (c[campo + '_exclusivo'] !== undefined && typeof c[campo + '_exclusivo'] !== 'boolean') throw new Error('Operador de preço inválido.');
    criterios[campo] = valor;
    criterios[campo + '_exclusivo'] = Boolean(c[campo + '_exclusivo']);
  }
  if (criterios.minimo != null && criterios.maximo != null && criterios.minimo > criterios.maximo) throw new Error('A faixa de preço está invertida.');
  if (!Object.keys(criterios).length && dados.todos !== true) throw new Error('Escolha critérios ou marque Todo o catálogo.');
  return criterios;
}

function previaLivros(campanha, catalogo) {
  return livrosAtingidos(campanha, catalogo).map(l => ({
    ...l, preco_promocional: precoPromocional(Math.round(Number(l.preco) * 100), campanha.percentual) / 100
  }));
}

function dataISO(v) {
  return typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
    Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
}

async function catalogo(req,res) {
  res.json(await catalogoPromocoes(db));
}
async function opcoesRegras() {
  const [livros, resultado] = await Promise.all([catalogoPromocoes(db), db.query('SELECT id_genero FROM generos')]);
  return { livros, generos: resultado.rows.map(g => g.id_genero) };
}

async function previa(req,res) {
  const { livros, generos } = await opcoesRegras();
  try {
    const dados = req.body || {};
    if (!Number.isInteger(dados.percentual) || dados.percentual < 1 || dados.percentual > 100) throw new Error('Informe um percentual entre 1 e 100.');
    const criterios = validarRegras(dados, livros, generos);
    res.json(previaLivros({ ...dados, criterios }, livros));
  } catch (e) { res.status(400).json({ erro:e.message }); }
}

async function listar(req,res) {
  const [resultado, livros] = await Promise.all([db.query('SELECT ' + CAMPOS + ' FROM promocoes ORDER BY nome, codigo'), catalogoPromocoes(db)]);
  const nome = String(req.query.nome || '').trim().toLocaleLowerCase('pt-BR');
  const situacao = req.query.situacao;
  res.json(resultado.rows
    .filter(p => (!situacao || p.situacao === situacao) && p.nome.toLocaleLowerCase('pt-BR').includes(nome))
    .map(p => ({ ...p, livros_atingidos: livrosAtingidos(p, livros).length })));
}

async function obter(req,res) {
  const {rows:[p]} = await db.query('SELECT ' + CAMPOS + ' FROM promocoes WHERE codigo = $1',[req.params.codigo]);
  if (!p) return res.status(404).json({ erro:'Campanha não encontrada.' });
  res.json({ ...p, livros: previaLivros(p, await catalogoPromocoes(db)) });
}

async function salvar(req,res) {
  const dados = req.body || {};
  const codigo = req.params.codigo || randomUUID();
  const nome = typeof dados.nome === 'string' ? dados.nome.trim() : '';
  const tipo = typeof dados.tipo === 'string' ? dados.tipo.trim() : '';
  const descricao = typeof dados.descricao === 'string' ? dados.descricao.trim() : '';
  const { inicio, termino, ativa, combinavel, combinacao, percentual, id_exibicao } = dados;
  if (id_exibicao != null && (!Number.isInteger(id_exibicao) || id_exibicao < 1 || id_exibicao > 2147483647)) {
    return res.status(400).json({ erro: 'Informe um ID inteiro positivo.' });
  }
  if (!nome || nome.length > 120 || !tipo || tipo.length > 60 || descricao.length > 3000 ||
      !Number.isInteger(percentual) || percentual < 1 || percentual > 100 ||
      typeof ativa !== 'boolean' || typeof combinavel !== 'boolean' || !dataISO(inicio) ||
      (termino != null && (!dataISO(termino) || termino <= inicio)) || (codigo === 'bookfriday' && ativa && !termino)) {
    return res.status(400).json({ erro:'Confira nome, tipo, percentual e período. BookFriday ativa precisa ter encerramento.' });
  }
  const { livros, generos } = await opcoesRegras();
  let criterios;
  try { criterios = validarRegras(dados, livros, generos); }
  catch (erro) { return res.status(400).json({ erro:erro.message }); }
  if (!livrosAtingidos({ criterios, combinacao }, livros).length) {
    return res.status(400).json({ erro:'Nenhum livro atende a estes critérios.' });
  }
  const valores = [codigo,nome,descricao,tipo,percentual,inicio,termino,ativa,criterios,combinacao,combinavel,id_exibicao ?? null];
  const { rows:[gravado] } = await db.query(req.params.codigo
    ? 'UPDATE promocoes SET nome=$2,descricao=$3,tipo=$4,percentual=$5,inicio=$6,termino=$7,ativa=$8,criterios=$9,combinacao=$10,combinavel=$11,id_exibicao=COALESCE($12,id_exibicao) WHERE codigo=$1 RETURNING ' + CAMPOS
    : 'INSERT INTO promocoes(codigo,nome,descricao,tipo,percentual,inicio,termino,ativa,criterios,combinacao,combinavel,id_exibicao) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,(SELECT COALESCE(MAX(id_exibicao),0)+1 FROM promocoes))) RETURNING ' + CAMPOS, valores);
  if (!gravado) return res.status(404).json({ erro:'Campanha não encontrada.' });
  res.status(req.params.codigo ? 200 : 201).json(gravado);
}

async function ativar(req,res) {
  if (typeof req.body?.ativa !== 'boolean') return res.status(400).json({ erro:'Informe se a campanha deve ficar ativa.' });
  const {rows:[p]} = await db.query('SELECT ' + CAMPOS + ' FROM promocoes WHERE codigo=$1', [req.params.codigo]);
  if (!p) return res.status(404).json({ erro:'Campanha não encontrada.' });
  if (req.body.ativa && (!p.inicio || (p.codigo === 'bookfriday' && !p.termino) ||
    !livrosAtingidos(p, await catalogoPromocoes(db)).length)) {
    return res.status(400).json({ erro:'Configure a validade e selecione livros antes de ativar.' });
  }
  const {rows:[atualizada]} = await db.query('UPDATE promocoes SET ativa=$2 WHERE codigo=$1 RETURNING ' + CAMPOS, [p.codigo,req.body.ativa]);
  if (!atualizada) return res.status(404).json({ erro:'Campanha não encontrada.' });
  res.json(atualizada);
}

async function excluir(req,res) {
  const {rowCount} = await db.query('DELETE FROM promocoes WHERE codigo=$1',[req.params.codigo]);
  if (!rowCount) return res.status(404).json({ erro:'Campanha não encontrada.' });
  res.status(204).end();
}

async function vitrine(req,res) {
  const livros = await catalogoPromocoes(db);
  const {promocoes} = await descontosDisponiveis(db,null,livros.map(l => l.id_livro));
  const resultado = Object.create(null);
  for (const {id_livro, preco} of livros) {
    const p = promocoes.find(p => p.livros.some(l => l.id_livro === id_livro));
    if (p) resultado[id_livro] = { nome:p.nome, percentual:p.percentual, preco_promocional:precoPromocional(Math.round(Number(preco)*100), p.percentual)/100 };
  }
  res.json(resultado);
}

module.exports = { catalogo, previa, listar, obter, salvar, ativar, excluir, vitrine };
