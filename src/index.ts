import express, { Request, Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { startOfDay, endOfDay } from 'date-fns';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json());

// --- CONFIGURAÇÕES ---
const CHURCHES = [
  "Ibmg Alphaville", "Ibmg Orlando", "Ibmg Sede", "Ibmg Santa Maria", "Ibmg Caldas", "Outra"
];

app.get('/', (req, res) => { res.send("Ekklesia API Online (Neon DB) 🚀"); });
app.get('/config/churches', (req, res) => res.json(CHURCHES));

// --- 1. AUTENTICAÇÃO STAFF ---
app.post('/auth/login', async (req: Request, res: Response) => {
  const { email } = req.body;
  try {
    const user = await prisma.person.findUnique({ where: { email: String(email) } });
    if (!user) return res.status(404).json({ error: "E-mail não encontrado." });
    if (user.role !== 'STAFF') return res.status(403).json({ error: "Acesso negado. Apenas Staff." });
    res.json(user);
  } catch (error: any) {
    console.error("❌ ERRO NO LOGIN:", error);
    res.status(500).json({
      error: "Erro interno.",
      details: error.message || String(error)
    });
  }
});

// --- 2. CONTADOR MANUAL ---
app.post('/count', async (req: Request, res: Response) => {
  const { checkpointId, type, church, quantity, ageGroup, gender } = req.body;

  if (!checkpointId || !type) return res.status(400).json({ error: "Dados faltando" });

  try {
    const entry = await prisma.manualEntry.create({
      data: {
        checkpointId,
        type,
        church,
        ageGroup: ageGroup || 'ADULTO',
        gender: gender || 'M',
        quantity: quantity || 1,
        timestamp: new Date()
      }
    });

    // Total de HOJE
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());
    const totalToday = await prisma.manualEntry.count({
      where: { checkpointId, timestamp: { gte: todayStart, lte: todayEnd } }
    });

    res.json({ success: true, totalToday, entry });
  } catch (error) { res.status(500).json({ error: "Erro ao contar" }); }
});

// --- 3. TRACKING QR CODE ---
app.post('/track', async (req: Request, res: Response) => {
  const { personId, checkpointId } = req.body;
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  try {
    const existing = await prisma.movement.findFirst({
      where: {
        personId, checkpointId,
        timestamp: { gte: todayStart, lte: todayEnd }
      },
      include: { person: true, checkpoint: true }
    });

    if (existing) {
      return res.json({ success: true, status: 'REENTRY', person: existing.person, message: `⚠️ Já registrado hoje.` });
    }

    const newMove = await prisma.movement.create({
      data: { personId, checkpointId },
      include: { person: true, checkpoint: true }
    });

    return res.json({ success: true, status: 'SUCCESS', person: newMove.person, message: `✅ Acesso Liberado!` });
  } catch (error) { res.status(500).json({ success: false }); }
});

// --- 4. DASHBOARD (CORRIGIDO) ---
app.get('/dashboard', async (req, res) => {
  try {
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());

    // 1. Buscando todas as entradas de hoje
    const entries = await prisma.manualEntry.findMany({
      where: { timestamp: { gte: todayStart, lte: todayEnd } },
      include: { checkpoint: true }
    });

    // 2. Calculando Totais
    const total = entries.reduce((acc, curr) => acc + curr.quantity, 0);

    // 3. Agrupamentos Inteligentes
    const byType = {
      MEMBER: entries.filter(e => e.type === 'MEMBER').reduce((acc, e) => acc + e.quantity, 0),
      VISITOR: entries.filter(e => e.type === 'VISITOR').reduce((acc, e) => acc + e.quantity, 0)
    };

    const byGender = {
      M: entries.filter(e => e.gender === 'M').reduce((acc, e) => acc + e.quantity, 0),
      F: entries.filter(e => e.gender === 'F').reduce((acc, e) => acc + e.quantity, 0)
    };

    const byAge = {
      CRIANCA: entries.filter(e => e.ageGroup === 'CRIANCA').reduce((acc, e) => acc + e.quantity, 0),
      JOVEM: entries.filter(e => e.ageGroup === 'JOVEM').reduce((acc, e) => acc + e.quantity, 0),
      ADULTO: entries.filter(e => e.ageGroup === 'ADULTO').reduce((acc, e) => acc + e.quantity, 0),
    };

    // 4. Top Igrejas (Visitantes)
    const churchMap = new Map();
    entries.forEach(e => {
      if (e.church) {
        const current = churchMap.get(e.church) || 0;
        churchMap.set(e.church, current + e.quantity);
      }
    });

    const byChurch = Array.from(churchMap, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // 5. Origem/Marketing (NOVO - LÓGICA QUE FALTAVA)
    // Busca pessoas cadastradas hoje agrupadas por origem
    const peopleToday = await prisma.person.groupBy({
      by: ['marketingSource'],
      where: { createdAt: { gte: todayStart, lte: todayEnd } },
      _count: { marketingSource: true }
    });

    const bySource = peopleToday.map(p => ({
      name: p.marketingSource || 'Não Informado',
      value: p._count.marketingSource
    })).sort((a, b) => b.value - a.value);

    res.json({
      total,
      byType,
      byGender,
      byAge,
      byChurch,
      bySource // Agora a variável existe!
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro no dashboard" });
  }
});

// --- 5. SETUP (Locais + Admin) ---
app.get('/setup', async (req, res) => {
  try {
    await prisma.checkpoint.createMany({
      data: [
        { name: "Recepção / Entrada", category: "GENERAL" },
        { name: "Sala Profética", category: "PROPHETIC" },
        { name: "Consolidação", category: "CONSOLIDATION" },
        { name: "Kombi Evangelista", category: "EVANGELISM" },
        { name: "Tenda de Oração", category: "PRAYER" },
      ],
      skipDuplicates: true
    });

    const adminEmail = "davi@ibmg.com";

    const admin = await prisma.person.upsert({
      where: { email: adminEmail },
      update: { role: 'STAFF' },
      create: {
        name: "Davi Admin",
        email: adminEmail,
        type: "MEMBER",
        role: "STAFF",
        church: "Ibmg Sede",
        age: 25
      }
    });

    res.send(`✅ Setup Concluído!<br>Locais criados.<br>Admin criado: <b>${admin.email}</b>`);
  } catch (error) {
    res.status(500).send("Erro no setup: " + error);
  }
});

// --- CADASTRO COMPLETO ---
app.post('/register', async (req, res) => {
  const { name, email, phone, type, church, age, gender, isStaff, marketingSource } = req.body;

  try {
    const user = await prisma.person.create({
      data: {
        name,
        email: email || null,
        phone: phone || null,
        type,
        church,
        gender,
        marketingSource,
        age: age ? parseInt(age) : null,
        role: isStaff ? 'STAFF' : 'PARTICIPANT'
      }
    });
    res.json(user);
  } catch (e) { res.status(400).json({ error: "Erro no cadastro." }); }
});

app.get('/checkpoints', async (req, res) => {
  const spots = await prisma.checkpoint.findMany();
  res.json(spots);
});

app.get('/people', async (req, res) => {
  const { search } = req.query;
  if (!search) return res.json([]);
  const people = await prisma.person.findMany({
    where: { name: { contains: String(search), mode: 'insensitive' } },
    take: 10
  });
  res.json(people);
});

app.get('/person/by-email', async (req, res) => {
  const { email } = req.query;
  const person = await prisma.person.findUnique({ where: { email: String(email) } });
  person ? res.json(person) : res.status(404).json({ error: "Não encontrado" });
});

app.get('/make-admin', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.send("?email=...");
  await prisma.person.update({ where: { email: String(email) }, data: { role: 'STAFF' } });
  res.send("OK");
});

// --- EXPORTAR (ATUALIZADO COM ORIGEM) ---
app.get('/export', async (req, res) => {
  try {
    // Busca todas as pessoas cadastradas
    const people = await prisma.person.findMany({
      orderBy: { createdAt: 'desc' }
    });

    // Cabeçalho do CSV (Adicionei Origem)
    let csv = "Nome,Idade,Tipo,Genero,Igreja,WhatsApp,Origem,Data Cadastro\n";

    // Preenche as linhas
    people.forEach(p => {
      // Limpa vírgulas dos nomes para não quebrar o CSV
      const cleanName = p.name.replace(/,/g, '');
      const data = new Date(p.createdAt).toLocaleDateString('pt-BR');

      csv += `${cleanName},${p.age || ''},${p.type},${p.gender || ''},${p.church || ''},${p.phone || ''},${p.marketingSource || ''},${data}\n`;
    });

    // Força o navegador a baixar o arquivo
    res.header('Content-Type', 'text/csv');
    res.attachment('relatorio_ekklesia.csv');
    res.send(csv);

  } catch (error) { res.status(500).send("Erro ao gerar relatório"); }
});

// --- INICIALIZAÇÃO ---
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🔥 Servidor local rodando na porta ${PORT}`);
  });
}

export default app;