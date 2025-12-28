import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function checkComponents() {
  const connectorsResult = await pool.query(
    'SELECT connector_id FROM road_connectors WHERE region_id = $1',
    ['bar_harbor_me_usa_demo']
  );
  const allConnectors = new Set(connectorsResult.rows.map(r => r.connector_id));

  const edgesResult = await pool.query(
    'SELECT from_connector, to_connector FROM road_edges'
  );

  // Build adjacency
  const adj = new Map();
  for (const e of edgesResult.rows) {
    if (!adj.has(e.from_connector)) adj.set(e.from_connector, []);
    adj.get(e.from_connector).push(e.to_connector);
  }

  // BFS to find component sizes
  const visited = new Set();
  let components = [];

  for (const start of allConnectors) {
    if (visited.has(start)) continue;

    const queue = [start];
    let size = 0;
    const componentNodes = [];

    while (queue.length > 0) {
      const node = queue.shift();
      if (visited.has(node)) continue;
      visited.add(node);
      componentNodes.push(node);
      size++;

      const neighbors = adj.get(node) || [];
      for (const n of neighbors) {
        if (!visited.has(n)) queue.push(n);
      }
    }

    components.push({ size, sample: componentNodes[0].slice(0, 16) });
  }

  components.sort((a, b) => b.size - a.size);
  console.log('Found', components.length, 'connected components:');
  components.slice(0, 10).forEach((c, i) => console.log('  Component', i+1, ':', c.size, 'nodes'));

  // Check which component contains hub and task connectors
  const hubConnector = '8dfff874-1529-40a1-b9c5-194d0cbdf919';
  const taskConnector = '4c8f7279-3b47-42a5-b4cb-6a8f8e42e6a9';

  // Re-run BFS to find which component each is in
  const visited2 = new Set();
  let hubComponent = -1, taskComponent = -1;
  let componentIdx = 0;

  for (const start of allConnectors) {
    if (visited2.has(start)) continue;
    componentIdx++;

    const queue = [start];
    while (queue.length > 0) {
      const node = queue.shift();
      if (visited2.has(node)) continue;
      visited2.add(node);

      if (node === hubConnector) hubComponent = componentIdx;
      if (node === taskConnector) taskComponent = componentIdx;

      const neighbors = adj.get(node) || [];
      for (const n of neighbors) {
        if (!visited2.has(n)) queue.push(n);
      }
    }
  }

  console.log('Hub connector in component:', hubComponent);
  console.log('Task connector in component:', taskComponent);

  await pool.end();
}

checkComponents().catch(console.error);
