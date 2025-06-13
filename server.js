const express = require('express');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// 🔑 Configuração Supabase
const supabaseUrl = 'https://sidgczdpjjfqwhyyxblc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpZGdjemRwampmcXdoeXl4YmxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxNTk5ODEsImV4cCI6MjA2NDczNTk4MX0.maYLaaQ4ptbQa1SeVPOOE7bAPnQYJHXDfn-3rNUjRfE';
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

// Função para gerar número de encomenda (com supabase)
async function gerarNumero() {
  const agora = new Date();
  const aa = agora.getFullYear().toString().slice(-2);
  const mm = String(agora.getMonth() + 1).padStart(2, '0');
  const prefixo = `${aa}${mm}`;

  const { data: arr1 } = await supabase
    .from('encomendas')
    .select('numero')
    .like('numero', `${prefixo}%`)
    .order('numero', { ascending: false })
    .limit(1);

  const { data: arr2 } = await supabase
    .from('encomendas_finalizadas')
    .select('numero')
    .like('numero', `${prefixo}%`)
    .order('numero', { ascending: false })
    .limit(1);

  const ultimo = arr1.concat(arr2)[0]?.numero;
  const seq = ultimo
    ? parseInt(ultimo.slice(4)) + 1
    : 1;

  return `${prefixo}${String(seq).padStart(3, '0')}`;
}

// ➕ Adicionar nova encomenda
app.post('/adicionar-encomenda', async (req, res) => {
  const { nome, telemovel, produto, quantidade, data } = req.body;
  const numero = await gerarNumero();
  const { error } = await supabase.from('encomendas')
    .insert([{ numero, nome, telemovel, produto, quantidade, data, finalizada: false }]);
  if (error) return res.status(500).send('Erro ao adicionar encomenda');
  res.send('Encomenda adicionada com sucesso');
});

// 📝 Obter todas as encomendas
app.get('/api/encomendas', async (req, res) => {
  const { data: ativas, error: e1 } = await supabase
    .from('encomendas').select('*').order('data', { ascending: false }).order('numero', { ascending: false });
  if (e1) return res.status(500).send('Erro ao obter encomendas ativas');

  const { data: finalizadas, error: e2 } = await supabase
    .from('encomendas_finalizadas').select('*').order('dataFinalizacao', { ascending: false }).order('numero', { ascending: false });
  if (e2) return res.status(500).send('Erro ao obter encomendas finalizadas');

  const encomendas = [
    ...ativas.map(e => ({ ...e, finalizada: false })),
    ...finalizadas.map(e => ({ ...e, finalizada: true }))
  ];
  res.json(encomendas);
});

// ✅ Finalizar encomenda
app.post('/finalizar-encomenda/:numero', async (req, res) => {
  const numero = req.params.numero;
  const { valorAngariado, dataFinalizacao } = req.body;

  const { data: [row], error: err1 } = await supabase
    .from('encomendas').select('*').eq('numero', numero).limit(1);
  if (err1 || !row) return res.status(404).send('Encomenda não encontrada');

  const { error: err2 } = await supabase
    .from('encomendas_finalizadas')
    .insert([{
      numero: row.numero,
      nome: row.nome,
      telemovel: row.telemovel,
      produto: row.produto,
      quantidade: row.quantidade,
      data: row.data,
      dataFinalizacao,
      valorAngariado,
    }]);
  if (err2) return res.status(500).send('Erro ao copiar para finalizadas');

  const descricao = `${row.nome} encomendou ${row.quantidade} de ${row.produto}`;
  const dataEntrada = dataFinalizacao.split(' ')[0];
  const { error: err3 } = await supabase.from('entradas')
    .insert([{ descricao, data: dataEntrada, valor: valorAngariado }]);
  if (err3) return res.status(500).send('Erro ao adicionar entrada');

  const { error: err4 } = await supabase
    .from('encomendas')
    .delete()
    .eq('numero', numero);
  if (err4) return res.status(500).send('Erro ao apagar encomenda ativa');

  res.sendStatus(200);
});

// 🗑️ Apagar encomenda
app.post('/apagar-encomenda', async (req, res) => {
  const { numero } = req.body;
  if (!numero) return res.status(400).send('Número da encomenda obrigatório');

  const { error: e1, count } = await supabase
    .from('encomendas').delete().eq('numero', numero).select();
  if (e1) return res.status(500).send('Erro ao apagar encomenda ativa');
  if (count > 0) return res.send('Encomenda ativa apagada');

  const { error: e2, count: c2 } = await supabase
    .from('encomendas_finalizadas').delete().eq('numero', numero).select();
  if (e2) return res.status(500).send('Erro ao apagar encomenda finalizada');
  if (c2 > 0) return res.send('Encomenda finalizada apagada');

  res.status(404).send('Encomenda não encontrada');
});

// **Login & sessões**
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.post('/verificar-codigo', (req, res) => {
  if (req.body.codigo === '2222') {
    req.session.autenticado = true;
    return res.redirect('/home.html');
  }
  res.redirect('/?erro=1');
});
function protegerPagina(req, res, next) {
  req.session.autenticado ? next() : res.redirect('/');
}
['home','encomendas','verenc','saidas','entradas'].forEach(page => {
  app.get(`/${page}.html`, protegerPagina, (req, res) =>
    res.sendFile(path.join(__dirname, 'privado', `${page}.html`)));
});

// 🛒 Rotas de entradas
app.post('/entradas', async (req, res) => {
  const { descricao, data, valor } = req.body;
  const { error } = await supabase.from('entradas').insert([{ descricao, data, valor }]);
  if (error) return res.status(500).json({ erro: error.message });
  res.json({ sucesso: true });
});
app.get('/entradas', async (req, res) => {
  const { data: rows, error } = await supabase
    .from('entradas').select('*').order('data', { ascending: false });
  if (error) return res.status(500).json({ erro: error.message });

  const agrupado = {};
  rows.forEach(row => {
    const [ano, mes] = row.data.split('-');
    const chave = `${mesNome(mes)} de ${ano}`;
    agrupado[chave] ??= { entradas: [], total: 0 };
    agrupado[chave].entradas.push(row);
    agrupado[chave].total += parseFloat(row.valor);
  });
  res.json(agrupado);
});
app.delete('/entradas/:id', async (req, res) => {
  const { error } = await supabase.from('entradas').delete().eq('id', req.params.id);
  error ? res.status(500).json({ erro: error.message }) : res.json({ sucesso: true });
});
app.put('/entradas/:id', async (req, res) => {
  const { descricao, data, valor } = req.body;
  const { error } = await supabase.from('entradas')
    .update({ descricao, data, valor }).eq('id', req.params.id);
  error ? res.status(500).send('Erro ao atualizar entrada.') : res.sendStatus(200);
});

// 🛍️ Rotas de saídas
app.get('/saidas', async (req, res) => {
  const { data, error } = await supabase.from('saidas').select('*');
  error ? res.status(500).json({ erro: error.message }) : res.json(data);
});
app.post('/saidas', async (req, res) => {
  const { produto, fornecedor, valor, data: d } = req.body;
  if (!produto || !fornecedor || !valor || !d) return res.status(400).json({ erro: "Campos em falta" });
  const { data, error } = await supabase.from('saidas')
    .insert([{ produto, fornecedor, valor, data: d }]);
  error ? res.status(500).json({ erro: error.message }) : res.json({ id: data[0].id });
});
app.delete('/saidas/:id', async (req, res) => {
  const { error } = await supabase.from('saidas').delete().eq('id', req.params.id);
  error ? res.status(500).json({ erro: error.message }) : res.json({ mensagem: "Compra eliminada" });
});

function mesNome(m) {
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return meses[parseInt(m,10)-1];
}

// 🚀 Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor ativo na porta ' + PORT));
