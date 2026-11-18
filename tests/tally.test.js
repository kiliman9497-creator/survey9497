'use strict';
// index.html의 <script id="tally-core"> 블록만 꺼내 DOM 없이 시험한다. 외부 의존성 없음.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script id="tally-core">([\s\S]*?)<\/script>/);
assert.ok(match, 'index.html에 tally-core 스크립트가 있어야 한다');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(match[1], sandbox);
const { parseTsv, classifyCell, formatAverage, tally } = sandbox.SurveyTally;

// vm 안에서 만든 객체는 프로토타입이 달라 deepStrictEqual이 실패하므로 평범한 값으로 바꾼다.
const plain = (v) => JSON.parse(JSON.stringify(v));
const rowsOf = (result) => plain(result.questions).map((q) => [q.name, q.valid, q.average, q.blank, q.excluded]);

test('칸 판정: 앞뒤 공백을 지운 1~5만 유효', () => {
  for (const v of ['1', '2', '3', '4', '5', ' 3', '4 ', '\t5\t', ' 2　']) {
    assert.equal(classifyCell(v), 'valid', JSON.stringify(v));
  }
});

test('칸 판정: 비었거나 공백만 있으면 빈 응답', () => {
  for (const v of ['', ' ', '   ', '　', ' ', undefined]) {
    assert.equal(classifyCell(v), 'blank', JSON.stringify(v));
  }
});

test('칸 판정: 그 밖의 값은 제외', () => {
  for (const v of ['0', '6', '10', '3.5', '3.0', '03', '+3', '-1', '1 2', '３', '예', 'N/A', '5점']) {
    assert.equal(classifyCell(v), 'excluded', JSON.stringify(v));
  }
});

test('평균: 소수 셋째 자리에서 반올림해 둘째 자리까지', () => {
  assert.equal(formatAverage(0, 0), '-');
  assert.equal(formatAverage(5, 1), '5.00');
  assert.equal(formatAverage(10, 3), '3.33'); // 3.333…
  assert.equal(formatAverage(5, 3), '1.67'); // 1.666…
  assert.equal(formatAverage(469, 200), '2.35'); // 2.345 → 반올림 올림
  assert.equal(formatAverage(201, 200), '1.01'); // 1.005 → 부동소수로는 1.00이 되기 쉬운 경우
  assert.equal(formatAverage(2009, 200), '10.05'); // 10.045
  assert.equal(formatAverage(7, 2), '3.50');
  assert.equal(formatAverage(1999, 1000), '2.00'); // 1.999
});

test('기본 집계: 첫 열은 집계하지 않고 문항별로 센다', () => {
  const input = [
    '응답번호\t만족도\t추천',
    '1\t5\t4',
    '2\t3\t',
    '3\t4\t9',
    '4\t \t2',
  ].join('\r\n');
  const result = tally(input);
  assert.equal(result.ok, true);
  assert.equal(result.responseCount, 4);
  assert.deepEqual(rowsOf(result), [
    ['만족도', 3, '4.00', 1, 0],
    ['추천', 2, '3.00', 1, 1],
  ]);
});

test('첫 열 값이 1~5여도 문항으로 세지 않는다', () => {
  const result = tally('번호\tQ1\n1\t2\n5\t4\n');
  assert.deepEqual(rowsOf(result), [['Q1', 2, '3.00', 0, 0]]);
});

test('칸이 모자란 줄은 모자란 칸을 빈 응답으로 센다', () => {
  const input = 'No\tA\tB\tC\n1\t5\n2\n3\t1\t2\t3\n';
  assert.deepEqual(rowsOf(tally(input)), [
    ['A', 2, '3.00', 1, 0],
    ['B', 1, '2.00', 2, 0],
    ['C', 1, '3.00', 2, 0],
  ]);
});

test('유효 응답이 0이면 평균은 "-"', () => {
  const result = tally('No\tA\tB\n1\t\tx\n2\t \t0\n');
  assert.deepEqual(rowsOf(result), [
    ['A', 0, '-', 2, 0],
    ['B', 0, '-', 0, 2],
  ]);
});

test('머리글만 있으면 모든 문항이 0', () => {
  const result = tally('No\tA\tB\r\n');
  assert.equal(result.ok, true);
  assert.equal(result.responseCount, 0);
  assert.deepEqual(rowsOf(result), [
    ['A', 0, '-', 0, 0],
    ['B', 0, '-', 0, 0],
  ]);
});

test('빈 입력과 문항 없는 입력은 오류로 알린다', () => {
  assert.equal(tally('').error, 'empty');
  assert.equal(tally('\n\r\n').error, 'empty');
  assert.equal(tally('응답번호\n1\n2').error, 'noQuestions');
});

test('줄바꿈 종류(\\r\\n, \\n, \\r)와 끝 줄바꿈을 모두 받는다', () => {
  const expected = [['A', 2, '2.50', 0, 0]];
  assert.deepEqual(rowsOf(tally('No\tA\r\n1\t2\r\n2\t3\r\n')), expected);
  assert.deepEqual(rowsOf(tally('No\tA\n1\t2\n2\t3')), expected);
  assert.deepEqual(rowsOf(tally('No\tA\r1\t2\r2\t3\r')), expected);
});

test('길이 0인 줄은 건너뛰고, 탭만 있는 줄은 모두 빈 응답', () => {
  const result = tally('No\tA\tB\n\n1\t1\t1\n\t\t\n');
  assert.equal(result.responseCount, 2);
  assert.deepEqual(rowsOf(result), [
    ['A', 1, '1.00', 1, 0],
    ['B', 1, '1.00', 1, 0],
  ]);
});

test('머리글보다 칸이 많은 줄은 남는 칸을 집계하지 않고 줄 수를 센다', () => {
  const result = tally('No\tA\n1\t2\t5\t5\n2\t4\n');
  assert.equal(result.longRowCount, 1);
  assert.deepEqual(rowsOf(result), [['A', 2, '3.00', 0, 0]]);
});

test('엑셀식 큰따옴표 칸(탭·줄바꿈·따옴표 포함)을 읽는다', () => {
  assert.deepEqual(plain(parseTsv('a\t"b\tc"\t"d\r\ne"\t"f ""g"""\n')), [['a', 'b\tc', 'd\r\ne', 'f "g"']]);
  const result = tally('No\t"여러\n줄 문항"\t"쉼표, ""인용"""\n1\t3\t4\n');
  assert.deepEqual(rowsOf(result), [
    ['여러\n줄 문항', 1, '3.00', 0, 0],
    ['쉼표, "인용"', 1, '4.00', 0, 0],
  ]);
});

test('머리글 이름은 앞뒤 공백을 지우고, 비어 있으면 열 번호로 보여 준다', () => {
  const result = tally('No\t  만족  \t\tC\n1\t1\t2\t3\n');
  assert.deepEqual(plain(result.questions).map((q) => q.name), ['만족', '(3열)', 'C']);
});

test('응답이 많아도 정확히 센다', () => {
  const lines = ['No\tA'];
  for (let i = 1; i <= 1000; i++) lines.push(i + '\t' + ((i % 5) + 1));
  assert.deepEqual(rowsOf(tally(lines.join('\n'))), [['A', 1000, '3.00', 0, 0]]);
});

test('계산 로직은 DOM을 쓰지 않는다', () => {
  assert.doesNotMatch(match[1], /\b(document|window|navigator|localStorage|sessionStorage)\b/);
});

test('페이지는 외부 자원·전송·저장 기능을 쓰지 않는다', () => {
  assert.doesNotMatch(html, /\b(src|href)\s*=\s*["']?(https?:)?\/\//i, '외부 주소를 불러오지 않는다');
  assert.doesNotMatch(html, /@import|@font-face|url\(/i, '외부 글꼴·CSS를 불러오지 않는다');
  assert.doesNotMatch(
    html,
    /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|document\.cookie|postMessage)\b/,
    '전송·저장 API를 쓰지 않는다',
  );
  assert.doesNotMatch(html, /<form\b/i, '제출할 form이 없다');
  assert.match(html, /Content-Security-Policy" content="default-src 'none';[^"]*connect-src 'none'[^"]*form-action 'none'/);
});

test('저장소 맨 위에 빈 .nojekyll이 있다', () => {
  const stat = fs.statSync(path.join(__dirname, '..', '.nojekyll'));
  assert.equal(stat.size, 0);
});
