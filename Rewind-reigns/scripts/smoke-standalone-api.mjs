import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.env.VERCEL='1';
const {default:app}=await import('../server/index.mjs');
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`;
const source=readFileSync(join(root, 'src/App.tsx'),'utf8');
const file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=['mostCommonDirection','predictCloneDirection','buildCloneReplay'];
const funcs=file.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text));
assert.equal(funcs.length,3);
const js=ts.transpileModule(funcs.map(n=>n.getText(file)).join('\n')+'\nbuildCloneReplay;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const replay=vm.runInNewContext(js,{});
try{
 for(const language of ['en','zh'])for(let run=0;run<3;run++){
  let response=await fetch(base+'/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rulerName:'Synthetic standalone smoke',language})});assert.equal(response.status,201);let {sessionId,state}=await response.json();
  assert.equal(state.initialSnapshot.groundingSource,undefined);
  for(let turn=0;!state.ended&&turn<24;turn++){
   const option=state.currentCard.options[(turn+run)%state.currentCard.options.length];response=await fetch(`${base}/api/sessions/${sessionId}/decisions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cardId:state.currentCard.id,direction:option.direction,responseTimeMs:500,state})});assert.equal(response.status,200);const result=await response.json();state=result.state;assert.equal(state.history.length,turn+1);assert.equal(result.analytics.decisions,turn+1);for(const value of Object.values(state.meters))assert.ok(value>=0&&value<=100);
  }
  assert.equal(state.ended,true);assert.ok(state.history.length>0&&state.history.length<=24);assert.equal(state.currentCard,null);
  const summary=replay({sessionId,history:state.history},{primaryMode:'synthetic-test'},language);assert.equal(summary.protocol,'rewindai.clone_same_question_replay');assert.equal(summary.total_questions,state.history.length);assert.deepEqual(Array.from(summary.choices,c=>c.card_id),state.history.map(h=>h.cardId));assert.equal(summary.matched_choices,summary.choices.filter(c=>c.human_direction===c.clone_direction).length);assert.equal(summary.similarity_percent,Math.round(summary.matched_choices/summary.total_questions*100));
  response=await fetch(`${base}/api/sessions/${sessionId}/decisions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({direction:'left',state})});assert.equal(response.status,409);
  console.log(`PASS standalone ${language} run ${run+1}: ${state.history.length} decisions to ending; exact-card clone replay and agreement verified without StorySage, credentials, or provider calls`);
 }
}finally{await new Promise(r=>server.close(r));}
