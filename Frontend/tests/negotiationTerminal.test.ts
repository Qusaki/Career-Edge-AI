import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getOfflineNegotiationTurn, isClearNegotiationAcceptance } from '../src/offline/localEvaluation';

test('only clear acceptance of the current offer ends bargaining', () => {
  for (const message of [
    'I accept.', 'I accept the 37k offer.', '37k works for me.', 'Deal.',
    'Okay, I agree.', 'That works for me.', "I'll take it.",
    'I have 5 years of experience, but yes, I accept.',
  ]) {
    assert.equal(isClearNegotiationAcceptance(message, 37000), true, message);
    const result = getOfflineNegotiationTurn(message, 2, 37000);
    assert.equal(result.status, 'agreed', message);
    assert.equal(result.acceptedSalary, 37000, message);
    assert.equal(result.newOffer, 37000, message);
  }
  for (const message of [
    'What benefits are included?', 'Can you offer more?', '37k is too low.',
    'I need to think about it.', 'What about 40k?', 'I want better benefits.',
    'I think I am worth more.', 'Can we negotiate?', 'I do not accept.',
    'I accept the 40k offer.',
  ]) {
    assert.equal(isClearNegotiationAcceptance(message, 37000), false, message);
  }
});

test('benefits and bargaining stay open; accepted salary never changes on closing', () => {
  const initial = getOfflineNegotiationTurn('What benefits are included?', 0, 35000);
  assert.equal(initial.status, 'negotiating');
  assert.equal(initial.newOffer, 35000);
  const higher = getOfflineNegotiationTurn('I think my value is higher.', 1, initial.newOffer);
  assert.equal(higher.status, 'negotiating');
  assert.equal(higher.newOffer, 37000);
  const accepted = getOfflineNegotiationTurn('Deal.', 2, higher.newOffer);
  assert.equal(accepted.status, 'agreed');
  assert.equal(accepted.acceptedSalary, 37000);

  for (const message of ['Thank you.', 'Goodbye.', 'Can you offer 42k instead?']) {
    const closing = getOfflineNegotiationTurn(message, 3, accepted.newOffer, accepted.status, accepted.acceptedSalary);
    assert.equal(closing.status, 'closed', message);
    assert.equal(closing.newOffer, 37000, message);
    assert.equal(closing.acceptedSalary, 37000, message);
    assert.doesNotMatch(closing.response, /₱|salary|offer/i, message);
  }
  const closed = getOfflineNegotiationTurn('Goodbye.', 4, 37000, 'closed', 37000);
  assert.equal(closed.newOffer, 37000);
  assert.equal(closed.acceptedSalary, 37000);
});

test('Drills restores online agreement from the session and guards the microphone', () => {
  const source = readFileSync(new URL('../src/components/DrillsPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /readSavedNegotiation\(session\.evaluation_data\)/);
  assert.match(source, /setNegotiationStatus\(savedNegotiation\?\.status \?\? 'negotiating'\)/);
  assert.match(source, /setAcceptedSalary\(savedNegotiation\?\.acceptedSalary \?\? null\)/);
  assert.match(source, /body: JSON\.stringify\(\{ session_id: execution\.serverSessionId/);
  assert.match(source, /negotiationGameOver && negotiationStatus !== 'agreed'/);
  assert.match(source, /negotiationStatus === 'agreed' \? 'Speak Closing'/);
});
