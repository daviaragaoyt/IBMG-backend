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

app.post('/count', async (req: Request, res: Response) => {
  // 1. Adicionei 'marketingSource' aqui
  const { checkpointId, type, church, quantity, ageGroup, gender, marketingSource } = req.body;

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

        // 2. Adicionei esta linha para salvar no banco
        marketingSource: marketingSource || null,

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
  } catch (error) {
    console.error(error); // Bom para ver erro no terminal se houver
    res.status(500).json({ error: "Erro ao contar" });
  }
});

app.post('/track', async (req: Request, res: Response) => {
  const { personId, checkpointId } = req.body;
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  try {
    const existing = await prisma.movement.findFirst({
      where: {
        personId,
        checkpointId,
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

app.get('/dashboard', async (req, res) => {
  try {
    // ⚠️ MODO TESTE (Datas Abertas). Mude para Fev/2026 no evento.
    const eventStart = new Date('2026-01-01T00:00:00');
    const eventEnd = new Date('2026-02-17T23:59:59');

    // 1. Buscas no Banco
    const [manualEntries, scannerEntries] = await Promise.all([
      prisma.manualEntry.findMany({
        where: { timestamp: { gte: eventStart, lte: eventEnd } },
        include: { checkpoint: { select: { name: true } } }
      }),
      prisma.movement.findMany({
        where: { timestamp: { gte: eventStart, lte: eventEnd } },
        select: {
          timestamp: true,
          checkpoint: { select: { name: true } },
          person: { select: { type: true, gender: true, age: true, church: true, marketingSource: true } }
        }
      })
    ]);
    const allEntries = [
      ...manualEntries.map(e => ({
        timestamp: e.timestamp,
        quantity: e.quantity,
        type: e.type,
        gender: e.gender,
        ageGroup: e.ageGroup,
        church: e.church,
        marketing: e.marketingSource,

        source: 'MANUAL',
        checkpointName: e.checkpoint?.name || 'Indefinido'
      })),
    ];

    // 3. Totais Globais
    const total = allEntries.reduce((acc, curr) => acc + curr.quantity, 0);
    const byType = {
      MEMBER: allEntries.filter(e => e.type === 'MEMBER').reduce((acc, e) => acc + e.quantity, 0),
      VISITOR: allEntries.filter(e => e.type === 'VISITOR').reduce((acc, e) => acc + e.quantity, 0)
    };
    const byGender = {
      M: allEntries.filter(e => e.gender === 'M').reduce((acc, e) => acc + e.quantity, 0),
      F: allEntries.filter(e => e.gender === 'F').reduce((acc, e) => acc + e.quantity, 0)
    };
    const byAge = {
      CRIANCA: allEntries.filter(e => e.ageGroup === 'CRIANCA').reduce((acc, e) => acc + e.quantity, 0),
      JOVEM: allEntries.filter(e => e.ageGroup === 'JOVEM').reduce((acc, e) => acc + e.quantity, 0),
      ADULTO: allEntries.filter(e => e.ageGroup === 'ADULTO').reduce((acc, e) => acc + e.quantity, 0),
    };

    // 4. Linha do Tempo e Cruzamento por Local
    const timeline: Record<string, Record<string, number>> = {};
    const checkpointsData: Record<string, Record<string, any>> = {};

    allEntries.forEach(e => {
      const date = new Date(e.timestamp);
      const day = date.getDate().toString();
      const hour = date.getHours().toString();
      const local = e.checkpointName;

      // Timeline
      if (!timeline[day]) timeline[day] = {};
      if (!timeline[day][hour]) timeline[day][hour] = 0;
      timeline[day][hour] += e.quantity;

      // Checkpoints Cruzados
      if (!checkpointsData[day]) checkpointsData[day] = {};
      if (!checkpointsData[day][local]) {
        checkpointsData[day][local] = { total: 0, gender: { M: 0, F: 0 }, age: { CRIANCA: 0, JOVEM: 0, ADULTO: 0 }, type: { MEMBER: 0, VISITOR: 0 } };
      }
      const stats = checkpointsData[day][local];
      stats.total += e.quantity;
      if (e.gender === 'M') stats.gender.M += e.quantity; else if (e.gender === 'F') stats.gender.F += e.quantity;
      if (e.ageGroup === 'CRIANCA') stats.age.CRIANCA += e.quantity; else if (e.ageGroup === 'JOVEM') stats.age.JOVEM += e.quantity; else stats.age.ADULTO += e.quantity;
      if (e.type === 'MEMBER') stats.type.MEMBER += e.quantity; else stats.type.VISITOR += e.quantity;
    });

    const churchMap = new Map();
    allEntries.forEach(e => { if (e.church) churchMap.set(e.church, (churchMap.get(e.church) || 0) + e.quantity); });
    const byChurch = Array.from(churchMap, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);

    // --- 5. MARKETING (AGRUPAMENTO INTELIGENTE) ---
    const marketingMap = new Map();
    allEntries.forEach(e => {
      if (e.marketing) {
        let category = e.marketing;

        // Lista de Redes Sociais
        const socialMedia = ['Instagram', 'WhatsApp', 'Youtube / Tiktok', 'Google / Site'];
        // Lista de Igreja/Liderança
        const churchGroup = ['Pastor / Líder'];

        if (socialMedia.includes(category)) {
          category = 'Redes Sociais'; // Agrupa tudo aqui
        } else if (churchGroup.includes(category)) {
          category = 'Igreja / Culto'; // Agrupa liderança
        }
        // 'Amigo/Convite', 'Faixa / Rua' e 'Outros' continuam separados

        // OBS: Usa e.quantity para o Contador contar corretamente se for > 1 (raro no marketing, mas seguro)
        marketingMap.set(category, (marketingMap.get(category) || 0) + (e.quantity || 1));
      }
    });
    const bySource = Array.from(marketingMap, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    res.json({ total, timeline, checkpointsData, byType, byGender, byAge, byChurch, bySource });

  } catch (error) { console.error(error); res.status(500).json({ error: "Erro no dashboard" }); }
});
// app.get('/dashboard', async (req, res) => {
//   try {
//     // DATA: Usando 01/01/2026 para testes. No evento, mude para 2026-02-13
//     const eventStart = new Date('2026-01-01T00:00:00');
//     const eventEnd = new Date('2026-02-17T23:59:59');

//     // 1. Buscando TUDO
//     const [manualEntries, scannerEntries] = await Promise.all([
//       prisma.manualEntry.findMany({
//         where: { timestamp: { gte: eventStart, lte: eventEnd } },
//         include: { checkpoint: { select: { name: true } } }
//       }),
//       prisma.movement.findMany({
//         where: { timestamp: { gte: eventStart, lte: eventEnd } },
//         select: {
//           timestamp: true,
//           checkpoint: { select: { name: true } },
//           person: { select: { type: true, gender: true, age: true, church: true, marketingSource: true } }
//         }
//       })
//     ]);

//     // 2. Unificando os dados (CORREÇÃO DO ERRO AQUI)
//     const allEntries = [
//       ...manualEntries.map(e => ({
//         timestamp: e.timestamp,
//         quantity: e.quantity,
//         type: e.type,
//         gender: e.gender,
//         ageGroup: e.ageGroup,
//         church: e.church, // <--- ADICIONADO: Agora existe nos dois tipos!
//         marketing: null,
//         source: 'MANUAL',
//         checkpointName: e.checkpoint?.name || 'Indefinido'
//       })),
//       ...scannerEntries.map(e => ({
//         timestamp: e.timestamp,
//         quantity: 1,
//         type: e.person.type,
//         gender: e.person.gender,
//         ageGroup: e.person.age ? (e.person.age < 12 ? 'CRIANCA' : e.person.age < 18 ? 'JOVEM' : 'ADULTO') : 'ADULTO',
//         church: e.person.church,
//         marketing: e.person.marketingSource,
//         source: 'SCANNER',
//         checkpointName: e.checkpoint?.name || 'Indefinido'
//       }))
//     ];

//     // 3. Totais Globais
//     const total = allEntries.reduce((acc, curr) => acc + curr.quantity, 0);

//     const byType = {
//       MEMBER: allEntries.filter(e => e.type === 'MEMBER').reduce((acc, e) => acc + e.quantity, 0),
//       VISITOR: allEntries.filter(e => e.type === 'VISITOR').reduce((acc, e) => acc + e.quantity, 0)
//     };

//     const byGender = {
//       M: allEntries.filter(e => e.gender === 'M').reduce((acc, e) => acc + e.quantity, 0),
//       F: allEntries.filter(e => e.gender === 'F').reduce((acc, e) => acc + e.quantity, 0)
//     };

//     const byAge = {
//       CRIANCA: allEntries.filter(e => e.ageGroup === 'CRIANCA').reduce((acc, e) => acc + e.quantity, 0),
//       JOVEM: allEntries.filter(e => e.ageGroup === 'JOVEM').reduce((acc, e) => acc + e.quantity, 0),
//       ADULTO: allEntries.filter(e => e.ageGroup === 'ADULTO').reduce((acc, e) => acc + e.quantity, 0),
//     };

//     // 4. CRUZAMENTO DE DADOS (LINHA DO TEMPO + CHECKPOINTS)
//     const timeline: Record<string, Record<string, number>> = {};
//     const checkpointsData: Record<string, Record<string, any>> = {};

//     allEntries.forEach(e => {
//       const date = new Date(e.timestamp);
//       const day = date.getDate().toString();
//       const hour = date.getHours().toString();
//       const local = e.checkpointName;

//       // Timeline Logic
//       if (!timeline[day]) timeline[day] = {};
//       if (!timeline[day][hour]) timeline[day][hour] = 0;
//       timeline[day][hour] += e.quantity;

//       // Checkpoint Logic (CRUZAMENTO COMPLETO)
//       if (!checkpointsData[day]) checkpointsData[day] = {};
//       if (!checkpointsData[day][local]) {
//         checkpointsData[day][local] = {
//           total: 0,
//           gender: { M: 0, F: 0 },
//           age: { CRIANCA: 0, JOVEM: 0, ADULTO: 0 },
//           type: { MEMBER: 0, VISITOR: 0 }
//         };
//       }

//       const stats = checkpointsData[day][local];
//       stats.total += e.quantity;

//       if (e.gender === 'M') stats.gender.M += e.quantity;
//       else if (e.gender === 'F') stats.gender.F += e.quantity;

//       if (e.ageGroup === 'CRIANCA') stats.age.CRIANCA += e.quantity;
//       else if (e.ageGroup === 'JOVEM') stats.age.JOVEM += e.quantity;
//       else stats.age.ADULTO += e.quantity;

//       if (e.type === 'MEMBER') stats.type.MEMBER += e.quantity;
//       else stats.type.VISITOR += e.quantity;
//     });

//     // Top Igrejas
//     const churchMap = new Map();
//     allEntries.forEach(e => {
//       if (e.church) churchMap.set(e.church, (churchMap.get(e.church) || 0) + e.quantity);
//     });
//     const byChurch = Array.from(churchMap, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);

//     // Marketing
//     const marketingMap = new Map();
//     allEntries.forEach(e => {
//       if (e.marketing) marketingMap.set(e.marketing, (marketingMap.get(e.marketing) || 0) + 1);
//     });
//     const bySource = Array.from(marketingMap, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

//     res.json({ total, timeline, checkpointsData, byType, byGender, byAge, byChurch, bySource });

//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: "Erro no dashboard" });
//   }
// });

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

// --- BUSCA DE PESSOAS (ATUALIZADA: Com indicador se já entrou) ---
app.get('/people', async (req, res) => {
  const { search } = req.query;
  if (!search) return res.json([]);

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  const people = await prisma.person.findMany({
    where: { name: { contains: String(search), mode: 'insensitive' } },
    take: 10,
    include: {
      // Verifica se tem movimentos HOJE
      movements: {
        where: { timestamp: { gte: todayStart, lte: todayEnd } },
        select: { id: true }
      }
    }
  });

  // Adiciona o campo 'hasEntered' para o front
  const result = people.map(p => ({
    ...p,
    hasEntered: p.movements.length > 0
  }));

  res.json(result);
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

// --- EXPORTAR (COM ORIGEM) ---
app.get('/export', async (req, res) => {
  try {
    const people = await prisma.person.findMany({
      orderBy: { createdAt: 'desc' }
    });

    let csv = "Nome,Idade,Tipo,Genero,Igreja,WhatsApp,Origem,Data Cadastro\n";

    people.forEach(p => {
      const cleanName = p.name.replace(/,/g, '');
      const data = new Date(p.createdAt).toLocaleDateString('pt-BR');
      csv += `${cleanName},${p.age || ''},${p.type},${p.gender || ''},${p.church || ''},${p.phone || ''},${p.marketingSource || ''},${data}\n`;
    });

    res.header('Content-Type', 'text/csv');
    res.attachment('relatorio_ekklesia.csv');
    res.send(csv);

  } catch (error) { res.status(500).send("Erro ao gerar relatório"); }
});

// --- SANEAMENTO DE DADOS ---
app.get('/people/incomplete', async (req, res) => {
  try {
    const people = await prisma.person.findMany({
      where: {
        OR: [
          { gender: null },
          { phone: null },
          { marketingSource: null },
          { age: null }
        ]
      },
      orderBy: { name: 'asc' },
      take: 50
    });
    res.json(people);
  } catch (error) { res.status(500).json({ error: "Erro ao buscar pendências" }); }
});

app.put('/person/:id', async (req, res) => {
  const { id } = req.params;
  const { gender, phone, marketingSource, age, church } = req.body;

  try {
    const updated = await prisma.person.update({
      where: { id },
      data: {
        gender: gender || undefined,
        phone: phone || undefined,
        marketingSource: marketingSource || undefined,
        age: age ? parseInt(age) : undefined,
        church: church || undefined
      }
    });
    res.json(updated);
  } catch (error) { res.status(500).json({ error: "Erro ao atualizar." }); }
});

// --- INICIALIZAÇÃO ---
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🔥 Servidor local rodando na porta ${PORT}`);
  });
}

export default app;