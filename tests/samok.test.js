'use strict';
// samok.html의 <script id="samok-core"> 블록만 꺼내 DOM 없이 시험한다. 외부 의존성 없음.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'samok.html'), 'utf8');
const match = html.match(/<script id="samok-core">([\s\S]*?)<\/script>/);
assert.ok(match, 'samok.html에 samok-core 스크립트가 있어야 한다');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(match[1], sandbox);
const { createGame, play, undo, findLine, bestMove } = sandbox.Samok;
const plain = (v) => JSON.parse(JSON.stringify(v));

// 칸 번호 목록을 차례대로 둔다. 둘 수 없는 수가 있으면 실패.
function playAll(game, moves) {
  for (const m of moves) {
    const next = play(game, m);
    assert.ok(next, `${m}에 둘 수 있어야 한다`);
    game = next;
  }
  return game;
}
const at = (size, r, c) => r * size + c;

test('새 판: 기본 10×10, 3개 잇기, O 먼저', () => {
  const g = createGame();
  assert.equal(g.size, 10);
  assert.equal(g.winLength, 3);
  assert.equal(g.cells.length, 100);
  assert.ok(g.cells.every((c) => c === ''));
  assert.equal(g.turn, 'O');
  assert.equal(g.winner, null);
  assert.equal(g.draw, false);
});

test('새 판: 잘못된 크기는 거부', () => {
  assert.throws(() => createGame(2));
  assert.throws(() => createGame(20));
  assert.throws(() => createGame(3, 4));
  assert.throws(() => createGame(10, 2));
});

test('번갈아 두고, 원래 판은 바꾸지 않는다', () => {
  const g0 = createGame(10);
  const g1 = play(g0, 0);
  assert.equal(g0.cells[0], '');
  assert.equal(g1.cells[0], 'O');
  assert.equal(g1.turn, 'X');
  const g2 = play(g1, 1);
  assert.equal(g2.cells[1], 'X');
  assert.equal(g2.turn, 'O');
  assert.deepEqual(plain(g2.moves), [0, 1]);
});

test('둘 수 없는 자리는 null', () => {
  const g = play(createGame(10), 5);
  assert.equal(play(g, 5), null, '이미 돌이 있음');
  assert.equal(play(g, -1), null);
  assert.equal(play(g, 100), null);
  assert.equal(play(g, 1.5), null);
});

test('가로·세로·두 대각선으로 3개를 이으면 승리', () => {
  const s = 10;
  const cases = {
    가로: [[at(s, 4, 3), at(s, 4, 4), at(s, 4, 5)]],
    세로: [[at(s, 2, 7), at(s, 3, 7), at(s, 4, 7)]],
    '↘ 대각선': [[at(s, 0, 0), at(s, 1, 1), at(s, 2, 2)]],
    '↙ 대각선': [[at(s, 7, 9), at(s, 8, 8), at(s, 9, 7)]],
  };
  for (const [name, [line]] of Object.entries(cases)) {
    // O는 줄을, X는 멀리 떨어진 곳(맨 아래 줄 왼쪽 등)을 둔다.
    const filler = [at(s, 9, 0), at(s, 9, 2), at(s, 0, 9), at(s, 0, 6)].filter((i) => !line.includes(i));
    const g = playAll(createGame(s), [line[0], filler[0], line[1], filler[1], line[2]]);
    assert.equal(g.winner, 'O', name);
    assert.deepEqual(plain(g.line), [...line].sort((a, b) => a - b), name);
    assert.equal(play(g, filler[2]), null, `${name}: 끝난 판에는 더 둘 수 없다`);
  }
});

test('판 끝에서 다음 줄로 넘어가 이어지지 않는다', () => {
  const s = 10;
  // 8, 9(첫 줄 끝)와 10(둘째 줄 처음)은 이어진 줄이 아니다.
  const g = playAll(createGame(s), [8, 50, 9, 52, 10]);
  assert.equal(g.winner, null);
  // 대각선도 마찬가지: (0,9)→(1,0)은 이웃이 아니다.
  assert.equal(findLine(['', '', 'O', 'O', '', '', '', '', '', ''].concat(Array(90).fill('')), 10, 3, 3), null);
});

test('3개보다 길게 이어지면 이어진 칸 전체를 돌려준다', () => {
  const cells = Array(25).fill('');
  [5, 6, 8, 9].forEach((i) => { cells[i] = 'X'; });
  cells[7] = 'X';
  assert.deepEqual(plain(findLine(cells, 5, 3, 7)), [5, 6, 7, 8, 9]);
});

test('3×3에서 칸이 다 차고 승자가 없으면 무승부', () => {
  // O X O / O X X / X O O
  const g = playAll(createGame(3), [0, 1, 2, 4, 3, 5, 7, 6, 8]);
  assert.equal(g.winner, null);
  assert.equal(g.draw, true);
  assert.equal(play(g, 0), null);
});

test('마지막 칸으로 이기면 무승부가 아니라 승리', () => {
  // O: 0, 3, 2, 7, 6 / X: 1, 4, 5, 8 → 아홉째 수(6)로 O가 0·3·6 세로를 잇는다.
  const g = playAll(createGame(3), [0, 1, 3, 4, 2, 5, 7, 8, 6]);
  assert.equal(g.moves.length, 9);
  assert.equal(g.winner, 'O');
  assert.equal(g.draw, false);
  assert.deepEqual(plain(g.line), [0, 3, 6]);
});

test('무르기', () => {
  const g = playAll(createGame(10), [11, 12, 13]);
  const u1 = undo(g);
  assert.deepEqual(plain(u1.moves), [11, 12]);
  assert.equal(u1.cells[13], '');
  assert.equal(u1.turn, 'O');
  const u2 = undo(g, 2);
  assert.deepEqual(plain(u2.moves), [11]);
  assert.equal(u2.turn, 'X');
  assert.deepEqual(plain(undo(g, 5).moves), []);
  const won = playAll(createGame(10), [0, 50, 1, 52, 2]);
  const back = undo(won);
  assert.equal(back.winner, null);
  assert.equal(back.turn, 'O');
});

test('컴퓨터: 빈 판이면 가운데 근처', () => {
  assert.equal(bestMove(createGame(3)), 4);
  const m = bestMove(createGame(10));
  assert.ok([44, 45, 54, 55].includes(m), String(m));
});

test('컴퓨터: 이길 자리가 있으면 이긴다', () => {
  // X 차례, X가 20·21에 있으면 22(또는 19)로 이긴다.
  const g = playAll(createGame(10), [0, 20, 99, 21, 55]);
  assert.equal(g.turn, 'X');
  const m = bestMove(g);
  assert.ok(play(g, m).winner === 'X', String(m));
});

test('컴퓨터: 상대가 이길 자리를 막는다', () => {
  // O가 44·45에 있고 X 차례 → 43 또는 46을 막아야 한다.
  const g = playAll(createGame(10), [44, 0, 45]);
  const m = bestMove(g);
  assert.ok([43, 46].includes(m), String(m));
});

test('컴퓨터: 끝난 판에서는 -1', () => {
  const won = playAll(createGame(10), [0, 50, 1, 52, 2]);
  assert.equal(bestMove(won), -1);
});

test('컴퓨터는 3×3에서 지지 않는다(상대의 모든 수를 끝까지 시험)', () => {
  let games = 0;
  function explore(g, computer) {
    if (g.winner || g.draw) {
      games += 1;
      assert.notEqual(g.winner, computer === 'O' ? 'X' : 'O', `컴퓨터(${computer})가 졌다: ${g.moves.join(',')}`);
      return;
    }
    if (g.turn === computer) {
      explore(play(g, bestMove(g)), computer);
    } else {
      g.cells.forEach((c, i) => { if (!c) explore(play(g, i), computer); });
    }
  }
  explore(createGame(3), 'X');
  explore(createGame(3), 'O');
  assert.ok(games > 100);
});

test('컴퓨터의 수는 항상 둘 수 있는 자리', () => {
  let g = createGame(10);
  for (let i = 0; i < 100 && !(g.winner || g.draw); i++) {
    const m = bestMove(g);
    const next = play(g, m);
    assert.ok(next, `둘 수 없는 수 ${m}`);
    g = next;
  }
  assert.ok(g.winner || g.draw);
});

test('게임 로직은 DOM을 쓰지 않는다', () => {
  assert.doesNotMatch(match[1], /\b(document|window|navigator|localStorage|sessionStorage)\b/);
});

test('게임 페이지는 외부 자원·전송·저장 기능을 쓰지 않는다', () => {
  assert.doesNotMatch(html, /\b(src|href)\s*=\s*["']?(https?:)?\/\//i);
  assert.doesNotMatch(html, /@import|@font-face|url\(/i);
  assert.doesNotMatch(html, /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|document\.cookie|postMessage)\b/);
  assert.match(html, /Content-Security-Policy" content="default-src 'none';[^"]*connect-src 'none'/);
});
