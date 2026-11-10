const test = require('node:test');
const assert = require('node:assert');
const L = require('../lib.js');

test('addMonths gestisce fine mese', () => {
  assert.strictEqual(L.addMonths('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(L.addMonths('2026-11-15', 3), '2027-02-15');
});

test('addDays e diffDays', () => {
  assert.strictEqual(L.addDays('2026-12-30', 3), '2027-01-02');
  assert.strictEqual(L.diffDays('2026-03-25', '2026-03-30'), 5); // attraversa ora legale
});

test('nextDate ricorrenze', () => {
  assert.strictEqual(L.nextDate('2026-06-10', 'Annuale'), '2027-06-10');
  assert.strictEqual(L.nextDate('2026-06-10', 'Nessuna'), null);
  assert.strictEqual(L.nextDate('', 'Mensile'), null);
});

test('buildICS: evento giornata intera con allarme', () => {
  const s = L.buildICS([{ uid: 'a@x', date: '2026-07-10', title: 'Test, prova; ok' }], { alarmDays: 1, alarmTime: '09:00' });
  assert.match(s, /BEGIN:VCALENDAR\r\n/);
  assert.match(s, /DTSTART;VALUE=DATE:20260710\r\n/);
  assert.match(s, /DTEND;VALUE=DATE:20260711\r\n/); // fine esclusiva
  assert.match(s, /SUMMARY:Test\\, prova\\; ok\r\n/);
  assert.match(s, /TRIGGER:-PT900M\r\n/); // 24h - 9h
  assert.ok(s.endsWith('END:VCALENDAR\r\n'));
});

test('buildICS: evento con ora', () => {
  const s = L.buildICS([{ uid: 'b@x', date: '2026-07-10', time: '08:30', durationMin: 90, title: 'Visita' }], { alarmDays: 0 });
  assert.match(s, /DTSTART:20260710T083000\r\n/);
  assert.match(s, /DTEND:20260710T100000\r\n/);
  assert.match(s, /TRIGGER:-PT30M\r\n/);
});

test('fold: righe max 75 byte', () => {
  const s = L.buildICS([{ uid: 'c@x', date: '2026-07-10', title: 'è'.repeat(80) + ' lungo', description: 'x'.repeat(200) }]);
  const enc = new TextEncoder();
  for (const line of s.split('\r\n')) assert.ok(enc.encode(line).length <= 75, line);
});

test('remindersText', () => {
  assert.strictEqual(L.remindersText([{ title: 'Revisione', date: '2026-07-10', time: '09:00' }]), 'Revisione — 10/07/2026 09:00');
});
