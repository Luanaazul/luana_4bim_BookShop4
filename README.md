# BookShop 4

**Livraria virtual · Desenvolvimento Web I · 4º bimestre**  
Luana Cazarin de Almeida · Turma M32 · 2026

O BookShop 4 simula a compra de livros, da escolha na vitrine até a entrega. O projeto reúne uma área para clientes e um painel para gerenciar o catálogo, o estoque, os pedidos e as campanhas promocionais.

## O que o sistema faz

| Área | Funcionalidades |
| --- | --- |
| **Cliente** | Vitrine com carrosséis por gênero e filtros de busca, carrinho, checkout com PIX e cartão simulados, acompanhamento de pedidos e perfil com foto e temas. |
| **Gerência** | Gestão de livros, lançamentos, cargos e vínculos de funcionários, cadastro de pedidos presenciais, atualização de status e previsão de entrega e análise de solicitações de cancelamento. |
| **Descontos** | Benefício de 50% na primeira compra elegível e campanhas configuráveis por livro, autor, gênero, editora, preço e período. |

O servidor confere preços e descontos. A confirmação do pedido atualiza o estoque em uma transação PostgreSQL, e o histórico preserva os valores da compra. Pagamentos e reembolsos são simulados.

## Tecnologias

**HTML, CSS e JavaScript** nas interfaces · **Node.js e Express** no servidor · **PostgreSQL** no banco de dados. O acesso usa sessões com cookies assinados e senhas protegidas com bcrypt.

## Como executar

1. Com **Node.js 22+**, npm e PostgreSQL instalados, execute `npm ci --include=optional` na pasta do projeto.
2. Crie um banco PostgreSQL vazio chamado `BookShop4` e execute o [SQL de instalação](documentacao/instalar_bookshop4.sql) pelo pgAdmin. Ele cria as tabelas e carrega os dados fictícios.
3. Crie um arquivo `.env` na raiz com as configurações abaixo. Preencha a senha do PostgreSQL e gere a chave de sessão com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

   ```dotenv
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=BookShop4
   DB_USER=postgres
   DB_PASSWORD=
   SESSION_SECRET=
   ```
4. Execute `npm start` e abra a [vitrine](http://localhost:3000/vitrine/index.html) ou a [página de login](http://localhost:3000/login/login.html).

| Conta de demonstração | Usuário | Senha |
| --- | --- | --- |
| Cliente | `cliente.demo` | `BookShop123!` |
| Gerente | `gerente.demo` | `BookShop123!` |

## Banco de dados e testes

Consulte o [guia do banco](documentacao/relacoes.md) e o [modelo de 15 tabelas para o DrawSQL](documentacao/bookshop4_drawsql_principal.sql).

`npm test` executa os testes automatizados. `npm run check` verifica a sintaxe JavaScript. Para testar a instalação e os fluxos principais em um banco separado, execute `node backend/scripts/validarInstalacao.js` com um usuário PostgreSQL que tenha permissão `CREATEDB`.
