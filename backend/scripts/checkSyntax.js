const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const DIRETORIOS = ['backend', 'gerente', 'usuarios'];
const arquivos = [];

function coletarJavaScript(diretorio) {
  for (const item of fs.readdirSync(diretorio, { withFileTypes: true })) {
    const caminho = path.join(diretorio, item.name);
    if (item.isDirectory()) {
      if (item.name !== 'node_modules') coletarJavaScript(caminho);
    } else if (item.isFile() && item.name.endsWith('.js')) {
      arquivos.push(caminho);
    }
  }
}

for (const diretorio of DIRETORIOS) {
  const caminho = path.join(ROOT, diretorio);
  if (fs.existsSync(caminho)) coletarJavaScript(caminho);
}

const falhas = [];
for (const arquivo of arquivos) {
  const resultado = spawnSync(process.execPath, ['--check', arquivo], { encoding: 'utf8' });
  if (resultado.status !== 0) {
    falhas.push({ arquivo: path.relative(ROOT, arquivo), mensagem: resultado.stderr || resultado.stdout });
  }
}

if (falhas.length) {
  for (const falha of falhas) {
    process.stderr.write(`\n${falha.arquivo}\n${falha.mensagem}`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`Sintaxe JavaScript válida em ${arquivos.length} arquivos.\n`);
}
