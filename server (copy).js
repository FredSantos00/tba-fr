const express = require('express');
const path = require('path');
const session = require('express-session');

const bodyParser = require('body-parser');

const app = express();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://sidgczdpjjfqwhyyxblc.supabase.co'; // substitui pelo teu URL
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpZGdjemRwampmcXdoeXl4YmxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxNTk5ODEsImV4cCI6MjA2NDczNTk4MX0.maYLaaQ4ptbQa1SeVPOOE7bAPnQYJHXDfn-3rNUjRfE'; // substitui pela tua anon key
const supabase = createClient(supabaseUrl, supabaseKey);
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
// Criar tabela de saídas
db.run(`CREATE TABLE IF NOT EXISTS saidas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto TEXT,
  fornecedor TEXT,
  valor REAL,
  data TEXT
)`);


// Criar a tabela se não existir
db.run(`
  CREATE TABLE IF NOT EXISTS entradas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    descricao TEXT,
    data TEXT,
    valor REAL
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

    // ➕ Inserir também na tabela 'entradas'
    const descricao = `${row.nome} encomendou ${row.quantidade} de ${row.produto}`;
    const dataEntrada = dataFinalizacao.split(" ")[0]; // Apenas a data, sem horas

    db.run(`
      INSERT INTO entradas (descricao, data, valor)
      VALUES (?, ?, ?)
    `, [descricao, dataEntrada, valorAngariado], function (err4) {
      if (err4) {
        console.error(err4);
        return res.status(500).send("Erro ao adicionar entrada");
      }

      // ✅ Apagar da tabela original
      db.run("DELETE FROM encomendas WHERE numero = ?", [numero], function (err3) {
        if (err3) return res.status(500).send("Erro ao apagar encomenda original");
        res.sendStatus(200);
      });
    });
  });
     });
});

// Apagar encomenda (ativa ou finalizada) por número
app.post('/apagar-encomenda', (req, res) => {
  const { numero } = req.body;
  if (!numero) return res.status(400).send('Número da encomenda obrigatório');

  // Primeiro tenta apagar da tabela de encomendas ativas
  db.run(`DELETE FROM encomendas WHERE numero = ?`, [numero], function (err) {
    if (err) {
      console.error('Erro ao apagar da tabela encomendas:', err);
      return res.status(500).send('Erro ao apagar encomenda');
    }

    if (this.changes > 0) {
      return res.status(200).send('Encomenda ativa apagada com sucesso');
    }

    // Se não encontrou na tabela encomendas, tenta nas finalizadas
    db.run(`DELETE FROM encomendas_finalizadas WHERE numero = ?`, [numero], function (err2) {
      if (err2) {
        console.error('Erro ao apagar da tabela encomendas_finalizadas:', err2);
        return res.status(500).send('Erro ao apagar encomenda finalizada');
      }

      if (this.changes > 0) {
        return res.status(200).send('Encomenda finalizada apagada com sucesso');
      } else {
        return res.status(404).send('Encomenda não encontrada');
      }
    });
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

app.get('/saidas.html', protegerPagina, (req, res) => {
  res.sendFile(path.join(__dirname, 'privado', 'saidas.html'));
});

app.get('/entradas.html', protegerPagina, (req, res) => {
  res.sendFile(path.join(__dirname, 'privado', 'entradas.html'));
});


app.get("/saidas", (req, res) => {
  db.all("SELECT * FROM saidas", (err, rows) => {
    if (err) {
      res.status(500).json({ erro: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.post("/saidas", (req, res) => {
  const { produto, fornecedor, valor, data } = req.body;
  if (!produto || !fornecedor || !valor || !data) {
    return res.status(400).json({ erro: "Campos em falta" });
  }

  const sql = `INSERT INTO saidas (produto, fornecedor, valor, data) VALUES (?, ?, ?, ?)`;
  db.run(sql, [produto, fornecedor, valor, data], function(err) {
    if (err) {
      res.status(500).json({ erro: err.message });
    } else {
      res.status(200).json({ id: this.lastID });
    }
  });
});

app.delete("/saidas/:id", (req, res) => {
  const id = req.params.id;
  db.run("DELETE FROM saidas WHERE id = ?", id, function(err) {
    if (err) {
      res.status(500).json({ erro: err.message });
    } else {
      res.status(200).json({ mensagem: "Compra eliminada" });
    }
  });
});

function mesParaNumero(mes) {
  const meses = {
    'janeiro': '01', 'fevereiro': '02', 'março': '03',
    'abril': '04', 'maio': '05', 'junho': '06',
    'julho': '07', 'agosto': '08', 'setembro': '09',
    'outubro': '10', 'novembro': '11', 'dezembro': '12'
  };
  return meses[mes.toLowerCase()] || '01';
}





// Inserir nova entrada
app.post('/entradas', (req, res) => {
  const { descricao, data, valor } = req.body;
  db.run(
    `INSERT INTO entradas (descricao, data, valor) VALUES (?, ?, ?)`,
    [descricao, data, valor],
    (err) => {
      if (err) return res.status(500).json({ erro: err.message });
      res.json({ sucesso: true });
    }
  );
});

// Obter todas as entradas agrupadas por mês
app.get('/entradas', (req, res) => {
  db.all(`SELECT * FROM entradas ORDER BY data DESC`, (err, rows) => {
    if (err) return res.status(500).json({ erro: err.message });

    const agrupado = {};
    for (const row of rows) {
      const [ano, mes] = row.data.split('-');
      const chave = `${mesNome(mes)} de ${ano}`;

      if (!agrupado[chave]) agrupado[chave] = { entradas: [], total: 0 };

      agrupado[chave].entradas.push(row);
      agrupado[chave].total += row.valor;
    }

    res.json(agrupado);
  });
});

function mesNome(m) {
  const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  return meses[parseInt(m) - 1];
}

// Apagar uma entrada
app.delete('/entradas/:id', (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM entradas WHERE id = ?`, [id], function (err) {
    if (err) return res.status(500).json({ erro: err.message });
    res.json({ sucesso: true });
  });
});

app.put('/entradas/:id', (req, res) => {
  const id = req.params.id;
  const { descricao, data, valor } = req.body;

  db.run(
    `UPDATE entradas SET descricao = ?, data = ?, valor = ? WHERE id = ?`,
    [descricao, data, valor, id],
    function (err) {
      if (err) return res.status(500).send("Erro ao atualizar entrada.");
      res.sendStatus(200);
    }
  );
});


// Arranque do servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Servidor ativo na porta ' + PORT);
});
