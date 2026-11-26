-- Modelo principal para o plano gratuito do DrawSQL.
-- Estrutura PostgreSQL, sem registros cadastrados.

CREATE TABLE cargos (
  id_cargo integer NOT NULL,
  nome_cargo varchar(100) NOT NULL,
  CONSTRAINT cargos_pkey PRIMARY KEY (id_cargo),
  CONSTRAINT cargos_nome_cargo_key UNIQUE (nome_cargo)
);

CREATE TABLE formas_pagamento (
  id_forma_pagamento integer NOT NULL,
  nome_forma_pagamento varchar(100) NOT NULL,
  ativa boolean NOT NULL,
  CONSTRAINT formas_pagamento_pkey PRIMARY KEY (id_forma_pagamento),
  CONSTRAINT formas_pagamento_nome_forma_pagamento_key UNIQUE (nome_forma_pagamento)
);

CREATE TABLE generos (
  id_genero integer NOT NULL,
  nome_genero varchar(50) NOT NULL,
  CONSTRAINT generos_pkey PRIMARY KEY (id_genero),
  CONSTRAINT generos_nome_genero_key UNIQUE (nome_genero)
);

CREATE TABLE livros (
  id_livro integer NOT NULL,
  titulo varchar(200) NOT NULL,
  autor varchar(150) NOT NULL,
  isbn varchar(20),
  editora varchar(100),
  paginas integer NOT NULL,
  ano integer,
  sinopse text,
  preco numeric(10,2) NOT NULL,
  estoque integer NOT NULL,
  genero_id integer NOT NULL,
  caminho_imagem_livro varchar(255),
  ordem_cadastro bigint NOT NULL,
  CONSTRAINT livros_pkey PRIMARY KEY (id_livro),
  CONSTRAINT livros_isbn_key UNIQUE (isbn),
  CONSTRAINT livros_genero_id_fkey FOREIGN KEY (genero_id) REFERENCES generos(id_genero) ON DELETE RESTRICT
);

CREATE TABLE lancamentos (
  id_lancamento integer NOT NULL,
  livro_id_livro integer NOT NULL,
  pais_lancamento varchar(100) NOT NULL,
  data_lancamento date NOT NULL,
  CONSTRAINT lancamentos_pkey PRIMARY KEY (id_lancamento),
  CONSTRAINT lancamentos_livro_id_livro_key UNIQUE (livro_id_livro),
  CONSTRAINT lancamentos_livro_id_livro_fkey FOREIGN KEY (livro_id_livro) REFERENCES livros(id_livro) ON DELETE CASCADE
);

CREATE TABLE pessoas (
  cpf_pessoa varchar(14) NOT NULL,
  nome_pessoa varchar(100) NOT NULL,
  data_nascimento_pessoa date NOT NULL,
  endereco_pessoa varchar(200),
  nome_usuario_pessoa varchar(50) NOT NULL,
  email_pessoa varchar(150) NOT NULL,
  senha_pessoa varchar(255) NOT NULL,
  tema varchar(20) NOT NULL,
  foto_perfil bytea,
  CONSTRAINT pessoas_pkey PRIMARY KEY (cpf_pessoa)
);

CREATE TABLE clientes (
  pessoa_cpf_pessoa varchar(14) NOT NULL,
  renda_cliente numeric(10,2) NOT NULL,
  data_cadastro_cliente date NOT NULL,
  CONSTRAINT clientes_pkey PRIMARY KEY (pessoa_cpf_pessoa),
  CONSTRAINT clientes_pessoa_cpf_pessoa_fkey FOREIGN KEY (pessoa_cpf_pessoa) REFERENCES pessoas(cpf_pessoa) ON DELETE RESTRICT
);

CREATE TABLE enderecos_clientes (
  id_endereco bigint NOT NULL,
  cliente_pessoa_cpf_pessoa varchar(14) NOT NULL,
  cep varchar(9) NOT NULL,
  rua varchar(200) NOT NULL,
  numero varchar(30) NOT NULL,
  complemento varchar(100),
  bairro varchar(100) NOT NULL,
  cidade varchar(100) NOT NULL,
  estado varchar(2) NOT NULL,
  principal boolean NOT NULL,
  data_criacao timestamptz NOT NULL,
  CONSTRAINT enderecos_clientes_pkey1 PRIMARY KEY (id_endereco),
  CONSTRAINT enderecos_clientes_cliente_pessoa_cpf_pessoa_fkey1 FOREIGN KEY (cliente_pessoa_cpf_pessoa) REFERENCES clientes(pessoa_cpf_pessoa) ON DELETE CASCADE
);

CREATE TABLE funcionarios (
  pessoa_cpf_pessoa varchar(14) NOT NULL,
  salario_funcionario numeric(10,2) NOT NULL,
  cargo_id_cargo integer NOT NULL,
  porcentagem_comissao_funcionario numeric(5,2) NOT NULL,
  CONSTRAINT funcionarios_pkey PRIMARY KEY (pessoa_cpf_pessoa),
  CONSTRAINT funcionarios_cargo_id_cargo_fkey FOREIGN KEY (cargo_id_cargo) REFERENCES cargos(id_cargo) ON DELETE RESTRICT,
  CONSTRAINT funcionarios_pessoa_cpf_pessoa_fkey FOREIGN KEY (pessoa_cpf_pessoa) REFERENCES pessoas(cpf_pessoa) ON DELETE RESTRICT
);

CREATE TABLE pedidos (
  id_pedido integer NOT NULL,
  data_pedido date NOT NULL,
  cliente_pessoa_cpf_pessoa varchar(14),
  status_pedido varchar(30) NOT NULL,
  data_prevista_entrega date,
  total_pedido numeric(12,2) NOT NULL,
  subtotal_pedido numeric(12,2),
  desconto_pedido numeric(12,2),
  frete_pedido numeric(12,2),
  endereco_entrega_cep varchar(9),
  endereco_entrega_rua varchar(200),
  endereco_entrega_numero varchar(30),
  endereco_entrega_complemento varchar(100),
  endereco_entrega_bairro varchar(100),
  endereco_entrega_cidade varchar(100),
  endereco_entrega_estado varchar(2),
  endereco_entrega_id bigint,
  cliente_fisico boolean NOT NULL,
  detalhes_pedido text,
  atraso_manual boolean NOT NULL,
  enviado_em timestamptz,
  nome_cliente_presencial varchar(150),
  telefone_cliente_presencial varchar(30),
  ocultar_cancelado_cliente boolean NOT NULL,
  desconto_registro jsonb,
  primeira_compra_utilizada boolean NOT NULL,
  CONSTRAINT pedidos_pkey PRIMARY KEY (id_pedido),
  CONSTRAINT pedidos_cliente_pessoa_cpf_pessoa_fkey FOREIGN KEY (cliente_pessoa_cpf_pessoa) REFERENCES clientes(pessoa_cpf_pessoa),
  CONSTRAINT pedidos_endereco_entrega_id_fkey FOREIGN KEY (endereco_entrega_id) REFERENCES enderecos_clientes(id_endereco) ON DELETE SET NULL
);

CREATE TABLE pagamentos (
  pedido_id_pedido integer NOT NULL,
  data_pagamento timestamp without time zone NOT NULL,
  valor_total_pagamento numeric(12,2) NOT NULL,
  status_pagamento varchar(30) NOT NULL,
  forma_pagamento_id_forma_pagamento integer NOT NULL,
  tentativa_id uuid,
  pix_qr_code text,
  pix_qr_code_base64 text,
  CONSTRAINT pagamentos_pkey PRIMARY KEY (pedido_id_pedido),
  CONSTRAINT pagamentos_forma_pagamento_id_forma_pagamento_fkey FOREIGN KEY (forma_pagamento_id_forma_pagamento) REFERENCES formas_pagamento(id_forma_pagamento),
  CONSTRAINT pagamentos_pedido_id_pedido_fkey FOREIGN KEY (pedido_id_pedido) REFERENCES pedidos(id_pedido) ON DELETE CASCADE
);

CREATE TABLE pedido_eventos (
  id bigint NOT NULL,
  pedido_id integer NOT NULL,
  autor_cpf varchar(14),
  estado varchar(30) NOT NULL,
  criado_em timestamptz NOT NULL,
  percentual smallint,
  reembolso numeric(12,2),
  situacao varchar(12),
  estoque_reposto boolean NOT NULL,
  processado_em timestamptz,
  estado_anterior varchar(40),
  motivo text,
  historico_legado_id bigint,
  CONSTRAINT pedido_eventos_pkey PRIMARY KEY (id),
  CONSTRAINT pedido_eventos_historico_legado_id_key UNIQUE (historico_legado_id),
  CONSTRAINT pedido_eventos_autor_cpf_fkey FOREIGN KEY (autor_cpf) REFERENCES pessoas(cpf_pessoa) ON DELETE SET NULL,
  CONSTRAINT pedido_eventos_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id_pedido)
);

CREATE TABLE pedido_has_livro (
  livro_id_livro integer NOT NULL,
  pedido_id_pedido integer NOT NULL,
  quantidade integer NOT NULL,
  preco_unitario numeric(10,2) NOT NULL,
  titulo_livro varchar(200),
  caminho_imagem_livro varchar(255),
  total_item numeric(12,2),
  CONSTRAINT pedido_has_livro_pkey PRIMARY KEY (livro_id_livro, pedido_id_pedido),
  CONSTRAINT pedido_has_livro_livro_id_livro_fkey FOREIGN KEY (livro_id_livro) REFERENCES livros(id_livro),
  CONSTRAINT pedido_has_livro_pedido_id_pedido_fkey FOREIGN KEY (pedido_id_pedido) REFERENCES pedidos(id_pedido) ON DELETE CASCADE
);

CREATE TABLE promocoes (
  codigo varchar(50) NOT NULL,
  nome varchar(120) NOT NULL,
  descricao text,
  percentual smallint NOT NULL,
  inicio timestamptz,
  termino timestamptz,
  ativa boolean NOT NULL,
  tipo varchar(60) NOT NULL,
  criterios jsonb NOT NULL,
  combinacao varchar(2) NOT NULL,
  combinavel boolean NOT NULL,
  id_exibicao integer NOT NULL,
  CONSTRAINT promocoes_pkey PRIMARY KEY (codigo)
);

CREATE TABLE solicitacoes_cancelamento (
  pedido_id integer NOT NULL,
  motivo text,
  criado_em timestamptz NOT NULL,
  estado varchar(12) NOT NULL,
  resposta text,
  analisado_em timestamptz,
  anexo bytea,
  tipo_anexo varchar(20),
  CONSTRAINT solicitacoes_cancelamento_pkey PRIMARY KEY (pedido_id),
  CONSTRAINT solicitacoes_cancelamento_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id_pedido)
);
