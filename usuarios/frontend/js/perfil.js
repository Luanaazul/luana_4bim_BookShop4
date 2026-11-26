const statusPerfil = document.getElementById('perfil-status');
const temaForm = document.getElementById('perfil-tema');
const fotoForm = document.getElementById('perfil-foto');
const remover = document.getElementById('remover-foto');

async function perfilAPI(path = '', options) {
  const r = await fetch('/perfil' + path, options);
  if (r.status === 401) {
    location.assign('/login/login.html?next=%2Fperfil.html');
    throw Error('Entre para acessar o perfil.');
  }
  if (r.status === 204) return null;
  const dados = await r.json();
  if (!r.ok) throw Error(dados.erro);
  return dados;
}

function mostrarFoto(temFoto) {
  document.getElementById('avatar').src = temFoto ? '/perfil/foto?v=' + Date.now() : '/imagens/logoGato.jpeg';
  remover.hidden = !temFoto;
}

perfilAPI().then(p => {
  document.getElementById('perfil-nome').textContent = p.nome;
  document.getElementById('perfil-usuario').textContent = '@' + p.usuario;
  document.getElementById('perfil-livros').textContent = p.livros;
  document.getElementById('perfil-total').textContent = Number(p.total).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  temaForm.elements.tema.value = p.tema;
  BookShopTema.aplicar(p.tema);
  mostrarFoto(p.tem_foto);
}).catch(e => { statusPerfil.textContent = e.message; });

temaForm.elements.tema.onchange = () => BookShopTema.aplicar(temaForm.elements.tema.value);
temaForm.onsubmit = async e => {
  e.preventDefault();
  try {
    const p = await perfilAPI('/tema',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({tema:temaForm.elements.tema.value})});
    BookShopTema.aplicar(p.tema);
    statusPerfil.textContent = 'Tema salvo.';
  } catch (erro) { statusPerfil.textContent = erro.message; }
};

fotoForm.onsubmit = async e => {
  e.preventDefault();
  try {
    await perfilAPI('/foto',{method:'POST',body:new FormData(fotoForm)});
    fotoForm.reset();
    mostrarFoto(true);
    statusPerfil.textContent = 'Foto salva.';
  } catch (erro) { statusPerfil.textContent = erro.message; }
};

remover.onclick = async () => {
  try {
    await perfilAPI('/foto',{method:'DELETE'});
    mostrarFoto(false);
    statusPerfil.textContent = 'Foto removida.';
  } catch (erro) { statusPerfil.textContent = erro.message; }
};
