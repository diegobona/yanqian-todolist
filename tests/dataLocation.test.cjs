const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {prepareDataLocation}=require('../src/services/dataLocation');
const {relocateData,readDataLocation}=require('../src/services/dataLocation');
const {TaskRepository}=require('../src/services/taskRepository');
test('changing location preserves tasks and directs future writes and restart to new folder',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-relocate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=new TaskRepository({directory:path.join(root,'old')});repo.command('add',{content:'keep me'});
 const config=path.join(root,'data-location.json');const target=relocateData(repo,path.join(root,'chosen'),config);
 assert.equal(readDataLocation(config,'fallback'),target);assert.equal(repo.snapshot().todoList[0].content,'keep me');repo.command('add',{content:'new item'});
 assert.equal(new TaskRepository({directory:target}).snapshot().todoList.length,2);assert.equal(new TaskRepository({directory:path.join(root,'old')}).snapshot().todoList.length,1);
 fs.mkdirSync(path.join(root,'yanqian-todo-list'));assert.throws(()=>relocateData(repo,root,config),/已有/);
});
test('failed location preference write keeps the original repository active',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-location-fail-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'old');const repo=new TaskRepository({directory:source});repo.command('add',{content:'safe'});repo.backup();
 const config=path.join(root,'config.json');const write=repo.atomicWrite.bind(repo);repo.atomicWrite=(file,data)=>{if(file===config)throw Error('disk denied');return write(file,data);};
 assert.throws(()=>relocateData(repo,path.join(root,'new'),config),/disk denied/);assert.equal(repo.directory,source);assert.equal(readDataLocation(config,source),source);
});
test('migrates existing tasks and screenshots without deleting originals or replacing migrated data',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-location-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const old=path.join(root,'xhznl-todo-list');fs.mkdirSync(path.join(old,'attachments'),{recursive:true});
 fs.writeFileSync(path.join(old,'data.json'),'original');fs.writeFileSync(path.join(old,'attachments','image.png'),'image');
 const next=prepareDataLocation(root,old);assert.equal(next,path.join(root,'yanqian-todo-list'));
 assert.equal(fs.readFileSync(path.join(next,'data.json'),'utf8'),'original');assert.equal(fs.readFileSync(path.join(next,'attachments','image.png'),'utf8'),'image');
 assert.ok(fs.existsSync(path.join(old,'data.json')));fs.writeFileSync(path.join(next,'data.json'),'updated');prepareDataLocation(root,old);assert.equal(fs.readFileSync(path.join(next,'data.json'),'utf8'),'updated');
});
