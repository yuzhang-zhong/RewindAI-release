import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const relativePath = 'src/components/chat/ChatPage.tsx';
const source = readFileSync(join(root, relativePath), 'utf8');
const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = [
  'userTurns',
  'submittedAnswerAlreadyVisible',
  'effectiveUserTurns',
  'requiredInterviewTurns',
  'canFinishInterview',
];
const expressions = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(sourceFile))) {
    const name = node.name.getText(sourceFile);
    assert.ok(!expressions.has(name), `one ${name} declaration`);
    expressions.set(name, node.initializer.getText(sourceFile));
  }
  ts.forEachChild(node, visit);
}
visit(sourceFile);
assert.equal(expressions.size, names.length, 'all gate expressions found in the real component');

// Evaluate the component's actual expressions rather than copying its logic.
const { outputText } = ts.transpileModule([
  ...names.map(name => `const ${name} = ${expressions.get(name)};`),
  '({ userTurns, effectiveUserTurns, requiredInterviewTurns, canFinishInterview });',
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } });

function evaluate(studyGroup, count, lastSubmittedAnswer = '', additionalMessages = []) {
  return vm.runInNewContext(outputText, {
    studyGroup,
    messages: [
      ...Array.from({ length: count }, (_, index) => ({ role: 'User', content: `Answer ${index + 1}` })),
      ...additionalMessages,
    ],
    lastSubmittedAnswer,
  });
}

for (const group of ['experiment', 'anonymous', 'blank', 'contrast']) {
  const required = ['experiment', 'anonymous'].includes(group) ? 20 : 1;
  for (const count of [0, 1, 19, 20]) {
    const result = evaluate(group, count);
    assert.equal(result.requiredInterviewTurns, required);
    assert.equal(result.effectiveUserTurns, count);
    assert.equal(result.canFinishInterview, count >= required);
    console.log(`PASS ${group}: ${count} answers ${result.canFinishInterview ? 'allow' : 'block'} completion at required ${required}`);
  }
}

const pending = evaluate('experiment', 19, 'Answer 20');
assert.equal(pending.effectiveUserTurns, 20);
assert.equal(pending.canFinishInterview, true);
console.log('PASS a pending submitted answer counts while asynchronous message history catches up');

const alreadySaved = evaluate('experiment', 19, ' Answer 19 ');
assert.equal(alreadySaved.effectiveUserTurns, 19);
assert.equal(alreadySaved.canFinishInterview, false);
console.log('PASS the same submitted answer is not counted twice after appearing in message history');

const empty = evaluate('experiment', 0, '   ', [
  { role: 'User', content: ' ' },
  { role: 'Interviewer', content: 'An interviewer question is not an answer.' },
]);
assert.equal(empty.effectiveUserTurns, 0);
assert.equal(empty.canFinishInterview, false);
console.log('PASS whitespace and interviewer messages cannot unlock biography generation');

console.log('PASS interview completion gate smoke completed without network or model calls.');
