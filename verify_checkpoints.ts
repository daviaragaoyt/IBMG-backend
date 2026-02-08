
// import fetch from 'node-fetch'; // Usando fetch nativo do Node 18+

async function run() {
    try {
        console.log("Fetching checkpoints...");
        const res = await fetch('http://localhost:3001/operations/checkpoints');
        if (!res.ok) {
            console.error("Failed to fetch:", res.status, res.statusText);
            const text = await res.text();
            console.error("Response:", text);
            return;
        }
        const checkpoints = await res.json();
        console.log("Checkpoints found:", checkpoints.length);
        checkpoints.forEach((cp: any) => {
            console.log(`- [${cp.id}] ${cp.name} (${cp.category})`);
        });

        const martires = checkpoints.find((c: any) => c.name.toLowerCase().includes('mártires') || c.name.toLowerCase().includes('martires'));
        const profetico = checkpoints.find((c: any) => c.name.toLowerCase().includes('profétic') || c.name.toLowerCase().includes('profetic'));

        if (martires) {
            console.log(`Found Casa dos Mártires: ${martires.id}`);
            const countRes = await fetch('http://localhost:3001/operations/count', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    checkpointId: martires.id,
                    quantity: 1,
                    type: 'MEMBER',
                    isHealing: true // Simulating Healing
                })
            });
            console.log("Count Martires (Healing) Response:", await countRes.json());
        }

        const evangelismo = checkpoints.find((c: any) => c.name.toUpperCase().includes('KOMBI') || c.name.toUpperCase().includes('EVANGELISMO'));
        if (evangelismo) {
            console.log(`Found Evangelismo: ${evangelismo.id}`);
            const countRes = await fetch('http://localhost:3001/operations/count', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    checkpointId: evangelismo.id,
                    quantity: 1,
                    type: 'VISITOR',
                    gender: 'M',
                    isSalvation: true // Simulating Salvation
                })
            });
            console.log("Count Evangelismo (Salvation) Response:", await countRes.json());
        }

        if (profetico) {
            console.log("Found Tenda Profética:", profetico.id);
            const countRes = await fetch('http://localhost:3001/operations/count', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    checkpointId: profetico.id,
                    type: 'VISITOR',
                    quantity: 1
                })
            });
            console.log("Count Profetico Response:", await countRes.json());
        }

        console.log("Waiting for data to propagate...");
        await new Promise(r => setTimeout(r, 2000));

        console.log("Fetching Dashboard Data...");
        const dashRes = await fetch('http://localhost:3001/dashboard');
        const dashJson: any = await dashRes.json();

        const todayKey = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        console.log(`Checking data for today (${todayKey})...`);

        if (dashJson.checkpointsData && dashJson.checkpointsData[todayKey]) {
            const dayData = dashJson.checkpointsData[todayKey];
            console.log("Day Data Keys:", Object.keys(dayData));

            if (martires && dayData[martires.name]) {
                console.log("Stats for Mártires:", JSON.stringify(dayData[martires.name].healing, null, 2));
            }
            if (evangelismo && dayData[evangelismo.name]) {
                console.log("Stats for Evangelismo:", JSON.stringify(dayData[evangelismo.name].salvation, null, 2));
            }
            if (profetico && dayData[profetico.name]) {
                const pData = dayData[profetico.name];
                console.log(`Stats for ${profetico.name}:`, pData);
            }

            // Check Totals
            if (dayData['Total']) {
                console.log("Total for Day:", dayData['Total']);
            }
        } else {
            console.log("No data found for today in dashboard response.");
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

run();
