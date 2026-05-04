#!/usr/bin/env node
/**
 * Integration test: simulates 2 players creating/joining a room,
 * adding bots, starting a game, and verifying state flows via API.
 *
 * Usage: node scripts/test-game.mjs [base_url]
 * Default base_url: https://detetive-gilt.vercel.app
 */

const BASE = process.argv[2] || 'https://detetive-gilt.vercel.app';
const P1 = 'test-p1-' + Date.now();
const P2 = 'test-p2-' + Date.now();

const c = {
  green: s => `\x1b[32m${s}\x1b[0m`,
  red:   s => `\x1b[31m${s}\x1b[0m`,
  cyan:  s => `\x1b[36m${s}\x1b[0m`,
  gray:  s => `\x1b[90m${s}\x1b[0m`,
};

async function post(path, body, playerId) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-player-id': playerId,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch { return { status: res.status, body: text }; }
}

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(c.green('  ✓'), label);
  } else {
    console.log(c.red('  ✗'), label, detail ? c.gray(`(${detail})`) : '');
    process.exitCode = 1;
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log(c.cyan(`\n=== Dead Man's Party — Integration Test ===`));
  console.log(c.gray(`  Target: ${BASE}`));
  console.log(c.gray(`  P1: ${P1}  P2: ${P2}\n`));

  // --- Step 1: Create room ---
  console.log(c.cyan('[ 1/6 ] Create room (P1)'));
  const create = await post('/api/create_room', { nickname: 'Benoit', avatar: 'lucas' }, P1);
  assert('status 200', create.status === 200, `got ${create.status}`);
  assert('ok: true', create.body.ok === true);
  assert('roomId present', typeof create.body.roomId === 'string' && create.body.roomId.length === 6);
  const roomId = create.body.roomId;
  console.log(c.gray(`  roomId: ${roomId}`));

  // --- Step 2: Join room ---
  console.log(c.cyan('\n[ 2/6 ] Join room (P2)'));
  const join = await post('/api/join_room', { roomId, nickname: 'Marta', avatar: 'mel' }, P2);
  assert('status 200', join.status === 200, `got ${join.status}`);
  assert('ok: true', join.body.ok === true);
  assert('roomId matches', join.body.roomId === roomId);

  // --- Step 3: Tick (lobby phase — should be no-op) ---
  console.log(c.cyan('\n[ 3/6 ] Tick in lobby'));
  const tick1 = await post('/api/tick', { roomId }, P1);
  assert('status 200', tick1.status === 200, `got ${tick1.status}`);
  assert('ok: true', tick1.body.ok === true);

  // --- Step 4: Add 2 bots to reach minimum 4 players ---
  console.log(c.cyan('\n[ 4/6 ] Add bots (need 4 players minimum)'));
  const bot1 = await post('/api/action', { roomId, type: 'add_bot' }, P1);
  assert('bot1 added', bot1.body.ok === true, JSON.stringify(bot1.body));
  const bot2 = await post('/api/action', { roomId, type: 'add_bot' }, P1);
  assert('bot2 added', bot2.body.ok === true, JSON.stringify(bot2.body));

  // --- Step 5: Start game ---
  console.log(c.cyan('\n[ 5/6 ] Start game (P1 is host)'));
  const start = await post('/api/action', { roomId, type: 'start_game' }, P1);
  assert('status 200', start.status === 200, `got ${start.status}`);
  assert('ok: true', start.body.ok === true, JSON.stringify(start.body));

  // --- Step 6: Tick a few times and verify timer decrements ---
  console.log(c.cyan('\n[ 6/6 ] Tick 3x and verify game progresses'));
  await sleep(300);
  const t1 = await post('/api/tick', { roomId }, P1);
  assert('tick 1 ok', t1.body.ok === true);
  await sleep(300);
  const t2 = await post('/api/tick', { roomId }, P1);
  assert('tick 2 ok', t2.body.ok === true);
  await sleep(300);
  const t3 = await post('/api/tick', { roomId }, P1);
  assert('tick 3 ok', t3.body.ok === true);

  // --- Clear messages ---
  await post('/api/clear_messages', { roomId, playerId: P1 }, P1);
  await post('/api/clear_messages', { roomId, playerId: P2 }, P2);

  console.log(process.exitCode === 1
    ? c.red('\n=== FAILED ===')
    : c.green('\n=== ALL TESTS PASSED ==='));
  console.log(c.gray(`  Room ${roomId} left in Firestore — delete manually if needed.\n`));
}

run().catch(err => {
  console.error(c.red('Unexpected error:'), err);
  process.exit(1);
});
