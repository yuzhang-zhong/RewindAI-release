import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Execute the actual form submit handlers, not a duplicate implementation.
// Mocked APIs keep these checks local and never create real accounts.
function loadSubmitHandler(relativePath, dependencies) {
  const source = readFileSync(join(root, relativePath), 'utf8');
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === 'onFinish') {
      matches.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.equal(matches.length, 1, `${relativePath} defines one submit handler`);
  const { outputText } = ts.transpileModule(`(${matches[0].getText(sourceFile)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const forbiddenStorage = new Proxy({}, {
    get() { throw new Error('Form submit handlers must not read or cache browser credentials.'); },
  });
  return vm.runInNewContext(outputText, {
    ...dependencies,
    localStorage: forbiddenStorage,
    sessionStorage: forbiddenStorage,
    indexedDB: forbiddenStorage,
  });
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function harness(relativePath, apiResult) {
  const calls = [];
  const handler = loadSubmitHandler(relativePath, {
    ApiError,
    apiClient: async (endpoint, options) => {
      calls.push({ type: 'api', endpoint, options });
      if (apiResult instanceof Error) throw apiResult;
      return apiResult;
    },
    login: (...args) => calls.push({ type: 'login', args }),
    navigate: (...args) => calls.push({ type: 'navigate', args }),
    message: {
      success: text => calls.push({ type: 'success', text }),
      error: text => calls.push({ type: 'error', text }),
    },
    setIsRegistering: value => calls.push({ type: 'registering', value }),
    setIsOpeningCockpit: value => calls.push({ type: 'opening', value }),
    console: { error() {} },
    copy: { success: userId => `Logged in: ${userId}`, failed: 'Authentication failed: ' },
  });
  return { handler, calls };
}

const values = { userId: 'SmokeUser', password: 'synthetic-test-password', studyGroup: 'blank' };
const loginPath = 'src/components/user/Login.tsx';
const registerPath = 'src/components/user/Register.tsx';

for (const failure of [
  ...[400, 401, 403, 408, 500].map(status => new ApiError(status, `Rejected ${status}`)),
  new Error('Network unavailable'),
]) {
  const { handler, calls } = harness(loginPath, failure);
  await handler(values);
  assert.deepEqual(calls.filter(call => call.type === 'api').map(call => call.endpoint), ['LOGIN']);
  assert.equal(calls.filter(call => ['login', 'navigate', 'success'].includes(call.type)).length, 0);
  assert.equal(calls.filter(call => call.type === 'error').length, 1);
  assert.ok(calls.find(call => call.type === 'error').text.includes(failure.message));
  console.log(`PASS rejected login stays failed without registration, local-token fallback, or navigation: ${failure.message}`);
}

for (const studyGroup of ['blank', 'contrast', 'experiment', 'anonymous', undefined]) {
  const { handler, calls } = harness(loginPath, { access_token: 'synthetic-session-token', study_group: studyGroup });
  await handler(values);
  const request = calls.find(call => call.type === 'api');
  assert.equal(request.endpoint, 'LOGIN');
  assert.equal(request.options.requireAuth, false);
  assert.deepEqual(JSON.parse(request.options.body), { user_id: 'smokeuser', password: values.password });
  const authenticated = calls.find(call => call.type === 'login');
  assert.deepEqual(Array.from(authenticated.args), ['smokeuser', 'synthetic-session-token', studyGroup ?? 'experiment']);
  assert.ok(calls.indexOf(request) < calls.indexOf(authenticated));
  assert.equal(calls.filter(call => call.type === 'navigate').length, 1);
  console.log(`PASS successful login uses only the backend token and group: ${studyGroup ?? 'default experiment'}`);
}

for (const apiResult of [
  { access_token: 'synthetic-signup-token', study_group: 'blank' },
  new ApiError(409, 'Account already exists'),
]) {
  const { handler, calls } = harness(registerPath, apiResult);
  await handler(values);
  assert.deepEqual(calls.filter(call => call.type === 'api').map(call => call.endpoint), ['REGISTER']);
  const request = calls.find(call => call.type === 'api');
  assert.equal(request.options.requireAuth, false);
  assert.equal(request.options.timeoutMs, 45000);
  assert.deepEqual(JSON.parse(request.options.body), {
    user_id: 'smokeuser', password: values.password, study_group: 'blank',
  });
  if (apiResult instanceof Error) {
    assert.equal(calls.filter(call => ['login', 'navigate', 'success'].includes(call.type)).length, 0);
    assert.equal(calls.filter(call => call.type === 'error').length, 1);
    console.log('PASS rejected explicit signup does not authenticate or navigate');
  } else {
    assert.deepEqual(Array.from(calls.find(call => call.type === 'login').args), ['smokeuser', 'synthetic-signup-token', 'blank']);
    assert.equal(calls.filter(call => call.type === 'navigate').length, 1);
    console.log('PASS explicit signup authenticates with its backend-issued token');
  }
}

console.log('PASS authentication fail-closed smoke completed without network or credential persistence.');
