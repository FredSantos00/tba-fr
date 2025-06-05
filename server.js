const express = require('express');
const path = require('path');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');

const app = express();

// Middleware
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
  secret: 'segredo-super-seguro',
  resave: false,
  saveUninitialized: false
}));

// Base de dados
const db = new sqlite3.Database('./encomendas.db');

// Criar tabela encomendas
db.run(`
  CREATE TABLE IF NOT EXISTS encomendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT,
    nome TEXT,
    telemovel TEXT,
    produto TEXT,
    quantidade TEXT,
    data TEXT,
    estado TEXT
  )
`);

// Criar tabela encomendas finalizadas
db.run(`
  CREATE TABLE IF NOT EXISTS encomendas_finalizadas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT UNIQUE,
    nome TEXT,
    telemovel TEXT,
    produto TEXT,
    quantidade TEXT,
    data TEXT,
    dataFinalizacao TEXT,
    valorAngariado REAL
  )
`);

// Função para gerar número de encomenda
function gerarNumero(callback) {
  const agora = new Date();
  const aa = agora.getFullYear().toString().slice(-2);
  const mm = String(agora.getMonth() + 1).padStart(2, '0');
  const prefixo = `${aa}${mm}`;

  const query = `
    SELECT numero FROM encomendas WHERE numero LIKE '${prefixo}%'
    UNION
    SELECT numero FROM encomendas_finalizadas WHERE numero LIKE '${prefixo}%'
    ORDER BY numero DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) return callback(null);

    let seq = 1;
    if (rows.length > 0) {
      const ultimo = rows[0].numero;
      seq = parseInt(ultimo.slice(4)) + 1;
    }

    const numero = `${prefixo}${String(seq).padStart(3, '0')}`;
    callback(numero);
  });
}

// Adicionar nova encomenda
app.post('/adicionar-encomenda', (req, res) => {
  const { nome, telemovel, produto, quantidade, data } = req.body;

  gerarNumero((numero) => {
    if (!numero) return res.status(500).send('Erro a gerar número');

    db.run(
      `INSERT INTO encomendas (numero, nome, telemovel, produto, quantidade, data, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [numero, nome, telemovel, produto, quantidade, data, 'ativa'],
      function (err) {
        if (err) {
          console.error(err);
          return res.status(500).send('Erro ao inserir encomenda');
        }
        res.status(200).send('Encomenda adicionada com sucesso');
      }
    );
  });
});

// Obter todas as encomendas (ativas e finalizadas)
app.get('/api/encomendas', (req, res) => {
  db.all("SELECT * FROM encomendas ORDER BY data DESC, numero DESC", (err1, ativas) => {
    if (err1) return res.status(500).send("Erro ao obter encomendas ativas");

    db.all("SELECT * FROM encomendas_finalizadas ORDER BY dataFinalizacao DESC, numero DESC", (err2, finalizadas) => {
      if (err2) return res.status(500).send("Erro ao obter encomendas finalizadas");

      // Marcar encomendas finalizadas com flag para frontend distinguir
      const encomendas = [
        ...ativas.map(e => ({ ...e, finalizada: false })),
        ...finalizadas.map(e => ({ ...e, finalizada: true }))
      ];

      res.json(encomendas);
    });
  });
});

// Finalizar encomenda
app.post('/finalizar-encomenda/:numero', (req, res) => {
  const numero = req.params.numero;
  const { valorAngariado, dataFinalizacao } = req.body;

  db.get("SELECT * FROM encomendas WHERE numero = ?", [numero], (err, row) => {
    if (err || !row) {
      return res.status(404).send("Encomenda não encontrada");
    }

    // Copiar para tabela encomendas_finalizadas
    db.run(`
      INSERT INTO encomendas_finalizadas (numero, nome, telemovel, produto, quantidade, data, dataFinalizacao, valorAngariado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [row.numero, row.nome, row.telemovel, row.produto, row.quantidade, row.data, dataFinalizacao, valorAngariado],
    function (err2) {
      if (err2) {
        console.error(err2);
        return res.status(500).send("Erro ao copiar para finalizadas");
      }

      // Apagar da tabela original
      db.run("DELETE FROM encomendas WHERE numero = ?", [numero], function (err3) {
        if (err3) return res.status(500).send("Erro ao apagar encomenda original");
        res.sendStatus(200);
      });
    });
  });
});

// Apagar encomenda ativa
app.post('/apagar-encomenda', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).send('ID da encomenda obrigatório');

  db.run(`DELETE FROM encomendas WHERE id = ?`, [id], function (err) {
    if (err) {
      console.error(err);
      return res.status(500).send('Erro ao apagar encomenda');
    }
    res.status(200).send('Encomenda apagada com sucesso');
  });
});

// Apagar encomenda finalizada
app.post('/apagar-encomenda-finalizada', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).send('ID da encomenda finalizada obrigatório');

  db.run(`DELETE FROM encomendas_finalizadas WHERE id = ?`, [id], function (err) {
    if (err) {
      console.error(err);
      return res.status(500).send('Erro ao apagar encomenda finalizada');
    }
    res.status(200).send('Encomenda finalizada apagada com sucesso');
  });
});

// Login e proteção
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/verificar-codigo', (req, res) => {
  const { codigo } = req.body;
  if (codigo === '2222') {
    req.session.autenticado = true;
    res.redirect('/home.html');
  } else {
    res.redirect('/?erro=1');
  }
});

function protegerPagina(req, res, next) {
  if (req.session.autenticado) {
    next();
  } else {
    res.redirect('/');
  }
}

app.get('/home.html', protegerPagina, (req, res) => {
  res.sendFile(path.join(__dirname, 'privado', 'home.html'));
});

app.get('/encomendas.html', protegerPagina, (req, res) => {
  res.sendFile(path.join(__dirname, 'privado', 'encomendas.html'));
});

app.get('/verenc.html', protegerPagina, (req, res) => {
  res.sendFile(path.join(__dirname, 'privado', 'verenc.html'));
});

// Arranque do servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Servidor ativo na porta ' + PORT);
});
