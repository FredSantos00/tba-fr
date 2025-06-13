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



// Função para gerar número de encomenda
async function gerarNumero() {
  const agora = new Date();
  const aa = agora.getFullYear().toString().slice(-2);
  const mm = String(agora.getMonth() + 1).padStart(2, '0');
  const prefixo = `${aa}${mm}`;

  const { data: encomendas1 } = await supabase
    .from('encomendas')
    .select('numero')
    .like('numero', `${prefixo}%`);

  const { data: encomendas2 } = await supabase
    .from('encomendas_finalizadas')
    .select('numero')
    .like('numero', `${prefixo}%`);

  const todosNumeros = [...(encomendas1 || []), ...(encomendas2 || [])].map(e => e.numero);
  todosNumeros.sort().reverse();

  let seq = 1;
  if (todosNumeros.length > 0) {
    const ultimo = todosNumeros[0];
    seq = parseInt(ultimo.slice(4)) + 1;
  }

  return `${prefixo}${String(seq).padStart(3, '0')}`;
}

app.post('/adicionar-encomenda', async (req, res) => {
  const { nome, telemovel, produto, quantidade, data } = req.body;
  const numero = await gerarNumero();
  if (!numero) return res.status(500).send('Erro a gerar número');

  const { error } = await supabase.from('encomendas').insert([{ numero, nome, telemovel, produto, quantidade, data, estado: 'ativa' }]);
  if (error) return res.status(500).send('Erro ao inserir encomenda');
  res.status(200).send('Encomenda adicionada com sucesso');
});

app.get('/api/encomendas', async (req, res) => {
  const { data: ativas, error: err1 } = await supabase
    .from('encomendas')
    .select('*')
    .order('data', { ascending: false })
    .order('numero', { ascending: false });

  const { data: finalizadas, error: err2 } = await supabase
    .from('encomendas_finalizadas')
    .select('*')
    .order('dataFinalizacao', { ascending: false })
    .order('numero', { ascending: false });

  if (err1 || err2) return res.status(500).send("Erro ao obter encomendas");

  const encomendas = [
    ...(ativas || []).map(e => ({ ...e, finalizada: false })),
    ...(finalizadas || []).map(e => ({ ...e, finalizada: true }))
  ];

  res.json(encomendas);
});

app.post('/finalizar-encomenda/:numero', async (req, res) => {
  const numero = req.params.numero;
  const { valorAngariado, dataFinalizacao } = req.body;
  if (!dataFinalizacao) {
    return res.status(400).send("Erro: dataFinalizacao não fornecida");
  }
  const { data: encomenda, error } = await supabase
    .from('encomendas')
    .select('*')
    .eq('numero', numero)
    .single();

  if (error || !encomenda) return res.status(404).send('Encomenda não encontrada');

  const { error: errFinalizada } = await supabase.from('encomendas_finalizadas').insert([{
    numero,
    nome: encomenda.nome,
    telemovel: encomenda.telemovel,
    produto: encomenda.produto,
    quantidade: encomenda.quantidade,
    data: encomenda.data,
    dataFinalizacao,
    valorAngariado
  }]);

  const descricao = `${encomenda.nome} encomendou ${encomenda.quantidade} de ${encomenda.produto}`;
  const dataEntrada = dataFinalizacao.split(" ")[0];

  await supabase.from('entradas').insert([{ descricao, data: dataEntrada, valor: valorAngariado }]);
  await supabase.from('encomendas').delete().eq('numero', numero);
  res.sendStatus(200);
});

app.post('/apagar-encomenda', async (req, res) => {
  const { numero } = req.body;
  if (!numero) return res.status(400).send('Número da encomenda obrigatório');

  const { error: err1, count } = await supabase.from('encomendas').delete({ count: 'exact' }).eq('numero', numero);
  if (err1) return res.status(500).send('Erro ao apagar encomenda');
  if (count > 0) return res.status(200).send('Encomenda ativa apagada com sucesso');

  const { error: err2, count: count2 } = await supabase.from('encomendas_finalizadas').delete({ count: 'exact' }).eq('numero', numero);
  if (err2) return res.status(500).send('Erro ao apagar encomenda finalizada');
  if (count2 > 0) return res.status(200).send('Encomenda finalizada apagada com sucesso');

  res.status(404).send('Encomenda não encontrada');
});

// Proteção e páginas
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

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
  if (req.session.autenticado) next();
  else res.redirect('/');
}

app.get('/home.html', protegerPagina, (req, res) => res.sendFile(path.join(__dirname, 'privado', 'home.html')));
app.get('/encomendas.html', protegerPagina, (req, res) => res.sendFile(path.join(__dirname, 'privado', 'encomendas.html')));
app.get('/verenc.html', protegerPagina, (req, res) => res.sendFile(path.join(__dirname, 'privado', 'verenc.html')));
app.get('/saidas.html', protegerPagina, (req, res) => res.sendFile(path.join(__dirname, 'privado', 'saidas.html')));
app.get('/entradas.html', protegerPagina, (req, res) => res.sendFile(path.join(__dirname, 'privado', 'entradas.html')));

// Saídas
app.get("/saidas", async (req, res) => {
  const { data, error } = await supabase.from("saidas").select("*");
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

app.post("/saidas", async (req, res) => {
  const { produto, fornecedor, valor, data } = req.body;
  if (!produto || !fornecedor || !valor || !data) return res.status(400).json({ erro: "Campos em falta" });

  const { error } = await supabase.from("saidas").insert([{ produto, fornecedor, valor, data }]);
  if (error) return res.status(500).json({ erro: error.message });
  res.status(200).json({ sucesso: true });
});

app.delete("/saidas/:id", async (req, res) => {
  const id = req.params.id;
  const { error } = await supabase.from("saidas").delete().eq("id", id);
  if (error) return res.status(500).json({ erro: error.message });
  res.status(200).json({ mensagem: "Compra eliminada" });
});

function mesParaNumero(mes) {
  const meses = {
    'janeiro': '01', 'fevereiro': '02', 'março': '03', 'abril': '04',
    'maio': '05', 'junho': '06', 'julho': '07', 'agosto': '08',
    'setembro': '09', 'outubro': '10', 'novembro': '11', 'dezembro': '12'
  };
  return meses[mes.toLowerCase()] || '01';
}

function mesNome(m) {
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return meses[parseInt(m) - 1];
}

// Entradas
app.post('/entradas', async (req, res) => {
  const { descricao, data, valor } = req.body;
  const { error } = await supabase.from('entradas').insert([{ descricao, data, valor }]);
  if (error) return res.status(500).json({ erro: error.message });
  res.json({ sucesso: true });
});

app.get('/entradas', async (req, res) => {
  const { data: rows, error } = await supabase.from('entradas').select('*').order('data', { ascending: false });
  if (error) return res.status(500).json({ erro: error.message });

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

app.delete('/entradas/:id', async (req, res) => {
  const id = req.params.id;
  const { error } = await supabase.from('entradas').delete().eq('id', id);
  if (error) return res.status(500).json({ erro: error.message });
  res.json({ sucesso: true });
});

app.put('/entradas/:id', async (req, res) => {
  const id = req.params.id;
  const { descricao, data, valor } = req.body;
  const { error } = await supabase.from('entradas').update({ descricao, data, valor }).eq('id', id);
  if (error) return res.status(500).send("Erro ao atualizar entrada.");
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Servidor ativo na porta ' + PORT);
});

