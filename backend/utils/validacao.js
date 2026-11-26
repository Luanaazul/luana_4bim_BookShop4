function senhaValida(senha) {
  return typeof senha === 'string' &&
    Buffer.byteLength(senha, 'utf8') >= 8 &&
    Buffer.byteLength(senha, 'utf8') <= 72;
}

function cpfValido(cpf) {
  if (typeof cpf !== 'string' ||
    !/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(cpf)) {
    return false;
  }

  const digitos = cpf.replace(/\D/g, '');
  if (/^(\d)\1{10}$/.test(digitos)) {
    return false;
  }

  function calcularDigito(tamanho) {
    let soma = 0;
    for (let indice = 0; indice < tamanho; indice += 1) {
      soma += Number(digitos[indice]) * (tamanho + 1 - indice);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  }

  return calcularDigito(9) === Number(digitos[9]) &&
    calcularDigito(10) === Number(digitos[10]);
}

function formatarCPF(cpf) {
  return cpf.replace(/\D/g, '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

function dataISOValida(data) {
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return false;
  }

  const dataConvertida = new Date(`${data}T00:00:00.000Z`);
  return !Number.isNaN(dataConvertida.getTime()) &&
    dataConvertida.toISOString().slice(0, 10) === data;
}

function numeroDecimalValido(valor, minimo, maximo) {
  if (typeof valor !== 'number' &&
    !(typeof valor === 'string' && valor.trim() !== '')) {
    return false;
  }
  const texto = String(valor).trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(texto)) return false;
  const numero = Number(texto);
  return Number.isFinite(numero) && numero >= minimo && numero <= maximo;
}

module.exports = {
  senhaValida,
  cpfValido,
  formatarCPF,
  dataISOValida,
  numeroDecimalValido
};
