(() => {
  const temas = new Set(['padrao','azul-laranja','preto-vermelho','preto-amarelo']);
  function aplicar(tema) {
    document.documentElement.dataset.tema = temas.has(tema) ? tema : 'padrao';
  }
  window.BookShopTema = { aplicar };
  fetch('/perfil/tema', { credentials:'same-origin' })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) aplicar(d.tema); })
    .catch(() => {});
})();
