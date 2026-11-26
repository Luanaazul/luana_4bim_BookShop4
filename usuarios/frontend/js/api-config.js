(function configurarApiBookShop() {
  const portaBackend = window.BOOKSHOP_API_PORT || '3000';
  const estaNoLiveServer = /^55\d{2}$/.test(window.location.port)
    && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

  window.BOOKSHOP_API_BASE_URL = estaNoLiveServer
    ? `${window.location.protocol}//${window.location.hostname}:${portaBackend}`
    : window.location.origin;

  if (estaNoLiveServer) {
    document.querySelectorAll('a[href^="/"]').forEach((link) => {
      link.href = new URL(link.getAttribute('href'), window.BOOKSHOP_API_BASE_URL).href;
    });
  }
})();
